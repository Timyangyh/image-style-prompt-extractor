import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  GenerationApiMode,
  GenerationAspectRatio,
  GenerationAuthSource,
  GenerationProviderType,
  GenerationResolution,
  GenerationRequestSettings,
  GenerationRequestSizeStrategy,
  ImageEditAnnotationItem,
  ImageEditCreateRequest,
  ImageEditDiagnostics,
  ImageEditFidelityMode,
  ImageEditLocalProtectionMaskImage,
  ImageEditMaskImage,
  ImageEditOutput,
  ImageEditOutputVariant,
  ImageEditOutputsSaveRequest,
  ImageEditProtectedVariantSaveRequest,
  ImageEditTask,
  ImageEditTaskVisibility,
  ImageEditTaskVisibilityUpdate
} from "../src/shared/types";
import {
  generationAspectRatioOptions,
  normalizeGenerationSizeSettings,
  resolveGenerationSize
} from "../src/shared/generation-size";
import { CodexAuthState, getCodexAuthStatus, loadCodexAuthState, refreshCodexAuthState } from "./codex-auth";
import {
  buildCodexResponsesPayload,
  buildImagesGenerationPayload,
  buildOpenRouterImagesPayload,
  buildResponsesPayload,
  generationEndpoint,
  openRouterImagesEndpoint,
  parseGenerationOutputDimensions,
  parseImagesResponse,
  parseOpenRouterImagesResponse,
  parseResponsesImageResponse
} from "./generation";
import { ModelHttpError, readJsonFile, writeJsonFile } from "./main-utils";

type ImageEditRunnerOutput = Omit<ImageEditOutput, "id" | "createdAt" | "assetFileName">;
type ImageEditTaskRunner = (task: ImageEditTask, signal: AbortSignal) => Promise<ImageEditRunnerOutput[]>;

interface ImageEditServiceOptions {
  concurrency?: number;
  runner?: ImageEditTaskRunner;
}

interface EffectiveImageEditBackend {
  authSource: GenerationAuthSource;
  providerType: GenerationProviderType;
  providerName?: string;
  apiBaseUrl: string;
  apiKey: string;
  apiMode: GenerationApiMode;
  imageModel: string;
  mainModel: string;
}

interface StoredGenerationConfigForImageEdit {
  authSource?: GenerationAuthSource;
  activeProviderId?: string;
  providers?: StoredGenerationProviderForImageEdit[];
  providerType?: GenerationProviderType;
  apiBaseUrl?: string;
  apiMode?: GenerationApiMode;
  imageModel?: string;
  mainModel?: string;
  saveApiKey?: boolean;
  encryptedApiKey?: string;
  apiKey?: string;
}

interface StoredGenerationProviderForImageEdit {
  id?: string;
  name?: string;
  providerType?: GenerationProviderType;
  apiBaseUrl?: string;
  apiMode?: GenerationApiMode;
  imageModel?: string;
  mainModel?: string;
  saveApiKey?: boolean;
  encryptedApiKey?: string;
  apiKey?: string;
}

type StoredImageEditSourceImage = Omit<ImageEditTask["sourceImage"], "dataUrl"> & { assetFileName: string };
type StoredImageEditAnnotationImage = Omit<ImageEditTask["annotationImage"], "dataUrl"> & { assetFileName: string };
type StoredImageEditMaskImage = Omit<ImageEditMaskImage, "dataUrl"> & { assetFileName: string };
type StoredImageEditLocalProtectionMaskImage = Omit<ImageEditLocalProtectionMaskImage, "dataUrl"> & { assetFileName: string };
type StoredImageEditOutputVariant = Omit<ImageEditOutputVariant, "dataUrl"> & { assetFileName: string };
type StoredImageEditOutput = Omit<ImageEditOutput, "dataUrl" | "protectedVariant"> & {
  assetFileName: string;
  protectedVariant?: StoredImageEditOutputVariant;
};
type StoredImageEditTask = Omit<
  ImageEditTask,
  "sourceImage" | "annotationImage" | "maskImage" | "localProtectionMaskImage" | "outputs"
> & {
  sourceImage: StoredImageEditSourceImage;
  annotationImage: StoredImageEditAnnotationImage;
  maskImage?: StoredImageEditMaskImage;
  localProtectionMaskImage?: StoredImageEditLocalProtectionMaskImage;
  outputs: StoredImageEditOutput[];
};

const IMAGE_EDIT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STORED_TASKS = 80;
const DEFAULT_MAIN_MODEL = "gpt-5.5";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_IMAGE_MODEL = "openai/gpt-image-2";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_USER_AGENT = "codex-tui/0.118.0 (Mac OS 26.3.1; arm64) Codex Desktop";
const CODEX_ORIGINATOR = "codex-tui";
const OPENROUTER_EDIT_FIDELITY_NOTE = "OpenRouter /images + input_references 属于参考生图，不承诺严格源图保真。";
const MASK_EDIT_UNAVAILABLE_OPENROUTER = "OpenRouter /images 是参考生成接口，不支持 alpha mask 严格编辑。";
const MASK_EDIT_UNAVAILABLE_CODEX = "Codex OAuth 当前走 Responses image_generation，不支持本方案的 alpha mask 严格编辑。";
const MASK_EDIT_UNAVAILABLE_RESPONSES = "OpenAI-compatible Responses 当前走 image_generation 工具，本方案 v1 不接入 mask 文件上传。";

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const normalizeTaskVisibility = (value: ImageEditTaskVisibility | undefined): ImageEditTaskVisibility =>
  value === "archived" || value === "hidden" ? value : "active";

const normalizeAnnotationTool = (tool: ImageEditAnnotationItem["tool"] | undefined): ImageEditAnnotationItem["tool"] =>
  tool === "arrow" || tool === "box" || tool === "text" ? tool : "brush";

const annotationToolLabel = (tool: ImageEditAnnotationItem["tool"]): string => {
  if (tool === "arrow") return "箭头";
  if (tool === "box") return "框选";
  if (tool === "text") return "文字批注";
  return "画笔";
};

const normalizeAnnotationItems = (items: ImageEditAnnotationItem[] | undefined): ImageEditAnnotationItem[] =>
  (Array.isArray(items) ? items : [])
    .slice(0, 50)
    .map((item, itemIndex) => {
      const index = itemIndex + 1;
      const tool = normalizeAnnotationTool(item.tool);
      return {
        index,
        label: `标注 ${index}`,
        tool,
        note: item.note?.trim().slice(0, 600) || "按总体改图说明处理此处。",
        positionHint: item.positionHint?.trim().slice(0, 120) || undefined
      };
    });

const sanitizeImageEditOutputCompression = (settings: ImageEditCreateRequest["settings"]): number | undefined => {
  if (settings.outputFormat !== "jpeg" && settings.outputFormat !== "webp") return undefined;
  if (typeof settings.outputCompression !== "number") return 80;
  return clamp(Math.round(settings.outputCompression), 1, 100);
};

const dataUrlToBuffer = (dataUrl: string): { mimeType: string; buffer: Buffer } => {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+)?(;base64)?,([\s\S]*)$/i);
  if (!match || match[2] !== ";base64") {
    throw new Error("改图图片必须是有效的 base64 图片数据。");
  }
  return {
    mimeType: match[1] || "image/png",
    buffer: Buffer.from(match[3], "base64")
  };
};

const dataUrlFromBuffer = (buffer: Buffer, mimeType: string): string => `data:${mimeType};base64,${buffer.toString("base64")}`;

const imageExtension = (mimeType: string): "jpg" | "png" | "webp" => {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
};

const normalizeProviderType = (providerType: GenerationProviderType | undefined): GenerationProviderType =>
  providerType === "openrouter" ? "openrouter" : "openai_compatible";

const normalizeFidelityMode = (value: ImageEditFidelityMode | undefined): ImageEditFidelityMode =>
  value === "strict_mask" ? "strict_mask" : "reference";

const decryptStoredApiKey = (
  stored: Pick<StoredGenerationConfigForImageEdit | StoredGenerationProviderForImageEdit, "encryptedApiKey" | "saveApiKey" | "apiKey">
): string => {
  if (stored.encryptedApiKey) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, "base64"));
    } catch {
      return "";
    }
  }
  return stored.saveApiKey ? stored.apiKey?.trim() ?? "" : "";
};

const normalizeMainModel = (value: string | undefined): string => value?.trim() || DEFAULT_MAIN_MODEL;

const normalizeStoredImageEditBackend = (stored: StoredGenerationConfigForImageEdit): EffectiveImageEditBackend => {
  const legacyApiKey = decryptStoredApiKey(stored);
  const providers = Array.isArray(stored.providers)
    ? stored.providers
        .map((provider, index): EffectiveImageEditBackend & { id: string } => {
          const providerType = normalizeProviderType(provider.providerType);
          return {
            id: provider.id?.trim() || `provider-${index + 1}`,
            authSource: "api",
            providerType,
            providerName:
              provider.name?.trim() ||
              (providerType === "openrouter" ? "OpenRouter" : index === 0 ? "默认 API 供应商" : `API 供应商 ${index + 1}`),
            apiBaseUrl:
              provider.apiBaseUrl?.trim() ||
              (providerType === "openrouter" ? DEFAULT_OPENROUTER_BASE_URL : "https://api.openai.com/v1"),
            apiKey: decryptStoredApiKey(provider),
            apiMode: providerType === "openrouter" ? "images" : provider.apiMode === "responses" ? "responses" : "images",
            imageModel:
              provider.imageModel?.trim() ||
              (providerType === "openrouter" ? DEFAULT_OPENROUTER_IMAGE_MODEL : "gpt-image-2"),
            mainModel: normalizeMainModel(provider.mainModel)
          };
        })
        .filter((provider) => provider.id)
    : [];

  const activeProvider =
    providers.find((provider) => provider.id === stored.activeProviderId) ||
    providers[0];
  if (activeProvider) {
    return {
      ...activeProvider,
      authSource: stored.authSource === "codex_oauth" ? "codex_oauth" : "api"
    };
  }

  const providerType = normalizeProviderType(stored.providerType);
  return {
    authSource: stored.authSource === "api" || legacyApiKey ? "api" : "codex_oauth",
    providerType,
    providerName: providerType === "openrouter" ? "OpenRouter" : "默认 API 供应商",
    apiBaseUrl:
      stored.apiBaseUrl?.trim() ||
      (providerType === "openrouter" ? DEFAULT_OPENROUTER_BASE_URL : "https://api.openai.com/v1"),
    apiKey: legacyApiKey,
    apiMode: providerType === "openrouter" ? "images" : stored.apiMode === "responses" ? "responses" : "images",
    imageModel:
      stored.imageModel?.trim() ||
      (providerType === "openrouter" ? DEFAULT_OPENROUTER_IMAGE_MODEL : "gpt-image-2"),
    mainModel: normalizeMainModel(stored.mainModel)
  };
};

const toGenerationSettings = (settings: ImageEditTask["settings"]): GenerationRequestSettings => ({
  ...settings,
  promptMode: "strict"
});

export const imageEditMaskCapabilityForBackend = (
  backend: { authSource: GenerationAuthSource; providerType: GenerationProviderType; apiMode: GenerationApiMode }
): { supportsMaskEdit: boolean; maskEditUnavailableReason?: string } => {
  if (backend.authSource === "codex_oauth") {
    return { supportsMaskEdit: false, maskEditUnavailableReason: MASK_EDIT_UNAVAILABLE_CODEX };
  }
  if (backend.providerType === "openrouter") {
    return { supportsMaskEdit: false, maskEditUnavailableReason: MASK_EDIT_UNAVAILABLE_OPENROUTER };
  }
  if (backend.apiMode !== "images") {
    return { supportsMaskEdit: false, maskEditUnavailableReason: MASK_EDIT_UNAVAILABLE_RESPONSES };
  }
  return { supportsMaskEdit: true };
};

const backendSnapshotForTask = (config: EffectiveImageEditBackend): ImageEditTask["backend"] => ({
  ...imageEditMaskCapabilityForBackend(config),
  authSource: config.authSource,
  providerType: config.providerType,
  providerName: config.providerName,
  apiBaseUrl: config.authSource === "api" ? config.apiBaseUrl : undefined,
  apiMode: config.authSource === "codex_oauth" ? "responses" : config.providerType === "openrouter" ? "images" : config.apiMode,
  imageModel: config.imageModel,
  mainModel: config.mainModel,
  fidelityNote: config.providerType === "openrouter" ? OPENROUTER_EDIT_FIDELITY_NOTE : undefined
});

const diagnosticsBackendType = (
  backend: EffectiveImageEditBackend | null,
  request: ImageEditCreateRequest
): ImageEditDiagnostics["backendType"] => {
  if (backend?.authSource === "codex_oauth") return "codex_oauth";
  if (backend?.providerType === "openrouter" || request.settings.apiMode === "images") {
    return backend?.providerType === "openrouter" ? "openrouter" : "openai_compatible";
  }
  return "openai_compatible";
};

const diagnosticsForTask = (
  request: ImageEditCreateRequest,
  backend: EffectiveImageEditBackend | null,
  backendSnapshot: ImageEditTask["backend"] | undefined
): ImageEditDiagnostics => {
  const strictMaskSubmitted = normalizeFidelityMode(request.fidelityMode) === "strict_mask" && Boolean(request.maskImage);
  const backendType = diagnosticsBackendType(backend, request);
  return {
    backendType,
    apiMode:
      backend?.authSource === "codex_oauth"
        ? "responses"
        : backend?.providerType === "openrouter"
          ? "images"
          : backend?.apiMode || request.settings.apiMode,
    providerType: backend?.providerType,
    model: backend?.imageModel || request.settings.imageModel,
    requestedSize: request.settings.size,
    outputFormat: request.settings.outputFormat,
    sourceImage: {
      width: request.sourceImage.width,
      height: request.sourceImage.height,
      mimeType: request.sourceImage.mimeType,
      reencodedToPng: normalizeFidelityMode(request.fidelityMode) === "strict_mask" && request.sourceImage.mimeType === "image/png"
    },
    annotationImage: {
      width: parseGenerationOutputDimensions(request.annotationImage.dataUrl)?.width,
      height: parseGenerationOutputDimensions(request.annotationImage.dataUrl)?.height,
      itemCount: request.annotationImage.itemCount
    },
    localMask: request.localProtectionMaskImage?.stats || {
      width: request.localProtectionMaskImage?.width,
      height: request.localProtectionMaskImage?.height,
      itemCount: request.localProtectionMaskImage?.itemCount || 0
    },
    strictMaskSubmitted,
    localMaskSubmittedToBackend: false,
    supportsMaskEdit: backendSnapshot?.supportsMaskEdit,
    maskEditUnavailableReason: backendSnapshot?.maskEditUnavailableReason
  };
};

const parseApiErrorMessage = (text: string, fallback: string): string => {
  try {
    const payload = JSON.parse(text) as {
      error?: { code?: string; type?: string; message?: string };
      code?: string;
      type?: string;
      message?: string;
    };
    return (
      payload.error?.message ||
      payload.message ||
      payload.error?.code ||
      payload.code ||
      payload.error?.type ||
      payload.type ||
      fallback
    );
  } catch {
    return text.trim() || fallback;
  }
};

const isOpenRouterParameterError = (status: number, text: string): boolean =>
  status === 400 && /(unsupported|not supported|invalid|expected|parameter|参数|size|resolution|aspect)/i.test(parseApiErrorMessage(text, ""));

const formatOpenRouterImagesError = (status: number, text: string, endpoint: string): string => {
  const message = parseApiErrorMessage(text, "OpenRouter Images API 请求失败。");
  if (status === 404) {
    return `OpenRouter Images API 接口路径错误（404）：请确认 Base URL 是 https://openrouter.ai/api/v1，当前实际请求 ${endpoint}。${message}`;
  }
  if (status === 400 && /(unsupported|not supported|invalid|expected|parameter|参数)/i.test(message)) {
    return `OpenRouter 模型不支持某参数或参数值（400）：${message}`;
  }
  return `OpenRouter Images API 请求失败（${status}）：${message}`;
};

const requestJson = async (
  url: string,
  apiKey: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
  accept = "application/json"
): Promise<string> => {
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Accept: accept,
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)))
  });
  const text = await response.text();
  if (!response.ok) throw new ModelHttpError(response.status, text);
  return text;
};

const requestEditForm = async (
  url: string,
  apiKey: string,
  prompt: string,
  settings: GenerationRequestSettings,
  referenceImageDataUrls: string[],
  signal: AbortSignal
): Promise<string> => {
  const form = new FormData();
  const payload = buildImagesGenerationPayload(prompt, settings);
  Object.entries(payload).forEach(([key, value]) => {
    if (key === "n" || value !== undefined) form.append(key, String(value));
  });
  referenceImageDataUrls.forEach((dataUrl, index) => {
    const { mimeType, buffer } = dataUrlToBuffer(dataUrl);
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    form.append("image", blob, `image-${index + 1}.${imageExtension(mimeType)}`);
  });

  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });
  const text = await response.text();
  if (!response.ok) throw new ModelHttpError(response.status, text);
  return text;
};

const requestMaskedEditForm = async (
  url: string,
  apiKey: string,
  prompt: string,
  settings: GenerationRequestSettings,
  sourceImageDataUrl: string,
  maskImageDataUrl: string,
  signal: AbortSignal
): Promise<string> => {
  const source = dataUrlToBuffer(sourceImageDataUrl);
  const mask = dataUrlToBuffer(maskImageDataUrl);
  if (source.mimeType !== "image/png" || mask.mimeType !== "image/png") {
    throw new Error("严格保真模式要求源图和 mask 都是 PNG。");
  }
  const sourceDimensions = parseGenerationOutputDimensions(sourceImageDataUrl);
  const maskDimensions = parseGenerationOutputDimensions(maskImageDataUrl);
  if (
    sourceDimensions &&
    maskDimensions &&
    (sourceDimensions.width !== maskDimensions.width || sourceDimensions.height !== maskDimensions.height)
  ) {
    throw new Error("严格保真模式的源图和 mask 必须同尺寸。");
  }

  const form = new FormData();
  const payload = buildImagesGenerationPayload(prompt, settings);
  Object.entries(payload).forEach(([key, value]) => {
    if (key === "n" || value !== undefined) form.append(key, String(value));
  });
  form.append("image", new Blob([new Uint8Array(source.buffer)], { type: "image/png" }), "source.png");
  form.append("mask", new Blob([new Uint8Array(mask.buffer)], { type: "image/png" }), "mask.png");

  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });
  const text = await response.text();
  if (!response.ok) throw new ModelHttpError(response.status, text);
  return text;
};

const codexHeaders = (authState: CodexAuthState): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authState.accessToken}`,
    Accept: "text/event-stream",
    Connection: "Keep-Alive",
    Originator: CODEX_ORIGINATOR,
    "User-Agent": CODEX_USER_AGENT,
    Session_id: randomUUID(),
    "X-Client-Request-Id": randomUUID()
  };
  if (authState.accountId) headers["Chatgpt-Account-Id"] = authState.accountId;
  return headers;
};

const requestCodexResponses = async (
  payload: Record<string, unknown>,
  authState: CodexAuthState,
  signal: AbortSignal
): Promise<{ text: string; authState: CodexAuthState }> => {
  const request = async (state: CodexAuthState) => {
    const response = await fetch(CODEX_RESPONSES_URL, {
      method: "POST",
      signal,
      headers: codexHeaders(state),
      body: JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)))
    });
    return {
      response,
      text: await response.text()
    };
  };

  let currentState = authState;
  let { response, text } = await request(currentState);
  if ((response.status === 401 || response.status === 403) && currentState.refreshToken) {
    currentState = await refreshCodexAuthState(currentState, signal);
    ({ response, text } = await request(currentState));
  }
  if (!response.ok) throw new ModelHttpError(response.status, text);
  return { text, authState: currentState };
};

const requestOpenRouterImageEdit = async (
  backend: EffectiveImageEditBackend,
  prompt: string,
  settings: GenerationRequestSettings,
  referenceImageDataUrls: string[],
  signal: AbortSignal
): Promise<ImageEditRunnerOutput[]> => {
  const endpoint = openRouterImagesEndpoint(backend.apiBaseUrl);
  const strategies: GenerationRequestSizeStrategy[] = ["exact_size", "openrouter_normalized", "openrouter_aspect_ratio"];
  let lastFailure: { status: number; text: string } | null = null;

  for (const sizeStrategy of strategies) {
    const payload = buildOpenRouterImagesPayload(prompt, settings, referenceImageDataUrls, undefined, sizeStrategy);
    const response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${backend.apiKey}`
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    if (response.ok) {
      const results = await parseOpenRouterImagesResponse(text, backend.apiKey, settings);
      return results.map((result) => ({
        ...result,
        warnings: [...(result.warnings || []), OPENROUTER_EDIT_FIDELITY_NOTE]
      }));
    }
    lastFailure = { status: response.status, text };
    if (!isOpenRouterParameterError(response.status, text) || sizeStrategy === "openrouter_aspect_ratio") {
      break;
    }
  }

  throw new Error(
    formatOpenRouterImagesError(lastFailure?.status || 500, lastFailure?.text || "OpenRouter Images API 请求失败。", endpoint)
  );
};

const summarizeOutputProblems = (outputs: ImageEditOutput[], expectedCount: number): string | undefined => {
  const messages = outputs
    .map((output, index) => (output.error ? `第 ${index + 1} 张：${output.error}` : ""))
    .filter(Boolean);
  if (outputs.length < expectedCount) {
    messages.unshift(`改图接口只返回了 ${outputs.length}/${expectedCount} 张图片。`);
  }
  return messages.length ? messages.join(" ") : undefined;
};

const parseRatio = (ratio: GenerationAspectRatio): number => {
  const [width, height] = ratio.split(":").map(Number);
  return width / height;
};

export const closestImageEditAspectRatio = (width: number, height: number): GenerationAspectRatio => {
  const sourceRatio = width / height;
  return generationAspectRatioOptions.reduce<GenerationAspectRatio>((best, option) => {
    const bestDelta = Math.abs(Math.log(sourceRatio / parseRatio(best)));
    const nextDelta = Math.abs(Math.log(sourceRatio / parseRatio(option.value)));
    return nextDelta < bestDelta ? option.value : best;
  }, "1:1");
};

export const imageEditResolutionForDimensions = (width: number, height: number): GenerationResolution => {
  const longestEdge = Math.max(width, height);
  if (longestEdge >= 2800) return "4k";
  if (longestEdge >= 1500) return "2k";
  return "1k";
};

export const imageEditSettingsFromSource = (
  sourceDataUrl: string,
  fallback: Pick<ImageEditCreateRequest["settings"], "apiMode" | "imageModel" | "mainModel" | "quality" | "outputFormat" | "outputCompression" | "moderation" | "background" | "n">
): ImageEditCreateRequest["settings"] => {
  const dimensions = parseGenerationOutputDimensions(sourceDataUrl);
  const resolution = dimensions ? imageEditResolutionForDimensions(dimensions.width, dimensions.height) : "1k";
  const aspectRatio = dimensions ? closestImageEditAspectRatio(dimensions.width, dimensions.height) : "1:1";
  return {
    ...fallback,
    resolution,
    aspectRatio,
    size: resolveGenerationSize(resolution, aspectRatio),
    n: clamp(Math.round(fallback.n || 1), 1, 4)
  };
};

const normalizeCreateRequest = (request: ImageEditCreateRequest): ImageEditCreateRequest => {
  if (!request.sourceImage.dataUrl.startsWith("data:image/")) throw new Error("请先导入一张可改图的源图。");
  if (!request.annotationImage.dataUrl.startsWith("data:image/")) throw new Error("请先完成标注后再开始改图。");
  const instruction = request.instruction.trim();
  const annotationItems = normalizeAnnotationItems(request.annotationItems);
  const fidelityMode = normalizeFidelityMode(request.fidelityMode);
  const hasLocalInstruction = annotationItems.some((item) => item.note && item.note !== "按总体改图说明处理此处。");
  if (!instruction && !hasLocalInstruction) {
    throw new Error("请填写总体改图说明，或至少为一处标注填写修改要求。");
  }
  if (fidelityMode === "strict_mask") {
    if (!annotationItems.length || request.annotationImage.itemCount <= 0) {
      throw new Error("严格保真模式至少需要 1 个编号标注，用于生成 alpha mask。");
    }
    if (!request.maskImage?.dataUrl.startsWith("data:image/")) {
      throw new Error("严格保真模式需要同尺寸 alpha mask PNG。");
    }
  }
  const sourceDimensions = parseGenerationOutputDimensions(request.sourceImage.dataUrl);
  const normalizedSize = normalizeGenerationSizeSettings(request.settings);
  const requestedSize = String(request.settings.size ?? "").trim();
  const sourceExactSize = sourceDimensions ? `${sourceDimensions.width}x${sourceDimensions.height}` : "";
  const shouldKeepSourceExactSize =
    fidelityMode === "reference" &&
    request.pixelProtectionEnabled !== false &&
    Boolean(request.localProtectionMaskImage?.dataUrl) &&
    requestedSize === sourceExactSize;
  const normalizedRequestSize = shouldKeepSourceExactSize ? sourceExactSize : normalizedSize.size;
  const maskDimensions = request.maskImage?.dataUrl ? parseGenerationOutputDimensions(request.maskImage.dataUrl) : null;
  const localMaskDimensions = request.localProtectionMaskImage?.dataUrl
    ? parseGenerationOutputDimensions(request.localProtectionMaskImage.dataUrl)
    : null;
  if (fidelityMode === "strict_mask" && sourceDimensions && maskDimensions) {
    if (sourceDimensions.width !== maskDimensions.width || sourceDimensions.height !== maskDimensions.height) {
      throw new Error("严格保真模式的源图和 mask 必须同尺寸。");
    }
  }
  return {
    ...request,
    fidelityMode,
    instruction,
    annotationItems,
    sourceImage: {
      ...request.sourceImage,
      mimeType: dataUrlToBuffer(request.sourceImage.dataUrl).mimeType,
      width: request.sourceImage.width || sourceDimensions?.width,
      height: request.sourceImage.height || sourceDimensions?.height
    },
    annotationImage: {
      ...request.annotationImage,
      mimeType: dataUrlToBuffer(request.annotationImage.dataUrl).mimeType,
      itemCount: Math.max(Math.round(request.annotationImage.itemCount || 0), 0)
    },
    maskImage: request.maskImage
      ? {
          ...request.maskImage,
          mimeType: dataUrlToBuffer(request.maskImage.dataUrl).mimeType,
          width: request.maskImage.width || maskDimensions?.width,
          height: request.maskImage.height || maskDimensions?.height,
          itemCount: Math.max(Math.round(request.maskImage.itemCount || 0), 0)
        }
      : undefined,
    localProtectionMaskImage: request.localProtectionMaskImage
      ? {
          ...request.localProtectionMaskImage,
          purpose: "local_protection",
          mimeType: dataUrlToBuffer(request.localProtectionMaskImage.dataUrl).mimeType,
          width: request.localProtectionMaskImage.width || localMaskDimensions?.width,
          height: request.localProtectionMaskImage.height || localMaskDimensions?.height,
          itemCount: Math.max(Math.round(request.localProtectionMaskImage.itemCount || 0), 0),
          stats: {
            ...request.localProtectionMaskImage.stats,
            width: request.localProtectionMaskImage.stats?.width || request.localProtectionMaskImage.width || localMaskDimensions?.width,
            height: request.localProtectionMaskImage.stats?.height || request.localProtectionMaskImage.height || localMaskDimensions?.height,
            itemCount: Math.max(Math.round(request.localProtectionMaskImage.stats?.itemCount || request.localProtectionMaskImage.itemCount || 0), 0)
          }
        }
      : undefined,
    pixelProtectionEnabled: request.pixelProtectionEnabled !== false,
    settings: {
      ...request.settings,
      ...normalizedSize,
      size: normalizedRequestSize,
      outputFormat: request.settings.outputFormat || "png",
      outputCompression: sanitizeImageEditOutputCompression(request.settings),
      n: clamp(Math.round(request.settings.n || 1), 1, 4)
    }
  };
};

export class ImageEditService {
  private readonly concurrency: number;
  private readonly runner: ImageEditTaskRunner;
  private readonly usesInjectedRunner: boolean;
  private abortControllers = new Map<string, AbortController>();
  private isQueuePumpActive = false;
  private taskMutationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly rootDir: string, options: ImageEditServiceOptions = {}) {
    this.concurrency = clamp(Math.round(options.concurrency || 2), 1, 8);
    this.runner = options.runner || ((task, signal) => this.runImageEditModel(task, signal));
    this.usesInjectedRunner = Boolean(options.runner);
  }

  private imageEditDir(): string {
    return join(this.rootDir, "image-edit");
  }

  private tasksPath(): string {
    return join(this.imageEditDir(), "tasks.json");
  }

  private generationConfigPath(): string {
    return join(this.rootDir, "generation", "config.json");
  }

  private assetsDir(taskId: string): string {
    return join(this.imageEditDir(), "assets", taskId);
  }

  private async writeAsset(taskId: string, fileName: string, dataUrl: string): Promise<string> {
    const { buffer, mimeType } = dataUrlToBuffer(dataUrl);
    const fileNameWithExtension = fileName.includes(".") ? fileName : `${fileName}.${imageExtension(mimeType)}`;
    await mkdir(this.assetsDir(taskId), { recursive: true });
    await writeFile(join(this.assetsDir(taskId), fileNameWithExtension), buffer);
    return fileNameWithExtension;
  }

  private async readAssetDataUrl(taskId: string, fileName: string, mimeType: string): Promise<string> {
    const buffer = await readFile(join(this.assetsDir(taskId), fileName));
    return dataUrlFromBuffer(buffer, mimeType);
  }

  private stripTaskAssets(task: ImageEditTask): StoredImageEditTask {
    const { dataUrl: _sourceDataUrl, ...sourceImage } = task.sourceImage;
    const { dataUrl: _annotationDataUrl, ...annotationImage } = task.annotationImage;
    const maskImage = task.maskImage
      ? (({ dataUrl: _maskDataUrl, ...metadata }) => ({
          ...metadata,
          assetFileName: metadata.assetFileName || "mask.png"
        }))(task.maskImage)
      : undefined;
    const localProtectionMaskImage = task.localProtectionMaskImage
      ? (({ dataUrl: _localMaskDataUrl, ...metadata }) => ({
          ...metadata,
          purpose: "local_protection" as const,
          assetFileName: metadata.assetFileName || "local-protection-mask.png"
        }))(task.localProtectionMaskImage)
      : undefined;
    return {
      ...task,
      fidelityMode: normalizeFidelityMode(task.fidelityMode),
      sourceImage: {
        ...sourceImage,
        assetFileName: sourceImage.assetFileName || "source.png"
      },
      annotationImage: {
        ...annotationImage,
        assetFileName: annotationImage.assetFileName || "annotation.png"
      },
      maskImage,
      localProtectionMaskImage,
      outputs: task.outputs.map((output, index) => {
        const { dataUrl: _outputDataUrl, protectedVariant, ...metadata } = output;
        const storedProtectedVariant = protectedVariant
          ? (({ dataUrl: _variantDataUrl, ...variantMetadata }) => ({
              ...variantMetadata,
              assetFileName:
                variantMetadata.assetFileName || `output-${String(index + 1).padStart(2, "0")}-pixel-protected.png`
            }))(protectedVariant)
          : undefined;
        return {
          ...metadata,
          assetFileName: metadata.assetFileName || `output-${String(index + 1).padStart(2, "0")}.png`,
          protectedVariant: storedProtectedVariant
        };
      })
    };
  }

  private async hydrateTask(task: StoredImageEditTask): Promise<ImageEditTask> {
    const sourceDataUrl = await this.readAssetDataUrl(task.id, task.sourceImage.assetFileName, task.sourceImage.mimeType).catch(
      () => ""
    );
    const annotationDataUrl = await this.readAssetDataUrl(
      task.id,
      task.annotationImage.assetFileName,
      task.annotationImage.mimeType
    ).catch(() => "");
    const maskDataUrl = task.maskImage
      ? await this.readAssetDataUrl(task.id, task.maskImage.assetFileName, task.maskImage.mimeType).catch(() => "")
      : "";
    const localProtectionMaskDataUrl = task.localProtectionMaskImage
      ? await this.readAssetDataUrl(
          task.id,
          task.localProtectionMaskImage.assetFileName,
          task.localProtectionMaskImage.mimeType
        ).catch(() => "")
      : "";
    const outputs = await Promise.all(
      task.outputs.map(async (output) => {
        const protectedVariant = output.protectedVariant
          ? {
              ...output.protectedVariant,
              dataUrl: await this.readAssetDataUrl(
                task.id,
                output.protectedVariant.assetFileName,
                output.protectedVariant.mimeType
              ).catch(() => "")
            }
          : undefined;
        return {
          ...output,
          dataUrl: await this.readAssetDataUrl(task.id, output.assetFileName, output.mimeType).catch(() => ""),
          protectedVariant
        };
      })
    );
    return {
      ...task,
      fidelityMode: normalizeFidelityMode(task.fidelityMode),
      annotationItems: normalizeAnnotationItems(task.annotationItems),
      sourceImage: {
        ...task.sourceImage,
        dataUrl: sourceDataUrl
      },
      annotationImage: {
        ...task.annotationImage,
        dataUrl: annotationDataUrl
      },
      maskImage: task.maskImage
        ? {
            ...task.maskImage,
            dataUrl: maskDataUrl
          }
        : undefined,
      localProtectionMaskImage: task.localProtectionMaskImage
        ? {
            ...task.localProtectionMaskImage,
            purpose: "local_protection",
            dataUrl: localProtectionMaskDataUrl
          }
        : undefined,
      outputs
    };
  }

  async getTasks(): Promise<ImageEditTask[]> {
    return Promise.all((await this.reconcileStaleRunningTasks(await this.readTasks())).map((task) => this.hydrateTask(task)));
  }

  async createTask(request: ImageEditCreateRequest): Promise<ImageEditTask> {
    const normalized = normalizeCreateRequest(request);
    const backend = this.usesInjectedRunner ? null : await this.getEffectiveBackend();
    if (normalized.fidelityMode === "strict_mask" && backend) {
      const capability = imageEditMaskCapabilityForBackend(backend);
      if (!capability.supportsMaskEdit) {
        throw new Error(
          capability.maskEditUnavailableReason ||
            "当前后端不支持 mask 严格编辑，请切换到 OpenAI-compatible Images 后端，或继续使用参考生成模式。"
        );
      }
    }
    const now = new Date().toISOString();
    const taskId = randomUUID();
    const sourceAssetFileName = await this.writeAsset(taskId, "source", normalized.sourceImage.dataUrl);
    const annotationAssetFileName = await this.writeAsset(taskId, "annotation", normalized.annotationImage.dataUrl);
    const maskAssetFileName = normalized.maskImage
      ? await this.writeAsset(taskId, "mask", normalized.maskImage.dataUrl)
      : undefined;
    const localProtectionMaskAssetFileName = normalized.localProtectionMaskImage
      ? await this.writeAsset(taskId, "local-protection-mask", normalized.localProtectionMaskImage.dataUrl)
      : undefined;
    const settings = backend
      ? {
          ...normalized.settings,
          apiMode:
            backend.authSource === "codex_oauth"
              ? "responses"
              : backend.providerType === "openrouter"
                ? "images"
                : backend.apiMode,
          imageModel: backend.imageModel,
          mainModel: backend.mainModel
        }
      : normalized.settings;
    const backendSnapshot = backend ? backendSnapshotForTask(backend) : undefined;
    const task: ImageEditTask = {
      id: taskId,
      createdAt: now,
      updatedAt: now,
      status: "queued",
      visibility: "active",
      sourceImage: {
        ...normalized.sourceImage,
        assetFileName: sourceAssetFileName
      },
      annotationImage: {
        ...normalized.annotationImage,
        assetFileName: annotationAssetFileName
      },
      maskImage: normalized.maskImage
        ? {
            ...normalized.maskImage,
            assetFileName: maskAssetFileName
          }
        : undefined,
      localProtectionMaskImage: normalized.localProtectionMaskImage
        ? {
            ...normalized.localProtectionMaskImage,
            assetFileName: localProtectionMaskAssetFileName
          }
        : undefined,
      annotationItems: normalized.annotationItems || [],
      fidelityMode: normalized.fidelityMode || "reference",
      pixelProtectionEnabled: normalized.pixelProtectionEnabled !== false,
      instruction: normalized.instruction,
      finalPrompt: buildImageEditFinalPrompt(
        normalized.instruction,
        settings.size,
        normalized.annotationItems || [],
        normalized.fidelityMode
      ),
      settings,
      backend: backendSnapshot,
      diagnostics: diagnosticsForTask(normalized, backend, backendSnapshot),
      outputs: []
    };
    await this.upsertTask(task);
    this.scheduleQueueProcessing();
    return task;
  }

  async cancelTask(id: string): Promise<ImageEditTask | null> {
    this.abortControllers.get(id)?.abort(new Error("已取消改图任务。"));
    const task = await this.mutateTasks(async (tasks) => {
      const taskIndex = tasks.findIndex((item) => item.id === id);
      if (taskIndex === -1) return { tasks, result: null };
      const task = tasks[taskIndex];
      if (task.status !== "queued" && task.status !== "running") {
        return { tasks, result: await this.hydrateTask(task) };
      }
      const now = new Date().toISOString();
      const canceledTask: StoredImageEditTask = {
        ...task,
        status: "canceled",
        updatedAt: now,
        completedAt: now,
        error: "已取消改图任务。"
      };
      const nextTasks = [...tasks];
      nextTasks[taskIndex] = canceledTask;
      return { tasks: nextTasks, result: await this.hydrateTask(canceledTask) };
    });
    this.scheduleQueueProcessing();
    return task;
  }

  async retryTask(id: string): Promise<ImageEditTask> {
    const sourceTask = (await this.getTasks()).find((task) => task.id === id);
    if (!sourceTask) throw new Error("没有找到要重试的改图任务。");
    if (sourceTask.status === "queued" || sourceTask.status === "running") {
      throw new Error("排队中或改图中的任务不能重复提交。");
    }
    return this.createTask({
      sourceImage: {
        ...sourceTask.sourceImage,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        sourcePointer: {
          kind: "restored_edit_output",
          imageEditTaskId: sourceTask.id,
          importedAt: new Date().toISOString()
        }
      },
      annotationImage: {
        ...sourceTask.annotationImage,
        createdAt: new Date().toISOString()
      },
      maskImage: sourceTask.maskImage
        ? {
            ...sourceTask.maskImage,
            createdAt: new Date().toISOString()
          }
        : undefined,
      localProtectionMaskImage: sourceTask.localProtectionMaskImage
        ? {
            ...sourceTask.localProtectionMaskImage,
            purpose: "local_protection",
            createdAt: new Date().toISOString()
          }
        : undefined,
      annotationItems: sourceTask.annotationItems,
      fidelityMode: sourceTask.fidelityMode,
      pixelProtectionEnabled: sourceTask.pixelProtectionEnabled !== false,
      instruction: sourceTask.instruction,
      settings: sourceTask.settings
    });
  }

  async restoreTask(id: string): Promise<ImageEditTask | null> {
    return (await this.getTasks()).find((task) => task.id === id) || null;
  }

  async updateTaskVisibility(update: ImageEditTaskVisibilityUpdate): Promise<ImageEditTask[]> {
    const tasks = await this.mutateTasks((tasks) => {
      const taskIndex = tasks.findIndex((item) => item.id === update.id);
      if (taskIndex === -1) return { tasks, result: tasks };
      const task = tasks[taskIndex];
      if ((task.status === "queued" || task.status === "running") && update.visibility !== "active") {
        throw new Error("排队中或改图中的任务需要先完成或取消后，才能归档或隐藏。");
      }
      const now = new Date().toISOString();
      const nextTask: StoredImageEditTask = {
        ...task,
        visibility: normalizeTaskVisibility(update.visibility),
        archivedAt: update.visibility === "archived" ? now : task.archivedAt,
        hiddenAt: update.visibility === "hidden" ? now : task.hiddenAt,
        updatedAt: now
      };
      if (update.visibility === "active") {
        nextTask.archivedAt = undefined;
        nextTask.hiddenAt = undefined;
      }
      const nextTasks = [...tasks];
      nextTasks[taskIndex] = nextTask;
      return { tasks: nextTasks, result: nextTasks };
    });
    return Promise.all(tasks.map((task) => this.hydrateTask(task)));
  }

  async deleteTask(id: string): Promise<ImageEditTask[]> {
    this.abortControllers.get(id)?.abort(new Error("已删除改图任务。"));
    this.abortControllers.delete(id);
    await rm(this.assetsDir(id), { recursive: true, force: true });
    const tasks = await this.mutateTasks((currentTasks) => {
      const nextTasks = currentTasks.filter((task) => task.id !== id);
      return { tasks: nextTasks, result: nextTasks };
    });
    this.scheduleQueueProcessing();
    return Promise.all(tasks.map((task) => this.hydrateTask(task)));
  }

  async clearTasks(): Promise<void> {
    for (const controller of this.abortControllers.values()) {
      controller.abort(new Error("已清空改图任务。"));
    }
    this.abortControllers.clear();
    await rm(this.imageEditDir(), { recursive: true, force: true });
    await this.writeTasks([]);
  }

  async clearAll(): Promise<void> {
    await this.clearTasks();
  }

  async saveProtectedVariant(request: ImageEditProtectedVariantSaveRequest): Promise<ImageEditTask> {
    if (!request.taskId || !request.outputId) throw new Error("缺少改图任务或输出标识。");
    if (!request.dataUrl.startsWith("data:image/")) throw new Error("本地保护版必须是有效图片。");
    const now = new Date().toISOString();
    const task = await this.mutateTasks(async (tasks) => {
      const taskIndex = tasks.findIndex((item) => item.id === request.taskId);
      if (taskIndex === -1) throw new Error("没有找到要保存本地保护版的改图任务。");
      const sourceTask = tasks[taskIndex];
      if (sourceTask.status === "queued" || sourceTask.status === "running") {
        throw new Error("改图任务仍在运行，暂不能保存本地保护版。");
      }
      const outputIndex = sourceTask.outputs.findIndex((output) => output.id === request.outputId);
      if (outputIndex === -1) throw new Error("没有找到要绑定本地保护版的改图输出。");
      const assetFileName = await this.writeAsset(
        sourceTask.id,
        `output-${String(outputIndex + 1).padStart(2, "0")}-pixel-protected`,
        request.dataUrl
      );
      const { mimeType } = dataUrlToBuffer(request.dataUrl);
      const outputs = sourceTask.outputs.map((output, index) =>
        index === outputIndex
          ? {
              ...output,
              protectedVariantUnavailableReason: undefined,
              protectedVariant: {
                kind: "pixel_protected" as const,
                mimeType: request.mimeType || mimeType,
                width: request.width,
                height: request.height,
                assetFileName,
                createdAt: now,
                warnings: Array.isArray(request.warnings) ? request.warnings.slice(0, 10) : []
              }
            }
          : output
      );
      const nextTask: StoredImageEditTask = {
        ...sourceTask,
        outputs,
        updatedAt: now
      };
      const nextTasks = [...tasks];
      nextTasks[taskIndex] = nextTask;
      return { tasks: nextTasks, result: nextTask };
    });
    return this.hydrateTask(task);
  }

  async saveOutputs(_request: ImageEditOutputsSaveRequest): Promise<never> {
    throw new Error("改图输出保存尚未完成接入。");
  }

  private scheduleQueueProcessing(): void {
    void this.processQueue().catch(() => undefined);
  }

  private async processQueue(): Promise<void> {
    if (this.isQueuePumpActive) return;
    this.isQueuePumpActive = true;
    try {
      while (true) {
        const availableSlots = this.concurrency - this.abortControllers.size;
        if (availableSlots <= 0) return;
        const tasks = await this.reconcileStaleRunningTasks(await this.readTasks());
        const queuedTasks = tasks
          .filter((task) => task.status === "queued")
          .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
          .slice(0, availableSlots);
        if (!queuedTasks.length) return;
        for (const queuedTask of queuedTasks) {
          await this.startQueuedTask(queuedTask);
        }
      }
    } finally {
      this.isQueuePumpActive = false;
      const tasks = await this.readTasks().catch(() => []);
      if (tasks.some((task) => task.status === "queued") && this.abortControllers.size < this.concurrency) {
        this.scheduleQueueProcessing();
      }
    }
  }

  private async startQueuedTask(task: StoredImageEditTask): Promise<void> {
    const latestTask = (await this.readTasks()).find((item) => item.id === task.id);
    if (!latestTask || latestTask.status !== "queued") return;
    const now = new Date().toISOString();
    const runningTask: StoredImageEditTask = {
      ...latestTask,
      status: "running",
      startedAt: latestTask.startedAt || now,
      updatedAt: now,
      error: undefined
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error("改图请求超过 10 分钟未响应，请检查后端或稍后重试。"));
    }, IMAGE_EDIT_TIMEOUT_MS);
    this.abortControllers.set(runningTask.id, controller);
    await this.writeStoredTask(runningTask);

    void this.runQueuedTask(runningTask, controller, timeout);
  }

  private async runQueuedTask(
    task: StoredImageEditTask,
    controller: AbortController,
    timeout: NodeJS.Timeout
  ): Promise<void> {
    const hydratedTask = await this.hydrateTask(task);
    try {
      const results = await this.runner(hydratedTask, controller.signal);
      const now = new Date().toISOString();
      const outputs: ImageEditOutput[] = [];
      for (const [index, result] of results.entries()) {
        const outputId = randomUUID();
        const assetFileName = await this.writeAsset(task.id, `output-${String(index + 1).padStart(2, "0")}`, result.dataUrl);
        outputs.push({
          ...result,
          id: outputId,
          createdAt: now,
          assetFileName
        });
      }
      const finishedTask: ImageEditTask = {
        ...hydratedTask,
        outputs,
        status:
          outputs.length >= task.settings.n && !summarizeOutputProblems(outputs, task.settings.n)
            ? "succeeded"
            : outputs.length
              ? "partial_failed"
              : "failed",
        error: summarizeOutputProblems(outputs, task.settings.n),
        updatedAt: now,
        completedAt: now
      };
      await this.upsertTask(finishedTask);
    } catch (error) {
      const now = new Date().toISOString();
      const failedTask: ImageEditTask = {
        ...hydratedTask,
        status: controller.signal.aborted ? "canceled" : "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: now,
        completedAt: now
      };
      await this.upsertTask(failedTask);
    } finally {
      clearTimeout(timeout);
      this.abortControllers.delete(task.id);
      this.scheduleQueueProcessing();
    }
  }

  private async readTasks(): Promise<StoredImageEditTask[]> {
    const tasks = await readJsonFile<StoredImageEditTask[]>(this.tasksPath(), []);
    return Array.isArray(tasks) ? tasks : [];
  }

  private async getEffectiveBackend(): Promise<EffectiveImageEditBackend> {
    const stored = await readJsonFile<StoredGenerationConfigForImageEdit>(this.generationConfigPath(), {});
    const backend = normalizeStoredImageEditBackend(stored);
    if (backend.authSource === "codex_oauth") {
      const status = await getCodexAuthStatus();
      if (!status.available) {
        throw new Error(`请先完成 Codex OAuth 登录：运行 codex login 后再试。${status.error ? `（${status.error}）` : ""}`);
      }
      return backend;
    }
    if (!backend.apiKey.trim()) throw new Error("请先在生图配置中填写可用于改图的 API Key。");
    return backend;
  }

  private async runImageEditModel(task: ImageEditTask, signal: AbortSignal): Promise<ImageEditRunnerOutput[]> {
    const backend = await this.getEffectiveBackend();
    const settings = toGenerationSettings(task.settings);
    const fidelityMode = normalizeFidelityMode(task.fidelityMode);

    if (fidelityMode === "strict_mask") {
      const capability = imageEditMaskCapabilityForBackend(backend);
      if (!capability.supportsMaskEdit) {
        throw new Error(
          capability.maskEditUnavailableReason ||
            "当前后端不支持 mask 严格编辑，请切换到 OpenAI-compatible Images 后端，或继续使用参考生成模式。"
        );
      }
      if (!task.maskImage?.dataUrl?.startsWith("data:image/")) {
        throw new Error("严格保真模式缺少 alpha mask PNG，请重新提交任务。");
      }
      const text = await requestMaskedEditForm(
        generationEndpoint(backend.apiBaseUrl, "images/edits"),
        backend.apiKey,
        task.finalPrompt,
        settings,
        task.sourceImage.dataUrl,
        task.maskImage.dataUrl,
        signal
      );
      return parseImagesResponse(text, backend.apiKey, settings);
    }

    const referenceImages = [task.sourceImage.dataUrl, task.annotationImage.dataUrl].filter((dataUrl) =>
      dataUrl.startsWith("data:image/")
    );

    if (backend.authSource === "codex_oauth") {
      let authState = await loadCodexAuthState();
      const results: ImageEditRunnerOutput[] = [];
      for (let index = 0; index < task.settings.n; index += 1) {
        const response = await requestCodexResponses(
          buildCodexResponsesPayload(task.finalPrompt, settings, referenceImages),
          authState,
          signal
        );
        authState = response.authState;
        results.push(...parseResponsesImageResponse(response.text, settings));
      }
      return results.slice(0, task.settings.n);
    }

    if (backend.providerType === "openrouter") {
      return requestOpenRouterImageEdit(backend, task.finalPrompt, settings, referenceImages, signal);
    }

    if (backend.apiMode === "responses") {
      const results: ImageEditRunnerOutput[] = [];
      for (let index = 0; index < task.settings.n; index += 1) {
        const text = await requestJson(
          generationEndpoint(backend.apiBaseUrl, "responses"),
          backend.apiKey,
          buildResponsesPayload(task.finalPrompt, settings, referenceImages),
          signal,
          "text/event-stream"
        );
        results.push(...parseResponsesImageResponse(text, settings));
      }
      return results.slice(0, task.settings.n);
    }

    const text = await requestEditForm(
      generationEndpoint(backend.apiBaseUrl, "images/edits"),
      backend.apiKey,
      task.finalPrompt,
      settings,
      referenceImages,
      signal
    );
    return parseImagesResponse(text, backend.apiKey, settings);
  }

  private async reconcileStaleRunningTasks(tasks: StoredImageEditTask[]): Promise<StoredImageEditTask[]> {
    let changed = false;
    const now = new Date().toISOString();
    const next = tasks.map((task) => {
      if (task.status !== "running" || this.abortControllers.has(task.id)) return task;
      changed = true;
      return {
        ...task,
        status: "failed" as const,
        updatedAt: now,
        completedAt: now,
        error: task.error || "应用或改图进程已重启，这条运行中的任务未完成，请重试。"
      };
    });
    if (changed) await this.writeTasks(next);
    return next;
  }

  private async writeTasks(tasks: StoredImageEditTask[]): Promise<void> {
    await mkdir(this.imageEditDir(), { recursive: true });
    await writeJsonFile(this.tasksPath(), tasks.slice(0, MAX_STORED_TASKS));
  }

  private async mutateTasks<Result>(
    mutation:
      | ((tasks: StoredImageEditTask[]) => { tasks: StoredImageEditTask[]; result: Result })
      | ((tasks: StoredImageEditTask[]) => Promise<{ tasks: StoredImageEditTask[]; result: Result }>)
  ): Promise<Result> {
    const runMutation = this.taskMutationQueue.then(async () => {
      const currentTasks = await this.readTasks();
      const { tasks, result } = await mutation(currentTasks);
      await this.writeTasks(tasks);
      return result;
    });
    this.taskMutationQueue = runMutation.then(
      () => undefined,
      () => undefined
    );
    return runMutation;
  }

  private async upsertTask(task: ImageEditTask): Promise<void> {
    await this.writeStoredTask(this.stripTaskAssets(task));
  }

  private async writeStoredTask(task: StoredImageEditTask): Promise<void> {
    await this.mutateTasks((tasks) => {
      const next = [task, ...tasks.filter((item) => item.id !== task.id)].slice(0, MAX_STORED_TASKS);
      return { tasks: next, result: undefined };
    });
  }
}

export const buildImageEditFinalPrompt = (
  instruction: string,
  size: string,
  annotationItems: ImageEditAnnotationItem[] = [],
  fidelityMode: ImageEditFidelityMode = "reference"
): string => {
  const normalizedItems = normalizeAnnotationItems(annotationItems);
  const itemLines = normalizedItems.map((item) => {
    const position = item.positionHint ? `，${item.positionHint}` : "";
    return `${item.label}（${annotationToolLabel(item.tool)}${position}）：${item.note}`;
  });
  const isStrictMask = normalizeFidelityMode(fidelityMode) === "strict_mask";
  return [
    isStrictMask ? "请根据源图、alpha mask 和编号修改清单完成一次单源图严格局部改图。" : "请根据源图和标注层完成一次单源图改图。",
    isStrictMask
      ? "严格 mask 模式下，alpha mask 的透明区域是允许编辑区，不透明区域必须按源图保留；编号定位图只用于任务预览和下方文字清单，不作为模型图像输入。"
      : "干净源图是主体、构图、纹理、文字和细节的唯一依据；标注层图片只是低遮挡定位图，不能用它替代或覆盖源图细节。",
    `总体改图说明：${instruction.trim() || "无额外总体说明，严格按编号标注项处理。"}`,
    normalizedItems.length
      ? "标注层中的编号圆点、箭头和框选都是临时定位标记；每个编号只对应下方同编号修改要求，必须逐项对应执行，不要交换位置、不要把一个编号的要求应用到另一个编号。"
      : "",
    normalizedItems.length ? ["编号标注修改清单：", ...itemLines].join("\n") : "",
    "必须保留源图的主要主体、构图关系、整体风格、视角和画幅比例。",
    "未被编号标注覆盖的区域必须按干净源图保留，不要做美化、磨皮、锐化、补纹理、改光影或重绘。",
    "人物脸部、五官、发际线、手臂、手部和所有裸露皮肤属于高保真保护区域；除非同编号修改要求明确点名，否则保持源图肤色、肤质、平滑度、阴影过渡和身份细节。",
    "如果标注靠近人物但修改对象是背景、道具或文字，只修改对应背景、道具或文字，不改变人物皮肤、脸部和肢体结构。",
    "只应用标注层和用户文字说明指向的修改，不要扩展成无关重绘。",
    "负面约束：不要新增斑驳暗纹、网格纹、水印感纹理、脏污颗粒、异常局部阴影、塑料皮肤、蜡像质感、过度磨皮或锐化噪点。",
    "最终输出必须是干净修订图：移除所有编号圆点、箭头、批注文字、框选线、选择边框、光标、工具栏和任何标注 UI 痕迹。",
    `输出画布目标尺寸为 ${size} 像素。`
  ]
    .filter(Boolean)
    .join("\n");
};

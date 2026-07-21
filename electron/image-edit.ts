import { createHash, randomUUID } from "node:crypto";
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
  ImageEditAnnotationResolution,
  ImageEditCreateRequest,
  ImageEditDiagnostics,
  ImageEditLocalProtectionMaskImage,
  ImageEditMaskImage,
  ImageEditModelInputImage,
  ImageEditOutput,
  ImageEditOutputVariant,
  ImageEditOriginReference,
  ImageEditOutputsSaveRequest,
  ImageEditTask,
  ImageEditTaskSummary,
  ImageEditStoredFidelityMode,
  ImageEditTaskVisibility,
  ImageEditTaskVisibilityUpdate
} from "../src/shared/types";
import { WORKSPACE_CAPACITY_REACHED, WORKSPACE_CONCURRENCY_LIMIT } from "../src/shared/workspace-concurrency";
import {
  assertConfirmedAnnotationResolution,
  buildOriginRegenerationPrompt,
  normalizeOriginAnnotationItems
} from "../src/shared/image-edit-regeneration";
import {
  generationAspectRatioOptions,
  normalizeGenerationSizeSettings,
  resolveGenerationSize
} from "../src/shared/generation-size";
import { CodexAuthState, getCodexAuthStatus, loadCodexAuthState, refreshCodexAuthState } from "./codex-auth";
import { buildCodexHeaders } from "./codex-request";
import { sanitizePublicError as sanitizeSummaryError } from "./error-sanitizer";
import {
  buildChatCompletionsImagePayload,
  buildCodexResponsesPayload,
  buildGeminiImagePayload,
  buildImagesGenerationPayload,
  buildOpenRouterImagesPayload,
  buildResponsesPayload,
  generationEndpoint,
  openRouterImagesEndpoint,
  parseGenerationOutputDimensions,
  parseChatCompletionsImageResponse,
  parseGeminiImageResponse,
  parseImagesResponse,
  parseOpenRouterImagesResponse,
  parseResponsesImageResponse
} from "./generation";
import type { GenerationExecutionBackend } from "./generation";
import {
  geminiGenerateContentEndpoint,
  isGoogleGeminiEndpoint,
  ModelHttpError,
  readJsonFile,
  visionRequestHeaders,
  writeJsonFile
} from "./main-utils";

type ImageEditRunnerOutput = Omit<ImageEditOutput, "id" | "createdAt" | "assetFileName">;
type ImageEditTaskRunner = (task: ImageEditTask, signal: AbortSignal) => Promise<ImageEditRunnerOutput[]>;

export type ImageEditBackendResolver = (
  providerId?: string,
  snapshot?: ImageEditTask["backend"]
) => Promise<GenerationExecutionBackend>;

export interface ImageEditServiceOptions {
  concurrency?: number;
  runner?: ImageEditTaskRunner;
  backendResolver?: ImageEditBackendResolver;
}

interface EffectiveImageEditBackend {
  authSource: GenerationAuthSource;
  providerId?: string;
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

type StoredImageEditSourceImage = Omit<ImageEditTask["sourceImage"], "dataUrl" | "thumbnailDataUrl"> & { assetFileName: string };
type StoredImageEditModelInputImage = Omit<ImageEditModelInputImage, "dataUrl"> & { assetFileName: string };
type StoredImageEditAnnotationImage = Omit<ImageEditTask["annotationImage"], "dataUrl" | "thumbnailDataUrl"> & { assetFileName: string };
type StoredImageEditMaskImage = Omit<ImageEditMaskImage, "dataUrl" | "thumbnailDataUrl"> & { assetFileName: string };
type StoredImageEditLocalProtectionMaskImage = Omit<ImageEditLocalProtectionMaskImage, "dataUrl" | "thumbnailDataUrl"> & { assetFileName: string };
type StoredImageEditOutputVariant = Omit<ImageEditOutputVariant, "dataUrl"> & { assetFileName: string };
type StoredImageEditOutput = Omit<ImageEditOutput, "dataUrl" | "protectedVariant"> & {
  assetFileName: string;
  protectedVariant?: StoredImageEditOutputVariant;
};
type StoredImageEditOriginReference = Omit<ImageEditOriginReference, "dataUrl" | "thumbnailDataUrl"> & {
  assetFileName: string;
};
type StoredImageEditTask = Omit<
  ImageEditTask,
  | "sourceImage"
  | "modelInputImage"
  | "annotationImage"
  | "maskImage"
  | "localProtectionMaskImage"
  | "regenerationContext"
  | "outputs"
> & {
  sourceImage: StoredImageEditSourceImage;
  modelInputImage?: StoredImageEditModelInputImage;
  annotationImage: StoredImageEditAnnotationImage;
  maskImage?: StoredImageEditMaskImage;
  localProtectionMaskImage?: StoredImageEditLocalProtectionMaskImage;
  regenerationContext?: Omit<NonNullable<ImageEditTask["regenerationContext"]>, "originalReferences"> & {
    originalReferences: StoredImageEditOriginReference[];
  };
  outputs: StoredImageEditOutput[];
};

const IMAGE_EDIT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STORED_TASKS = 80;
const DEFAULT_MAIN_MODEL = "gpt-5.5";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_IMAGE_MODEL = "openai/gpt-image-2";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const MAX_IMAGE_EDIT_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_EDIT_SOURCE_PIXELS = 12_000_000;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const isActiveTask = (task: Pick<ImageEditTask, "status">): boolean =>
  task.status === "queued" || task.status === "running";

const capacityError = (): Error & { code: typeof WORKSPACE_CAPACITY_REACHED } =>
  Object.assign(new Error(`改图工作区最多同时保留 ${WORKSPACE_CONCURRENCY_LIMIT} 个进行中的任务。`), {
    code: WORKSPACE_CAPACITY_REACHED
  });

const normalizeTaskVisibility = (value: ImageEditTaskVisibility | undefined): ImageEditTaskVisibility =>
  value === "archived" || value === "hidden" ? value : "active";

const normalizeAnnotationTool = (tool: ImageEditAnnotationItem["tool"] | undefined): ImageEditAnnotationItem["tool"] =>
  tool === "arrow" || tool === "box" || tool === "text" ? tool : "brush";

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
        positionHint: item.positionHint?.trim().slice(0, 120) || undefined,
        geometry: item.geometry
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
  const encoded = match[3].replace(/\s/g, "");
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) {
    throw new Error("改图图片必须是有效的 base64 图片数据。");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new Error("改图图片数据为空。");
  return { mimeType: match[1] || "image/png", buffer };
};

type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

const sniffSupportedImageMimeType = (buffer: Buffer): SupportedImageMimeType | null => {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
};

const inspectImageDataUrl = (
  dataUrl: string,
  label: string,
  enforceSourceLimits = false
): {
  mimeType: SupportedImageMimeType;
  buffer: Buffer;
  width: number;
  height: number;
  size: string;
} => {
  const { buffer } = dataUrlToBuffer(dataUrl);
  const mimeType = sniffSupportedImageMimeType(buffer);
  if (!mimeType) throw new Error(`${label}必须是可解码的 PNG、JPEG 或 WebP 图片。`);
  const dimensions = parseGenerationOutputDimensions(dataUrlFromBuffer(buffer, mimeType));
  if (!dimensions) throw new Error(`${label}无法从图片字节解析真实尺寸。`);
  if (enforceSourceLimits && buffer.length > MAX_IMAGE_EDIT_SOURCE_BYTES) {
    throw new Error("改图源图原始数据超过 32MB，已拒绝且不会静默压缩。");
  }
  if (enforceSourceLimits && dimensions.width * dimensions.height > MAX_IMAGE_EDIT_SOURCE_PIXELS) {
    throw new Error("改图源图解码像素超过 1200 万，已拒绝且不会静默缩小。");
  }
  return { mimeType, buffer, ...dimensions };
};

const dataUrlFromBuffer = (buffer: Buffer, mimeType: string): string => `data:${mimeType};base64,${buffer.toString("base64")}`;

const imageExtension = (mimeType: string): "jpg" | "png" | "webp" => {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
};

const normalizeProviderType = (providerType: GenerationProviderType | undefined): GenerationProviderType =>
  providerType === "openrouter" ? "openrouter" : "openai_compatible";

const normalizeFidelityMode = (value: ImageEditStoredFidelityMode | undefined): ImageEditStoredFidelityMode =>
  value === "strict_mask" || value === "origin_regenerate" ? value : "reference";

export const imageEditAnnotationContentHash = (
  sourceDataUrl: string,
  annotationItems: ImageEditAnnotationItem[],
  instruction: string,
  basePrompt: string
): string => {
  const source = dataUrlToBuffer(sourceDataUrl).buffer;
  const normalizedItems = normalizeOriginAnnotationItems(annotationItems);
  return createHash("sha256")
    .update(source)
    .update("\0")
    .update(JSON.stringify(normalizedItems))
    .update("\0")
    .update(instruction.trim())
    .update("\0")
    .update(basePrompt.trim())
    .digest("hex");
};

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

const normalizeGenerationApiMode = (apiMode: GenerationApiMode | undefined): GenerationApiMode => {
  if (apiMode === "responses" || apiMode === "chat_completions" || apiMode === "gemini") return apiMode;
  return "images";
};

const normalizeStoredImageEditBackend = (
  stored: StoredGenerationConfigForImageEdit,
  requestedProviderId?: string
): EffectiveImageEditBackend | null => {
  const legacyApiKey = decryptStoredApiKey(stored);
  const providers = Array.isArray(stored.providers)
    ? stored.providers
        .map((provider, index): EffectiveImageEditBackend => {
          const providerType = normalizeProviderType(provider.providerType);
          return {
            providerId: provider.id?.trim() || `provider-${index + 1}`,
            authSource: "api",
            providerType,
            providerName:
              provider.name?.trim() ||
              (providerType === "openrouter" ? "OpenRouter" : index === 0 ? "默认 API 供应商" : `API 供应商 ${index + 1}`),
            apiBaseUrl:
              provider.apiBaseUrl?.trim() ||
              (providerType === "openrouter" ? DEFAULT_OPENROUTER_BASE_URL : "https://api.openai.com/v1"),
            apiKey: decryptStoredApiKey(provider),
            apiMode: providerType === "openrouter" ? "images" : normalizeGenerationApiMode(provider.apiMode),
            imageModel:
              provider.imageModel?.trim() ||
              (providerType === "openrouter" ? DEFAULT_OPENROUTER_IMAGE_MODEL : "gpt-image-2"),
            mainModel: normalizeMainModel(provider.mainModel)
          };
        })
        .filter((provider) => provider.providerId)
    : [];

  const activeProvider = requestedProviderId
    ? providers.find((provider) => provider.providerId === requestedProviderId)
    : providers.find((provider) => provider.providerId === stored.activeProviderId) || providers[0];
  if (activeProvider) {
    return {
      ...activeProvider,
      authSource: stored.authSource === "codex_oauth" ? "codex_oauth" : "api"
    };
  }

  if (requestedProviderId && providers.length) return null;

  const providerType = normalizeProviderType(stored.providerType);
  return {
    providerId: stored.activeProviderId,
    authSource: stored.authSource === "api" || legacyApiKey ? "api" : "codex_oauth",
    providerType,
    providerName: providerType === "openrouter" ? "OpenRouter" : "默认 API 供应商",
    apiBaseUrl:
      stored.apiBaseUrl?.trim() ||
      (providerType === "openrouter" ? DEFAULT_OPENROUTER_BASE_URL : "https://api.openai.com/v1"),
    apiKey: legacyApiKey,
    apiMode: providerType === "openrouter" ? "images" : normalizeGenerationApiMode(stored.apiMode),
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

export const forceOriginRegenerationResponsesAction = (payload: Record<string, unknown>): Record<string, unknown> => ({
  ...payload,
  tools: Array.isArray(payload.tools)
    ? payload.tools.map((tool) =>
        tool && typeof tool === "object" && (tool as { type?: string }).type === "image_generation"
          ? { ...(tool as Record<string, unknown>), action: "generate" }
          : tool
      )
    : payload.tools
});

const backendSnapshotForTask = (config: EffectiveImageEditBackend): ImageEditTask["backend"] => ({
  providerId: config.providerId,
  authSource: config.authSource,
  providerType: config.providerType,
  providerName: config.providerName,
  apiBaseUrl: config.authSource === "api" ? config.apiBaseUrl : undefined,
  apiMode: config.authSource === "codex_oauth" ? "responses" : config.providerType === "openrouter" ? "images" : config.apiMode,
  imageModel: config.imageModel,
  mainModel: config.mainModel
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
  _backendSnapshot: ImageEditTask["backend"] | undefined
): ImageEditDiagnostics => {
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
      width: request.sourceIntegrity?.width || request.sourceImage.width,
      height: request.sourceIntegrity?.height || request.sourceImage.height,
      mimeType: request.sourceIntegrity?.actualMimeType || request.sourceImage.mimeType
    },
    annotationImage: {
      width: parseGenerationOutputDimensions(request.annotationImage.dataUrl)?.width,
      height: parseGenerationOutputDimensions(request.annotationImage.dataUrl)?.height,
      itemCount: request.annotationImage.itemCount
    },
    regenerationInputStrategy: request.regenerationContext?.inputStrategy,
    originReferenceCount: request.regenerationContext?.originalReferences?.length || 0,
    annotationResolutionSource: request.annotationResolution?.source,
    annotationResolutionStatus: request.annotationResolution?.status,
    currentSourceSubmitted: false,
    annotationImageSubmitted: false
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
  accept = "application/json",
  authMode: "bearer" | "gemini" = "bearer"
): Promise<string> => {
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers:
      authMode === "gemini"
        ? { ...visionRequestHeaders("gemini", apiKey, url), Accept: accept }
        : {
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

const requestCodexResponses = async (
  payload: Record<string, unknown>,
  authState: CodexAuthState,
  signal: AbortSignal
): Promise<{ text: string; authState: CodexAuthState }> => {
  const request = async (state: CodexAuthState) => {
    const response = await fetch(CODEX_RESPONSES_URL, {
      method: "POST",
      signal,
      headers: buildCodexHeaders(state),
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
      return parseOpenRouterImagesResponse(text, backend.apiKey, settings);
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
  if (!request.annotationImage.dataUrl.startsWith("data:image/")) throw new Error("请先完成标注后再生成修订版。");
  if (request.fidelityMode && request.fidelityMode !== "origin_regenerate") {
    throw new Error("改图工作台现在只支持原始素材重生成修订版。");
  }
  const legacyRequest = request as ImageEditCreateRequest & {
    modelInputImage?: unknown;
    maskImage?: unknown;
    localProtectionMaskImage?: unknown;
  };
  if (legacyRequest.modelInputImage || legacyRequest.maskImage || legacyRequest.localProtectionMaskImage) {
    throw new Error("重生成修订版不得提交当前生成图的模型输入副本或任何 mask。");
  }

  const instruction = request.instruction.trim();
  const annotationItems = normalizeOriginAnnotationItems(request.annotationItems || []);
  const regenerationContext = request.regenerationContext;
  if (!regenerationContext?.basePrompt.trim()) {
    throw new Error("重生成修订版缺少第一次生图的基础提示词。");
  }
  const requestedOriginReferences = Array.isArray(regenerationContext.originalReferences)
    ? regenerationContext.originalReferences
    : [];
  if (requestedOriginReferences.length > 8) throw new Error("原始主体参考图最多允许 8 张。");

  const sourceAsset = inspectImageDataUrl(request.sourceImage.dataUrl, "canonical source", true);
  const annotationAsset = inspectImageDataUrl(request.annotationImage.dataUrl, "改图定位图");
  const normalizedReferences = requestedOriginReferences.map((reference, index) => {
    const asset = inspectImageDataUrl(reference.dataUrl, `原始主体参考图 ${index + 1}`, true);
    return {
      ...reference,
      name: reference.name.trim() || `原始主体参考图 ${index + 1}`,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteLength: asset.buffer.length,
      sha256: createHash("sha256").update(asset.buffer).digest("hex")
    };
  });
  const normalizedRegenerationContext = {
    ...regenerationContext,
    basePrompt: regenerationContext.basePrompt.trim(),
    sourceLabel: regenerationContext.sourceLabel.trim() || "手动重生成",
    inputStrategy: normalizedReferences.length > 0 ? ("original_references" as const) : ("text_only" as const),
    originalReferences: normalizedReferences
  };
  const expectedResolutionHash = imageEditAnnotationContentHash(
    request.sourceImage.dataUrl,
    annotationItems,
    instruction,
    normalizedRegenerationContext.basePrompt
  );
  const annotationResolution = assertConfirmedAnnotationResolution(
    request.annotationResolution,
    annotationItems,
    expectedResolutionHash
  );
  const normalizedSize = normalizeGenerationSizeSettings(request.settings);

  return {
    clientWorkflowId: request.clientWorkflowId,
    sourceImage: {
      ...request.sourceImage,
      mimeType: sourceAsset.mimeType,
      width: sourceAsset.width,
      height: sourceAsset.height
    },
    sourceIntegrity: {
      actualMimeType: sourceAsset.mimeType,
      byteLength: sourceAsset.buffer.length,
      width: sourceAsset.width,
      height: sourceAsset.height,
      pixelCount: sourceAsset.width * sourceAsset.height,
      sha256: createHash("sha256").update(sourceAsset.buffer).digest("hex"),
      canonicalBytesPreserved: true
    },
    annotationImage: {
      ...request.annotationImage,
      mimeType: annotationAsset.mimeType,
      itemCount: annotationItems.length
    },
    annotationItems,
    annotationResolution,
    regenerationContext: normalizedRegenerationContext,
    fidelityMode: "origin_regenerate",
    instruction,
    settings: {
      ...request.settings,
      ...normalizedSize,
      n: clamp(Math.round(request.settings.n || 1), 1, 4),
      outputCompression: sanitizeImageEditOutputCompression(request.settings)
    }
  };
};
export class ImageEditService {
  private readonly concurrency: number;
  private readonly runner: ImageEditTaskRunner;
  private readonly usesInjectedRunner: boolean;
  private readonly backendResolver?: ImageEditBackendResolver;
  private abortControllers = new Map<string, AbortController>();
  private activeTaskRuns = new Set<Promise<void>>();
  private activeTaskRunsById = new Map<string, Promise<void>>();
  private activeAssetPreparations = new Set<Promise<unknown>>();
  private pendingReservations = new Map<string, number>();
  private dataEpoch = 0;
  private isClearingAll = false;
  private clearOperation: Promise<void> | null = null;
  private isQueuePumpActive = false;
  private taskMutationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly rootDir: string, options: ImageEditServiceOptions = {}) {
    this.concurrency = clamp(
      Math.round(options.concurrency || WORKSPACE_CONCURRENCY_LIMIT),
      1,
      WORKSPACE_CONCURRENCY_LIMIT
    );
    this.runner = options.runner || ((task, signal) => this.runImageEditModel(task, signal));
    this.usesInjectedRunner = Boolean(options.runner);
    this.backendResolver = options.backendResolver;
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
    const { buffer, mimeType } = inspectImageDataUrl(dataUrl, "改图任务资产");
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
    const { dataUrl: _sourceDataUrl, thumbnailDataUrl: _sourceThumbnailDataUrl, ...sourceImage } = task.sourceImage;
    const modelInputImage = task.modelInputImage
      ? (({ dataUrl: _modelInputDataUrl, ...metadata }) => ({
          ...metadata,
          assetFileName: metadata.assetFileName || "model-input.png"
        }))(task.modelInputImage)
      : undefined;
    const { dataUrl: _annotationDataUrl, thumbnailDataUrl: _annotationThumbnailDataUrl, ...annotationImage } = task.annotationImage;
    const maskImage = task.maskImage
      ? (({ dataUrl: _maskDataUrl, thumbnailDataUrl: _maskThumbnailDataUrl, ...metadata }) => ({
          ...metadata,
          assetFileName: metadata.assetFileName || "mask.png"
        }))(task.maskImage)
      : undefined;
    const localProtectionMaskImage = task.localProtectionMaskImage
      ? (({ dataUrl: _localMaskDataUrl, thumbnailDataUrl: _localMaskThumbnailDataUrl, ...metadata }) => ({
          ...metadata,
          purpose: "local_protection" as const,
          assetFileName: metadata.assetFileName || "local-protection-mask.png"
        }))(task.localProtectionMaskImage)
      : undefined;
    const regenerationContext = task.regenerationContext
      ? {
          ...task.regenerationContext,
          originalReferences: (Array.isArray(task.regenerationContext.originalReferences)
            ? task.regenerationContext.originalReferences
            : []
          ).map((reference, index) => {
            const { dataUrl: _referenceDataUrl, thumbnailDataUrl: _referenceThumbnailDataUrl, ...metadata } = reference;
            return {
              ...metadata,
              assetFileName: metadata.assetFileName || `origin-reference-${String(index + 1).padStart(2, "0")}.png`
            };
          })
        }
      : undefined;
    return {
      ...task,
      fidelityMode: normalizeFidelityMode(task.fidelityMode),
      sourceImage: {
        ...sourceImage,
        assetFileName: sourceImage.assetFileName || "source.png"
      },
      modelInputImage,
      annotationImage: {
        ...annotationImage,
        assetFileName: annotationImage.assetFileName || "annotation.png"
      },
      maskImage,
      localProtectionMaskImage,
      regenerationContext,
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
    const modelInputDataUrl = task.modelInputImage
      ? await this.readAssetDataUrl(
          task.id,
          task.modelInputImage.assetFileName,
          task.modelInputImage.mimeType
        ).catch(() => "")
      : "";
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
    const regenerationContext = task.regenerationContext
      ? {
          ...task.regenerationContext,
          originalReferences: await Promise.all(
            (Array.isArray(task.regenerationContext.originalReferences)
              ? task.regenerationContext.originalReferences
              : []
            ).map(async (reference) => {
              const dataUrl = await this.readAssetDataUrl(task.id, reference.assetFileName, reference.mimeType).catch(() => "");
              return { ...reference, dataUrl, thumbnailDataUrl: dataUrl };
            })
          )
        }
      : undefined;
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
          compositeAudit:
            output.compositeAudit ||
            (protectedVariant
              ? {
                  status: "legacy_unverified" as const,
                  reasons: ["这是 Source-Locked V2 之前生成的旧版保护图，没有通过新门禁。"]
                }
              : undefined),
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
        dataUrl: sourceDataUrl,
        thumbnailDataUrl: sourceDataUrl
      },
      modelInputImage: task.modelInputImage
        ? {
            ...task.modelInputImage,
            dataUrl: modelInputDataUrl
          }
        : undefined,
      annotationImage: {
        ...task.annotationImage,
        dataUrl: annotationDataUrl,
        thumbnailDataUrl: annotationDataUrl
      },
      maskImage: task.maskImage
        ? {
            ...task.maskImage,
            dataUrl: maskDataUrl,
            thumbnailDataUrl: maskDataUrl
          }
        : undefined,
      localProtectionMaskImage: task.localProtectionMaskImage
        ? {
            ...task.localProtectionMaskImage,
            purpose: "local_protection",
            dataUrl: localProtectionMaskDataUrl,
            thumbnailDataUrl: localProtectionMaskDataUrl
          }
        : undefined,
      regenerationContext,
      outputs
    };
  }

  private async hydrateTaskForExecution(task: StoredImageEditTask): Promise<ImageEditTask> {
    const regenerationContext = task.regenerationContext
      ? {
          ...task.regenerationContext,
          originalReferences: await Promise.all(
            task.regenerationContext.originalReferences.map(async (reference) => ({
              ...reference,
              dataUrl: await this.readAssetDataUrl(task.id, reference.assetFileName, reference.mimeType).catch(() => ""),
              thumbnailDataUrl: ""
            }))
          )
        }
      : undefined;
    return {
      ...task,
      fidelityMode: normalizeFidelityMode(task.fidelityMode),
      annotationItems: normalizeAnnotationItems(task.annotationItems),
      sourceImage: { ...task.sourceImage, dataUrl: "", thumbnailDataUrl: "" },
      modelInputImage: undefined,
      annotationImage: { ...task.annotationImage, dataUrl: "", thumbnailDataUrl: "" },
      maskImage: undefined,
      localProtectionMaskImage: undefined,
      regenerationContext,
      outputs: []
    };
  }

  async getTasks(): Promise<ImageEditTask[]> {
    await this.reconcileStaleRunningTasks();
    return Promise.all((await this.readTasks()).map((task) => this.hydrateTask(task)));
  }

  async getTaskSummaries(): Promise<ImageEditTaskSummary[]> {
    await this.reconcileStaleRunningTasks();
    return (await this.readTasks()).map((task) => ({
      id: task.id,
      clientWorkflowId: task.clientWorkflowId || `task:${task.id}`,
      status: task.status,
      updatedAt: task.updatedAt,
      outputCount: Array.isArray(task.outputs) ? task.outputs.length : 0,
      error: sanitizeSummaryError(task.error),
      visibility: normalizeTaskVisibility(task.visibility)
    }));
  }

  async getTask(id: string): Promise<ImageEditTask | null> {
    if (!id.trim()) return null;
    await this.reconcileStaleRunningTasks();
    const task = (await this.readTasks()).find((item) => item.id === id);
    return task ? this.hydrateTask(task) : null;
  }

  async resumePendingTasks(): Promise<void> {
    await this.reconcileStaleRunningTasks();
    this.scheduleQueueProcessing();
  }

  async createTask(request: ImageEditCreateRequest): Promise<ImageEditTask> {
    const creationEpoch = this.dataEpoch;
    if (this.isClearingAll) throw new Error("改图任务正在清理，请稍后再试。");
    const normalized = normalizeCreateRequest(request);
    const backend = this.usesInjectedRunner ? null : await this.resolveBackend();
    const now = new Date().toISOString();
    const taskId = randomUUID();
    await this.reserveTaskSlot(taskId, creationEpoch);
    let committed = false;
    try {
      const assetPreparation = (async () => {
        const sourceAssetFileName = await this.writeAsset(taskId, "source", normalized.sourceImage.dataUrl);
        const annotationAssetFileName = await this.writeAsset(taskId, "annotation", normalized.annotationImage.dataUrl);
        const originReferenceAssetFileNames = normalized.regenerationContext
          ? await Promise.all(
              normalized.regenerationContext.originalReferences.map((reference, index) =>
                this.writeAsset(taskId, `origin-reference-${String(index + 1).padStart(2, "0")}`, reference.dataUrl)
              )
            )
          : [];
        return { sourceAssetFileName, annotationAssetFileName, originReferenceAssetFileNames };
      })();
      this.activeAssetPreparations.add(assetPreparation);
      const { sourceAssetFileName, annotationAssetFileName, originReferenceAssetFileNames } = await assetPreparation.finally(
        () => this.activeAssetPreparations.delete(assetPreparation)
      );
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
        clientWorkflowId: normalized.clientWorkflowId,
        createdAt: now,
        updatedAt: now,
        status: "queued",
        visibility: "active",
        sourceImage: {
          ...normalized.sourceImage,
          assetFileName: sourceAssetFileName
        },
        sourceIntegrity: normalized.sourceIntegrity,
        annotationImage: {
          ...normalized.annotationImage,
          assetFileName: annotationAssetFileName
        },
        annotationItems: normalized.annotationItems || [],
        annotationResolution: normalized.annotationResolution,
        regenerationContext: normalized.regenerationContext
          ? {
              ...normalized.regenerationContext,
              originalReferences: normalized.regenerationContext.originalReferences.map((reference, index) => ({
                ...reference,
                assetFileName: originReferenceAssetFileNames[index]
              }))
            }
          : undefined,
        fidelityMode: "origin_regenerate",
        instruction: normalized.instruction,
        finalPrompt: buildOriginRegenerationPrompt(
          normalized.regenerationContext?.basePrompt || "",
          normalized.instruction,
          normalized.annotationItems || [],
          normalized.annotationResolution as ImageEditAnnotationResolution,
          settings
        ),
        settings,
        backend: backendSnapshot,
        diagnostics: diagnosticsForTask(normalized, backend, backendSnapshot),
        outputs: []
      };
      await this.commitReservedTask(task, creationEpoch);
      committed = true;
      this.scheduleQueueProcessing();
      return task;
    } catch (error) {
      await rm(this.assetsDir(taskId), { recursive: true, force: true });
      throw error;
    } finally {
      if (!committed) await this.releaseTaskReservation(taskId);
    }
  }

  async cancelTask(id: string): Promise<ImageEditTask | null> {
    this.abortControllers.get(id)?.abort(new Error("已取消改图任务。"));
    const task = await this.mutateTasks(async (tasks) => {
      this.abortControllers.get(id)?.abort(new Error("已取消改图任务。"));
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
    if (sourceTask.fidelityMode !== "origin_regenerate" || !sourceTask.regenerationContext) {
      throw new Error("旧版改图任务仅保留历史结果，不能沿用已移除的执行方式重试。");
    }
    return this.createTask({
      clientWorkflowId: sourceTask.clientWorkflowId,
      sourceImage: {
        ...sourceTask.sourceImage,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        sourcePointer: {
          kind: "restored_edit_output",
          historyItemId: sourceTask.sourceImage.sourcePointer.historyItemId,
          imageEditTaskId: sourceTask.id,
          importedAt: new Date().toISOString()
        }
      },
      annotationImage: {
        ...sourceTask.annotationImage,
        createdAt: new Date().toISOString()
      },
      annotationItems: sourceTask.annotationItems,
      annotationResolution: sourceTask.annotationResolution,
      regenerationContext: {
        ...sourceTask.regenerationContext,
        originalReferences: sourceTask.regenerationContext.originalReferences.map((reference) => ({ ...reference }))
      },
      fidelityMode: "origin_regenerate",
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
    const tasks = await this.mutateTasks((currentTasks) => {
      this.abortControllers.get(id)?.abort(new Error("已删除改图任务。"));
      const nextTasks = currentTasks.filter((task) => task.id !== id);
      return { tasks: nextTasks, result: nextTasks };
    });
    const activeRun = this.activeTaskRunsById.get(id);
    if (activeRun) await Promise.allSettled([activeRun]);
    await rm(this.assetsDir(id), { recursive: true, force: true });
    this.scheduleQueueProcessing();
    return Promise.all(tasks.map((task) => this.hydrateTask(task)));
  }

  async clearTasks(): Promise<void> {
    await this.clearTaskData(false, "已清空改图任务。");
  }

  async clearAll(_platform: NodeJS.Platform = process.platform): Promise<void> {
    await this.clearTaskData(true, "已抹除全部本机数据。");
  }

  async saveOutputs(_request: ImageEditOutputsSaveRequest): Promise<never> {
    throw new Error("改图输出保存尚未完成接入。");
  }

  private async clearTaskData(removeDomain: boolean, reason: string): Promise<void> {
    if (this.clearOperation) {
      await this.clearOperation;
      if (removeDomain) await this.clearTaskData(true, reason);
      return;
    }
    this.isClearingAll = true;
    this.dataEpoch += 1;
    const operation = (async () => {
      for (const controller of this.abortControllers.values()) controller.abort(new Error(reason));
      await Promise.allSettled([...this.activeAssetPreparations]);
      await Promise.allSettled([...this.activeTaskRuns]);
      await this.taskMutationQueue;
      this.abortControllers.clear();
      this.pendingReservations.clear();
      await rm(this.imageEditDir(), { recursive: true, force: true });
      if (!removeDomain) await this.writeTasks([]);
    })();
    this.clearOperation = operation;
    try {
      await operation;
    } finally {
      this.clearOperation = null;
      this.isClearingAll = false;
    }
  }

  private scheduleQueueProcessing(): void {
    if (this.isClearingAll) return;
    void this.processQueue().catch(() => undefined);
  }

  private async processQueue(): Promise<void> {
    if (this.isQueuePumpActive || this.isClearingAll) return;
    this.isQueuePumpActive = true;
    try {
      while (true) {
        if (this.isClearingAll) return;
        const availableSlots = this.concurrency - this.abortControllers.size;
        if (availableSlots <= 0) return;
        await this.reconcileStaleRunningTasks();
        const tasks = await this.readTasks();
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
      if (
        !this.isClearingAll &&
        tasks.some((task) => task.status === "queued") &&
        this.abortControllers.size < this.concurrency
      ) {
        this.scheduleQueueProcessing();
      }
    }
  }

  private async startQueuedTask(task: StoredImageEditTask): Promise<void> {
    const runEpoch = this.dataEpoch;
    const controller = new AbortController();
    let runningTask: StoredImageEditTask | null = null;
    try {
      runningTask = await this.mutateTasks((tasks) => {
        const taskIndex = tasks.findIndex((item) => item.id === task.id);
        const latestTask = taskIndex >= 0 ? tasks[taskIndex] : undefined;
        if (
          this.isClearingAll ||
          runEpoch !== this.dataEpoch ||
          !latestTask ||
          latestTask.status !== "queued" ||
          this.abortControllers.has(task.id)
        ) {
          return { tasks, result: null };
        }
        const now = new Date().toISOString();
        const nextTask: StoredImageEditTask = {
          ...latestTask,
          status: "running",
          startedAt: latestTask.startedAt || now,
          updatedAt: now,
          error: undefined
        };
        this.abortControllers.set(nextTask.id, controller);
        const nextTasks = [...tasks];
        nextTasks[taskIndex] = nextTask;
        return { tasks: nextTasks, result: nextTask };
      });
    } catch (error) {
      if (this.abortControllers.get(task.id) === controller) this.abortControllers.delete(task.id);
      throw error;
    }
    if (!runningTask) return;
    const canRun = await this.mutateTasks((tasks) => ({
      tasks,
      result:
        !this.isClearingAll &&
        runEpoch === this.dataEpoch &&
        this.abortControllers.get(task.id) === controller &&
        tasks.some((item) => item.id === task.id && item.status === "running")
    }));
    if (!canRun || controller.signal.aborted) {
      if (this.abortControllers.get(task.id) === controller) this.abortControllers.delete(task.id);
      return;
    }
    const timeout = setTimeout(() => {
      controller.abort(new Error("改图请求超过 10 分钟未响应，请检查后端或稍后重试。"));
    }, IMAGE_EDIT_TIMEOUT_MS);

    const taskRun = this.runQueuedTask(runningTask, runEpoch, controller, timeout);
    this.activeTaskRuns.add(taskRun);
    this.activeTaskRunsById.set(runningTask.id, taskRun);
    void taskRun
      .finally(() => {
        this.activeTaskRuns.delete(taskRun);
        if (this.activeTaskRunsById.get(runningTask.id) === taskRun) this.activeTaskRunsById.delete(runningTask.id);
      })
      .catch(() => undefined);
  }

  private async runQueuedTask(
    task: StoredImageEditTask,
    runEpoch: number,
    controller: AbortController,
    timeout: NodeJS.Timeout
  ): Promise<void> {
    const writtenOutputFileNames: string[] = [];
    try {
      const executionTask = await this.hydrateTaskForExecution(task);
      const results = await this.runner(executionTask, controller.signal);
      const now = new Date().toISOString();
      const outputs: ImageEditOutput[] = [];
      for (const [index, result] of results.entries()) {
        const outputId = randomUUID();
        const inspectedOutput = inspectImageDataUrl(result.dataUrl, `AI 原始输出 ${index + 1}`);
        const canonicalOutputDataUrl = dataUrlFromBuffer(inspectedOutput.buffer, inspectedOutput.mimeType);
        const assetFileName = await this.writeAsset(
          task.id,
          `output-${String(index + 1).padStart(2, "0")}`,
          canonicalOutputDataUrl
        );
        writtenOutputFileNames.push(assetFileName);
        outputs.push({
          ...result,
          error: sanitizeSummaryError(result.error),
          dataUrl: canonicalOutputDataUrl,
          mimeType: inspectedOutput.mimeType,
          actualSize: inspectedOutput.size,
          actualWidth: inspectedOutput.width,
          actualHeight: inspectedOutput.height,
          sizeMismatch: Boolean(result.requestedSize && result.requestedSize !== inspectedOutput.size),
          id: outputId,
          createdAt: now,
          assetFileName
        });
      }
      const outputProblem = sanitizeSummaryError(summarizeOutputProblems(outputs, task.settings.n));
      const storedOutputs = this.stripTaskAssets({
        ...executionTask,
        outputs,
        status: "running",
        updatedAt: now
      }).outputs;
      const finished = await this.finishRunningTask(task.id, runEpoch, {
        outputs: storedOutputs,
        status: !outputs.length ? "failed" : outputProblem ? "partial_failed" : "succeeded",
        error: outputProblem
      });
      if (!finished) await this.removeOutputAssets(task.id, writtenOutputFileNames);
    } catch (error) {
      const finished = await this.finishRunningTask(task.id, runEpoch, {
        status: controller.signal.aborted ? "canceled" : "failed",
        error: sanitizeSummaryError(error instanceof Error ? error.message : String(error))
      });
      if (!finished) await this.removeOutputAssets(task.id, writtenOutputFileNames);
    } finally {
      clearTimeout(timeout);
      if (this.abortControllers.get(task.id) === controller) this.abortControllers.delete(task.id);
      this.scheduleQueueProcessing();
    }
  }

  private async readTasksWithMetadata(): Promise<{ tasks: StoredImageEditTask[]; normalized: boolean }> {
    const tasks = await readJsonFile<StoredImageEditTask[]>(this.tasksPath(), []);
    if (!Array.isArray(tasks)) return { tasks: [], normalized: false };
    let changed = false;
    const withoutThumbnail = <T extends object>(value: T): T => {
      if (!("thumbnailDataUrl" in value)) return value;
      const { thumbnailDataUrl: _thumbnailDataUrl, ...metadata } = value as T & { thumbnailDataUrl?: string };
      changed = true;
      return metadata as T;
    };
    const sanitized = tasks.map((task) => {
      const error = sanitizeSummaryError(task.error);
      if (error !== task.error) changed = true;
      const outputs = task.outputs.map((output) => {
        const outputError = sanitizeSummaryError(output.error);
        if (outputError === output.error) return output;
        changed = true;
        return { ...output, error: outputError };
      });
      return {
        ...task,
        error,
        outputs,
        sourceImage: withoutThumbnail(task.sourceImage),
        annotationImage: withoutThumbnail(task.annotationImage),
        maskImage: task.maskImage ? withoutThumbnail(task.maskImage) : undefined,
        localProtectionMaskImage: task.localProtectionMaskImage
          ? withoutThumbnail(task.localProtectionMaskImage)
          : undefined,
        regenerationContext: task.regenerationContext
          ? {
              ...task.regenerationContext,
              originalReferences: task.regenerationContext.originalReferences.map((reference) =>
                withoutThumbnail(reference)
              )
            }
          : undefined
      };
    });
    return { tasks: sanitized, normalized: changed };
  }

  private async readTasks(): Promise<StoredImageEditTask[]> {
    return (await this.readTasksWithMetadata()).tasks;
  }

  private async resolveBackend(
    providerId?: string,
    snapshot?: ImageEditTask["backend"]
  ): Promise<EffectiveImageEditBackend> {
    if (this.backendResolver) return this.backendResolver(providerId, snapshot);
    const stored = await readJsonFile<StoredGenerationConfigForImageEdit>(this.generationConfigPath(), {});
    const defaultBackend = normalizeStoredImageEditBackend(stored);
    const authSource = snapshot?.authSource || defaultBackend?.authSource || "codex_oauth";
    const requestedProviderId = snapshot?.providerId || providerId;
    const liveBackend = normalizeStoredImageEditBackend(stored, authSource === "api" ? requestedProviderId : undefined);
    const fallbackBackend = liveBackend || defaultBackend;
    if (!fallbackBackend) throw new Error("没有找到可用的生图供应商。");
    if (authSource === "codex_oauth") {
      const status = await getCodexAuthStatus();
      if (!status.available) {
        throw new Error(`创建任务时使用的 Codex OAuth 凭证当前不可用。${status.error ? `（${status.error}）` : ""}`);
      }
      return {
        ...fallbackBackend,
        authSource,
        providerId: requestedProviderId,
        providerType: snapshot?.providerType || fallbackBackend.providerType,
        providerName: snapshot?.providerName || fallbackBackend.providerName,
        apiBaseUrl: snapshot?.apiBaseUrl || fallbackBackend.apiBaseUrl,
        apiKey: "",
        apiMode: snapshot?.apiMode || "responses",
        imageModel: snapshot?.imageModel || fallbackBackend.imageModel,
        mainModel: snapshot?.mainModel || fallbackBackend.mainModel
      };
    }
    if (!liveBackend && requestedProviderId) {
      throw new Error("创建任务时使用的生图供应商已被删除，改图任务无法继续。");
    }
    const backend = liveBackend || fallbackBackend;
    if (!backend.apiKey.trim()) {
      throw new Error("创建任务时使用的生图供应商凭证当前不可用，请恢复后重试。");
    }
    return {
      ...backend,
      authSource: "api",
      providerId: requestedProviderId || backend.providerId,
      providerType: snapshot?.providerType || backend.providerType,
      providerName: snapshot?.providerName || backend.providerName,
      apiBaseUrl: snapshot?.apiBaseUrl || backend.apiBaseUrl,
      apiMode: snapshot?.apiMode || backend.apiMode,
      imageModel: snapshot?.imageModel || backend.imageModel,
      mainModel: snapshot?.mainModel || backend.mainModel
    };
  }

  private async runImageEditModel(task: ImageEditTask, signal: AbortSignal): Promise<ImageEditRunnerOutput[]> {
    if (task.fidelityMode !== "origin_regenerate" || !task.regenerationContext) {
      throw new Error("旧版改图任务仅保留历史结果，已不再执行旁路参考或严格 mask 请求。");
    }
    const backend = await this.resolveBackend(task.backend?.providerId, task.backend);
    const settings = toGenerationSettings(task.settings);
    const originalReferences = task.regenerationContext.originalReferences
      .map((reference) => reference.dataUrl)
      .filter((dataUrl) => dataUrl.startsWith("data:image/"));
    if (task.regenerationContext.inputStrategy === "original_references" && !originalReferences.length) {
      throw new Error("原始主体参考图资产缺失，不能静默改用当前生成结果。请重新从生图任务导入，或明确使用纯文字重生成。");
    }

    if (backend.authSource === "codex_oauth") {
      let authState = await loadCodexAuthState();
      const results: ImageEditRunnerOutput[] = [];
      for (let index = 0; index < task.settings.n; index += 1) {
        const response = await requestCodexResponses(
          forceOriginRegenerationResponsesAction(
            buildCodexResponsesPayload(task.finalPrompt, settings, originalReferences)
          ),
          authState,
          signal
        );
        authState = response.authState;
        results.push(...parseResponsesImageResponse(response.text, settings));
      }
      return results.slice(0, task.settings.n);
    }
    if (backend.providerType === "openrouter") {
      return requestOpenRouterImageEdit(backend, task.finalPrompt, settings, originalReferences, signal);
    }
    if (backend.apiMode === "gemini") {
      const results: ImageEditRunnerOutput[] = [];
      const endpoint = geminiGenerateContentEndpoint(backend.apiBaseUrl, backend.imageModel);
      for (let index = 0; index < task.settings.n && results.length < task.settings.n; index += 1) {
        const responseText = await requestJson(
          endpoint,
          backend.apiKey,
          buildGeminiImagePayload(
            task.finalPrompt,
            settings,
            originalReferences,
            isGoogleGeminiEndpoint(endpoint)
          ),
          signal,
          "application/json",
          "gemini"
        );
        results.push(...parseGeminiImageResponse(responseText, settings));
      }
      return results.slice(0, task.settings.n);
    }
    if (backend.apiMode === "chat_completions") {
      const results: ImageEditRunnerOutput[] = [];
      for (let index = 0; index < task.settings.n && results.length < task.settings.n; index += 1) {
        const responseText = await requestJson(
          generationEndpoint(backend.apiBaseUrl, "chat/completions"),
          backend.apiKey,
          buildChatCompletionsImagePayload(task.finalPrompt, settings, originalReferences),
          signal
        );
        results.push(...(await parseChatCompletionsImageResponse(responseText, backend.apiKey, settings)));
      }
      return results.slice(0, task.settings.n);
    }
    if (backend.apiMode === "responses") {
      const results: ImageEditRunnerOutput[] = [];
      for (let index = 0; index < task.settings.n; index += 1) {
        const responseText = await requestJson(
          generationEndpoint(backend.apiBaseUrl, "responses"),
          backend.apiKey,
          forceOriginRegenerationResponsesAction(
            buildResponsesPayload(task.finalPrompt, settings, originalReferences)
          ),
          signal,
          "text/event-stream"
        );
        results.push(...parseResponsesImageResponse(responseText, settings));
      }
      return results.slice(0, task.settings.n);
    }
    if (originalReferences.length) {
      const responseText = await requestEditForm(
        generationEndpoint(backend.apiBaseUrl, "images/edits"),
        backend.apiKey,
        task.finalPrompt,
        settings,
        originalReferences,
        signal
      );
      return parseImagesResponse(responseText, backend.apiKey, settings);
    }
    const responseText = await requestJson(
      generationEndpoint(backend.apiBaseUrl, "images/generations"),
      backend.apiKey,
      buildImagesGenerationPayload(task.finalPrompt, settings),
      signal
    );
    return parseImagesResponse(responseText, backend.apiKey, settings);
  }

  private async reconcileStaleRunningTasks(): Promise<void> {
    await this.mutateTasks((tasks) => {
      const now = new Date().toISOString();
      let changed = false;
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
      return { tasks: changed ? next : tasks, result: undefined };
    });
  }

  private async reserveTaskSlot(taskId: string, creationEpoch: number): Promise<void> {
    await this.mutateTasks((tasks) => {
      if (this.isClearingAll || creationEpoch !== this.dataEpoch) {
        throw new Error("改图任务数据已被清理，请重新提交。");
      }
      if (tasks.filter(isActiveTask).length + this.pendingReservations.size >= WORKSPACE_CONCURRENCY_LIMIT) {
        throw capacityError();
      }
      this.pendingReservations.set(taskId, creationEpoch);
      return { tasks, result: undefined };
    });
  }

  private async releaseTaskReservation(taskId: string): Promise<void> {
    await this.mutateTasks((tasks) => {
      this.pendingReservations.delete(taskId);
      return { tasks, result: undefined };
    });
  }

  private async commitReservedTask(task: ImageEditTask, creationEpoch: number): Promise<void> {
    const storedTask = this.stripTaskAssets(task);
    await this.mutateTasks((tasks) => {
      const reservationEpoch = this.pendingReservations.get(task.id);
      this.pendingReservations.delete(task.id);
      if (this.isClearingAll || creationEpoch !== this.dataEpoch || reservationEpoch !== creationEpoch) {
        throw new Error("改图任务数据已被清理，请重新提交。");
      }
      return { tasks: [storedTask, ...tasks], result: undefined };
    });
  }

  private async finishRunningTask(
    id: string,
    runEpoch: number,
    update: Pick<StoredImageEditTask, "status" | "error"> & { outputs?: StoredImageEditOutput[] }
  ): Promise<StoredImageEditTask | null> {
    return this.mutateTasks((tasks) => {
      const taskIndex = tasks.findIndex((item) => item.id === id);
      const task = taskIndex >= 0 ? tasks[taskIndex] : undefined;
      if (!task || task.status !== "running" || runEpoch !== this.dataEpoch) {
        return { tasks, result: null };
      }
      const now = new Date().toISOString();
      const finishedTask: StoredImageEditTask = {
        ...task,
        status: update.status,
        outputs: update.outputs || task.outputs,
        error: update.error,
        updatedAt: now,
        completedAt: now
      };
      const nextTasks = [...tasks];
      nextTasks[taskIndex] = finishedTask;
      return { tasks: nextTasks, result: finishedTask };
    });
  }

  private async removeOutputAssets(taskId: string, fileNames: string[]): Promise<void> {
    await Promise.allSettled(
      fileNames.map((fileName) => rm(join(this.assetsDir(taskId), fileName), { force: true }))
    );
  }

  private async writeTasks(tasks: StoredImageEditTask[]): Promise<void> {
    const retained = tasks.slice(0, MAX_STORED_TASKS);
    const dropped = tasks.slice(MAX_STORED_TASKS);
    await mkdir(this.imageEditDir(), { recursive: true });
    await writeJsonFile(this.tasksPath(), retained);
    await Promise.allSettled(dropped.map((task) => rm(this.assetsDir(task.id), { recursive: true, force: true })));
  }

  private async mutateTasks<Result>(
    mutation:
      | ((tasks: StoredImageEditTask[]) => { tasks: StoredImageEditTask[]; result: Result })
      | ((tasks: StoredImageEditTask[]) => Promise<{ tasks: StoredImageEditTask[]; result: Result }>)
  ): Promise<Result> {
    const runMutation = this.taskMutationQueue.then(async () => {
      const { tasks: currentTasks, normalized } = await this.readTasksWithMetadata();
      const { tasks, result } = await mutation(currentTasks);
      if (normalized || tasks !== currentTasks) await this.writeTasks(tasks);
      return result;
    });
    this.taskMutationQueue = runMutation.then(
      () => undefined,
      () => undefined
    );
    return runMutation;
  }
}

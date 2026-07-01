import { nativeImage, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  GenerationConfig,
  GenerationConfigUpdate,
  GenerationCreateRequest,
  GenerationOutput,
  GenerationProviderConfig,
  GenerationProviderConfigUpdate,
  GenerationProviderType,
  GenerationRequestSizeStrategy,
  GenerationRequestSettings,
  GenerationTask,
  GenerationTaskVisibility,
  GenerationTaskVisibilityUpdate
} from "../src/shared/types";
import {
  defaultGenerationAspectRatio,
  defaultGenerationResolution,
  normalizeGenerationSizeSettings,
  resolveGenerationSize
} from "../src/shared/generation-size";
import { CodexAuthState, getCodexAuthStatus, loadCodexAuthState, refreshCodexAuthState } from "./codex-auth";
import { ModelHttpError, readJsonFile, writeJsonFile } from "./main-utils";

interface EffectiveGenerationConfig {
  authSource: GenerationConfig["authSource"];
  activeProviderId: string;
  providers: EffectiveGenerationProvider[];
  providerType: GenerationProviderType;
  apiBaseUrl: string;
  apiKey: string;
  apiMode: GenerationConfig["apiMode"];
  imageModel: string;
  mainModel: string;
  saveApiKey: boolean;
  imagesConcurrency: number;
}

interface EffectiveGenerationProvider {
  id: string;
  name: string;
  providerType: GenerationProviderType;
  apiBaseUrl: string;
  apiKey: string;
  apiMode: GenerationConfig["apiMode"];
  imageModel: string;
  mainModel: string;
  saveApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoredGenerationConfig {
  authSource?: GenerationConfig["authSource"];
  activeProviderId?: string;
  providers?: StoredGenerationProvider[];
  providerType?: GenerationProviderType;
  apiBaseUrl?: string;
  apiMode?: GenerationConfig["apiMode"];
  imageModel?: string;
  mainModel?: string;
  saveApiKey?: boolean;
  imagesConcurrency?: number;
  encryptedApiKey?: string;
  apiKey?: string;
}

interface StoredGenerationProvider {
  id?: string;
  name?: string;
  providerType?: GenerationProviderType;
  apiBaseUrl?: string;
  apiMode?: GenerationConfig["apiMode"];
  imageModel?: string;
  mainModel?: string;
  saveApiKey?: boolean;
  encryptedApiKey?: string;
  apiKey?: string;
  createdAt?: string;
  updatedAt?: string;
}

type ImageResult = Omit<GenerationOutput, "id" | "createdAt">;

const LEGACY_DEFAULT_MAIN_MODEL = "gpt-5.4-mini";
const DEFAULT_MAIN_MODEL = "gpt-5.5";
const DEFAULT_REASONING_EFFORT = "high";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_IMAGE_MODEL = "openai/gpt-image-2";

const defaultConfig: EffectiveGenerationConfig = {
  authSource: "codex_oauth",
  activeProviderId: "default-api-provider",
  providers: [],
  providerType: "openai_compatible",
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  apiMode: "images",
  imageModel: "gpt-image-2",
  mainModel: DEFAULT_MAIN_MODEL,
  saveApiKey: false,
  imagesConcurrency: 4
};

const GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STORED_TASKS = 80;
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_USER_AGENT = "codex-tui/0.118.0 (Mac OS 26.3.1; arm64) Codex Desktop";
const CODEX_ORIGINATOR = "codex-tui";

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const createDefaultProvider = (apiKey = ""): EffectiveGenerationProvider => {
  const now = new Date().toISOString();
  return {
    id: "default-api-provider",
    name: "默认 API 供应商",
    providerType: "openai_compatible",
    apiBaseUrl: defaultConfig.apiBaseUrl,
    apiKey,
    apiMode: defaultConfig.apiMode,
    imageModel: defaultConfig.imageModel,
    mainModel: defaultConfig.mainModel,
    saveApiKey: false,
    createdAt: now,
    updatedAt: now
  };
};

const publicProvider = (provider: EffectiveGenerationProvider): GenerationProviderConfig => ({
  id: provider.id,
  name: provider.name,
  providerType: provider.providerType,
  apiBaseUrl: provider.apiBaseUrl,
  apiMode: provider.apiMode,
  imageModel: provider.imageModel,
  mainModel: provider.mainModel,
  saveApiKey: provider.saveApiKey,
  hasApiKey: Boolean(provider.apiKey),
  createdAt: provider.createdAt,
  updatedAt: provider.updatedAt
});

const activeProviderForConfig = (config: EffectiveGenerationConfig): EffectiveGenerationProvider => {
  const provider = config.providers.find((item) => item.id === config.activeProviderId) || config.providers[0];
  return provider || createDefaultProvider(config.apiKey);
};

const configWithActiveProvider = (
  config: Omit<
    EffectiveGenerationConfig,
    "providerType" | "apiBaseUrl" | "apiKey" | "apiMode" | "imageModel" | "mainModel" | "saveApiKey"
  >
): EffectiveGenerationConfig => {
  const provider = activeProviderForConfig({
    ...config,
    providerType: defaultConfig.providerType,
    apiBaseUrl: defaultConfig.apiBaseUrl,
    apiKey: "",
    apiMode: defaultConfig.apiMode,
    imageModel: defaultConfig.imageModel,
    mainModel: defaultConfig.mainModel,
    saveApiKey: false
  });
  return {
    ...config,
    activeProviderId: provider.id,
    providerType: provider.providerType,
    apiBaseUrl: provider.apiBaseUrl,
    apiKey: provider.apiKey,
    apiMode: provider.apiMode,
    imageModel: provider.imageModel,
    mainModel: provider.mainModel,
    saveApiKey: provider.saveApiKey
  };
};

const publicConfig = async (config: EffectiveGenerationConfig): Promise<GenerationConfig> => {
  const codexStatus = await getCodexAuthStatus();
  const activeProvider = activeProviderForConfig(config);
  return {
    authSource: config.authSource,
    activeProviderId: activeProvider.id,
    providers: config.providers.map(publicProvider),
    providerType: activeProvider.providerType,
    apiBaseUrl: activeProvider.apiBaseUrl,
    apiMode: config.authSource === "codex_oauth" ? "responses" : config.apiMode,
    imageModel: activeProvider.imageModel,
    mainModel: activeProvider.mainModel,
    saveApiKey: activeProvider.saveApiKey,
    hasApiKey: Boolean(activeProvider.apiKey),
    codexOAuthAvailable: codexStatus.available,
    codexOAuthPath: codexStatus.path,
    codexOAuthAccountId: codexStatus.accountId,
    codexOAuthLastRefresh: codexStatus.lastRefresh,
    codexOAuthError: codexStatus.error,
    imagesConcurrency: config.imagesConcurrency
  };
};

const backendSnapshotForConfig = (config: EffectiveGenerationConfig): GenerationTask["backend"] => {
  const activeProvider = activeProviderForConfig(config);
  return {
    authSource: config.authSource,
    providerType: activeProvider.providerType,
    providerName: activeProvider.name,
    apiBaseUrl: activeProvider.apiBaseUrl,
    apiMode: config.authSource === "codex_oauth" ? "responses" : activeProvider.apiMode,
    imageModel: activeProvider.imageModel,
    mainModel: activeProvider.mainModel
  };
};

const decryptStoredApiKey = (stored: StoredGenerationConfig): string => {
  if (stored.encryptedApiKey) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, "base64"));
    } catch {
      return "";
    }
  }
  return stored.saveApiKey ? stored.apiKey?.trim() ?? "" : "";
};

const decryptStoredProviderApiKey = (stored: StoredGenerationProvider): string => {
  if (stored.encryptedApiKey) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, "base64"));
    } catch {
      return "";
    }
  }
  return stored.saveApiKey ? stored.apiKey?.trim() ?? "" : "";
};

const encryptApiKey = (apiKey: string): string => {
  if (!apiKey) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("当前系统不支持安全保存生图 API Key，请取消勾选保存后再试。");
  }
  return safeStorage.encryptString(apiKey).toString("base64");
};

const normalizeProviderType = (providerType: GenerationProviderType | undefined): GenerationProviderType =>
  providerType === "openrouter" ? "openrouter" : "openai_compatible";

export const normalizeGenerationBaseUrl = (baseUrl: string): string => {
  const raw = (baseUrl || defaultConfig.apiBaseUrl).trim().replace(/\/+$/, "");
  const parsed = new URL(raw || defaultConfig.apiBaseUrl);
  let path = parsed.pathname.replace(/\/+$/, "");
  for (const suffix of ["/responses", "/images/generations", "/images/edits", "/images"]) {
    if (path.endsWith(suffix)) {
      path = path.slice(0, -suffix.length);
      break;
    }
  }
  parsed.pathname = path || "/v1";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
};

export const generationEndpoint = (
  baseUrl: string,
  kind: "images/generations" | "images/edits" | "responses"
): string => `${normalizeGenerationBaseUrl(baseUrl)}/${kind}`;

export const openRouterImagesEndpoint = (baseUrl: string): string => `${normalizeGenerationBaseUrl(baseUrl)}/images`;

const dataUrlToBuffer = (dataUrl: string): { mimeType: string; buffer: Buffer } => {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match || match[2] !== ";base64") {
    throw new Error("生图参考图必须是 base64 图片数据。");
  }
  return {
    mimeType: match[1] || "image/png",
    buffer: Buffer.from(match[3], "base64")
  };
};

const mimeTypeToExtension = (mimeType: string): string => {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
};

const outputMimeType = (format: string | undefined): string => {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
};

const dataUrlFromBytes = (bytes: ArrayBuffer | Buffer, mimeType: string): string => {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
};

interface ImageDimensions {
  width: number;
  height: number;
  size: string;
}

const imageDimensions = (width: number, height: number): ImageDimensions | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    width,
    height,
    size: `${width}x${height}`
  };
};

const readUInt24LE = (buffer: Buffer, offset: number): number =>
  buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16);

const parsePngDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  return imageDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
};

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

const parseJpegDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if (jpegStartOfFrameMarkers.has(marker) && length >= 7) {
      return imageDimensions(buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  return null;
};

const parseWebpDimensions = (buffer: Buffer): ImageDimensions | null => {
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > buffer.length) return null;
    if (chunkType === "VP8X" && chunkSize >= 10) {
      return imageDimensions(readUInt24LE(buffer, dataOffset + 4) + 1, readUInt24LE(buffer, dataOffset + 7) + 1);
    }
    if (
      chunkType === "VP8 " &&
      chunkSize >= 10 &&
      buffer[dataOffset + 3] === 0x9d &&
      buffer[dataOffset + 4] === 0x01 &&
      buffer[dataOffset + 5] === 0x2a
    ) {
      return imageDimensions(buffer.readUInt16LE(dataOffset + 6) & 0x3fff, buffer.readUInt16LE(dataOffset + 8) & 0x3fff);
    }
    if (chunkType === "VP8L" && chunkSize >= 5 && buffer[dataOffset] === 0x2f) {
      const bits = buffer.readUInt32LE(dataOffset + 1);
      return imageDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  return null;
};

export const parseImageDimensions = (bytes: ArrayBuffer | Buffer): ImageDimensions | null => {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return parsePngDimensions(buffer) || parseJpegDimensions(buffer) || parseWebpDimensions(buffer);
};

export const parseGenerationOutputDimensions = (dataUrl: string): ImageDimensions | null => {
  try {
    return parseImageDimensions(dataUrlToBuffer(dataUrl).buffer);
  } catch {
    return null;
  }
};

const parseGenerationSize = (size: string | undefined): ImageDimensions | null => {
  const match = String(size ?? "").trim().match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return imageDimensions(Number(match[1]), Number(match[2]));
};

const isDefaultGenerationSizeRequest = (settings: GenerationRequestSettings): boolean =>
  settings.resolution === defaultGenerationResolution &&
  settings.aspectRatio === defaultGenerationAspectRatio &&
  settings.size === resolveGenerationSize(defaultGenerationResolution, defaultGenerationAspectRatio);

const shouldUseReferenceGenerationAction = (
  settings: GenerationRequestSettings,
  referenceImageDataUrls: string[]
): boolean => {
  if (!referenceImageDataUrls.length) return false;
  if (!isDefaultGenerationSizeRequest(settings)) return true;
  const requested = parseGenerationSize(settings.size);
  if (!requested) return false;
  const requestedRatio = requested.width / requested.height;
  return referenceImageDataUrls.some((dataUrl) => {
    const dimensions = parseGenerationOutputDimensions(dataUrl);
    if (!dimensions) return false;
    const referenceRatio = dimensions.width / dimensions.height;
    return Math.abs(referenceRatio / requestedRatio - 1) > 0.03;
  });
};

const withVerifiedDimensions = (
  result: Omit<ImageResult, "requestedSize" | "actualSize" | "actualWidth" | "actualHeight" | "sizeMismatch" | "error"> & {
    error?: string;
  },
  requestedSize: string
): ImageResult => {
  const dimensions = parseGenerationOutputDimensions(result.dataUrl);
  const next: ImageResult = {
    ...result,
    requestedSize,
    size: result.size || requestedSize
  };
  if (!dimensions) {
    return {
      ...next,
      error: [next.error, "无法识别生成图片真实像素尺寸，已按异常结果保留。"].filter(Boolean).join(" ")
    };
  }
  const sizeMismatch = dimensions.size !== requestedSize;
  return {
    ...next,
    actualSize: dimensions.size,
    actualWidth: dimensions.width,
    actualHeight: dimensions.height,
    sizeMismatch,
    error: sizeMismatch
      ? [next.error, `生成图片实际尺寸为 ${dimensions.size}，与请求尺寸 ${requestedSize} 不一致。`]
          .filter(Boolean)
          .join(" ")
      : next.error
  };
};

const withLocalResizeFallback = (result: ImageResult, settings: GenerationRequestSettings): ImageResult => {
  if (!result.error || result.localResizeApplied) return result;
  const requested = parseGenerationSize(settings.size);
  const backendDimensions = parseGenerationOutputDimensions(result.dataUrl);
  if (!requested || !backendDimensions || backendDimensions.size === settings.size) return result;

  try {
    const sourceImage = nativeImage.createFromDataURL(result.dataUrl);
    if (sourceImage.isEmpty()) return result;
    const resizedImage = sourceImage.resize({ width: requested.width, height: requested.height, quality: "best" });
    if (resizedImage.isEmpty()) return result;

    const outputAsJpeg = settings.outputFormat === "jpeg";
    const mimeType = outputAsJpeg ? "image/jpeg" : "image/png";
    const buffer = outputAsJpeg
      ? resizedImage.toJPEG(clamp(settings.outputCompression ?? 92, 1, 100))
      : resizedImage.toPNG();
    const adjusted = withVerifiedDimensions(
      {
        ...result,
        dataUrl: dataUrlFromBytes(buffer, mimeType),
        mimeType,
        error: undefined
      },
      settings.size
    );
    if (adjusted.actualSize !== settings.size) return result;

    const formatWarning =
      settings.outputFormat === "webp" ? "本地补齐尺寸暂以 PNG 保存，未继续输出 WebP。" : undefined;
    const resizeWarning = `后端原生图片尺寸为 ${backendDimensions.size}，已用本地重采样补齐到 ${settings.size}；这不是模型原生高分辨率。`;
    return {
      ...adjusted,
      backendActualSize: backendDimensions.size,
      backendActualWidth: backendDimensions.width,
      backendActualHeight: backendDimensions.height,
      localResizeApplied: true,
      requestSizeStrategy: result.requestSizeStrategy,
      sizeMismatch: true,
      warnings: [...(result.warnings || []), resizeWarning, ...(formatWarning ? [formatWarning] : [])],
      error: [result.error, resizeWarning, formatWarning].filter(Boolean).join(" ")
    };
  } catch {
    return result;
  }
};

const sanitizeOutputCompression = (settings: GenerationRequestSettings): number | undefined => {
  if (settings.outputFormat !== "jpeg" && settings.outputFormat !== "webp") return undefined;
  if (typeof settings.outputCompression !== "number") return 80;
  return clamp(Math.round(settings.outputCompression), 1, 100);
};

const buildFinalPrompt = (prompt: string, settings: GenerationRequestSettings): string => {
  const trimmed = prompt.trim();
  let modePrompt = trimmed;
  if (settings.promptMode === "creative") {
    modePrompt = `${trimmed}\n\n创意增强要求：在不改变核心主体、构图方向和可见文字约束的前提下，允许提升画面完成度、材质细节、光影层次和整体观感。`;
  } else if (settings.promptMode === "strict") {
    modePrompt = `${trimmed}\n\n保真要求：严格按照上面的提示词执行，优先保留构图、配色、版式、文字层级、主体身份边界和负面约束，不要擅自新增品牌、Logo、价格、型号、日期或未提供的数据。`;
  }
  return `${modePrompt}\n\n生成域专用尺寸约束：最终输出画布必须是 ${settings.size} 像素，画面比例必须为 ${settings.aspectRatio}。不得输出低分辨率图、竖屏替代图或沿用参考图原始画幅；如上传了参考图，只把它作为主体、风格或编辑依据，最终画布尺寸仍以 ${settings.size} 为准。`;
};

const normalizeGenerationMainModel = (value: string | undefined): string =>
  value?.trim() || DEFAULT_MAIN_MODEL;

const migrateStoredGenerationMainModel = (value: string | undefined): string => {
  const model = value?.trim() || "";
  if (!model || model === LEGACY_DEFAULT_MAIN_MODEL) return DEFAULT_MAIN_MODEL;
  return model;
};

const normalizeTaskVisibility = (value: GenerationTaskVisibility | undefined): GenerationTaskVisibility =>
  value === "archived" || value === "hidden" ? value : "active";

const normalizeStoredProviders = (
  stored: StoredGenerationConfig,
  legacyApiKey: string
): EffectiveGenerationProvider[] => {
  const legacyProvider = createDefaultProvider(legacyApiKey);
  const providers = Array.isArray(stored.providers)
    ? stored.providers
        .map((provider, index): EffectiveGenerationProvider | null => {
          const id = provider.id?.trim() || (index === 0 ? legacyProvider.id : randomUUID());
          const createdAt = provider.createdAt || new Date().toISOString();
          const providerType = normalizeProviderType(provider.providerType);
          return {
            id,
            name: provider.name?.trim() || (providerType === "openrouter" ? "OpenRouter" : index === 0 ? "默认 API 供应商" : `API 供应商 ${index + 1}`),
            providerType,
            apiBaseUrl:
              provider.apiBaseUrl?.trim() ||
              (providerType === "openrouter" ? DEFAULT_OPENROUTER_BASE_URL : legacyProvider.apiBaseUrl),
            apiKey: decryptStoredProviderApiKey(provider),
            apiMode: providerType === "openrouter" ? "images" : provider.apiMode === "responses" ? "responses" : "images",
            imageModel:
              provider.imageModel?.trim() ||
              (providerType === "openrouter" ? DEFAULT_OPENROUTER_IMAGE_MODEL : legacyProvider.imageModel),
            mainModel: migrateStoredGenerationMainModel(provider.mainModel),
            saveApiKey: Boolean(provider.saveApiKey),
            createdAt,
            updatedAt: provider.updatedAt || createdAt
          };
        })
        .filter((provider): provider is EffectiveGenerationProvider => Boolean(provider))
    : [];

  if (providers.length) return providers;
  const legacyProviderType = normalizeProviderType(stored.providerType);
  return [
    {
      ...legacyProvider,
      providerType: legacyProviderType,
      apiBaseUrl:
        stored.apiBaseUrl?.trim() ||
        (legacyProviderType === "openrouter" ? DEFAULT_OPENROUTER_BASE_URL : legacyProvider.apiBaseUrl),
      apiMode:
        legacyProviderType === "openrouter"
          ? "images"
          : stored.apiMode === "responses"
            ? "responses"
            : legacyProvider.apiMode,
      imageModel:
        stored.imageModel?.trim() ||
        (legacyProviderType === "openrouter" ? DEFAULT_OPENROUTER_IMAGE_MODEL : legacyProvider.imageModel),
      mainModel: migrateStoredGenerationMainModel(stored.mainModel),
      saveApiKey: Boolean(stored.saveApiKey)
    }
  ];
};

export const buildImagesGenerationPayload = (
  prompt: string,
  settings: GenerationRequestSettings
): Record<string, unknown> => {
  const compression = sanitizeOutputCompression(settings);
  return {
    model: settings.imageModel,
    prompt,
    n: clamp(Math.round(settings.n || 1), 1, 4),
    size: settings.size,
    quality: settings.quality,
    output_format: settings.outputFormat,
    moderation: settings.moderation,
    background: settings.background === "auto" ? undefined : settings.background,
    output_compression: compression
  };
};

export const buildResponsesPayload = (
  prompt: string,
  settings: GenerationRequestSettings,
  referenceImageDataUrls: string[]
): Record<string, unknown> => {
  const compression = sanitizeOutputCompression(settings);
  const tool: Record<string, unknown> = {
    type: "image_generation",
    action: shouldUseReferenceGenerationAction(settings, referenceImageDataUrls) ? "generate" : referenceImageDataUrls.length > 0 ? "edit" : "generate",
    model: settings.imageModel,
    size: settings.size,
    quality: settings.quality,
    output_format: settings.outputFormat,
    moderation: settings.moderation,
    background: settings.background === "auto" ? undefined : settings.background,
    output_compression: compression,
    partial_images: 0
  };
  const content: Array<Record<string, string>> = [{ type: "input_text", text: prompt }];
  referenceImageDataUrls.forEach((imageUrl) => {
    content.push({ type: "input_image", image_url: imageUrl });
  });
  return {
    stream: true,
    model: settings.mainModel,
    store: false,
    tool_choice: { type: "image_generation" },
    tools: [Object.fromEntries(Object.entries(tool).filter(([, value]) => value !== undefined))],
    input: [
      {
        type: "message",
        role: "user",
        content
      }
    ]
  };
};

export const buildCodexResponsesPayload = (
  prompt: string,
  settings: GenerationRequestSettings,
  referenceImageDataUrls: string[]
): Record<string, unknown> => ({
  instructions: "",
  stream: true,
  reasoning: { effort: DEFAULT_REASONING_EFFORT, summary: "auto" },
  parallel_tool_calls: true,
  include: ["reasoning.encrypted_content"],
  ...buildResponsesPayload(prompt, settings, referenceImageDataUrls)
});

type OpenRouterSupportedParameters = Set<string> | string[] | Record<string, unknown> | null | undefined;

const hasOpenRouterParameter = (supportedParameters: OpenRouterSupportedParameters, name: string): boolean => {
  if (!supportedParameters) return false;
  if (supportedParameters instanceof Set) return supportedParameters.has(name);
  if (Array.isArray(supportedParameters)) return supportedParameters.includes(name);
  return Object.prototype.hasOwnProperty.call(supportedParameters, name);
};

const openRouterResolution = (resolution: GenerationRequestSettings["resolution"]): "1K" | "2K" | "4K" => {
  if (resolution === "4k") return "4K";
  if (resolution === "2k") return "2K";
  return "1K";
};

export const buildOpenRouterImagesPayload = (
  prompt: string,
  settings: GenerationRequestSettings,
  referenceImageDataUrls: string[],
  supportedParameters?: OpenRouterSupportedParameters,
  sizeStrategy: GenerationRequestSizeStrategy = "exact_size"
): Record<string, unknown> => {
  const compression = sanitizeOutputCompression(settings);
  const payload: Record<string, unknown> = {
    model: settings.imageModel,
    prompt,
    n: clamp(Math.round(settings.n || 1), 1, 10),
    background: settings.background,
    output_format: settings.outputFormat
  };
  if (compression !== undefined) payload.output_compression = compression;

  if (settings.quality !== "auto") {
    payload.quality = settings.quality;
  }

  if (sizeStrategy === "exact_size") {
    payload.size = settings.size;
  } else if (sizeStrategy === "openrouter_normalized") {
    const canSendResolution = !supportedParameters || hasOpenRouterParameter(supportedParameters, "resolution");
    const canSendAspectRatio = !supportedParameters || hasOpenRouterParameter(supportedParameters, "aspect_ratio");
    if (canSendResolution) payload.resolution = openRouterResolution(settings.resolution);
    if (canSendAspectRatio) payload.aspect_ratio = settings.aspectRatio;
    if (!payload.resolution && !payload.aspect_ratio) payload.aspect_ratio = settings.aspectRatio;
  } else {
    payload.aspect_ratio = settings.aspectRatio;
  }

  if (!payload.size && !payload.resolution && !payload.aspect_ratio) {
    payload.aspect_ratio = settings.aspectRatio;
  }

  if (referenceImageDataUrls.length) {
    payload.input_references = referenceImageDataUrls.map((url) => ({
      type: "image_url",
      image_url: { url }
    }));
  }

  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
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

const isOpenRouterParameterError = (status: number, text: string): boolean =>
  status === 400 && /(unsupported|not supported|invalid|expected|parameter|参数|size|resolution|aspect)/i.test(parseApiErrorMessage(text, ""));

const openRouterImageModelEndpointsUrl = (baseUrl: string, model: string): string | null => {
  const parts = model
    .trim()
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return `${normalizeGenerationBaseUrl(baseUrl)}/images/models/${parts.map(encodeURIComponent).join("/")}/endpoints`;
};

const collectOpenRouterSupportedParameters = (value: unknown, result = new Set<string>()): Set<string> => {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    value.forEach((item) => collectOpenRouterSupportedParameters(item, result));
    return result;
  }
  const record = value as Record<string, unknown>;
  const supported = record.supported_parameters;
  if (supported && typeof supported === "object" && !Array.isArray(supported)) {
    Object.keys(supported).forEach((key) => result.add(key));
  }
  if (Array.isArray(record.endpoints)) collectOpenRouterSupportedParameters(record.endpoints, result);
  if (record.data) collectOpenRouterSupportedParameters(record.data, result);
  return result;
};

const loadOpenRouterSupportedParameters = async (
  baseUrl: string,
  apiKey: string,
  model: string,
  signal: AbortSignal
): Promise<Set<string> | undefined> => {
  const url = openRouterImageModelEndpointsUrl(baseUrl, model);
  if (!url) return undefined;
  try {
    const response = await fetch(url, {
      method: "GET",
      signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      }
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as unknown;
    const supported = collectOpenRouterSupportedParameters(payload);
    return supported.size ? supported : undefined;
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
};

export const parseOpenRouterImagesResponse = async (
  text: string,
  apiKey: string,
  fallback: Pick<GenerationRequestSettings, "outputFormat" | "size" | "quality" | "background">
): Promise<ImageResult[]> => {
  let payload: {
    data?: Array<Record<string, unknown>>;
    b64_json?: string;
    url?: string;
    imageUrl?: string;
    image_url?: string | { url?: string };
    output_format?: string;
    usage?: Record<string, unknown>;
    error?: { code?: string; type?: string; message?: string };
  };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error("OpenRouter Images API 返回不是有效 JSON。");
  }
  if (payload.error) {
    throw new Error(payload.error.message || payload.error.code || payload.error.type || "OpenRouter Images API 返回错误。");
  }

  const items = Array.isArray(payload.data) && payload.data.length ? payload.data : [payload as Record<string, unknown>];
  const results: ImageResult[] = [];
  for (const item of items) {
    const b64 = typeof item.b64_json === "string" ? item.b64_json : "";
    const imageUrl = item.image_url;
    const url =
      typeof item.url === "string"
        ? item.url
        : typeof item.imageUrl === "string"
          ? item.imageUrl
          : typeof imageUrl === "string"
            ? imageUrl
            : imageUrl && typeof imageUrl === "object" && typeof (imageUrl as { url?: unknown }).url === "string"
              ? String((imageUrl as { url: string }).url)
              : "";
    const format = typeof item.output_format === "string" ? item.output_format : fallback.outputFormat;
    const mimeType = outputMimeType(format);
    let dataUrl = "";
    if (b64) {
      dataUrl = b64.startsWith("data:image/") ? b64 : `data:${mimeType};base64,${b64}`;
    } else if (url.startsWith("data:image/")) {
      dataUrl = url;
    } else if (url.startsWith("http://") || url.startsWith("https://")) {
      dataUrl = dataUrlFromBytes(await downloadImageUrl(url, apiKey), mimeType);
    }
    if (!dataUrl) continue;
    results.push(
      withVerifiedDimensions(
        {
          dataUrl,
          mimeType,
          revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
          size: typeof item.size === "string" ? item.size : fallback.size,
          quality: typeof item.quality === "string" ? item.quality : fallback.quality,
          background: typeof item.background === "string" ? item.background : fallback.background,
          usage: payload.usage
        },
        fallback.size
      )
    );
  }
  if (!results.length) throw new Error("OpenRouter Images API 完成了请求，但没有返回可用图片。");
  return results;
};

const requestOpenRouterImages = async (
  baseUrl: string,
  apiKey: string,
  prompt: string,
  settings: GenerationRequestSettings,
  referenceImageDataUrls: string[],
  signal: AbortSignal
): Promise<ImageResult[]> => {
  const endpoint = openRouterImagesEndpoint(baseUrl);
  const supportedParameters = await loadOpenRouterSupportedParameters(baseUrl, apiKey, settings.imageModel, signal);
  const strategies: GenerationRequestSizeStrategy[] = ["exact_size", "openrouter_normalized", "openrouter_aspect_ratio"];
  let lastFailure: { status: number; text: string } | null = null;

  for (const sizeStrategy of strategies) {
    const payload = buildOpenRouterImagesPayload(prompt, settings, referenceImageDataUrls, supportedParameters, sizeStrategy);
    const response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    if (response.ok) {
      const results = await parseOpenRouterImagesResponse(text, apiKey, settings);
      return results.map((result) => ({ ...result, requestSizeStrategy: sizeStrategy }));
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
    form.append("image", blob, `image-${index + 1}.${mimeTypeToExtension(mimeType)}`);
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

const downloadImageUrl = async (url: string, apiKey: string): Promise<ArrayBuffer> => {
  let response = await fetch(url, { headers: { Accept: "image/*,*/*" } });
  if (response.status === 401 || response.status === 403) {
    response = await fetch(url, { headers: { Accept: "image/*,*/*", Authorization: `Bearer ${apiKey}` } });
  }
  if (!response.ok) throw new ModelHttpError(response.status, await response.text());
  return response.arrayBuffer();
};

export const parseImagesResponse = async (
  text: string,
  apiKey: string,
  fallback: Pick<GenerationRequestSettings, "outputFormat" | "size" | "quality" | "background">
): Promise<ImageResult[]> => {
  let payload: {
    data?: Array<Record<string, unknown>>;
    usage?: Record<string, unknown>;
    error?: { code?: string; type?: string; message?: string };
  };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error("生图接口返回不是有效 JSON。");
  }
  if (payload.error) {
    throw new Error(payload.error.message || payload.error.code || payload.error.type || "生图接口返回错误。");
  }
  if (!Array.isArray(payload.data)) throw new Error("生图接口没有返回图片数据。");

  const results: ImageResult[] = [];
  for (const item of payload.data) {
    const b64 = typeof item.b64_json === "string" ? item.b64_json : "";
    const url = typeof item.url === "string" ? item.url : "";
    const format = typeof item.output_format === "string" ? item.output_format : fallback.outputFormat;
    const mimeType = outputMimeType(format);
    let dataUrl = "";
    if (b64) {
      dataUrl = `data:${mimeType};base64,${b64}`;
    } else if (url.startsWith("data:image/")) {
      dataUrl = url;
    } else if (url.startsWith("http://") || url.startsWith("https://")) {
      dataUrl = dataUrlFromBytes(await downloadImageUrl(url, apiKey), mimeType);
    }
    if (!dataUrl) continue;
    results.push(
      withVerifiedDimensions(
        {
          dataUrl,
          mimeType,
          revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
          size: typeof item.size === "string" ? item.size : fallback.size,
          quality: typeof item.quality === "string" ? item.quality : fallback.quality,
          background: typeof item.background === "string" ? item.background : fallback.background,
          usage: payload.usage
        },
        fallback.size
      )
    );
  }
  if (!results.length) throw new Error("生图接口完成了请求，但没有返回可用图片。");
  return results;
};

const parseSseData = (text: string): unknown[] => {
  const events: unknown[] = [];
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      events.push(JSON.parse(data));
    } catch {
      // Ignore keep-alive or vendor-specific non-JSON SSE chunks.
    }
  });
  return events.length ? events : [JSON.parse(text)];
};

const findImageCalls = (
  value: unknown,
  results: Record<string, unknown>[] = [],
  isFinalEventContext = false
): Record<string, unknown>[] => {
  if (!value || typeof value !== "object") return results;
  if (Array.isArray(value)) {
    value.forEach((item) => findImageCalls(item, results, isFinalEventContext));
    return results;
  }
  const record = value as Record<string, unknown>;
  const eventType = typeof record.type === "string" ? record.type : "";
  const nextFinalEventContext =
    isFinalEventContext ||
    eventType === "response.output_item.done" ||
    eventType === "response.output_item.completed" ||
    eventType === "response.completed";
  if (
    record.type === "image_generation_call" &&
    typeof record.result === "string" &&
    (record.status === "completed" || nextFinalEventContext)
  ) {
    results.push(record);
  }
  Object.values(record).forEach((item) => findImageCalls(item, results, nextFinalEventContext));
  return results;
};

export const parseResponsesImageResponse = (
  text: string,
  fallback: Pick<GenerationRequestSettings, "outputFormat" | "size" | "quality" | "background">
): ImageResult[] => {
  const imageCalls = parseSseData(text).flatMap((event) => findImageCalls(event));
  const uniqueCalls = imageCalls.filter((call, index) => {
    const id = typeof call.id === "string" ? call.id : "";
    return !id || imageCalls.findIndex((item) => item.id === id && item.result === call.result) === index;
  });
  const results = uniqueCalls
    .map((call): ImageResult | null => {
      const b64 = typeof call.result === "string" ? call.result : "";
      if (!b64) return null;
      const mimeType = outputMimeType(fallback.outputFormat);
      return withVerifiedDimensions(
        {
          dataUrl: `data:${mimeType};base64,${b64}`,
          mimeType,
          revisedPrompt: typeof call.revised_prompt === "string" ? call.revised_prompt : undefined,
          size: fallback.size,
          quality: fallback.quality,
          background: fallback.background
        },
        fallback.size
      );
    })
    .filter((item): item is ImageResult => Boolean(item));
  if (!results.length) throw new Error("Responses 生图接口没有返回可用图片。");
  return results;
};

const normalizeCreateRequest = (
  request: GenerationCreateRequest,
  config: EffectiveGenerationConfig
): GenerationCreateRequest => {
  const prompt = request.prompt.trim();
  if (!prompt) throw new Error("请先导入或填写生图提示词。");
  if (!request.promptSource.sourceImageDataUrl && !request.promptSource.sourceThumbnailDataUrl) {
    throw new Error("当前提示词缺少原始提取图来源，无法建立后续对比关系。");
  }

  const settings: GenerationRequestSettings = {
    apiMode:
      config.authSource === "codex_oauth"
        ? "responses"
        : config.providerType === "openrouter"
          ? "images"
          : request.settings.apiMode === "responses"
            ? "responses"
            : config.apiMode,
    imageModel: request.settings.imageModel.trim() || config.imageModel,
    mainModel: normalizeGenerationMainModel(request.settings.mainModel || config.mainModel),
    ...normalizeGenerationSizeSettings(request.settings),
    quality: request.settings.quality || "auto",
    outputFormat: request.settings.outputFormat || "png",
    outputCompression: sanitizeOutputCompression(request.settings),
    moderation: request.settings.moderation || "auto",
    background: request.settings.background || "auto",
    promptMode: request.settings.promptMode || "original",
    n: clamp(Math.round(request.settings.n || 1), 1, 4)
  };
  return {
    ...request,
    prompt,
    settings,
    promptSource: {
      ...request.promptSource,
      importedAt: request.promptSource.importedAt || new Date().toISOString()
    },
    referenceImages: request.referenceImages.filter((image) => image.dataUrl.startsWith("data:image/")).slice(0, 8)
  };
};

const hasOutputDimensionProblem = (result: ImageResult | GenerationOutput): boolean => Boolean(result.error);

const summarizeOutputProblems = (
  outputs: Array<ImageResult | GenerationOutput>,
  expectedCount: number
): string | undefined => {
  const messages = outputs
    .map((output, index) => (output.error ? `第 ${index + 1} 张：${output.error}` : ""))
    .filter(Boolean);
  if (outputs.length < expectedCount) {
    messages.unshift(`生图接口只返回了 ${outputs.length}/${expectedCount} 张图片。`);
  }
  return messages.length ? messages.join(" ") : undefined;
};

export class GenerationService {
  private runtimeConfig: EffectiveGenerationConfig | null = null;
  private abortControllers = new Map<string, AbortController>();
  private isQueuePumpActive = false;
  private taskMutationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly rootDir: string) {}

  private configPath(): string {
    return join(this.rootDir, "generation", "config.json");
  }

  private tasksPath(): string {
    return join(this.rootDir, "generation", "tasks.json");
  }

  async getConfig(): Promise<GenerationConfig> {
    const { config, hasLegacyPlainApiKey } = await this.readStoredConfig();
    this.runtimeConfig = this.runtimeConfig ?? config;
    if (hasLegacyPlainApiKey && config.saveApiKey && config.apiKey) {
      await this.writeStoredConfig(config).catch(() => undefined);
    }
    return publicConfig(this.runtimeConfig);
  }

  async saveConfig(update: GenerationConfigUpdate): Promise<GenerationConfig> {
    const existing = await this.getEffectiveConfig();
    const providers = existing.providers.length ? existing.providers : [createDefaultProvider(existing.apiKey)];
    const activeProviderId = update.activeProviderId || existing.activeProviderId || providers[0].id;
    const providerIndex = Math.max(
      providers.findIndex((provider) => provider.id === activeProviderId),
      0
    );
    const existingProvider = providers[providerIndex];
    const now = new Date().toISOString();
    const providerType = normalizeProviderType(update.providerType);
    const nextProvider: EffectiveGenerationProvider = {
      ...existingProvider,
      name: update.providerName?.trim() || existingProvider.name,
      providerType,
      apiBaseUrl:
        update.apiBaseUrl.trim() || (providerType === "openrouter" ? DEFAULT_OPENROUTER_BASE_URL : defaultConfig.apiBaseUrl),
      apiKey: update.apiKey.trim() || existingProvider.apiKey,
      apiMode: providerType === "openrouter" ? "images" : update.apiMode === "responses" ? "responses" : "images",
      imageModel:
        update.imageModel.trim() ||
        (providerType === "openrouter" ? DEFAULT_OPENROUTER_IMAGE_MODEL : defaultConfig.imageModel),
      mainModel: normalizeGenerationMainModel(update.mainModel),
      saveApiKey: Boolean(update.saveApiKey),
      updatedAt: now
    };
    const nextProviders = [...providers];
    nextProviders[providerIndex] = nextProvider;
    const next = configWithActiveProvider({
      authSource: update.authSource === "api" ? "api" : "codex_oauth",
      activeProviderId: nextProvider.id,
      providers: nextProviders,
      imagesConcurrency: clamp(Math.round(update.imagesConcurrency || defaultConfig.imagesConcurrency), 1, 16)
    });
    await this.writeStoredConfig(next);
    this.runtimeConfig = next;
    this.scheduleQueueProcessing();
    return publicConfig(next);
  }

  async saveProvider(update: GenerationProviderConfigUpdate): Promise<GenerationConfig> {
    const existing = await this.getEffectiveConfig();
    const providers = existing.providers.length ? existing.providers : [createDefaultProvider(existing.apiKey)];
    const now = new Date().toISOString();
    const providerIndex = update.id ? providers.findIndex((provider) => provider.id === update.id) : -1;
    const existingProvider = providerIndex >= 0 ? providers[providerIndex] : undefined;
    const providerType = normalizeProviderType(update.providerType);
    const provider: EffectiveGenerationProvider = {
      id: existingProvider?.id || randomUUID(),
      name: update.name.trim() || existingProvider?.name || (providerType === "openrouter" ? "OpenRouter" : "未命名 API 供应商"),
      providerType,
      apiBaseUrl:
        update.apiBaseUrl.trim() ||
        existingProvider?.apiBaseUrl ||
        (providerType === "openrouter" ? DEFAULT_OPENROUTER_BASE_URL : defaultConfig.apiBaseUrl),
      apiKey: update.apiKey.trim() || existingProvider?.apiKey || "",
      apiMode: providerType === "openrouter" ? "images" : update.apiMode === "responses" ? "responses" : "images",
      imageModel:
        update.imageModel.trim() ||
        existingProvider?.imageModel ||
        (providerType === "openrouter" ? DEFAULT_OPENROUTER_IMAGE_MODEL : defaultConfig.imageModel),
      mainModel: normalizeGenerationMainModel(update.mainModel || existingProvider?.mainModel),
      saveApiKey: Boolean(update.saveApiKey),
      createdAt: existingProvider?.createdAt || now,
      updatedAt: now
    };
    const nextProviders = [...providers];
    if (providerIndex >= 0) {
      nextProviders[providerIndex] = provider;
    } else {
      nextProviders.push(provider);
    }
    const next = configWithActiveProvider({
      authSource: "api",
      activeProviderId: provider.id,
      providers: nextProviders,
      imagesConcurrency: existing.imagesConcurrency
    });
    await this.writeStoredConfig(next);
    this.runtimeConfig = next;
    return publicConfig(next);
  }

  async duplicateProvider(id: string): Promise<GenerationConfig> {
    const existing = await this.getEffectiveConfig();
    const providers = existing.providers.length ? existing.providers : [createDefaultProvider(existing.apiKey)];
    const sourceIndex = providers.findIndex((provider) => provider.id === id);
    if (sourceIndex === -1) throw new Error("没有找到要复制的生图供应商。");
    const source = providers[sourceIndex];
    const now = new Date().toISOString();
    const copy: EffectiveGenerationProvider = {
      ...source,
      id: randomUUID(),
      name: `${source.name} 副本`,
      createdAt: now,
      updatedAt: now
    };
    const nextProviders = [...providers.slice(0, sourceIndex + 1), copy, ...providers.slice(sourceIndex + 1)];
    const next = configWithActiveProvider({
      authSource: "api",
      activeProviderId: copy.id,
      providers: nextProviders,
      imagesConcurrency: existing.imagesConcurrency
    });
    await this.writeStoredConfig(next);
    this.runtimeConfig = next;
    return publicConfig(next);
  }

  async deleteProvider(id: string): Promise<GenerationConfig> {
    const existing = await this.getEffectiveConfig();
    const providers = existing.providers.length ? existing.providers : [createDefaultProvider(existing.apiKey)];
    const remainingProviders = providers.filter((provider) => provider.id !== id);
    const nextProviders = remainingProviders.length ? remainingProviders : [createDefaultProvider()];
    const nextActiveProviderId =
      existing.activeProviderId === id ? nextProviders[0].id : existing.activeProviderId || nextProviders[0].id;
    const next = configWithActiveProvider({
      authSource: existing.authSource,
      activeProviderId: nextActiveProviderId,
      providers: nextProviders,
      imagesConcurrency: existing.imagesConcurrency
    });
    await this.writeStoredConfig(next);
    this.runtimeConfig = next;
    return publicConfig(next);
  }

  async selectProvider(id: string): Promise<GenerationConfig> {
    const existing = await this.getEffectiveConfig();
    if (!existing.providers.some((provider) => provider.id === id)) throw new Error("没有找到要切换的生图供应商。");
    const next = configWithActiveProvider({
      authSource: "api",
      activeProviderId: id,
      providers: existing.providers,
      imagesConcurrency: existing.imagesConcurrency
    });
    await this.writeStoredConfig(next);
    this.runtimeConfig = next;
    return publicConfig(next);
  }

  async reorderProviders(ids: string[]): Promise<GenerationConfig> {
    const existing = await this.getEffectiveConfig();
    const orderedProviders = ids
      .map((id) => existing.providers.find((provider) => provider.id === id))
      .filter((provider): provider is EffectiveGenerationProvider => Boolean(provider));
    const missingProviders = existing.providers.filter((provider) => !ids.includes(provider.id));
    const providers = [...orderedProviders, ...missingProviders];
    const next = configWithActiveProvider({
      authSource: existing.authSource,
      activeProviderId: existing.activeProviderId,
      providers: providers.length ? providers : [createDefaultProvider()],
      imagesConcurrency: existing.imagesConcurrency
    });
    await this.writeStoredConfig(next);
    this.runtimeConfig = next;
    return publicConfig(next);
  }

  async clearConfig(): Promise<GenerationConfig> {
    const provider = createDefaultProvider();
    this.runtimeConfig = configWithActiveProvider({
      authSource: defaultConfig.authSource,
      activeProviderId: provider.id,
      providers: [provider],
      imagesConcurrency: defaultConfig.imagesConcurrency
    });
    await this.writeStoredConfig(this.runtimeConfig);
    return publicConfig(this.runtimeConfig);
  }

  async clearAll(): Promise<void> {
    const provider = createDefaultProvider();
    this.runtimeConfig = configWithActiveProvider({
      authSource: defaultConfig.authSource,
      activeProviderId: provider.id,
      providers: [provider],
      imagesConcurrency: defaultConfig.imagesConcurrency
    });
    await rm(join(this.rootDir, "generation"), { recursive: true, force: true });
  }

  async getTasks(): Promise<GenerationTask[]> {
    return this.reconcileStaleRunningTasks(await this.readTasks());
  }

  async deleteTask(id: string): Promise<GenerationTask[]> {
    this.abortControllers.get(id)?.abort(new Error("已删除生图任务。"));
    this.abortControllers.delete(id);
    const tasks = await this.mutateTasks((currentTasks) => {
      const nextTasks = currentTasks.filter((task) => task.id !== id);
      return { tasks: nextTasks, result: nextTasks };
    });
    this.scheduleQueueProcessing();
    return tasks;
  }

  async clearTasks(): Promise<void> {
    for (const controller of this.abortControllers.values()) {
      controller.abort(new Error("已清空生图任务。"));
    }
    this.abortControllers.clear();
    await this.mutateTasks(() => ({ tasks: [], result: undefined }));
  }

  async cancelTask(id: string): Promise<GenerationTask | null> {
    this.abortControllers.get(id)?.abort(new Error("已取消生图任务。"));
    const task = await this.mutateTasks((tasks) => {
      const taskIndex = tasks.findIndex((item) => item.id === id);
      if (taskIndex === -1) return { tasks, result: null };
      const task = tasks[taskIndex];
      if (task.status !== "queued" && task.status !== "running") return { tasks, result: task };
      const canceledTask: GenerationTask = {
        ...task,
        status: "canceled",
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: "已取消生图任务。"
      };
      const nextTasks = [...tasks];
      nextTasks[taskIndex] = canceledTask;
      return { tasks: nextTasks, result: canceledTask };
    });
    this.scheduleQueueProcessing();
    return task;
  }

  async updateTaskVisibility(update: GenerationTaskVisibilityUpdate): Promise<GenerationTask[]> {
    return this.mutateTasks((tasks) => {
      const taskIndex = tasks.findIndex((item) => item.id === update.id);
      if (taskIndex === -1) return { tasks, result: tasks };
      const task = tasks[taskIndex];
      if ((task.status === "queued" || task.status === "running") && update.visibility !== "active") {
        throw new Error("排队中或生成中的任务需要先完成或取消后，才能归档或隐藏。");
      }
      const now = new Date().toISOString();
      const nextTask: GenerationTask = {
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
  }

  async createTask(request: GenerationCreateRequest): Promise<GenerationTask> {
    const config = await this.getEffectiveConfig();
    if (config.authSource === "api" && !config.apiKey.trim()) throw new Error("请先填写生图 API Key。");
    if (config.authSource === "codex_oauth") {
      const status = await getCodexAuthStatus();
      if (!status.available) {
        throw new Error(`请先完成 Codex OAuth 登录：运行 codex login 后再试。${status.error ? `（${status.error}）` : ""}`);
      }
    }
    const normalized = normalizeCreateRequest(request, config);
    const now = new Date().toISOString();
    const task: GenerationTask = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "queued",
      prompt: normalized.prompt,
      finalPrompt: buildFinalPrompt(normalized.prompt, normalized.settings),
      promptSource: normalized.promptSource,
      referenceImages: normalized.referenceImages,
      settings: normalized.settings,
      backend: backendSnapshotForConfig(config),
      outputs: []
    };
    await this.upsertTask(task);
    this.scheduleQueueProcessing();
    return task;
  }

  private scheduleQueueProcessing(): void {
    void this.processQueue().catch(() => undefined);
  }

  private async processQueue(): Promise<void> {
    if (this.isQueuePumpActive) return;
    this.isQueuePumpActive = true;
    try {
      while (true) {
        const config = await this.getEffectiveConfig();
        const availableSlots = clamp(config.imagesConcurrency, 1, 16) - this.abortControllers.size;
        if (availableSlots <= 0) return;
        const tasks = await this.reconcileStaleRunningTasks(await this.readTasks());
        const queuedTasks = tasks
          .filter((task) => task.status === "queued")
          .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
          .slice(0, availableSlots);
        if (!queuedTasks.length) return;
        for (const queuedTask of queuedTasks) {
          await this.startQueuedTask(queuedTask, config);
        }
      }
    } finally {
      this.isQueuePumpActive = false;
      const tasks = await this.readTasks().catch(() => []);
      if (tasks.some((task) => task.status === "queued") && this.abortControllers.size < (await this.getEffectiveConfig()).imagesConcurrency) {
        this.scheduleQueueProcessing();
      }
    }
  }

  private async startQueuedTask(task: GenerationTask, config: EffectiveGenerationConfig): Promise<void> {
    const latestTask = (await this.readTasks()).find((item) => item.id === task.id);
    if (!latestTask || latestTask.status !== "queued") return;
    const now = new Date().toISOString();
    const runningTask: GenerationTask = {
      ...latestTask,
      status: "running",
      startedAt: latestTask.startedAt || now,
      updatedAt: now,
      error: undefined
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error("生图请求超过 10 分钟未响应，请检查 Base URL 或稍后重试。"));
    }, GENERATION_TIMEOUT_MS);
    this.abortControllers.set(runningTask.id, controller);
    await this.upsertTask(runningTask);

    void this.runQueuedTask(runningTask, config, controller, timeout);
  }

  private async runQueuedTask(
    task: GenerationTask,
    config: EffectiveGenerationConfig,
    controller: AbortController,
    timeout: NodeJS.Timeout
  ): Promise<void> {
    try {
      const results = await this.generateWithSizeRetry(task, config, controller.signal);
      task.outputs = results.map((result) => ({
        ...result,
        id: randomUUID(),
        createdAt: new Date().toISOString()
      }));
      const outputProblem = summarizeOutputProblems(task.outputs, task.settings.n);
      task.status = task.outputs.length === task.settings.n && !outputProblem ? "succeeded" : "partial_failed";
      if (!task.outputs.length) task.status = "failed";
      task.error = outputProblem;
      task.updatedAt = new Date().toISOString();
      task.completedAt = task.updatedAt;
      await this.upsertTask(task);
    } catch (error) {
      task.updatedAt = new Date().toISOString();
      task.completedAt = task.updatedAt;
      task.status = controller.signal.aborted ? "canceled" : "failed";
      task.error = error instanceof Error ? error.message : String(error);
      await this.upsertTask(task);
    } finally {
      clearTimeout(timeout);
      this.abortControllers.delete(task.id);
      this.scheduleQueueProcessing();
    }
  }

  private async generateWithSizeRetry(
    task: GenerationTask,
    config: EffectiveGenerationConfig,
    signal: AbortSignal
  ): Promise<ImageResult[]> {
    let results = await this.generate(task, config, signal);
    if (!results.some(hasOutputDimensionProblem) || signal.aborted) return results;
    try {
      const retriedResults = await this.generate(task, config, signal);
      if (retriedResults.length) results = retriedResults;
    } catch (error) {
      const retryMessage = error instanceof Error ? error.message : String(error);
      results = results.map((result) =>
        result.error
          ? {
              ...result,
              error: `${result.error} 自动重试一次仍未拿到合规尺寸：${retryMessage}`
            }
          : result
      );
    }
    if (results.some(hasOutputDimensionProblem) && !signal.aborted) {
      results = results.map((result) => withLocalResizeFallback(result, task.settings));
    }
    return results;
  }

  private async generate(
    task: GenerationTask,
    config: EffectiveGenerationConfig,
    signal: AbortSignal
  ): Promise<ImageResult[]> {
    const referenceImages = task.referenceImages.map((image) => image.dataUrl);
    if (config.authSource === "codex_oauth") {
      let authState = await loadCodexAuthState();
      const results: ImageResult[] = [];
      for (let index = 0; index < task.settings.n; index += 1) {
        const response = await requestCodexResponses(
          buildCodexResponsesPayload(task.finalPrompt, task.settings, referenceImages),
          authState,
          signal
        );
        authState = response.authState;
        results.push(...parseResponsesImageResponse(response.text, task.settings).map((result) => ({
          ...result,
          requestSizeStrategy: "exact_size" as const
        })));
      }
      return results.slice(0, task.settings.n);
    }

    if (config.providerType === "openrouter") {
      return requestOpenRouterImages(
        config.apiBaseUrl,
        config.apiKey,
        task.finalPrompt,
        task.settings,
        referenceImages,
        signal
      );
    }

    if (task.settings.apiMode === "responses") {
      const results: ImageResult[] = [];
      for (let index = 0; index < task.settings.n; index += 1) {
        const text = await requestJson(
          generationEndpoint(config.apiBaseUrl, "responses"),
          config.apiKey,
          buildResponsesPayload(task.finalPrompt, task.settings, referenceImages),
          signal,
          "text/event-stream"
        );
        results.push(...parseResponsesImageResponse(text, task.settings).map((result) => ({
          ...result,
          requestSizeStrategy: "exact_size" as const
        })));
      }
      return results.slice(0, task.settings.n);
    }

    const endpoint = referenceImages.length
      ? generationEndpoint(config.apiBaseUrl, "images/edits")
      : generationEndpoint(config.apiBaseUrl, "images/generations");
    const text = referenceImages.length
      ? await requestEditForm(endpoint, config.apiKey, task.finalPrompt, task.settings, referenceImages, signal)
      : await requestJson(
          endpoint,
          config.apiKey,
          buildImagesGenerationPayload(task.finalPrompt, task.settings),
          signal
        );
    return (await parseImagesResponse(text, config.apiKey, task.settings)).map((result) => ({
      ...result,
      requestSizeStrategy: "exact_size" as const
    }));
  }

  private async readStoredConfig(): Promise<{
    config: EffectiveGenerationConfig;
    hasLegacyPlainApiKey: boolean;
  }> {
    const stored = await readJsonFile<StoredGenerationConfig>(this.configPath(), {});
    const apiKey = decryptStoredApiKey(stored);
    const providers = normalizeStoredProviders(stored, apiKey);
    const activeProviderId = providers.some((provider) => provider.id === stored.activeProviderId)
      ? stored.activeProviderId || providers[0].id
      : providers[0].id;
    const config = configWithActiveProvider({
      authSource:
        stored.authSource === "api"
          ? "api"
          : stored.authSource === "codex_oauth"
            ? "codex_oauth"
            : apiKey
              ? "api"
              : defaultConfig.authSource,
      activeProviderId,
      providers,
      imagesConcurrency: clamp(Math.round(stored.imagesConcurrency || defaultConfig.imagesConcurrency), 1, 16)
    });
    return {
      config,
      hasLegacyPlainApiKey: Boolean(stored.apiKey)
    };
  }

  private async writeStoredConfig(config: EffectiveGenerationConfig): Promise<void> {
    const activeProvider = activeProviderForConfig(config);
    const payload: StoredGenerationConfig = {
      authSource: config.authSource,
      activeProviderId: activeProvider.id,
      providerType: activeProvider.providerType,
      apiBaseUrl: activeProvider.apiBaseUrl,
      apiMode: activeProvider.apiMode,
      imageModel: activeProvider.imageModel,
      mainModel: activeProvider.mainModel,
      saveApiKey: activeProvider.saveApiKey,
      imagesConcurrency: config.imagesConcurrency
    };
    if (activeProvider.saveApiKey && activeProvider.apiKey) {
      payload.encryptedApiKey = encryptApiKey(activeProvider.apiKey);
    }
    payload.providers = config.providers.map((provider) => {
      const storedProvider: StoredGenerationProvider = {
        id: provider.id,
        name: provider.name,
        providerType: provider.providerType,
        apiBaseUrl: provider.apiBaseUrl,
        apiMode: provider.apiMode,
        imageModel: provider.imageModel,
        mainModel: provider.mainModel,
        saveApiKey: provider.saveApiKey,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt
      };
      if (provider.saveApiKey && provider.apiKey) {
        storedProvider.encryptedApiKey = encryptApiKey(provider.apiKey);
      }
      return storedProvider;
    });
    await writeJsonFile(this.configPath(), payload);
  }

  private async getEffectiveConfig(): Promise<EffectiveGenerationConfig> {
    if (this.runtimeConfig) return this.runtimeConfig;
    const { config } = await this.readStoredConfig();
    this.runtimeConfig = config;
    return config;
  }

  private async readTasks(): Promise<GenerationTask[]> {
    const tasks = await readJsonFile<GenerationTask[]>(this.tasksPath(), []);
    return Array.isArray(tasks) ? tasks : [];
  }

  private async reconcileStaleRunningTasks(tasks: GenerationTask[]): Promise<GenerationTask[]> {
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
        error: task.error || "应用或生图进程已重启，这条运行中的任务未完成，请重试。"
      };
    });
    if (changed) await this.writeTasks(next);
    return next;
  }

  private async writeTasks(tasks: GenerationTask[]): Promise<void> {
    await mkdir(join(this.rootDir, "generation"), { recursive: true });
    await writeJsonFile(this.tasksPath(), tasks.slice(0, MAX_STORED_TASKS));
  }

  private async mutateTasks<Result>(
    mutation: (tasks: GenerationTask[]) => { tasks: GenerationTask[]; result: Result } | Promise<{ tasks: GenerationTask[]; result: Result }>
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

  private async upsertTask(task: GenerationTask): Promise<void> {
    await this.mutateTasks((tasks) => {
      const next = [task, ...tasks.filter((item) => item.id !== task.id)].slice(0, MAX_STORED_TASKS);
      return { tasks: next, result: undefined };
    });
  }
}

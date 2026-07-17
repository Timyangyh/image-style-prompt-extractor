import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { normalizeFusedPromptResult, normalizeStyleAnalysis } from "../src/shared/schema";
import type { HistoryItem, ImageEditAnnotationResolveResponse, VisionApiMode } from "../src/shared/types";

export type ModelRequestKind = "analyze" | "fuse" | "annotation";

const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 300_000;
const ANNOTATION_REQUEST_TIMEOUT_MS = 120_000;

export const modelRequestTimeoutMs = (kind: ModelRequestKind): number =>
  kind === "annotation" ? ANNOTATION_REQUEST_TIMEOUT_MS : DEFAULT_MODEL_REQUEST_TIMEOUT_MS;

export const modelRequestTimeoutMessage = (kind: ModelRequestKind): string => {
  const seconds = modelRequestTimeoutMs(kind) / 1000;
  return kind === "annotation"
    ? `标注解析请求超过 ${seconds} 秒未响应，请检查 Base URL、模型状态或稍后重试。`
    : `模型请求超过 ${seconds} 秒未响应，请检查 Base URL、模型状态或稍后重试。`;
};

export const shouldCacheImageEditAnnotationResolution = (
  response: ImageEditAnnotationResolveResponse
): boolean => response.resolution.source === "vision_model";

export class ModelHttpError extends Error {
  status: number;
  responseText: string;

  constructor(status: number, responseText: string) {
    super(`模型接口请求失败：${status} ${responseText.slice(0, 800)}`);
    this.name = "ModelHttpError";
    this.status = status;
    this.responseText = responseText;
  }
}

const corruptFilePath = (path: string): string => {
  const basePath = `${path}.corrupt`;
  if (!existsSync(basePath)) return basePath;
  return `${basePath}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
};

const preserveCorruptJsonFile = async (path: string): Promise<void> => {
  try {
    await rename(path, corruptFilePath(path));
  } catch {
    // If the file cannot be moved, fall back to the caller's default without deleting user data.
  }
};

export const readJsonFile = async <T>(path: string, fallback: T): Promise<T> => {
  if (!existsSync(path)) return fallback;

  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    return fallback;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    await preserveCorruptJsonFile(path);
    return fallback;
  }
};

const windowsJsonWriteQueues = new Map<string, Promise<void>>();

const writeJsonFileOnce = async (
  path: string,
  value: unknown,
  platform: NodeJS.Platform
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  const backupPath = `${tempPath}.backup`;

  try {
    await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    if (platform !== "win32" || !existsSync(path)) {
      await rename(tempPath, path);
      return;
    }

    // Windows rename cannot replace an existing destination. Keep the last
    // valid file available for rollback while installing the new one.
    await rename(path, backupPath);
    try {
      await rename(tempPath, path);
    } catch (error) {
      await rename(backupPath, path).catch(() => undefined);
      throw error;
    }
    await rm(backupPath, { force: true });
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    if (!existsSync(path) && existsSync(backupPath)) {
      await rename(backupPath, path).catch(() => undefined);
    }
    throw error;
  }
};

export const writeJsonFile = async (
  path: string,
  value: unknown,
  platform: NodeJS.Platform = process.platform
): Promise<void> => {
  if (platform !== "win32") {
    await writeJsonFileOnce(path, value, platform);
    return;
  }

  const queueKey = path.toLowerCase();
  const previous = windowsJsonWriteQueues.get(queueKey) || Promise.resolve();
  const current = previous.catch(() => undefined).then(() => writeJsonFileOnce(path, value, platform));
  const tracked = current.finally(() => {
    if (windowsJsonWriteQueues.get(queueKey) === tracked) windowsJsonWriteQueues.delete(queueKey);
  });
  windowsJsonWriteQueues.set(queueKey, tracked);
  await tracked;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const recordText = (record: Record<string, unknown>, key: string): string =>
  typeof record[key] === "string" ? (record[key] as string) : "";

export const getHistoryEntryId = (entry: unknown): string => {
  const record = asRecord(entry);
  return record ? recordText(record, "id") : "";
};

export const normalizeHistoryItemForDisplay = (item: unknown): HistoryItem | null => {
  const record = asRecord(item);
  if (!record) return null;

  try {
    const id = recordText(record, "id");
    if (!id) return null;
    const analysis = normalizeStyleAnalysis(record.analysis, undefined, { enforceChinese: false });
    const thumbnailDataUrl = recordText(record, "thumbnailDataUrl") || recordText(record, "imageDataUrl");
    if (!thumbnailDataUrl) return null;

    const fusedPromptResult = (() => {
      try {
        return record.fusedPromptResult
          ? normalizeFusedPromptResult(record.fusedPromptResult, { enforceRules: false })
          : undefined;
      } catch {
        return undefined;
      }
    })();

    const normalizedItem: HistoryItem = {
      id,
      createdAt: recordText(record, "createdAt") || new Date(0).toISOString(),
      imageDataUrl: recordText(record, "imageDataUrl") || undefined,
      mimeType: recordText(record, "mimeType") || undefined,
      fileName: recordText(record, "fileName") || undefined,
      thumbnailDataUrl,
      primaryType: analysis.image_classification.primary_type || recordText(record, "primaryType") || "unknown",
      universalStylePrompt:
        analysis.style_reference.universal_style_prompt || recordText(record, "universalStylePrompt"),
      analysis,
      editedTextMarkdown: recordText(record, "editedTextMarkdown") || undefined,
      fusedPromptCreatedAt: recordText(record, "fusedPromptCreatedAt") || undefined
    };
    if (fusedPromptResult) normalizedItem.fusedPromptResult = fusedPromptResult;
    return normalizedItem;
  } catch {
    return null;
  }
};

export const normalizeHistory = (items: unknown): HistoryItem[] =>
  Array.isArray(items)
    ? items
        .map(normalizeHistoryItemForDisplay)
        .filter((item): item is HistoryItem => Boolean(item))
    : [];

export const normalizeHistoryItemForStorage = (item: HistoryItem): HistoryItem => {
  const analysis = normalizeStyleAnalysis(item.analysis, undefined, { enforceChinese: false });
  const normalizedItem: HistoryItem = {
    ...item,
    primaryType: analysis.image_classification.primary_type || item.primaryType || "unknown",
    universalStylePrompt: analysis.style_reference.universal_style_prompt || item.universalStylePrompt,
    analysis
  };
  if (item.fusedPromptResult) {
    normalizedItem.fusedPromptResult = normalizeFusedPromptResult(item.fusedPromptResult, { enforceRules: false });
  }
  return normalizedItem;
};

const normalizeVisionBaseUrl = (baseUrl: string): string =>
  baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|responses)$/i, "");

export const chatCompletionsEndpoint = (baseUrl: string): string =>
  `${normalizeVisionBaseUrl(baseUrl)}/chat/completions`;

export const responsesEndpoint = (baseUrl: string): string => `${normalizeVisionBaseUrl(baseUrl)}/responses`;

export const normalizeVisionApiMode = (apiMode: VisionApiMode | undefined): VisionApiMode =>
  apiMode === "responses" || apiMode === "anthropic" || apiMode === "gemini" ? apiMode : "chat_completions";

export const anthropicMessagesEndpoint = (baseUrl: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (/\/messages$/i.test(normalized)) return normalized;
  if (/\/v1$/i.test(normalized)) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
};

export const geminiGenerateContentEndpoint = (baseUrl: string, modelName: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  const fullEndpoint = normalized.match(/^(.*\/models\/)[^/]+(:generateContent)$/i);
  if (fullEndpoint) return `${fullEndpoint[1]}${encodeURIComponent(modelName.trim())}${fullEndpoint[2]}`;
  return `${normalized}/models/${encodeURIComponent(modelName.trim())}:generateContent`;
};

export const visionModelEndpoint = (baseUrl: string, apiMode: VisionApiMode, modelName: string): string => {
  if (apiMode === "responses") return responsesEndpoint(baseUrl);
  if (apiMode === "anthropic") return anthropicMessagesEndpoint(baseUrl);
  if (apiMode === "gemini") return geminiGenerateContentEndpoint(baseUrl, modelName);
  return chatCompletionsEndpoint(baseUrl);
};

export const visionRequestHeaders = (
  apiMode: VisionApiMode,
  apiKey: string,
  endpoint: string
): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (apiMode === "anthropic") {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiMode === "gemini" && isGoogleGeminiEndpoint(endpoint)) {
    headers["x-goog-api-key"] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
};

export const isGoogleGeminiEndpoint = (endpoint: string): boolean =>
  new URL(endpoint).hostname.toLowerCase().endsWith("googleapis.com");

interface VisionModelPayloadOptions {
  apiMode: VisionApiMode;
  modelName: string;
  systemPrompt: string;
  userText: string;
  imageDataUrls: string[];
  includeJsonFormat: boolean;
  temperature: number;
  maxOutputTokens?: number;
}

const geminiInlineImage = (dataUrl: string): { inlineData: { mimeType: string; data: string } } => {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error("Gemini 原生识图只支持 base64 图片数据。");
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2].replace(/\s/g, "")
    }
  };
};

const anthropicImage = (
  dataUrl: string
): { type: "image"; source: { type: "base64"; media_type: string; data: string } } => {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error("Anthropic Messages 识图只支持 base64 图片数据。");
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: match[1],
      data: match[2].replace(/\s/g, "")
    }
  };
};

export const buildVisionModelPayload = (options: VisionModelPayloadOptions): Record<string, unknown> => {
  if (options.apiMode === "responses") {
    return {
      model: options.modelName,
      store: false,
      ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
      ...(options.includeJsonFormat ? { text: { format: { type: "json_object" } } } : {}),
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: options.systemPrompt }]
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: options.userText },
            ...options.imageDataUrls.map((imageUrl) => ({ type: "input_image", image_url: imageUrl }))
          ]
        }
      ]
    };
  }

  if (options.apiMode === "gemini") {
    return {
      systemInstruction: { parts: [{ text: options.systemPrompt }] },
      contents: [
        {
          role: "user",
          parts: [{ text: options.userText }, ...options.imageDataUrls.map(geminiInlineImage)]
        }
      ],
      generationConfig: {
        temperature: options.temperature,
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        ...(options.includeJsonFormat ? { responseMimeType: "application/json" } : {})
      }
    };
  }

  if (options.apiMode === "anthropic") {
    return {
      model: options.modelName,
      system: options.systemPrompt,
      max_tokens: options.maxOutputTokens ?? 16384,
      temperature: options.temperature,
      messages: [
        {
          role: "user",
          content: [
            ...options.imageDataUrls.map(anthropicImage),
            { type: "text", text: options.userText }
          ]
        }
      ]
    };
  }

  return {
    model: options.modelName,
    temperature: options.temperature,
    ...(options.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}),
    ...(options.includeJsonFormat ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: options.systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: options.userText },
          ...options.imageDataUrls.map((imageUrl) => ({ type: "image_url", image_url: { url: imageUrl } }))
        ]
      }
    ]
  };
};

export const extractJsonText = (text: string): string => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);

  return trimmed;
};

export const parseExtractedJson = (rawText: string, label: string): unknown => {
  try {
    return JSON.parse(extractJsonText(rawText)) as unknown;
  } catch {
    throw new Error(`模型返回的${label}不是有效 JSON，请重试或更换模型。`);
  }
};

export const completionTextFromResponse = (text: string): string => {
  let payload: {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error("模型接口返回不是有效 JSON。");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("\n");
  }

  throw new Error("模型返回中没有可解析的文本内容。");
};

export const responsesTextFromResponse = (text: string): string => {
  let payload: {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; output_text?: string }> }>;
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error("模型接口返回不是有效 JSON。");
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  const outputText = (payload.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || part.output_text || "")
    .filter(Boolean)
    .join("\n");
  if (outputText) return outputText;
  if (payload.choices) return completionTextFromResponse(text);
  throw new Error("Responses 模型返回中没有可解析的文本内容。");
};

export const geminiTextFromResponse = (text: string): string => {
  let payload: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error("模型接口返回不是有效 JSON。");
  }

  const candidateText = (payload.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n");
  if (candidateText) return candidateText;
  if (payload.choices) return completionTextFromResponse(text);
  throw new Error("Gemini 模型返回中没有可解析的文本内容。");
};

export const anthropicTextFromResponse = (text: string): string => {
  let payload: {
    content?: Array<{ type?: string; text?: string }>;
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    throw new Error("模型接口返回不是有效 JSON。");
  }

  const contentText = (payload.content || [])
    .filter((part) => !part.type || part.type === "text")
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n");
  if (contentText) return contentText;
  if (payload.choices) return completionTextFromResponse(text);
  throw new Error("Anthropic Messages 模型返回中没有可解析的文本内容。");
};

export const visionTextFromResponse = (apiMode: VisionApiMode, text: string): string => {
  if (apiMode === "responses") return responsesTextFromResponse(text);
  if (apiMode === "anthropic") return anthropicTextFromResponse(text);
  if (apiMode === "gemini") return geminiTextFromResponse(text);
  return completionTextFromResponse(text);
};

export const shouldRetryFusedPrompt = (message: string): boolean =>
  ["必须使用中文提示词", "不能包含占位符", "不能为空", "不能使用"].some((keyword) =>
    message.includes(keyword)
  );

export const shouldRetryWithoutResponseFormat = (error: unknown, includeResponseFormat: boolean): boolean => {
  if (!includeResponseFormat) return false;
  if (error instanceof ModelHttpError && error.status >= 400 && error.status < 500) return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("response_format");
};

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.message.includes("This operation was aborted"));

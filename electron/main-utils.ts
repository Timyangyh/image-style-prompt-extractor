import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { normalizeFusedPromptResult, normalizeStyleAnalysis } from "../src/shared/schema";
import type { HistoryItem } from "../src/shared/types";

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

export const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );

  try {
    await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
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

export const chatCompletionsEndpoint = (baseUrl: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  return `${normalized}/chat/completions`;
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

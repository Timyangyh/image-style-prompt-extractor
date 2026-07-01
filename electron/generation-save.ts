import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";

const invalidFileNameCharacters = /[<>:"/\\|?*\u0000-\u001f]/g;

export const generationOutputExtension = (mimeType: string): "jpg" | "png" | "webp" => {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
};

export const generationOutputFileName = (suggestedFileName: string, mimeType: string): string => {
  const extension = generationOutputExtension(mimeType);
  const rawBaseName = basename(suggestedFileName.trim() || "generated-image").replace(/\.[a-z0-9]+$/i, "");
  const safeBaseName = rawBaseName
    .replace(invalidFileNameCharacters, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .trim();
  return `${safeBaseName || "generated-image"}.${extension}`;
};

export const uniqueGenerationOutputPath = (
  directoryPath: string,
  fileName: string,
  pathExists: (path: string) => boolean = existsSync
): string => {
  const extension = extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  let candidate = join(directoryPath, fileName);
  let index = 2;

  while (pathExists(candidate)) {
    candidate = join(directoryPath, `${baseName} (${index})${extension}`);
    index += 1;
  }
  return candidate;
};

export const dataUrlToGenerationOutputBuffer = (dataUrl: string): { mimeType: string; buffer: Buffer } => {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+)?(;base64)?,([\s\S]*)$/i);
  if (!match || match[2] !== ";base64") {
    throw new Error("生成图片不是有效的 base64 图片数据，无法保存。");
  }
  return {
    mimeType: match[1] || "image/png",
    buffer: Buffer.from(match[3], "base64")
  };
};

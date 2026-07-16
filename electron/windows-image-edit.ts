import type { ImageEditAnnotationResolution } from "../src/shared/types";

const textRemovalPattern = /删除|移除|去除|去掉|删去|删掉|清除|擦除|抹除|消除|不保留|不要保留/;
const negatedTextRemovalPattern =
  /(?:不要|不得|禁止|不能|切勿|避免)\s*(?:删除|移除|去除|去掉|删去|删掉|清除|擦除|抹除|消除)/;
const textReplacementPattern = /替换|换成|改成|改为|更换为|修改为|替代为/;

export const normalizeWindowsTextRemovalResolution = (
  resolution: ImageEditAnnotationResolution,
  platform: NodeJS.Platform = process.platform
): ImageEditAnnotationResolution => {
  if (platform !== "win32") return resolution;

  let changed = false;
  const items = resolution.items.map((item) => {
    const hasOriginalText = Boolean(item.originalText?.trim());
    const hasReplacementText = Boolean(item.replacementText?.trim());
    const isRemovalOnly =
      textRemovalPattern.test(item.requestedChange) &&
      !negatedTextRemovalPattern.test(item.requestedChange) &&
      !textReplacementPattern.test(item.requestedChange);
    if (!hasOriginalText || hasReplacementText || !isRemovalOnly) return item;
    changed = true;
    return { ...item, originalText: undefined, replacementText: undefined };
  });

  return changed ? { ...resolution, items } : resolution;
};

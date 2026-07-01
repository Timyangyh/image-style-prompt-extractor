import type { GenerationAspectRatio, GenerationRequestSettings, GenerationResolution } from "./types";

export const defaultGenerationResolution: GenerationResolution = "1k";
export const defaultGenerationAspectRatio: GenerationAspectRatio = "1:1";

export const generationResolutionOptions: Array<{
  value: GenerationResolution;
  label: string;
  description: string;
}> = [
  { value: "1k", label: "1K", description: "标准尺寸" },
  { value: "2k", label: "2K", description: "高清尺寸" },
  { value: "4k", label: "4K", description: "超高清尺寸" }
];

export const generationAspectRatioOptions: Array<{
  value: GenerationAspectRatio;
  label: string;
}> = [
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "5:4", label: "5:4" },
  { value: "3:4", label: "3:4" },
  { value: "4:3", label: "4:3" },
  { value: "2:3", label: "2:3" },
  { value: "3:2", label: "3:2" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "9:21", label: "9:21" },
  { value: "21:9", label: "21:9" }
];

export const generationSizePresets: Record<GenerationResolution, Record<GenerationAspectRatio, [number, number]>> = {
  "1k": {
    "1:1": [1024, 1024],
    "4:5": [1024, 1280],
    "5:4": [1280, 1024],
    "3:4": [1152, 1536],
    "4:3": [1536, 1152],
    "2:3": [1024, 1536],
    "3:2": [1536, 1024],
    "9:16": [864, 1536],
    "16:9": [1536, 864],
    "9:21": [672, 1568],
    "21:9": [1568, 672]
  },
  "2k": {
    "1:1": [2048, 2048],
    "4:5": [1600, 2000],
    "5:4": [2000, 1600],
    "3:4": [1536, 2048],
    "4:3": [2048, 1536],
    "2:3": [1344, 2016],
    "3:2": [2016, 1344],
    "9:16": [1152, 2048],
    "16:9": [2048, 1152],
    "9:21": [1152, 2688],
    "21:9": [2688, 1152]
  },
  "4k": {
    "1:1": [2880, 2880],
    "4:5": [2560, 3200],
    "5:4": [3200, 2560],
    "3:4": [2448, 3264],
    "4:3": [3264, 2448],
    "2:3": [2336, 3504],
    "3:2": [3504, 2336],
    "9:16": [2160, 3840],
    "16:9": [3840, 2160],
    "9:21": [1632, 3808],
    "21:9": [3808, 1632]
  }
};

export const normalizeGenerationResolution = (value: unknown): GenerationResolution => {
  if (value === "4k") return "4k";
  if (value === "2k") return "2k";
  if (value === "1k" || value === "standard") return "1k";
  return defaultGenerationResolution;
};

export const normalizeGenerationAspectRatio = (value: unknown): GenerationAspectRatio => {
  return generationAspectRatioOptions.some((option) => option.value === value)
    ? (value as GenerationAspectRatio)
    : defaultGenerationAspectRatio;
};

export const resolveGenerationSize = (
  resolution: unknown = defaultGenerationResolution,
  aspectRatio: unknown = defaultGenerationAspectRatio
): string => {
  const normalizedResolution = normalizeGenerationResolution(resolution);
  const normalizedRatio = normalizeGenerationAspectRatio(aspectRatio);
  const [width, height] = generationSizePresets[normalizedResolution][normalizedRatio];
  return `${width}x${height}`;
};

export const findGenerationPresetForSize = (
  size: unknown
): { resolution: GenerationResolution; aspectRatio: GenerationAspectRatio } | null => {
  const normalizedSize = String(size ?? "").trim();
  if (!normalizedSize) return null;
  for (const [resolution, ratios] of Object.entries(generationSizePresets)) {
    for (const [aspectRatio, dimensions] of Object.entries(ratios)) {
      if (`${dimensions[0]}x${dimensions[1]}` === normalizedSize) {
        return {
          resolution: resolution as GenerationResolution,
          aspectRatio: aspectRatio as GenerationAspectRatio
        };
      }
    }
  }
  return null;
};

export const normalizeGenerationSizeSettings = (
  settings: Partial<GenerationRequestSettings>
): Pick<GenerationRequestSettings, "resolution" | "aspectRatio" | "size"> => {
  const presetFromSize = findGenerationPresetForSize(settings.size);
  const resolution = normalizeGenerationResolution(settings.resolution ?? presetFromSize?.resolution);
  const aspectRatio = normalizeGenerationAspectRatio(settings.aspectRatio ?? presetFromSize?.aspectRatio);
  return {
    resolution,
    aspectRatio,
    size: resolveGenerationSize(resolution, aspectRatio)
  };
};

import {
  AlertCircle,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Check,
  Clipboard,
  Copy,
  Download,
  FileJson,
  FileText,
  History,
  ImagePlus,
  Loader2,
  Maximize2,
  PenLine,
  RotateCcw,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  X
} from "lucide-react";
import {
  ChangeEvent,
  Dispatch,
  DragEvent,
  MouseEvent,
  PointerEvent,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { hasInformationLayoutMode, resolveFuseMode } from "./shared/fuse-mode";
import {
  generationAspectRatioOptions,
  generationResolutionOptions,
  normalizeGenerationSizeSettings,
  resolveGenerationSize
} from "./shared/generation-size";
import { composePixelProtectedRgba } from "./shared/pixel-protection";
import { createLocalSourceCapture } from "./shared/schema";
import type {
  FusePromptControls,
  FusePromptMode,
  FusedPromptJson,
  GenerationConfig,
  GenerationConfigUpdate,
  GenerationCreateRequest,
  GenerationOutput,
  GenerationPromptSource,
  GenerationPromptSourceKind,
  GenerationProviderConfig,
  GenerationProviderType,
  GenerationReferenceImage,
  GenerationRequestSettings,
  GenerationTask,
  GenerationTaskVisibility,
  HistoryItem,
  ImageEditAnnotationItem,
  ImageEditAnnotationImage,
  ImageEditCreateRequest,
  ImageEditFidelityMode,
  ImageEditLocalProtectionMaskImage,
  ImageEditMaskStats,
  ImageEditMaskImage,
  ImageEditOutput,
  ImageEditOutputVariant,
  ImageEditRequestSettings,
  ImageEditSourceImage,
  ImageEditSourceKind,
  ImageEditTask,
  ImageEditTaskVisibility,
  ModelConfig,
  ModelConfigUpdate,
  SourceCapture,
  SourceCaptureSourceType,
  StyleAnalysis
} from "./shared/types";

const defaultConfig: ModelConfig = {
  apiBaseUrl: "https://api.openai.com/v1",
  modelName: "gpt-4o-mini",
  saveApiKey: false,
  hasApiKey: false
};

const defaultGenerationProvider: GenerationProviderConfig = {
  id: "default-api-provider",
  name: "默认 API 供应商",
  providerType: "openai_compatible",
  apiBaseUrl: "https://api.openai.com/v1",
  apiMode: "images",
  imageModel: "gpt-image-2",
  mainModel: "gpt-5.5",
  saveApiKey: false,
  hasApiKey: false,
  createdAt: "",
  updatedAt: ""
};

const openRouterGenerationDefaults = {
  providerType: "openrouter" as GenerationProviderType,
  name: "OpenRouter",
  apiBaseUrl: "https://openrouter.ai/api/v1",
  apiMode: "images" as const,
  imageModel: "openai/gpt-image-2"
};

const defaultGenerationConfig: GenerationConfig = {
  authSource: "codex_oauth",
  activeProviderId: defaultGenerationProvider.id,
  providers: [defaultGenerationProvider],
  providerType: defaultGenerationProvider.providerType,
  apiBaseUrl: defaultGenerationProvider.apiBaseUrl,
  apiMode: defaultGenerationProvider.apiMode,
  imageModel: defaultGenerationProvider.imageModel,
  mainModel: defaultGenerationProvider.mainModel,
  saveApiKey: false,
  hasApiKey: false,
  codexOAuthAvailable: false,
  codexOAuthPath: "",
  imagesConcurrency: 4
};

const defaultGenerationSettings: GenerationRequestSettings = {
  apiMode: "images",
  imageModel: "gpt-image-2",
  mainModel: "gpt-5.5",
  resolution: "1k",
  aspectRatio: "1:1",
  size: resolveGenerationSize("1k", "1:1"),
  quality: "auto",
  outputFormat: "png",
  outputCompression: 80,
  moderation: "auto",
  background: "auto",
  promptMode: "original",
  n: 1
};

const defaultImageEditSettings: ImageEditRequestSettings = {
  apiMode: defaultGenerationSettings.apiMode,
  imageModel: defaultGenerationSettings.imageModel,
  mainModel: defaultGenerationSettings.mainModel,
  resolution: defaultGenerationSettings.resolution,
  aspectRatio: defaultGenerationSettings.aspectRatio,
  size: defaultGenerationSettings.size,
  quality: defaultGenerationSettings.quality,
  outputFormat: defaultGenerationSettings.outputFormat,
  outputCompression: defaultGenerationSettings.outputCompression,
  moderation: defaultGenerationSettings.moderation,
  background: defaultGenerationSettings.background,
  n: 1
};

type GenerationConfigDraft = GenerationConfigUpdate &
  Pick<
    GenerationConfig,
    | "providers"
    | "hasApiKey"
    | "codexOAuthAvailable"
    | "codexOAuthPath"
    | "codexOAuthAccountId"
    | "codexOAuthLastRefresh"
    | "codexOAuthError"
  >;

const defaultGenerationDraft: GenerationConfigDraft = {
  ...defaultGenerationConfig,
  apiKey: ""
};

type ConfigDraft = ModelConfigUpdate & { hasApiKey: boolean };

const defaultDraftConfig: ConfigDraft = {
  ...defaultConfig,
  apiKey: ""
};

const defaultFuseControls: FusePromptControls = {
  useTargetHair: false,
  useTargetPose: false,
  useExtractedText: false
};

const defaultImagePreviewZoom = {
  enabled: false,
  originX: 50,
  originY: 50
};

const extractedTextFromAnalysis = (analysis: StyleAnalysis | null): string =>
  analysis?.extracted_text.applies ? analysis.extracted_text.markdown : "";

type ImageState = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  thumbnailDataUrl: string;
  sourceCapture: SourceCapture;
};

type ImagePreviewState = {
  title: string;
  dataUrl: string;
  mode?: "natural" | "fit";
};

type ImagePreviewZoomState = {
  enabled: boolean;
  originX: number;
  originY: number;
};

type ComparePreviewState = {
  kind: "generation" | "image_edit";
  taskId: string;
  outputId: string;
  outputIndex: number;
  outputCount: number;
  sourceTitle: string;
  sourceDataUrl: string;
  outputTitle: string;
  outputDataUrl: string;
};

type GenerationPromptOption = {
  kind: GenerationPromptSourceKind;
  label: string;
  value: string;
};

type ImageEditTool = "brush" | "arrow" | "box" | "text";

type ImageEditAnnotation = {
  id: string;
  tool: ImageEditTool;
  color: string;
  note?: string;
  text?: string;
  points?: Array<{ x: number; y: number }>;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
};

type ImageEditMaskPurpose = "strict_backend" | "local_protection";

type RenderedImageEditMask = {
  dataUrl: string;
  stats: ImageEditMaskStats;
};

type ImageEditMaskCapability = {
  supportsMaskEdit: boolean;
  reason?: string;
};

const clampValue = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const imageEditToolLabelMap: Record<ImageEditTool, string> = {
  brush: "画笔",
  arrow: "箭头",
  box: "框选",
  text: "文字批注"
};

const imageEditToolOptions: Array<{ value: ImageEditTool; label: string; icon: JSX.Element }> = [
  { value: "brush", label: imageEditToolLabelMap.brush, icon: <PenLine size={16} /> },
  { value: "arrow", label: imageEditToolLabelMap.arrow, icon: <ArrowUpRight size={16} /> },
  { value: "box", label: imageEditToolLabelMap.box, icon: <Square size={16} /> },
  { value: "text", label: "文字", icon: <Type size={16} /> }
];

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });

type ImageCompressOptions = {
  maxSize: number;
  maxBytes?: number;
  initialQuality?: number;
  minQuality?: number;
};

const createCompressedImage = (
  dataUrl: string,
  {
    maxSize,
    maxBytes,
    initialQuality = 0.82,
    minQuality = 0.5
  }: ImageCompressOptions
): Promise<string> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      let maxDimension = maxSize;
      let bestDataUrl = dataUrl;

      for (let scalePass = 0; scalePass < 7; scalePass += 1) {
        const scale = Math.min(maxDimension / image.width, maxDimension / image.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("无法压缩图片。"));
          return;
        }

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        for (
          let quality = initialQuality;
          quality >= minQuality;
          quality = Math.round((quality - 0.08) * 100) / 100
        ) {
          bestDataUrl = canvas.toDataURL("image/jpeg", quality);
          if (!maxBytes || bestDataUrl.length <= maxBytes) {
            resolve(bestDataUrl);
            return;
          }
        }

        if (!maxBytes || maxDimension <= 640) {
          resolve(bestDataUrl);
          return;
        }
        maxDimension = Math.max(640, Math.round(maxDimension * 0.82));
      }

      resolve(bestDataUrl);
    };
    image.onerror = () => reject(new Error("图片压缩失败。"));
    image.src = dataUrl;
  });

const createModelImage = (dataUrl: string): Promise<string> =>
  createCompressedImage(dataUrl, {
    maxSize: 2048,
    maxBytes: 2 * 1024 * 1024,
    initialQuality: 0.86,
    minQuality: 0.62
  });

const createHistoryImage = (dataUrl: string): Promise<string> =>
  createCompressedImage(dataUrl, {
    maxSize: 2048,
    maxBytes: 340 * 1024,
    initialQuality: 0.78,
    minQuality: 0.42
  });

const createThumbnail = (dataUrl: string, maxSize = 360): Promise<string> =>
  createCompressedImage(dataUrl, {
    maxSize,
    maxBytes: 36 * 1024,
    initialQuality: 0.78,
    minQuality: 0.5
  });

type EraseStroke = {
  brushSizeRatio: number;
  points: Array<{ x: number; y: number }>;
};

type ReferenceEditSettings = {
  cropPercent: number;
  rotation: number;
  scalePercent: number;
  eraseStrokes: EraseStroke[];
};

const loadImageElement = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片载入失败。"));
    image.src = dataUrl;
  });

const imageDimensionsFromDataUrl = async (dataUrl: string): Promise<{ width: number; height: number }> => {
  const image = await loadImageElement(dataUrl);
  return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
};

const closestImageEditAspectRatio = (width: number, height: number): ImageEditRequestSettings["aspectRatio"] => {
  const sourceRatio = width / height;
  const ratioValue = (ratio: string): number => {
    const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
    return ratioWidth / ratioHeight;
  };
  return generationAspectRatioOptions.reduce<ImageEditRequestSettings["aspectRatio"]>((best, option) => {
    const bestDelta = Math.abs(Math.log(sourceRatio / ratioValue(best)));
    const nextDelta = Math.abs(Math.log(sourceRatio / ratioValue(option.value)));
    return nextDelta < bestDelta ? option.value : best;
  }, "1:1");
};

const imageEditResolutionForDimensions = (width: number, height: number): ImageEditRequestSettings["resolution"] => {
  const longestEdge = Math.max(width, height);
  if (longestEdge >= 2800) return "4k";
  if (longestEdge >= 1500) return "2k";
  return "1k";
};

const imageEditSettingsForDimensions = (
  width: number,
  height: number,
  config: GenerationConfig
): ImageEditRequestSettings => {
  const resolution = imageEditResolutionForDimensions(width, height);
  const aspectRatio = closestImageEditAspectRatio(width, height);
  return {
    ...defaultImageEditSettings,
    apiMode:
      config.authSource === "codex_oauth"
        ? "responses"
        : config.providerType === "openrouter"
          ? "images"
          : config.apiMode,
    imageModel: config.imageModel,
    mainModel: config.mainModel,
    resolution,
    aspectRatio,
    size: resolveGenerationSize(resolution, aspectRatio)
  };
};

const imageEditAnnotationAnchor = (annotation: ImageEditAnnotation): { x: number; y: number } | null => {
  if (annotation.tool === "brush") return annotation.points?.[0] || null;
  if (annotation.tool === "box" && annotation.start && annotation.end) {
    return {
      x: Math.min(annotation.start.x, annotation.end.x),
      y: Math.min(annotation.start.y, annotation.end.y)
    };
  }
  if (annotation.tool === "arrow") return annotation.end || annotation.start || null;
  return annotation.start || null;
};

const imageEditAnnotationPositionHint = (annotation: ImageEditAnnotation): string | undefined => {
  const anchor = imageEditAnnotationAnchor(annotation);
  if (!anchor) return undefined;
  return `位于画面约 ${Math.round(anchor.x * 100)}% x ${Math.round(anchor.y * 100)}%`;
};

const buildImageEditAnnotationItems = (annotations: ImageEditAnnotation[]): ImageEditAnnotationItem[] =>
  annotations.map((annotation, index) => ({
    index: index + 1,
    label: `标注 ${index + 1}`,
    tool: annotation.tool,
    note: annotation.note?.trim() || "按总体改图说明处理此处。",
    positionHint: imageEditAnnotationPositionHint(annotation)
  }));

const drawImageEditAnnotationLabel = (
  context: CanvasRenderingContext2D,
  index: number,
  point: { x: number; y: number },
  width: number,
  height: number
) => {
  const label = String(index + 1);
  const radius = Math.max(16, Math.round(Math.min(width, height) * 0.028));
  const x = Math.min(Math.max(point.x * width, radius + 2), width - radius - 2);
  const y = Math.min(Math.max(point.y * height, radius + 2), height - radius - 2);
  context.save();
  context.beginPath();
  context.fillStyle = "#111827";
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(3, Math.round(radius * 0.16));
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = `800 ${Math.round(radius * 1.1)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x, y + 1);
  context.restore();
};

const drawImageEditAnnotations = (
  context: CanvasRenderingContext2D,
  annotations: ImageEditAnnotation[],
  width: number,
  height: number,
  options: { textMode?: "number_only" | "full_note" } = {}
) => {
  context.lineCap = "round";
  context.lineJoin = "round";
  annotations.forEach((annotation, annotationIndex) => {
    const anchor = imageEditAnnotationAnchor(annotation);
    context.strokeStyle = annotation.color;
    context.fillStyle = annotation.color;
    context.lineWidth = Math.max(4, Math.round(Math.min(width, height) * 0.012));
    if (annotation.tool === "brush" && annotation.points?.length) {
      if (annotation.points.length === 1) {
        const [point] = annotation.points;
        context.beginPath();
        context.arc(point.x * width, point.y * height, context.lineWidth * 0.85, 0, Math.PI * 2);
        context.fill();
        if (anchor) drawImageEditAnnotationLabel(context, annotationIndex, anchor, width, height);
        return;
      }
      context.beginPath();
      annotation.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      if (anchor) drawImageEditAnnotationLabel(context, annotationIndex, anchor, width, height);
      return;
    }
    if ((annotation.tool === "arrow" || annotation.tool === "box") && annotation.start && annotation.end) {
      const startX = annotation.start.x * width;
      const startY = annotation.start.y * height;
      const endX = annotation.end.x * width;
      const endY = annotation.end.y * height;
      if (annotation.tool === "box") {
        context.strokeRect(startX, startY, endX - startX, endY - startY);
        if (anchor) drawImageEditAnnotationLabel(context, annotationIndex, anchor, width, height);
        return;
      }
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
      const angle = Math.atan2(endY - startY, endX - startX);
      const headLength = Math.max(18, Math.min(width, height) * 0.035);
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
      context.moveTo(endX, endY);
      context.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
      context.stroke();
      if (anchor) drawImageEditAnnotationLabel(context, annotationIndex, anchor, width, height);
      return;
    }
    if (annotation.tool === "text" && annotation.start) {
      if (options.textMode === "number_only") {
        if (anchor) drawImageEditAnnotationLabel(context, annotationIndex, anchor, width, height);
        return;
      }
      const fontSize = Math.max(24, Math.round(Math.min(width, height) * 0.045));
      const x = annotation.start.x * width;
      const y = annotation.start.y * height;
      const text = `#${annotationIndex + 1} ${annotation.note?.trim() || annotation.text || "修改这里"}`;
      context.font = `700 ${fontSize}px sans-serif`;
      context.lineWidth = Math.max(4, Math.round(fontSize * 0.16));
      context.strokeStyle = "rgba(255, 255, 255, 0.92)";
      context.strokeText(text, x, y);
      context.fillStyle = annotation.color;
      context.fillText(text, x, y);
      if (anchor) drawImageEditAnnotationLabel(context, annotationIndex, anchor, width, height);
    }
  });
};

const renderImageEditAnnotationImage = async (
  sourceDataUrl: string,
  annotations: ImageEditAnnotation[]
): Promise<string> => {
  const image = await loadImageElement(sourceDataUrl);
  const canvas = document.createElement("canvas");
  const maxSide = 2048;
  const scale = Math.min(maxSide / image.width, maxSide / image.height, 1);
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法渲染改图标注。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.globalAlpha = 0.18;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.restore();
  drawImageEditAnnotations(context, annotations, canvas.width, canvas.height, { textMode: "number_only" });
  return canvas.toDataURL("image/png");
};

const renderPngImageDataUrl = async (sourceDataUrl: string): Promise<string> => {
  if (getMimeTypeFromDataUrl(sourceDataUrl) === "image/png") return sourceDataUrl;
  const image = await loadImageElement(sourceDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth || image.width);
  canvas.height = Math.max(1, image.naturalHeight || image.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法把源图转换为 PNG。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
};

const renderImageEditMaskImage = async (
  sourceDataUrl: string,
  annotations: ImageEditAnnotation[],
  purpose: ImageEditMaskPurpose = "strict_backend"
): Promise<RenderedImageEditMask> => {
  const image = await loadImageElement(sourceDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth || image.width);
  canvas.height = Math.max(1, image.naturalHeight || image.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法生成改图 mask。");

  const shortSide = Math.max(1, Math.min(canvas.width, canvas.height));
  const maskGeometry =
    purpose === "local_protection"
      ? {
          feather: clampValue(Math.round(shortSide * 0.006), 4, 12),
          boxExpand: clampValue(Math.round(shortSide * 0.025), 6, 40),
          brushWidth: clampValue(Math.round(shortSide * 0.018), 8, 28),
          anchorRadius: clampValue(Math.round(shortSide * 0.035), 10, 60)
        }
      : {
          feather: clampValue(Math.round(shortSide * 0.02), 16, 48),
          boxExpand: clampValue(Math.round(shortSide * 0.06), 24, 160),
          brushWidth: clampValue(Math.round(shortSide * 0.03), 16, 64),
          anchorRadius: clampValue(Math.round(shortSide * 0.08), 24, 160)
        };

  context.clearRect(0, 0, canvas.width, canvas.height);
  // Alpha polarity is fixed: alpha=255 keeps source pixels, alpha=0 allows model output pixels.
  context.fillStyle = "rgba(255, 255, 255, 1)";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const eraseWithFeather = (draw: () => void) => {
    context.save();
    context.globalCompositeOperation = "destination-out";
    context.fillStyle = "rgba(0, 0, 0, 1)";
    context.strokeStyle = "rgba(0, 0, 0, 1)";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = "rgba(0, 0, 0, 0.9)";
    context.shadowBlur = maskGeometry.feather;
    draw();
    context.restore();
  };

  annotations.forEach((annotation) => {
    if (annotation.tool === "box" && annotation.start && annotation.end) {
      const startX = annotation.start.x * canvas.width;
      const startY = annotation.start.y * canvas.height;
      const endX = annotation.end.x * canvas.width;
      const endY = annotation.end.y * canvas.height;
      const x = clampValue(Math.min(startX, endX) - maskGeometry.boxExpand, 0, canvas.width);
      const y = clampValue(Math.min(startY, endY) - maskGeometry.boxExpand, 0, canvas.height);
      const width = clampValue(Math.abs(endX - startX) + maskGeometry.boxExpand * 2, 1, canvas.width - x);
      const height = clampValue(Math.abs(endY - startY) + maskGeometry.boxExpand * 2, 1, canvas.height - y);
      eraseWithFeather(() => context.fillRect(x, y, width, height));
      return;
    }

    if (annotation.tool === "brush" && annotation.points?.length) {
      eraseWithFeather(() => {
        context.lineWidth = maskGeometry.brushWidth;
        if (annotation.points?.length === 1) {
          const [point] = annotation.points;
          context.beginPath();
          context.arc(point.x * canvas.width, point.y * canvas.height, maskGeometry.brushWidth / 2, 0, Math.PI * 2);
          context.fill();
          return;
        }
        context.beginPath();
        annotation.points?.forEach((point, index) => {
          const x = point.x * canvas.width;
          const y = point.y * canvas.height;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
      });
      return;
    }

    if (annotation.tool === "arrow") {
      const anchor = annotation.end || annotation.start;
      if (!anchor) return;
      eraseWithFeather(() => {
        context.beginPath();
        context.ellipse(
          anchor.x * canvas.width,
          anchor.y * canvas.height,
          maskGeometry.anchorRadius,
          maskGeometry.anchorRadius * 0.75,
          0,
          0,
          Math.PI * 2
        );
        context.fill();
      });
      return;
    }

    if (annotation.tool === "text" && annotation.start) {
      const x = annotation.start.x * canvas.width;
      const y = annotation.start.y * canvas.height;
      eraseWithFeather(() => {
        context.beginPath();
        context.ellipse(x, y, maskGeometry.anchorRadius * 1.15, maskGeometry.anchorRadius * 0.8, 0, 0, Math.PI * 2);
        context.fill();
      });
    }
  });

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  let transparentPixels = 0;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const alpha = imageData.data[(y * canvas.width + x) * 4 + 3];
      if (alpha < 250) {
        transparentPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const transparentRatio = transparentPixels / Math.max(1, canvas.width * canvas.height);
  const bboxWidth = maxX >= minX ? maxX - minX + 1 : 0;
  const bboxHeight = maxY >= minY ? maxY - minY + 1 : 0;
  const warnings: string[] = [];
  if (purpose === "local_protection" && transparentRatio > 0.25) {
    warnings.push("编辑区域较大，旁路生成可能重绘未标注皮肤。");
  }
  if (purpose === "local_protection" && Math.max(bboxWidth, bboxHeight) / shortSide > 0.35) {
    warnings.push("单处或合并标注范围偏大，建议缩小标注或用框选精确圈定。");
  }
  return {
    dataUrl: canvas.toDataURL("image/png"),
    stats: {
      width: canvas.width,
      height: canvas.height,
      transparentRatio,
      bbox: bboxWidth && bboxHeight ? `${minX},${minY},${bboxWidth}x${bboxHeight}` : undefined,
      itemCount: annotations.length,
      warnings
    }
  };
};

const renderPixelProtectedImage = async (
  sourceDataUrl: string,
  maskDataUrl: string,
  outputDataUrl: string
): Promise<{ dataUrl?: string; width?: number; height?: number; reason?: string }> => {
  if (!maskDataUrl) return { reason: "缺少本地保护图，未生成本地保护版。" };
  try {
    const [sourceImage, maskImage, outputImage] = await Promise.all([
      loadImageElement(sourceDataUrl),
      loadImageElement(maskDataUrl),
      loadImageElement(outputDataUrl)
    ]);
    const sourceWidth = Math.max(1, sourceImage.naturalWidth || sourceImage.width);
    const sourceHeight = Math.max(1, sourceImage.naturalHeight || sourceImage.height);
    const maskWidth = Math.max(1, maskImage.naturalWidth || maskImage.width);
    const maskHeight = Math.max(1, maskImage.naturalHeight || maskImage.height);
    const outputWidth = Math.max(1, outputImage.naturalWidth || outputImage.width);
    const outputHeight = Math.max(1, outputImage.naturalHeight || outputImage.height);
    if (sourceWidth !== maskWidth || sourceHeight !== maskHeight || sourceWidth !== outputWidth || sourceHeight !== outputHeight) {
      return {
        reason:
          "AI 输出尺寸与源图不一致，已保留 AI 原始结果，未生成本地保护版。本地保护版仅在 AI 输出与源图同尺寸时可用。"
      };
    }

    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext("2d");
    if (!context) return { reason: "图片解码失败，未生成本地保护版。" };

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(sourceImage, 0, 0);
    const sourcePixels = context.getImageData(0, 0, canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(outputImage, 0, 0);
    const outputPixels = context.getImageData(0, 0, canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(maskImage, 0, 0);
    const maskPixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const finalPixels = context.createImageData(canvas.width, canvas.height);
    finalPixels.data.set(composePixelProtectedRgba(sourcePixels.data, outputPixels.data, maskPixels.data));
    context.putImageData(finalPixels, 0, 0);
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } catch {
    return { reason: "图片解码失败，未生成本地保护版。" };
  }
};

const drawReferenceEdit = async (
  canvas: HTMLCanvasElement,
  dataUrl: string,
  settings: ReferenceEditSettings
): Promise<void> => {
  const image = await loadImageElement(dataUrl);
  const cropRatio = Math.min(Math.max(settings.cropPercent, 40), 100) / 100;
  const sourceWidth = Math.max(1, image.width * cropRatio);
  const sourceHeight = Math.max(1, image.height * cropRatio);
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  const baseScale = Math.min(2048 / sourceWidth, 2048 / sourceHeight, 1);
  const drawWidth = Math.max(1, Math.round(sourceWidth * baseScale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * baseScale));
  const rotation = ((settings.rotation % 360) + 360) % 360;
  const rotatedSideways = rotation === 90 || rotation === 270;
  canvas.width = rotatedSideways ? drawHeight : drawWidth;
  canvas.height = rotatedSideways ? drawWidth : drawHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法编辑参考图。");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.scale(settings.scalePercent / 100, settings.scalePercent / 100);
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
  context.globalCompositeOperation = "destination-out";
  context.lineCap = "round";
  context.lineJoin = "round";
  settings.eraseStrokes.forEach((stroke) => {
    if (!stroke.points.length) return;
    context.lineWidth = Math.max(2, stroke.brushSizeRatio * Math.min(canvas.width, canvas.height));
    context.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();
  });
  context.globalCompositeOperation = "source-over";
};

const renderEditedReferenceDataUrl = async (
  dataUrl: string,
  settings: ReferenceEditSettings
): Promise<string> => {
  const canvas = document.createElement("canvas");
  await drawReferenceEdit(canvas, dataUrl, settings);
  return canvas.toDataURL("image/png");
};

const composeReferenceImages = async (references: GenerationReferenceImage[]): Promise<string> => {
  const images = await Promise.all(references.map((reference) => loadImageElement(reference.dataUrl)));
  const columns = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / columns);
  const cellSize = Math.max(360, Math.floor(2048 / Math.max(columns, rows)));
  const padding = Math.max(18, Math.round(cellSize * 0.05));
  const canvas = document.createElement("canvas");
  canvas.width = columns * cellSize;
  canvas.height = rows * cellSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法合成参考图。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((image, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const maxWidth = cellSize - padding * 2;
    const maxHeight = cellSize - padding * 2;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    const x = column * cellSize + (cellSize - width) / 2;
    const y = row * cellSize + (cellSize - height) / 2;
    context.drawImage(image, x, y, width, height);
  });
  return canvas.toDataURL("image/png");
};

const getMimeTypeFromDataUrl = (dataUrl: string, fallback = "image/jpeg"): string => {
  const match = dataUrl.match(/^data:([^;,]+)[;,]/);
  return match?.[1] ?? fallback;
};

const fileToImageState = async (
  file: File,
  sourceType: "uploaded_image" | "clipboard_image" = "uploaded_image"
): Promise<ImageState> => {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件。");
  const dataUrl = await readFileAsDataUrl(file);
  const thumbnailDataUrl = await createThumbnail(dataUrl);
  return {
    fileName: file.name || "clipboard-image",
    mimeType: file.type,
    dataUrl,
    thumbnailDataUrl,
    sourceCapture: createLocalSourceCapture(sourceType)
  };
};

const copyText = async (text: string): Promise<void> => {
  await navigator.clipboard.writeText(text);
};

const jsonText = (analysis: StyleAnalysis | null): string =>
  analysis ? JSON.stringify(analysis, null, 2) : "";

const fusedJsonText = (fusedPromptJson: FusedPromptJson | null): string =>
  fusedPromptJson ? JSON.stringify(fusedPromptJson, null, 2) : "";

const formatInformationLayoutPrompt = (analysis: StyleAnalysis | null): string => {
  if (!analysis?.information_layout_template.applies) return "";
  const template = analysis.information_layout_template;
  return template.copy_ready_json_prompt || JSON.stringify(template, null, 2);
};

const getPromptBlocks = (analysis: StyleAnalysis | null) => ({
  universal: analysis?.style_reference.universal_style_prompt ?? "",
  layout: analysis?.style_reference.layout_prompt ?? "",
  template: analysis?.editable_template.prompt_template ?? "",
  negative: analysis?.style_reference.negative_prompt ?? "",
  informationLayout: formatInformationLayoutPrompt(analysis)
});

const sourceLabels: Record<SourceCaptureSourceType, string> = {
  uploaded_image: "本地图片",
  clipboard_image: "剪贴板图片",
  browser_viewport: "网页可视区域",
  browser_region: "网页局部区域",
  browser_image: "网页图片"
};

const getSourceLabel = (source?: SourceCapture): string => (source ? sourceLabels[source.source_type] : "未载入");

const getHistorySourceLabel = (item: HistoryItem): string => getSourceLabel(item.analysis.source_capture);

const historyItemToImageState = (item: HistoryItem): ImageState | null => {
  const imageDataUrl = typeof item.imageDataUrl === "string" ? item.imageDataUrl : "";
  const dataUrl = imageDataUrl || item.thumbnailDataUrl;
  if (!dataUrl) return null;

  return {
    fileName: item.fileName?.trim() || `history-${item.primaryType || "image"}`,
    mimeType: item.mimeType?.trim() || getMimeTypeFromDataUrl(dataUrl),
    dataUrl,
    thumbnailDataUrl: item.thumbnailDataUrl || dataUrl,
    sourceCapture: item.analysis.source_capture
  };
};

const historyItemToPromptSourceImage = (item: HistoryItem | undefined, currentImage: ImageState | null): {
  dataUrl: string;
  thumbnailDataUrl: string;
  fileName: string;
} => {
  if (item?.imageDataUrl || item?.thumbnailDataUrl) {
    return {
      dataUrl: item.imageDataUrl || item.thumbnailDataUrl,
      thumbnailDataUrl: item.thumbnailDataUrl || item.imageDataUrl || "",
      fileName: item.fileName || `history-${item.primaryType || "image"}`
    };
  }
  return {
    dataUrl: currentImage?.dataUrl || "",
    thumbnailDataUrl: currentImage?.thumbnailDataUrl || currentImage?.dataUrl || "",
    fileName: currentImage?.fileName || "当前图片"
  };
};

const imageStateToGenerationReference = async (imageState: ImageState): Promise<GenerationReferenceImage> => {
  const modelDataUrl = await createModelImage(imageState.dataUrl);
  return {
    id: crypto.randomUUID(),
    name: imageState.fileName,
    mimeType: getMimeTypeFromDataUrl(modelDataUrl),
    dataUrl: modelDataUrl,
    thumbnailDataUrl: imageState.thumbnailDataUrl || (await createThumbnail(modelDataUrl)),
    createdAt: new Date().toISOString()
  };
};

const formatGenerationTaskStatus = (status: GenerationTask["status"]): string => {
  if (status === "queued") return "排队中";
  if (status === "running") return "生成中";
  if (status === "succeeded") return "已完成";
  if (status === "partial_failed") return "部分完成";
  if (status === "canceled") return "已取消";
  return "失败";
};

const generationTaskVisibility = (task: GenerationTask): GenerationTaskVisibility => task.visibility || "active";

const formatGenerationTaskVisibility = (visibility: GenerationTaskVisibility): string => {
  if (visibility === "archived") return "已归档";
  if (visibility === "hidden") return "已隐藏";
  return "活跃";
};

const imageEditTaskVisibility = (task: ImageEditTask): ImageEditTaskVisibility => task.visibility || "active";

const formatGenerationOutputActualSize = (output: GenerationOutput): string => {
  if (output.localResizeApplied && output.actualSize && output.backendActualSize) {
    return `${output.actualSize}（本地补齐，原生 ${output.backendActualSize}）`;
  }
  if (output.actualSize) return output.actualSize;
  if (output.actualWidth && output.actualHeight) return `${output.actualWidth}x${output.actualHeight}`;
  return "未识别";
};

const formatGenerationTaskActualSizes = (outputs: GenerationOutput[]): string => {
  const sizes = Array.from(new Set(outputs.map(formatGenerationOutputActualSize)));
  return sizes.join(" / ");
};

const formatGenerationBackend = (task: GenerationTask): string => {
  if (!task.backend) return "";
  const provider =
    task.backend.authSource === "codex_oauth"
      ? "Codex OAuth"
      : task.backend.providerType === "openrouter"
        ? "OpenRouter"
        : "OpenAI-compatible";
  return `${provider} · ${task.backend.imageModel}`;
};

type GenerationTaskStatusFilter = "all" | GenerationTask["status"];
type GenerationTaskVisibilityFilter = "all" | GenerationTaskVisibility;
type GenerationTaskTimeFilter = "all" | "today" | "7d" | "30d";

const generationTaskStatusFilterOptions: Array<{ value: GenerationTaskStatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "queued", label: "排队中" },
  { value: "running", label: "生成中" },
  { value: "succeeded", label: "已完成" },
  { value: "partial_failed", label: "部分完成" },
  { value: "failed", label: "失败" },
  { value: "canceled", label: "已取消" }
];

const generationTaskVisibilityFilterOptions: Array<{ value: GenerationTaskVisibilityFilter; label: string }> = [
  { value: "active", label: "未归档" },
  { value: "archived", label: "已归档" },
  { value: "hidden", label: "已隐藏" },
  { value: "all", label: "全部任务" }
];

const generationTaskTimeFilterOptions: Array<{ value: GenerationTaskTimeFilter; label: string }> = [
  { value: "all", label: "全部时间" },
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" }
];

const isGenerationTaskInTimeRange = (task: GenerationTask, filter: GenerationTaskTimeFilter): boolean => {
  if (filter === "all") return true;
  const createdAt = new Date(task.createdAt).getTime();
  if (Number.isNaN(createdAt)) return false;
  const now = new Date();
  if (filter === "today") {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return createdAt >= dayStart;
  }
  const days = filter === "7d" ? 7 : 30;
  return createdAt >= now.getTime() - days * 24 * 60 * 60 * 1000;
};

const hasGenerationBackend = (config: GenerationConfig): boolean =>
  config.authSource === "codex_oauth" ? config.codexOAuthAvailable : config.hasApiKey;

const generationBackendActionLabel = (config: GenerationConfig): string => {
  if (config.authSource === "codex_oauth") return config.codexOAuthAvailable ? "生图配置" : "连接 Codex OAuth";
  return config.hasApiKey ? "生图配置" : "配置 API Key";
};

const generationBackendError = (config: GenerationConfig): string => {
  if (config.authSource === "codex_oauth") {
    return `请先完成 Codex OAuth 登录：运行 codex login 后再试。${
      config.codexOAuthError ? `（${config.codexOAuthError}）` : ""
    }`;
  }
  return "请先填写生图 API Key。";
};

const imageEditMaskCapabilityForConfig = (config: GenerationConfig): ImageEditMaskCapability => {
  if (config.authSource === "codex_oauth") {
    return {
      supportsMaskEdit: false,
      reason: "Codex OAuth 当前走 Responses image_generation，不支持 mask 严格编辑。"
    };
  }
  if (config.providerType === "openrouter") {
    return {
      supportsMaskEdit: false,
      reason: "OpenRouter /images 是参考生成接口，不支持 mask 严格编辑。"
    };
  }
  if (config.apiMode !== "images") {
    return {
      supportsMaskEdit: false,
      reason: "OpenAI-compatible Responses 当前不支持本方案的 mask 严格编辑。"
    };
  }
  return { supportsMaskEdit: true };
};

const strictMaskUnavailableMessage = (capability: ImageEditMaskCapability): string =>
  capability.supportsMaskEdit
    ? ""
    : `当前后端不支持 mask 严格编辑，请切换到 OpenAI-compatible Images 后端，或继续使用参考生成模式。${
        capability.reason ? `（${capability.reason}）` : ""
      }`;

const formatGenerationProviderType = (providerType: GenerationProviderType): string =>
  providerType === "openrouter" ? "OpenRouter" : "OpenAI-compatible";

const formatStyleTerms = (analysis: StyleAnalysis | null): string => {
  if (!analysis) return "";
  const summary = analysis.web_design_context.page_style_summary;
  const terms = analysis.style_terms
    .filter((term) => term.copyable)
    .map((term) => `${term.name}（${term.category}，${Math.round(term.confidence * 100)}%）`);
  return [summary, terms.length ? terms.join("、") : ""].filter(Boolean).join("\n");
};

export function App(): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const subjectFileInputRef = useRef<HTMLInputElement | null>(null);
  const generationReferenceInputRef = useRef<HTMLInputElement | null>(null);
  const imageEditSourceInputRef = useRef<HTMLInputElement | null>(null);
  const configRef = useRef<ModelConfig>(defaultConfig);
  const generationConfigRef = useRef<GenerationConfig>(defaultGenerationConfig);
  const strictGeneralizationRef = useRef(true);
  const analyzeCanceledRef = useRef(false);
  const fuseCanceledRef = useRef(false);
  const imageEditProtectedVariantRequestsRef = useRef(new Set<string>());
  const [config, setConfig] = useState<ModelConfig>(defaultConfig);
  const [draftConfig, setDraftConfig] = useState<ConfigDraft>(defaultDraftConfig);
  const [generationConfig, setGenerationConfig] = useState<GenerationConfig>(defaultGenerationConfig);
  const [generationDraft, setGenerationDraft] = useState<GenerationConfigDraft>(defaultGenerationDraft);
  const [generationSettings, setGenerationSettings] =
    useState<GenerationRequestSettings>(defaultGenerationSettings);
  const [showGenerationConfig, setShowGenerationConfig] = useState(false);
  const [activeView, setActiveView] = useState<"extract" | "generate" | "edit">("extract");
  const [showConfig, setShowConfig] = useState(false);
  const [image, setImage] = useState<ImageState | null>(null);
  const [analysis, setAnalysis] = useState<StyleAnalysis | null>(null);
  const [rawText, setRawText] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState("");
  const [strictGeneralization, setStrictGeneralization] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [showFuseModal, setShowFuseModal] = useState(false);
  const [subjectImage, setSubjectImage] = useState<ImageState | null>(null);
  const [isSubjectDragging, setIsSubjectDragging] = useState(false);
  const [isFusing, setIsFusing] = useState(false);
  const [fusedPrompt, setFusedPrompt] = useState("");
  const [fusedPromptJson, setFusedPromptJson] = useState<FusedPromptJson | null>(null);
  const [fuseError, setFuseError] = useState("");
  const [fuseCopied, setFuseCopied] = useState("");
  const [fuseControls, setFuseControls] = useState<FusePromptControls>(defaultFuseControls);
  const [selectedFuseMode, setSelectedFuseMode] = useState<FusePromptMode | null>(null);
  const [productInfoText, setProductInfoText] = useState("");
  const [editedTextMarkdown, setEditedTextMarkdown] = useState("");
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
  const [imagePreviewZoom, setImagePreviewZoom] = useState<ImagePreviewZoomState>(defaultImagePreviewZoom);
  const [comparePreview, setComparePreview] = useState<ComparePreviewState | null>(null);
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [generationPromptSource, setGenerationPromptSource] = useState<GenerationPromptSource | null>(null);
  const [generationReferenceImages, setGenerationReferenceImages] = useState<GenerationReferenceImage[]>([]);
  const [editingGenerationReferenceId, setEditingGenerationReferenceId] = useState("");
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([]);
  const [selectedGenerationTaskId, setSelectedGenerationTaskId] = useState("");
  const [restoreOnGenerationTaskClick, setRestoreOnGenerationTaskClick] = useState(false);
  const [collapsedGenerationTaskIds, setCollapsedGenerationTaskIds] = useState<string[]>([]);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationCopied, setGenerationCopied] = useState("");
  const [imageEditSource, setImageEditSource] = useState<ImageEditSourceImage | null>(null);
  const [imageEditAnnotations, setImageEditAnnotations] = useState<ImageEditAnnotation[]>([]);
  const [imageEditFidelityMode, setImageEditFidelityMode] = useState<ImageEditFidelityMode>("reference");
  const [imageEditPixelProtectionEnabled, setImageEditPixelProtectionEnabled] = useState(true);
  const [imageEditLocalMaskPreview, setImageEditLocalMaskPreview] = useState<RenderedImageEditMask | null>(null);
  const [isRenderingImageEditLocalMask, setIsRenderingImageEditLocalMask] = useState(false);
  const [imageEditInstruction, setImageEditInstruction] = useState("");
  const [imageEditSettings, setImageEditSettings] = useState<ImageEditRequestSettings>(defaultImageEditSettings);
  const [imageEditTasks, setImageEditTasks] = useState<ImageEditTask[]>([]);
  const [selectedImageEditTaskId, setSelectedImageEditTaskId] = useState("");
  const [collapsedImageEditTaskIds, setCollapsedImageEditTaskIds] = useState<string[]>([]);
  const [imageEditOutputVariantView, setImageEditOutputVariantView] = useState<Record<string, "raw" | "pixel_protected">>({});
  const [isImageEditDragging, setIsImageEditDragging] = useState(false);
  const [isCreatingImageEdit, setIsCreatingImageEdit] = useState(false);
  const [imageEditError, setImageEditError] = useState("");

  const supportsInformationLayoutMode = useMemo(() => hasInformationLayoutMode(analysis), [analysis]);
  const fuseMode = resolveFuseMode(analysis, selectedFuseMode);
  const prompts = useMemo(() => getPromptBlocks(analysis), [analysis]);
  const styleTermsText = useMemo(() => formatStyleTerms(analysis), [analysis]);
  const usesInsecureBaseUrl = draftConfig.apiBaseUrl.trim().toLowerCase().startsWith("http://");
  const usesInsecureGenerationBaseUrl =
    generationDraft.authSource === "api" && generationDraft.apiBaseUrl.trim().toLowerCase().startsWith("http://");
  const generationBackendReady = hasGenerationBackend(generationConfig);
  const imageEditMaskCapability = useMemo(
    () => imageEditMaskCapabilityForConfig(generationConfig),
    [generationConfig]
  );
  const editingGenerationReference = generationReferenceImages.find((image) => image.id === editingGenerationReferenceId);
  const hasActiveGenerationTasks = useMemo(
    () => generationTasks.some((task) => task.status === "queued" || task.status === "running"),
    [generationTasks]
  );
  const hasActiveImageEditTasks = useMemo(
    () => imageEditTasks.some((task) => task.status === "queued" || task.status === "running"),
    [imageEditTasks]
  );
  const generationPromptOptions = useMemo<GenerationPromptOption[]>(
    () => {
      const candidates: GenerationPromptOption[] = [
        { kind: "universal", label: "通用风格提示词", value: prompts.universal },
        { kind: "layout", label: "排版布局提示词", value: prompts.layout },
        { kind: "negative", label: "负面提示词", value: prompts.negative },
        { kind: "template", label: "封面模板提示词", value: prompts.template },
        { kind: "information_layout", label: "表格/卡片信息布局提示词", value: prompts.informationLayout },
        { kind: "style_terms", label: "网页设计风格词", value: styleTermsText },
        { kind: "fused_prompt", label: "最终融合提示词", value: fusedPrompt },
        {
          kind: "fused_copy_ready",
          label: "融合 JSON 可复制提示词",
          value: fusedJsonText(fusedPromptJson)
        }
      ];
      return candidates.filter((option) => option.value.trim());
    },
    [fusedPrompt, fusedPromptJson, prompts, styleTermsText]
  );

  useEffect(() => {
    let canceled = false;
    if (!imageEditSource || !imageEditAnnotations.length || imageEditFidelityMode !== "reference") {
      setImageEditLocalMaskPreview(null);
      setIsRenderingImageEditLocalMask(false);
      return;
    }
    setIsRenderingImageEditLocalMask(true);
    void renderImageEditMaskImage(imageEditSource.dataUrl, imageEditAnnotations, "local_protection")
      .then((mask) => {
        if (!canceled) setImageEditLocalMaskPreview(mask);
      })
      .catch(() => {
        if (!canceled) setImageEditLocalMaskPreview(null);
      })
      .finally(() => {
        if (!canceled) setIsRenderingImageEditLocalMask(false);
      });
    return () => {
      canceled = true;
    };
  }, [imageEditAnnotations, imageEditFidelityMode, imageEditSource]);

  const resetFusionState = useCallback((closeModal = false) => {
    setSubjectImage(null);
    setIsSubjectDragging(false);
    setFusedPrompt("");
    setFusedPromptJson(null);
    setFuseError("");
    setFuseCopied("");
    setFuseControls(defaultFuseControls);
    setSelectedFuseMode(null);
    setProductInfoText("");
    if (closeModal) setShowFuseModal(false);
  }, []);

  const openImagePreview = (preview: ImagePreviewState) => {
    setImagePreview(preview);
    setImagePreviewZoom(defaultImagePreviewZoom);
  };

  const closeImagePreview = () => {
    setImagePreview(null);
    setImagePreviewZoom(defaultImagePreviewZoom);
  };

  const toggleImagePreviewZoom = (event: MouseEvent<HTMLImageElement>) => {
    if (imagePreview?.mode !== "fit") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const originX = ((event.clientX - rect.left) / rect.width) * 100;
    const originY = ((event.clientY - rect.top) / rect.height) * 100;
    setImagePreviewZoom((current) =>
      current.enabled
        ? defaultImagePreviewZoom
        : {
            enabled: true,
            originX: Math.min(Math.max(originX, 0), 100),
            originY: Math.min(Math.max(originY, 0), 100)
          }
    );
  };

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    generationConfigRef.current = generationConfig;
  }, [generationConfig]);

  useEffect(() => {
    strictGeneralizationRef.current = strictGeneralization;
  }, [strictGeneralization]);

  const applyGenerationConfig = useCallback((nextConfig: GenerationConfig) => {
    const activeProvider =
      nextConfig.providers.find((provider) => provider.id === nextConfig.activeProviderId) || nextConfig.providers[0];
    setGenerationConfig(nextConfig);
    setGenerationDraft({
      ...nextConfig,
      providerType: activeProvider?.providerType || nextConfig.providerType,
      providerName: activeProvider?.name || "",
      apiKey: ""
    });
    setGenerationSettings((current) => ({
      ...current,
      apiMode: nextConfig.apiMode,
      imageModel: nextConfig.imageModel,
      mainModel: nextConfig.mainModel
    }));
  }, []);

  useEffect(() => {
    if (!imagePreview && !comparePreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeImagePreview();
      if (event.key === "Escape") setComparePreview(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [comparePreview, imagePreview]);

  useEffect(() => {
    if (!showConfig && !showFuseModal && !showGenerationConfig) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showConfig) setShowConfig(false);
      if (showGenerationConfig) setShowGenerationConfig(false);
      if (showFuseModal && !isFusing) setShowFuseModal(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFusing, showConfig, showFuseModal, showGenerationConfig]);

  useEffect(() => {
    window.styleExtractor.getConfig().then((nextConfig) => {
      setConfig(nextConfig);
      setDraftConfig({ ...nextConfig, apiKey: "" });
    });
    window.styleExtractor.getGenerationConfig().then(applyGenerationConfig);
    window.styleExtractor.getHistory().then(setHistory);
    window.styleExtractor.getGenerationTasks().then(setGenerationTasks);
    window.styleExtractor.getImageEditTasks().then(setImageEditTasks);
  }, [applyGenerationConfig]);

  useEffect(() => {
    if (!hasActiveGenerationTasks) return;
    const refreshGenerationTasks = async () => {
      const nextTasks = await window.styleExtractor.getGenerationTasks();
      setGenerationTasks(nextTasks);
    };
    const timer = window.setInterval(() => {
      void refreshGenerationTasks();
    }, 1500);
    void refreshGenerationTasks();
    return () => window.clearInterval(timer);
  }, [hasActiveGenerationTasks]);

  useEffect(() => {
    if (!hasActiveImageEditTasks) return;
    const refreshImageEditTasks = async () => {
      const nextTasks = await window.styleExtractor.getImageEditTasks();
      setImageEditTasks(nextTasks);
    };
    const timer = window.setInterval(() => {
      void refreshImageEditTasks();
    }, 1500);
    void refreshImageEditTasks();
    return () => window.clearInterval(timer);
  }, [hasActiveImageEditTasks]);

  useEffect(() => {
    const candidates = imageEditTasks.flatMap((task) => {
      if (task.status === "queued" || task.status === "running") return [];
      if ((task.fidelityMode || "reference") !== "reference") return [];
      if (task.pixelProtectionEnabled === false) return [];
      if (!task.sourceImage.dataUrl || !task.localProtectionMaskImage?.dataUrl) return [];
      return task.outputs
        .filter((output) => output.dataUrl && !output.protectedVariant && !output.protectedVariantUnavailableReason)
        .map((output) => ({ task, output }));
    });
    candidates.forEach(({ task, output }) => {
      const requestKey = `${task.id}:${output.id}`;
      if (imageEditProtectedVariantRequestsRef.current.has(requestKey)) return;
      imageEditProtectedVariantRequestsRef.current.add(requestKey);
      void (async () => {
        const result = await renderPixelProtectedImage(
          task.sourceImage.dataUrl,
          task.localProtectionMaskImage?.dataUrl || "",
          output.dataUrl
        );
        if (!result.dataUrl) {
          setImageEditTasks((current) =>
            current.map((currentTask) =>
              currentTask.id === task.id
                ? {
                    ...currentTask,
                    outputs: currentTask.outputs.map((currentOutput) =>
                      currentOutput.id === output.id
                        ? {
                            ...currentOutput,
                            protectedVariantUnavailableReason:
                              result.reason ||
                              "本地保护版仅在 AI 输出与源图同尺寸时可用；已保留 AI 原始结果。"
                          }
                        : currentOutput
                    )
                  }
                : currentTask
            )
          );
          return;
        }
        const updatedTask = await window.styleExtractor.saveImageEditProtectedVariant({
          taskId: task.id,
          outputId: output.id,
          dataUrl: result.dataUrl,
          mimeType: "image/png",
          width: result.width,
          height: result.height,
          warnings: [
            "本地保护版是软件后处理结果，不是 AI 原始结果。",
            ...(task.localProtectionMaskImage?.stats?.warnings || [])
          ]
        });
        setImageEditTasks((current) => current.map((currentTask) => (currentTask.id === updatedTask.id ? updatedTask : currentTask)));
      })().catch((variantError) => {
        setImageEditTasks((current) =>
          current.map((currentTask) =>
            currentTask.id === task.id
              ? {
                  ...currentTask,
                  outputs: currentTask.outputs.map((currentOutput) =>
                    currentOutput.id === output.id
                      ? {
                          ...currentOutput,
                          protectedVariantUnavailableReason:
                            variantError instanceof Error ? variantError.message : "图片解码失败，未生成本地保护版。"
                        }
                      : currentOutput
                  )
                }
              : currentTask
          )
        );
      });
    });
  }, [imageEditTasks]);

  const loadImageEditSource = useCallback(
    async (
      imageState: ImageState,
      sourceKind: ImageEditSourceKind,
      pointer?: Partial<ImageEditSourceImage["sourcePointer"]>
    ) => {
      const dimensions = await imageDimensionsFromDataUrl(imageState.dataUrl);
      const modelDataUrl = await createModelImage(imageState.dataUrl);
      const sourceImage: ImageEditSourceImage = {
        id: crypto.randomUUID(),
        name: imageState.fileName,
        mimeType: getMimeTypeFromDataUrl(modelDataUrl, imageState.mimeType),
        dataUrl: modelDataUrl,
        thumbnailDataUrl: imageState.thumbnailDataUrl || (await createThumbnail(modelDataUrl)),
        width: dimensions.width,
        height: dimensions.height,
        createdAt: new Date().toISOString(),
        sourcePointer: {
          kind: sourceKind,
          importedAt: new Date().toISOString(),
          ...pointer
        }
      };
      setImageEditSource(sourceImage);
      setImageEditAnnotations([]);
      setImageEditSettings(imageEditSettingsForDimensions(dimensions.width, dimensions.height, generationConfigRef.current));
      setImageEditError("");
    },
    []
  );

  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
        entry.type.startsWith("image/")
      );
      const file = item?.getAsFile();
      if (!file) return;

      event.preventDefault();
      try {
        setError("");
        const nextImage = await fileToImageState(file, "clipboard_image");
        if (activeView === "generate") {
          const generationReference = await imageStateToGenerationReference(nextImage);
          setGenerationReferenceImages((current) => [...current, generationReference].slice(0, 8));
          setGenerationError("");
          setStatus("已把剪贴板图片加入生图参考图。");
          return;
        }
        if (activeView === "edit") {
          await loadImageEditSource(nextImage, "clipboard_image");
          setStatus("已把剪贴板图片设为改图源图。");
          return;
        }
        if (showFuseModal) {
          setSubjectImage(nextImage);
          setFusedPrompt("");
          setFusedPromptJson(null);
          setFuseError("");
          setFuseCopied("");
          setStatus(fuseMode === "information_layout" ? "已读取产品信息图。" : "已读取主体参考图。");
          return;
        }
        setImage(nextImage);
        setAnalysis(null);
        setRawText("");
        setActiveHistoryId("");
        setEditedTextMarkdown("");
        resetFusionState(true);
        setStatus("已读取剪贴板图片。");
      } catch (pasteError) {
        setError(pasteError instanceof Error ? pasteError.message : String(pasteError));
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [activeView, fuseMode, loadImageEditSource, resetFusionState, showFuseModal]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    try {
      setError("");
      const nextImage = await fileToImageState(file);
      setImage(nextImage);
      setAnalysis(null);
      setRawText("");
      setActiveHistoryId("");
      setEditedTextMarkdown("");
      resetFusionState(true);
      setStatus("图片已载入，可以开始分析。");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    }
  }, [resetFusionState]);

  const handleSubjectFiles = useCallback(async (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    try {
      setFuseError("");
      const nextImage = await fileToImageState(file);
      setSubjectImage(nextImage);
      setFusedPrompt("");
      setFusedPromptJson(null);
      setFuseCopied("");
      setStatus(fuseMode === "information_layout" ? "产品信息图已载入。" : "主体参考图已载入。");
    } catch (uploadError) {
      setFuseError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    }
  }, [fuseMode]);

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    await handleFiles(event.dataTransfer.files);
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleFiles(event.target.files ?? []);
    event.target.value = "";
  };

  const onSubjectDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsSubjectDragging(false);
    await handleSubjectFiles(event.dataTransfer.files);
  };

  const onSubjectFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleSubjectFiles(event.target.files ?? []);
    event.target.value = "";
  };

  const saveConfig = async () => {
    const saved = await window.styleExtractor.saveConfig(draftConfig);
    setConfig(saved);
    setDraftConfig({ ...saved, apiKey: "" });
    setShowConfig(false);
    setStatus("模型配置已保存。");
  };

  const saveGenerationConfig = async () => {
    const saved = await window.styleExtractor.saveGenerationConfig({
      ...generationDraft,
      apiMode:
        generationDraft.authSource === "codex_oauth" || generationDraft.providerType === "openrouter"
          ? generationDraft.authSource === "codex_oauth"
            ? "responses"
            : "images"
          : generationDraft.apiMode
    });
    applyGenerationConfig(saved);
    setShowGenerationConfig(false);
    setStatus("生图配置已保存。");
  };

  const openGenerationConfig = async (): Promise<GenerationConfig> => {
    const nextConfig = await window.styleExtractor.getGenerationConfig();
    applyGenerationConfig(nextConfig);
    setShowGenerationConfig(true);
    return nextConfig;
  };

  const createGenerationProvider = async (providerType: GenerationProviderType = "openai_compatible") => {
    const isOpenRouter = providerType === "openrouter";
    try {
      const saved = await window.styleExtractor.saveGenerationProvider({
        name: isOpenRouter ? openRouterGenerationDefaults.name : `API 供应商 ${generationDraft.providers.length + 1}`,
        providerType,
        apiBaseUrl: isOpenRouter ? openRouterGenerationDefaults.apiBaseUrl : "https://api.openai.com/v1",
        apiKey: "",
        apiMode: "images",
        imageModel: isOpenRouter ? openRouterGenerationDefaults.imageModel : "gpt-image-2",
        mainModel: "gpt-5.5",
        saveApiKey: false
      });
      applyGenerationConfig(saved);
      setStatus(isOpenRouter ? "已新增 OpenRouter 生图供应商。" : "已新增生图 API 供应商。");
    } catch (providerError) {
      setGenerationError(providerError instanceof Error ? providerError.message : String(providerError));
    }
  };

  const selectGenerationProvider = async (id: string) => {
    try {
      const saved = await window.styleExtractor.selectGenerationProvider(id);
      applyGenerationConfig(saved);
      setStatus("已切换生图 API 供应商。");
    } catch (providerError) {
      setGenerationError(providerError instanceof Error ? providerError.message : String(providerError));
    }
  };

  const duplicateGenerationProvider = async (id: string) => {
    try {
      const saved = await window.styleExtractor.duplicateGenerationProvider(id);
      applyGenerationConfig(saved);
      setStatus("已复制生图 API 供应商。");
    } catch (providerError) {
      setGenerationError(providerError instanceof Error ? providerError.message : String(providerError));
    }
  };

  const deleteGenerationProvider = async (id: string) => {
    const provider = generationDraft.providers.find((item) => item.id === id);
    if (!window.confirm(`确定删除“${provider?.name || "这个供应商"}”吗？已保存的 Key 也会从本机生图配置中移除。`)) {
      return;
    }
    try {
      const saved = await window.styleExtractor.deleteGenerationProvider(id);
      applyGenerationConfig(saved);
      setStatus("已删除生图 API 供应商。");
    } catch (providerError) {
      setGenerationError(providerError instanceof Error ? providerError.message : String(providerError));
    }
  };

  const moveGenerationProvider = async (id: string, direction: -1 | 1) => {
    const index = generationDraft.providers.findIndex((provider) => provider.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= generationDraft.providers.length) return;
    const providers = [...generationDraft.providers];
    [providers[index], providers[nextIndex]] = [providers[nextIndex], providers[index]];
    try {
      const saved = await window.styleExtractor.reorderGenerationProviders(providers.map((provider) => provider.id));
      applyGenerationConfig(saved);
      setStatus("已调整生图 API 供应商顺序。");
    } catch (providerError) {
      setGenerationError(providerError instanceof Error ? providerError.message : String(providerError));
    }
  };

  const importPromptToGeneration = (option: GenerationPromptOption) => {
    if (!analysis && !fusedPrompt) {
      setGenerationError("请先完成提示词提取或融合提示词生成。");
      return;
    }
    const activeHistoryItem = history.find((item) => item.id === activeHistoryId);
    const sourceImage = historyItemToPromptSourceImage(activeHistoryItem, image);
    const promptSource: GenerationPromptSource = {
      kind: option.kind,
      label: option.label,
      historyItemId: activeHistoryId || undefined,
      sourceImageDataUrl: sourceImage.dataUrl,
      sourceThumbnailDataUrl: sourceImage.thumbnailDataUrl,
      sourceFileName: sourceImage.fileName,
      importedAt: new Date().toISOString()
    };
    setGenerationPrompt(option.value);
    setGenerationPromptSource(promptSource);
    setGenerationError("");
    setActiveView("generate");
    setStatus(`已导入${option.label}到生图工作台。`);
  };

  const syncFusionImageToGenerationReferences = async (
    fusionImage: ImageState | null,
    mode: FusePromptMode,
    modelDataUrl?: string
  ): Promise<boolean> => {
    if (mode !== "subject_reference" || !fusionImage || !modelDataUrl?.startsWith("data:image/")) return false;
    const reference: GenerationReferenceImage = {
      id: crypto.randomUUID(),
      name: `主体参考图 · ${fusionImage.fileName}`,
      mimeType: getMimeTypeFromDataUrl(modelDataUrl, fusionImage.mimeType),
      dataUrl: modelDataUrl,
      thumbnailDataUrl: fusionImage.thumbnailDataUrl || (await createThumbnail(modelDataUrl)),
      createdAt: new Date().toISOString()
    };
    setGenerationReferenceImages((current) => {
      const withoutSameImage = current.filter((item) => item.dataUrl !== reference.dataUrl);
      return [reference, ...withoutSameImage].slice(0, 8);
    });
    return true;
  };

  const handleGenerationReferenceFiles = useCallback(async (files: FileList | File[]) => {
    const nextFiles = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, 8);
    if (!nextFiles.length) return;
    try {
      setGenerationError("");
      const nextImages = await Promise.all(
        nextFiles.map(async (file) => imageStateToGenerationReference(await fileToImageState(file)))
      );
      setGenerationReferenceImages((current) => [...current, ...nextImages].slice(0, 8));
      setStatus("已加入生图参考图。");
    } catch (uploadError) {
      setGenerationError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    }
  }, []);

  const handleImageEditSourceFiles = useCallback(async (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    try {
      setImageEditError("");
      await loadImageEditSource(await fileToImageState(file), "uploaded_image");
      setStatus("改图源图已载入。");
    } catch (uploadError) {
      setImageEditError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    }
  }, [loadImageEditSource]);

  const onImageEditSourceChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleImageEditSourceFiles(event.target.files ?? []);
    event.target.value = "";
  };

  const onGenerationReferenceChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleGenerationReferenceFiles(event.target.files ?? []);
    event.target.value = "";
  };

  const removeGenerationReference = (id: string) => {
    setGenerationReferenceImages((current) => current.filter((item) => item.id !== id));
    if (editingGenerationReferenceId === id) setEditingGenerationReferenceId("");
  };

  const saveEditedGenerationReference = async (reference: GenerationReferenceImage, editedDataUrl: string) => {
    const modelDataUrl = await createModelImage(editedDataUrl);
    const nextReference: GenerationReferenceImage = {
      ...reference,
      name: `${reference.name} · 已编辑`,
      mimeType: getMimeTypeFromDataUrl(modelDataUrl),
      dataUrl: modelDataUrl,
      thumbnailDataUrl: await createThumbnail(modelDataUrl),
      createdAt: new Date().toISOString()
    };
    setGenerationReferenceImages((current) =>
      current.map((item) => (item.id === reference.id ? nextReference : item))
    );
    setEditingGenerationReferenceId("");
    setStatus("已保存编辑后的生图参考图。");
  };

  const composeGenerationReferences = async () => {
    if (generationReferenceImages.length < 2) {
      setGenerationError("至少需要两张参考图才能合成为一张。");
      return;
    }
    try {
      setGenerationError("");
      const composedDataUrl = await composeReferenceImages(generationReferenceImages);
      const modelDataUrl = await createModelImage(composedDataUrl);
      const reference: GenerationReferenceImage = {
        id: crypto.randomUUID(),
        name: `合成参考图 · ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
        mimeType: getMimeTypeFromDataUrl(modelDataUrl),
        dataUrl: modelDataUrl,
        thumbnailDataUrl: await createThumbnail(modelDataUrl),
        createdAt: new Date().toISOString()
      };
      setGenerationReferenceImages((current) => [reference, ...current].slice(0, 8));
      setStatus("已把多张参考图合成为一张。");
    } catch (composeError) {
      setGenerationError(composeError instanceof Error ? composeError.message : String(composeError));
    }
  };

  const runGenerationRequest = async (request: GenerationCreateRequest) => {
    try {
      setIsGeneratingImage(true);
      setGenerationError("");
      setStatus("正在提交生图任务...");
      const task = await window.styleExtractor.createGenerationTask(request);
      const nextTasks = await window.styleExtractor.getGenerationTasks();
      setGenerationTasks(nextTasks);
      setSelectedGenerationTaskId(task.id);
      if (task.status === "queued") {
        setStatus("生图任务已加入队列。");
        return;
      }
      if (task.status === "running") {
        setStatus("生图任务已开始生成。");
        return;
      }
      if (task.status === "failed" || task.status === "canceled") {
        setGenerationError(task.error || "生图任务未完成。");
        setStatus("");
        return;
      }
      setStatus(task.status === "partial_failed" ? "生图任务部分完成。" : "生图任务已完成。");
    } catch (generateError) {
      setGenerationError(generateError instanceof Error ? generateError.message : String(generateError));
      setStatus("");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const createImageEditTask = async () => {
    if (!imageEditSource) {
      setImageEditError("请先导入一张改图源图。");
      return;
    }
    const annotationItems = buildImageEditAnnotationItems(imageEditAnnotations);
    const hasLocalEditNotes = annotationItems.some((item) => item.note !== "按总体改图说明处理此处。");
    if (!imageEditInstruction.trim() && !hasLocalEditNotes) {
      setImageEditError("请填写总体改图说明，或至少为一处标注填写修改要求。");
      return;
    }
    if (imageEditFidelityMode === "strict_mask" && !imageEditAnnotations.length) {
      setImageEditError("严格保真模式至少需要 1 个编号标注，用于生成 alpha mask。");
      return;
    }
    let activeGenerationConfig = generationConfigRef.current;
    if (!hasGenerationBackend(activeGenerationConfig)) {
      activeGenerationConfig = await openGenerationConfig();
      if (!hasGenerationBackend(activeGenerationConfig)) {
        setImageEditError(generationBackendError(activeGenerationConfig));
        return;
      }
    }
    const maskCapability = imageEditMaskCapabilityForConfig(activeGenerationConfig);
    if (imageEditFidelityMode === "strict_mask" && !maskCapability.supportsMaskEdit) {
      setImageEditError(strictMaskUnavailableMessage(maskCapability));
      return;
    }
    try {
      setIsCreatingImageEdit(true);
      setImageEditError("");
      setStatus("正在提交改图任务...");
      const shouldUseStrictMask = imageEditFidelityMode === "strict_mask";
      const sourceDataUrl = shouldUseStrictMask ? await renderPngImageDataUrl(imageEditSource.dataUrl) : imageEditSource.dataUrl;
      const sourceDimensions = await imageDimensionsFromDataUrl(sourceDataUrl);
      const sourceForRequest: ImageEditSourceImage = shouldUseStrictMask
        ? {
            ...imageEditSource,
            mimeType: "image/png",
            dataUrl: sourceDataUrl,
            thumbnailDataUrl: imageEditSource.thumbnailDataUrl || (await createThumbnail(sourceDataUrl)),
            width: sourceDimensions.width,
            height: sourceDimensions.height
          }
        : imageEditSource;
      const annotationDataUrl = await renderImageEditAnnotationImage(sourceDataUrl, imageEditAnnotations);
      const annotationImage: ImageEditAnnotationImage = {
        mimeType: "image/png",
        dataUrl: annotationDataUrl,
        thumbnailDataUrl: await createThumbnail(annotationDataUrl),
        itemCount: imageEditAnnotations.length,
        createdAt: new Date().toISOString()
      };
      const strictMask = shouldUseStrictMask
        ? await renderImageEditMaskImage(sourceDataUrl, imageEditAnnotations, "strict_backend")
        : null;
      const localProtectionMask =
        !shouldUseStrictMask && imageEditAnnotations.length
          ? await renderImageEditMaskImage(sourceDataUrl, imageEditAnnotations, "local_protection")
          : null;
      const maskImage: ImageEditMaskImage | undefined = shouldUseStrictMask
        ? {
            mimeType: "image/png",
            dataUrl: strictMask?.dataUrl || "",
            itemCount: imageEditAnnotations.length,
            width: sourceDimensions.width,
            height: sourceDimensions.height,
            createdAt: new Date().toISOString()
          }
        : undefined;
      const localProtectionMaskImage: ImageEditLocalProtectionMaskImage | undefined = localProtectionMask
        ? {
            purpose: "local_protection",
            mimeType: "image/png",
            dataUrl: localProtectionMask.dataUrl,
            itemCount: imageEditAnnotations.length,
            width: sourceDimensions.width,
            height: sourceDimensions.height,
            stats: localProtectionMask.stats,
            createdAt: new Date().toISOString()
          }
        : undefined;
      const normalizedSize = normalizeGenerationSizeSettings(imageEditSettings);
      const shouldRequestSourceSizeForLocalProtection =
        !shouldUseStrictMask &&
        imageEditPixelProtectionEnabled &&
        Boolean(localProtectionMaskImage) &&
        Boolean(sourceDimensions.width && sourceDimensions.height);
      const requestSize = shouldRequestSourceSizeForLocalProtection
        ? `${sourceDimensions.width}x${sourceDimensions.height}`
        : normalizedSize.size;
      const request: ImageEditCreateRequest = {
        sourceImage: sourceForRequest,
        annotationImage,
        maskImage,
        localProtectionMaskImage,
        annotationItems,
        fidelityMode: imageEditFidelityMode,
        pixelProtectionEnabled: imageEditPixelProtectionEnabled,
        instruction: imageEditInstruction,
        settings: {
          ...imageEditSettings,
          ...normalizedSize,
          size: requestSize,
          apiMode:
            activeGenerationConfig.authSource === "codex_oauth"
              ? "responses"
              : activeGenerationConfig.providerType === "openrouter"
                ? "images"
                : activeGenerationConfig.apiMode,
          imageModel: activeGenerationConfig.imageModel,
          mainModel: activeGenerationConfig.mainModel
        }
      };
      const task = await window.styleExtractor.createImageEditTask(request);
      const nextTasks = await window.styleExtractor.getImageEditTasks();
      setImageEditTasks(nextTasks);
      setSelectedImageEditTaskId(task.id);
      setStatus("改图任务已加入队列。");
    } catch (editError) {
      setImageEditError(editError instanceof Error ? editError.message : String(editError));
      setStatus("");
    } finally {
      setIsCreatingImageEdit(false);
    }
  };

  const createGeneration = async () => {
    if (!generationPrompt.trim()) {
      setGenerationError("请先从提取结果导入提示词，再在生图工作台编辑。");
      return;
    }
    if (!generationPromptSource?.sourceImageDataUrl && !generationPromptSource?.sourceThumbnailDataUrl) {
      setGenerationError("当前提示词缺少原始提取图，无法建立生成后左右对比。");
      return;
    }
    let activeGenerationConfig = generationConfigRef.current;
    if (!hasGenerationBackend(activeGenerationConfig)) {
      activeGenerationConfig = await openGenerationConfig();
      if (!hasGenerationBackend(activeGenerationConfig)) {
        setGenerationError(generationBackendError(activeGenerationConfig));
        return;
      }
    }
    const normalizedSize = normalizeGenerationSizeSettings(generationSettings);

    await runGenerationRequest({
      prompt: generationPrompt,
      promptSource: generationPromptSource,
      referenceImages: generationReferenceImages,
      settings: {
        ...generationSettings,
        ...normalizedSize,
        apiMode:
          activeGenerationConfig.authSource === "codex_oauth"
            ? "responses"
            : activeGenerationConfig.providerType === "openrouter"
              ? "images"
              : activeGenerationConfig.apiMode,
        imageModel: activeGenerationConfig.imageModel,
        mainModel: activeGenerationConfig.mainModel
      }
    });
  };

  const retryGenerationTask = async (task: GenerationTask) => {
    let activeGenerationConfig = generationConfigRef.current;
    if (!hasGenerationBackend(activeGenerationConfig)) {
      activeGenerationConfig = await openGenerationConfig();
      if (!hasGenerationBackend(activeGenerationConfig)) {
        setGenerationError(generationBackendError(activeGenerationConfig));
        return;
      }
    }
    const normalizedSize = normalizeGenerationSizeSettings(task.settings);
    await runGenerationRequest({
      prompt: task.prompt,
      promptSource: {
        ...task.promptSource,
        importedAt: new Date().toISOString()
      },
      referenceImages: task.referenceImages,
      settings: {
        ...task.settings,
        ...normalizedSize,
        apiMode:
          activeGenerationConfig.authSource === "codex_oauth"
            ? "responses"
            : activeGenerationConfig.providerType === "openrouter"
              ? "images"
              : activeGenerationConfig.apiMode,
        imageModel: activeGenerationConfig.imageModel,
        mainModel: activeGenerationConfig.mainModel
      }
    });
  };

  const cancelGenerationTask = async (id: string) => {
    const canceledTask = await window.styleExtractor.cancelGenerationTask(id);
    const nextTasks = await window.styleExtractor.getGenerationTasks();
    setGenerationTasks(nextTasks);
    if (canceledTask?.status === "canceled") {
      setStatus("已取消生图任务。");
    }
  };

  const cancelImageEditTask = async (id: string) => {
    const canceledTask = await window.styleExtractor.cancelImageEditTask(id);
    const nextTasks = await window.styleExtractor.getImageEditTasks();
    setImageEditTasks(nextTasks);
    if (canceledTask?.status === "canceled") setStatus("已取消改图任务。");
  };

  const retryImageEditTask = async (task: ImageEditTask) => {
    try {
      setImageEditError("");
      const retried = await window.styleExtractor.retryImageEditTask(task.id);
      const nextTasks = await window.styleExtractor.getImageEditTasks();
      setImageEditTasks(nextTasks);
      setSelectedImageEditTaskId(retried.id);
      setStatus("已重新提交改图任务。");
    } catch (retryError) {
      setImageEditError(retryError instanceof Error ? retryError.message : String(retryError));
    }
  };

  const deleteImageEditTask = async (id: string) => {
    if (!window.confirm("确定删除这条改图任务吗？")) return;
    const nextTasks = await window.styleExtractor.deleteImageEditTask(id);
    setImageEditTasks(nextTasks);
    if (selectedImageEditTaskId === id) setSelectedImageEditTaskId("");
    setCollapsedImageEditTaskIds((current) => current.filter((taskId) => taskId !== id));
    setStatus("已删除改图任务。");
  };

  const updateImageEditTaskVisibility = async (id: string, visibility: ImageEditTaskVisibility) => {
    try {
      const nextTasks = await window.styleExtractor.updateImageEditTaskVisibility({ id, visibility });
      setImageEditTasks(nextTasks);
      if (visibility !== "active" && selectedImageEditTaskId === id) setSelectedImageEditTaskId("");
      setStatus(
        visibility === "archived"
          ? "已归档改图任务。"
          : visibility === "hidden"
            ? "已隐藏改图任务。"
            : "已恢复改图任务显示。"
      );
    } catch (visibilityError) {
      setImageEditError(visibilityError instanceof Error ? visibilityError.message : String(visibilityError));
    }
  };

  const clearImageEditTasks = async () => {
    if (imageEditTasks.length > 0 && !window.confirm("确定清空全部改图任务吗？")) return;
    await window.styleExtractor.clearImageEditTasks();
    setImageEditTasks([]);
    setSelectedImageEditTaskId("");
    setCollapsedImageEditTaskIds([]);
    setStatus("改图任务已清空。");
  };

  const updateGenerationTaskVisibility = async (id: string, visibility: GenerationTaskVisibility) => {
    try {
      const nextTasks = await window.styleExtractor.updateGenerationTaskVisibility({ id, visibility });
      setGenerationTasks(nextTasks);
      setStatus(
        visibility === "archived"
          ? "已归档生图任务。"
          : visibility === "hidden"
            ? "已隐藏生图任务。"
            : "已恢复生图任务显示。"
      );
    } catch (visibilityError) {
      setGenerationError(visibilityError instanceof Error ? visibilityError.message : String(visibilityError));
    }
  };

  const deleteGenerationTask = async (id: string) => {
    if (!window.confirm("确定删除这条生图任务吗？")) return;
    const nextTasks = await window.styleExtractor.deleteGenerationTask(id);
    setGenerationTasks(nextTasks);
    if (selectedGenerationTaskId === id) setSelectedGenerationTaskId("");
    setStatus("已删除生图任务。");
  };

  const clearGenerationTasks = async () => {
    if (generationTasks.length > 0 && !window.confirm("确定清空全部生图任务吗？")) return;
    await window.styleExtractor.clearGenerationTasks();
    setGenerationTasks([]);
    setSelectedGenerationTaskId("");
    setCollapsedGenerationTaskIds([]);
    setStatus("生图任务已清空。");
  };

  const copyGenerationText = async (key: string, text: string) => {
    if (!text) return;
    await copyText(text);
    setGenerationCopied(key);
    window.setTimeout(() => setGenerationCopied(""), 1400);
  };

  const generationOutputSuggestedName = (task: GenerationTask, output: GenerationOutput, index: number): string =>
    `generated-${task.id.slice(0, 8)}-${String(index + 1).padStart(2, "0")}-${output.id.slice(0, 8)}`;

  const saveGenerationOutputs = async (task: GenerationTask, outputs: GenerationOutput[]) => {
    if (!outputs.length) return;
    try {
      setGenerationError("");
      const result = await window.styleExtractor.saveGenerationOutputs({
        outputs: outputs.map((output) => {
          const index = Math.max(task.outputs.findIndex((item) => item.id === output.id), 0);
          return {
            taskId: task.id,
            outputId: output.id,
            dataUrl: output.dataUrl,
            mimeType: output.mimeType,
            suggestedFileName: generationOutputSuggestedName(task, output, index)
          };
        })
      });
      if (result.canceled) {
        setStatus("已取消保存生成图。");
        return;
      }
      setStatus(
        result.filePaths.length > 1
          ? `已保存 ${result.filePaths.length} 张生成图：${result.directoryPath || ""}`
          : `生成图已保存：${result.filePaths[0] || ""}`
      );
    } catch (downloadError) {
      setGenerationError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    }
  };

  const imageEditOutputSuggestedName = (task: ImageEditTask, output: ImageEditOutput, index: number): string =>
    `edited-${task.id.slice(0, 8)}-${String(index + 1).padStart(2, "0")}-${output.id.slice(0, 8)}`;

  const saveImageEditOutputs = async (task: ImageEditTask, outputs: ImageEditOutput[]) => {
    if (!outputs.length) return;
    try {
      setImageEditError("");
      const result = await window.styleExtractor.saveImageEditOutputs({
        outputs: outputs.map((output) => {
          const index = Math.max(task.outputs.findIndex((item) => item.id === output.id), 0);
          return {
            taskId: task.id,
            outputId: output.id,
            dataUrl: output.dataUrl,
            mimeType: output.mimeType,
            suggestedFileName: imageEditOutputSuggestedName(task, output, index)
          };
        })
      });
      if (result.canceled) {
        setStatus("已取消保存改图输出。");
        return;
      }
      setStatus(
        result.filePaths.length > 1
          ? `已保存 ${result.filePaths.length} 张改图输出：${result.directoryPath || ""}`
          : `改图输出已保存：${result.filePaths[0] || ""}`
      );
    } catch (downloadError) {
      setImageEditError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    }
  };

  const addGenerationOutputAsReference = async (output: GenerationOutput) => {
    const reference: GenerationReferenceImage = {
      id: crypto.randomUUID(),
      name: `generated-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
      mimeType: output.mimeType,
      dataUrl: output.dataUrl,
      thumbnailDataUrl: await createThumbnail(output.dataUrl),
      createdAt: new Date().toISOString()
    };
    setGenerationReferenceImages((current) => [...current, reference].slice(0, 8));
    setStatus("已把生成图加入下一轮参考图。");
  };

  const sendGenerationOutputToImageEdit = async (task: GenerationTask, output: GenerationOutput, index: number) => {
    try {
      const thumbnailDataUrl = await createThumbnail(output.dataUrl);
      await loadImageEditSource(
        {
          fileName: `generated-${task.id.slice(0, 8)}-${String(index + 1).padStart(2, "0")}`,
          mimeType: output.mimeType,
          dataUrl: output.dataUrl,
          thumbnailDataUrl,
          sourceCapture: createLocalSourceCapture("uploaded_image")
        },
        "generation_output",
        {
          generationTaskId: task.id,
          generationOutputId: output.id
        }
      );
      setImageEditInstruction("");
      setActiveView("edit");
      setStatus("已把这张生成图送入改图工作台。");
    } catch (editSourceError) {
      setGenerationError(editSourceError instanceof Error ? editSourceError.message : String(editSourceError));
    }
  };

  const restoreGenerationTask = (task: GenerationTask) => {
    setGenerationPrompt(task.prompt);
    setGenerationPromptSource(task.promptSource);
    setGenerationReferenceImages(task.referenceImages);
    setGenerationSettings((current) => ({
      ...current,
      ...task.settings,
      ...normalizeGenerationSizeSettings(task.settings)
    }));
    setSelectedGenerationTaskId(task.id);
    setGenerationError("");
    setActiveView("generate");
    setStatus("已从生图历史恢复任务，可继续编辑、重试或打开对比。");
  };

  const toggleGenerationTaskCollapsed = (taskId: string) => {
    setCollapsedGenerationTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]
    );
  };

  const toggleImageEditTaskCollapsed = (taskId: string) => {
    setCollapsedImageEditTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]
    );
  };

  const buildGenerationComparePreview = (
    task: GenerationTask,
    output: GenerationOutput,
    outputIndex = task.outputs.findIndex((item) => item.id === output.id)
  ): ComparePreviewState | null => {
    const sourceDataUrl = task.promptSource.sourceImageDataUrl || task.promptSource.sourceThumbnailDataUrl || "";
    if (!sourceDataUrl) return null;
    return {
      kind: "generation",
      taskId: task.id,
      outputId: output.id,
      outputIndex: Math.max(outputIndex, 0),
      outputCount: task.outputs.length,
      sourceTitle: task.promptSource.sourceFileName || task.promptSource.label,
      sourceDataUrl,
      outputTitle: `${task.promptSource.label} · 生成图 ${Math.max(outputIndex, 0) + 1}/${Math.max(task.outputs.length, 1)}`,
      outputDataUrl: output.dataUrl
    };
  };

  const openGenerationCompare = (task: GenerationTask, output: GenerationOutput) => {
    const preview = buildGenerationComparePreview(task, output);
    if (preview) {
      setComparePreview(preview);
      return;
    }
    setGenerationError("这条任务缺少原始提取图，无法打开左右对比。");
  };

  const openGenerationOutputPreview = (task: GenerationTask, output: GenerationOutput, index: number) => {
    openImagePreview({
      dataUrl: output.dataUrl,
      mode: "fit",
      title: `${task.promptSource.label} · 生成图 ${index + 1}/${Math.max(task.outputs.length, 1)}`
    });
  };

  const openImageEditOutputPreview = (task: ImageEditTask, output: ImageEditOutput, index: number) => {
    openImagePreview({
      dataUrl: output.dataUrl,
      mode: "fit",
      title: `${task.sourceImage.name} · 改图输出 ${index + 1}/${Math.max(task.outputs.length, 1)}`
    });
  };

  const openImageEditCompare = (task: ImageEditTask, output: ImageEditOutput) => {
    const preview = buildImageEditComparePreview(task, output);
    if (preview) {
      setComparePreview(preview);
      return;
    }
    setImageEditError("这条改图任务缺少源图，无法打开左右对比。");
  };

  const continueImageEditFromOutput = async (task: ImageEditTask, output: ImageEditOutput, index: number) => {
    try {
      const thumbnailDataUrl = await createThumbnail(output.dataUrl);
      await loadImageEditSource(
        {
          fileName: `edited-${task.id.slice(0, 8)}-${String(index + 1).padStart(2, "0")}`,
          mimeType: output.mimeType,
          dataUrl: output.dataUrl,
          thumbnailDataUrl,
          sourceCapture: createLocalSourceCapture("uploaded_image")
        },
        "restored_edit_output",
        {
          imageEditTaskId: task.id,
          imageEditOutputId: output.id
        }
      );
      setImageEditInstruction("");
      setActiveView("edit");
      setStatus("已把改图输出作为新一轮源图。");
    } catch (continueError) {
      setImageEditError(continueError instanceof Error ? continueError.message : String(continueError));
    }
  };

  const buildImageEditComparePreview = (
    task: ImageEditTask,
    output: ImageEditOutput,
    outputIndex = task.outputs.findIndex((item) => item.id === output.id)
  ): ComparePreviewState | null => {
    const sourceDataUrl = task.sourceImage.dataUrl || task.sourceImage.thumbnailDataUrl || "";
    if (!sourceDataUrl) return null;
    return {
      kind: "image_edit",
      taskId: task.id,
      outputId: output.id,
      outputIndex: Math.max(outputIndex, 0),
      outputCount: task.outputs.length,
      sourceTitle: task.sourceImage.name || "改图源图",
      sourceDataUrl,
      outputTitle: `改图输出 ${Math.max(outputIndex, 0) + 1}/${Math.max(task.outputs.length, 1)}`,
      outputDataUrl: output.dataUrl
    };
  };

  const switchCompareOutput = (direction: -1 | 1) => {
    setComparePreview((current) => {
      if (!current) return current;
      if (current.kind === "image_edit") {
        const task = imageEditTasks.find((item) => item.id === current.taskId);
        if (!task?.outputs.length) return current;
        const nextIndex = (current.outputIndex + direction + task.outputs.length) % task.outputs.length;
        return buildImageEditComparePreview(task, task.outputs[nextIndex], nextIndex) || current;
      }
      const generationTask = generationTasks.find((item) => item.id === current.taskId);
      if (!generationTask?.outputs.length) return current;
      const nextIndex = (current.outputIndex + direction + generationTask.outputs.length) % generationTask.outputs.length;
      return buildGenerationComparePreview(generationTask, generationTask.outputs[nextIndex], nextIndex) || current;
    });
  };

  const analyze = async (targetImage: ImageState | null = image) => {
    if (!targetImage) {
      setError("请先上传图片，或直接粘贴截图。");
      return;
    }
    const activeConfig = configRef.current;
    if (!activeConfig.hasApiKey) {
      setShowConfig(true);
      setError("请先填写模型 API Key。");
      return;
    }

    try {
      analyzeCanceledRef.current = false;
      setIsAnalyzing(true);
      setError("");
      resetFusionState(true);
      setStatus("正在压缩图片并准备分析...");
      const modelImageDataUrl = await createModelImage(targetImage.dataUrl);
      setStatus("正在分析图片风格，并抽象为通用 JSON...");
      const response = await window.styleExtractor.analyzeImage({
        imageDataUrl: modelImageDataUrl,
        mimeType: getMimeTypeFromDataUrl(modelImageDataUrl),
        strictGeneralization: strictGeneralizationRef.current,
        sourceCapture: targetImage.sourceCapture
      });
      setAnalysis(response.analysis);
      setRawText(response.rawText);
      const initialExtractedText = extractedTextFromAnalysis(response.analysis);
      setEditedTextMarkdown(initialExtractedText);
      setStatus(response.repaired ? "分析完成，已自动提取模型返回中的 JSON。" : "分析完成。");
      const historyImageDataUrl = await createHistoryImage(targetImage.dataUrl);
      const historyThumbnailDataUrl = await createThumbnail(historyImageDataUrl);

      const itemId = crypto.randomUUID();
      const item: HistoryItem = {
        id: itemId,
        createdAt: new Date().toISOString(),
        imageDataUrl: historyImageDataUrl,
        mimeType: getMimeTypeFromDataUrl(historyImageDataUrl),
        fileName: targetImage.fileName,
        thumbnailDataUrl: historyThumbnailDataUrl,
        primaryType: response.analysis.image_classification.primary_type || "unknown",
        universalStylePrompt: response.analysis.style_reference.universal_style_prompt,
        analysis: response.analysis,
        editedTextMarkdown: initialExtractedText || undefined
      };
      const nextHistory = await window.styleExtractor.saveHistoryItem(item);
      setActiveHistoryId(itemId);
      setHistory(nextHistory);
    } catch (analyzeError) {
      if (analyzeCanceledRef.current) return;
      setError(analyzeError instanceof Error ? analyzeError.message : String(analyzeError));
      setStatus("");
    } finally {
      setIsAnalyzing(false);
      analyzeCanceledRef.current = false;
    }
  };

  const cancelAnalyze = async () => {
    analyzeCanceledRef.current = true;
    await window.styleExtractor.cancelAnalyzeImage();
    setIsAnalyzing(false);
    setStatus("已取消图片分析。");
    setError("");
  };

  const exportJson = async () => {
    if (!analysis) return;
    const result = await window.styleExtractor.exportJson(analysis);
    if (!result.canceled) setStatus(`JSON 已导出：${result.filePath}`);
  };

  const handleCopy = async (key: string, text: string) => {
    if (!text) return;
    await copyText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1400);
  };

  const handleFuseCopy = async (key: string, text: string) => {
    if (!text) return;
    await copyText(text);
    setFuseCopied(key);
    window.setTimeout(() => setFuseCopied(""), 1400);
  };

  const persistEditedText = async () => {
    if (!activeHistoryId) return;
    const targetHistoryItem = history.find((item) => item.id === activeHistoryId);
    if (!targetHistoryItem) return;
    if ((targetHistoryItem.editedTextMarkdown ?? "") === editedTextMarkdown) return;
    try {
      const nextHistory = await window.styleExtractor.saveHistoryItem({
        ...targetHistoryItem,
        editedTextMarkdown: editedTextMarkdown || undefined
      });
      setHistory(nextHistory);
    } catch {
      // 编辑稿保存失败不打断编辑；下次失焦或生成融合提示词时会再尝试保存。
    }
  };

  const restoreExtractedText = () => {
    setEditedTextMarkdown(extractedTextFromAnalysis(analysis));
    setStatus("已还原为识别出的图中文字。");
  };

  const generateFusionPrompt = async () => {
    if (!analysis) {
      setFuseError("请先完成参考图的提示词解析。");
      return;
    }
    const activeFuseMode = fuseMode;
    if (activeFuseMode === "subject_reference" && !subjectImage) {
      setFuseError("请先上传主体参考图。");
      return;
    }
    if (activeFuseMode === "information_layout" && !subjectImage && !productInfoText.trim()) {
      setFuseError("请先输入新产品信息，或上传一张产品信息图。");
      return;
    }
    const activeSubjectImage = subjectImage;
    const activeConfig = configRef.current;
    if (!activeConfig.hasApiKey) {
      setShowConfig(true);
      setFuseError("请先填写模型 API Key。");
      return;
    }

    try {
      fuseCanceledRef.current = false;
      setIsFusing(true);
      setFuseError("");
      setFusedPrompt("");
      setFusedPromptJson(null);
      setStatus(activeFuseMode === "information_layout" ? "正在准备产品信息布局输入..." : "正在准备主体融合输入...");
      const subjectImageDataUrl = activeSubjectImage ? await createModelImage(activeSubjectImage.dataUrl) : undefined;
      setStatus(activeFuseMode === "information_layout" ? "正在生成产品信息布局提示词..." : "正在生成主体融合提示词...");
      const response = await window.styleExtractor.fusePrompt({
        styleAnalysis: analysis,
        mode: activeFuseMode,
        subjectImageDataUrl,
        productInfoText,
        editedTextMarkdown: fuseControls.useExtractedText ? editedTextMarkdown : undefined,
        controls: fuseControls
      });
      setFusedPrompt(response.result.fused_prompt);
      setFusedPromptJson(response.result.fused_prompt_json);
      if (activeHistoryId) {
        const targetHistoryItem = history.find((item) => item.id === activeHistoryId);
        if (targetHistoryItem) {
          const nextHistory = await window.styleExtractor.saveHistoryItem({
            ...targetHistoryItem,
            analysis,
            editedTextMarkdown: editedTextMarkdown || undefined,
            fusedPromptResult: response.result,
            fusedPromptCreatedAt: new Date().toISOString()
          });
          setHistory(nextHistory);
        }
      }
      const referenceSynced = await syncFusionImageToGenerationReferences(
        activeSubjectImage,
        activeFuseMode,
        subjectImageDataUrl
      );
      const doneText = activeFuseMode === "information_layout" ? "产品信息布局提示词已生成。" : "融合提示词已生成。";
      const referenceText = referenceSynced ? "用于融合的图片已同步到生图工作台参考图。" : "";
      setStatus(response.repaired ? `${doneText}并已自动修正为完整中文。${referenceText}` : `${doneText}${referenceText}`);
    } catch (fusePromptError) {
      if (fuseCanceledRef.current) return;
      setFuseError(fusePromptError instanceof Error ? fusePromptError.message : String(fusePromptError));
      setStatus("");
    } finally {
      setIsFusing(false);
      fuseCanceledRef.current = false;
    }
  };

  const cancelFusionPrompt = async () => {
    fuseCanceledRef.current = true;
    await window.styleExtractor.cancelFusePrompt();
    setIsFusing(false);
    setStatus("已取消提示词生成。");
    setFuseError("");
  };

  const loadHistory = (item: HistoryItem) => {
    const historyImage = historyItemToImageState(item);
    if (historyImage) setImage(historyImage);
    setAnalysis(item.analysis);
    setRawText("");
    setActiveHistoryId(item.id);
    setError("");
    setEditedTextMarkdown(item.editedTextMarkdown ?? extractedTextFromAnalysis(item.analysis));
    setSubjectImage(null);
    setIsSubjectDragging(false);
    setFusedPrompt(item.fusedPromptResult?.fused_prompt ?? "");
    setFusedPromptJson(item.fusedPromptResult?.fused_prompt_json ?? null);
    setFuseError("");
    setFuseCopied("");
    setFuseControls(defaultFuseControls);
    setSelectedFuseMode(null);
    setProductInfoText("");
    setShowFuseModal(false);
    const historyStatus = item.imageDataUrl
      ? "已载入历史图片和分析结果，可重新分析。"
      : "已载入历史缩略图和分析结果，可重新分析；旧历史条目没有保存原图。";
    setStatus(item.fusedPromptResult ? `${historyStatus} 已同时载入融合提示词。` : historyStatus);
  };

  const clearHistory = async () => {
    if (history.length > 0 && !window.confirm("确定清空全部图片分析历史记录吗？")) return;
    await window.styleExtractor.clearHistory();
    setHistory([]);
    setActiveHistoryId("");
    setStatus("历史记录已清空。");
  };

  const deleteHistoryItem = async (item: HistoryItem) => {
    if (!window.confirm("确定删除这条图片分析历史记录吗？")) return;
    const nextHistory = await window.styleExtractor.deleteHistoryItem(item.id);
    setHistory(nextHistory);
    if (activeHistoryId === item.id) setActiveHistoryId("");
    setStatus("已删除此条历史记录。");
  };

  const clearModelConfig = async () => {
    if (!window.confirm("确定抹除模型配置和已保存的 API Key 吗？")) return;
    const cleared = await window.styleExtractor.clearConfig();
    setConfig(cleared);
    setDraftConfig({ ...cleared, apiKey: "" });
    setStatus("模型配置和 API Key 已抹除。");
  };

  const clearAllLocalData = async () => {
    if (!window.confirm("确定抹除模型配置、API Key、图片分析历史、生图任务和改图任务吗？这个操作不可恢复。")) return;
    const cleared = await window.styleExtractor.clearAllLocalData();
    setConfig(cleared);
    setDraftConfig({ ...cleared, apiKey: "" });
    setHistory([]);
    setAnalysis(null);
    setRawText("");
    setActiveHistoryId("");
    setEditedTextMarkdown("");
    setGenerationPrompt("");
    setGenerationPromptSource(null);
    setGenerationReferenceImages([]);
    setGenerationTasks([]);
    setCollapsedGenerationTaskIds([]);
    setGenerationConfig(defaultGenerationConfig);
    setGenerationDraft(defaultGenerationDraft);
    setGenerationSettings(defaultGenerationSettings);
    setImageEditSource(null);
    setImageEditAnnotations([]);
    setImageEditFidelityMode("reference");
    setImageEditInstruction("");
    setImageEditSettings(defaultImageEditSettings);
    setImageEditTasks([]);
    resetFusionState(true);
    setStatus("本机模型配置、API Key、图片历史记录、生图任务和改图任务已全部抹除。");
    setShowConfig(false);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>图片复刻大师</h1>
          <p>提取可迁移的风格、配色、排版与视觉系统，不做原图 1:1 复刻。</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" onClick={() => void openGenerationConfig()} type="button">
            <Sparkles size={18} />
            生图配置
          </button>
          <label className="switch">
            <input
              checked={strictGeneralization}
              onChange={(event) => setStrictGeneralization(event.target.checked)}
              type="checkbox"
            />
            <span />
            严格通用化
          </label>
          <button className="ghost-button" onClick={() => setShowConfig(true)} type="button">
            <Settings size={18} />
            模型配置
          </button>
        </div>
      </header>

      <nav className="page-tabs" aria-label="工作区切换">
        <button className={activeView === "extract" ? "active" : ""} onClick={() => setActiveView("extract")} type="button">
          <FileJson size={18} />
          提示词提取
        </button>
        <button className={activeView === "generate" ? "active" : ""} onClick={() => setActiveView("generate")} type="button">
          <Sparkles size={18} />
          生图工作台
        </button>
        <button className={activeView === "edit" ? "active" : ""} onClick={() => setActiveView("edit")} type="button">
          <PenLine size={18} />
          改图工作台
        </button>
      </nav>

      {(status || error) && (
        <section className={error ? "notice error" : "notice"}>
          {error ? <AlertCircle size={18} /> : <Check size={18} />}
          <span>{error || status}</span>
        </section>
      )}

      {activeView === "extract" && <section className="workspace">
        <aside className="left-panel">
          <div
            className={`upload-zone ${isDragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            {image ? (
              <button
                className="image-preview-button"
                onClick={() => openImagePreview({ dataUrl: image.dataUrl, title: image.fileName })}
                title="查看大图"
                type="button"
              >
                <img alt="待分析图片预览" src={image.dataUrl} />
                <span className="preview-corner-icon" aria-hidden="true">
                  <Maximize2 size={18} />
                </span>
              </button>
            ) : (
              <div className="empty-upload">
                <ImagePlus size={44} />
                <strong>上传图片或粘贴截图</strong>
                <span>支持拖拽、选择文件、Cmd + V</span>
              </div>
            )}
          </div>

          {image && (
            <div className="source-meta">
              <ImagePlus size={17} />
              <span>
                <strong>{getSourceLabel(image.sourceCapture)}</strong>
                {image.sourceCapture.domain ? ` · ${image.sourceCapture.domain}` : ""}
                {image.sourceCapture.page_title ? ` · ${image.sourceCapture.page_title}` : ""}
              </span>
            </div>
          )}

          <div className="button-row">
            <button className="secondary-button" onClick={() => fileInputRef.current?.click()} type="button">
              <Upload size={18} />
              选择图片
            </button>
            <button className="primary-button" disabled={isAnalyzing || !image} onClick={() => analyze()} type="button">
              {isAnalyzing ? <Loader2 className="spin" size={18} /> : <FileJson size={18} />}
              开始分析
            </button>
            {isAnalyzing && (
              <button className="secondary-button" onClick={cancelAnalyze} type="button">
                <X size={18} />
                取消
              </button>
            )}
          </div>
          <input
            accept="image/*"
            hidden
            onChange={onFileChange}
            ref={fileInputRef}
            type="file"
          />

          <div className="hint-box">
            <Clipboard size={18} />
            <span>图片里的文字只用于判断层级和排版，默认不会要求模型照抄文案、品牌、价格或数据。</span>
          </div>

          <section className="history-panel">
            <div className="section-title">
              <History size={18} />
              <h2>历史记录</h2>
              {history.length > 0 && (
                <button className="mini-danger-button" onClick={clearHistory} type="button">
                  <Trash2 size={16} />
                  清空历史
                </button>
              )}
            </div>
            <div className="history-list">
              {history.length === 0 ? (
                <p className="empty-text">暂无历史结果</p>
              ) : (
                history.map((item) => (
                  <div className={`history-entry ${activeHistoryId === item.id ? "active" : ""}`} key={item.id}>
                    <button className="history-item" onClick={() => loadHistory(item)} type="button">
                      <img alt="" src={item.thumbnailDataUrl} />
                      <span>
                        <strong>{getHistorySourceLabel(item)} · {item.primaryType}</strong>
                        <small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small>
                        {item.fusedPromptResult && <small>含融合提示词</small>}
                      </span>
                    </button>
                    <button
                      className="history-delete-button"
                      onClick={() => deleteHistoryItem(item)}
                      title="删除此条历史"
                      type="button"
                    >
                      <Trash2 size={16} />
                      <span className="sr-only">删除此条历史</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="result-panel">
          {analysis && (
            <section className={fusedPrompt ? "fusion-panel expanded" : "fusion-panel"}>
              <div className="fusion-panel-header">
                <div>
                  <h2>{fuseMode === "information_layout" ? "产品信息布局融合" : "主体参考图融合"}</h2>
                  <p>
                    {fuseMode === "information_layout"
                      ? "可选。输入或上传新产品信息后，迁移当前解析出的资料卡、表格或卡片版式。"
                      : "可选。上传主体图后，只保留其中主要主体，并迁移当前解析出的风格和排版。"}
                  </p>
                </div>
                <button className="primary-button" onClick={() => setShowFuseModal(true)} type="button">
                  <Sparkles size={18} />
                  {fusedPrompt
                    ? fuseMode === "information_layout"
                      ? "重新生成产品图提示词"
                      : "重新融合主体图"
                    : fuseMode === "information_layout"
                      ? "输入产品信息"
                      : "上传主体参考图"}
                </button>
              </div>
              {fusedPrompt ? (
                <div className="fused-main-output">
                  <FusedPromptOutput
                    copiedKey={fuseCopied}
                    jsonText={fusedPromptJson ? fusedJsonText(fusedPromptJson) : ""}
                    onCopyJson={() => fusedPromptJson && handleFuseCopy("json", fusedJsonText(fusedPromptJson))}
                    onCopyPrompt={() => handleFuseCopy("prompt", fusedPrompt)}
                    prompt={fusedPrompt}
                  />
                </div>
              ) : (
                <p className="fusion-empty-text">
                  {fuseMode === "information_layout"
                    ? "生成后会在这里显示可复制给生图平台的产品信息图 JSON 提示词。"
                    : "生成后会在这里直接显示最终融合提示词，不需要先复制到别处查看。"}
                </p>
              )}
            </section>
          )}

          <div className="prompt-grid">
            <PromptBlock
              copied={copied === "universal"}
              label="通用风格提示词"
              onCopy={() => handleCopy("universal", prompts.universal)}
              value={prompts.universal}
            />
            <PromptBlock
              copied={copied === "layout"}
              label="排版布局提示词"
              onCopy={() => handleCopy("layout", prompts.layout)}
              value={prompts.layout}
            />
            <PromptBlock
              copied={copied === "negative"}
              label="负面提示词"
              onCopy={() => handleCopy("negative", prompts.negative)}
              value={prompts.negative}
            />
            <PromptBlock
              copied={copied === "template"}
              label="封面模板提示词"
              onCopy={() => handleCopy("template", prompts.template)}
              value={prompts.template}
            />
            <PromptBlock
              copied={copied === "informationLayout"}
              label="表格/卡片信息布局提示词"
              onCopy={() => handleCopy("informationLayout", prompts.informationLayout)}
              placeholder="资料卡、图表、表格或产品卡片页分析后这里会显示可复制的布局反推 JSON 提示词。"
              value={prompts.informationLayout}
            />
            <PromptBlock
              copied={copied === "styleTerms"}
              label="网页设计风格词"
              onCopy={() => handleCopy("styleTerms", styleTermsText)}
              placeholder="网页截图分析后这里会显示可复制的布局、字体、配色、组件和材质风格词。"
              value={styleTermsText}
            />
          </div>

          {analysis && (
            <section className="extracted-text-panel">
              <div className="json-header">
                <div>
                  <h2>图中文字（Markdown）</h2>
                  <p>按层级转写的图中原文，可直接编辑；主体融合时可选择把编辑稿代入最终提示词。</p>
                </div>
                <div className="button-row compact">
                  <button
                    className="secondary-button"
                    disabled={!editedTextMarkdown}
                    onClick={() => handleCopy("extractedText", editedTextMarkdown)}
                    type="button"
                  >
                    <Copy size={17} />
                    {copied === "extractedText" ? "已复制" : "复制"}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={editedTextMarkdown === extractedTextFromAnalysis(analysis)}
                    onClick={restoreExtractedText}
                    type="button"
                  >
                    <RotateCcw size={17} />
                    还原识别结果
                  </button>
                </div>
              </div>
              {analysis.extracted_text.applies || editedTextMarkdown ? (
                <>
                  <textarea
                    aria-label="图中文字 Markdown 编辑区"
                    className="extracted-text-editor"
                    onBlur={persistEditedText}
                    onChange={(event) => setEditedTextMarkdown(event.target.value)}
                    placeholder="这里会显示按层级转写的图中文字，可直接编辑。"
                    value={editedTextMarkdown}
                  />
                  {analysis.extracted_text.extraction_notes && (
                    <p className="extracted-text-notes">
                      <FileText size={15} />
                      {analysis.extracted_text.extraction_notes}
                    </p>
                  )}
                </>
              ) : (
                <p className="empty-text">当前参考图没有识别到可提取的文字。</p>
              )}
            </section>
          )}

          <div className="json-header">
            <div>
              <h2>完整 JSON</h2>
              <p>用于迁移到其他生图工具或保存为风格规范。</p>
            </div>
            <div className="button-row compact">
              <button
                className="secondary-button"
                disabled={!analysis}
                onClick={() => handleCopy("json", jsonText(analysis))}
                type="button"
              >
                <Copy size={17} />
                {copied === "json" ? "已复制" : "复制 JSON"}
              </button>
              <button className="secondary-button" disabled={!analysis} onClick={exportJson} type="button">
                <Download size={17} />
                导出
              </button>
            </div>
          </div>

          <pre className="json-viewer">
            {analysis
              ? jsonText(analysis)
              : `等待分析结果...\n\n输出会固定为通用 JSON，重点保留风格、配色、排版、光影、字体气质、图表/海报/产品图的视觉规律。`}
          </pre>

          {rawText && (
            <details className="raw-details">
              <summary>查看模型原始返回</summary>
              <pre>{rawText}</pre>
            </details>
          )}
        </section>
      </section>}

      {activeView === "generate" && (
        <GenerationWorkspace
          copiedKey={generationCopied}
          collapsedTaskIds={collapsedGenerationTaskIds}
          error={generationError}
          isGenerating={isGeneratingImage}
          onClearTasks={clearGenerationTasks}
          onCancelTask={cancelGenerationTask}
          onCopyText={copyGenerationText}
          onCreateTask={createGeneration}
          onDeleteTask={deleteGenerationTask}
          onDownloadOutput={saveGenerationOutputs}
          onDownloadTaskOutputs={(task) => saveGenerationOutputs(task, task.outputs)}
          onComposeReferences={composeGenerationReferences}
          onAddOutputAsReference={addGenerationOutputAsReference}
          onSendOutputToEdit={sendGenerationOutputToImageEdit}
          onEditReference={setEditingGenerationReferenceId}
          onImportPrompt={importPromptToGeneration}
          onOpenCompare={openGenerationCompare}
          onOpenOutputPreview={openGenerationOutputPreview}
          onOpenConfig={() => void openGenerationConfig()}
          onPickReference={() => generationReferenceInputRef.current?.click()}
          onReferenceDrop={(event) => {
            event.preventDefault();
            void handleGenerationReferenceFiles(event.dataTransfer.files);
          }}
          onRemoveReference={removeGenerationReference}
          onRestoreTask={restoreGenerationTask}
          onRetryTask={retryGenerationTask}
          onToggleTaskCollapsed={toggleGenerationTaskCollapsed}
          onUpdateTaskVisibility={updateGenerationTaskVisibility}
          options={generationPromptOptions}
          prompt={generationPrompt}
          promptSource={generationPromptSource}
          referenceImages={generationReferenceImages}
          restoreOnTaskClick={restoreOnGenerationTaskClick}
          setRestoreOnTaskClick={setRestoreOnGenerationTaskClick}
          setPrompt={setGenerationPrompt}
          setSettings={setGenerationSettings}
          settings={generationSettings}
          selectedTaskId={selectedGenerationTaskId}
          tasks={generationTasks}
          backendActionLabel={generationBackendActionLabel(generationConfig)}
          backendReady={generationBackendReady}
        />
      )}

      {activeView === "edit" && (
        <ImageEditWorkspace
          annotations={imageEditAnnotations}
          backendActionLabel={generationBackendActionLabel(generationConfig)}
          backendReady={generationBackendReady}
          error={imageEditError}
          fidelityMode={imageEditFidelityMode}
          instruction={imageEditInstruction}
          isCreating={isCreatingImageEdit}
          isDragging={isImageEditDragging}
          isRenderingLocalMask={isRenderingImageEditLocalMask}
          localMaskPreview={imageEditLocalMaskPreview}
          maskCapability={imageEditMaskCapability}
          onCancelTask={cancelImageEditTask}
          onClearAnnotations={() => setImageEditAnnotations([])}
          onClearTasks={clearImageEditTasks}
          onCreateTask={createImageEditTask}
          onDeleteTask={deleteImageEditTask}
          onDownloadOutput={saveImageEditOutputs}
          onContinueFromOutput={continueImageEditFromOutput}
          onOpenCompare={openImageEditCompare}
          onOpenOutputPreview={openImageEditOutputPreview}
          onOpenConfig={() => void openGenerationConfig()}
          onPickSource={() => imageEditSourceInputRef.current?.click()}
          onRetryTask={retryImageEditTask}
          onSetOutputVariantView={setImageEditOutputVariantView}
          onToggleTaskCollapsed={toggleImageEditTaskCollapsed}
          onSetFidelityMode={setImageEditFidelityMode}
          onSetAnnotations={setImageEditAnnotations}
          onSetInstruction={setImageEditInstruction}
          onSetPixelProtectionEnabled={setImageEditPixelProtectionEnabled}
          onSetSettings={setImageEditSettings}
          onSourceDrop={(event) => {
            event.preventDefault();
            setIsImageEditDragging(false);
            void handleImageEditSourceFiles(event.dataTransfer.files);
          }}
          onSourceDragLeave={() => setIsImageEditDragging(false)}
          onSourceDragOver={(event) => {
            event.preventDefault();
            setIsImageEditDragging(true);
          }}
          onUpdateTaskVisibility={updateImageEditTaskVisibility}
          selectedTaskId={selectedImageEditTaskId}
          settings={imageEditSettings}
          source={imageEditSource}
          collapsedTaskIds={collapsedImageEditTaskIds}
          outputVariantView={imageEditOutputVariantView}
          pixelProtectionEnabled={imageEditPixelProtectionEnabled}
          tasks={imageEditTasks}
        />
      )}

      <input
        accept="image/*"
        hidden
        multiple
        onChange={onGenerationReferenceChange}
        ref={generationReferenceInputRef}
        type="file"
      />

      <input
        accept="image/*"
        hidden
        onChange={onImageEditSourceChange}
        ref={imageEditSourceInputRef}
        type="file"
      />

      {editingGenerationReference && (
        <ReferenceImageEditor
          onClose={() => setEditingGenerationReferenceId("")}
          onSave={(dataUrl) => saveEditedGenerationReference(editingGenerationReference, dataUrl)}
          reference={editingGenerationReference}
        />
      )}

      {showFuseModal && (
        <div className="modal-backdrop" onMouseDown={() => setShowFuseModal(false)}>
          <section className="modal fusion-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title">
              <h2>{fuseMode === "information_layout" ? "输入新产品信息" : "上传主体参考图"}</h2>
              <p>
                {fuseMode === "information_layout"
                  ? "输入文字后只按这些文字生成可见内容；也可以只上传产品信息图识别内容。"
                  : "只保留主体参考图中占比最大、最清晰、视觉焦点最明确的主要主体。"}
              </p>
            </div>

            {supportsInformationLayoutMode && (
              <div className="fusion-mode-tabs" aria-label="融合模式">
                <button
                  className={fuseMode === "information_layout" ? "active" : ""}
                  disabled={isFusing}
                  onClick={() => {
                    setSelectedFuseMode("information_layout");
                    setFusedPrompt("");
                    setFusedPromptJson(null);
                    setFuseError("");
                    setFuseCopied("");
                  }}
                  type="button"
                >
                  产品信息布局
                </button>
                <button
                  className={fuseMode === "subject_reference" ? "active" : ""}
                  disabled={isFusing}
                  onClick={() => {
                    setSelectedFuseMode("subject_reference");
                    setFusedPrompt("");
                    setFusedPromptJson(null);
                    setFuseError("");
                    setFuseCopied("");
                  }}
                  type="button"
                >
                  主体参考图融合
                </button>
              </div>
            )}

            {fuseMode === "information_layout" && (
              <label className="product-info-field">
                <span>新产品文字内容</span>
                <textarea
                  disabled={isFusing}
                  onChange={(event) => {
                    setProductInfoText(event.target.value);
                    setFusedPrompt("");
                    setFusedPromptJson(null);
                    setFuseError("");
                    setFuseCopied("");
                  }}
                  placeholder="输入产品名称、卖点、参数、价格区间、适用人群、对比项或你希望放入资料卡的完整文案。生成时只允许使用这里输入的文字，不会补充未输入的信息。"
                  value={productInfoText}
                />
                {editedTextMarkdown.trim() && (
                  <button
                    className="secondary-button import-extracted-text-button"
                    disabled={isFusing}
                    onClick={() => {
                      setProductInfoText(editedTextMarkdown);
                      setFusedPrompt("");
                      setFusedPromptJson(null);
                      setFuseError("");
                      setFuseCopied("");
                      setStatus("已把编辑后的图中文字导入为新产品文字。");
                    }}
                    type="button"
                  >
                    <FileText size={17} />
                    从图中文字导入
                  </button>
                )}
              </label>
            )}

            <div
              className={`subject-upload-zone ${isSubjectDragging ? "dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsSubjectDragging(true);
              }}
              onDragLeave={() => setIsSubjectDragging(false)}
              onDrop={onSubjectDrop}
            >
              {subjectImage ? (
                <button
                  className="image-preview-button"
                  onClick={() => openImagePreview({ dataUrl: subjectImage.dataUrl, title: subjectImage.fileName })}
                  title="查看大图"
                  type="button"
                >
                  <img alt={fuseMode === "information_layout" ? "产品信息图预览" : "主体参考图预览"} src={subjectImage.dataUrl} />
                  <span className="preview-corner-icon" aria-hidden="true">
                    <Maximize2 size={18} />
                  </span>
                </button>
              ) : (
                <div className="empty-upload">
                  <ImagePlus size={38} />
                  <strong>{fuseMode === "information_layout" ? "上传产品信息图（可选）" : "上传主体参考图"}</strong>
                  <span>{fuseMode === "information_layout" ? "可只输入文字，也支持图片补充" : "支持拖拽、选择文件、Cmd + V"}</span>
                </div>
              )}
            </div>

            <input
              accept="image/*"
              hidden
              onChange={onSubjectFileChange}
              ref={subjectFileInputRef}
              type="file"
            />

            {fuseMode === "subject_reference" && subjectImage && (
              <section className="fusion-controls" aria-label="主体参考控制">
                <label className="switch fusion-control-switch">
                  <input
                    checked={fuseControls.useTargetHair}
                    disabled={isFusing}
                    onChange={(event) =>
                      setFuseControls((current) => ({
                        ...current,
                        useTargetHair: event.target.checked
                      }))
                    }
                    type="checkbox"
                  />
                  <span />
                  <div className="fusion-control-copy">
                    <strong>代入已解析发型和头发质感</strong>
                    <small>关闭时沿用主体参考图原发型。</small>
                  </div>
                </label>
                <label className="switch fusion-control-switch">
                  <input
                    checked={fuseControls.useTargetPose}
                    disabled={isFusing}
                    onChange={(event) =>
                      setFuseControls((current) => ({
                        ...current,
                        useTargetPose: event.target.checked
                      }))
                    }
                    type="checkbox"
                  />
                  <span />
                  <div className="fusion-control-copy">
                    <strong>代入已解析身体姿态和动作造型</strong>
                    <small>关闭时沿用主体参考图原姿态。</small>
                  </div>
                </label>
                {editedTextMarkdown.trim() && (
                  <label className="switch fusion-control-switch">
                    <input
                      checked={fuseControls.useExtractedText}
                      disabled={isFusing}
                      onChange={(event) =>
                        setFuseControls((current) => ({
                          ...current,
                          useExtractedText: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    <span />
                    <div className="fusion-control-copy">
                      <strong>代入编辑后的图中文字</strong>
                      <small>开启后画面可见文字只来自“图中文字（Markdown）”编辑稿；关闭时不代入参考图原文。</small>
                    </div>
                  </label>
                )}
              </section>
            )}

            <div className="button-row fuse-actions">
              <button className="secondary-button" onClick={() => subjectFileInputRef.current?.click()} type="button">
                <Upload size={18} />
                {fuseMode === "information_layout" ? "选择信息图" : "选择主体图"}
              </button>
              <button
                className="primary-button"
                disabled={
                  isFusing ||
                  !analysis ||
                  (fuseMode === "subject_reference" && !subjectImage) ||
                  (fuseMode === "information_layout" && !subjectImage && !productInfoText.trim())
                }
                onClick={generateFusionPrompt}
                type="button"
              >
                {isFusing ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
                {fuseMode === "information_layout" ? "生成产品图提示词" : "生成融合提示词"}
              </button>
              {isFusing && (
                <button className="secondary-button" onClick={cancelFusionPrompt} type="button">
                  <X size={18} />
                  取消
                </button>
              )}
            </div>

            {fuseError && (
              <div className="inline-error">
                <AlertCircle size={17} />
                <span>{fuseError}</span>
              </div>
            )}

            {fusedPrompt && (
              <section className="fused-output">
                <FusedPromptOutput
                  compact
                  copiedKey={fuseCopied}
                  onCopyPrompt={() => handleFuseCopy("prompt", fusedPrompt)}
                  prompt={fusedPrompt}
                />
              </section>
            )}

            {fusedPromptJson && (
              <section className="fused-output">
                <div className="prompt-title">
                  <h2>融合 JSON</h2>
                  <button
                    className="icon-button"
                    onClick={() => handleFuseCopy("json", fusedJsonText(fusedPromptJson))}
                    title="复制融合 JSON"
                    type="button"
                  >
                    {fuseCopied === "json" ? <Check size={17} /> : <Copy size={17} />}
                  </button>
                </div>
                <pre className="fused-json-viewer">{fusedJsonText(fusedPromptJson)}</pre>
              </section>
            )}

            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowFuseModal(false)} type="button">
                关闭
              </button>
            </div>
          </section>
        </div>
      )}

      {imagePreview && (
        <div className="image-viewer-backdrop" onMouseDown={closeImagePreview}>
          <section
            aria-label="图片大图预览"
            aria-modal="true"
            className={[
              "image-viewer",
              imagePreview.mode === "fit" ? "fit-preview" : "",
              imagePreviewZoom.enabled ? "zoomed" : ""
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="image-viewer-toolbar">
              <strong>{imagePreview.title}</strong>
              <button
                className="icon-button viewer-close-button"
                onClick={closeImagePreview}
                title="关闭"
                type="button"
              >
                <X size={20} />
              </button>
            </div>
            <div className="image-viewer-stage">
              <img
                alt={imagePreview.title}
                onClick={toggleImagePreviewZoom}
                src={imagePreview.dataUrl}
                style={{ transformOrigin: `${imagePreviewZoom.originX}% ${imagePreviewZoom.originY}%` }}
              />
            </div>
          </section>
        </div>
      )}

      {comparePreview && (
        <div className="compare-backdrop" onMouseDown={() => setComparePreview(null)}>
          <section
            aria-label="原图与生成图左右对比"
            aria-modal="true"
            className="compare-viewer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="compare-toolbar">
              <strong>原始提取图 / 生成图对比</strong>
              {comparePreview.outputCount > 1 && (
                <div className="compare-switcher">
                  <button
                    className="secondary-button"
                    onClick={() => switchCompareOutput(-1)}
                    type="button"
                  >
                    上一张
                  </button>
                  <span>{comparePreview.outputIndex + 1}/{comparePreview.outputCount}</span>
                  <button
                    className="secondary-button"
                    onClick={() => switchCompareOutput(1)}
                    type="button"
                  >
                    下一张
                  </button>
                </div>
              )}
              <button
                className="icon-button viewer-close-button"
                onClick={() => setComparePreview(null)}
                title="关闭"
                type="button"
              >
                <X size={20} />
              </button>
            </div>
            <div className="compare-grid">
              <figure>
                <figcaption>{comparePreview.sourceTitle}</figcaption>
                <img alt="最早提取提示词的原始图片" src={comparePreview.sourceDataUrl} />
              </figure>
              <figure>
                <figcaption>{comparePreview.outputTitle}</figcaption>
                <img alt="生成图片" src={comparePreview.outputDataUrl} />
              </figure>
            </div>
          </section>
        </div>
      )}

      {showGenerationConfig && (
        <div className="modal-backdrop" onMouseDown={() => setShowGenerationConfig(false)}>
          <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title">
              <h2>生图配置</h2>
              <p>可使用 Codex OAuth 内部后端，或 OpenAI-compatible Images API / Responses 图像工具。</p>
            </div>
            <label>
              生图后端
              <select
                onChange={(event) =>
                  setGenerationDraft({
                    ...generationDraft,
                    authSource: event.target.value === "api" ? "api" : "codex_oauth",
                    apiMode: event.target.value === "api" ? generationDraft.apiMode : "responses"
                  })
                }
                value={generationDraft.authSource}
              >
                <option value="codex_oauth">Codex OAuth 内部后端</option>
                <option value="api">OpenAI-compatible API Key</option>
              </select>
            </label>
            {generationDraft.authSource === "codex_oauth" && (
              <div className={generationDraft.codexOAuthAvailable ? "config-note" : "config-warning"}>
                {generationDraft.codexOAuthAvailable
                  ? `已检测到 Codex OAuth 登录${
                      generationDraft.codexOAuthAccountId ? `（账号 ${generationDraft.codexOAuthAccountId}）` : ""
                    }。`
                  : `未检测到可用 Codex OAuth，请先在终端运行 codex login。${
                      generationDraft.codexOAuthError ? ` ${generationDraft.codexOAuthError}` : ""
                    }`}
                <br />
                <span>{generationDraft.codexOAuthPath || "~/.codex/auth.json"}</span>
              </div>
            )}
            {generationDraft.authSource === "api" && (
              <div className="generation-provider-panel">
                <div className="generation-provider-panel-header">
                  <div>
                    <strong>API 供应商</strong>
                    <span>切换、复制、删除和排序只影响独立生图配置。</span>
                  </div>
                  <div className="generation-provider-header-actions">
                    <button className="secondary-button" onClick={() => void createGenerationProvider()} type="button">
                      <Sparkles size={16} />
                      新增供应商
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => void createGenerationProvider("openrouter")}
                      type="button"
                    >
                      <Sparkles size={16} />
                      新增 OpenRouter
                    </button>
                  </div>
                </div>
                <div className="generation-provider-list">
                  {generationDraft.providers.map((provider, index) => {
                    const active = provider.id === generationDraft.activeProviderId;
                    return (
                      <article className={active ? "generation-provider-card active" : "generation-provider-card"} key={provider.id}>
                        <button
                          className="generation-provider-main"
                          onClick={() => void selectGenerationProvider(provider.id)}
                          type="button"
                        >
                          <strong>{provider.name}</strong>
                          <small>
                            {formatGenerationProviderType(provider.providerType)} · {provider.apiBaseUrl} ·{" "}
                            {provider.providerType === "openrouter"
                              ? "OpenRouter Images"
                              : provider.apiMode === "responses"
                                ? "Responses"
                                : "Images"}{" "}
                            · {provider.hasApiKey ? "已配置 Key" : "未配置 Key"}
                          </small>
                        </button>
                        <div className="generation-provider-actions">
                          <button
                            className="secondary-button"
                            disabled={index === 0}
                            onClick={() => void moveGenerationProvider(provider.id, -1)}
                            title="上移"
                            type="button"
                          >
                            <ChevronUp size={15} />
                          </button>
                          <button
                            className="secondary-button"
                            disabled={index === generationDraft.providers.length - 1}
                            onClick={() => void moveGenerationProvider(provider.id, 1)}
                            title="下移"
                            type="button"
                          >
                            <ChevronDown size={15} />
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => void duplicateGenerationProvider(provider.id)}
                            type="button"
                          >
                            <Copy size={15} />
                            复制
                          </button>
                          <button
                            className="history-delete-button"
                            onClick={() => void deleteGenerationProvider(provider.id)}
                            title="删除供应商"
                            type="button"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
            {generationDraft.authSource === "api" && (
              <label>
                供应商类型
                <select
                  onChange={(event) => {
                    const providerType =
                      event.target.value === "openrouter" ? "openrouter" : "openai_compatible";
                    const isOpenRouter = providerType === "openrouter";
                    const imageModel = isOpenRouter
                      ? !generationDraft.imageModel || generationDraft.imageModel === defaultGenerationProvider.imageModel
                        ? openRouterGenerationDefaults.imageModel
                        : generationDraft.imageModel
                      : generationDraft.imageModel === openRouterGenerationDefaults.imageModel
                        ? defaultGenerationProvider.imageModel
                        : generationDraft.imageModel;
                    setGenerationDraft({
                      ...generationDraft,
                      providerType,
                      apiBaseUrl: isOpenRouter
                        ? openRouterGenerationDefaults.apiBaseUrl
                        : generationDraft.apiBaseUrl === openRouterGenerationDefaults.apiBaseUrl
                          ? defaultGenerationProvider.apiBaseUrl
                          : generationDraft.apiBaseUrl || defaultGenerationProvider.apiBaseUrl,
                      apiMode: isOpenRouter ? "images" : generationDraft.apiMode,
                      imageModel
                    });
                  }}
                  value={generationDraft.providerType}
                >
                  <option value="openai_compatible">OpenAI-compatible</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </label>
            )}
            {generationDraft.authSource === "api" && (
              <label>
                供应商名称
                <input
                  onChange={(event) => setGenerationDraft({ ...generationDraft, providerName: event.target.value })}
                  placeholder="例如 OpenAI 官方、公司代理、备用线路"
                  value={generationDraft.providerName || ""}
                />
              </label>
            )}
            <label>
              API Base URL
              <input
                disabled={generationDraft.authSource === "codex_oauth"}
                onChange={(event) => setGenerationDraft({ ...generationDraft, apiBaseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
                value={generationDraft.apiBaseUrl}
              />
            </label>
            {usesInsecureGenerationBaseUrl && (
              <p className="config-warning">当前 Base URL 使用 http://，API Key、提示词和图片内容会以明文链路传输。</p>
            )}
            <label>
              调用方式
              <select
                disabled={generationDraft.authSource === "codex_oauth" || generationDraft.providerType === "openrouter"}
                onChange={(event) =>
                  setGenerationDraft({
                    ...generationDraft,
                    apiMode: event.target.value === "responses" ? "responses" : "images"
                  })
                }
                value={generationDraft.apiMode}
              >
                {generationDraft.providerType === "openrouter" ? (
                  <option value="images">OpenRouter Images API</option>
                ) : (
                  <>
                    <option value="images">Images API</option>
                    <option value="responses">Responses 图像工具</option>
                  </>
                )}
              </select>
            </label>
            <label>
              Image Model
              <input
                onChange={(event) => setGenerationDraft({ ...generationDraft, imageModel: event.target.value })}
                placeholder="gpt-image-2"
                value={generationDraft.imageModel}
              />
            </label>
            <label>
              Main Model（Responses）
              <input
                disabled={generationDraft.authSource === "codex_oauth" || generationDraft.providerType === "openrouter"}
                onChange={(event) => setGenerationDraft({ ...generationDraft, mainModel: event.target.value })}
                placeholder="gpt-5.5"
                value={generationDraft.mainModel}
              />
            </label>
            <label>
              API Key
              <input
                disabled={generationDraft.authSource === "codex_oauth"}
                onChange={(event) => setGenerationDraft({ ...generationDraft, apiKey: event.target.value })}
                placeholder={generationDraft.hasApiKey ? "已配置，留空则继续使用当前 Key" : "sk-..."}
                type="password"
                value={generationDraft.apiKey}
              />
            </label>
            {generationDraft.authSource === "api" && generationDraft.hasApiKey && !generationDraft.apiKey && (
              <p className="config-note">已有生图 API Key 保存在主进程配置中，页面不会回显明文。</p>
            )}
            <label>
              并发上限
              <input
                max={16}
                min={1}
                onChange={(event) =>
                  setGenerationDraft({ ...generationDraft, imagesConcurrency: Number(event.target.value) || 1 })
                }
                type="number"
                value={generationDraft.imagesConcurrency}
              />
            </label>
            <label className="checkbox-line">
              <input
                checked={generationDraft.saveApiKey}
                disabled={generationDraft.authSource === "codex_oauth"}
                onChange={(event) => setGenerationDraft({ ...generationDraft, saveApiKey: event.target.checked })}
                type="checkbox"
              />
              保存生图 API Key 到本机配置
            </label>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowGenerationConfig(false)} type="button">
                取消
              </button>
              <button className="primary-button" onClick={saveGenerationConfig} type="button">
                保存生图配置
              </button>
            </div>
          </section>
        </div>
      )}

      {showConfig && (
        <div className="modal-backdrop" onMouseDown={() => setShowConfig(false)}>
          <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title">
              <h2>模型配置</h2>
              <p>使用 OpenAI-compatible Vision API；Base URL 可填官方或第三方兼容地址。</p>
            </div>
            <label>
              API Base URL
              <input
                onChange={(event) => setDraftConfig({ ...draftConfig, apiBaseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
                value={draftConfig.apiBaseUrl}
              />
            </label>
            {usesInsecureBaseUrl && (
              <p className="config-warning">当前 Base URL 使用 http://，API Key 和图片内容会以明文链路传输。</p>
            )}
            <label>
              Model Name
              <input
                onChange={(event) => setDraftConfig({ ...draftConfig, modelName: event.target.value })}
                placeholder="gpt-4o-mini"
                value={draftConfig.modelName}
              />
            </label>
            <label>
              API Key
              <input
                onChange={(event) => setDraftConfig({ ...draftConfig, apiKey: event.target.value })}
                placeholder={draftConfig.hasApiKey ? "已配置，留空则继续使用当前 Key" : "sk-..."}
                type="password"
                value={draftConfig.apiKey}
              />
            </label>
            {draftConfig.hasApiKey && !draftConfig.apiKey && (
              <p className="config-note">已有 API Key 保存在主进程配置中，页面不会回显明文。</p>
            )}
            <label className="checkbox-line">
              <input
                checked={draftConfig.saveApiKey}
                onChange={(event) => setDraftConfig({ ...draftConfig, saveApiKey: event.target.checked })}
                type="checkbox"
              />
              保存 API Key 到本机配置
            </label>
            <div className="danger-zone">
              <strong>本机数据清理</strong>
              <p>这些操作只影响当前 Mac 的应用数据，不会删除项目源码或已导出的 JSON 文件。</p>
              <div className="danger-actions">
                <button className="danger-button" onClick={clearModelConfig} type="button">
                  <Trash2 size={17} />
                  抹除模型配置
                </button>
                <button className="danger-button" onClick={clearHistory} type="button">
                  <Trash2 size={17} />
                  清空图片历史
                </button>
                <button className="danger-button strong" onClick={clearAllLocalData} type="button">
                  <Trash2 size={17} />
                  抹除全部本机数据
                </button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowConfig(false)} type="button">
                取消
              </button>
              <button className="primary-button" onClick={saveConfig} type="button">
                保存配置
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function GenerationWorkspace({
  backendActionLabel,
  backendReady,
  collapsedTaskIds,
  copiedKey,
  error,
  isGenerating,
  onCancelTask,
  onClearTasks,
  onCopyText,
  onCreateTask,
  onDeleteTask,
  onDownloadOutput,
  onDownloadTaskOutputs,
  onComposeReferences,
  onAddOutputAsReference,
  onSendOutputToEdit,
  onEditReference,
  onImportPrompt,
  onOpenCompare,
  onOpenOutputPreview,
  onOpenConfig,
  onPickReference,
  onReferenceDrop,
  onRemoveReference,
  onRestoreTask,
  onRetryTask,
  onToggleTaskCollapsed,
  onUpdateTaskVisibility,
  options,
  prompt,
  promptSource,
  referenceImages,
  restoreOnTaskClick,
  selectedTaskId,
  setRestoreOnTaskClick,
  setPrompt,
  setSettings,
  settings,
  tasks
}: {
  backendActionLabel: string;
  backendReady: boolean;
  collapsedTaskIds: string[];
  copiedKey: string;
  error: string;
  isGenerating: boolean;
  onCancelTask: (id: string) => void;
  onClearTasks: () => void;
  onCopyText: (key: string, text: string) => void;
  onCreateTask: () => void;
  onDeleteTask: (id: string) => void;
  onDownloadOutput: (task: GenerationTask, outputs: GenerationOutput[]) => void;
  onDownloadTaskOutputs: (task: GenerationTask) => void;
  onComposeReferences: () => void;
  onAddOutputAsReference: (output: GenerationOutput) => void;
  onSendOutputToEdit: (task: GenerationTask, output: GenerationOutput, index: number) => void;
  onEditReference: (id: string) => void;
  onImportPrompt: (option: GenerationPromptOption) => void;
  onOpenCompare: (task: GenerationTask, output: GenerationOutput) => void;
  onOpenOutputPreview: (task: GenerationTask, output: GenerationOutput, index: number) => void;
  onOpenConfig: () => void;
  onPickReference: () => void;
  onReferenceDrop: (event: DragEvent<HTMLDivElement>) => void;
  onRemoveReference: (id: string) => void;
  onRestoreTask: (task: GenerationTask) => void;
  onRetryTask: (task: GenerationTask) => void;
  onToggleTaskCollapsed: (taskId: string) => void;
  onUpdateTaskVisibility: (id: string, visibility: GenerationTaskVisibility) => void;
  options: GenerationPromptOption[];
  prompt: string;
  promptSource: GenerationPromptSource | null;
  referenceImages: GenerationReferenceImage[];
  restoreOnTaskClick: boolean;
  selectedTaskId: string;
  setRestoreOnTaskClick: (value: boolean) => void;
  setPrompt: (value: string) => void;
  setSettings: Dispatch<SetStateAction<GenerationRequestSettings>>;
  settings: GenerationRequestSettings;
  tasks: GenerationTask[];
}): JSX.Element {
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<GenerationTaskStatusFilter>("all");
  const [visibilityFilter, setVisibilityFilter] = useState<GenerationTaskVisibilityFilter>("active");
  const [timeFilter, setTimeFilter] = useState<GenerationTaskTimeFilter>("all");
  const filteredTasks = useMemo(() => {
    const query = taskSearchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (visibilityFilter !== "all" && generationTaskVisibility(task) !== visibilityFilter) return false;
      if (!isGenerationTaskInTimeRange(task, timeFilter)) return false;
      if (!query) return true;
      const searchableText = [
        task.prompt,
        task.finalPrompt,
        task.promptSource.label,
        task.promptSource.sourceFileName,
        task.promptSource.historyItemId,
        formatGenerationTaskStatus(task.status),
        formatGenerationTaskVisibility(generationTaskVisibility(task))
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return searchableText.includes(query);
    });
  }, [statusFilter, taskSearchQuery, tasks, timeFilter, visibilityFilter]);
  const latestTask = filteredTasks[0];

  return (
    <section className="generation-workspace">
      <section className="generation-controls">
        <div className="generation-header">
          <div>
            <h2>生图工作台</h2>
            <p>从左侧提取结果导入提示词副本，在这里完成出图、任务回看和原图对比。</p>
          </div>
          <button className="secondary-button" onClick={onOpenConfig} type="button">
            <Settings size={17} />
            {backendActionLabel}
          </button>
        </div>

        <div className="import-row">
          {options.length === 0 ? (
            <p className="empty-text">先在“提示词提取”页完成分析或融合，导入来源会显示在这里。</p>
          ) : (
            options.map((option) => (
              <button
                className={promptSource?.kind === option.kind ? "prompt-import-button active" : "prompt-import-button"}
                key={option.kind}
                onClick={() => onImportPrompt(option)}
                type="button"
              >
                {option.label}
              </button>
            ))
          )}
        </div>

        {promptSource && (
          <div className="generation-source-strip">
            {promptSource.sourceThumbnailDataUrl && <img alt="" src={promptSource.sourceThumbnailDataUrl} />}
            <span>
              <strong>{promptSource.label}</strong>
              <small>{promptSource.sourceFileName || "来源图片"} · {new Date(promptSource.importedAt).toLocaleString("zh-CN")}</small>
            </span>
          </div>
        )}

        <label className="generation-prompt-field">
          <span>生图提示词</span>
          <textarea
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="从提示词提取页导入后可在这里编辑。编辑只影响生图工作台，不会写回原始分析结果。"
            value={prompt}
          />
        </label>

        <div className="generation-settings-grid">
          <label>
            提示词模式
            <select
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  promptMode:
                    event.target.value === "creative"
                      ? "creative"
                      : event.target.value === "original"
                        ? "original"
                        : "strict"
                }))
              }
              value={settings.promptMode}
            >
              <option value="original">原始</option>
              <option value="strict">保真</option>
              <option value="creative">创意</option>
            </select>
          </label>
          <label>
            分辨率
            <select
              onChange={(event) =>
                setSettings((current) => {
                  const resolution = event.target.value === "4k" ? "4k" : event.target.value === "2k" ? "2k" : "1k";
                  return {
                    ...current,
                    resolution,
                    size: resolveGenerationSize(resolution, current.aspectRatio)
                  };
                })
              }
              value={settings.resolution}
            >
              {generationResolutionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} · {option.description}
                </option>
              ))}
            </select>
          </label>
          <label>
            比例
            <select
              onChange={(event) =>
                setSettings((current) => {
                  const aspectRatio =
                    generationAspectRatioOptions.find((option) => option.value === event.target.value)?.value || "1:1";
                  return {
                    ...current,
                    aspectRatio,
                    size: resolveGenerationSize(current.resolution, aspectRatio)
                  };
                })
              }
              value={settings.aspectRatio}
            >
              {generationAspectRatioOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>{settings.size}</small>
          </label>
          <label>
            质量
            <select
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  quality:
                    event.target.value === "high"
                      ? "high"
                      : event.target.value === "medium"
                        ? "medium"
                        : event.target.value === "low"
                          ? "low"
                          : "auto"
                }))
              }
              value={settings.quality}
            >
              <option value="auto">自动</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
          <label>
            数量
            <input
              max={4}
              min={1}
              onChange={(event) =>
                setSettings((current) => ({ ...current, n: Math.min(Math.max(Number(event.target.value) || 1, 1), 4) }))
              }
              type="number"
              value={settings.n}
            />
          </label>
          <label>
            输出格式
            <select
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  outputFormat:
                    event.target.value === "jpeg" ? "jpeg" : event.target.value === "webp" ? "webp" : "png"
                }))
              }
              value={settings.outputFormat}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          <label>
            压缩
            <input
              disabled={settings.outputFormat === "png"}
              max={100}
              min={1}
              onChange={(event) =>
                setSettings((current) => ({ ...current, outputCompression: Number(event.target.value) || 80 }))
              }
              type="number"
              value={settings.outputCompression ?? 80}
            />
          </label>
          <label>
            背景
            <select
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  background:
                    event.target.value === "transparent"
                      ? "transparent"
                      : event.target.value === "opaque"
                        ? "opaque"
                        : "auto"
                }))
              }
              value={settings.background}
            >
              <option value="auto">自动</option>
              <option value="opaque">不透明</option>
              <option value="transparent">透明</option>
            </select>
          </label>
          <label>
            审核强度
            <select
              onChange={(event) =>
                setSettings((current) => ({ ...current, moderation: event.target.value === "low" ? "low" : "auto" }))
              }
              value={settings.moderation}
            >
              <option value="auto">自动</option>
              <option value="low">低</option>
            </select>
          </label>
        </div>

        <div
          className="generation-reference-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onReferenceDrop}
        >
          <div>
            <strong>参考图</strong>
            <span>{referenceImages.length ? `${referenceImages.length} 张，将走图像编辑/参考图生成` : "可选；不上传则走文生图"}</span>
          </div>
          <div className="generation-reference-actions">
            <button className="secondary-button" disabled={referenceImages.length < 2} onClick={onComposeReferences} type="button">
              <ImagePlus size={17} />
              合成参考图
            </button>
            <button className="secondary-button" onClick={onPickReference} type="button">
              <Upload size={17} />
              添加参考图
            </button>
          </div>
        </div>

        {referenceImages.length > 0 && (
          <div className="generation-reference-strip">
            {referenceImages.map((reference) => (
              <div className="generation-reference-item" key={reference.id}>
                <img alt="" src={reference.thumbnailDataUrl} />
                <span>{reference.name}</span>
                <button
                  className="history-delete-button"
                  onClick={() => onEditReference(reference.id)}
                  title="编辑参考图"
                  type="button"
                >
                  <Settings size={15} />
                </button>
                <button
                  className="history-delete-button"
                  onClick={() => onRemoveReference(reference.id)}
                  title="移除参考图"
                  type="button"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="inline-error">
            <AlertCircle size={17} />
            <span>{error}</span>
          </div>
        )}

        <div className="button-row">
          <button
            className="primary-button"
            disabled={isGenerating || !prompt.trim()}
            onClick={onCreateTask}
            title={backendReady ? "开始生图" : "点击后会重新检查生图后端配置"}
            type="button"
          >
            {isGenerating ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            开始生图
          </button>
          <button className="secondary-button" disabled={!prompt} onClick={() => onCopyText("generationPrompt", prompt)} type="button">
            <Copy size={17} />
            {copiedKey === "generationPrompt" ? "已复制" : "复制当前提示词"}
          </button>
        </div>
      </section>

      <section className="generation-results">
        <div className="generation-results-header">
          <div>
            <h2>生图任务</h2>
            <p>任务和图片保存在独立生成域，不会写入图片分析历史。</p>
          </div>
          {tasks.length > 0 && (
            <div className="generation-results-actions">
              <label className="switch generation-restore-switch">
                <input
                  checked={restoreOnTaskClick}
                  onChange={(event) => setRestoreOnTaskClick(event.target.checked)}
                  type="checkbox"
                />
                <span aria-hidden="true" />
                <small>点击任务恢复</small>
              </label>
              <button className="mini-danger-button" onClick={onClearTasks} type="button">
                <Trash2 size={16} />
                清空生图任务
              </button>
            </div>
          )}
        </div>

        {tasks.length > 0 && (
          <div className="generation-history-tools">
            <label className="generation-history-search">
              <span>搜索</span>
              <input
                onChange={(event) => setTaskSearchQuery(event.target.value)}
                placeholder="提示词、来源、文件名"
                value={taskSearchQuery}
              />
            </label>
            <label>
              状态
              <select
                onChange={(event) => setStatusFilter(event.target.value as GenerationTaskStatusFilter)}
                value={statusFilter}
              >
                {generationTaskStatusFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              范围
              <select
                onChange={(event) => setVisibilityFilter(event.target.value as GenerationTaskVisibilityFilter)}
                value={visibilityFilter}
              >
                {generationTaskVisibilityFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              时间
              <select
                onChange={(event) => setTimeFilter(event.target.value as GenerationTaskTimeFilter)}
                value={timeFilter}
              >
                {generationTaskTimeFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <small>
              {filteredTasks.length}/{tasks.length} 条
            </small>
          </div>
        )}

        {!latestTask ? (
          <p className="empty-generation-state">
            {tasks.length ? "没有匹配的生图任务。调整搜索、状态、范围或时间后再查看。" : "暂无生成任务。导入提示词并点击开始生图后，输出会显示在这里。"}
          </p>
        ) : (
          <div className="generation-task-list">
            {filteredTasks.map((task) => {
              const isTaskCollapsed = collapsedTaskIds.includes(task.id);
              const visibility = generationTaskVisibility(task);
              const isTaskActive = task.status === "queued" || task.status === "running";
              const hasGeneratedOutputs = task.outputs.length > 0;
              const canRestoreTask = hasGeneratedOutputs;
              return (
                <article
                  className={[
                    "generation-task",
                    selectedTaskId === task.id ? "active" : "",
                    restoreOnTaskClick && canRestoreTask ? "restore-enabled" : "",
                    isTaskCollapsed ? "collapsed" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={task.id}
                  onClick={restoreOnTaskClick && canRestoreTask ? () => onRestoreTask(task) : undefined}
                  onKeyDown={(event) => {
                    if (restoreOnTaskClick && canRestoreTask && (event.key === "Enter" || event.key === " ")) {
                      onRestoreTask(task);
                    }
                  }}
                  role={restoreOnTaskClick && canRestoreTask ? "button" : undefined}
                  tabIndex={restoreOnTaskClick && canRestoreTask ? 0 : undefined}
                  title={restoreOnTaskClick && canRestoreTask ? "点击恢复这条生图历史" : undefined}
                >
                <div className="generation-task-header">
                  <div>
                    <strong>{task.promptSource.label}</strong>
                    <small>{new Date(task.createdAt).toLocaleString("zh-CN")}</small>
                  </div>
                  <div className="generation-task-header-actions">
                    <button
                      className="secondary-button generation-card-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleTaskCollapsed(task.id);
                      }}
                      type="button"
                    >
                      {isTaskCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                      {isTaskCollapsed ? "展开卡片" : "收起卡片"}
                    </button>
                    <button
                      className="history-delete-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteTask(task.id);
                      }}
                      title="删除任务"
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {!isTaskCollapsed && (
                  <>
                    <div className="generation-task-actions">
                      <div className={`generation-task-status generation-task-status-${task.status}`}>
                        <strong>{formatGenerationTaskStatus(task.status)}</strong>
                        <span>{formatGenerationTaskVisibility(visibility)}</span>
                      </div>
                      {isTaskActive && (
                        <button
                          className="secondary-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onCancelTask(task.id);
                          }}
                          type="button"
                        >
                          <X size={16} />
                          取消
                        </button>
                      )}
                      {hasGeneratedOutputs && (
                        <>
                          <button
                            className="secondary-button"
                            disabled={isGenerating}
                            onClick={(event) => {
                              event.stopPropagation();
                              onRetryTask(task);
                            }}
                            type="button"
                          >
                            <RotateCcw size={16} />
                            重试
                          </button>
                          <button
                            className="secondary-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onRestoreTask(task);
                            }}
                            type="button"
                          >
                            <History size={16} />
                            恢复任务
                          </button>
                        </>
                      )}
                      {visibility === "active" && !isTaskActive && (
                        <>
                          <button
                            className="secondary-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onUpdateTaskVisibility(task.id, "archived");
                            }}
                            type="button"
                          >
                            <History size={16} />
                            归档
                          </button>
                          <button
                            className="secondary-button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onUpdateTaskVisibility(task.id, "hidden");
                            }}
                            type="button"
                          >
                            <X size={16} />
                            隐藏
                          </button>
                        </>
                      )}
                      {visibility !== "active" && (
                        <button
                          className="secondary-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onUpdateTaskVisibility(task.id, "active");
                          }}
                          type="button"
                        >
                          <Check size={16} />
                          恢复显示
                        </button>
                      )}
                      <button
                        className="secondary-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onCopyText(`${task.id}-prompt`, task.finalPrompt);
                        }}
                        type="button"
                      >
                        <Copy size={16} />
                        {copiedKey === `${task.id}-prompt` ? "已复制" : "复制任务提示词"}
                      </button>
                      {task.outputs.length > 1 && (
                        <button
                          className="secondary-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDownloadTaskOutputs(task);
                          }}
                          type="button"
                        >
                          <Download size={16} />
                          批量下载
                        </button>
                      )}
                    </div>
                    <div className="generation-task-size-summary">
                      <span>请求尺寸：{task.settings.size}</span>
                      {task.outputs.length > 0 && <span>实际尺寸：{formatGenerationTaskActualSizes(task.outputs)}</span>}
                      {formatGenerationBackend(task) && <span>后端：{formatGenerationBackend(task)}</span>}
                    </div>
                    {task.error && (
                      <p className="generation-task-error">
                        <AlertCircle size={15} />
                        {task.error}
                      </p>
                    )}
                    <p className="generation-task-prompt">{task.finalPrompt}</p>
                    {task.outputs.length > 0 && (
                      <div className="generation-output-grid">
                        {task.outputs.map((output, index) => (
                          <figure className="generation-output" key={output.id}>
                            <button
                              className="generation-output-preview"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenOutputPreview(task, output, index);
                              }}
                              title="查看生成图大图"
                              type="button"
                            >
                              <img alt={`生成结果 ${index + 1}`} src={output.dataUrl} />
                              <span className="preview-corner-icon" aria-hidden="true">
                                <Maximize2 size={18} />
                              </span>
                            </button>
                            <div className={output.error ? "generation-output-meta has-error" : "generation-output-meta"}>
                              <span>请求 {output.requestedSize || task.settings.size}</span>
                              <span>实际 {formatGenerationOutputActualSize(output)}</span>
                            </div>
                            {output.error && <p className="generation-output-error">{output.error}</p>}
                            <figcaption>
                              <button
                                className="secondary-button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenCompare(task, output);
                                }}
                                type="button"
                              >
                                <Maximize2 size={16} />
                                左右对比
                              </button>
                              <button
                                className="secondary-button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onCopyText(output.id, output.revisedPrompt || task.finalPrompt);
                                }}
                                type="button"
                              >
                                <Copy size={16} />
                                {copiedKey === output.id ? "已复制" : "复制提示词"}
                              </button>
                              <button
                                className="secondary-button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onDownloadOutput(task, [output]);
                                }}
                                type="button"
                              >
                                <Download size={16} />
                                下载
                              </button>
                              <button
                                className="secondary-button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onAddOutputAsReference(output);
                                }}
                                type="button"
                              >
                                <ImagePlus size={16} />
                                作参考图
                              </button>
                              <button
                                className="secondary-button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onSendOutputToEdit(task, output, index);
                                }}
                                type="button"
                              >
                                <PenLine size={16} />
                                去改图
                              </button>
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

function ImageEditWorkspace({
  annotations,
  backendActionLabel,
  backendReady,
  collapsedTaskIds,
  error,
  fidelityMode,
  instruction,
  isCreating,
  isDragging,
  isRenderingLocalMask,
  localMaskPreview,
  maskCapability,
  onCancelTask,
  onClearAnnotations,
  onClearTasks,
  onCreateTask,
  onDeleteTask,
  onDownloadOutput,
  onContinueFromOutput,
  onOpenCompare,
  onOpenConfig,
  onOpenOutputPreview,
  onPickSource,
  onRetryTask,
  onSetOutputVariantView,
  onToggleTaskCollapsed,
  onSetFidelityMode,
  onSetAnnotations,
  onSetInstruction,
  onSetPixelProtectionEnabled,
  onSetSettings,
  onSourceDragLeave,
  onSourceDragOver,
  onSourceDrop,
  onUpdateTaskVisibility,
  selectedTaskId,
  settings,
  source,
  outputVariantView,
  pixelProtectionEnabled,
  tasks
}: {
  annotations: ImageEditAnnotation[];
  backendActionLabel: string;
  backendReady: boolean;
  collapsedTaskIds: string[];
  error: string;
  fidelityMode: ImageEditFidelityMode;
  instruction: string;
  isCreating: boolean;
  isDragging: boolean;
  isRenderingLocalMask: boolean;
  localMaskPreview: RenderedImageEditMask | null;
  maskCapability: ImageEditMaskCapability;
  onCancelTask: (id: string) => void;
  onClearAnnotations: () => void;
  onClearTasks: () => void;
  onCreateTask: () => void;
  onDeleteTask: (id: string) => void;
  onDownloadOutput: (task: ImageEditTask, outputs: ImageEditOutput[]) => void;
  onContinueFromOutput: (task: ImageEditTask, output: ImageEditOutput, index: number) => void;
  onOpenCompare: (task: ImageEditTask, output: ImageEditOutput) => void;
  onOpenConfig: () => void;
  onOpenOutputPreview: (task: ImageEditTask, output: ImageEditOutput, index: number) => void;
  onPickSource: () => void;
  onRetryTask: (task: ImageEditTask) => void;
  onSetOutputVariantView: Dispatch<SetStateAction<Record<string, "raw" | "pixel_protected">>>;
  onToggleTaskCollapsed: (taskId: string) => void;
  onSetFidelityMode: (mode: ImageEditFidelityMode) => void;
  onSetAnnotations: Dispatch<SetStateAction<ImageEditAnnotation[]>>;
  onSetInstruction: (value: string) => void;
  onSetPixelProtectionEnabled: (value: boolean) => void;
  onSetSettings: Dispatch<SetStateAction<ImageEditRequestSettings>>;
  onSourceDragLeave: () => void;
  onSourceDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onSourceDrop: (event: DragEvent<HTMLDivElement>) => void;
  onUpdateTaskVisibility: (id: string, visibility: ImageEditTaskVisibility) => void;
  selectedTaskId: string;
  settings: ImageEditRequestSettings;
  source: ImageEditSourceImage | null;
  outputVariantView: Record<string, "raw" | "pixel_protected">;
  pixelProtectionEnabled: boolean;
  tasks: ImageEditTask[];
}): JSX.Element {
  const [activeTool, setActiveTool] = useState<ImageEditTool>("brush");
  const [annotationColor, setAnnotationColor] = useState("#f04438");
  const [annotationText, setAnnotationText] = useState("");
  const [showHiddenTasks, setShowHiddenTasks] = useState(false);
  const hiddenTaskCount = useMemo(() => tasks.filter((task) => imageEditTaskVisibility(task) !== "active").length, [tasks]);
  const visibleTasks = useMemo(
    () => tasks.filter((task) => (showHiddenTasks ? imageEditTaskVisibility(task) !== "active" : imageEditTaskVisibility(task) === "active")),
    [showHiddenTasks, tasks]
  );
  const hasLocalEditNotes = annotations.some((annotation) => annotation.note?.trim());
  const strictMaskUnavailable = strictMaskUnavailableMessage(maskCapability);
  const sourceExactSize = source?.width && source.height ? `${source.width}x${source.height}` : "";
  const usesLocalProtectionRequestSize =
    fidelityMode === "reference" && pixelProtectionEnabled && annotations.length > 0 && Boolean(sourceExactSize);
  const effectiveRequestSize = usesLocalProtectionRequestSize ? sourceExactSize : settings.size;
  const canCreateTask = Boolean(
    source &&
      (instruction.trim() || hasLocalEditNotes) &&
      (fidelityMode !== "strict_mask" || (annotations.length > 0 && maskCapability.supportsMaskEdit))
  );
  const localMaskPercent = Math.round((localMaskPreview?.stats.transparentRatio || 0) * 1000) / 10;
  const outputViewFor = (output: ImageEditOutput): "raw" | "pixel_protected" =>
    outputVariantView[output.id] === "pixel_protected" && output.protectedVariant ? "pixel_protected" : "raw";
  const outputForCurrentView = (output: ImageEditOutput): ImageEditOutput => {
    if (outputViewFor(output) !== "pixel_protected" || !output.protectedVariant) return output;
    const variant = output.protectedVariant;
    return {
      ...output,
      dataUrl: variant.dataUrl,
      mimeType: variant.mimeType,
      actualWidth: variant.width || output.actualWidth,
      actualHeight: variant.height || output.actualHeight,
      actualSize: variant.width && variant.height ? `${variant.width}x${variant.height}` : output.actualSize,
      warnings: [...(output.warnings || []), ...(variant.warnings || [])]
    };
  };
  const updateAnnotationNote = (id: string, note: string) => {
    onSetAnnotations((current) =>
      current.map((annotation) => (annotation.id === id ? { ...annotation, note, text: annotation.tool === "text" ? note : annotation.text } : annotation))
    );
  };
  const deleteAnnotation = (id: string) => {
    onSetAnnotations((current) => current.filter((annotation) => annotation.id !== id));
  };

  return (
    <section className="generation-workspace image-edit-workspace">
      <section className="generation-controls image-edit-controls">
        <div className="generation-header">
          <div>
            <h2>改图工作台</h2>
            <p>导入单张源图，用标注和文字说明生成干净修订图。</p>
          </div>
          <button className="secondary-button" onClick={onOpenConfig} type="button">
            <Settings size={17} />
            {backendActionLabel}
          </button>
        </div>

        <div
          className={`image-edit-source-zone ${isDragging ? "dragging" : ""}`}
          onDragLeave={onSourceDragLeave}
          onDragOver={onSourceDragOver}
          onDrop={onSourceDrop}
        >
          {source ? (
            <div className="image-edit-source-strip">
              <img alt="" src={source.thumbnailDataUrl || source.dataUrl} />
              <span>
                <strong>{source.name}</strong>
                <small>
                  {sourceExactSize || "源图尺寸待识别"} · 请求 {effectiveRequestSize}
                </small>
              </span>
              <button className="secondary-button" onClick={onPickSource} type="button">
                <Upload size={17} />
                更换源图
              </button>
            </div>
          ) : (
            <button className="image-edit-empty-source" onClick={onPickSource} type="button">
              <ImagePlus size={42} />
              <strong>导入改图源图</strong>
              <span>支持选择、拖拽、Cmd + V</span>
            </button>
          )}
        </div>

        {source ? (
          <ImageEditAnnotationBoard
            activeTool={activeTool}
            annotationColor={annotationColor}
            annotations={annotations}
            annotationText={annotationText}
            onSetAnnotations={onSetAnnotations}
            source={source}
          />
        ) : (
          <p className="empty-generation-state image-edit-empty-state">导入源图后可以使用画笔、箭头、框选和文字批注。</p>
        )}

        <div className="image-edit-toolbar">
          <div className="fusion-mode-tabs image-edit-tool-tabs" aria-label="改图标注工具">
            {imageEditToolOptions.map((tool) => (
              <button
                className={activeTool === tool.value ? "active" : ""}
                key={tool.value}
                onClick={() => setActiveTool(tool.value)}
                type="button"
              >
                {tool.icon}
                {tool.label}
              </button>
            ))}
          </div>
          <label className="image-edit-color">
            <span>颜色</span>
            <input
              aria-label="标注颜色"
              onChange={(event) => setAnnotationColor(event.target.value)}
              type="color"
              value={annotationColor}
            />
          </label>
          <label className="image-edit-text-input">
            <span>当前标注要求</span>
            <input
              onChange={(event) => setAnnotationText(event.target.value)}
              placeholder="先写这一处怎么改，再点击或拖拽"
              value={annotationText}
            />
          </label>
          <button className="secondary-button" disabled={!annotations.length} onClick={() => onSetAnnotations((current) => current.slice(0, -1))} type="button">
            <Undo2 size={17} />
            撤销
          </button>
          <button className="secondary-button" disabled={!annotations.length} onClick={onClearAnnotations} type="button">
            <Trash2 size={17} />
            清空标注
          </button>
        </div>

        {annotations.length > 0 && (
          <section className="image-edit-annotation-list">
            <div className="image-edit-annotation-list-header">
              <strong>多处修改要求</strong>
              <small>标注截图和模型提示词会按编号一一对应。</small>
            </div>
            {annotations.map((annotation, index) => (
              <div className="image-edit-annotation-item" key={annotation.id}>
                <span>
                  标注 {index + 1} · {imageEditToolLabelMap[annotation.tool]}
                </span>
                <input
                  onChange={(event) => updateAnnotationNote(annotation.id, event.target.value)}
                  placeholder="写清这一处要怎么改"
                  value={annotation.note || ""}
                />
                <button
                  aria-label={`删除标注 ${index + 1}`}
                  className="mini-danger-button"
                  onClick={() => deleteAnnotation(annotation.id)}
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </section>
        )}

        <section className="image-edit-fidelity-panel">
          <div className="image-edit-annotation-list-header">
            <strong>改图模式</strong>
            <small>旁路参考适合多候选筛选；严格保真只适合支持 mask 的 Images 后端。</small>
          </div>
          <div className="fusion-mode-tabs image-edit-fidelity-tabs" aria-label="改图模式">
            <button
              className={fidelityMode === "reference" ? "active" : ""}
              onClick={() => onSetFidelityMode("reference")}
              type="button"
            >
              旁路参考生成
            </button>
            <button
              className={fidelityMode === "strict_mask" ? "active" : ""}
              disabled={!maskCapability.supportsMaskEdit}
              onClick={() => onSetFidelityMode("strict_mask")}
              title={maskCapability.supportsMaskEdit ? "严格保真模式" : strictMaskUnavailable}
              type="button"
            >
              严格保真模式
            </button>
          </div>
          <p className={fidelityMode === "strict_mask" ? "image-edit-fidelity-note strict" : "image-edit-fidelity-note"}>
            {fidelityMode === "strict_mask"
              ? "严格模式会提交 PNG 源图 + 同尺寸 alpha mask + 编号清单；定位图仅保留为任务预览，不作为模型图像输入。"
              : "旁路参考会提交源图 + 低遮挡编号定位图，生成新的修订图并在任务卡中并排展示；OpenRouter /images 属于参考生图，不承诺严格源图保真。"}
          </p>
          {!maskCapability.supportsMaskEdit && (
            <p className="image-edit-fidelity-warning">
              <AlertCircle size={15} />
              <span>{strictMaskUnavailable}</span>
            </p>
          )}
          {fidelityMode === "strict_mask" && !annotations.length && (
            <p className="image-edit-fidelity-warning">
              <AlertCircle size={15} />
              <span>严格保真模式至少需要 1 个编号标注，用于生成 alpha mask。</span>
            </p>
          )}
          {fidelityMode === "reference" && (
            <section className="image-edit-local-mask-panel">
              <div className="image-edit-local-mask-header">
                <div>
                  <strong>本地保护范围预览</strong>
                  <small>这张保护图和源图同尺寸；透明小区域允许修改，其余区域用于本地保留。OpenRouter 不接收这张保护图。</small>
                </div>
                <label className="image-edit-pixel-toggle">
                  <input
                    checked={pixelProtectionEnabled}
                    onChange={(event) => onSetPixelProtectionEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  生成本地保护版
                </label>
              </div>
              <p className="image-edit-fidelity-warning strong">
                <AlertCircle size={15} />
                <span>
                  添加标注后，本地保护会按源图尺寸请求输出；如果后端仍返回不同尺寸，就只显示 AI 原始结果。
                </span>
              </p>
              {isRenderingLocalMask ? (
                <p className="image-edit-mask-empty">正在生成本地保护范围预览...</p>
              ) : localMaskPreview ? (
                <div className="image-edit-mask-preview">
                  <img alt="本地保护范围预览" src={localMaskPreview.dataUrl} />
                  <div>
                    <span>编辑区域占比：{localMaskPercent}%</span>
                    <span>保护图尺寸：{localMaskPreview.stats.width || "-"}x{localMaskPreview.stats.height || "-"}</span>
                    {localMaskPreview.stats.bbox && <span>编辑范围：{localMaskPreview.stats.bbox}</span>}
                    {localMaskPreview.stats.warnings?.map((warning) => (
                      <em key={warning}>{warning}</em>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="image-edit-mask-empty">添加标注后会显示本地保护范围。</p>
              )}
            </section>
          )}
        </section>

        <label className="generation-prompt-field image-edit-instruction">
          <span>改图说明</span>
          <textarea
            onChange={(event) => onSetInstruction(event.target.value)}
            placeholder="可写整体要求；每处局部修改建议填写在上方对应编号里。最终输出会保留源图主体、构图、风格和比例，并移除所有标注痕迹。"
            value={instruction}
          />
        </label>

        <div className="generation-settings-grid">
          <label>
            分辨率
            <select
              onChange={(event) =>
                onSetSettings((current) => {
                  const resolution = event.target.value === "4k" ? "4k" : event.target.value === "2k" ? "2k" : "1k";
                  return {
                    ...current,
                    resolution,
                    size: resolveGenerationSize(resolution, current.aspectRatio)
                  };
                })
              }
              value={settings.resolution}
            >
              {generationResolutionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} · {option.description}
                </option>
              ))}
            </select>
          </label>
          <label>
            比例
            <select
              onChange={(event) =>
                onSetSettings((current) => {
                  const aspectRatio =
                    generationAspectRatioOptions.find((option) => option.value === event.target.value)?.value || "1:1";
                  return {
                    ...current,
                    aspectRatio,
                    size: resolveGenerationSize(current.resolution, aspectRatio)
                  };
                })
              }
              value={settings.aspectRatio}
            >
              {generationAspectRatioOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>{settings.size}</small>
          </label>
          <label>
            质量
            <select
              onChange={(event) =>
                onSetSettings((current) => ({
                  ...current,
                  quality:
                    event.target.value === "high"
                      ? "high"
                      : event.target.value === "medium"
                        ? "medium"
                        : event.target.value === "low"
                          ? "low"
                          : "auto"
                }))
              }
              value={settings.quality}
            >
              <option value="auto">自动</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
          <label>
            输出格式
            <select
              onChange={(event) =>
                onSetSettings((current) => {
                  const outputFormat =
                    event.target.value === "jpeg" ? "jpeg" : event.target.value === "webp" ? "webp" : "png";
                  return {
                    ...current,
                    outputFormat,
                    outputCompression: outputFormat === "png" ? undefined : current.outputCompression ?? 80
                  };
                })
              }
              value={settings.outputFormat}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </label>
          <label>
            压缩
            <input
              disabled={settings.outputFormat === "png"}
              max={100}
              min={1}
              onChange={(event) =>
                onSetSettings((current) => ({ ...current, outputCompression: Number(event.target.value) || 80 }))
              }
              type="number"
              value={settings.outputCompression ?? 80}
            />
            <small>{settings.outputFormat === "png" ? "PNG 不发送压缩参数" : "1-100"}</small>
          </label>
          <label>
            候选图数量
            <input
              max={4}
              min={1}
              onChange={(event) =>
                onSetSettings((current) => ({ ...current, n: Math.min(Math.max(Number(event.target.value) || 1, 1), 4) }))
              }
              type="number"
              value={settings.n}
            />
            <small>1-4 张旁路输出</small>
          </label>
        </div>
        <p className="image-edit-settings-note">
          {usesLocalProtectionRequestSize
            ? `本地保护开启时会按源图尺寸请求：${sourceExactSize}；如果后端返回其他尺寸，只显示 AI 原始结果。`
            : "候选图会作为新的修订图并排保留，便于筛选和继续改图；质量参数会随请求提交，不同供应商可能忽略、降级或拒绝不支持的质量/格式参数。"}
        </p>

        {error && (
          <div className="inline-error">
            <AlertCircle size={17} />
            <span>{error}</span>
          </div>
        )}

        <div className="button-row">
          <button
            className="primary-button"
            disabled={isCreating || !canCreateTask}
            onClick={onCreateTask}
            title={backendReady ? "开始改图" : "点击后会重新检查生图后端配置"}
            type="button"
          >
            {isCreating ? <Loader2 className="spin" size={18} /> : <PenLine size={18} />}
            开始改图
          </button>
        </div>
      </section>

      <section className="generation-results">
        <div className="generation-results-header">
          <div>
            <h2>改图任务</h2>
            <p>改图任务保存在独立数据域，不会写入图片分析历史或生图历史。</p>
          </div>
          {tasks.length > 0 && (
            <div className="generation-results-actions">
              {(hiddenTaskCount > 0 || showHiddenTasks) && (
                <button className="secondary-button" onClick={() => setShowHiddenTasks((current) => !current)} type="button">
                  {showHiddenTasks ? <Check size={16} /> : <X size={16} />}
                  {showHiddenTasks ? "显示中的任务" : `隐藏任务 ${hiddenTaskCount}`}
                </button>
              )}
              <button className="mini-danger-button" onClick={onClearTasks} type="button">
                <Trash2 size={16} />
                清空改图任务
              </button>
            </div>
          )}
        </div>

        {!visibleTasks.length ? (
          <p className="empty-generation-state">
            {!tasks.length
              ? "暂无改图任务。导入源图并完成标注后，任务会显示在这里。"
              : showHiddenTasks
                ? "没有隐藏的改图任务。"
                : "没有显示中的改图任务。隐藏任务可从右上角查看。"}
          </p>
        ) : (
          <div className="generation-task-list">
            {visibleTasks.map((task) => {
              const isTaskActive = task.status === "queued" || task.status === "running";
              const visibility = imageEditTaskVisibility(task);
              const isTaskCollapsed = collapsedTaskIds.includes(task.id);
              return (
                <article
                  className={[
                    "generation-task",
                    selectedTaskId === task.id ? "active" : "",
                    isTaskCollapsed ? "collapsed" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={task.id}
                >
                  <div className="generation-task-header">
                    <div>
                      <strong>{task.sourceImage.name}</strong>
                      <small>{new Date(task.createdAt).toLocaleString("zh-CN")}</small>
                    </div>
                    <div className="generation-task-header-actions">
                      <button
                        className="secondary-button generation-card-toggle"
                        onClick={() => onToggleTaskCollapsed(task.id)}
                        type="button"
                      >
                        {isTaskCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                        {isTaskCollapsed ? "展开卡片" : "收起卡片"}
                      </button>
                      <button className="history-delete-button" onClick={() => onDeleteTask(task.id)} title="删除任务" type="button">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {!isTaskCollapsed && (
                    <>
                      <div className="generation-task-actions">
                        <div className={`generation-task-status generation-task-status-${task.status}`}>
                          <strong>{formatGenerationTaskStatus(task.status)}</strong>
                          <span>{formatGenerationTaskVisibility(visibility)}</span>
                        </div>
                        {isTaskActive && (
                          <button className="secondary-button" onClick={() => onCancelTask(task.id)} type="button">
                            <X size={16} />
                            取消
                          </button>
                        )}
                        {!isTaskActive && (
                          <button className="secondary-button" onClick={() => onRetryTask(task)} type="button">
                            <RotateCcw size={16} />
                            重试
                          </button>
                        )}
                        {visibility === "active" && !isTaskActive ? (
                          <button className="secondary-button" onClick={() => onUpdateTaskVisibility(task.id, "hidden")} type="button">
                            <X size={16} />
                            隐藏
                          </button>
                        ) : visibility !== "active" ? (
                          <button className="secondary-button" onClick={() => onUpdateTaskVisibility(task.id, "active")} type="button">
                            <Check size={16} />
                            恢复显示
                          </button>
                        ) : null}
                        {task.outputs.length > 1 && (
                          <button className="secondary-button" onClick={() => onDownloadOutput(task, task.outputs)} type="button">
                            <Download size={16} />
                            下载全部
                          </button>
                        )}
                      </div>
                      <div className="generation-task-size-summary">
                        <span>目标尺寸：{task.settings.size}</span>
                        <span>{(task.fidelityMode || "reference") === "strict_mask" ? "严格 mask 保真" : "参考生成"}</span>
                        <span>
                          候选图：{task.outputs.length ? `${task.outputs.length}/${task.settings.n}` : `${task.settings.n} 张`}
                        </span>
                        {task.backend?.supportsMaskEdit === false && task.backend.maskEditUnavailableReason && (
                          <span>{task.backend.maskEditUnavailableReason}</span>
                        )}
                        {task.backend?.providerType === "openrouter" && <span>{task.backend.fidelityNote}</span>}
                        {task.diagnostics && (
                          <span>
                            {task.diagnostics.strictMaskSubmitted ? "精确遮罩已提交" : "保护图仅本地使用"}
                          </span>
                        )}
                        {task.diagnostics?.localMask && (
                          <span>
                            本地编辑区：
                            {Math.round((task.diagnostics.localMask.transparentRatio || 0) * 1000) / 10}%
                          </span>
                        )}
                      </div>
                      {task.error && (
                        <p className="generation-task-error">
                          <AlertCircle size={15} />
                          {task.error}
                        </p>
                      )}
                      <p className="generation-task-prompt">{task.finalPrompt}</p>
                      {task.outputs.length > 0 && (
	                        <div className="generation-output-grid">
	                          {task.outputs.map((output, index) => {
	                            const outputView = outputViewFor(output);
	                            const displayedOutput = outputForCurrentView(output);
	                            return (
	                              <figure className="generation-output" key={output.id}>
	                                <div className="image-edit-output-version-tabs" aria-label="改图输出版本">
	                                  <button
	                                    className={outputView === "raw" ? "active" : ""}
	                                    onClick={() =>
	                                      onSetOutputVariantView((current) => ({
	                                        ...current,
	                                        [output.id]: "raw"
	                                      }))
	                                    }
	                                    type="button"
	                                  >
	                                    AI 原始结果
	                                  </button>
	                                  <button
	                                    className={outputView === "pixel_protected" ? "active" : ""}
	                                    disabled={!output.protectedVariant}
	                                    onClick={() =>
	                                      onSetOutputVariantView((current) => ({
	                                        ...current,
	                                        [output.id]: "pixel_protected"
	                                      }))
	                                    }
	                                    type="button"
	                                  >
	                                    本地保护版
	                                  </button>
	                                </div>
	                                <button
	                                  className="generation-output-preview"
	                                  onClick={() => onOpenOutputPreview(task, displayedOutput, task.outputs.findIndex((item) => item.id === output.id))}
	                                  title="查看改图输出大图"
	                                  type="button"
	                                >
	                                  <img alt="改图输出" src={displayedOutput.dataUrl} />
	                                  <span className="preview-corner-icon" aria-hidden="true">
	                                    <Maximize2 size={18} />
	                                  </span>
	                                </button>
	                                <div className={output.error ? "generation-output-meta has-error" : "generation-output-meta"}>
	                                  <span>候选 {index + 1}/{task.outputs.length}</span>
	                                  <span>请求 {output.requestedSize || task.settings.size}</span>
	                                  <span>实际 {output.actualSize || "未识别"}</span>
	                                </div>
	                                {output.warnings?.map((warning) => (
	                                  <p className="generation-output-error" key={warning}>{warning}</p>
	                                ))}
	                                {outputView === "pixel_protected" && output.protectedVariant?.warnings?.map((warning) => (
	                                  <p className="generation-output-error" key={warning}>{warning}</p>
	                                ))}
	                                {!output.protectedVariant && (
	                                  <p className="generation-output-error">
	                                    {output.protectedVariantUnavailableReason ||
	                                      "本地保护版仅在 AI 输出与源图同尺寸时可用；当前仅保留 AI 原始结果。"}
	                                  </p>
	                                )}
	                                <figcaption>
	                                  <button className="secondary-button" onClick={() => onOpenCompare(task, displayedOutput)} type="button">
	                                    <Maximize2 size={16} />
	                                    左右对比
	                                  </button>
	                                  <button className="secondary-button" onClick={() => onDownloadOutput(task, [displayedOutput])} type="button">
	                                    <Download size={16} />
	                                    下载
	                                  </button>
	                                  <button
	                                    className="secondary-button"
	                                    onClick={() => onContinueFromOutput(task, displayedOutput, task.outputs.findIndex((item) => item.id === output.id))}
	                                    type="button"
	                                    title={
	                                      outputView === "pixel_protected"
	                                        ? "保护版再次继续改图可能累积边缘接缝或色调断层。"
	                                        : "推荐使用 AI 原始结果继续改图。"
	                                    }
	                                  >
	                                    <PenLine size={16} />
	                                    {outputView === "pixel_protected" ? "继续改图（可能有接缝）" : "继续改图"}
	                                  </button>
	                                </figcaption>
	                                {outputView === "pixel_protected" && (
	                                  <p className="image-edit-protected-note">保护版再次继续改图可能累积边缘接缝或色调断层。</p>
	                                )}
	                              </figure>
	                            );
	                          })}
                        </div>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

function ImageEditAnnotationBoard({
  activeTool,
  annotationColor,
  annotations,
  annotationText,
  onSetAnnotations,
  source
}: {
  activeTool: ImageEditTool;
  annotationColor: string;
  annotations: ImageEditAnnotation[];
  annotationText: string;
  onSetAnnotations: Dispatch<SetStateAction<ImageEditAnnotation[]>>;
  source: ImageEditSourceImage;
}): JSX.Element {
  const [draftAnnotationId, setDraftAnnotationId] = useState("");
  const stageRef = useRef<HTMLDivElement | null>(null);

  const pointFromEvent = (event: PointerEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
    };
  };

  const defaultEndPoint = (point: { x: number; y: number }, tool: ImageEditTool) => {
    const offsetX = tool === "box" ? 0.18 : 0.16;
    const offsetY = tool === "box" ? 0.14 : 0.1;
    return {
      x: Math.min(Math.max(point.x + (point.x > 0.78 ? -offsetX : offsetX), 0), 1),
      y: Math.min(Math.max(point.y + (point.y > 0.78 ? -offsetY : offsetY), 0), 1)
    };
  };

  const beginAnnotation = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    const id = crypto.randomUUID();
    const note = annotationText.trim();
    if (activeTool === "text") {
      const text = note || "修改这里";
      onSetAnnotations((current) => [...current, { id, tool: "text", color: annotationColor, note, text, start: point }]);
      return;
    }
    const end = activeTool === "brush" ? undefined : defaultEndPoint(point, activeTool);
    setDraftAnnotationId(id);
    onSetAnnotations((current) => [
      ...current,
      activeTool === "brush"
        ? { id, tool: activeTool, color: annotationColor, note, points: [point] }
        : { id, tool: activeTool, color: annotationColor, note, start: point, end }
    ]);
  };

  const continueAnnotation = (event: PointerEvent<HTMLDivElement>) => {
    if (!draftAnnotationId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    onSetAnnotations((current) =>
      current.map((annotation) => {
        if (annotation.id !== draftAnnotationId) return annotation;
        if (annotation.tool === "brush") {
          return { ...annotation, points: [...(annotation.points || []), point] };
        }
        return { ...annotation, end: point };
      })
    );
  };

  const endAnnotation = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraftAnnotationId("");
  };

  return (
    <div className="image-edit-board">
      <div
        className="image-edit-stage"
        onPointerDown={beginAnnotation}
        onPointerMove={continueAnnotation}
        onPointerUp={endAnnotation}
        onPointerCancel={endAnnotation}
        ref={stageRef}
      >
        <img alt="改图源图" draggable={false} src={source.dataUrl} />
        <svg aria-hidden="true" className="image-edit-annotation-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
          {annotations.map((annotation, annotationIndex) => {
            const anchor = imageEditAnnotationAnchor(annotation);
            const label = anchor ? (
              <g className="image-edit-annotation-label" key={`${annotation.id}-label`}>
                <circle cx={anchor.x} cy={anchor.y} r={0.026} />
                <text fontSize={0.028} x={anchor.x} y={anchor.y}>
                  {annotationIndex + 1}
                </text>
              </g>
            ) : null;
            if (annotation.tool === "brush" && annotation.points?.length) {
              if (annotation.points.length === 1) {
                const [point] = annotation.points;
                return (
                  <g key={annotation.id}>
                    <circle cx={point.x} cy={point.y} fill={annotation.color} r={0.012} />
                    {label}
                  </g>
                );
              }
              const path = annotation.points
                .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
                .join(" ");
              return (
                <g key={annotation.id}>
                  <path
                    d={path}
                    fill="none"
                    stroke={annotation.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={0.012}
                  />
                  {label}
                </g>
              );
            }
            if (annotation.tool === "arrow" && annotation.start && annotation.end) {
              const angle = Math.atan2(annotation.end.y - annotation.start.y, annotation.end.x - annotation.start.x);
              const headLength = 0.04;
              const leftX = annotation.end.x - headLength * Math.cos(angle - Math.PI / 6);
              const leftY = annotation.end.y - headLength * Math.sin(angle - Math.PI / 6);
              const rightX = annotation.end.x - headLength * Math.cos(angle + Math.PI / 6);
              const rightY = annotation.end.y - headLength * Math.sin(angle + Math.PI / 6);
              return (
                <g key={annotation.id}>
                  <line
                    stroke={annotation.color}
                    strokeLinecap="round"
                    strokeWidth={0.012}
                    x1={annotation.start.x}
                    x2={annotation.end.x}
                    y1={annotation.start.y}
                    y2={annotation.end.y}
                  />
                  <path
                    d={`M ${leftX} ${leftY} L ${annotation.end.x} ${annotation.end.y} L ${rightX} ${rightY}`}
                    fill="none"
                    stroke={annotation.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={0.012}
                  />
                  {label}
                </g>
              );
            }
            if (annotation.tool === "box" && annotation.start && annotation.end) {
              const x = Math.min(annotation.start.x, annotation.end.x);
              const y = Math.min(annotation.start.y, annotation.end.y);
              const width = Math.abs(annotation.end.x - annotation.start.x);
              const height = Math.abs(annotation.end.y - annotation.start.y);
              return (
                <g key={annotation.id}>
                  <rect
                    fill="none"
                    height={height}
                    stroke={annotation.color}
                    strokeWidth={0.012}
                    width={width}
                    x={x}
                    y={y}
                  />
                  {label}
                </g>
              );
            }
            if (annotation.tool === "text" && annotation.start) return label;
            return null;
          })}
        </svg>
      </div>
    </div>
  );
}

function ReferenceImageEditor({
  onClose,
  onSave,
  reference
}: {
  onClose: () => void;
  onSave: (dataUrl: string) => Promise<void> | void;
  reference: GenerationReferenceImage;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cropPercent, setCropPercent] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [scalePercent, setScalePercent] = useState(100);
  const [brushSize, setBrushSize] = useState(34);
  const [eraseStrokes, setEraseStrokes] = useState<EraseStroke[]>([]);
  const [isErasing, setIsErasing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const settings = useMemo<ReferenceEditSettings>(
    () => ({ cropPercent, rotation, scalePercent, eraseStrokes }),
    [cropPercent, eraseStrokes, rotation, scalePercent]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let canceled = false;
    drawReferenceEdit(canvas, reference.dataUrl, settings).catch((error) => {
      if (!canceled) setEditError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      canceled = true;
    };
  }, [reference.dataUrl, settings]);

  const pointFromPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
    };
  };

  const beginErase = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const point = pointFromPointer(event);
    if (!canvas || !point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    const brushSizeRatio = brushSize / Math.max(1, Math.min(canvas.width, canvas.height));
    setEraseStrokes((current) => [...current, { brushSizeRatio, points: [point] }]);
    setIsErasing(true);
  };

  const continueErase = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isErasing) return;
    const point = pointFromPointer(event);
    if (!point) return;
    event.preventDefault();
    setEraseStrokes((current) => {
      if (!current.length) return current;
      const next = [...current];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, points: [...last.points, point] };
      return next;
    });
  };

  const finishErase = (event: PointerEvent<HTMLCanvasElement>) => {
    setIsErasing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const saveEditedImage = async () => {
    try {
      setIsSaving(true);
      setEditError("");
      const dataUrl = await renderEditedReferenceDataUrl(reference.dataUrl, settings);
      await onSave(dataUrl);
    } catch (saveError) {
      setEditError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal reference-editor-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <h2>参考图轻量编辑</h2>
          <p>{reference.name}</p>
        </div>
        <div className="reference-editor-layout">
          <div className="reference-editor-canvas-wrap">
            <canvas
              onPointerCancel={finishErase}
              onPointerDown={beginErase}
              onPointerMove={continueErase}
              onPointerUp={finishErase}
              ref={canvasRef}
            />
          </div>
          <div className="reference-editor-controls">
            <label>
              裁切范围
              <input
                max={100}
                min={40}
                onChange={(event) => setCropPercent(Number(event.target.value) || 100)}
                type="range"
                value={cropPercent}
              />
              <small>{cropPercent}%</small>
            </label>
            <label>
              缩放
              <input
                max={160}
                min={60}
                onChange={(event) => setScalePercent(Number(event.target.value) || 100)}
                type="range"
                value={scalePercent}
              />
              <small>{scalePercent}%</small>
            </label>
            <label>
              旋转
              <select onChange={(event) => setRotation(Number(event.target.value) || 0)} value={rotation}>
                <option value={0}>0 度</option>
                <option value={90}>90 度</option>
                <option value={180}>180 度</option>
                <option value={270}>270 度</option>
              </select>
            </label>
            <label>
              擦除画笔
              <input
                max={96}
                min={12}
                onChange={(event) => setBrushSize(Number(event.target.value) || 34)}
                type="range"
                value={brushSize}
              />
              <small>{brushSize}px</small>
            </label>
            <button className="secondary-button" disabled={!eraseStrokes.length} onClick={() => setEraseStrokes([])} type="button">
              <RotateCcw size={16} />
              清除擦除
            </button>
          </div>
        </div>
        {editError && (
          <div className="inline-error">
            <AlertCircle size={17} />
            <span>{editError}</span>
          </div>
        )}
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            取消
          </button>
          <button className="primary-button" disabled={isSaving} onClick={() => void saveEditedImage()} type="button">
            {isSaving ? <Loader2 className="spin" size={17} /> : <Check size={17} />}
            保存编辑
          </button>
        </div>
      </section>
    </div>
  );
}

function PromptBlock({
  label,
  value,
  copied,
  onCopy,
  placeholder = "分析完成后这里会显示可直接复制的通用提示词。"
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  placeholder?: string;
}): JSX.Element {
  return (
    <article className="prompt-block">
      <div className="prompt-title">
        <h2>{label}</h2>
        <button className="icon-button" disabled={!value} onClick={onCopy} title={`复制${label}`} type="button">
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      <p>{value || placeholder}</p>
    </article>
  );
}

function FusedPromptOutput({
  prompt,
  copiedKey,
  onCopyPrompt,
  jsonText = "",
  onCopyJson,
  compact = false
}: {
  prompt: string;
  copiedKey: string;
  onCopyPrompt: () => void;
  jsonText?: string;
  onCopyJson?: () => void;
  compact?: boolean;
}): JSX.Element {
  return (
    <div className={compact ? "fused-reader compact" : "fused-reader"}>
      <div className="fused-reader-header">
        <div>
          <h2>最终融合提示词</h2>
          <p>这段就是后续附带主体参考图时可直接使用的完整文本。</p>
        </div>
        <div className="fused-reader-actions">
          <button className="secondary-button" onClick={onCopyPrompt} type="button">
            <Copy size={17} />
            {copiedKey === "prompt" ? "已复制" : "复制提示词"}
          </button>
          {jsonText && onCopyJson && (
            <button className="secondary-button" onClick={onCopyJson} type="button">
              <Copy size={17} />
              {copiedKey === "json" ? "已复制" : "复制融合 JSON"}
            </button>
          )}
        </div>
      </div>
      <textarea aria-label="最终融合提示词" className="fused-prompt-reader" readOnly value={prompt} />
      {jsonText && (
        <details className="fused-json-details">
          <summary>查看融合 JSON</summary>
          <pre className="fused-json-viewer">{jsonText}</pre>
        </details>
      )}
    </div>
  );
}

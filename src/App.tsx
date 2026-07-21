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
  ChevronRight,
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
import {
  imageEditLineItemsFromInput,
  normalizeImageEditLineItems
} from "./shared/image-edit-regeneration";
import { clipboardPasteShortcut, isWindowsPlatform, localDataScopeLabel } from "./shared/platform";
import { createLocalSourceCapture } from "./shared/schema";
import { buildDirectTextToImagePrompt } from "./shared/text-to-image-prompt";
import {
  extractionGenerationHandoffKey,
  extractionWorkflowLineageKey,
  generationOutputHandoffKey,
  generationPromptSourceHandoffKey,
  generationPromptSourceLineageKey,
  imageEditSourceHandoffKey,
  resolveWorkflowLineageKeys
} from "./shared/workflow-lineage";
import {
  admitBatchInputs,
  countActiveWorkflows,
  createWorkflowLineageMarkerMap,
  isWorkflowOperationCurrent,
  isWorkspaceStatusTerminal,
  updateWorkflowById,
  updateWorkflowForOperation,
  workflowLineageMarkerForKey,
  WORKSPACE_CONCURRENCY_LIMIT
} from "./shared/workspace-concurrency";
import type {
  WorkflowOperationToken,
  WorkflowLineageMarker,
  WorkspaceKind,
  WorkspaceLifecycleStatus
} from "./shared/workspace-concurrency";
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
  ImageEditAnnotationResolution,
  ImageEditAnnotationImage,
  ImageEditCreateRequest,
  ImageEditOutput,
  ImageEditRequestSettings,
  ImageEditRegenerationContext,
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
  apiMode: "chat_completions",
  modelName: "gpt-4o-mini",
  saveApiKey: false,
  hasApiKey: false
};

const pasteShortcut = clipboardPasteShortcut(navigator.platform);
const isWindows = isWindowsPlatform(navigator.platform);
const localDataScope = localDataScopeLabel(navigator.platform);

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

type ExtractionWorkflowStage = "preparing" | "analyzing" | "analysis_ready" | "fusing" | "fused";

type ExtractionWorkflow = {
  id: string;
  revision: number;
  status: WorkspaceLifecycleStatus;
  stage: ExtractionWorkflowStage;
  operationId?: string;
  displayName: string;
  image: ImageState | null;
  analysis: StyleAnalysis | null;
  rawText: string;
  editedTextMarkdown: string;
  historyItemId?: string;
  statusMessage: string;
  error: string;
  subjectImage: ImageState | null;
  fusedPrompt: string;
  fusedPromptJson: FusedPromptJson | null;
  fuseError: string;
  fuseControls: FusePromptControls;
  selectedFuseMode: FusePromptMode | null;
  productInfoText: string;
};

type GenerationWorkflowStage = "draft" | "submitting" | "queued" | "running" | "finished";

type GenerationWorkflow = {
  id: string;
  revision: number;
  status: WorkspaceLifecycleStatus;
  stage: GenerationWorkflowStage;
  operationId?: string;
  displayName: string;
  prompt: string;
  promptSource: GenerationPromptSource | null;
  referenceImages: GenerationReferenceImage[];
  settings: GenerationRequestSettings;
  sourceWorkflowRevision?: number;
  promptEditedByUser?: boolean;
  referencesEditedByUser?: boolean;
  taskId?: string;
  statusMessage: string;
  error: string;
  readOnly?: boolean;
};

type ImageEditWorkflowStage =
  | "preparing"
  | "annotating"
  | "resolving"
  | "confirming"
  | "queued"
  | "running"
  | "finished";

type ImageEditWorkflow = {
  id: string;
  revision: number;
  status: WorkspaceLifecycleStatus;
  stage: ImageEditWorkflowStage;
  operationId?: string;
  displayName: string;
  source: ImageEditSourceImage | null;
  annotations: ImageEditAnnotation[];
  regenerationContext: ImageEditRegenerationContext | null;
  annotationResolution: ImageEditAnnotationResolution | null;
  instruction: string;
  settings: ImageEditRequestSettings;
  taskId?: string;
  statusMessage: string;
  error: string;
  activeTool: ImageEditTool;
  annotationColor: string;
  annotationText: string;
  readOnly?: boolean;
};

type WorkspaceDialogState = {
  workspace: WorkspaceKind;
  occupied: number;
  acceptedCount: number;
  rejectedCount: number;
  failures?: string[];
};

type WorkflowNavigatorItem = {
  id: string;
  lineageMarker: WorkflowLineageMarker;
  title: string;
  subtitle: string;
  status: WorkspaceLifecycleStatus;
  thumbnailDataUrl?: string;
  error?: string;
  countsTowardCapacity?: boolean;
  canClose?: boolean;
  closeLabel?: string;
  closeTitle?: string;
};

type HandoffDismissalWorkspace = "generation" | "image_edit";

const handoffDismissalStorageKeys: Record<HandoffDismissalWorkspace, string> = {
  generation: "image-style-extractor.dismissed-generation-handoffs.v1",
  image_edit: "image-style-extractor.dismissed-image-edit-handoffs.v1"
};

const loadDismissedHandoffKeys = (workspace: HandoffDismissalWorkspace): Set<string> => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(handoffDismissalStorageKeys[workspace]) || "[]");
    if (!Array.isArray(stored)) return new Set();
    return new Set(stored.filter((value): value is string => typeof value === "string" && Boolean(value)).slice(-500));
  } catch {
    return new Set();
  }
};

const saveDismissedHandoffKeys = (workspace: HandoffDismissalWorkspace, keys: Set<string>): void => {
  try {
    window.localStorage.setItem(
      handoffDismissalStorageKeys[workspace],
      JSON.stringify(Array.from(keys).slice(-500))
    );
  } catch {
    // A storage quota failure must not block removing the current workspace row.
  }
};

const workspaceLabelMap: Record<WorkspaceKind, string> = {
  extraction: "图片解析工作区",
  generation: "生图工作区",
  image_edit: "改图工作区"
};

const applyStateAction = <T,>(current: T, action: SetStateAction<T>): T =>
  typeof action === "function" ? (action as (value: T) => T)(current) : action;

const runWithConcurrency = async <T, R>(
  inputs: readonly T[],
  limit: number,
  worker: (input: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(inputs.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, inputs.length) }, async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(inputs[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const lifecycleStatusFromTask = (status: GenerationTask["status"]): WorkspaceLifecycleStatus => status;

const generationStageFromTask = (status: GenerationTask["status"]): GenerationWorkflowStage => {
  if (status === "queued") return "queued";
  if (status === "running") return "running";
  return "finished";
};

const imageEditStageFromTask = (status: ImageEditTask["status"]): ImageEditWorkflowStage => {
  if (status === "queued") return "queued";
  if (status === "running") return "running";
  return "finished";
};

const createExtractionWorkflow = (displayName: string): ExtractionWorkflow => ({
  id: crypto.randomUUID(),
  revision: 0,
  status: "setup",
  stage: "preparing",
  displayName,
  image: null,
  analysis: null,
  rawText: "",
  editedTextMarkdown: "",
  statusMessage: "正在读取图片...",
  error: "",
  subjectImage: null,
  fusedPrompt: "",
  fusedPromptJson: null,
  fuseError: "",
  fuseControls: defaultFuseControls,
  selectedFuseMode: null,
  productInfoText: ""
});

const createGenerationWorkflow = (
  initial: Partial<
    Pick<
      GenerationWorkflow,
      "prompt" | "promptSource" | "referenceImages" | "settings" | "displayName" | "sourceWorkflowRevision"
    >
  > = {}
): GenerationWorkflow => ({
  id: crypto.randomUUID(),
  revision: 0,
  status: "setup",
  stage: "draft",
  displayName: initial.displayName || initial.promptSource?.sourceFileName || initial.promptSource?.label || "未命名生图流程",
  prompt: initial.prompt || "",
  promptSource: initial.promptSource || null,
  referenceImages: initial.referenceImages || [],
  settings: initial.settings || { ...defaultGenerationSettings },
  sourceWorkflowRevision: initial.sourceWorkflowRevision,
  statusMessage: "待配置",
  error: ""
});

const createImageEditWorkflow = (displayName: string): ImageEditWorkflow => ({
  id: crypto.randomUUID(),
  revision: 0,
  status: "setup",
  stage: "preparing",
  displayName,
  source: null,
  annotations: [],
  regenerationContext: null,
  annotationResolution: null,
  instruction: "",
  settings: { ...defaultImageEditSettings },
  statusMessage: "正在读取图片...",
  error: "",
  activeTool: "brush",
  annotationColor: "#f04438",
  annotationText: ""
});

const generationWorkflowFromTask = (task: GenerationTask): GenerationWorkflow => ({
  id: task.clientWorkflowId || `task:${task.id}`,
  revision: 0,
  status: lifecycleStatusFromTask(task.status),
  stage: generationStageFromTask(task.status),
  displayName: task.promptSource.sourceFileName || task.promptSource.label || "生图任务",
  prompt: task.prompt,
  promptSource: task.promptSource,
  referenceImages: task.referenceImages,
  settings: task.settings,
  taskId: task.id,
  statusMessage: formatGenerationTaskStatus(task.status),
  error: task.error || "",
  readOnly: !task.clientWorkflowId
});

const imageEditWorkflowFromTask = (task: ImageEditTask): ImageEditWorkflow => ({
  id: task.clientWorkflowId || `task:${task.id}`,
  revision: 0,
  status: lifecycleStatusFromTask(task.status),
  stage: imageEditStageFromTask(task.status),
  displayName: task.sourceImage.name || "改图任务",
  source: task.sourceImage,
  annotations: [],
  regenerationContext: task.regenerationContext || null,
  annotationResolution: task.annotationResolution || null,
  instruction: task.instruction,
  settings: task.settings,
  taskId: task.id,
  statusMessage: formatGenerationTaskStatus(task.status),
  error: task.error || "",
  activeTool: "brush",
  annotationColor: "#f04438",
  annotationText: "",
  readOnly: !task.clientWorkflowId
});

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

const createImageEditAnnotationModelImage = (dataUrl: string): Promise<string> =>
  createCompressedImage(dataUrl, {
    maxSize: 1536,
    maxBytes: 1280 * 1024,
    initialQuality: 0.84,
    minQuality: 0.58
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

const MAX_IMAGE_EDIT_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_EDIT_SOURCE_PIXELS = 12_000_000;

const imageDataUrlByteLength = (dataUrl: string): number => {
  const payload = dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i)?.[1]?.replace(/\s/g, "");
  if (!payload) throw new Error("改图源图必须是有效的 base64 图片数据。");
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
};

const assertImageEditSourceLimits = (dataUrl: string, width?: number, height?: number) => {
  const byteLength = imageDataUrlByteLength(dataUrl);
  if (byteLength > MAX_IMAGE_EDIT_SOURCE_BYTES) {
    throw new Error("改图源图原始数据超过 32MB，为避免静默压缩或内存风险，本次已拒绝导入。");
  }
  if (width && height && width * height > MAX_IMAGE_EDIT_SOURCE_PIXELS) {
    throw new Error("改图源图解码像素超过 1200 万，为避免静默缩小，本次已拒绝导入。");
  }
};

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
  const percent = (point: { x: number; y: number }) =>
    `${Math.round(point.x * 100)}% x ${Math.round(point.y * 100)}%`;
  if (annotation.tool === "box" && annotation.start && annotation.end) {
    const leftTop = {
      x: Math.min(annotation.start.x, annotation.end.x),
      y: Math.min(annotation.start.y, annotation.end.y)
    };
    const rightBottom = {
      x: Math.max(annotation.start.x, annotation.end.x),
      y: Math.max(annotation.start.y, annotation.end.y)
    };
    return `框选左上角 ${percent(leftTop)}，右下角 ${percent(rightBottom)}`;
  }
  if (annotation.tool === "arrow" && annotation.start && annotation.end) {
    return `箭头起点 ${percent(annotation.start)}，终点 ${percent(annotation.end)}`;
  }
  if (annotation.tool === "brush" && annotation.points?.length) {
    const xs = annotation.points.map((point) => point.x);
    const ys = annotation.points.map((point) => point.y);
    return `笔迹包围框左上角 ${percent({ x: Math.min(...xs), y: Math.min(...ys) })}，右下角 ${percent({
      x: Math.max(...xs),
      y: Math.max(...ys)
    })}`;
  }
  if (annotation.tool === "text" && annotation.start) return `文字锚点 ${percent(annotation.start)}`;
  const anchor = imageEditAnnotationAnchor(annotation);
  return anchor ? `锚点 ${percent(anchor)}` : undefined;
};

const buildImageEditAnnotationItems = (annotations: ImageEditAnnotation[]): ImageEditAnnotationItem[] =>
  annotations.map((annotation, index) => {
    const lineWidth = 0.012;
    const geometry = (() => {
      if (annotation.tool === "box" && annotation.start && annotation.end) {
        const left = Math.min(annotation.start.x, annotation.end.x);
        const right = Math.max(annotation.start.x, annotation.end.x);
        const top = Math.min(annotation.start.y, annotation.end.y);
        const bottom = Math.max(annotation.start.y, annotation.end.y);
        return {
          tool: "box" as const,
          left,
          top,
          right,
          bottom,
          centerX: (left + right) / 2,
          centerY: (top + bottom) / 2,
          width: right - left,
          height: bottom - top
        };
      }
      if (annotation.tool === "arrow" && annotation.start && annotation.end) {
        return {
          tool: "arrow" as const,
          startX: annotation.start.x,
          startY: annotation.start.y,
          endX: annotation.end.x,
          endY: annotation.end.y
        };
      }
      if (annotation.tool === "brush" && annotation.points?.length) {
        const xs = annotation.points.map((point) => point.x);
        const ys = annotation.points.map((point) => point.y);
        const centerX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
        const centerY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
        const pathLength = annotation.points.slice(1).reduce((sum, point, pointIndex) => {
          const previous = annotation.points?.[pointIndex] || point;
          return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
        }, 0);
        return {
          tool: "brush" as const,
          left: Math.max(0, Math.min(...xs) - lineWidth / 2),
          top: Math.max(0, Math.min(...ys) - lineWidth / 2),
          right: Math.min(1, Math.max(...xs) + lineWidth / 2),
          bottom: Math.min(1, Math.max(...ys) + lineWidth / 2),
          centerX,
          centerY,
          coverageRatio: Math.min(1, pathLength * lineWidth + Math.PI * (lineWidth / 2) ** 2),
          effectiveLineWidth: lineWidth
        };
      }
      if (annotation.tool === "text" && annotation.start) {
        return {
          tool: "text" as const,
          anchorX: annotation.start.x,
          anchorY: annotation.start.y,
          text: annotation.note?.trim() || annotation.text?.trim() || "修改这里"
        };
      }
      return undefined;
    })();
    return {
      index: index + 1,
      label: `标注 ${index + 1}`,
      tool: annotation.tool,
      note: annotation.note?.trim() || "按总体改图说明处理此处。",
      positionHint: imageEditAnnotationPositionHint(annotation),
      geometry
    };
  });

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
  options: { textMode?: "number_only" | "full_note"; monochromeLocator?: boolean } = {}
) => {
  context.lineCap = "round";
  context.lineJoin = "round";
  annotations.forEach((annotation, annotationIndex) => {
    const anchor = imageEditAnnotationAnchor(annotation);
    const locator = options.monochromeLocator === true;
    const baseLineWidth = locator
      ? clampValue(Math.round(Math.min(width, height) * 0.004), 2, 8)
      : Math.max(4, Math.round(Math.min(width, height) * 0.012));
    const strokePath = () => {
      if (locator) {
        context.strokeStyle = "rgba(255, 255, 255, 0.96)";
        context.lineWidth = baseLineWidth + Math.max(2, Math.round(baseLineWidth * 0.7));
        context.stroke();
        context.strokeStyle = "#111827";
        context.lineWidth = baseLineWidth;
        context.stroke();
        return;
      }
      context.strokeStyle = annotation.color;
      context.lineWidth = baseLineWidth;
      context.stroke();
    };
    context.strokeStyle = locator ? "#111827" : annotation.color;
    context.fillStyle = locator ? "#111827" : annotation.color;
    context.lineWidth = baseLineWidth;
    if (annotation.tool === "brush" && annotation.points?.length) {
      if (annotation.points.length === 1) {
        const [point] = annotation.points;
        context.beginPath();
        context.arc(point.x * width, point.y * height, baseLineWidth * 0.85, 0, Math.PI * 2);
        context.fill();
        if (locator) {
          context.strokeStyle = "#ffffff";
          context.lineWidth = Math.max(2, baseLineWidth * 0.6);
          context.stroke();
        }
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
      strokePath();
      if (anchor) drawImageEditAnnotationLabel(context, annotationIndex, anchor, width, height);
      return;
    }
    if ((annotation.tool === "arrow" || annotation.tool === "box") && annotation.start && annotation.end) {
      const startX = annotation.start.x * width;
      const startY = annotation.start.y * height;
      const endX = annotation.end.x * width;
      const endY = annotation.end.y * height;
      if (annotation.tool === "box") {
        if (locator) {
          context.strokeStyle = "rgba(255, 255, 255, 0.96)";
          context.lineWidth = baseLineWidth + Math.max(2, Math.round(baseLineWidth * 0.7));
          context.strokeRect(startX, startY, endX - startX, endY - startY);
          context.strokeStyle = "#111827";
          context.lineWidth = baseLineWidth;
        }
        context.strokeRect(startX, startY, endX - startX, endY - startY);
        if (anchor) drawImageEditAnnotationLabel(context, annotationIndex, anchor, width, height);
        return;
      }
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      const angle = Math.atan2(endY - startY, endX - startX);
      const headLength = Math.max(18, Math.min(width, height) * 0.035);
      context.moveTo(endX, endY);
      context.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
      context.moveTo(endX, endY);
      context.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
      strokePath();
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
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  drawImageEditAnnotations(context, annotations, canvas.width, canvas.height, {
    textMode: "number_only",
    monochromeLocator: true
  });
  return canvas.toDataURL("image/png");
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
  const images = await runWithConcurrency(references, 2, (reference) => loadImageElement(reference.dataUrl));
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

const extractionWorkflowFromHistory = (item: HistoryItem): ExtractionWorkflow => ({
  ...createExtractionWorkflow(item.fileName || "历史图片"),
  id: `history:${item.id}`,
  status: "succeeded",
  stage: item.fusedPromptResult ? "fused" : "analysis_ready",
  image: historyItemToImageState(item),
  analysis: item.analysis,
  rawText: "",
  editedTextMarkdown: item.editedTextMarkdown ?? extractedTextFromAnalysis(item.analysis),
  historyItemId: item.id,
  statusMessage: item.fusedPromptResult ? "已完成" : "已解析，可融合",
  fusedPrompt: item.fusedPromptResult?.fused_prompt || "",
  fusedPromptJson: item.fusedPromptResult?.fused_prompt_json || null
});

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

const formatGenerationProviderType = (providerType: GenerationProviderType): string =>
  providerType === "openrouter" ? "OpenRouter" : "通用 API";

const formatGenerationApiMode = (apiMode: GenerationConfig["apiMode"]): string => {
  if (apiMode === "responses") return "Responses";
  if (apiMode === "chat_completions") return "Chat Completions";
  if (apiMode === "gemini") return "Gemini 原生";
  return "Images";
};

const generationApiModeNote = (config: GenerationConfigDraft): string => {
  if (config.authSource === "codex_oauth") {
    return "适合已在本机登录 Codex 的情况，固定走 Codex 内部 Responses，无需填写 API Key。";
  }
  if (config.providerType === "openrouter") {
    return "适合 OpenRouter，固定调用专用 /images 接口。";
  }
  if (config.apiMode === "responses") {
    return "适合明确提供 /responses 与 image_generation 图像工具的平台。";
  }
  if (config.apiMode === "chat_completions") {
    return "适合用 /chat/completions 返回图片的兼容中转平台，例如部分 New API 平台。";
  }
  if (config.apiMode === "gemini") {
    return "适合 Google Gemini 官方，或在 /v1、/v1beta 下提供 models/{model}:generateContent 的中转平台。";
  }
  return "适合提供 /images/generations 和 /images/edits 的 OpenAI 兼容生图平台。";
};

const visionApiModeNote = (apiMode: ModelConfig["apiMode"]): string => {
  if (apiMode === "responses") return "适合明确提供 /responses 多模态识图接口的平台。";
  if (apiMode === "anthropic") {
    return "适合使用 ANTHROPIC_BASE_URL 和 ANTHROPIC_AUTH_TOKEN 的 Claude Code 中转，调用 /v1/messages。";
  }
  if (apiMode === "gemini") {
    return "适合 Google Gemini 官方或提供 /v1beta/models/{model}:generateContent 的中转平台。";
  }
  return "适合大多数提供 /chat/completions 多模态识图接口的 OpenAI 兼容平台。";
};

const formatStyleTerms = (analysis: StyleAnalysis | null): string => {
  if (!analysis) return "";
  const summary = analysis.web_design_context.page_style_summary;
  const terms = analysis.style_terms
    .filter((term) => term.copyable)
    .map((term) => `${term.name}（${term.category}，${Math.round(term.confidence * 100)}%）`);
  return [summary, terms.length ? terms.join("、") : ""].filter(Boolean).join("\n");
};

const generationPromptOptionsForExtraction = (
  workflow: ExtractionWorkflow | null | undefined
): GenerationPromptOption[] => {
  if (!workflow?.analysis) return [];
  const prompts = getPromptBlocks(workflow.analysis);
  const candidates: GenerationPromptOption[] = [
    {
      kind: "text_to_image",
      label: "完整文生图提示词",
      value: buildDirectTextToImagePrompt(workflow.analysis, workflow.editedTextMarkdown)
    },
    { kind: "universal", label: "通用风格提示词", value: prompts.universal },
    { kind: "layout", label: "排版布局提示词", value: prompts.layout },
    { kind: "negative", label: "负面提示词", value: prompts.negative },
    { kind: "template", label: "封面模板提示词", value: prompts.template },
    {
      kind: "information_layout",
      label: "表格/卡片信息布局提示词",
      value: prompts.informationLayout
    },
    { kind: "style_terms", label: "网页设计风格词", value: formatStyleTerms(workflow.analysis) },
    { kind: "fused_prompt", label: "最终融合提示词", value: workflow.fusedPrompt },
    {
      kind: "fused_copy_ready",
      label: "融合 JSON 可复制提示词",
      value: fusedJsonText(workflow.fusedPromptJson)
    }
  ];
  return candidates.filter((option) => option.value.trim());
};

const preferredGenerationPromptOption = (
  workflow: ExtractionWorkflow,
  currentKind?: GenerationPromptSourceKind
): GenerationPromptOption | undefined => {
  const options = generationPromptOptionsForExtraction(workflow);
  const fusedOption = options.find((option) => option.kind === "fused_prompt");
  if (currentKind === "text_to_image" && fusedOption) return fusedOption;
  if (currentKind) {
    const currentOption = options.find((option) => option.kind === currentKind);
    if (currentOption) return currentOption;
  }
  return fusedOption || options.find((option) => option.kind === "text_to_image") || options[0];
};

export function App(): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const subjectFileInputRef = useRef<HTMLInputElement | null>(null);
  const generationReferenceInputRef = useRef<HTMLInputElement | null>(null);
  const imageEditSourceInputRef = useRef<HTMLInputElement | null>(null);
  const configRef = useRef<ModelConfig>(defaultConfig);
  const generationConfigRef = useRef<GenerationConfig>(defaultGenerationConfig);
  const strictGeneralizationRef = useRef(true);
  const extractionWorkflowsRef = useRef<ExtractionWorkflow[]>([]);
  const generationWorkflowsRef = useRef<GenerationWorkflow[]>([]);
  const imageEditWorkflowsRef = useRef<ImageEditWorkflow[]>([]);
  const historyEpochRef = useRef(0);
  const generationPollSequenceRef = useRef(0);
  const imageEditPollSequenceRef = useRef(0);
  const generationTaskEpochRef = useRef(0);
  const imageEditTaskEpochRef = useRef(0);
  const deletedGenerationTaskIdsRef = useRef(new Set<string>());
  const deletedImageEditTaskIdsRef = useRef(new Set<string>());
  const generationRetrySourceIdsRef = useRef(new Set<string>());
  const generationHandoffsInFlightRef = useRef(new Set<string>());
  const generationSourceSyncSequenceRef = useRef(new Map<string, number>());
  const imageEditHandoffsInFlightRef = useRef(new Set<string>());
  const generationTasksRef = useRef<GenerationTask[]>([]);
  const imageEditTasksRef = useRef<ImageEditTask[]>([]);
  const workflowLineageMarkerRegistryRef = useRef(new Map<string, WorkflowLineageMarker>());
  const [config, setConfig] = useState<ModelConfig>(defaultConfig);
  const [draftConfig, setDraftConfig] = useState<ConfigDraft>(defaultDraftConfig);
  const [generationConfig, setGenerationConfig] = useState<GenerationConfig>(defaultGenerationConfig);
  const [generationDraft, setGenerationDraft] = useState<GenerationConfigDraft>(defaultGenerationDraft);
  const [showGenerationConfig, setShowGenerationConfig] = useState(false);
  const [activeView, setActiveView] = useState<"extract" | "generate" | "edit">("extract");
  const [showConfig, setShowConfig] = useState(false);
  const [extractionWorkflows, setExtractionWorkflowsState] = useState<ExtractionWorkflow[]>([]);
  const [generationWorkflows, setGenerationWorkflowsState] = useState<GenerationWorkflow[]>([]);
  const [imageEditWorkflows, setImageEditWorkflowsState] = useState<ImageEditWorkflow[]>([]);
  const [activeExtractionWorkflowId, setActiveExtractionWorkflowId] = useState("");
  const [activeGenerationWorkflowId, setActiveGenerationWorkflowId] = useState("");
  const [activeImageEditWorkflowId, setActiveImageEditWorkflowId] = useState("");
  const [capacityDialog, setCapacityDialog] = useState<WorkspaceDialogState | null>(null);
  const [collapseCompletedExtraction, setCollapseCompletedExtraction] = useState(true);
  const [collapseCompletedGeneration, setCollapseCompletedGeneration] = useState(true);
  const [collapseCompletedImageEdit, setCollapseCompletedImageEdit] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [, setHistoryEpoch] = useState(0);
  const [strictGeneralization, setStrictGeneralization] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState("");
  const [showFuseModal, setShowFuseModal] = useState(false);
  const [isSubjectDragging, setIsSubjectDragging] = useState(false);
  const [fuseCopied, setFuseCopied] = useState("");
  const [imagePreview, setImagePreview] = useState<ImagePreviewState | null>(null);
  const [imagePreviewZoom, setImagePreviewZoom] = useState<ImagePreviewZoomState>(defaultImagePreviewZoom);
  const [comparePreview, setComparePreview] = useState<ComparePreviewState | null>(null);
  const [editingGenerationReferenceId, setEditingGenerationReferenceId] = useState("");
  const [generationTasks, setGenerationTasks] = useState<GenerationTask[]>([]);
  const [selectedGenerationTaskId, setSelectedGenerationTaskId] = useState("");
  const [restoreOnGenerationTaskClick, setRestoreOnGenerationTaskClick] = useState(false);
  const [collapsedGenerationTaskIds, setCollapsedGenerationTaskIds] = useState<string[]>([]);
  const [generationCopied, setGenerationCopied] = useState("");
  const [imageEditTasks, setImageEditTasks] = useState<ImageEditTask[]>([]);
  const [selectedImageEditTaskId, setSelectedImageEditTaskId] = useState("");
  const [collapsedImageEditTaskIds, setCollapsedImageEditTaskIds] = useState<string[]>([]);
  const [isImageEditDragging, setIsImageEditDragging] = useState(false);
  const [dismissedGenerationHandoffKeys, setDismissedGenerationHandoffKeys] = useState<Set<string>>(() =>
    loadDismissedHandoffKeys("generation")
  );
  const [dismissedImageEditHandoffKeys, setDismissedImageEditHandoffKeys] = useState<Set<string>>(() =>
    loadDismissedHandoffKeys("image_edit")
  );

  const dismissHandoffs = useCallback((workspace: HandoffDismissalWorkspace, keys: Iterable<string>) => {
    const additions = Array.from(keys).filter(Boolean);
    if (!additions.length) return;
    const update = (current: Set<string>): Set<string> => {
      const next = new Set(current);
      additions.forEach((key) => next.add(key));
      saveDismissedHandoffKeys(workspace, next);
      return next;
    };
    if (workspace === "generation") {
      setDismissedGenerationHandoffKeys(update);
    } else {
      setDismissedImageEditHandoffKeys(update);
    }
  }, []);

  const resetDismissedHandoffs = useCallback(() => {
    setDismissedGenerationHandoffKeys(new Set());
    setDismissedImageEditHandoffKeys(new Set());
    try {
      window.localStorage.removeItem(handoffDismissalStorageKeys.generation);
      window.localStorage.removeItem(handoffDismissalStorageKeys.image_edit);
    } catch {
      // The main-process data wipe remains authoritative if renderer storage is unavailable.
    }
  }, []);

  const commitExtractionWorkflows = useCallback((updater: (current: ExtractionWorkflow[]) => ExtractionWorkflow[]) => {
    const next = updater(extractionWorkflowsRef.current);
    extractionWorkflowsRef.current = next;
    setExtractionWorkflowsState(next);
  }, []);

  const commitGenerationWorkflows = useCallback((updater: (current: GenerationWorkflow[]) => GenerationWorkflow[]) => {
    const next = updater(generationWorkflowsRef.current);
    generationWorkflowsRef.current = next;
    setGenerationWorkflowsState(next);
  }, []);

  const commitImageEditWorkflows = useCallback((updater: (current: ImageEditWorkflow[]) => ImageEditWorkflow[]) => {
    const next = updater(imageEditWorkflowsRef.current);
    imageEditWorkflowsRef.current = next;
    setImageEditWorkflowsState(next);
  }, []);

  const showWorkspaceLimit = useCallback(
    (workspace: WorkspaceKind, occupied: number, rejectedCount = 1, acceptedCount = 0, failures?: string[]) => {
      setCapacityDialog({ workspace, occupied, rejectedCount, acceptedCount, failures });
    },
    []
  );

  const reserveGenerationWorkflow = useCallback(
    (workflow: GenerationWorkflow): GenerationWorkflow | null => {
      const admission = admitBatchInputs([workflow], generationWorkflowsRef.current);
      if (!admission.accepted.length) {
        showWorkspaceLimit("generation", admission.occupied);
        return null;
      }
      const next = [workflow, ...generationWorkflowsRef.current];
      generationWorkflowsRef.current = next;
      setGenerationWorkflowsState(next);
      setActiveGenerationWorkflowId(workflow.id);
      return workflow;
    },
    [showWorkspaceLimit]
  );

  const activeExtractionWorkflow =
    extractionWorkflows.find((workflow) => workflow.id === activeExtractionWorkflowId) || null;
  const activeGenerationWorkflow =
    generationWorkflows.find((workflow) => workflow.id === activeGenerationWorkflowId) || null;
  const activeImageEditWorkflow =
    imageEditWorkflows.find((workflow) => workflow.id === activeImageEditWorkflowId) || null;

  const image = activeExtractionWorkflow?.image || null;
  const analysis = activeExtractionWorkflow?.analysis || null;
  const rawText = activeExtractionWorkflow?.rawText || "";
  const activeHistoryId = activeExtractionWorkflow?.historyItemId || "";
  const error = activeExtractionWorkflow?.error || "";
  const editedTextMarkdown = activeExtractionWorkflow?.editedTextMarkdown || "";
  const subjectImage = activeExtractionWorkflow?.subjectImage || null;
  const fusedPrompt = activeExtractionWorkflow?.fusedPrompt || "";
  const fusedPromptJson = activeExtractionWorkflow?.fusedPromptJson || null;
  const fuseError = activeExtractionWorkflow?.fuseError || "";
  const fuseControls = activeExtractionWorkflow?.fuseControls || defaultFuseControls;
  const selectedFuseMode = activeExtractionWorkflow?.selectedFuseMode || null;
  const productInfoText = activeExtractionWorkflow?.productInfoText || "";
  const isAnalyzing = activeExtractionWorkflow?.stage === "analyzing" && activeExtractionWorkflow.status === "running";
  const isFusing = activeExtractionWorkflow?.stage === "fusing" && activeExtractionWorkflow.status === "running";

  const generationPrompt = activeGenerationWorkflow?.prompt || "";
  const generationPromptSource = activeGenerationWorkflow?.promptSource || null;
  const generationReferenceImages = activeGenerationWorkflow?.referenceImages || [];
  const generationSettings = activeGenerationWorkflow?.settings || defaultGenerationSettings;
  const generationError = activeGenerationWorkflow?.error || "";
  const isGeneratingImage = activeGenerationWorkflow?.stage === "submitting";

  const imageEditSource = activeImageEditWorkflow?.source || null;
  const imageEditAnnotations = activeImageEditWorkflow?.annotations || [];
  const imageEditRegenerationContext = activeImageEditWorkflow?.regenerationContext || null;
  const imageEditAnnotationResolution = activeImageEditWorkflow?.annotationResolution || null;
  const imageEditInstruction = activeImageEditWorkflow?.instruction || "";
  const imageEditSettings = activeImageEditWorkflow?.settings || defaultImageEditSettings;
  const imageEditError = activeImageEditWorkflow?.error || "";
  const isResolvingImageEditAnnotations = activeImageEditWorkflow?.stage === "resolving";
  const isCreatingImageEdit = activeImageEditWorkflow?.stage === "queued";

  const updateActiveExtraction = useCallback(
    (updater: (workflow: ExtractionWorkflow) => ExtractionWorkflow) => {
      if (!activeExtractionWorkflowId) return;
      commitExtractionWorkflows((current) => updateWorkflowById(current, activeExtractionWorkflowId, updater));
    },
    [activeExtractionWorkflowId, commitExtractionWorkflows]
  );

  const updateActiveGeneration = useCallback(
    (updater: (workflow: GenerationWorkflow) => GenerationWorkflow) => {
      if (!activeGenerationWorkflowId) return;
      commitGenerationWorkflows((current) => updateWorkflowById(current, activeGenerationWorkflowId, updater));
    },
    [activeGenerationWorkflowId, commitGenerationWorkflows]
  );

  const updateActiveImageEdit = useCallback(
    (updater: (workflow: ImageEditWorkflow) => ImageEditWorkflow) => {
      if (!activeImageEditWorkflowId) return;
      commitImageEditWorkflows((current) => updateWorkflowById(current, activeImageEditWorkflowId, updater));
    },
    [activeImageEditWorkflowId, commitImageEditWorkflows]
  );

  const setError = useCallback((value: string) => updateActiveExtraction((workflow) => ({ ...workflow, error: value })), [updateActiveExtraction]);
  const setEditedTextMarkdown = useCallback(
    (value: string) => updateActiveExtraction((workflow) => ({ ...workflow, editedTextMarkdown: value, revision: workflow.revision + 1 })),
    [updateActiveExtraction]
  );
  const setFusedPrompt = useCallback((value: string) => updateActiveExtraction((workflow) => ({ ...workflow, fusedPrompt: value })), [updateActiveExtraction]);
  const setFusedPromptJson = useCallback(
    (value: FusedPromptJson | null) => updateActiveExtraction((workflow) => ({ ...workflow, fusedPromptJson: value })),
    [updateActiveExtraction]
  );
  const setFuseError = useCallback((value: string) => updateActiveExtraction((workflow) => ({ ...workflow, fuseError: value })), [updateActiveExtraction]);
  const setFuseControls: Dispatch<SetStateAction<FusePromptControls>> = useCallback(
    (action) => updateActiveExtraction((workflow) => ({
      ...workflow,
      fuseControls: applyStateAction(workflow.fuseControls, action),
      revision: workflow.revision + 1
    })),
    [updateActiveExtraction]
  );
  const setSelectedFuseMode = useCallback(
    (value: FusePromptMode | null) => updateActiveExtraction((workflow) => ({ ...workflow, selectedFuseMode: value, revision: workflow.revision + 1 })),
    [updateActiveExtraction]
  );
  const setProductInfoText = useCallback(
    (value: string) => updateActiveExtraction((workflow) => ({ ...workflow, productInfoText: value, revision: workflow.revision + 1 })),
    [updateActiveExtraction]
  );

  const setGenerationPrompt = useCallback(
    (value: string) => {
      if (!activeGenerationWorkflowId) {
        if (!value) return;
        reserveGenerationWorkflow(createGenerationWorkflow({ prompt: value, displayName: "手动生图" }));
        return;
      }
      updateActiveGeneration((workflow) => ({
        ...workflow,
        prompt: value,
        promptEditedByUser: true,
        revision: workflow.revision + 1,
        error: ""
      }));
    },
    [activeGenerationWorkflowId, reserveGenerationWorkflow, updateActiveGeneration]
  );
  const setGenerationPromptSource = useCallback(
    (value: GenerationPromptSource | null) => updateActiveGeneration((workflow) => ({ ...workflow, promptSource: value })),
    [updateActiveGeneration]
  );
  const setGenerationReferenceImages: Dispatch<SetStateAction<GenerationReferenceImage[]>> = useCallback(
    (action) => updateActiveGeneration((workflow) => ({
      ...workflow,
      referenceImages: applyStateAction(workflow.referenceImages, action),
      referencesEditedByUser: true,
      revision: workflow.revision + 1,
      error: ""
    })),
    [updateActiveGeneration]
  );
  const setGenerationSettings: Dispatch<SetStateAction<GenerationRequestSettings>> = useCallback(
    (action) => {
      if (!activeGenerationWorkflowId) {
        const settings = applyStateAction({ ...defaultGenerationSettings }, action);
        reserveGenerationWorkflow(createGenerationWorkflow({ settings, displayName: "手动生图" }));
        return;
      }
      updateActiveGeneration((workflow) => ({
        ...workflow,
        settings: applyStateAction(workflow.settings, action),
        revision: workflow.revision + 1
      }));
    },
    [activeGenerationWorkflowId, reserveGenerationWorkflow, updateActiveGeneration]
  );
  const setGenerationError = useCallback((value: string) => updateActiveGeneration((workflow) => ({ ...workflow, error: value })), [updateActiveGeneration]);

  const invalidateActiveImageEdit = useCallback(
    (updater: (workflow: ImageEditWorkflow) => ImageEditWorkflow) =>
      updateActiveImageEdit((workflow) => ({
        ...updater(workflow),
        revision: workflow.revision + 1,
        annotationResolution: null,
        error: ""
      })),
    [updateActiveImageEdit]
  );
  const setImageEditAnnotations: Dispatch<SetStateAction<ImageEditAnnotation[]>> = useCallback(
    (action) => invalidateActiveImageEdit((workflow) => ({ ...workflow, annotations: applyStateAction(workflow.annotations, action) })),
    [invalidateActiveImageEdit]
  );
  const setImageEditRegenerationContext: Dispatch<SetStateAction<ImageEditRegenerationContext | null>> = useCallback(
    (action) => invalidateActiveImageEdit((workflow) => ({
      ...workflow,
      regenerationContext: applyStateAction(workflow.regenerationContext, action)
    })),
    [invalidateActiveImageEdit]
  );
  const setImageEditAnnotationResolution: Dispatch<SetStateAction<ImageEditAnnotationResolution | null>> = useCallback(
    (action) => updateActiveImageEdit((workflow) => ({
      ...workflow,
      annotationResolution: applyStateAction(workflow.annotationResolution, action),
      stage: "confirming",
      revision: workflow.revision + 1
    })),
    [updateActiveImageEdit]
  );
  const setImageEditInstruction = useCallback(
    (value: string) => invalidateActiveImageEdit((workflow) => ({ ...workflow, instruction: value })),
    [invalidateActiveImageEdit]
  );
  const setImageEditSettings: Dispatch<SetStateAction<ImageEditRequestSettings>> = useCallback(
    (action) => updateActiveImageEdit((workflow) => ({
      ...workflow,
      settings: applyStateAction(workflow.settings, action),
      revision: workflow.revision + 1
    })),
    [updateActiveImageEdit]
  );
  const setImageEditError = useCallback((value: string) => updateActiveImageEdit((workflow) => ({ ...workflow, error: value })), [updateActiveImageEdit]);

  const supportsInformationLayoutMode = useMemo(() => hasInformationLayoutMode(analysis), [analysis]);
  const fuseMode = resolveFuseMode(analysis, selectedFuseMode);
  const prompts = useMemo(() => getPromptBlocks(analysis), [analysis]);
  const styleTermsText = useMemo(() => formatStyleTerms(analysis), [analysis]);
  const usesInsecureBaseUrl = draftConfig.apiBaseUrl.trim().toLowerCase().startsWith("http://");
  const usesInsecureGenerationBaseUrl =
    generationDraft.authSource === "api" && generationDraft.apiBaseUrl.trim().toLowerCase().startsWith("http://");
  const generationBackendReady = hasGenerationBackend(generationConfig);
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
    () => generationPromptOptionsForExtraction(activeExtractionWorkflow),
    [activeExtractionWorkflow]
  );

  const resetFusionState = useCallback((closeModal = false) => {
    updateActiveExtraction((workflow) => ({
      ...workflow,
      subjectImage: null,
      fusedPrompt: "",
      fusedPromptJson: null,
      fuseError: "",
      fuseControls: defaultFuseControls,
      selectedFuseMode: null,
      productInfoText: ""
    }));
    setIsSubjectDragging(false);
    setFuseCopied("");
    if (closeModal) setShowFuseModal(false);
  }, [updateActiveExtraction]);

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

  useEffect(() => {
    generationTasksRef.current = generationTasks;
  }, [generationTasks]);

  useEffect(() => {
    imageEditTasksRef.current = imageEditTasks;
  }, [imageEditTasks]);

  const applyGenerationConfig = useCallback((nextConfig: GenerationConfig) => {
    const activeProvider =
      nextConfig.providers.find((provider) => provider.id === nextConfig.activeProviderId) || nextConfig.providers[0];
    setGenerationConfig(nextConfig);
    setGenerationDraft({
      ...nextConfig,
      providerType: activeProvider?.providerType || nextConfig.providerType,
      providerName: activeProvider?.name || "",
      apiMode: activeProvider?.apiMode || nextConfig.apiMode,
      apiKey: ""
    });
    commitGenerationWorkflows((current) =>
      current.map((workflow) =>
        workflow.taskId
          ? workflow
          : {
              ...workflow,
              settings: {
                ...workflow.settings,
                apiMode: nextConfig.apiMode,
                imageModel: nextConfig.imageModel,
                mainModel: nextConfig.mainModel
              }
            }
      )
    );
  }, [commitGenerationWorkflows]);

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
    if (!capacityDialog && !showConfig && !showFuseModal && !showGenerationConfig) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (capacityDialog) setCapacityDialog(null);
      if (showConfig) setShowConfig(false);
      if (showGenerationConfig) setShowGenerationConfig(false);
      if (showFuseModal && !isFusing) setShowFuseModal(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [capacityDialog, isFusing, showConfig, showFuseModal, showGenerationConfig]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const [nextConfig, nextGenerationConfig, historySnapshot, nextGenerationTasks, nextImageEditTasks] =
        await Promise.all([
          window.styleExtractor.getConfig(),
          window.styleExtractor.getGenerationConfig(),
          window.styleExtractor.getHistorySnapshot(),
          window.styleExtractor.getGenerationTasks(),
          window.styleExtractor.getImageEditTasks()
        ]);
      if (disposed) return;
      setConfig(nextConfig);
      setDraftConfig({ ...nextConfig, apiKey: "" });
      applyGenerationConfig(nextGenerationConfig);
      setHistory(historySnapshot.items);
      historyEpochRef.current = historySnapshot.epoch;
      setHistoryEpoch(historySnapshot.epoch);
      generationTasksRef.current = nextGenerationTasks;
      imageEditTasksRef.current = nextImageEditTasks;
      setGenerationTasks(nextGenerationTasks);
      setImageEditTasks(nextImageEditTasks);

      const extractionViews = historySnapshot.items.map(extractionWorkflowFromHistory);
      commitExtractionWorkflows((current) => {
        const existingIds = new Set(current.map((workflow) => workflow.id));
        return [...current, ...extractionViews.filter((workflow) => !existingIds.has(workflow.id))];
      });
      const seenGenerationWorkflowIds = new Set<string>();
      const generationViews = nextGenerationTasks
        .map(generationWorkflowFromTask)
        .filter((workflow) => {
          if (seenGenerationWorkflowIds.has(workflow.id)) return false;
          seenGenerationWorkflowIds.add(workflow.id);
          return true;
        });
      commitGenerationWorkflows((current) => {
        const existingIds = new Set(current.map((workflow) => workflow.id));
        return [...current, ...generationViews.filter((workflow) => !existingIds.has(workflow.id))];
      });
      const seenImageEditWorkflowIds = new Set<string>();
      const imageEditViews = nextImageEditTasks
        .map(imageEditWorkflowFromTask)
        .filter((workflow) => {
          if (seenImageEditWorkflowIds.has(workflow.id)) return false;
          seenImageEditWorkflowIds.add(workflow.id);
          return true;
        });
      commitImageEditWorkflows((current) => {
        const existingIds = new Set(current.map((workflow) => workflow.id));
        return [...current, ...imageEditViews.filter((workflow) => !existingIds.has(workflow.id))];
      });
      setActiveExtractionWorkflowId((current) => current || extractionViews[0]?.id || "");
      setActiveGenerationWorkflowId((current) => current || generationViews[0]?.id || "");
      setActiveImageEditWorkflowId((current) => current || imageEditViews[0]?.id || "");
    })().catch((loadError) => {
      if (!disposed) setStatus(loadError instanceof Error ? loadError.message : String(loadError));
    });
    return () => {
      disposed = true;
    };
  }, [applyGenerationConfig, commitExtractionWorkflows, commitGenerationWorkflows, commitImageEditWorkflows]);

  useEffect(() => {
    if (!hasActiveGenerationTasks) return;
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      const sequence = ++generationPollSequenceRef.current;
      try {
        const summaries = await window.styleExtractor.getGenerationTaskSummaries();
        if (disposed || sequence !== generationPollSequenceRef.current) return;
        const currentById = new Map(generationTasksRef.current.map((task) => [task.id, task]));
        const changedIds = summaries
          .filter((summary) => {
            const current = currentById.get(summary.id);
            return !current || current.updatedAt !== summary.updatedAt || current.status !== summary.status || current.outputs.length !== summary.outputCount;
          })
          .map((summary) => summary.id);
        const changedTasks = await runWithConcurrency(changedIds, 3, (id) => window.styleExtractor.getGenerationTask(id));
        if (disposed || sequence !== generationPollSequenceRef.current) return;
        const changedById = new Map(changedTasks.filter((task): task is GenerationTask => Boolean(task)).map((task) => [task.id, task]));
        const nextTasks = summaries
          .map((summary) => changedById.get(summary.id) || currentById.get(summary.id))
          .filter((task): task is GenerationTask => Boolean(task));
        generationTasksRef.current = nextTasks;
        setGenerationTasks(nextTasks);
        const summariesById = new Map(summaries.map((summary) => [summary.id, summary]));
        commitGenerationWorkflows((current) =>
          current.map((workflow) => {
            if (!workflow.taskId) return workflow;
            const summary = summariesById.get(workflow.taskId);
            if (!summary) return workflow;
            return {
              ...workflow,
              status: lifecycleStatusFromTask(summary.status),
              stage: generationStageFromTask(summary.status),
              statusMessage: formatGenerationTaskStatus(summary.status),
              error: summary.error || ""
            };
          })
        );
      } catch {
        // A transient summary failure is retried without replacing the last good task snapshot.
      } finally {
        if (!disposed) timer = window.setTimeout(() => void poll(), 1500);
      }
    };
    void poll();
    return () => {
      disposed = true;
      generationPollSequenceRef.current += 1;
      window.clearTimeout(timer);
    };
  }, [commitGenerationWorkflows, hasActiveGenerationTasks]);

  useEffect(() => {
    if (!hasActiveImageEditTasks) return;
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      const sequence = ++imageEditPollSequenceRef.current;
      try {
        const summaries = await window.styleExtractor.getImageEditTaskSummaries();
        if (disposed || sequence !== imageEditPollSequenceRef.current) return;
        const currentById = new Map(imageEditTasksRef.current.map((task) => [task.id, task]));
        const changedIds = summaries
          .filter((summary) => {
            const current = currentById.get(summary.id);
            return !current || current.updatedAt !== summary.updatedAt || current.status !== summary.status || current.outputs.length !== summary.outputCount;
          })
          .map((summary) => summary.id);
        const changedTasks = await runWithConcurrency(changedIds, 3, (id) => window.styleExtractor.getImageEditTask(id));
        if (disposed || sequence !== imageEditPollSequenceRef.current) return;
        const changedById = new Map(changedTasks.filter((task): task is ImageEditTask => Boolean(task)).map((task) => [task.id, task]));
        const nextTasks = summaries
          .map((summary) => changedById.get(summary.id) || currentById.get(summary.id))
          .filter((task): task is ImageEditTask => Boolean(task));
        imageEditTasksRef.current = nextTasks;
        setImageEditTasks(nextTasks);
        const summariesById = new Map(summaries.map((summary) => [summary.id, summary]));
        commitImageEditWorkflows((current) =>
          current.map((workflow) => {
            if (!workflow.taskId) return workflow;
            const summary = summariesById.get(workflow.taskId);
            if (!summary) return workflow;
            return {
              ...workflow,
              status: lifecycleStatusFromTask(summary.status),
              stage: imageEditStageFromTask(summary.status),
              statusMessage: formatGenerationTaskStatus(summary.status),
              error: summary.error || ""
            };
          })
        );
      } catch {
        // Keep the previous complete task snapshots and retry after the normal delay.
      } finally {
        if (!disposed) timer = window.setTimeout(() => void poll(), 1500);
      }
    };
    void poll();
    return () => {
      disposed = true;
      imageEditPollSequenceRef.current += 1;
      window.clearTimeout(timer);
    };
  }, [commitImageEditWorkflows, hasActiveImageEditTasks]);

  const reserveImageEditPlaceholders = useCallback(
    (displayNames: string[]): { accepted: ImageEditWorkflow[]; rejectedCount: number; occupied: number } => {
      const candidates = displayNames.map(createImageEditWorkflow);
      const admission = admitBatchInputs(candidates, imageEditWorkflowsRef.current);
      if (admission.accepted.length) {
        const next = [...admission.accepted, ...imageEditWorkflowsRef.current];
        imageEditWorkflowsRef.current = next;
        setImageEditWorkflowsState(next);
        setActiveImageEditWorkflowId(admission.accepted[0].id);
      }
      return { accepted: admission.accepted, rejectedCount: admission.rejected.length, occupied: admission.occupied };
    },
    []
  );

  const populateImageEditWorkflow = useCallback(
    async (
      workflowId: string,
      imageState: ImageState,
      sourceKind: ImageEditSourceKind,
      pointer?: Partial<ImageEditSourceImage["sourcePointer"]>,
      regenerationContext?: ImageEditRegenerationContext
    ) => {
      try {
        assertImageEditSourceLimits(imageState.dataUrl);
        const dimensions = await imageDimensionsFromDataUrl(imageState.dataUrl);
        assertImageEditSourceLimits(imageState.dataUrl, dimensions.width, dimensions.height);
        const sourceImage: ImageEditSourceImage = {
          id: crypto.randomUUID(),
          name: imageState.fileName,
          mimeType: getMimeTypeFromDataUrl(imageState.dataUrl, imageState.mimeType),
          dataUrl: imageState.dataUrl,
          thumbnailDataUrl: imageState.thumbnailDataUrl || (await createThumbnail(imageState.dataUrl)),
          width: dimensions.width,
          height: dimensions.height,
          createdAt: new Date().toISOString(),
          sourcePointer: {
            kind: sourceKind,
            importedAt: new Date().toISOString(),
            ...pointer
          }
        };
        commitImageEditWorkflows((current) =>
          updateWorkflowById(current, workflowId, (workflow) => ({
            ...workflow,
            displayName: sourceImage.name,
            source: sourceImage,
            regenerationContext:
              regenerationContext || {
                basePrompt: "",
                sourceLabel: "手动导入源图",
                importedAt: new Date().toISOString(),
                inputStrategy: "text_only",
                originalReferences: []
              },
            settings: imageEditSettingsForDimensions(dimensions.width, dimensions.height, generationConfigRef.current),
            status: "setup",
            stage: "annotating",
            statusMessage: "待标注",
            error: ""
          }))
        );
        return "";
      } catch (sourceError) {
        const message = sourceError instanceof Error ? sourceError.message : String(sourceError);
        commitImageEditWorkflows((current) =>
          updateWorkflowById(current, workflowId, (workflow) => ({
            ...workflow,
            status: "failed",
            stage: "preparing",
            statusMessage: "读取失败",
            error: message
          }))
        );
        return `${imageState.fileName}：${message}`;
      }
    },
    [commitImageEditWorkflows]
  );

  const loadImageEditSource = useCallback(
    async (
      imageState: ImageState,
      sourceKind: ImageEditSourceKind,
      pointer?: Partial<ImageEditSourceImage["sourcePointer"]>,
      regenerationContext?: ImageEditRegenerationContext
    ): Promise<ImageEditWorkflow | null> => {
      const reservation = reserveImageEditPlaceholders([imageState.fileName]);
      const workflow = reservation.accepted[0];
      if (!workflow) {
        showWorkspaceLimit("image_edit", reservation.occupied);
        return null;
      }
      await populateImageEditWorkflow(workflow.id, imageState, sourceKind, pointer, regenerationContext);
      return imageEditWorkflowsRef.current.find((item) => item.id === workflow.id) || null;
    },
    [populateImageEditWorkflow, reserveImageEditPlaceholders, showWorkspaceLimit]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[], sourceType: "uploaded_image" | "clipboard_image" = "uploaded_image") => {
      const allFiles = Array.from(files);
      if (!allFiles.length) return;
      const inputFiles = allFiles.filter((file) => file.type.startsWith("image/"));
      const invalidFileMessages = allFiles
        .filter((file) => !file.type.startsWith("image/"))
        .map((file) => `${file.name || "未命名文件"}：不是受支持的图片文件。`);
      const candidates = inputFiles.map((file) => createExtractionWorkflow(file.name || "剪贴板图片"));
      const admission = admitBatchInputs(candidates, extractionWorkflowsRef.current);
      if (admission.accepted.length) {
        const next = [...admission.accepted, ...extractionWorkflowsRef.current];
        extractionWorkflowsRef.current = next;
        setExtractionWorkflowsState(next);
        setActiveExtractionWorkflowId(admission.accepted[0].id);
      }
      const acceptedFiles = inputFiles.slice(0, admission.accepted.length);
      const failures = await runWithConcurrency(acceptedFiles, 2, async (file, index) => {
        const workflow = admission.accepted[index];
        try {
          const nextImage = await fileToImageState(file, sourceType);
          commitExtractionWorkflows((current) =>
            updateWorkflowById(current, workflow.id, (item) => ({
              ...item,
              image: nextImage,
              displayName: nextImage.fileName,
              status: "setup",
              stage: "preparing",
              statusMessage: "已载入，待分析",
              error: ""
            }))
          );
          return "";
        } catch (uploadError) {
          const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
          commitExtractionWorkflows((current) =>
            updateWorkflowById(current, workflow.id, (item) => ({
              ...item,
              status: "failed",
              stage: "preparing",
              statusMessage: "读取失败",
              error: message
            }))
          );
          return `${file.name}：${message}`;
        }
      });
      const failureMessages = [...invalidFileMessages, ...failures.filter(Boolean)];
      if (admission.rejected.length || failureMessages.length) {
        showWorkspaceLimit(
          "extraction",
          admission.occupied,
          admission.rejected.length,
          admission.accepted.length,
          failureMessages
        );
      }
      if (admission.accepted.length) setStatus(`已加入 ${admission.accepted.length} 张图片。`);
    },
    [commitExtractionWorkflows, showWorkspaceLimit]
  );

  const handleImageEditSourceFiles = useCallback(
    async (files: FileList | File[], sourceType: "uploaded_image" | "clipboard_image" = "uploaded_image") => {
      const allFiles = Array.from(files);
      if (!allFiles.length) return;
      const inputFiles = allFiles.filter((file) => file.type.startsWith("image/"));
      const invalidFileMessages = allFiles
        .filter((file) => !file.type.startsWith("image/"))
        .map((file) => `${file.name || "未命名文件"}：不是受支持的图片文件。`);
      const reservation = reserveImageEditPlaceholders(inputFiles.map((file) => file.name || "剪贴板图片"));
      const acceptedFiles = inputFiles.slice(0, reservation.accepted.length);
      const failures = await runWithConcurrency(acceptedFiles, 2, async (file, index) => {
        try {
          const imageState = await fileToImageState(file, sourceType);
          return await populateImageEditWorkflow(
            reservation.accepted[index].id,
            imageState,
            sourceType === "clipboard_image" ? "clipboard_image" : "uploaded_image"
          );
        } catch (uploadError) {
          const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
          const workflowId = reservation.accepted[index].id;
          commitImageEditWorkflows((current) =>
            updateWorkflowById(current, workflowId, (workflow) => ({
              ...workflow,
              status: "failed",
              statusMessage: "读取失败",
              error: message
            }))
          );
          return `${file.name}：${message}`;
        }
      });
      const failureMessages = [...invalidFileMessages, ...failures.filter(Boolean)];
      if (reservation.rejectedCount || failureMessages.length) {
        showWorkspaceLimit(
          "image_edit",
          reservation.occupied,
          reservation.rejectedCount,
          reservation.accepted.length,
          failureMessages
        );
      }
      if (reservation.accepted.length) setStatus(`已加入 ${reservation.accepted.length} 个改图流程。`);
    },
    [commitImageEditWorkflows, populateImageEditWorkflow, reserveImageEditPlaceholders, showWorkspaceLimit]
  );

  const handleGenerationReferenceFiles = useCallback(
    async (files: FileList | File[], sourceType: "uploaded_image" | "clipboard_image" = "uploaded_image") => {
      const allFiles = Array.from(files);
      const invalidFileMessages = allFiles
        .filter((file) => !file.type.startsWith("image/"))
        .map((file) => `${file.name || "未命名文件"}：不是受支持的图片文件。`);
      const nextFiles = allFiles.filter((file) => file.type.startsWith("image/")).slice(0, 8);
      if (!nextFiles.length) {
        if (invalidFileMessages.length) {
          showWorkspaceLimit(
            "generation",
            countActiveWorkflows(generationWorkflowsRef.current),
            0,
            0,
            invalidFileMessages
          );
        }
        return;
      }
      let workflow = generationWorkflowsRef.current.find((item) => item.id === activeGenerationWorkflowId) || null;
      if (!workflow || workflow.taskId || workflow.status === "queued" || workflow.status === "running") {
        workflow = reserveGenerationWorkflow(createGenerationWorkflow({ displayName: "参考图生图" }));
      }
      if (!workflow) return;
      const targetWorkflowId = workflow.id;
      const processed = await runWithConcurrency(nextFiles, 2, async (file) => {
        try {
          return {
            image: await imageStateToGenerationReference(await fileToImageState(file, sourceType)),
            error: ""
          };
        } catch (uploadError) {
          const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
          return { image: null, error: `${file.name}：${message}` };
        }
      });
      const nextImages = processed
        .map((result) => result.image)
        .filter((image): image is GenerationReferenceImage => Boolean(image));
      const failureMessages = [...invalidFileMessages, ...processed.map((result) => result.error).filter(Boolean)];
      if (nextImages.length) {
        commitGenerationWorkflows((current) =>
          updateWorkflowById(current, targetWorkflowId, (item) => ({
            ...item,
            referenceImages: [...item.referenceImages, ...nextImages].slice(0, 8),
            referencesEditedByUser: true,
            revision: item.revision + 1,
            statusMessage: "待配置",
            error: ""
          }))
        );
        setStatus(`已加入 ${nextImages.length} 张生图参考图。`);
      }
      if (failureMessages.length) {
        commitGenerationWorkflows((current) =>
          updateWorkflowById(current, targetWorkflowId, (item) => ({ ...item, error: failureMessages.join("\n") }))
        );
        showWorkspaceLimit(
          "generation",
          countActiveWorkflows(generationWorkflowsRef.current),
          0,
          0,
          failureMessages
        );
      }
    },
    [activeGenerationWorkflowId, commitGenerationWorkflows, reserveGenerationWorkflow, showWorkspaceLimit]
  );

  const handleSubjectFiles = useCallback(
    async (files: FileList | File[]) => {
      const file = Array.from(files)[0];
      const workflow = extractionWorkflowsRef.current.find((item) => item.id === activeExtractionWorkflowId);
      if (!file || !workflow || workflow.operationId) return;
      const workflowId = workflow.id;
      const revision = workflow.revision + 1;
      const activeFuseMode = resolveFuseMode(workflow.analysis, workflow.selectedFuseMode);
      commitExtractionWorkflows((current) =>
        updateWorkflowById(current, workflowId, (item) => ({ ...item, revision, fuseError: "" }))
      );
      try {
        const nextImage = await fileToImageState(file);
        commitExtractionWorkflows((current) =>
          updateWorkflowById(current, workflowId, (item) =>
            item.revision === revision
              ? {
                  ...item,
                  subjectImage: nextImage,
                  fusedPrompt: "",
                  fusedPromptJson: null,
                  fuseError: ""
                }
              : item
          )
        );
        setFuseCopied("");
        setStatus(activeFuseMode === "information_layout" ? "产品信息图已载入。" : "主体参考图已载入。");
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
        commitExtractionWorkflows((current) =>
          updateWorkflowById(current, workflowId, (item) =>
            item.revision === revision ? { ...item, fuseError: message } : item
          )
        );
      }
    },
    [activeExtractionWorkflowId, commitExtractionWorkflows]
  );

  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((entry) => entry.type.startsWith("image/"))
        .map((entry) => entry.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (!files.length) return;
      event.preventDefault();
      if (activeView === "generate") {
        await handleGenerationReferenceFiles(files, "clipboard_image");
        return;
      }
      if (activeView === "edit") {
        await handleImageEditSourceFiles(files, "clipboard_image");
        return;
      }
      if (showFuseModal) {
        await handleSubjectFiles(files);
        return;
      }
      await handleFiles(files, "clipboard_image");
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [activeView, handleFiles, handleGenerationReferenceFiles, handleImageEditSourceFiles, handleSubjectFiles, showFuseModal]);

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
    const saved = await window.styleExtractor.saveGenerationConfig(generationDraft);
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

  const createGenerationFromExtraction = async (
    sourceWorkflow: ExtractionWorkflow,
    option: GenerationPromptOption
  ): Promise<GenerationWorkflow> => {
    const sourceHistoryItem = history.find((item) => item.id === sourceWorkflow.historyItemId);
    const sourceImage = historyItemToPromptSourceImage(sourceHistoryItem, sourceWorkflow.image);
    const promptSource: GenerationPromptSource = {
      kind: option.kind,
      label: option.label,
      historyItemId: sourceWorkflow.historyItemId,
      sourceExtractionWorkflowId: sourceWorkflow.id,
      sourceImageDataUrl: sourceImage.dataUrl,
      sourceThumbnailDataUrl: sourceImage.thumbnailDataUrl,
      sourceFileName: sourceImage.fileName,
      importedAt: new Date().toISOString()
    };
    const importedPrompt =
      option.kind === "text_to_image" && sourceWorkflow.analysis
        ? buildDirectTextToImagePrompt(sourceWorkflow.analysis, sourceWorkflow.editedTextMarkdown)
        : option.value;
    const referenceImages: GenerationReferenceImage[] = [];
    if (
      (option.kind === "fused_prompt" || option.kind === "fused_copy_ready") &&
      resolveFuseMode(sourceWorkflow.analysis, sourceWorkflow.selectedFuseMode) === "subject_reference" &&
      sourceWorkflow.subjectImage
    ) {
      const modelDataUrl = await createModelImage(sourceWorkflow.subjectImage.dataUrl);
      referenceImages.push({
        id: crypto.randomUUID(),
        name: `主体参考图 · ${sourceWorkflow.subjectImage.fileName}`,
        mimeType: getMimeTypeFromDataUrl(modelDataUrl, sourceWorkflow.subjectImage.mimeType),
        dataUrl: modelDataUrl,
        thumbnailDataUrl: sourceWorkflow.subjectImage.thumbnailDataUrl || (await createThumbnail(modelDataUrl)),
        createdAt: new Date().toISOString()
      });
    }
    return createGenerationWorkflow({
      prompt: importedPrompt,
      promptSource,
      referenceImages,
      sourceWorkflowRevision: sourceWorkflow.revision,
      displayName: sourceImage.fileName || option.label
    });
  };

  const syncGenerationDraftFromExtraction = async (
    sourceWorkflow: ExtractionWorkflow,
    option: GenerationPromptOption,
    {
      activate = true,
      createIfMissing = true,
      forceSourceRefresh = true
    }: { activate?: boolean; createIfMissing?: boolean; forceSourceRefresh?: boolean } = {}
  ): Promise<GenerationWorkflow | null> => {
    const sourceLineageKey = extractionWorkflowLineageKey(sourceWorkflow);
    const sequence = (generationSourceSyncSequenceRef.current.get(sourceLineageKey) || 0) + 1;
    generationSourceSyncSequenceRef.current.set(sourceLineageKey, sequence);
    const preparedWorkflow = await createGenerationFromExtraction(sourceWorkflow, option);
    if (generationSourceSyncSequenceRef.current.get(sourceLineageKey) !== sequence) return null;

    const latestSourceWorkflow = extractionWorkflowsRef.current.find(
      (workflow) => workflow.id === sourceWorkflow.id
    );
    if (!latestSourceWorkflow?.analysis) return null;
    if (latestSourceWorkflow.revision !== sourceWorkflow.revision) {
      const latestOption = preferredGenerationPromptOption(latestSourceWorkflow, option.kind);
      return latestOption
        ? syncGenerationDraftFromExtraction(latestSourceWorkflow, latestOption, {
            activate,
            createIfMissing,
            forceSourceRefresh
          })
        : null;
    }

    const sameSourceDrafts = generationWorkflowsRef.current.filter(
      (workflow) =>
        !workflow.taskId &&
        generationPromptSourceLineageKey(workflow.promptSource) === sourceLineageKey
    );
    const refreshableDrafts = sameSourceDrafts.filter(
      (workflow) =>
        !workflow.operationId &&
        workflow.stage !== "submitting" &&
        workflow.status !== "queued" &&
        workflow.status !== "running"
    );
    const targetWorkflow =
      refreshableDrafts.find((workflow) => workflow.id === activeGenerationWorkflowId) ||
      refreshableDrafts[0];

    if (targetWorkflow) {
      const duplicateIds = new Set(
        refreshableDrafts
          .filter(
            (workflow) =>
              workflow.id !== targetWorkflow.id &&
              !workflow.promptEditedByUser &&
              !workflow.referencesEditedByUser
          )
          .map((workflow) => workflow.id)
      );
      const remainingActiveCount = countActiveWorkflows(
        generationWorkflowsRef.current.filter(
          (workflow) => workflow.id !== targetWorkflow.id && !duplicateIds.has(workflow.id)
        )
      );
      const targetIsTerminal = isWorkspaceStatusTerminal(targetWorkflow.status);
      const reactivateTarget = forceSourceRefresh || !targetIsTerminal;
      if (reactivateTarget && targetIsTerminal && remainingActiveCount >= WORKSPACE_CONCURRENCY_LIMIT) {
        showWorkspaceLimit("generation", remainingActiveCount);
        return null;
      }
      const preservePrompt = !forceSourceRefresh && Boolean(targetWorkflow.promptEditedByUser);
      const preserveReferences = !forceSourceRefresh && Boolean(targetWorkflow.referencesEditedByUser);
      const preservedManualEdits = preservePrompt || preserveReferences;
      const refreshedWorkflow: GenerationWorkflow = {
        ...targetWorkflow,
        revision: targetWorkflow.revision + 1,
        status: reactivateTarget ? "setup" : targetWorkflow.status,
        stage: reactivateTarget ? "draft" : targetWorkflow.stage,
        operationId: undefined,
        displayName: preparedWorkflow.displayName,
        prompt: preservePrompt ? targetWorkflow.prompt : preparedWorkflow.prompt,
        promptSource: preservePrompt ? targetWorkflow.promptSource : preparedWorkflow.promptSource,
        referenceImages: preserveReferences
          ? targetWorkflow.referenceImages
          : preparedWorkflow.referenceImages,
        sourceWorkflowRevision: sourceWorkflow.revision,
        promptEditedByUser: preservePrompt,
        referencesEditedByUser: preserveReferences,
        statusMessage: targetIsTerminal && !reactivateTarget
          ? "解析结果已刷新，等待重试"
          : preservedManualEdits
            ? "解析结果有更新，已保留生图手动修改"
            : "已同步最新解析结果",
        error: reactivateTarget ? "" : targetWorkflow.error,
        readOnly: false
      };
      commitGenerationWorkflows((current) =>
        current
          .filter((workflow) => !duplicateIds.has(workflow.id))
          .map((workflow) => (workflow.id === targetWorkflow.id ? refreshedWorkflow : workflow))
      );
      if (activate) setActiveGenerationWorkflowId(refreshedWorkflow.id);
      return refreshedWorkflow;
    }

    const lockedDraft = sameSourceDrafts[0];
    if (lockedDraft) {
      if (activate) {
        setActiveGenerationWorkflowId(lockedDraft.id);
        setActiveView("generate");
        setStatus("对应生图流程正在提交，本次没有创建重复流程。");
      }
      return null;
    }
    if (!createIfMissing) return null;
    return reserveGenerationWorkflow(preparedWorkflow);
  };

  const refreshGenerationDraftsFromExtractions = async (): Promise<number> => {
    const draftByLineage = new Map<string, GenerationWorkflow>();
    for (const workflow of generationWorkflowsRef.current) {
      if (workflow.taskId) continue;
      const lineageKey = generationPromptSourceLineageKey(workflow.promptSource);
      if (!lineageKey) continue;
      const current = draftByLineage.get(lineageKey);
      if (!current || workflow.id === activeGenerationWorkflowId) {
        draftByLineage.set(lineageKey, workflow);
      }
    }

    const refreshTargets = Array.from(draftByLineage.entries()).flatMap(([lineageKey, draft]) => {
      const sourceWorkflow =
        extractionWorkflowsRef.current.find(
          (workflow) => workflow.id === draft.promptSource?.sourceExtractionWorkflowId
        ) ||
        extractionWorkflowsRef.current.find(
          (workflow) => extractionWorkflowLineageKey(workflow) === lineageKey
        );
      if (!sourceWorkflow?.analysis) return [];
      const option = preferredGenerationPromptOption(sourceWorkflow, draft.promptSource?.kind);
      if (!option) return [];
      const hasRemovableDuplicate = generationWorkflowsRef.current.some(
        (workflow) =>
          workflow.id !== draft.id &&
          !workflow.taskId &&
          !workflow.promptEditedByUser &&
          !workflow.referencesEditedByUser &&
          generationPromptSourceLineageKey(workflow.promptSource) === lineageKey
      );
      const needsRefresh =
        draft.sourceWorkflowRevision !== sourceWorkflow.revision ||
        (!draft.promptEditedByUser && draft.promptSource?.kind !== option.kind) ||
        hasRemovableDuplicate;
      return needsRefresh ? [{ sourceWorkflow, option }] : [];
    });

    const refreshed = await runWithConcurrency(refreshTargets, 2, async ({ sourceWorkflow, option }) =>
      syncGenerationDraftFromExtraction(sourceWorkflow, option, {
        activate: false,
        createIfMissing: false,
        forceSourceRefresh: false
      })
    );
    return refreshed.filter(Boolean).length;
  };

  const openGenerationWorkspace = async () => {
    try {
      const refreshedCount = await refreshGenerationDraftsFromExtractions();
      if (refreshedCount > 0) {
        setStatus(`已自动刷新 ${refreshedCount} 个生图流程的最新解析结果。`);
      }
    } catch (syncError) {
      setStatus(syncError instanceof Error ? `生图流程自动刷新失败：${syncError.message}` : String(syncError));
    } finally {
      setActiveView("generate");
    }
  };

  const importPromptToGeneration = async (option: GenerationPromptOption) => {
    const sourceWorkflow = extractionWorkflowsRef.current.find(
      (workflow) => workflow.id === activeExtractionWorkflowId
    );
    if (!sourceWorkflow?.analysis && !sourceWorkflow?.fusedPrompt) {
      setStatus("请先完成提示词提取或融合提示词生成。");
      return;
    }
    const workflow = await syncGenerationDraftFromExtraction(sourceWorkflow, option);
    if (!workflow) return;
    setActiveView("generate");
    setStatus(
      option.kind === "text_to_image"
        ? "已导入完整文生图提示词，参考图已清空。"
        : `已导入${option.label}到生图工作台。`
    );
  };

  const openPendingGenerationHandoff = async (sourceWorkflowId: string) => {
    if (generationHandoffsInFlightRef.current.has(sourceWorkflowId)) return;
    const sourceWorkflow = extractionWorkflowsRef.current.find(
      (workflow) => workflow.id === sourceWorkflowId
    );
    if (!sourceWorkflow?.analysis) return;

    generationHandoffsInFlightRef.current.add(sourceWorkflowId);
    try {
      const option: GenerationPromptOption = sourceWorkflow.fusedPrompt.trim()
        ? {
            kind: "fused_prompt",
            label: "最终融合提示词",
            value: sourceWorkflow.fusedPrompt
          }
        : {
            kind: "text_to_image",
            label: "完整文生图提示词",
            value: buildDirectTextToImagePrompt(
              sourceWorkflow.analysis,
              sourceWorkflow.editedTextMarkdown
            )
          };
      const workflow = await syncGenerationDraftFromExtraction(sourceWorkflow, option);
      if (!workflow) return;
      setActiveView("generate");
      setStatus(
        option.kind === "text_to_image"
          ? "已导入完整文生图提示词，参考图已清空。"
          : "已导入最终融合提示词到生图工作台。"
      );
    } finally {
      generationHandoffsInFlightRef.current.delete(sourceWorkflowId);
    }
  };

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
    const targetWorkflow = generationWorkflowsRef.current.find((workflow) =>
      workflow.referenceImages.some((item) => item.id === reference.id)
    );
    if (!targetWorkflow) return;
    const modelDataUrl = await createModelImage(editedDataUrl);
    const nextReference: GenerationReferenceImage = {
      ...reference,
      name: `${reference.name} · 已编辑`,
      mimeType: getMimeTypeFromDataUrl(modelDataUrl),
      dataUrl: modelDataUrl,
      thumbnailDataUrl: await createThumbnail(modelDataUrl),
      createdAt: new Date().toISOString()
    };
    commitGenerationWorkflows((current) =>
      updateWorkflowById(current, targetWorkflow.id, (workflow) => ({
        ...workflow,
        referenceImages: workflow.referenceImages.map((item) =>
          item.id === reference.id ? nextReference : item
        ),
        referencesEditedByUser: true,
        revision: workflow.revision + 1,
        error: ""
      }))
    );
    setEditingGenerationReferenceId("");
    setStatus("已保存编辑后的生图参考图。");
  };

  const composeGenerationReferences = async () => {
    const workflow = generationWorkflowsRef.current.find((item) => item.id === activeGenerationWorkflowId);
    if (!workflow) return;
    if (workflow.referenceImages.length < 2) {
      commitGenerationWorkflows((current) =>
        updateWorkflowById(current, workflow.id, (item) => ({
          ...item,
          error: "至少需要两张参考图才能合成为一张。"
        }))
      );
      return;
    }
    const revision = workflow.revision;
    try {
      commitGenerationWorkflows((current) =>
        updateWorkflowById(current, workflow.id, (item) => ({ ...item, error: "" }))
      );
      const composedDataUrl = await composeReferenceImages(workflow.referenceImages);
      const modelDataUrl = await createModelImage(composedDataUrl);
      const reference: GenerationReferenceImage = {
        id: crypto.randomUUID(),
        name: `合成参考图 · ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`,
        mimeType: getMimeTypeFromDataUrl(modelDataUrl),
        dataUrl: modelDataUrl,
        thumbnailDataUrl: await createThumbnail(modelDataUrl),
        createdAt: new Date().toISOString()
      };
      if (generationWorkflowsRef.current.find((item) => item.id === workflow.id)?.revision !== revision) return;
      commitGenerationWorkflows((current) =>
        updateWorkflowById(current, workflow.id, (item) =>
          item.revision === revision
            ? {
                ...item,
                referenceImages: [reference, ...item.referenceImages].slice(0, 8),
                referencesEditedByUser: true,
                revision: item.revision + 1,
                error: ""
              }
            : item
        )
      );
      setStatus("已把多张参考图合成为一张。");
    } catch (composeError) {
      const message = composeError instanceof Error ? composeError.message : String(composeError);
      commitGenerationWorkflows((current) =>
        updateWorkflowById(current, workflow.id, (item) =>
          item.revision === revision ? { ...item, error: message } : item
        )
      );
    }
  };

  const runGenerationRequest = async (
    workflowId: string,
    request: GenerationCreateRequest,
    submissionToken?: WorkflowOperationToken
  ) => {
    const workflow = generationWorkflowsRef.current.find((item) => item.id === workflowId);
    if (!workflow) return;
    const token: WorkflowOperationToken =
      submissionToken || {
        workflowId,
        operationId: crypto.randomUUID(),
        revision: workflow.revision
      };
    if (submissionToken && !isWorkflowOperationCurrent(workflow, token)) return;
    setEditingGenerationReferenceId("");
    commitGenerationWorkflows((current) =>
      submissionToken
        ? updateWorkflowForOperation(current, token, (item) => ({
            ...item,
            status: "running",
            stage: "submitting",
            statusMessage: "正在提交...",
            error: ""
          }))
        : updateWorkflowById(current, workflowId, (item) => ({
            ...item,
            operationId: token.operationId,
            status: "running",
            stage: "submitting",
            statusMessage: "正在提交...",
            error: ""
          }))
    );
    const taskEpoch = generationTaskEpochRef.current;
    try {
      const task = await window.styleExtractor.createGenerationTask({ ...request, clientWorkflowId: workflowId });
      if (
        generationTaskEpochRef.current !== taskEpoch ||
        !isWorkflowOperationCurrent(
          generationWorkflowsRef.current.find((item) => item.id === token.workflowId),
          token
        )
      ) return;
      const nextTasks = [task, ...generationTasksRef.current.filter((item) => item.id !== task.id)];
      generationPollSequenceRef.current += 1;
      generationTasksRef.current = nextTasks;
      setGenerationTasks(nextTasks);
      setSelectedGenerationTaskId(task.id);
      commitGenerationWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          operationId: undefined,
          taskId: task.id,
          status: lifecycleStatusFromTask(task.status),
          stage: generationStageFromTask(task.status),
          statusMessage: formatGenerationTaskStatus(task.status),
          error: task.error || ""
        }))
      );
      setStatus(task.status === "queued" ? "生图任务已加入队列。" : "生图任务已提交。");
    } catch (generateError) {
      if (generationTaskEpochRef.current !== taskEpoch) return;
      const message = generateError instanceof Error ? generateError.message : String(generateError);
      commitGenerationWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          operationId: undefined,
          status: "failed",
          stage: "finished",
          statusMessage: "提交失败",
          error: message
        }))
      );
      if (message.includes("最多同时") || message.includes("WORKSPACE_CAPACITY_REACHED")) {
        showWorkspaceLimit("generation", WORKSPACE_CONCURRENCY_LIMIT);
      }
    }
  };

  const resolveImageEditAnnotations = async () => {
    const workflow = imageEditWorkflowsRef.current.find((item) => item.id === activeImageEditWorkflowId);
    if (!workflow?.source || !workflow.regenerationContext?.basePrompt.trim()) {
      setImageEditError("请先导入源图并填写重生成基础提示词。");
      return;
    }
    if (workflow.operationId || workflow.taskId || workflow.status === "queued" || workflow.status === "running") return;
    if (isWorkspaceStatusTerminal(workflow.status)) {
      const occupied = countActiveWorkflows(imageEditWorkflowsRef.current);
      if (occupied >= WORKSPACE_CONCURRENCY_LIMIT) {
        showWorkspaceLimit("image_edit", occupied);
        return;
      }
    }
    const token: WorkflowOperationToken = {
      workflowId: workflow.id,
      operationId: crypto.randomUUID(),
      revision: workflow.revision
    };
    commitImageEditWorkflows((current) =>
      updateWorkflowById(current, workflow.id, (item) => ({
        ...item,
        operationId: token.operationId,
        status: "running",
        stage: "resolving",
        statusMessage: "修改意图解析中",
        error: ""
      }))
    );
    try {
      const annotationItems = buildImageEditAnnotationItems(workflow.annotations);
      const annotationImageDataUrl = await renderImageEditAnnotationImage(
        workflow.source.dataUrl,
        workflow.annotations
      );
      const [sourceImageDataUrl, modelAnnotationImageDataUrl] = await Promise.all([
        createImageEditAnnotationModelImage(workflow.source.dataUrl),
        createImageEditAnnotationModelImage(annotationImageDataUrl)
      ]);
      const response = await window.styleExtractor.resolveImageEditAnnotations({
        workflowId: token.workflowId,
        operationId: token.operationId,
        revision: token.revision,
        sourceImageDataUrl: workflow.source.dataUrl,
        sourceImageModelDataUrl: sourceImageDataUrl,
        annotationImageDataUrl: modelAnnotationImageDataUrl,
        annotationItems,
        instruction: workflow.instruction,
        basePrompt: workflow.regenerationContext.basePrompt
      });
      if (
        response.workflowId !== token.workflowId ||
        response.operationId !== token.operationId ||
        response.revision !== token.revision
      ) return;
      commitImageEditWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          operationId: undefined,
          status: "setup",
          stage: "confirming",
          annotationResolution: response.resolution,
          statusMessage: response.resolution.source === "manual_fallback" ? "手动清单待确认" : "修改清单待确认",
          error: ""
        }))
      );
    } catch (resolveError) {
      const message = resolveError instanceof Error ? resolveError.message : String(resolveError);
      commitImageEditWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          operationId: undefined,
          status: "failed",
          stage: "resolving",
          statusMessage: "解析失败",
          error: message
        }))
      );
    }
  };

  const cancelImageEditAnnotationResolution = async () => {
    const workflow = imageEditWorkflowsRef.current.find((item) => item.id === activeImageEditWorkflowId);
    if (!workflow?.operationId || workflow.stage !== "resolving") return;
    const operationId = workflow.operationId;
    await window.styleExtractor.cancelImageEditAnnotationResolution(operationId);
    commitImageEditWorkflows((current) =>
      updateWorkflowById(current, workflow.id, (item) =>
        item.operationId === operationId
          ? { ...item, operationId: undefined, status: "canceled", statusMessage: "已取消", error: "" }
          : item
      )
    );
  };

  const createImageEditTask = async () => {
    const workflow = imageEditWorkflowsRef.current.find((item) => item.id === activeImageEditWorkflowId);
    if (!workflow?.source) {
      setImageEditError("请先导入一张改图源图。");
      return;
    }
    if (workflow.operationId || workflow.taskId || workflow.status === "queued" || workflow.status === "running") return;
    const annotationItems = buildImageEditAnnotationItems(workflow.annotations);
    const hasLocalEditNotes = annotationItems.some((item) => item.note !== "按总体改图说明处理此处。");
    if (!workflow.instruction.trim() && !hasLocalEditNotes) {
      setImageEditError("请填写总体改图说明，或至少为一处标注填写修改要求。");
      return;
    }
    if (!workflow.annotations.length) {
      setImageEditError("至少需要 1 个带明确要求的编号标注。");
      return;
    }
    if (!workflow.regenerationContext?.basePrompt.trim()) {
      setImageEditError("缺少第一次生图的基础提示词；手动导入时请填写完整基础提示词。");
      return;
    }
    if (workflow.annotationResolution?.status !== "confirmed") {
      setImageEditError("请先解析并确认修改清单，再生成修订版。");
      return;
    }
    if (isWorkspaceStatusTerminal(workflow.status)) {
      const occupied = countActiveWorkflows(imageEditWorkflowsRef.current);
      if (occupied >= WORKSPACE_CONCURRENCY_LIMIT) {
        showWorkspaceLimit("image_edit", occupied);
        return;
      }
      commitImageEditWorkflows((current) =>
        updateWorkflowById(current, workflow.id, (item) => ({
          ...item,
          status: "setup",
          stage: "confirming",
          statusMessage: "准备提交",
          error: ""
        }))
      );
    }
    const token: WorkflowOperationToken = {
      workflowId: workflow.id,
      operationId: crypto.randomUUID(),
      revision: workflow.revision
    };
    commitImageEditWorkflows((current) =>
      updateWorkflowById(current, workflow.id, (item) => ({
        ...item,
        operationId: token.operationId,
        status: "queued",
        stage: "queued",
        statusMessage: "正在提交...",
        error: ""
      }))
    );
    let activeGenerationConfig = generationConfigRef.current;
    if (!hasGenerationBackend(activeGenerationConfig)) {
      activeGenerationConfig = await openGenerationConfig();
      if (!hasGenerationBackend(activeGenerationConfig)) {
        commitImageEditWorkflows((current) =>
          updateWorkflowForOperation(current, token, (item) => ({
            ...item,
            operationId: undefined,
            status: "failed",
            stage: "finished",
            statusMessage: "配置不可用",
            error: generationBackendError(activeGenerationConfig)
          }))
        );
        return;
      }
    }
    const taskEpoch = imageEditTaskEpochRef.current;
    try {
      const sourceDataUrl = workflow.source.dataUrl;
      const sourceDimensions = await imageDimensionsFromDataUrl(sourceDataUrl);
      assertImageEditSourceLimits(sourceDataUrl, sourceDimensions.width, sourceDimensions.height);
      const annotationDataUrl = await renderImageEditAnnotationImage(sourceDataUrl, workflow.annotations);
      const annotationImage: ImageEditAnnotationImage = {
        mimeType: "image/png",
        dataUrl: annotationDataUrl,
        thumbnailDataUrl: await createThumbnail(annotationDataUrl),
        itemCount: workflow.annotations.length,
        createdAt: new Date().toISOString()
      };
      const normalizedSize = normalizeGenerationSizeSettings(workflow.settings);
      const request: ImageEditCreateRequest = {
        clientWorkflowId: workflow.id,
        sourceImage: workflow.source,
        annotationImage,
        annotationItems,
        annotationResolution: workflow.annotationResolution || undefined,
        regenerationContext:
          workflow.regenerationContext?.basePrompt.trim() ? workflow.regenerationContext : undefined,
        fidelityMode: "origin_regenerate",
        instruction: workflow.instruction,
        settings: {
          ...workflow.settings,
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
      };
      const task = await window.styleExtractor.createImageEditTask(request);
      if (
        imageEditTaskEpochRef.current !== taskEpoch ||
        !isWorkflowOperationCurrent(
          imageEditWorkflowsRef.current.find((item) => item.id === token.workflowId),
          token
        )
      ) return;
      const nextTasks = [task, ...imageEditTasksRef.current.filter((item) => item.id !== task.id)];
      imageEditPollSequenceRef.current += 1;
      imageEditTasksRef.current = nextTasks;
      setImageEditTasks(nextTasks);
      setSelectedImageEditTaskId(task.id);
      commitImageEditWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          operationId: undefined,
          taskId: task.id,
          status: lifecycleStatusFromTask(task.status),
          stage: imageEditStageFromTask(task.status),
          statusMessage: formatGenerationTaskStatus(task.status),
          error: task.error || ""
        }))
      );
      setStatus("改图任务已加入队列。");
    } catch (editError) {
      if (imageEditTaskEpochRef.current !== taskEpoch) return;
      const message = editError instanceof Error ? editError.message : String(editError);
      commitImageEditWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          operationId: undefined,
          status: "failed",
          stage: "finished",
          statusMessage: "提交失败",
          error: message
        }))
      );
      if (message.includes("最多同时") || message.includes("WORKSPACE_CAPACITY_REACHED")) {
        showWorkspaceLimit("image_edit", WORKSPACE_CONCURRENCY_LIMIT);
      }
    }
  };

  const createGeneration = async () => {
    const workflow = generationWorkflowsRef.current.find((item) => item.id === activeGenerationWorkflowId);
    if (!workflow?.prompt.trim()) {
      setGenerationError("请先导入提示词或直接填写完整的生图提示词。");
      return;
    }
    if (workflow.operationId || workflow.taskId || workflow.status === "queued" || workflow.status === "running") return;
    if (isWorkspaceStatusTerminal(workflow.status)) {
      const occupied = countActiveWorkflows(generationWorkflowsRef.current);
      if (occupied >= WORKSPACE_CONCURRENCY_LIMIT) {
        showWorkspaceLimit("generation", occupied);
        return;
      }
      commitGenerationWorkflows((current) =>
        updateWorkflowById(current, workflow.id, (item) => ({
          ...item,
          status: "setup",
          stage: "draft",
          statusMessage: "准备提交",
          error: ""
        }))
      );
    }
    const promptSource: GenerationPromptSource =
      workflow.promptSource || {
        kind: "manual",
        label: "手动输入提示词",
        importedAt: new Date().toISOString()
      };
    if (!workflow.promptSource) {
      commitGenerationWorkflows((current) =>
        updateWorkflowById(current, workflow.id, (item) => ({ ...item, promptSource }))
      );
    }
    const token: WorkflowOperationToken = {
      workflowId: workflow.id,
      operationId: crypto.randomUUID(),
      revision: workflow.revision
    };
    commitGenerationWorkflows((current) =>
      updateWorkflowById(current, workflow.id, (item) => ({
        ...item,
        operationId: token.operationId,
        status: "running",
        stage: "submitting",
        statusMessage: "正在提交...",
        error: ""
      }))
    );
    let activeGenerationConfig = generationConfigRef.current;
    if (!hasGenerationBackend(activeGenerationConfig)) {
      activeGenerationConfig = await openGenerationConfig();
      if (!hasGenerationBackend(activeGenerationConfig)) {
        commitGenerationWorkflows((current) =>
          updateWorkflowForOperation(current, token, (item) => ({
            ...item,
            operationId: undefined,
            status: "failed",
            stage: "finished",
            statusMessage: "配置不可用",
            error: generationBackendError(activeGenerationConfig)
          }))
        );
        return;
      }
    }
    const normalizedSize = normalizeGenerationSizeSettings(workflow.settings);

    await runGenerationRequest(workflow.id, {
      clientWorkflowId: workflow.id,
      prompt: workflow.prompt,
      promptSource,
      referenceImages: workflow.referenceImages.map((reference) => ({ ...reference })),
      settings: {
        ...workflow.settings,
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
    }, token);
  };

  const retryGenerationTask = async (task: GenerationTask) => {
    if (generationRetrySourceIdsRef.current.has(task.id)) return;
    generationRetrySourceIdsRef.current.add(task.id);
    try {
      const workflow = reserveGenerationWorkflow(
        createGenerationWorkflow({
          prompt: task.prompt,
          promptSource: { ...task.promptSource, importedAt: new Date().toISOString() },
          referenceImages: task.referenceImages.map((reference) => ({ ...reference })),
          settings: { ...task.settings },
          displayName: task.promptSource.sourceFileName || task.promptSource.label
        })
      );
      if (!workflow) return;
      const token: WorkflowOperationToken = {
        workflowId: workflow.id,
        operationId: crypto.randomUUID(),
        revision: workflow.revision
      };
      commitGenerationWorkflows((current) =>
        updateWorkflowById(current, workflow.id, (item) => ({
          ...item,
          operationId: token.operationId,
          status: "running",
          stage: "submitting",
          statusMessage: "正在提交...",
          error: ""
        }))
      );
      let activeGenerationConfig = generationConfigRef.current;
      if (!hasGenerationBackend(activeGenerationConfig)) {
        activeGenerationConfig = await openGenerationConfig();
        if (!hasGenerationBackend(activeGenerationConfig)) {
          commitGenerationWorkflows((current) =>
            updateWorkflowForOperation(current, token, (item) => ({
              ...item,
              operationId: undefined,
              status: "failed",
              stage: "finished",
              statusMessage: "配置不可用",
              error: generationBackendError(activeGenerationConfig)
            }))
          );
          return;
        }
      }
      const normalizedSize = normalizeGenerationSizeSettings(task.settings);
      await runGenerationRequest(workflow.id, {
        clientWorkflowId: workflow.id,
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
      }, token);
    } finally {
      generationRetrySourceIdsRef.current.delete(task.id);
    }
  };

  const cancelGenerationTask = async (id: string) => {
    const taskEpoch = generationTaskEpochRef.current;
    const canceledTask = await window.styleExtractor.cancelGenerationTask(id);
    if (generationTaskEpochRef.current !== taskEpoch || deletedGenerationTaskIdsRef.current.has(id)) return;
    if (canceledTask) {
      const nextTasks = [canceledTask, ...generationTasksRef.current.filter((task) => task.id !== id)];
      generationPollSequenceRef.current += 1;
      generationTasksRef.current = nextTasks;
      setGenerationTasks(nextTasks);
      commitGenerationWorkflows((current) =>
        current.map((workflow) =>
          workflow.taskId === id
            ? { ...workflow, status: "canceled", stage: "finished", statusMessage: "已取消", error: "" }
            : workflow
        )
      );
    }
    if (canceledTask?.status === "canceled") {
      setStatus("已取消生图任务。");
    }
  };

  const cancelImageEditTask = async (id: string) => {
    const taskEpoch = imageEditTaskEpochRef.current;
    const canceledTask = await window.styleExtractor.cancelImageEditTask(id);
    if (imageEditTaskEpochRef.current !== taskEpoch || deletedImageEditTaskIdsRef.current.has(id)) return;
    if (canceledTask) {
      const nextTasks = [canceledTask, ...imageEditTasksRef.current.filter((task) => task.id !== id)];
      imageEditPollSequenceRef.current += 1;
      imageEditTasksRef.current = nextTasks;
      setImageEditTasks(nextTasks);
      commitImageEditWorkflows((current) =>
        current.map((workflow) =>
          workflow.taskId === id
            ? { ...workflow, status: "canceled", stage: "finished", statusMessage: "已取消", error: "" }
            : workflow
        )
      );
    }
    if (canceledTask?.status === "canceled") setStatus("已取消改图任务。");
  };

  const retryImageEditTask = async (task: ImageEditTask) => {
    const workflowId = task.clientWorkflowId || `task:${task.id}`;
    let workflow = imageEditWorkflowsRef.current.find((item) => item.id === workflowId);
    if (workflow && !isWorkspaceStatusTerminal(workflow.status)) return;
    const occupied = countActiveWorkflows(imageEditWorkflowsRef.current);
    if (occupied >= WORKSPACE_CONCURRENCY_LIMIT) {
      showWorkspaceLimit("image_edit", occupied);
      return;
    }
    const baseWorkflow = workflow || imageEditWorkflowFromTask(task);
    const token: WorkflowOperationToken = {
      workflowId: baseWorkflow.id,
      operationId: crypto.randomUUID(),
      revision: baseWorkflow.revision
    };
    if (workflow) {
      commitImageEditWorkflows((current) =>
        updateWorkflowById(current, workflowId, (item) => ({
          ...item,
          operationId: token.operationId,
          status: "queued",
          stage: "queued",
          statusMessage: "重试提交中",
          error: ""
        }))
      );
    } else {
      workflow = {
        ...baseWorkflow,
        operationId: token.operationId,
        status: "queued",
        stage: "queued",
        statusMessage: "重试提交中",
        error: ""
      };
      const next = [workflow, ...imageEditWorkflowsRef.current];
      imageEditWorkflowsRef.current = next;
      setImageEditWorkflowsState(next);
    }
    setActiveImageEditWorkflowId(workflowId);
    const taskEpoch = imageEditTaskEpochRef.current;
    try {
      const retried = await window.styleExtractor.retryImageEditTask(task.id);
      if (
        imageEditTaskEpochRef.current !== taskEpoch ||
        !isWorkflowOperationCurrent(
          imageEditWorkflowsRef.current.find((item) => item.id === token.workflowId),
          token
        )
      ) return;
      const nextTasks = [retried, ...imageEditTasksRef.current.filter((item) => item.id !== retried.id)];
      imageEditPollSequenceRef.current += 1;
      imageEditTasksRef.current = nextTasks;
      setImageEditTasks(nextTasks);
      setSelectedImageEditTaskId(retried.id);
      commitImageEditWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          operationId: undefined,
          taskId: retried.id,
          status: lifecycleStatusFromTask(retried.status),
          stage: imageEditStageFromTask(retried.status),
          statusMessage: formatGenerationTaskStatus(retried.status),
          error: retried.error || ""
        }))
      );
      setStatus("已重新提交改图任务。");
    } catch (retryError) {
      if (imageEditTaskEpochRef.current !== taskEpoch) return;
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      commitImageEditWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          operationId: undefined,
          status: "failed",
          stage: "finished",
          statusMessage: "重试失败",
          error: message
        }))
      );
      if (message.includes("最多同时") || message.includes("WORKSPACE_CAPACITY_REACHED")) {
        showWorkspaceLimit("image_edit", WORKSPACE_CONCURRENCY_LIMIT);
      }
    }
  };

  const deleteImageEditTask = async (id: string) => {
    if (!window.confirm("确定删除这条改图任务吗？")) return;
    const sourceHandoffKey = imageEditSourceHandoffKey(
      imageEditTasksRef.current.find((task) => task.id === id)?.sourceImage
    );
    const nextTasks = await window.styleExtractor.deleteImageEditTask(id);
    dismissHandoffs("image_edit", [sourceHandoffKey]);
    deletedImageEditTaskIdsRef.current.add(id);
    imageEditPollSequenceRef.current += 1;
    imageEditTasksRef.current = nextTasks;
    setImageEditTasks(nextTasks);
    commitImageEditWorkflows((current) => current.filter((workflow) => workflow.taskId !== id));
    if (activeImageEditWorkflow?.taskId === id) setActiveImageEditWorkflowId("");
    if (selectedImageEditTaskId === id) setSelectedImageEditTaskId("");
    setCollapsedImageEditTaskIds((current) => current.filter((taskId) => taskId !== id));
    setStatus("已删除改图任务。");
  };

  const updateImageEditTaskVisibility = async (id: string, visibility: ImageEditTaskVisibility) => {
    const workflowId = imageEditWorkflowsRef.current.find((workflow) => workflow.taskId === id)?.id;
    try {
      const taskEpoch = imageEditTaskEpochRef.current;
      const nextTasks = await window.styleExtractor.updateImageEditTaskVisibility({ id, visibility });
      if (imageEditTaskEpochRef.current !== taskEpoch || deletedImageEditTaskIdsRef.current.has(id)) return;
      imageEditPollSequenceRef.current += 1;
      imageEditTasksRef.current = nextTasks;
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
      const message = visibilityError instanceof Error ? visibilityError.message : String(visibilityError);
      if (workflowId) {
        commitImageEditWorkflows((current) =>
          updateWorkflowById(current, workflowId, (workflow) => ({ ...workflow, error: message }))
        );
      }
    }
  };

  const clearImageEditTasks = async () => {
    if (imageEditTasks.length > 0 && !window.confirm("确定清空全部改图任务吗？")) return;
    const sourceHandoffKeys = imageEditTasksRef.current.map((task) => imageEditSourceHandoffKey(task.sourceImage));
    imageEditTaskEpochRef.current += 1;
    await window.styleExtractor.clearImageEditTasks();
    dismissHandoffs("image_edit", sourceHandoffKeys);
    deletedImageEditTaskIdsRef.current.clear();
    imageEditPollSequenceRef.current += 1;
    imageEditTasksRef.current = [];
    setImageEditTasks([]);
    commitImageEditWorkflows((current) =>
      current.filter((workflow) => !workflow.taskId && workflow.stage !== "queued")
    );
    if (activeImageEditWorkflow?.taskId || activeImageEditWorkflow?.stage === "queued") {
      setActiveImageEditWorkflowId("");
    }
    setSelectedImageEditTaskId("");
    setCollapsedImageEditTaskIds([]);
    setStatus("改图任务已清空。");
  };

  const updateGenerationTaskVisibility = async (id: string, visibility: GenerationTaskVisibility) => {
    const workflowId = generationWorkflowsRef.current.find((workflow) => workflow.taskId === id)?.id;
    try {
      const taskEpoch = generationTaskEpochRef.current;
      const nextTasks = await window.styleExtractor.updateGenerationTaskVisibility({ id, visibility });
      if (generationTaskEpochRef.current !== taskEpoch || deletedGenerationTaskIdsRef.current.has(id)) return;
      generationPollSequenceRef.current += 1;
      generationTasksRef.current = nextTasks;
      setGenerationTasks(nextTasks);
      setStatus(
        visibility === "archived"
          ? "已归档生图任务。"
          : visibility === "hidden"
            ? "已隐藏生图任务。"
            : "已恢复生图任务显示。"
      );
    } catch (visibilityError) {
      const message = visibilityError instanceof Error ? visibilityError.message : String(visibilityError);
      if (workflowId) {
        commitGenerationWorkflows((current) =>
          updateWorkflowById(current, workflowId, (workflow) => ({ ...workflow, error: message }))
        );
      }
    }
  };

  const deleteGenerationTask = async (id: string) => {
    if (!window.confirm("确定删除这条生图任务吗？")) return;
    const sourceHandoffKey = generationPromptSourceHandoffKey(
      generationTasksRef.current.find((task) => task.id === id)?.promptSource
    );
    const nextTasks = await window.styleExtractor.deleteGenerationTask(id);
    dismissHandoffs("generation", [sourceHandoffKey]);
    deletedGenerationTaskIdsRef.current.add(id);
    generationPollSequenceRef.current += 1;
    generationTasksRef.current = nextTasks;
    setGenerationTasks(nextTasks);
    commitGenerationWorkflows((current) => current.filter((workflow) => workflow.taskId !== id));
    if (activeGenerationWorkflow?.taskId === id) setActiveGenerationWorkflowId("");
    if (selectedGenerationTaskId === id) setSelectedGenerationTaskId("");
    setStatus("已删除生图任务。");
  };

  const clearGenerationTasks = async () => {
    if (generationTasks.length > 0 && !window.confirm("确定清空全部生图任务吗？")) return;
    const sourceHandoffKeys = generationTasksRef.current.map((task) =>
      generationPromptSourceHandoffKey(task.promptSource)
    );
    generationTaskEpochRef.current += 1;
    await window.styleExtractor.clearGenerationTasks();
    dismissHandoffs("generation", sourceHandoffKeys);
    deletedGenerationTaskIdsRef.current.clear();
    generationPollSequenceRef.current += 1;
    generationTasksRef.current = [];
    setGenerationTasks([]);
    commitGenerationWorkflows((current) =>
      current.filter((workflow) => !workflow.taskId && workflow.stage !== "submitting")
    );
    if (activeGenerationWorkflow?.taskId || activeGenerationWorkflow?.stage === "submitting") {
      setActiveGenerationWorkflowId("");
    }
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
    const workflowId = generationWorkflowsRef.current.find((workflow) => workflow.taskId === task.id)?.id;
    try {
      if (workflowId) {
        commitGenerationWorkflows((current) =>
          updateWorkflowById(current, workflowId, (workflow) => ({ ...workflow, error: "" }))
        );
      }
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
      const message = downloadError instanceof Error ? downloadError.message : String(downloadError);
      if (workflowId) {
        commitGenerationWorkflows((current) =>
          updateWorkflowById(current, workflowId, (workflow) => ({ ...workflow, error: message }))
        );
      }
    }
  };

  const imageEditOutputSuggestedName = (task: ImageEditTask, output: ImageEditOutput, index: number): string =>
    `edited-${task.id.slice(0, 8)}-${String(index + 1).padStart(2, "0")}-${output.id.slice(0, 8)}`;

  const saveImageEditOutputs = async (task: ImageEditTask, outputs: ImageEditOutput[]) => {
    if (!outputs.length) return;
    const workflowId = imageEditWorkflowsRef.current.find((workflow) => workflow.taskId === task.id)?.id;
    try {
      if (workflowId) {
        commitImageEditWorkflows((current) =>
          updateWorkflowById(current, workflowId, (workflow) => ({ ...workflow, error: "" }))
        );
      }
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
      const message = downloadError instanceof Error ? downloadError.message : String(downloadError);
      if (workflowId) {
        commitImageEditWorkflows((current) =>
          updateWorkflowById(current, workflowId, (workflow) => ({ ...workflow, error: message }))
        );
      }
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
    const workflow = reserveGenerationWorkflow(
      createGenerationWorkflow({ referenceImages: [reference], displayName: "生成图参考流程" })
    );
    if (!workflow) return;
    setActiveView("generate");
    setStatus("已把生成图加入下一轮参考图。");
  };

  const sendGenerationOutputToImageEdit = async (task: GenerationTask, output: GenerationOutput, index: number) => {
    const handoffKey = generationOutputHandoffKey(task.id, output.id);
    if (imageEditHandoffsInFlightRef.current.has(handoffKey)) return;
    imageEditHandoffsInFlightRef.current.add(handoffKey);
    const sourceWorkflowId = generationWorkflowsRef.current.find((workflow) => workflow.taskId === task.id)?.id;
    try {
      const thumbnailDataUrl = await createThumbnail(output.dataUrl);
      const workflow = await loadImageEditSource(
        {
          fileName: `generated-${task.id.slice(0, 8)}-${String(index + 1).padStart(2, "0")}`,
          mimeType: output.mimeType,
          dataUrl: output.dataUrl,
          thumbnailDataUrl,
          sourceCapture: createLocalSourceCapture("uploaded_image")
        },
        "generation_output",
        {
          historyItemId: task.promptSource.historyItemId,
          generationTaskId: task.id,
          generationOutputId: output.id
        },
        {
          basePrompt: task.prompt,
          generationTaskId: task.id,
          generationOutputId: output.id,
          sourceLabel: task.promptSource.label,
          importedAt: new Date().toISOString(),
          inputStrategy: task.referenceImages.length ? "original_references" : "text_only",
          originalReferences: task.referenceImages.map((reference) => ({ ...reference }))
        }
      );
      if (!workflow) return;
      setActiveView("edit");
      setStatus("已把这张生成图送入改图工作台。");
    } catch (editSourceError) {
      const message = editSourceError instanceof Error ? editSourceError.message : String(editSourceError);
      if (sourceWorkflowId) {
        commitGenerationWorkflows((current) =>
          updateWorkflowById(current, sourceWorkflowId, (workflow) => ({ ...workflow, error: message }))
        );
      }
    } finally {
      imageEditHandoffsInFlightRef.current.delete(handoffKey);
    }
  };

  const restoreGenerationTask = (task: GenerationTask) => {
    const workflow = reserveGenerationWorkflow(
      createGenerationWorkflow({
        prompt: task.prompt,
        promptSource: { ...task.promptSource, importedAt: new Date().toISOString() },
        referenceImages: task.referenceImages.map((reference) => ({ ...reference })),
        settings: { ...task.settings, ...normalizeGenerationSizeSettings(task.settings) },
        displayName: task.promptSource.sourceFileName || task.promptSource.label
      })
    );
    if (!workflow) return;
    setSelectedGenerationTaskId(task.id);
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

  const setImageEditTasksCollapsed = (taskIds: string[], collapsed: boolean) => {
    const targetIds = new Set(taskIds);
    setCollapsedImageEditTaskIds((current) =>
      collapsed
        ? Array.from(new Set([...current, ...taskIds]))
        : current.filter((taskId) => !targetIds.has(taskId))
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
    const sourceWorkflowId = imageEditWorkflowsRef.current.find((workflow) => workflow.taskId === task.id)?.id;
    try {
      const thumbnailDataUrl = await createThumbnail(output.dataUrl);
      const workflow = await loadImageEditSource(
        {
          fileName: `edited-${task.id.slice(0, 8)}-${String(index + 1).padStart(2, "0")}`,
          mimeType: output.mimeType,
          dataUrl: output.dataUrl,
          thumbnailDataUrl,
          sourceCapture: createLocalSourceCapture("uploaded_image")
        },
        "restored_edit_output",
        {
          historyItemId: task.sourceImage.sourcePointer.historyItemId,
          imageEditTaskId: task.id,
          imageEditOutputId: output.id
        },
        task.regenerationContext
          ? {
              ...task.regenerationContext,
              importedAt: new Date().toISOString(),
              originalReferences: task.regenerationContext.originalReferences.map((reference) => ({ ...reference }))
            }
          : undefined
      );
      if (!workflow) return;
      setActiveView("edit");
      setStatus("已把改图输出作为新一轮源图。");
    } catch (continueError) {
      const message = continueError instanceof Error ? continueError.message : String(continueError);
      if (sourceWorkflowId) {
        commitImageEditWorkflows((current) =>
          updateWorkflowById(current, sourceWorkflowId, (workflow) => ({ ...workflow, error: message }))
        );
      }
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
        const nextOutput = task.outputs[nextIndex];
        return buildImageEditComparePreview(task, nextOutput, nextIndex) || current;
      }
      const generationTask = generationTasks.find((item) => item.id === current.taskId);
      if (!generationTask?.outputs.length) return current;
      const nextIndex = (current.outputIndex + direction + generationTask.outputs.length) % generationTask.outputs.length;
      return buildGenerationComparePreview(generationTask, generationTask.outputs[nextIndex], nextIndex) || current;
    });
  };

  const analyze = async (workflowId = activeExtractionWorkflowId) => {
    const workflow = extractionWorkflowsRef.current.find((item) => item.id === workflowId);
    if (!workflow?.image) {
      setError("请先上传图片，或直接粘贴截图。");
      return;
    }
    if (workflow.operationId || workflow.status === "queued" || workflow.status === "running") return;
    const activeConfig = configRef.current;
    if (!activeConfig.hasApiKey) {
      setShowConfig(true);
      setError("请先填写模型 API Key。");
      return;
    }
    if (isWorkspaceStatusTerminal(workflow.status)) {
      const occupied = countActiveWorkflows(extractionWorkflowsRef.current);
      if (occupied >= WORKSPACE_CONCURRENCY_LIMIT) {
        showWorkspaceLimit("extraction", occupied);
        return;
      }
    }
    const targetImage = workflow.image;
    const token: WorkflowOperationToken = {
      workflowId: workflow.id,
      operationId: crypto.randomUUID(),
      revision: workflow.revision
    };
    commitExtractionWorkflows((current) =>
      updateWorkflowById(current, workflow.id, (item) => ({
        ...item,
        operationId: token.operationId,
        status: "running",
        stage: "analyzing",
        statusMessage: "准备分析",
        error: "",
        subjectImage: null,
        fusedPrompt: "",
        fusedPromptJson: null,
        fuseError: "",
        fuseControls: defaultFuseControls,
        selectedFuseMode: null,
        productInfoText: ""
      }))
    );
    setShowFuseModal(false);
    try {
      const modelImageDataUrl = await createModelImage(targetImage.dataUrl);
      commitExtractionWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({ ...item, statusMessage: "图片解析中" }))
      );
      const response = await window.styleExtractor.analyzeImage({
        workflowId: token.workflowId,
        operationId: token.operationId,
        revision: token.revision,
        imageDataUrl: modelImageDataUrl,
        mimeType: getMimeTypeFromDataUrl(modelImageDataUrl),
        strictGeneralization: strictGeneralizationRef.current,
        sourceCapture: targetImage.sourceCapture
      });
      if (
        response.workflowId !== token.workflowId ||
        response.operationId !== token.operationId ||
        response.revision !== token.revision ||
        !isWorkflowOperationCurrent(
          extractionWorkflowsRef.current.find((item) => item.id === token.workflowId),
          token
        )
      ) return;
      const initialExtractedText = extractedTextFromAnalysis(response.analysis);
      const historyImageDataUrl = await createHistoryImage(targetImage.dataUrl);
      const historyThumbnailDataUrl = await createThumbnail(historyImageDataUrl);

      const itemId = workflow.historyItemId || crypto.randomUUID();
      const item: HistoryItem = {
        id: itemId,
        createdAt: history.find((entry) => entry.id === itemId)?.createdAt || new Date().toISOString(),
        imageDataUrl: historyImageDataUrl,
        mimeType: getMimeTypeFromDataUrl(historyImageDataUrl),
        fileName: targetImage.fileName,
        thumbnailDataUrl: historyThumbnailDataUrl,
        primaryType: response.analysis.image_classification.primary_type || "unknown",
        universalStylePrompt: response.analysis.style_reference.universal_style_prompt,
        analysis: response.analysis,
        editedTextMarkdown: initialExtractedText || undefined
      };
      const expectedHistoryEpoch = response.historyEpochAtStart ?? historyEpochRef.current;
      const nextHistory = await window.styleExtractor.saveHistoryItem({
        item,
        expectedHistoryEpoch
      });
      if (historyEpochRef.current !== expectedHistoryEpoch) return;
      setHistory(nextHistory);
      commitExtractionWorkflows((current) =>
        updateWorkflowForOperation(current, token, (entry) => ({
          ...entry,
          revision: entry.revision + 1,
          operationId: undefined,
          status: "succeeded",
          stage: "analysis_ready",
          statusMessage: "已解析，可融合",
          analysis: response.analysis,
          rawText: response.rawText,
          editedTextMarkdown: initialExtractedText,
          historyItemId: itemId,
          error: ""
        }))
      );
    } catch (analyzeError) {
      const message = analyzeError instanceof Error ? analyzeError.message : String(analyzeError);
      commitExtractionWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          revision: item.revision + 1,
          operationId: undefined,
          status: "failed",
          stage: "analyzing",
          statusMessage: "分析失败",
          error: message
        }))
      );
    }
  };

  const cancelAnalyze = async () => {
    const workflow = extractionWorkflowsRef.current.find((item) => item.id === activeExtractionWorkflowId);
    if (!workflow?.operationId || workflow.stage !== "analyzing") return;
    const operationId = workflow.operationId;
    await window.styleExtractor.cancelAnalyzeImage(operationId);
    commitExtractionWorkflows((current) =>
      updateWorkflowById(current, workflow.id, (item) =>
        item.operationId === operationId
          ? {
              ...item,
              revision: item.revision + 1,
              operationId: undefined,
              status: "canceled",
              statusMessage: "已取消",
              error: ""
            }
          : item
      )
    );
    setStatus("已取消图片分析。");
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
    const workflow = extractionWorkflowsRef.current.find((item) => item.id === activeExtractionWorkflowId);
    if (!workflow?.historyItemId) return;
    const targetHistoryItem = history.find((item) => item.id === workflow.historyItemId);
    if (!targetHistoryItem) return;
    if ((targetHistoryItem.editedTextMarkdown ?? "") === workflow.editedTextMarkdown) return;
    try {
      const expectedHistoryEpoch = historyEpochRef.current;
      const nextHistory = await window.styleExtractor.patchHistoryItem({
        id: workflow.historyItemId,
        expectedHistoryEpoch,
        editedTextMarkdown: workflow.editedTextMarkdown
      });
      if (historyEpochRef.current !== expectedHistoryEpoch) return;
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
    const workflow = extractionWorkflowsRef.current.find((item) => item.id === activeExtractionWorkflowId);
    if (!workflow?.analysis) {
      setFuseError("请先完成参考图的提示词解析。");
      return;
    }
    if (workflow.operationId || workflow.status === "queued" || workflow.status === "running") return;
    const activeFuseMode = resolveFuseMode(workflow.analysis, workflow.selectedFuseMode);
    if (activeFuseMode === "subject_reference" && !workflow.subjectImage) {
      setFuseError("请先上传主体参考图。");
      return;
    }
    if (activeFuseMode === "information_layout" && !workflow.subjectImage && !workflow.productInfoText.trim()) {
      setFuseError("请先输入新产品信息，或上传一张产品信息图。");
      return;
    }
    if (isWorkspaceStatusTerminal(workflow.status)) {
      const occupied = countActiveWorkflows(extractionWorkflowsRef.current);
      if (occupied >= WORKSPACE_CONCURRENCY_LIMIT) {
        showWorkspaceLimit("extraction", occupied);
        return;
      }
    }
    const activeConfig = configRef.current;
    if (!activeConfig.hasApiKey) {
      setShowConfig(true);
      setFuseError("请先填写模型 API Key。");
      return;
    }
    const token: WorkflowOperationToken = {
      workflowId: workflow.id,
      operationId: crypto.randomUUID(),
      revision: workflow.revision
    };
    commitExtractionWorkflows((current) =>
      updateWorkflowById(current, workflow.id, (item) => ({
        ...item,
        operationId: token.operationId,
        status: "running",
        stage: "fusing",
        statusMessage: "融合中",
        fusedPrompt: "",
        fusedPromptJson: null,
        fuseError: ""
      }))
    );
    try {
      const subjectImageDataUrl = workflow.subjectImage ? await createModelImage(workflow.subjectImage.dataUrl) : undefined;
      const response = await window.styleExtractor.fusePrompt({
        workflowId: token.workflowId,
        operationId: token.operationId,
        revision: token.revision,
        styleAnalysis: workflow.analysis,
        mode: activeFuseMode,
        subjectImageDataUrl,
        productInfoText: workflow.productInfoText,
        editedTextMarkdown: workflow.fuseControls.useExtractedText ? workflow.editedTextMarkdown : undefined,
        controls: workflow.fuseControls
      });
      if (
        response.workflowId !== token.workflowId ||
        response.operationId !== token.operationId ||
        response.revision !== token.revision ||
        !isWorkflowOperationCurrent(
          extractionWorkflowsRef.current.find((item) => item.id === token.workflowId),
          token
        )
      ) return;
      if (!workflow.historyItemId) throw new Error("关联历史已变更，融合结果未保存。");
      const expectedHistoryEpoch = response.historyEpochAtStart ?? historyEpochRef.current;
      const nextHistory = await window.styleExtractor.patchHistoryItem({
        id: workflow.historyItemId,
        expectedHistoryEpoch,
        editedTextMarkdown: workflow.editedTextMarkdown,
        fusedPromptResult: response.result,
        fusedPromptCreatedAt: new Date().toISOString()
      });
      if (historyEpochRef.current !== expectedHistoryEpoch) return;
      setHistory(nextHistory);
      commitExtractionWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          revision: item.revision + 1,
          operationId: undefined,
          status: "succeeded",
          stage: "fused",
          statusMessage: "已完成",
          fusedPrompt: response.result.fused_prompt,
          fusedPromptJson: response.result.fused_prompt_json,
          fuseError: ""
        }))
      );
    } catch (fusePromptError) {
      const message = fusePromptError instanceof Error ? fusePromptError.message : String(fusePromptError);
      commitExtractionWorkflows((current) =>
        updateWorkflowForOperation(current, token, (item) => ({
          ...item,
          revision: item.revision + 1,
          operationId: undefined,
          status: "failed",
          stage: "fusing",
          statusMessage: "融合失败",
          fuseError: message
        }))
      );
    }
  };

  const cancelFusionPrompt = async () => {
    const workflow = extractionWorkflowsRef.current.find((item) => item.id === activeExtractionWorkflowId);
    if (!workflow?.operationId || workflow.stage !== "fusing") return;
    const operationId = workflow.operationId;
    await window.styleExtractor.cancelFusePrompt(operationId);
    commitExtractionWorkflows((current) =>
      updateWorkflowById(current, workflow.id, (item) =>
        item.operationId === operationId
          ? {
              ...item,
              revision: item.revision + 1,
              operationId: undefined,
              status: "canceled",
              statusMessage: "已取消",
              fuseError: ""
            }
          : item
      )
    );
    setStatus("已取消提示词生成。");
  };

  const loadHistory = (item: HistoryItem) => {
    const existing = extractionWorkflowsRef.current.find((workflow) => workflow.historyItemId === item.id);
    if (existing) {
      setActiveExtractionWorkflowId(existing.id);
      return;
    }
    const workflow = extractionWorkflowFromHistory(item);
    const next = [workflow, ...extractionWorkflowsRef.current];
    extractionWorkflowsRef.current = next;
    setExtractionWorkflowsState(next);
    setActiveExtractionWorkflowId(workflow.id);
    setIsSubjectDragging(false);
    setFuseCopied("");
    setShowFuseModal(false);
    const historyStatus = item.imageDataUrl
      ? "已载入历史图片和分析结果，可重新分析。"
      : "已载入历史缩略图和分析结果，可重新分析；旧历史条目没有保存原图。";
    setStatus(item.fusedPromptResult ? `${historyStatus} 已同时载入融合提示词。` : historyStatus);
  };

  const clearHistory = async () => {
    if (history.length > 0 && !window.confirm("确定清空全部图片分析历史记录吗？")) return;
    const operations = extractionWorkflowsRef.current
      .filter((workflow) => Boolean(workflow.operationId))
      .map((workflow) => ({ operationId: workflow.operationId as string, stage: workflow.stage }));
    const clearRequest = window.styleExtractor.clearHistory();
    commitExtractionWorkflows((current) =>
      current
        .filter((workflow) => !workflow.historyItemId)
        .map((workflow) => ({
          ...workflow,
          ...(workflow.operationId
            ? {
                revision: workflow.revision + 1,
                operationId: undefined,
                status: "canceled" as const,
                statusMessage: "历史已清空，操作已取消"
              }
            : {})
        }))
    );
    if (activeExtractionWorkflow?.historyItemId) setActiveExtractionWorkflowId("");
    setShowFuseModal(false);
    const cancelRequest = runWithConcurrency(operations, 2, async (operation) => {
      try {
        if (operation.stage === "analyzing") {
          await window.styleExtractor.cancelAnalyzeImage(operation.operationId);
        } else if (operation.stage === "fusing") {
          await window.styleExtractor.cancelFusePrompt(operation.operationId);
        }
      } catch {
        // Epoch and operation-token invalidation remain authoritative if cancellation races completion.
      }
    });
    await clearRequest;
    await cancelRequest;
    const snapshot = await window.styleExtractor.getHistorySnapshot();
    setHistory(snapshot.items);
    historyEpochRef.current = snapshot.epoch;
    setHistoryEpoch(snapshot.epoch);
    setStatus("历史记录已清空。");
  };

  const deleteHistoryItem = async (item: HistoryItem) => {
    if (!window.confirm("确定删除这条图片分析历史记录吗？")) return;
    const expectedHistoryEpoch = historyEpochRef.current;
    const nextHistory = await window.styleExtractor.deleteHistoryItem({
      id: item.id,
      expectedHistoryEpoch
    });
    if (historyEpochRef.current !== expectedHistoryEpoch) return;
    setHistory(nextHistory);
    commitExtractionWorkflows((current) => current.filter((workflow) => workflow.historyItemId !== item.id));
    if (activeExtractionWorkflow?.historyItemId === item.id) setActiveExtractionWorkflowId("");
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
    const windowsDataNotice = isWindows ? "、Cookie、Local Storage 和 Electron 运行时缓存" : "";
    if (!window.confirm(`确定抹除模型配置、API Key、图片分析历史、生图任务、改图任务${windowsDataNotice}吗？这个操作不可恢复。`)) return;
    generationTaskEpochRef.current += 1;
    imageEditTaskEpochRef.current += 1;
    deletedGenerationTaskIdsRef.current.clear();
    deletedImageEditTaskIdsRef.current.clear();
    const cleared = await window.styleExtractor.clearAllLocalData();
    const historySnapshot = await window.styleExtractor.getHistorySnapshot();
    setConfig(cleared);
    setDraftConfig({ ...cleared, apiKey: "" });
    setHistory(historySnapshot.items);
    historyEpochRef.current = historySnapshot.epoch;
    setHistoryEpoch(historySnapshot.epoch);
    extractionWorkflowsRef.current = [];
    generationWorkflowsRef.current = [];
    imageEditWorkflowsRef.current = [];
    setExtractionWorkflowsState([]);
    setGenerationWorkflowsState([]);
    setImageEditWorkflowsState([]);
    setActiveExtractionWorkflowId("");
    setActiveGenerationWorkflowId("");
    setActiveImageEditWorkflowId("");
    generationPollSequenceRef.current += 1;
    imageEditPollSequenceRef.current += 1;
    generationTasksRef.current = [];
    imageEditTasksRef.current = [];
    workflowLineageMarkerRegistryRef.current.clear();
    resetDismissedHandoffs();
    setGenerationTasks([]);
    setCollapsedGenerationTaskIds([]);
    setGenerationConfig(defaultGenerationConfig);
    setGenerationDraft(defaultGenerationDraft);
    setImageEditTasks([]);
    setShowFuseModal(false);
    setStatus(
      isWindows
        ? "本机模型配置、API Key、图片历史记录、生图任务、改图任务和 Windows 运行时浏览数据已全部抹除。"
        : "本机模型配置、API Key、图片历史记录、生图任务和改图任务已全部抹除。"
    );
    setShowConfig(false);
  };

  const workflowLineageMarkers = useMemo(() => {
    const lineageKeys = resolveWorkflowLineageKeys({
      extractionWorkflows,
      generationTasks,
      generationWorkflows,
      imageEditTasks,
      imageEditWorkflows
    });
    const markerByKey = createWorkflowLineageMarkerMap(
      [
        ...lineageKeys.extraction.values(),
        ...lineageKeys.generation.values(),
        ...lineageKeys.imageEdit.values(),
        ...lineageKeys.generationTasks.values(),
        ...lineageKeys.imageEditTasks.values()
      ],
      workflowLineageMarkerRegistryRef.current
    );
    workflowLineageMarkerRegistryRef.current = markerByKey;
    const markersFor = (keys: ReadonlyMap<string, string>): Map<string, WorkflowLineageMarker> =>
      new Map(
        Array.from(keys, ([workflowId, key]) => [
          workflowId,
          workflowLineageMarkerForKey(markerByKey, key)
        ])
      );

    return {
      extraction: markersFor(lineageKeys.extraction),
      generation: markersFor(lineageKeys.generation),
      generationTasks: markersFor(lineageKeys.generationTasks),
      imageEdit: markersFor(lineageKeys.imageEdit),
      imageEditTasks: markersFor(lineageKeys.imageEditTasks)
    };
  }, [extractionWorkflows, generationTasks, generationWorkflows, imageEditTasks, imageEditWorkflows]);

  const extractionNavigationItems: WorkflowNavigatorItem[] = extractionWorkflows.map((workflow) => ({
    id: workflow.id,
    lineageMarker: workflowLineageMarkers.extraction.get(workflow.id) || 1,
    title: workflow.displayName,
    subtitle: workflow.statusMessage,
    status: workflow.status,
    thumbnailDataUrl: workflow.image?.thumbnailDataUrl,
    error: workflow.error || workflow.fuseError
  }));
  const representedExtractionDraftLineageKeys = new Set(
    generationWorkflows
      .filter((workflow) => !workflow.taskId)
      .map((workflow) => generationPromptSourceLineageKey(workflow.promptSource))
      .filter(Boolean)
  );
  const representedExtractionTaskHandoffKeys = new Set(
    [
      ...generationWorkflows.filter((workflow) => workflow.taskId).map((workflow) => workflow.promptSource),
      ...generationTasks.map((task) => task.promptSource)
    ]
      .map(generationPromptSourceHandoffKey)
      .filter(Boolean)
  );
  const pendingGenerationHandoffs = extractionWorkflows
    .filter(
      (workflow) => {
        const handoffKey = extractionGenerationHandoffKey(
          workflow,
          workflow.fusedPrompt.trim() ? "fused" : "text_to_image"
        );
        return (
          Boolean(workflow.analysis) &&
          isWorkspaceStatusTerminal(workflow.status) &&
          !representedExtractionDraftLineageKeys.has(extractionWorkflowLineageKey(workflow)) &&
          !representedExtractionTaskHandoffKeys.has(handoffKey) &&
          !dismissedGenerationHandoffKeys.has(handoffKey)
        );
      }
    )
    .map((sourceWorkflow) => {
      const handoffKey = extractionGenerationHandoffKey(
        sourceWorkflow,
        sourceWorkflow.fusedPrompt.trim() ? "fused" : "text_to_image"
      );
      return {
        id: `pending-generation:${sourceWorkflow.id}`,
        handoffKey,
        sourceWorkflow
      };
    });
  const pendingGenerationHandoffById = new Map(
    pendingGenerationHandoffs.map((handoff) => [handoff.id, handoff.sourceWorkflow])
  );
  const generationNavigationItems: WorkflowNavigatorItem[] = [
    ...generationWorkflows.map((workflow) => ({
      id: workflow.id,
      lineageMarker: workflowLineageMarkers.generation.get(workflow.id) || 1,
      title: workflow.displayName,
      subtitle: workflow.statusMessage,
      status: workflow.status,
      thumbnailDataUrl:
        workflow.promptSource?.sourceThumbnailDataUrl || workflow.referenceImages[0]?.thumbnailDataUrl,
      error: workflow.error
    })),
    ...pendingGenerationHandoffs.map(({ id, sourceWorkflow }) => ({
      id,
      lineageMarker: workflowLineageMarkers.extraction.get(sourceWorkflow.id) || 1,
      title: sourceWorkflow.displayName,
      subtitle: "待处理",
      status: "setup" as const,
      thumbnailDataUrl: sourceWorkflow.image?.thumbnailDataUrl,
      countsTowardCapacity: false,
      closeLabel: `移除记录 ${sourceWorkflow.displayName}`,
      closeTitle: "移除此条记录"
    }))
  ];
  const representedGenerationOutputKeys = new Set(
    [
      ...imageEditWorkflows.map((workflow) => imageEditSourceHandoffKey(workflow.source)),
      ...imageEditTasks.map((task) => imageEditSourceHandoffKey(task.sourceImage))
    ].filter(Boolean)
  );
  const pendingImageEditHandoffs = generationTasks
    .filter(
      (task) =>
        isWorkspaceStatusTerminal(task.status) && generationTaskVisibility(task) === "active"
    )
    .flatMap((task) =>
      task.outputs.flatMap((output, index) => {
        const outputKey = generationOutputHandoffKey(task.id, output.id);
        if (
          representedGenerationOutputKeys.has(outputKey) ||
          dismissedImageEditHandoffKeys.has(outputKey)
        ) return [];
        return [{
          id: `pending-image-edit:${task.id}:${output.id}`,
          handoffKey: outputKey,
          task,
          output,
          index
        }];
      })
    );
  const pendingImageEditHandoffById = new Map(
    pendingImageEditHandoffs.map((handoff) => [handoff.id, handoff])
  );
  const imageEditNavigationItems: WorkflowNavigatorItem[] = [
    ...imageEditWorkflows.map((workflow) => ({
      id: workflow.id,
      lineageMarker: workflowLineageMarkers.imageEdit.get(workflow.id) || 1,
      title: workflow.displayName,
      subtitle: workflow.statusMessage,
      status: workflow.status,
      thumbnailDataUrl: workflow.source?.thumbnailDataUrl,
      error: workflow.error
    })),
    ...pendingImageEditHandoffs.map(({ id, index, output, task }) => ({
      id,
      lineageMarker: workflowLineageMarkers.generationTasks.get(task.id) || 1,
      title: `${task.promptSource.sourceFileName || task.promptSource.label} · ${String(index + 1).padStart(2, "0")}`,
      subtitle: "待处理",
      status: "setup" as const,
      thumbnailDataUrl: output.dataUrl,
      countsTowardCapacity: false,
      closeLabel: `移除记录 ${task.promptSource.sourceFileName || task.promptSource.label}`,
      closeTitle: "移除此条记录"
    }))
  ];
  const visibleGenerationTasks = activeGenerationWorkflow?.taskId
    ? generationTasks.filter((task) => task.id === activeGenerationWorkflow.taskId)
    : [];
  const visibleImageEditTasks = activeImageEditWorkflow?.taskId
    ? imageEditTasks.filter((task) => task.id === activeImageEditWorkflow.taskId)
    : [];
  const activeExtractionLineageMarker = activeExtractionWorkflow
    ? workflowLineageMarkers.extraction.get(activeExtractionWorkflow.id) || 1
    : 1;
  const activeGenerationLineageMarker = activeGenerationWorkflow
    ? workflowLineageMarkers.generation.get(activeGenerationWorkflow.id) || 1
    : 1;
  const activeImageEditLineageMarker = activeImageEditWorkflow
    ? workflowLineageMarkers.imageEdit.get(activeImageEditWorkflow.id) || 1
    : 1;

  const clearGenerationWorkspaceHistory = async () => {
    const terminalTasks = generationTasksRef.current.filter((task) => isWorkspaceStatusTerminal(task.status));
    if (!terminalTasks.length && !pendingGenerationHandoffs.length) return;
    if (!window.confirm("确定清空生图工作区的历史记录吗？")) return;

    dismissHandoffs(
      "generation",
      pendingGenerationHandoffs.map((handoff) => handoff.handoffKey)
    );
    let nextTasks = generationTasksRef.current;
    const deletedIds = new Set<string>();
    const deletedSourceKeys: string[] = [];
    let failure = "";
    for (const task of terminalTasks) {
      try {
        nextTasks = await window.styleExtractor.deleteGenerationTask(task.id);
        deletedIds.add(task.id);
        deletedGenerationTaskIdsRef.current.add(task.id);
        deletedSourceKeys.push(generationPromptSourceHandoffKey(task.promptSource));
      } catch (deleteError) {
        failure = deleteError instanceof Error ? deleteError.message : String(deleteError);
        break;
      }
    }
    dismissHandoffs("generation", deletedSourceKeys);
    generationPollSequenceRef.current += 1;
    generationTasksRef.current = nextTasks;
    setGenerationTasks(nextTasks);
    commitGenerationWorkflows((current) => current.filter((workflow) => !workflow.taskId || !deletedIds.has(workflow.taskId)));
    if (activeGenerationWorkflow?.taskId && deletedIds.has(activeGenerationWorkflow.taskId)) {
      setActiveGenerationWorkflowId("");
    }
    if (selectedGenerationTaskId && deletedIds.has(selectedGenerationTaskId)) setSelectedGenerationTaskId("");
    setCollapsedGenerationTaskIds((current) => current.filter((id) => !deletedIds.has(id)));
    setStatus(failure ? `部分生图历史未能删除：${failure}` : "生图工作区历史已清空。");
  };

  const clearImageEditWorkspaceHistory = async () => {
    const terminalTasks = imageEditTasksRef.current.filter((task) => isWorkspaceStatusTerminal(task.status));
    if (!terminalTasks.length && !pendingImageEditHandoffs.length) return;
    if (!window.confirm("确定清空改图工作区的历史记录吗？")) return;

    dismissHandoffs(
      "image_edit",
      pendingImageEditHandoffs.map((handoff) => handoff.handoffKey)
    );
    let nextTasks = imageEditTasksRef.current;
    const deletedIds = new Set<string>();
    const deletedSourceKeys: string[] = [];
    let failure = "";
    for (const task of terminalTasks) {
      try {
        nextTasks = await window.styleExtractor.deleteImageEditTask(task.id);
        deletedIds.add(task.id);
        deletedImageEditTaskIdsRef.current.add(task.id);
        deletedSourceKeys.push(imageEditSourceHandoffKey(task.sourceImage));
      } catch (deleteError) {
        failure = deleteError instanceof Error ? deleteError.message : String(deleteError);
        break;
      }
    }
    dismissHandoffs("image_edit", deletedSourceKeys);
    imageEditPollSequenceRef.current += 1;
    imageEditTasksRef.current = nextTasks;
    setImageEditTasks(nextTasks);
    commitImageEditWorkflows((current) => current.filter((workflow) => !workflow.taskId || !deletedIds.has(workflow.taskId)));
    if (activeImageEditWorkflow?.taskId && deletedIds.has(activeImageEditWorkflow.taskId)) {
      setActiveImageEditWorkflowId("");
    }
    if (selectedImageEditTaskId && deletedIds.has(selectedImageEditTaskId)) setSelectedImageEditTaskId("");
    setCollapsedImageEditTaskIds((current) => current.filter((id) => !deletedIds.has(id)));
    setStatus(failure ? `部分改图历史未能删除：${failure}` : "改图工作区历史已清空。");
  };

  const closeExtractionWorkflow = (workflowId: string) => {
    const workflow = extractionWorkflowsRef.current.find((item) => item.id === workflowId);
    if (!workflow || (!isWorkspaceStatusTerminal(workflow.status) && workflow.status !== "setup")) return;
    commitExtractionWorkflows((current) => current.filter((item) => item.id !== workflowId));
    if (activeExtractionWorkflowId === workflowId) setActiveExtractionWorkflowId("");
  };
  const closeGenerationWorkflow = (workflowId: string) => {
    const workflow = generationWorkflowsRef.current.find((item) => item.id === workflowId);
    if (!workflow || (!isWorkspaceStatusTerminal(workflow.status) && workflow.status !== "setup")) return;
    commitGenerationWorkflows((current) => current.filter((item) => item.id !== workflowId));
    if (activeGenerationWorkflowId === workflowId) setActiveGenerationWorkflowId("");
  };
  const closeImageEditWorkflow = (workflowId: string) => {
    const workflow = imageEditWorkflowsRef.current.find((item) => item.id === workflowId);
    if (!workflow || (!isWorkspaceStatusTerminal(workflow.status) && workflow.status !== "setup")) return;
    commitImageEditWorkflows((current) => current.filter((item) => item.id !== workflowId));
    if (activeImageEditWorkflowId === workflowId) setActiveImageEditWorkflowId("");
  };
  const closeGenerationNavigationItem = (workflowId: string) => {
    const handoff = pendingGenerationHandoffs.find((item) => item.id === workflowId);
    if (handoff) {
      dismissHandoffs("generation", [handoff.handoffKey]);
      setStatus("已移除生图工作区记录。");
      return;
    }
    closeGenerationWorkflow(workflowId);
  };
  const closeImageEditNavigationItem = (workflowId: string) => {
    const handoff = pendingImageEditHandoffs.find((item) => item.id === workflowId);
    if (handoff) {
      dismissHandoffs("image_edit", [handoff.handoffKey]);
      setStatus("已移除改图工作区记录。");
      return;
    }
    closeImageEditWorkflow(workflowId);
  };
  const selectGenerationNavigationItem = (workflowId: string) => {
    const sourceWorkflow = pendingGenerationHandoffById.get(workflowId);
    if (sourceWorkflow) {
      void openPendingGenerationHandoff(sourceWorkflow.id);
      return;
    }
    setActiveGenerationWorkflowId(workflowId);
  };
  const selectImageEditNavigationItem = (workflowId: string) => {
    const handoff = pendingImageEditHandoffById.get(workflowId);
    if (handoff) {
      void sendGenerationOutputToImageEdit(handoff.task, handoff.output, handoff.index);
      return;
    }
    setActiveImageEditWorkflowId(workflowId);
  };
  const createBlankGenerationWorkflow = () => {
    reserveGenerationWorkflow(createGenerationWorkflow({ displayName: "手动生图" }));
  };
  const setImageEditActiveTool = (value: ImageEditTool) =>
    updateActiveImageEdit((workflow) => ({ ...workflow, activeTool: value }));
  const setImageEditAnnotationColor = (value: string) =>
    updateActiveImageEdit((workflow) => ({ ...workflow, annotationColor: value }));
  const setImageEditAnnotationText = (value: string) =>
    updateActiveImageEdit((workflow) => ({ ...workflow, annotationText: value }));
  const activeViewError =
    activeView === "extract" ? error || fuseError : activeView === "generate" ? generationError : imageEditError;
  const liveCapacityDialogOccupied = !capacityDialog
    ? 0
    : capacityDialog.workspace === "extraction"
      ? countActiveWorkflows(extractionWorkflows)
      : capacityDialog.workspace === "generation"
        ? countActiveWorkflows(generationWorkflows)
        : countActiveWorkflows(imageEditWorkflows);
  const capacityDialogOccupied = capacityDialog
    ? Math.min(WORKSPACE_CONCURRENCY_LIMIT, Math.max(capacityDialog.occupied, liveCapacityDialogOccupied))
    : 0;

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
        <button
          className={activeView === "generate" ? "active" : ""}
          onClick={() => void openGenerationWorkspace()}
          type="button"
        >
          <Sparkles size={18} />
          生图工作台
        </button>
        <button className={activeView === "edit" ? "active" : ""} onClick={() => setActiveView("edit")} type="button">
          <PenLine size={18} />
          改图工作台
        </button>
      </nav>

      {(status || activeViewError) && (
        <section className={activeViewError ? "notice error" : "notice"}>
          {activeViewError ? <AlertCircle size={18} /> : <Check size={18} />}
          <span>{activeViewError || status}</span>
        </section>
      )}

      {activeView === "extract" && (
        <section className="workflow-shell">
          <WorkflowNavigator
            activeId={activeExtractionWorkflowId}
            collapseCompleted={collapseCompletedExtraction}
            items={extractionNavigationItems}
            onAdd={() => fileInputRef.current?.click()}
            onClearHistory={history.length > 0 ? clearHistory : undefined}
            onClose={closeExtractionWorkflow}
            onSelect={setActiveExtractionWorkflowId}
            onToggleCompleted={() => setCollapseCompletedExtraction((current) => !current)}
            workspace="extraction"
          />
          <div className="workflow-detail">
            {!activeExtractionWorkflow ? (
              <WorkspaceBlankState
                actionLabel="上传多张图片"
                description="当前没有图片解析流程。"
                onAction={() => fileInputRef.current?.click()}
              />
            ) : (
              <section className="workspace">
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
                <span>支持拖拽、选择文件、{pasteShortcut}</span>
              </div>
            )}
          </div>

          {image && (
            <div className="source-meta">
              <WorkflowLineageBadge marker={activeExtractionLineageMarker} />
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
              </section>
            )}
          </div>
        </section>
      )}

      {activeView === "generate" && (
        <section className="workflow-shell">
          <WorkflowNavigator
            activeId={activeGenerationWorkflowId}
            collapseCompleted={collapseCompletedGeneration}
            items={generationNavigationItems}
            onAdd={createBlankGenerationWorkflow}
            onClearHistory={
              generationTasks.some((task) => isWorkspaceStatusTerminal(task.status)) || pendingGenerationHandoffs.length > 0
                ? clearGenerationWorkspaceHistory
                : undefined
            }
            onClose={closeGenerationNavigationItem}
            onSelect={selectGenerationNavigationItem}
            onToggleCompleted={() => setCollapseCompletedGeneration((current) => !current)}
            workspace="generation"
          />
          <div className="workflow-detail">
            {!activeGenerationWorkflow ? (
              <WorkspaceBlankState
                actionLabel="新建生图流程"
                description="当前没有生图流程。"
                onAction={createBlankGenerationWorkflow}
              />
            ) : (
              <GenerationWorkspace
          key={activeGenerationWorkflow.id}
          lineageMarker={activeGenerationLineageMarker}
          copiedKey={generationCopied}
          collapsedTaskIds={collapsedGenerationTaskIds}
          error={generationError}
          formLocked={Boolean(activeGenerationWorkflow.taskId) || isGeneratingImage}
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
          tasks={visibleGenerationTasks}
          backendActionLabel={generationBackendActionLabel(generationConfig)}
          backendReady={generationBackendReady}
              />
            )}
          </div>
        </section>
      )}

      {activeView === "edit" && (
        <section className="workflow-shell">
          <WorkflowNavigator
            activeId={activeImageEditWorkflowId}
            collapseCompleted={collapseCompletedImageEdit}
            items={imageEditNavigationItems}
            onAdd={() => imageEditSourceInputRef.current?.click()}
            onClearHistory={
              imageEditTasks.some((task) => isWorkspaceStatusTerminal(task.status)) || pendingImageEditHandoffs.length > 0
                ? clearImageEditWorkspaceHistory
                : undefined
            }
            onClose={closeImageEditNavigationItem}
            onSelect={selectImageEditNavigationItem}
            onToggleCompleted={() => setCollapseCompletedImageEdit((current) => !current)}
            workspace="image_edit"
          />
          <div className="workflow-detail">
            {!activeImageEditWorkflow ? (
              <WorkspaceBlankState
                actionLabel="导入多张源图"
                description="当前没有改图流程。"
                onAction={() => imageEditSourceInputRef.current?.click()}
              />
            ) : (
              <ImageEditWorkspace
          key={activeImageEditWorkflow.id}
          lineageMarker={activeImageEditLineageMarker}
          workflowId={activeImageEditWorkflow.id}
          annotations={imageEditAnnotations}
          activeTool={activeImageEditWorkflow.activeTool}
          annotationColor={activeImageEditWorkflow.annotationColor}
          annotationText={activeImageEditWorkflow.annotationText}
          backendActionLabel={generationBackendActionLabel(generationConfig)}
          backendReady={generationBackendReady}
          error={imageEditError}
          formLocked={Boolean(activeImageEditWorkflow.taskId) || isResolvingImageEditAnnotations || isCreatingImageEdit}
          instruction={imageEditInstruction}
          isCreating={isCreatingImageEdit}
          isResolvingAnnotations={isResolvingImageEditAnnotations}
          isDragging={isImageEditDragging}
          onCancelTask={cancelImageEditTask}
          onCancelResolution={cancelImageEditAnnotationResolution}
          onClearAnnotations={() => setImageEditAnnotations([])}
          onClearTasks={clearImageEditTasks}
          onCreateTask={createImageEditTask}
          onResolveAnnotations={resolveImageEditAnnotations}
          onDeleteTask={deleteImageEditTask}
          onDownloadOutput={saveImageEditOutputs}
          onContinueFromOutput={continueImageEditFromOutput}
          onOpenCompare={openImageEditCompare}
          onOpenOutputPreview={openImageEditOutputPreview}
          onOpenConfig={() => void openGenerationConfig()}
          onPickSource={() => imageEditSourceInputRef.current?.click()}
          onRetryTask={retryImageEditTask}
          onSetTasksCollapsed={setImageEditTasksCollapsed}
          onToggleTaskCollapsed={toggleImageEditTaskCollapsed}
          onSetAnnotationResolution={setImageEditAnnotationResolution}
          onSetAnnotations={setImageEditAnnotations}
          onSetActiveTool={setImageEditActiveTool}
          onSetAnnotationColor={setImageEditAnnotationColor}
          onSetAnnotationText={setImageEditAnnotationText}
          onSetInstruction={setImageEditInstruction}
          onSetRegenerationContext={setImageEditRegenerationContext}
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
          regenerationContext={imageEditRegenerationContext}
          annotationResolution={imageEditAnnotationResolution}
          tasks={visibleImageEditTasks}
              />
            )}
          </div>
        </section>
      )}

      <input
        accept="image/*"
        hidden
        multiple
        onChange={onFileChange}
        ref={fileInputRef}
        type="file"
      />

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
        multiple
        onChange={onImageEditSourceChange}
        ref={imageEditSourceInputRef}
        type="file"
      />

      {capacityDialog && (
        <div className="modal-backdrop capacity-backdrop" onMouseDown={() => setCapacityDialog(null)}>
          <section
            aria-labelledby="workspace-capacity-title"
            aria-modal="true"
            className="modal capacity-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="capacity-modal-icon" aria-hidden="true">
              <AlertCircle size={22} />
            </div>
            <div className="modal-title">
              <h2 id="workspace-capacity-title">
                {capacityDialog.rejectedCount > 0
                  ? capacityDialog.acceptedCount > 0
                    ? "部分流程未加入"
                    : "已达到并发上限"
                  : "部分图片处理失败"}
              </h2>
              <p>
                {capacityDialog.rejectedCount > 0
                  ? `${workspaceLabelMap[capacityDialog.workspace]}最多同时处理 ${WORKSPACE_CONCURRENCY_LIMIT} 个流程，当前占用 ${capacityDialogOccupied} / ${WORKSPACE_CONCURRENCY_LIMIT}。`
                  : "以下文件未能处理，不影响其他合格图片继续加入。"}
              </p>
            </div>
            {capacityDialog.rejectedCount > 0 && (
              <p className="capacity-modal-summary">
                {capacityDialog.acceptedCount > 0
                  ? `本次已加入 ${capacityDialog.acceptedCount} 个流程，另 ${capacityDialog.rejectedCount} 个流程未加入。`
                  : `本次有 ${capacityDialog.rejectedCount} 个流程未加入。`}
                请等待任一进行中流程完成后再继续。
              </p>
            )}
            {capacityDialog.failures && capacityDialog.failures.length > 0 && (
              <div className="capacity-modal-failures">
                <strong>未能读取的图片</strong>
                <ul>
                  {capacityDialog.failures.map((failure, index) => (
                    <li key={`${failure}-${index}`}>{failure}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="modal-actions">
              <button autoFocus className="primary-button" onClick={() => setCapacityDialog(null)} type="button">
                我知道了
              </button>
            </div>
          </section>
        </div>
      )}

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
                  <span>{fuseMode === "information_layout" ? "可只输入文字，也支持图片补充" : `支持拖拽、选择文件、${pasteShortcut}`}</span>
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
              <button
                className="secondary-button"
                disabled={isFusing}
                onClick={() => subjectFileInputRef.current?.click()}
                type="button"
              >
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
              <p>支持 Images、Responses、Chat Completions 和 Gemini 原生生图/改图协议。</p>
            </div>
            <label>
              认证方式
              <select
                onChange={(event) =>
                  setGenerationDraft({
                    ...generationDraft,
                    authSource: event.target.value === "api" ? "api" : "codex_oauth"
                  })
                }
                value={generationDraft.authSource}
              >
                <option value="codex_oauth">Codex OAuth（本机登录）</option>
                <option value="api">API Key（第三方平台）</option>
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
              </div>
            )}
            <label>
              生图/改图协议
              <select
                disabled={generationDraft.authSource === "codex_oauth" || generationDraft.providerType === "openrouter"}
                onChange={(event) =>
                  setGenerationDraft({
                    ...generationDraft,
                    apiMode:
                      event.target.value === "responses"
                        ? "responses"
                        : event.target.value === "chat_completions"
                          ? "chat_completions"
                          : event.target.value === "gemini"
                            ? "gemini"
                            : "images"
                  })
                }
                value={
                  generationDraft.authSource === "codex_oauth"
                    ? "responses"
                    : generationDraft.providerType === "openrouter"
                      ? "images"
                      : generationDraft.apiMode
                }
              >
                {generationDraft.authSource === "codex_oauth" ? (
                  <option value="responses">Responses（Codex OAuth 内部调用）</option>
                ) : generationDraft.providerType === "openrouter" ? (
                  <option value="images">OpenRouter Images（OpenRouter 专用）</option>
                ) : (
                  <>
                    <option value="images">Images API（常见 OpenAI 生图）</option>
                    <option value="responses">Responses（OpenAI 图像工具）</option>
                    <option value="chat_completions">Chat Completions（常见中转平台）</option>
                    <option value="gemini">Gemini 原生（Google / Gemini 中转）</option>
                  </>
                )}
              </select>
            </label>
            <p className="config-note">{generationApiModeNote(generationDraft)}</p>
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
                              : formatGenerationApiMode(provider.apiMode)}{" "}
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
                  <option value="openai_compatible">通用 API（OpenAI / Gemini / 中转）</option>
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
                placeholder={
                  generationDraft.apiMode === "gemini"
                    ? "https://generativelanguage.googleapis.com/v1"
                    : "https://api.openai.com/v1"
                }
                value={generationDraft.apiBaseUrl}
              />
            </label>
            {usesInsecureGenerationBaseUrl && (
              <p className="config-warning">当前 Base URL 使用 http://，API Key、提示词和图片内容会以明文链路传输。</p>
            )}
            <label>
              Image Model
              <input
                onChange={(event) => setGenerationDraft({ ...generationDraft, imageModel: event.target.value })}
                placeholder={generationDraft.apiMode === "gemini" ? "gemini-3.1-flash-image" : "gpt-image-2"}
                value={generationDraft.imageModel}
              />
            </label>
            <label>
              Main Model（仅 Responses）
              <input
                disabled={
                  generationDraft.authSource === "codex_oauth" ||
                  generationDraft.providerType === "openrouter" ||
                  generationDraft.apiMode !== "responses"
                }
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
                placeholder={
                  generationDraft.hasApiKey
                    ? "已配置，留空则继续使用当前 Key"
                    : generationDraft.apiMode === "gemini"
                      ? "Gemini API Key 或平台 Key"
                      : "sk-..."
                }
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
              <p>选择平台实际提供的识图协议，应用会自动拼接对应接口路径。</p>
            </div>
            <label>
              识图协议
              <select
                onChange={(event) =>
                  setDraftConfig({
                    ...draftConfig,
                    apiMode:
                      event.target.value === "responses"
                        ? "responses"
                        : event.target.value === "anthropic"
                          ? "anthropic"
                          : event.target.value === "gemini"
                            ? "gemini"
                            : "chat_completions"
                  })
                }
                value={draftConfig.apiMode}
              >
                <option value="chat_completions">Chat Completions（多数 OpenAI 兼容平台）</option>
                <option value="responses">Responses（OpenAI Responses 兼容平台）</option>
                <option value="anthropic">Anthropic Messages（Claude Code 中转）</option>
                <option value="gemini">Gemini 原生（Google / Gemini 中转）</option>
              </select>
            </label>
            <p className="config-note">{visionApiModeNote(draftConfig.apiMode)}</p>
            <label>
              API Base URL
              <input
                onChange={(event) => setDraftConfig({ ...draftConfig, apiBaseUrl: event.target.value })}
                placeholder={
                  draftConfig.apiMode === "gemini"
                    ? "https://api.duckcoding.ai/v1beta"
                    : draftConfig.apiMode === "anthropic"
                      ? "https://gateway.example.com"
                      : "https://api.openai.com/v1"
                }
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
                placeholder={
                  draftConfig.apiMode === "gemini"
                    ? "gemini-2.5-flash"
                    : draftConfig.apiMode === "anthropic"
                      ? "平台提供的视觉模型名"
                      : "gpt-4o-mini"
                }
                value={draftConfig.modelName}
              />
            </label>
            <label>
              API Key
              <input
                onChange={(event) => setDraftConfig({ ...draftConfig, apiKey: event.target.value })}
                placeholder={
                  draftConfig.hasApiKey
                    ? "已配置，留空则继续使用当前 Key"
                    : draftConfig.apiMode === "gemini"
                      ? "Gemini API Key 或平台 Key"
                      : draftConfig.apiMode === "anthropic"
                        ? "ANTHROPIC_AUTH_TOKEN 或平台 Key"
                        : "sk-..."
                }
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
              <p>这些操作只影响{localDataScope}的应用数据，不会删除项目源码或已导出的 JSON 文件。</p>
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

const workflowLifecycleLabel: Record<WorkspaceLifecycleStatus, string> = {
  setup: "待处理",
  queued: "排队中",
  running: "进行中",
  succeeded: "已完成",
  partial_failed: "部分完成",
  failed: "失败",
  canceled: "已取消"
};

const workspaceAddLabel: Record<WorkspaceKind, string> = {
  extraction: "上传多图",
  generation: "新建流程",
  image_edit: "导入多图"
};

const workspaceClearHistoryLabel: Record<WorkspaceKind, string> = {
  extraction: "清空图片解析历史",
  generation: "清空生图历史",
  image_edit: "清空改图历史"
};

function WorkflowLineageBadge({ marker }: { marker: WorkflowLineageMarker }): JSX.Element {
  return (
    <span
      aria-label={`对应标记 ${marker}`}
      className={`workflow-lineage-marker workflow-lineage-marker-${marker}`}
    >
      {marker}
    </span>
  );
}

function WorkflowNavigator({
  activeId,
  collapseCompleted,
  items,
  onAdd,
  onClearHistory,
  onClose,
  onSelect,
  onToggleCompleted,
  workspace
}: {
  activeId: string;
  collapseCompleted: boolean;
  items: WorkflowNavigatorItem[];
  onAdd: () => void;
  onClearHistory?: () => void;
  onClose: (workflowId: string) => void;
  onSelect: (workflowId: string) => void;
  onToggleCompleted: () => void;
  workspace: WorkspaceKind;
}): JSX.Element {
  const activeCount = items.filter(
    (item) => item.countsTowardCapacity !== false && !isWorkspaceStatusTerminal(item.status)
  ).length;
  const completedCount = items.filter((item) => isWorkspaceStatusTerminal(item.status)).length;

  return (
    <aside className="workflow-navigator" aria-label={`${workspaceLabelMap[workspace]}流程导航`}>
      <div className="workflow-navigator-header">
        <div className="workflow-navigator-heading">
          <strong>{workspaceLabelMap[workspace]}</strong>
          <span>进行中 {activeCount} / {WORKSPACE_CONCURRENCY_LIMIT}</span>
        </div>
        <div className="workflow-navigator-actions">
          {onClearHistory && (
            <button
              aria-label={workspaceClearHistoryLabel[workspace]}
              className="icon-button workflow-clear-button"
              onClick={onClearHistory}
              title={workspaceClearHistoryLabel[workspace]}
              type="button"
            >
              <Trash2 size={17} />
            </button>
          )}
          <button
            aria-label={workspaceAddLabel[workspace]}
            className="icon-button workflow-add-button"
            onClick={onAdd}
            title={workspaceAddLabel[workspace]}
            type="button"
          >
            <ImagePlus size={18} />
          </button>
        </div>
      </div>

      <div className="workflow-navigator-list">
        {items.length === 0 ? (
          <p className="workflow-navigator-empty">暂无流程</p>
        ) : (
          items.map((item) => {
            const terminal = isWorkspaceStatusTerminal(item.status);
            const canClose = item.canClose ?? (terminal || item.status === "setup");
            const compact = collapseCompleted && terminal && item.status !== "failed";
            const selected = item.id === activeId;
            return (
              <div
                className={[
                  "workflow-navigator-row",
                  `workflow-navigator-row-${item.status}`,
                  selected ? "active" : "",
                  terminal ? "terminal" : "",
                  canClose ? "closable" : "",
                  compact ? "completed-collapsed" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.id}
              >
                <button
                  aria-expanded={selected}
                  className="workflow-navigator-main"
                  onClick={() => onSelect(selected ? "" : item.id)}
                  title={item.error || item.title}
                  type="button"
                >
                  <span className="workflow-navigator-chevron" aria-hidden="true">
                    {selected ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                  <span className="workflow-navigator-thumbnail">
                    {item.thumbnailDataUrl ? <img alt="" src={item.thumbnailDataUrl} /> : <ImagePlus size={18} />}
                  </span>
                  <span className="workflow-navigator-copy">
                    <span className="workflow-navigator-title">
                      <WorkflowLineageBadge marker={item.lineageMarker} />
                      <strong>{item.title}</strong>
                    </span>
                    <span className="workflow-navigator-subtitle">{item.error || item.subtitle}</span>
                  </span>
                  <span className={`workflow-status-badge workflow-status-${item.status}`}>
                    {workflowLifecycleLabel[item.status]}
                  </span>
                </button>
                {canClose && (
                  <button
                    aria-label={item.closeLabel || `关闭流程 ${item.title}`}
                    className="workflow-navigator-close"
                    onClick={() => onClose(item.id)}
                    title={item.closeTitle || (terminal ? "关闭流程视图" : "放弃当前流程")}
                    type="button"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {completedCount > 0 && (
        <button className="workflow-collapse-button" onClick={onToggleCompleted} type="button">
          {collapseCompleted ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          {collapseCompleted ? "展开已完成" : "折叠已完成"}
        </button>
      )}
    </aside>
  );
}

function WorkspaceBlankState({
  actionLabel,
  description,
  onAction
}: {
  actionLabel: string;
  description: string;
  onAction: () => void;
}): JSX.Element {
  return (
    <section className="workspace-blank-state">
      <ImagePlus size={38} />
      <div>
        <strong>{description}</strong>
      </div>
      <button className="primary-button" onClick={onAction} type="button">
        <ImagePlus size={18} />
        {actionLabel}
      </button>
    </section>
  );
}

function GenerationWorkspace({
  backendActionLabel,
  backendReady,
  collapsedTaskIds,
  copiedKey,
  error,
  formLocked,
  isGenerating,
  lineageMarker,
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
  formLocked: boolean;
  isGenerating: boolean;
  lineageMarker: WorkflowLineageMarker;
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
            <p>可导入解析结果，也可直接填写提示词；是否发送图片只由参考图列表决定。</p>
          </div>
          <button className="secondary-button" onClick={onOpenConfig} type="button">
            <Settings size={17} />
            {backendActionLabel}
          </button>
        </div>

        <fieldset className="workflow-form-fieldset" disabled={formLocked}>
        <div className="import-row">
          {options.length === 0 ? (
            <p className="empty-text">可直接在下方填写完整提示词；完成图片分析后，解析结果导入项会显示在这里。</p>
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
          <div
            className={`generation-source-strip${promptSource.sourceThumbnailDataUrl ? "" : " without-thumbnail"}`}
          >
            {promptSource.sourceThumbnailDataUrl && <img alt="" src={promptSource.sourceThumbnailDataUrl} />}
            <div className="workflow-source-copy">
              <div className="workflow-lineage-heading">
                <WorkflowLineageBadge marker={lineageMarker} />
                <strong>{promptSource.label}</strong>
              </div>
              <small>
                {promptSource.sourceFileName
                  ? `${promptSource.sourceFileName} · `
                  : promptSource.kind === "manual"
                    ? ""
                    : "解析来源图 · "}
                {new Date(promptSource.importedAt).toLocaleString("zh-CN")}
              </small>
            </div>
          </div>
        )}

        <div className={`generation-mode-notice${referenceImages.length ? " with-references" : ""}`}>
          <strong>
            {referenceImages.length
              ? `当前模式：参考图生成，将发送 ${referenceImages.length} 张图片给生图模型`
              : "当前模式：文生图，不发送图片给生图模型"}
          </strong>
          <span>
            {referenceImages.length
              ? "解析来源图仍只用于来源展示和左右对比。"
              : "需要指定人物、产品或物体时，再主动添加参考图。"}
          </span>
        </div>

        <label className="generation-prompt-field">
          <span>生图提示词</span>
          <textarea
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="可直接填写完整提示词，也可从提示词提取页导入。这里的编辑不会写回原始分析结果。"
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
          onDragOver={formLocked ? undefined : (event) => event.preventDefault()}
          onDrop={formLocked ? undefined : onReferenceDrop}
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
        </fieldset>
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
                      disabled={isTaskActive}
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
                      {!isTaskActive && (
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
                      )}
                      {hasGeneratedOutputs && (
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
                              {(task.promptSource.sourceImageDataUrl || task.promptSource.sourceThumbnailDataUrl) && (
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
                              )}
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
  activeTool,
  annotationColor,
  annotationText,
  annotations,
  backendActionLabel,
  backendReady,
  collapsedTaskIds,
  error,
  formLocked,
  instruction,
  isCreating,
  isResolvingAnnotations,
  isDragging,
  lineageMarker,
  onCancelResolution,
  onCancelTask,
  onClearAnnotations,
  onClearTasks,
  onCreateTask,
  onResolveAnnotations,
  onDeleteTask,
  onDownloadOutput,
  onContinueFromOutput,
  onOpenCompare,
  onOpenConfig,
  onOpenOutputPreview,
  onPickSource,
  onRetryTask,
  onSetTasksCollapsed,
  onToggleTaskCollapsed,
  onSetAnnotationResolution,
  onSetAnnotations,
  onSetActiveTool,
  onSetAnnotationColor,
  onSetAnnotationText,
  onSetInstruction,
  onSetRegenerationContext,
  onSetSettings,
  onSourceDragLeave,
  onSourceDragOver,
  onSourceDrop,
  onUpdateTaskVisibility,
  selectedTaskId,
  settings,
  source,
  regenerationContext,
  annotationResolution,
  tasks,
  workflowId
}: {
  activeTool: ImageEditTool;
  annotationColor: string;
  annotationText: string;
  annotations: ImageEditAnnotation[];
  backendActionLabel: string;
  backendReady: boolean;
  collapsedTaskIds: string[];
  error: string;
  formLocked: boolean;
  instruction: string;
  isCreating: boolean;
  isResolvingAnnotations: boolean;
  isDragging: boolean;
  lineageMarker: WorkflowLineageMarker;
  onCancelResolution: () => void;
  onCancelTask: (id: string) => void;
  onClearAnnotations: () => void;
  onClearTasks: () => void;
  onCreateTask: () => void;
  onResolveAnnotations: () => void;
  onDeleteTask: (id: string) => void;
  onDownloadOutput: (task: ImageEditTask, outputs: ImageEditOutput[]) => void;
  onContinueFromOutput: (task: ImageEditTask, output: ImageEditOutput, index: number) => void;
  onOpenCompare: (task: ImageEditTask, output: ImageEditOutput) => void;
  onOpenConfig: () => void;
  onOpenOutputPreview: (task: ImageEditTask, output: ImageEditOutput, index: number) => void;
  onPickSource: () => void;
  onRetryTask: (task: ImageEditTask) => void;
  onSetTasksCollapsed: (taskIds: string[], collapsed: boolean) => void;
  onToggleTaskCollapsed: (taskId: string) => void;
  onSetAnnotationResolution: Dispatch<SetStateAction<ImageEditAnnotationResolution | null>>;
  onSetAnnotations: Dispatch<SetStateAction<ImageEditAnnotation[]>>;
  onSetActiveTool: (value: ImageEditTool) => void;
  onSetAnnotationColor: (value: string) => void;
  onSetAnnotationText: (value: string) => void;
  onSetInstruction: (value: string) => void;
  onSetRegenerationContext: Dispatch<SetStateAction<ImageEditRegenerationContext | null>>;
  onSetSettings: Dispatch<SetStateAction<ImageEditRequestSettings>>;
  onSourceDragLeave: () => void;
  onSourceDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onSourceDrop: (event: DragEvent<HTMLDivElement>) => void;
  onUpdateTaskVisibility: (id: string, visibility: ImageEditTaskVisibility) => void;
  selectedTaskId: string;
  settings: ImageEditRequestSettings;
  source: ImageEditSourceImage | null;
  regenerationContext: ImageEditRegenerationContext | null;
  annotationResolution: ImageEditAnnotationResolution | null;
  tasks: ImageEditTask[];
  workflowId: string;
}): JSX.Element {
  const [showHiddenTasks, setShowHiddenTasks] = useState(false);
  const hiddenTaskCount = useMemo(() => tasks.filter((task) => imageEditTaskVisibility(task) !== "active").length, [tasks]);
  const visibleTasks = useMemo(
    () => tasks.filter((task) => (showHiddenTasks ? imageEditTaskVisibility(task) !== "active" : imageEditTaskVisibility(task) === "active")),
    [showHiddenTasks, tasks]
  );
  const completedVisibleTaskIds = useMemo(
    () =>
      visibleTasks
        .filter((task) => task.status === "succeeded" || task.status === "partial_failed")
        .map((task) => task.id),
    [visibleTasks]
  );
  const areCompletedTasksCollapsed =
    completedVisibleTaskIds.length > 0 && completedVisibleTaskIds.every((taskId) => collapsedTaskIds.includes(taskId));
  const hasLocalEditNotes = annotations.some((annotation) => annotation.note?.trim());
  const sourceExactSize = source?.width && source.height ? `${source.width}x${source.height}` : "";
  const canCreateTask = Boolean(
    source &&
      (instruction.trim() || hasLocalEditNotes) &&
      annotations.length > 0 &&
      annotationResolution?.status === "confirmed"
  );
  const updateAnnotationNote = (id: string, note: string) => {
    onSetAnnotations((current) =>
      current.map((annotation) => (annotation.id === id ? { ...annotation, note, text: annotation.tool === "text" ? note : annotation.text } : annotation))
    );
  };
  const deleteAnnotation = (id: string) => {
    onSetAnnotations((current) => current.filter((annotation) => annotation.id !== id));
  };
  const updateResolvedAnnotation = (
    index: number,
    update: Partial<ImageEditAnnotationResolution["items"][number]>
  ) => {
    onSetAnnotationResolution((current) =>
      current
        ? {
            ...current,
            status: "needs_review",
            confirmedAt: undefined,
            items: current.items.map((item) =>
              item.index === index ? { ...item, ...update, userConfirmed: update.userConfirmed ?? false } : item
            )
          }
        : current
    );
  };
  const confirmResolvedAnnotations = () => {
    onSetAnnotationResolution((current) => {
      if (!current) return current;
      const normalizedItems = current.items.map((item) => ({
        ...item,
        preserve: normalizeImageEditLineItems(item.preserve),
        spatialAnchors: normalizeImageEditLineItems(item.spatialAnchors)
      }));
      const incomplete = normalizedItems.some(
        (item) =>
          !item.userConfirmed ||
          !item.targetObject.trim() ||
          !item.requestedChange.trim() ||
          Boolean(item.originalText?.trim()) !== Boolean(item.replacementText?.trim())
      );
      if (incomplete) return { ...current, items: normalizedItems };
      return { ...current, items: normalizedItems, status: "confirmed", confirmedAt: new Date().toISOString() };
    });
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

        {isResolvingAnnotations && (
          <div className="button-row workflow-operation-actions">
            <span>修改意图解析中</span>
            <button className="secondary-button" onClick={onCancelResolution} type="button">
              <X size={17} />
              取消解析
            </button>
          </div>
        )}

        <fieldset className={`workflow-form-fieldset ${formLocked ? "locked" : ""}`} disabled={formLocked}>
        <div
          className={`image-edit-source-zone ${isDragging ? "dragging" : ""}`}
          onDragLeave={formLocked ? undefined : onSourceDragLeave}
          onDragOver={formLocked ? undefined : onSourceDragOver}
          onDrop={formLocked ? undefined : onSourceDrop}
        >
          {source ? (
            <div className="image-edit-source-strip">
              <img alt="" src={source.thumbnailDataUrl || source.dataUrl} />
              <div className="workflow-source-copy">
                <div className="workflow-lineage-heading">
                  <WorkflowLineageBadge marker={lineageMarker} />
                  <strong>{source.name}</strong>
                </div>
                <small>
                  {sourceExactSize || "源图尺寸待识别"} · 输出 {settings.size}
                </small>
              </div>
              <button className="secondary-button" onClick={onPickSource} type="button">
                <Upload size={17} />
                更换源图
              </button>
            </div>
          ) : (
            <button className="image-edit-empty-source" onClick={onPickSource} type="button">
              <ImagePlus size={42} />
              <strong>导入改图源图</strong>
              <span>支持选择、拖拽、{pasteShortcut}</span>
            </button>
          )}
        </div>

        {source ? (
          <ImageEditAnnotationBoard
            key={workflowId}
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
                onClick={() => onSetActiveTool(tool.value)}
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
              onChange={(event) => onSetAnnotationColor(event.target.value)}
              type="color"
              value={annotationColor}
            />
          </label>
          <label className="image-edit-text-input">
            <span>当前标注要求</span>
            <input
              onChange={(event) => onSetAnnotationText(event.target.value)}
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

        <section className="image-edit-regeneration-panel">
          <details className="image-edit-origin-details" open={!regenerationContext?.basePrompt.trim()}>
            <summary>
              <strong>生成依据</strong>
              <span>
                {regenerationContext?.sourceLabel || "手动导入"} · 原始参考图 {regenerationContext?.originalReferences.length || 0}
              </span>
            </summary>
              <label className="generation-prompt-field image-edit-instruction">
                <span>原始生图提示词</span>
                <textarea
                  onChange={(event) =>
                    onSetRegenerationContext((current) => ({
                      ...(current || {
                        sourceLabel: "手动导入源图",
                        importedAt: new Date().toISOString(),
                        inputStrategy: "text_only",
                        originalReferences: []
                      }),
                      basePrompt: event.target.value
                    }))
                  }
                  placeholder="从生图输出进入时自动使用第一次生图的原始提示词；手动导入时必须填写完整基础提示词。"
                  value={regenerationContext?.basePrompt || ""}
                />
              </label>
              {(regenerationContext?.originalReferences.length || 0) > 0 ? (
                <div className="image-edit-origin-reference-list">
                  {regenerationContext?.originalReferences.map((reference) => (
                    <figure key={reference.id}>
                      <img alt="原始主体参考图" src={reference.thumbnailDataUrl || reference.dataUrl} />
                      <figcaption>{reference.name}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <p className="image-edit-fidelity-warning strong">
                  <AlertCircle size={15} />
                  <span>没有原始参考图，将使用纯文字重生成。</span>
                </p>
              )}
          </details>
              <button
                className="secondary-button"
                disabled={
                  isResolvingAnnotations ||
                  !source ||
                  !annotations.length ||
                  !regenerationContext?.basePrompt.trim() ||
                  annotations.some((annotation) => !annotation.note?.trim())
                }
                onClick={onResolveAnnotations}
                type="button"
              >
                {isResolvingAnnotations ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
                {isResolvingAnnotations
                  ? "修改意图解析中"
                  : annotationResolution
                    ? "重新解析修改清单"
                    : "解析修改清单"}
              </button>
              {annotationResolution && (
                <section className="image-edit-resolution-list">
                  <div className="image-edit-annotation-list-header">
                    <strong>修改清单确认</strong>
                    <small>
                      {annotationResolution.source === "manual_fallback" ? "手动清单" : `视觉解析 · ${annotationResolution.modelName || "当前模型"}`}
                    </small>
                  </div>
                  {annotationResolution.items.map((item) => (
                    <div className="image-edit-resolution-item" key={item.index}>
                      <div className="image-edit-resolution-heading">
                        <strong>局部修订 {item.index}</strong>
                        <span className={item.confidence < 0.8 || item.ambiguity ? "needs-review" : ""}>
                          置信度 {Math.round(item.confidence * 100)}%
                        </span>
                      </div>
                      <label>
                        修改对象
                        <input
                          onChange={(event) => updateResolvedAnnotation(item.index, { targetObject: event.target.value })}
                          value={item.targetObject}
                        />
                      </label>
                      <label>
                        目标修改
                        <textarea
                          onChange={(event) => updateResolvedAnnotation(item.index, { requestedChange: event.target.value })}
                          value={item.requestedChange}
                        />
                      </label>
                      <label>
                        必须保留项（每行一项）
                        <textarea
                          onChange={(event) =>
                            updateResolvedAnnotation(item.index, {
                              preserve: imageEditLineItemsFromInput(event.target.value)
                            })
                          }
                          value={item.preserve.join("\n")}
                        />
                      </label>
                      <details className="image-edit-resolution-details">
                        <summary>定位与文字（按需检查）</summary>
                        <label>
                          当前状态
                          <textarea
                            onChange={(event) => updateResolvedAnnotation(item.index, { currentState: event.target.value })}
                            value={item.currentState}
                          />
                        </label>
                        <label>
                          空间锚点（选填，每行一项）
                          <textarea
                            onChange={(event) =>
                              updateResolvedAnnotation(item.index, {
                                spatialAnchors: imageEditLineItemsFromInput(event.target.value)
                              })
                            }
                            value={item.spatialAnchors.join("\n")}
                          />
                        </label>
                        <div className="image-edit-resolution-text-row">
                          <label>
                            原文字（换字时填写）
                            <input
                              onChange={(event) => updateResolvedAnnotation(item.index, { originalText: event.target.value })}
                              value={item.originalText || ""}
                            />
                          </label>
                          <label>
                            新文字（换字时填写）
                            <input
                              onChange={(event) => updateResolvedAnnotation(item.index, { replacementText: event.target.value })}
                              value={item.replacementText || ""}
                            />
                          </label>
                        </div>
                      </details>
                      {item.ambiguity && <p className="generation-task-error">{item.ambiguity}</p>}
                      <label className="image-edit-pixel-toggle">
                        <input
                          checked={item.userConfirmed}
                          onChange={(event) => updateResolvedAnnotation(item.index, { userConfirmed: event.target.checked })}
                          type="checkbox"
                        />
                        我已检查此编号的对象、修改和保留项
                      </label>
                    </div>
                  ))}
                  <button
                    className="secondary-button"
                    disabled={annotationResolution.items.some(
                      (item) =>
                        !item.userConfirmed ||
                        !item.targetObject.trim() ||
                        !item.requestedChange.trim() ||
                        Boolean(item.originalText?.trim()) !== Boolean(item.replacementText?.trim())
                    )}
                    onClick={confirmResolvedAnnotations}
                    type="button"
                  >
                    <Check size={17} />
                    {annotationResolution.status === "confirmed" ? "修改清单已确认" : "确认修改清单"}
                  </button>
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
            <small>1-4 张候选图</small>
          </label>
        </div>

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
            title={backendReady ? "生成修订版" : "点击后会重新检查生图后端配置"}
            type="button"
          >
            {isCreating ? <Loader2 className="spin" size={18} /> : <PenLine size={18} />}
            生成修订版
          </button>
        </div>
        </fieldset>
      </section>

      <section className="generation-results">
        <div className="generation-results-header">
          <div>
            <h2>改图任务</h2>
            <p>改图任务保存在独立数据域，不会写入图片分析历史或生图历史。</p>
          </div>
          {tasks.length > 0 && (
            <div className="generation-results-actions">
              {completedVisibleTaskIds.length > 0 && (
                <button
                  className="secondary-button"
                  onClick={() => onSetTasksCollapsed(completedVisibleTaskIds, !areCompletedTasksCollapsed)}
                  type="button"
                >
                  {areCompletedTasksCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                  {areCompletedTasksCollapsed ? "展开已完成" : "收起已完成"}
                </button>
              )}
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
              const isLegacyTask = task.fidelityMode !== "origin_regenerate";
              const obsoleteInfoPattern = /Source-Locked|本地保护|严格 mask|参考生图|像素级保真|尺寸门禁拒绝：canonical source/i;
              const visibleTaskError = isLegacyTask
                ? ""
                : (task.error || "")
                    .split(/(?<=。)\s*/)
                    .filter((message) => message && !obsoleteInfoPattern.test(message))
                    .join(" ");
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
                      <button
                        className="history-delete-button"
                        disabled={isCreating || isTaskActive}
                        onClick={() => onDeleteTask(task.id)}
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
                          <button className="secondary-button" onClick={() => onCancelTask(task.id)} type="button">
                            <X size={16} />
                            取消
                          </button>
                        )}
                        {!isTaskActive && !isLegacyTask && (
                          <button
                            className="secondary-button"
                            disabled={isCreating}
                            onClick={() => onRetryTask(task)}
                            type="button"
                          >
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
                            批量下载（{task.outputs.length}）
                          </button>
                        )}
                      </div>
                      <div className="generation-task-size-summary">
                        <span>目标尺寸：{task.settings.size}</span>
                        <span>
                          候选图：{task.outputs.length ? `${task.outputs.length}/${task.settings.n}` : `${task.settings.n} 张`}
                        </span>
                        {isLegacyTask && <span>旧任务只读</span>}
                      </div>
                      {visibleTaskError && (
                        <p className="generation-task-error">
                          <AlertCircle size={15} />
                          {visibleTaskError}
                        </p>
                      )}
                      {!isLegacyTask && (
                        <details className="image-edit-task-prompt-details">
                          <summary>查看本次提示词</summary>
                          <p className="generation-task-prompt">{task.finalPrompt}</p>
                        </details>
                      )}
                      {task.outputs.length > 0 && (
                        <div className="generation-output-grid">
                          {task.outputs.map((output, index) => (
                            <figure className="generation-output" key={output.id}>
                              <button
                                className="generation-output-preview"
                                onClick={() => onOpenOutputPreview(task, output, index)}
                                title="查看改图输出大图"
                                type="button"
                              >
                                <img alt="改图输出" src={output.dataUrl} />
                                <span className="preview-corner-icon" aria-hidden="true">
                                  <Maximize2 size={18} />
                                </span>
                              </button>
                              <div className={output.error ? "generation-output-meta has-error" : "generation-output-meta"}>
                                <span>候选 {index + 1}/{task.outputs.length}</span>
                                <span>{output.actualSize || output.requestedSize || task.settings.size}</span>
                              </div>
                              {output.warnings?.filter((warning) => !obsoleteInfoPattern.test(warning)).map((warning) => (
                                <p className="generation-output-error" key={warning}>{warning}</p>
                              ))}
                              <figcaption>
                                <button className="secondary-button" onClick={() => onOpenCompare(task, output)} type="button">
                                  <Maximize2 size={16} />
                                  左右对比
                                </button>
                                <button className="secondary-button" onClick={() => onDownloadOutput(task, [output])} type="button">
                                  <Download size={16} />
                                  下载
                                </button>
                                <button
                                  className="secondary-button"
                                  onClick={() => onContinueFromOutput(task, output, index)}
                                  type="button"
                                >
                                  <PenLine size={16} />
                                  继续改图
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

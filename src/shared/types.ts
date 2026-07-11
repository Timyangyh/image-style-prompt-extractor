export type ImagePrimaryType =
  | "product_image"
  | "poster"
  | "infographic"
  | "chart_or_dashboard"
  | "social_media_banner"
  | "photography"
  | "illustration"
  | "ui_screenshot"
  | "mixed_layout";

export interface ModelConfig {
  apiBaseUrl: string;
  modelName: string;
  saveApiKey: boolean;
  hasApiKey: boolean;
}

export interface ModelConfigUpdate {
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  saveApiKey: boolean;
}

export type GenerationApiMode = "images" | "responses";
export type GenerationAuthSource = "api" | "codex_oauth";
export type GenerationProviderType = "openai_compatible" | "openrouter";
export type GenerationResolution = "1k" | "2k" | "4k";
export type GenerationAspectRatio =
  | "1:1"
  | "4:5"
  | "5:4"
  | "3:4"
  | "4:3"
  | "2:3"
  | "3:2"
  | "9:16"
  | "16:9"
  | "9:21"
  | "21:9";
export type GenerationPromptMode = "original" | "strict" | "creative";
export type GenerationTaskStatus = "queued" | "running" | "succeeded" | "partial_failed" | "failed" | "canceled";
export type GenerationTaskVisibility = "active" | "archived" | "hidden";
export type GenerationRequestSizeStrategy =
  | "exact_size"
  | "openrouter_normalized"
  | "openrouter_aspect_ratio";
export type GenerationPromptSourceKind =
  | "universal"
  | "layout"
  | "negative"
  | "template"
  | "information_layout"
  | "style_terms"
  | "fused_prompt"
  | "fused_copy_ready";

export interface GenerationConfig {
  authSource: GenerationAuthSource;
  activeProviderId: string;
  providers: GenerationProviderConfig[];
  providerType: GenerationProviderType;
  apiBaseUrl: string;
  apiMode: GenerationApiMode;
  imageModel: string;
  mainModel: string;
  saveApiKey: boolean;
  hasApiKey: boolean;
  codexOAuthAvailable: boolean;
  codexOAuthPath: string;
  codexOAuthAccountId?: string;
  codexOAuthLastRefresh?: string;
  codexOAuthError?: string;
  imagesConcurrency: number;
}

export interface GenerationConfigUpdate {
  authSource: GenerationAuthSource;
  activeProviderId?: string;
  providerName?: string;
  providerType: GenerationProviderType;
  apiBaseUrl: string;
  apiKey: string;
  apiMode: GenerationApiMode;
  imageModel: string;
  mainModel: string;
  saveApiKey: boolean;
  imagesConcurrency: number;
}

export interface GenerationProviderConfig {
  id: string;
  name: string;
  providerType: GenerationProviderType;
  apiBaseUrl: string;
  apiMode: GenerationApiMode;
  imageModel: string;
  mainModel: string;
  saveApiKey: boolean;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationProviderConfigUpdate {
  id?: string;
  name: string;
  providerType: GenerationProviderType;
  apiBaseUrl: string;
  apiKey: string;
  apiMode: GenerationApiMode;
  imageModel: string;
  mainModel: string;
  saveApiKey: boolean;
}

export interface GenerationReferenceImage {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  thumbnailDataUrl: string;
  createdAt: string;
}

export interface GenerationPromptSource {
  kind: GenerationPromptSourceKind;
  label: string;
  historyItemId?: string;
  sourceImageDataUrl?: string;
  sourceThumbnailDataUrl?: string;
  sourceFileName?: string;
  importedAt: string;
}

export interface GenerationRequestSettings {
  apiMode: GenerationApiMode;
  imageModel: string;
  mainModel: string;
  resolution: GenerationResolution;
  aspectRatio: GenerationAspectRatio;
  size: string;
  quality: "auto" | "low" | "medium" | "high";
  outputFormat: "png" | "jpeg" | "webp";
  outputCompression?: number;
  moderation: "auto" | "low";
  background: "auto" | "opaque" | "transparent";
  promptMode: GenerationPromptMode;
  n: number;
}

export interface GenerationCreateRequest {
  prompt: string;
  promptSource: GenerationPromptSource;
  referenceImages: GenerationReferenceImage[];
  settings: GenerationRequestSettings;
}

export interface GenerationBackendSnapshot {
  authSource: GenerationAuthSource;
  providerType: GenerationProviderType;
  providerName?: string;
  apiBaseUrl?: string;
  apiMode: GenerationApiMode;
  imageModel: string;
  mainModel: string;
}

export interface GenerationOutput {
  id: string;
  createdAt: string;
  dataUrl: string;
  mimeType: string;
  revisedPrompt?: string;
  size?: string;
  requestedSize?: string;
  actualSize?: string;
  actualWidth?: number;
  actualHeight?: number;
  sizeMismatch?: boolean;
  backendActualSize?: string;
  backendActualWidth?: number;
  backendActualHeight?: number;
  localResizeApplied?: boolean;
  requestSizeStrategy?: GenerationRequestSizeStrategy;
  warnings?: string[];
  quality?: string;
  background?: string;
  usage?: Record<string, unknown>;
  error?: string;
}

export interface GenerationOutputSaveItem {
  taskId: string;
  outputId: string;
  dataUrl: string;
  mimeType: string;
  suggestedFileName: string;
}

export interface GenerationOutputsSaveRequest {
  outputs: GenerationOutputSaveItem[];
}

export interface GenerationOutputsSaveResult {
  canceled: boolean;
  filePaths: string[];
  directoryPath?: string;
}

export interface GenerationTaskVisibilityUpdate {
  id: string;
  visibility: GenerationTaskVisibility;
}

export interface GenerationTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  status: GenerationTaskStatus;
  visibility?: GenerationTaskVisibility;
  archivedAt?: string;
  hiddenAt?: string;
  prompt: string;
  finalPrompt: string;
  promptSource: GenerationPromptSource;
  referenceImages: GenerationReferenceImage[];
  settings: GenerationRequestSettings;
  backend?: GenerationBackendSnapshot;
  outputs: GenerationOutput[];
  error?: string;
}

export type ImageEditTaskStatus = GenerationTaskStatus;
export type ImageEditTaskVisibility = GenerationTaskVisibility;
export type ImageEditSourceKind = "uploaded_image" | "clipboard_image" | "generation_output" | "restored_edit_output";
export type ImageEditFidelityMode = "origin_regenerate";
export type ImageEditStoredFidelityMode = ImageEditFidelityMode | "reference" | "strict_mask";
export type ImageEditRegenerationInputStrategy = "original_references" | "text_only";

export interface ImageEditSourcePointer {
  kind: ImageEditSourceKind;
  historyItemId?: string;
  generationTaskId?: string;
  generationOutputId?: string;
  imageEditTaskId?: string;
  imageEditOutputId?: string;
  importedAt: string;
}

export interface ImageEditSourceImage {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  thumbnailDataUrl: string;
  assetFileName?: string;
  width?: number;
  height?: number;
  createdAt: string;
  sourcePointer: ImageEditSourcePointer;
}

export interface ImageEditModelInputImage {
  mimeType: "image/png";
  dataUrl: string;
  assetFileName?: string;
  width: number;
  height: number;
  createdAt: string;
  reason: "strict_mask" | "unsupported_source_format";
}

export interface ImageEditSourceIntegrity {
  actualMimeType: "image/png" | "image/jpeg" | "image/webp";
  byteLength: number;
  width: number;
  height: number;
  pixelCount: number;
  sha256: string;
  canonicalBytesPreserved: true;
}

export interface ImageEditAnnotationImage {
  mimeType: string;
  dataUrl: string;
  thumbnailDataUrl?: string;
  assetFileName?: string;
  itemCount: number;
  createdAt: string;
}

export interface ImageEditMaskImage {
  mimeType: string;
  dataUrl: string;
  thumbnailDataUrl?: string;
  assetFileName?: string;
  itemCount: number;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface ImageEditMaskStats {
  width?: number;
  height?: number;
  transparentRatio?: number;
  bbox?: string;
  itemCount: number;
  corePixelCount?: number;
  componentCount?: number;
  maxComponentLongestSideRatio?: number;
  gateRejectionReasons?: string[];
  warnings?: string[];
}

export interface ImageEditLocalProtectionMaskImage extends ImageEditMaskImage {
  purpose: "local_protection";
  stats?: ImageEditMaskStats;
}

export interface ImageEditLocalProtectionEligibility {
  requested: boolean;
  eligible: boolean;
  reasons: string[];
}

export type ImageEditCompositorVersion = "source_locked_v2";

export interface ImageEditCompositeComponentAudit {
  index: number;
  pixelCount: number;
  bbox: string;
  longestSideRatio: number;
  boundarySampleCount: number;
  boundaryRgbP95: number;
  boundaryRgbP99: number;
  boundaryGradientP95: number;
}

export interface ImageEditCompositeAudit {
  status: "pending" | "passed" | "rejected" | "legacy_unverified";
  compositorVersion?: ImageEditCompositorVersion;
  evaluatedAt?: string;
  reasons: string[];
  width?: number;
  height?: number;
  corePixelCount?: number;
  coreRatio?: number;
  componentCount?: number;
  maxComponentLongestSideRatio?: number;
  boundarySampleCount?: number;
  boundaryRgbP95?: number;
  boundaryRgbP99?: number;
  boundaryGradientP95?: number;
  transitionWidth?: number;
  outsideCoreChangedPixels?: number;
  invalidAlphaPixels?: number;
  components?: ImageEditCompositeComponentAudit[];
}

export type ImageEditAnnotationTool = "brush" | "arrow" | "box" | "text";

export interface ImageEditPoint {
  x: number;
  y: number;
}

export type ImageEditAnnotationGeometry =
  | {
      tool: "box";
      left: number;
      top: number;
      right: number;
      bottom: number;
      centerX: number;
      centerY: number;
      width: number;
      height: number;
    }
  | {
      tool: "arrow";
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    }
  | {
      tool: "brush";
      left: number;
      top: number;
      right: number;
      bottom: number;
      centerX: number;
      centerY: number;
      coverageRatio: number;
      effectiveLineWidth: number;
    }
  | {
      tool: "text";
      anchorX: number;
      anchorY: number;
      text: string;
    };

export interface ImageEditAnnotationItem {
  index: number;
  label: string;
  tool: ImageEditAnnotationTool;
  note: string;
  positionHint?: string;
  geometry?: ImageEditAnnotationGeometry;
}

export interface ImageEditResolvedAnnotation {
  index: number;
  targetObject: string;
  currentState: string;
  requestedChange: string;
  preserve: string[];
  spatialAnchors: string[];
  originalText?: string;
  replacementText?: string;
  confidence: number;
  ambiguity: string;
  userConfirmed: boolean;
}

export interface ImageEditAnnotationResolution {
  contentHash: string;
  status: "needs_review" | "confirmed";
  source: "vision_model" | "manual_fallback";
  modelName?: string;
  createdAt: string;
  confirmedAt?: string;
  items: ImageEditResolvedAnnotation[];
}

export interface ImageEditAnnotationResolveRequest {
  sourceImageDataUrl: string;
  annotationImageDataUrl: string;
  annotationItems: ImageEditAnnotationItem[];
  instruction: string;
  basePrompt: string;
}

export interface ImageEditAnnotationResolveResponse {
  resolution: ImageEditAnnotationResolution;
  fallbackReason?: string;
}

export interface ImageEditOriginReference extends GenerationReferenceImage {
  assetFileName?: string;
  width?: number;
  height?: number;
  byteLength?: number;
  sha256?: string;
}

export interface ImageEditRegenerationContext {
  basePrompt: string;
  generationTaskId?: string;
  generationOutputId?: string;
  sourceLabel: string;
  importedAt: string;
  inputStrategy: ImageEditRegenerationInputStrategy;
  originalReferences: ImageEditOriginReference[];
}

export interface ImageEditRequestSettings {
  apiMode: GenerationApiMode;
  imageModel: string;
  mainModel: string;
  resolution: GenerationResolution;
  aspectRatio: GenerationAspectRatio;
  size: string;
  quality: GenerationRequestSettings["quality"];
  outputFormat: GenerationRequestSettings["outputFormat"];
  outputCompression?: number;
  moderation: GenerationRequestSettings["moderation"];
  background: GenerationRequestSettings["background"];
  n: number;
}

export interface ImageEditCreateRequest {
  sourceImage: ImageEditSourceImage;
  sourceIntegrity?: ImageEditSourceIntegrity;
  annotationImage: ImageEditAnnotationImage;
  annotationItems?: ImageEditAnnotationItem[];
  annotationResolution?: ImageEditAnnotationResolution;
  regenerationContext?: ImageEditRegenerationContext;
  fidelityMode?: ImageEditFidelityMode;
  instruction: string;
  settings: ImageEditRequestSettings;
}

export interface ImageEditBackendSnapshot {
  authSource: GenerationAuthSource;
  providerType: GenerationProviderType;
  providerName?: string;
  apiBaseUrl?: string;
  apiMode: GenerationApiMode;
  imageModel: string;
  mainModel: string;
}

export interface ImageEditDiagnostics {
  backendType?: "codex_oauth" | "openai_compatible" | "openrouter";
  apiMode: GenerationApiMode;
  providerType?: GenerationProviderType;
  model?: string;
  requestedSize?: string;
  outputFormat?: GenerationRequestSettings["outputFormat"];
  sourceImage?: { width?: number; height?: number; mimeType?: string };
  annotationImage?: { width?: number; height?: number; itemCount?: number };
  regenerationInputStrategy?: ImageEditRegenerationInputStrategy;
  originReferenceCount?: number;
  annotationResolutionSource?: ImageEditAnnotationResolution["source"];
  annotationResolutionStatus?: ImageEditAnnotationResolution["status"];
  currentSourceSubmitted?: boolean;
  annotationImageSubmitted?: boolean;
}

export interface ImageEditOutputVariant {
  kind: "pixel_protected";
  dataUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
  assetFileName?: string;
  createdAt: string;
  compositorVersion?: ImageEditCompositorVersion;
  verified?: boolean;
  warnings?: string[];
}

export interface ImageEditOutput {
  id: string;
  createdAt: string;
  dataUrl: string;
  mimeType: string;
  assetFileName?: string;
  revisedPrompt?: string;
  size?: string;
  requestedSize?: string;
  actualSize?: string;
  actualWidth?: number;
  actualHeight?: number;
  sizeMismatch?: boolean;
  warnings?: string[];
  error?: string;
  compositeAudit?: ImageEditCompositeAudit;
  protectedVariant?: ImageEditOutputVariant;
  protectedVariantUnavailableReason?: string;
}

export interface ImageEditTaskVisibilityUpdate {
  id: string;
  visibility: ImageEditTaskVisibility;
}

export interface ImageEditOutputSaveItem {
  taskId: string;
  outputId: string;
  dataUrl: string;
  mimeType: string;
  suggestedFileName: string;
}

export interface ImageEditOutputsSaveRequest {
  outputs: ImageEditOutputSaveItem[];
}

export type ImageEditOutputsSaveResult = GenerationOutputsSaveResult;

export interface ImageEditTask {
  id: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  status: ImageEditTaskStatus;
  visibility?: ImageEditTaskVisibility;
  archivedAt?: string;
  hiddenAt?: string;
  sourceImage: ImageEditSourceImage;
  modelInputImage?: ImageEditModelInputImage;
  sourceIntegrity?: ImageEditSourceIntegrity;
  annotationImage: ImageEditAnnotationImage;
  maskImage?: ImageEditMaskImage;
  localProtectionMaskImage?: ImageEditLocalProtectionMaskImage;
  annotationItems: ImageEditAnnotationItem[];
  annotationResolution?: ImageEditAnnotationResolution;
  regenerationContext?: ImageEditRegenerationContext;
  fidelityMode: ImageEditStoredFidelityMode;
  pixelProtectionEnabled?: boolean;
  localProtectionEligibility?: ImageEditLocalProtectionEligibility;
  compositorVersion?: ImageEditCompositorVersion;
  instruction: string;
  finalPrompt: string;
  settings: ImageEditRequestSettings;
  backend?: ImageEditBackendSnapshot;
  diagnostics?: ImageEditDiagnostics;
  outputs: ImageEditOutput[];
  error?: string;
}

export interface AnalyzeImageRequest {
  imageDataUrl: string;
  mimeType: string;
  strictGeneralization: boolean;
  sourceCapture?: SourceCapture;
}

export interface AnalyzeImageResponse {
  analysis: StyleAnalysis;
  rawText: string;
  repaired: boolean;
}

export type FusePromptMode = "subject_reference" | "information_layout";

export interface FusePromptControls {
  useTargetHair: boolean;
  useTargetPose: boolean;
  useExtractedText: boolean;
}

export interface FusePromptRequest {
  styleAnalysis: StyleAnalysis;
  mode?: FusePromptMode;
  subjectImageDataUrl?: string;
  productInfoText?: string;
  editedTextMarkdown?: string;
  controls?: FusePromptControls;
}

export interface FusedPromptJson {
  subject_reference_policy: string;
  style_transfer_scope: string;
  pose_transfer: {
    target_pose_reference: string;
    transfer_instruction: string;
    subject_identity_boundary: string;
    scene_fit_instruction: string;
    negative_prompt: string;
  };
  wardrobe_transfer: {
    target_wardrobe_style: string;
    transfer_instruction: string;
    subject_identity_boundary: string;
    scene_fit_instruction: string;
    negative_prompt: string;
  };
  style_reference: {
    universal_style_prompt: string;
    layout_prompt: string;
    color_prompt: string;
    lighting_prompt: string;
    typography_prompt: string;
    decorative_elements_prompt: string;
    negative_prompt: string;
  };
  social_cover_text_layout: {
    aspect_ratio_placeholder: string;
    top_text_placeholder: string;
    bottom_text_placeholder: string;
    typography_style: string;
    alignment_and_safe_area: string;
    text_replacement_policy: string;
  };
  information_layout_adaptation: {
    applies: boolean;
    source_layout_reference: string;
    product_information_source: string;
    content_mapping_instruction: string;
    table_or_card_structure: string;
    copy_ready_json_prompt: string;
    negative_prompt: string;
  };
  generation_guidance: {
    image_reference_instruction: string;
    style_strength: string;
    copy_ready_prompt: string;
  };
  quality_control: {
    must_preserve: string[];
    must_not_copy: string[];
    risk_notes: string[];
  };
}

export interface FusedPromptResult {
  fused_prompt: string;
  fused_prompt_json: FusedPromptJson;
  subject_policy: string;
  style_transfer_scope: string;
  risk_notes: string[];
  confidence: number;
}

export interface FusePromptResponse {
  result: FusedPromptResult;
  rawText: string;
  repaired: boolean;
}

export interface HistoryItem {
  id: string;
  createdAt: string;
  imageDataUrl?: string;
  mimeType?: string;
  fileName?: string;
  thumbnailDataUrl: string;
  primaryType: string;
  universalStylePrompt: string;
  analysis: StyleAnalysis;
  editedTextMarkdown?: string;
  fusedPromptResult?: FusedPromptResult;
  fusedPromptCreatedAt?: string;
}

export type SourceCaptureSourceType =
  | "uploaded_image"
  | "clipboard_image"
  | "browser_viewport"
  | "browser_region"
  | "browser_image";

export type SourceCaptureMode = "" | "visible_viewport" | "selected_region" | "page_image";

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  device_pixel_ratio: number;
}

export interface SourceCapture {
  source_type: SourceCaptureSourceType;
  source_url: string;
  page_title: string;
  domain: string;
  capture_mode: SourceCaptureMode;
  selection_rect: SelectionRect;
  captured_at: string;
}

export interface WebDesignContext {
  applies: boolean;
  page_style_summary: string;
  layout_system: string;
  ui_component_style: string;
  interaction_surface_style: string;
  css_token_hints: {
    colors: string[];
    font_mood: string;
    radius_style: string;
    shadow_style: string;
    spacing_density: string;
  };
}

export interface SubjectAppearanceReference {
  applies: boolean;
  subject_role_style: string;
  wardrobe_style: string;
  outfit_color_materials: string;
  hair_makeup_accessory_style: string;
  pose_expression_style: string;
  scene_fit_notes: string;
  transfer_limit: string;
}

export type StyleTermCategory =
  | "layout"
  | "color"
  | "typography"
  | "material"
  | "lighting"
  | "ui"
  | "mood"
  | "rendering";

export interface StyleTerm {
  name: string;
  category: StyleTermCategory;
  confidence: number;
  copyable: boolean;
}

export interface InformationLayoutTemplate {
  applies: boolean;
  layout_family: string;
  recommended_aspect_ratio: string;
  structure_prompt: string;
  table_or_card_layout_prompt: string;
  text_hierarchy_prompt: string;
  content_slots: EditableTemplateSlot[];
  comparison_slots: EditableTemplateSlot[];
  copy_ready_json_prompt: string;
}

export interface ExtractedTextBlock {
  applies: boolean;
  markdown: string;
  extraction_notes: string;
}

export interface StyleAnalysis {
  version: "1.3";
  analysis_mode: "style_reference_not_exact_replication";
  source_capture: SourceCapture;
  image_classification: {
    primary_type: ImagePrimaryType | "";
    secondary_types: ImagePrimaryType[];
    content_domain: string;
    visual_purpose: string;
  };
  content_abstraction: {
    original_subject_summary: string;
    reusable_subject_placeholder: string;
    text_handling_policy: "do_not_copy_exact_text";
    slot_value_policy: "leave_blank_for_user_input";
    specific_content_to_ignore: string[];
    generic_content_slots: string[];
  };
  editable_template: {
    template_usage: string;
    text_slots: EditableTemplateSlot[];
    subject_slots: EditableSubjectSlot[];
    wardrobe_slots: EditableWardrobeSlot[];
    product_or_object_slots: EditableTemplateSlot[];
    layout_keep_rules: string[];
    prompt_template: string;
  };
  information_layout_template: InformationLayoutTemplate;
  extracted_text: ExtractedTextBlock;
  style_reference: {
    universal_style_prompt: string;
    layout_prompt: string;
    color_prompt: string;
    lighting_prompt: string;
    typography_prompt: string;
    decorative_elements_prompt: string;
    negative_prompt: string;
  };
  visual_system: {
    composition: {
      layout_type: string;
      grid_or_alignment: string;
      visual_hierarchy: string;
      information_density: string;
      spacing_style: string;
      focal_area: string;
    };
    color: {
      palette: string[];
      dominant_colors: string[];
      accent_colors: string[];
      background_color_strategy: string;
      contrast_level: string;
      saturation_level: string;
      temperature: string;
    };
    typography: {
      has_text: boolean;
      font_mood: string;
      font_weight_strategy: string;
      title_body_relationship: string;
      text_block_layout: string;
      copy_exact_text: false;
    };
    product_or_object_presentation: {
      applies: boolean;
      object_positioning: string;
      background_treatment: string;
      shadow_reflection_style: string;
      material_emphasis: string;
      commercial_visual_style: string;
    };
    chart_or_infographic: {
      applies: boolean;
      chart_types: string[];
      data_visual_style: string;
      axis_grid_style: string;
      label_style: string;
      highlight_strategy: string;
      data_exactness_policy: "do_not_copy_values";
    };
    poster_or_banner: {
      applies: boolean;
      headline_position: string;
      subtext_position: string;
      callout_style: string;
      decorative_layout: string;
      campaign_mood: string;
    };
    lighting_and_depth: {
      light_type: string;
      shadow_style: string;
      depth_style: string;
      camera_angle_or_perspective: string;
      lens_feel: string;
    };
    subject_appearance: SubjectAppearanceReference;
  };
  web_design_context: WebDesignContext;
  style_terms: StyleTerm[];
  generation_guidance: {
    for_image_to_image: string;
    for_text_to_image: string;
    for_style_transfer: string;
    replaceable_content_slots: string[];
    recommended_aspect_ratio: string;
    recommended_style_strength: string;
  };
  quality_control: {
    must_preserve: string[];
    must_not_copy: string[];
    risk_notes: string[];
    confidence: number;
  };
}

export interface EditableTemplateSlot {
  slot: string;
  purpose: string;
  recommended_position: string;
  style_notes: string;
  fill_value: "";
}

export interface EditableSubjectSlot {
  slot: string;
  purpose: string;
  count_policy: string;
  recommended_position: string;
  pose_or_expression_placeholder: string;
  outfit_placeholder: string;
  style_notes: string;
  fill_value: "";
}

export interface EditableWardrobeSlot {
  slot: string;
  applies_to: string;
  style_function: string;
  fill_value: "";
}

export interface AppApi {
  getConfig: () => Promise<ModelConfig>;
  saveConfig: (config: ModelConfigUpdate) => Promise<ModelConfig>;
  analyzeImage: (request: AnalyzeImageRequest) => Promise<AnalyzeImageResponse>;
  cancelAnalyzeImage: () => Promise<void>;
  fusePrompt: (request: FusePromptRequest) => Promise<FusePromptResponse>;
  cancelFusePrompt: () => Promise<void>;
  exportJson: (payload: StyleAnalysis) => Promise<{ canceled: boolean; filePath?: string }>;
  getHistory: () => Promise<HistoryItem[]>;
  saveHistoryItem: (item: HistoryItem) => Promise<HistoryItem[]>;
  deleteHistoryItem: (id: string) => Promise<HistoryItem[]>;
  clearHistory: () => Promise<void>;
  clearConfig: () => Promise<ModelConfig>;
  clearAllLocalData: () => Promise<ModelConfig>;
  getGenerationConfig: () => Promise<GenerationConfig>;
  saveGenerationConfig: (config: GenerationConfigUpdate) => Promise<GenerationConfig>;
  saveGenerationProvider: (provider: GenerationProviderConfigUpdate) => Promise<GenerationConfig>;
  duplicateGenerationProvider: (id: string) => Promise<GenerationConfig>;
  deleteGenerationProvider: (id: string) => Promise<GenerationConfig>;
  selectGenerationProvider: (id: string) => Promise<GenerationConfig>;
  reorderGenerationProviders: (ids: string[]) => Promise<GenerationConfig>;
  getGenerationTasks: () => Promise<GenerationTask[]>;
  createGenerationTask: (request: GenerationCreateRequest) => Promise<GenerationTask>;
  cancelGenerationTask: (id: string) => Promise<GenerationTask | null>;
  updateGenerationTaskVisibility: (update: GenerationTaskVisibilityUpdate) => Promise<GenerationTask[]>;
  deleteGenerationTask: (id: string) => Promise<GenerationTask[]>;
  clearGenerationTasks: () => Promise<void>;
  saveGenerationOutputs: (request: GenerationOutputsSaveRequest) => Promise<GenerationOutputsSaveResult>;
  getImageEditTasks: () => Promise<ImageEditTask[]>;
  resolveImageEditAnnotations: (request: ImageEditAnnotationResolveRequest) => Promise<ImageEditAnnotationResolveResponse>;
  createImageEditTask: (request: ImageEditCreateRequest) => Promise<ImageEditTask>;
  cancelImageEditTask: (id: string) => Promise<ImageEditTask | null>;
  retryImageEditTask: (id: string) => Promise<ImageEditTask>;
  restoreImageEditTask: (id: string) => Promise<ImageEditTask | null>;
  updateImageEditTaskVisibility: (update: ImageEditTaskVisibilityUpdate) => Promise<ImageEditTask[]>;
  deleteImageEditTask: (id: string) => Promise<ImageEditTask[]>;
  clearImageEditTasks: () => Promise<void>;
  saveImageEditOutputs: (request: ImageEditOutputsSaveRequest) => Promise<ImageEditOutputsSaveResult>;
}

declare global {
  interface Window {
    styleExtractor: AppApi;
  }
}

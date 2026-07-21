import { contextBridge, ipcRenderer } from "electron";
import type {
  AnalyzeImageRequest,
  FusePromptRequest,
  GenerationConfigUpdate,
  GenerationCreateRequest,
  GenerationOutputsSaveRequest,
  GenerationProviderConfigUpdate,
  GenerationTaskVisibilityUpdate,
  HistoryDeleteItemRequest,
  HistoryItem,
  HistoryPatchItemRequest,
  HistorySaveItemRequest,
  ImageEditCreateRequest,
  ImageEditAnnotationResolveRequest,
  ImageEditOutputsSaveRequest,
  ImageEditTaskVisibilityUpdate,
  ModelConfigUpdate,
  StyleAnalysis
} from "../src/shared/types";

contextBridge.exposeInMainWorld("styleExtractor", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config: ModelConfigUpdate) => ipcRenderer.invoke("config:save", config),
  analyzeImage: (request: AnalyzeImageRequest) => ipcRenderer.invoke("image:analyze", request),
  cancelAnalyzeImage: (operationId?: string) => ipcRenderer.invoke("image:cancel-analysis", operationId),
  fusePrompt: (request: FusePromptRequest) => ipcRenderer.invoke("prompt:fuse", request),
  cancelFusePrompt: (operationId?: string) => ipcRenderer.invoke("prompt:cancel-fuse", operationId),
  exportJson: (payload: StyleAnalysis) => ipcRenderer.invoke("json:export", payload),
  getHistory: () => ipcRenderer.invoke("history:get"),
  getHistorySnapshot: () => ipcRenderer.invoke("history:get-snapshot"),
  saveHistoryItem: (request: HistoryItem | HistorySaveItemRequest) => ipcRenderer.invoke("history:save-item", request),
  patchHistoryItem: (request: HistoryPatchItemRequest) => ipcRenderer.invoke("history:patch-item", request),
  deleteHistoryItem: (request: string | HistoryDeleteItemRequest) =>
    ipcRenderer.invoke("history:delete-item", request),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  clearConfig: () => ipcRenderer.invoke("config:clear"),
  clearAllLocalData: () => ipcRenderer.invoke("data:clear-all"),
  getGenerationConfig: () => ipcRenderer.invoke("generation:config:get"),
  saveGenerationConfig: (config: GenerationConfigUpdate) => ipcRenderer.invoke("generation:config:save", config),
  saveGenerationProvider: (provider: GenerationProviderConfigUpdate) =>
    ipcRenderer.invoke("generation:provider:save", provider),
  duplicateGenerationProvider: (id: string) => ipcRenderer.invoke("generation:provider:duplicate", id),
  deleteGenerationProvider: (id: string) => ipcRenderer.invoke("generation:provider:delete", id),
  selectGenerationProvider: (id: string) => ipcRenderer.invoke("generation:provider:select", id),
  reorderGenerationProviders: (ids: string[]) => ipcRenderer.invoke("generation:provider:reorder", ids),
  getGenerationTasks: () => ipcRenderer.invoke("generation:tasks:get"),
  getGenerationTaskSummaries: () => ipcRenderer.invoke("generation:tasks:summaries"),
  getGenerationTask: (id: string) => ipcRenderer.invoke("generation:task:get", id),
  createGenerationTask: (request: GenerationCreateRequest) => ipcRenderer.invoke("generation:task:create", request),
  cancelGenerationTask: (id: string) => ipcRenderer.invoke("generation:task:cancel", id),
  updateGenerationTaskVisibility: (update: GenerationTaskVisibilityUpdate) =>
    ipcRenderer.invoke("generation:task:visibility", update),
  deleteGenerationTask: (id: string) => ipcRenderer.invoke("generation:task:delete", id),
  clearGenerationTasks: () => ipcRenderer.invoke("generation:tasks:clear"),
  saveGenerationOutputs: (request: GenerationOutputsSaveRequest) => ipcRenderer.invoke("generation:outputs:save", request),
  getImageEditTasks: () => ipcRenderer.invoke("imageEdit:tasks:get"),
  getImageEditTaskSummaries: () => ipcRenderer.invoke("imageEdit:tasks:summaries"),
  getImageEditTask: (id: string) => ipcRenderer.invoke("imageEdit:task:get", id),
  resolveImageEditAnnotations: (request: ImageEditAnnotationResolveRequest) =>
    ipcRenderer.invoke("imageEdit:annotations:resolve", request),
  cancelImageEditAnnotationResolution: (operationId?: string) =>
    ipcRenderer.invoke("imageEdit:annotations:cancel", operationId),
  createImageEditTask: (request: ImageEditCreateRequest) => ipcRenderer.invoke("imageEdit:task:create", request),
  cancelImageEditTask: (id: string) => ipcRenderer.invoke("imageEdit:task:cancel", id),
  retryImageEditTask: (id: string) => ipcRenderer.invoke("imageEdit:task:retry", id),
  restoreImageEditTask: (id: string) => ipcRenderer.invoke("imageEdit:task:restore", id),
  updateImageEditTaskVisibility: (update: ImageEditTaskVisibilityUpdate) =>
    ipcRenderer.invoke("imageEdit:task:visibility", update),
  deleteImageEditTask: (id: string) => ipcRenderer.invoke("imageEdit:task:delete", id),
  clearImageEditTasks: () => ipcRenderer.invoke("imageEdit:tasks:clear"),
  saveImageEditOutputs: (request: ImageEditOutputsSaveRequest) => ipcRenderer.invoke("imageEdit:outputs:save", request)
});

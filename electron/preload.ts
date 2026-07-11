import { contextBridge, ipcRenderer } from "electron";
import type {
  AnalyzeImageRequest,
  FusePromptRequest,
  GenerationConfigUpdate,
  GenerationCreateRequest,
  GenerationOutputsSaveRequest,
  GenerationProviderConfigUpdate,
  GenerationTaskVisibilityUpdate,
  HistoryItem,
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
  cancelAnalyzeImage: () => ipcRenderer.invoke("image:cancel-analysis"),
  fusePrompt: (request: FusePromptRequest) => ipcRenderer.invoke("prompt:fuse", request),
  cancelFusePrompt: () => ipcRenderer.invoke("prompt:cancel-fuse"),
  exportJson: (payload: StyleAnalysis) => ipcRenderer.invoke("json:export", payload),
  getHistory: () => ipcRenderer.invoke("history:get"),
  saveHistoryItem: (item: HistoryItem) => ipcRenderer.invoke("history:save-item", item),
  deleteHistoryItem: (id: string) => ipcRenderer.invoke("history:delete-item", id),
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
  createGenerationTask: (request: GenerationCreateRequest) => ipcRenderer.invoke("generation:task:create", request),
  cancelGenerationTask: (id: string) => ipcRenderer.invoke("generation:task:cancel", id),
  updateGenerationTaskVisibility: (update: GenerationTaskVisibilityUpdate) =>
    ipcRenderer.invoke("generation:task:visibility", update),
  deleteGenerationTask: (id: string) => ipcRenderer.invoke("generation:task:delete", id),
  clearGenerationTasks: () => ipcRenderer.invoke("generation:tasks:clear"),
  saveGenerationOutputs: (request: GenerationOutputsSaveRequest) => ipcRenderer.invoke("generation:outputs:save", request),
  getImageEditTasks: () => ipcRenderer.invoke("imageEdit:tasks:get"),
  resolveImageEditAnnotations: (request: ImageEditAnnotationResolveRequest) =>
    ipcRenderer.invoke("imageEdit:annotations:resolve", request),
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

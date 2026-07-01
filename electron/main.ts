import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import type {
  AnalyzeImageRequest,
  AnalyzeImageResponse,
  FusePromptRequest,
  FusePromptResponse,
  HistoryItem,
  GenerationOutputsSaveRequest,
  ImageEditOutputsSaveRequest,
  ImageEditProtectedVariantSaveRequest,
  ModelConfig,
  ModelConfigUpdate,
  StyleAnalysis
} from "../src/shared/types";
import { normalizeFusedPromptResult, normalizeStyleAnalysis } from "../src/shared/schema";
import { GenerationService } from "./generation";
import { ImageEditService } from "./image-edit";
import {
  dataUrlToGenerationOutputBuffer,
  generationOutputExtension,
  generationOutputFileName,
  uniqueGenerationOutputPath
} from "./generation-save";
import { buildFuseSystemPrompt, buildFuseUserPrompt, buildSystemPrompt, buildUserPrompt } from "./prompt";
import {
  ModelHttpError,
  chatCompletionsEndpoint,
  completionTextFromResponse,
  extractJsonText,
  getHistoryEntryId,
  isAbortError,
  normalizeHistory,
  normalizeHistoryItemForStorage,
  parseExtractedJson,
  readJsonFile,
  shouldRetryFusedPrompt,
  shouldRetryWithoutResponseFormat,
  writeJsonFile
} from "./main-utils";

const defaultConfig: ModelConfig = {
  apiBaseUrl: "https://api.openai.com/v1",
  modelName: "gpt-4o-mini",
  saveApiKey: false,
  hasApiKey: false
};

interface EffectiveModelConfig {
  apiBaseUrl: string;
  apiKey: string;
  modelName: string;
  saveApiKey: boolean;
}

interface StoredModelConfig {
  apiBaseUrl?: string;
  modelName?: string;
  saveApiKey?: boolean;
  encryptedApiKey?: string;
  apiKey?: string;
}

const defaultEffectiveConfig: EffectiveModelConfig = {
  apiBaseUrl: defaultConfig.apiBaseUrl,
  apiKey: "",
  modelName: defaultConfig.modelName,
  saveApiKey: false
};

const REQUEST_TIMEOUT_MS = 300_000;

const userDataDir = () => app.getPath("userData");
const configPath = () => join(userDataDir(), "config.json");
const historyPath = () => join(userDataDir(), "history.json");

let mainWindow: BrowserWindow | null = null;
let runtimeConfig: EffectiveModelConfig | null = null;
let analyzeAbortController: AbortController | null = null;
let fuseAbortController: AbortController | null = null;
let generationService: GenerationService | null = null;
let imageEditService: ImageEditService | null = null;

const publicConfig = (config: EffectiveModelConfig): ModelConfig => ({
  apiBaseUrl: config.apiBaseUrl,
  modelName: config.modelName,
  saveApiKey: config.saveApiKey,
  hasApiKey: Boolean(config.apiKey)
});

const decryptStoredApiKey = (stored: StoredModelConfig): string => {
  if (stored.encryptedApiKey) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, "base64"));
    } catch {
      return "";
    }
  }
  return stored.saveApiKey ? stored.apiKey?.trim() ?? "" : "";
};

const encryptApiKey = (apiKey: string): string => {
  if (!apiKey) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("当前系统不支持安全保存 API Key，请取消勾选保存后再试。");
  }
  return safeStorage.encryptString(apiKey).toString("base64");
};

const readStoredConfig = async (): Promise<{
  config: EffectiveModelConfig;
  hasLegacyPlainApiKey: boolean;
}> => {
  const stored = await readJsonFile<StoredModelConfig>(configPath(), {});
  const apiKey = decryptStoredApiKey(stored);
  const config: EffectiveModelConfig = {
    apiBaseUrl: stored.apiBaseUrl?.trim() || defaultEffectiveConfig.apiBaseUrl,
    apiKey,
    modelName: stored.modelName?.trim() || defaultEffectiveConfig.modelName,
    saveApiKey: Boolean(stored.saveApiKey)
  };
  return { config, hasLegacyPlainApiKey: Boolean(stored.apiKey) };
};

const writeStoredConfig = async (config: EffectiveModelConfig): Promise<void> => {
  const payload: StoredModelConfig = {
    apiBaseUrl: config.apiBaseUrl,
    modelName: config.modelName,
    saveApiKey: config.saveApiKey
  };
  if (config.saveApiKey && config.apiKey) {
    payload.encryptedApiKey = encryptApiKey(config.apiKey);
  }
  await writeJsonFile(configPath(), payload);
};

const getEffectiveConfig = async (): Promise<EffectiveModelConfig> => {
  if (runtimeConfig) return runtimeConfig;
  const { config } = await readStoredConfig();
  runtimeConfig = config;
  return config;
};

const getConfig = async (): Promise<ModelConfig> => {
  const { config, hasLegacyPlainApiKey } = await readStoredConfig();
  runtimeConfig = runtimeConfig ?? config;
  if (hasLegacyPlainApiKey && config.saveApiKey && config.apiKey) {
    await writeStoredConfig(config).catch(() => undefined);
  }
  return publicConfig(runtimeConfig);
};

const saveConfig = async (config: ModelConfigUpdate): Promise<ModelConfig> => {
  const existing = await getEffectiveConfig();
  const nextConfig: EffectiveModelConfig = {
    apiBaseUrl: config.apiBaseUrl.trim() || defaultConfig.apiBaseUrl,
    modelName: config.modelName.trim() || defaultConfig.modelName,
    apiKey: config.apiKey.trim() || existing.apiKey,
    saveApiKey: Boolean(config.saveApiKey)
  };
  await writeStoredConfig(nextConfig);
  runtimeConfig = nextConfig;
  return publicConfig(nextConfig);
};

const clearConfig = async (): Promise<ModelConfig> => {
  runtimeConfig = { ...defaultEffectiveConfig };
  await writeStoredConfig(runtimeConfig);
  return publicConfig(runtimeConfig);
};

const clearAllLocalData = async (): Promise<ModelConfig> => {
  runtimeConfig = { ...defaultEffectiveConfig };
  await writeStoredConfig(runtimeConfig);
  await writeJsonFile(historyPath(), []);
  await generationService?.clearAll();
  await imageEditService?.clearAll();
  return publicConfig(runtimeConfig);
};

const saveGenerationOutputs = async (request: GenerationOutputsSaveRequest) => {
  const outputs = Array.isArray(request.outputs) ? request.outputs.filter((output) => output.dataUrl.trim()) : [];
  if (!outputs.length) throw new Error("没有可保存的生成图片。");

  if (outputs.length === 1) {
    const output = outputs[0];
    const extension = generationOutputExtension(output.mimeType);
    const defaultFileName = generationOutputFileName(output.suggestedFileName, output.mimeType);
    const result = await dialog.showSaveDialog({
      title: "保存生成图片",
      defaultPath: defaultFileName,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true, filePaths: [] };
    const { buffer } = dataUrlToGenerationOutputBuffer(output.dataUrl);
    await writeFile(result.filePath, buffer);
    return { canceled: false, filePaths: [result.filePath] };
  }

  const result = await dialog.showOpenDialog({
    title: "选择生成图片保存位置",
    properties: ["openDirectory", "createDirectory"]
  });
  const directoryPath = result.filePaths[0];
  if (result.canceled || !directoryPath) return { canceled: true, filePaths: [] };

  const filePaths: string[] = [];
  for (const output of outputs) {
    const fileName = generationOutputFileName(output.suggestedFileName, output.mimeType);
    const filePath = uniqueGenerationOutputPath(directoryPath, fileName);
    const { buffer } = dataUrlToGenerationOutputBuffer(output.dataUrl);
    await writeFile(filePath, buffer);
    filePaths.push(filePath);
  }

  return { canceled: false, directoryPath, filePaths };
};

const saveImageEditOutputs = async (request: ImageEditOutputsSaveRequest) =>
  saveGenerationOutputs({
    outputs: request.outputs
  });

const parseAnalysis = (
  rawText: string,
  sourceCapture?: AnalyzeImageRequest["sourceCapture"]
): { analysis: StyleAnalysis; repaired: boolean } => {
  const jsonText = extractJsonText(rawText);
  const parsed = parseExtractedJson(rawText, "图片分析结果");
  const analysis = normalizeStyleAnalysis(parsed, sourceCapture);
  return { analysis, repaired: jsonText !== rawText.trim() };
};

const parseFusedPrompt = (rawText: string, userText?: string): FusePromptResponse => {
  const jsonText = extractJsonText(rawText);
  const parsed = parseExtractedJson(rawText, "融合提示词结果");
  const result = normalizeFusedPromptResult(parsed, { userText });
  return { result, rawText, repaired: jsonText !== rawText.trim() };
};

const postVisionRequest = async (
  request: AnalyzeImageRequest,
  config: EffectiveModelConfig,
  includeResponseFormat: boolean,
  extraInstruction = "",
  signal?: AbortSignal
): Promise<string> => {
  const response = await fetch(chatCompletionsEndpoint(config.apiBaseUrl), {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey.trim()}`
    },
    body: JSON.stringify({
      model: config.modelName,
      temperature: 0.2,
      ...(includeResponseFormat ? { response_format: { type: "json_object" } } : {}),
      messages: [
        {
          role: "system",
          content: `${buildSystemPrompt(request.strictGeneralization)}\n${extraInstruction}`
        },
        {
          role: "user",
          content: [
            { type: "text", text: buildUserPrompt() },
            {
              type: "image_url",
              image_url: {
                url: request.imageDataUrl
              }
            }
          ]
        }
      ]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new ModelHttpError(response.status, text);
  }

  return completionTextFromResponse(text);
};

const postFusePromptRequest = async (
  request: FusePromptRequest,
  config: EffectiveModelConfig,
  includeResponseFormat: boolean,
  extraInstruction = "",
  signal?: AbortSignal
): Promise<string> => {
  const normalizedStyleAnalysis = normalizeStyleAnalysis(request.styleAnalysis, undefined, {
    enforceChinese: false
  });
  const mode = request.mode === "information_layout" ? "information_layout" : "subject_reference";
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: buildFuseUserPrompt(
        JSON.stringify(normalizedStyleAnalysis, null, 2),
        request.controls,
        mode,
        request.productInfoText,
        request.editedTextMarkdown
      )
    }
  ];

  if (request.subjectImageDataUrl) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: request.subjectImageDataUrl
      }
    });
  }

  const response = await fetch(chatCompletionsEndpoint(config.apiBaseUrl), {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey.trim()}`
    },
    body: JSON.stringify({
      model: config.modelName,
      temperature: 0.2,
      ...(includeResponseFormat ? { response_format: { type: "json_object" } } : {}),
      messages: [
        {
          role: "system",
          content: `${buildFuseSystemPrompt()}\n${extraInstruction}`
        },
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new ModelHttpError(response.status, text);
  }

  return completionTextFromResponse(text);
};

const withAbortableRequest = async <T>(
  kind: "analyze" | "fuse",
  task: (signal: AbortSignal) => Promise<T>
): Promise<T> => {
  const controller = new AbortController();
  if (kind === "analyze") analyzeAbortController = controller;
  if (kind === "fuse") fuseAbortController = controller;

  const timeout = setTimeout(() => {
    controller.abort(new Error("模型请求超过 300 秒未响应，请检查 Base URL、模型状态或稍后重试。"));
  }, REQUEST_TIMEOUT_MS);

  try {
    return await task(controller.signal);
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      const reason = controller.signal.reason;
      if (reason instanceof Error) throw reason;
      throw new Error("模型请求已取消。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (kind === "analyze" && analyzeAbortController === controller) analyzeAbortController = null;
    if (kind === "fuse" && fuseAbortController === controller) fuseAbortController = null;
  }
};

const analyzeImage = async (request: AnalyzeImageRequest): Promise<AnalyzeImageResponse> => {
  const config = await getEffectiveConfig();
  if (!config.apiKey.trim()) {
    throw new Error("请先填写模型 API Key。");
  }
  if (!request.imageDataUrl.startsWith("data:image/")) {
    throw new Error("图片数据格式无效。");
  }

  return withAbortableRequest("analyze", async (signal) => {
  let rawText = "";
  try {
    rawText = await postVisionRequest(request, config, true, "", signal);
  } catch (error) {
    if (!shouldRetryWithoutResponseFormat(error, true)) throw error;
    rawText = await postVisionRequest(request, config, false, "", signal);
  }

  try {
    const { analysis, repaired } = parseAnalysis(rawText, request.sourceCapture);
    return { analysis, rawText, repaired };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("必须使用中文提示词")) throw error;

    const retryText = await postVisionRequest(
      request,
      config,
      false,
      "上一次输出包含英文提示词模板。本次必须把所有面向用户复制使用的提示词模板改写为中文，只保留 [MAIN_TITLE] 这类占位符为英文格式。",
      signal
    );
    const { analysis } = parseAnalysis(retryText, request.sourceCapture);
    return { analysis, rawText: retryText, repaired: true };
  }
  });
};

const fusePrompt = async (request: FusePromptRequest): Promise<FusePromptResponse> => {
  const config = await getEffectiveConfig();
  if (!config.apiKey.trim()) {
    throw new Error("请先填写模型 API Key。");
  }
  const mode = request.mode === "information_layout" ? "information_layout" : "subject_reference";
  const hasSubjectImage = Boolean(request.subjectImageDataUrl);
  const hasProductInfoText = Boolean(request.productInfoText?.trim());

  if (mode === "subject_reference" && !hasSubjectImage) {
    throw new Error("请先上传主体参考图。");
  }
  if (hasSubjectImage && !request.subjectImageDataUrl?.startsWith("data:image/")) {
    throw new Error(mode === "information_layout" ? "产品信息图数据格式无效。" : "主体参考图数据格式无效。");
  }
  if (mode === "information_layout" && !hasProductInfoText && !hasSubjectImage) {
    throw new Error("请先输入新产品信息，或上传一张产品信息图。");
  }

  const textInjectionActive =
    mode === "subject_reference" &&
    Boolean(request.controls?.useExtractedText) &&
    Boolean(request.editedTextMarkdown?.trim());
  const userText = textInjectionActive ? request.editedTextMarkdown : undefined;

  return withAbortableRequest("fuse", async (signal) => {
  let rawText = "";
  try {
    rawText = await postFusePromptRequest(request, config, true, "", signal);
  } catch (error) {
    if (!shouldRetryWithoutResponseFormat(error, true)) throw error;
    rawText = await postFusePromptRequest(request, config, false, "", signal);
  }

  try {
    return parseFusedPrompt(rawText, userText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!shouldRetryFusedPrompt(message)) throw error;

    const retryText = await postFusePromptRequest(
      request,
      config,
      false,
      `上一次输出的融合结果不合格。请重新输出完整 JSON，并严格遵守：fused_prompt 以及 fused_prompt_json 内所有面向用户复制的字段都必须是完整中文自然语言，不能为空。最终提示词是写给一个只能看到一张图片的外部生图模型的单图编辑指令：不能出现“第一张图”“第二张图”“第1张”“第2张”这类图片顺序描述，也不能出现“参考图”“主体参考图”“样式参考图”“风格参考图”“目标图”“目标视觉风格图”“当前解析图”“随附”“主体照片”这类双图视角指代，更不能要求“请同时提供一张照片/图片”。错误示例：“请同时提供一张主体照片，保留主体参考图中的人物。”正确示例：“对这张图片进行风格化重绘：保持图中人物的脸部、体态和人数不变，将画面改为冷调商务海报式构图、低饱和蓝灰配色和柔和侧光。”主体模式把视觉风格来源改写成具体构图、配色、光影、服装、发型或姿态描述，把主体写成“图中最清晰、最突出的前景人物或物体”；产品信息布局模式写成“已解析出的资料卡布局风格”和“用户提供的新产品信息”。${
        textInjectionActive
          ? "本次用户已提供编辑后的图中文字：画面可见文字只能来自这段文字，必须按原文使用；所有字段（包括 social_cover_text_layout）都不能出现任何 [XXX] 形式占位符。"
          : "除 fused_prompt_json.social_cover_text_layout 中允许使用 [SOCIAL_ASPECT_RATIO]、[TOP_SUPER_TITLE]、[BOTTOM_SUPER_TITLE] 之外，不能包含任何 [MAIN_TITLE]、[SUBJECT_GROUP]、[MAIN_OBJECT] 等待填占位符。"
      }如果用户输入了新产品文字，最终可见文字只能来自用户输入，不得新增用户未输入的标题、卖点、参数、结论、价格、型号、适用场景、评价词或营销词；没有输入的内容块必须留空或省略。并补齐 social_cover_text_layout、information_layout_adaptation、pose_transfer 和 wardrobe_transfer。`,
      signal
    );
    const response = parseFusedPrompt(retryText, userText);
    return { ...response, repaired: true };
  }
  });
};

const readRawHistory = async (): Promise<unknown[]> => {
  const history = await readJsonFile<unknown>(historyPath(), []);
  return Array.isArray(history) ? history : [];
};

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: "图片复刻大师",
    backgroundColor: "#f6f7f9",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true
    }
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const protocol = new URL(details.url).protocol;
      if (protocol === "https:" || protocol === "http:") {
        shell.openExternal(details.url);
      }
    } catch {
      // Ignore malformed external URLs.
    }
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

app.whenReady().then(async () => {
  generationService = new GenerationService(userDataDir());
  imageEditService = new ImageEditService(userDataDir());
  ipcMain.handle("config:get", getConfig);
  ipcMain.handle("config:save", (_event, config: ModelConfigUpdate) => saveConfig(config));
  ipcMain.handle("config:clear", clearConfig);
  ipcMain.handle("data:clear-all", clearAllLocalData);
  ipcMain.handle("image:analyze", (_event, request: AnalyzeImageRequest) => analyzeImage(request));
  ipcMain.handle("image:cancel-analysis", () => {
    analyzeAbortController?.abort(new Error("已取消图片分析。"));
  });
  ipcMain.handle("prompt:fuse", (_event, request: FusePromptRequest) => fusePrompt(request));
  ipcMain.handle("prompt:cancel-fuse", () => {
    fuseAbortController?.abort(new Error("已取消提示词生成。"));
  });
  ipcMain.handle("history:get", async () => normalizeHistory(await readRawHistory()));
  ipcMain.handle("history:save-item", async (_event, item: HistoryItem) => {
    const normalizedItem = normalizeHistoryItemForStorage(item);
    const history = await readRawHistory();
    const nextRaw = [
      normalizedItem,
      ...history.filter((entry) => getHistoryEntryId(entry) !== normalizedItem.id)
    ].slice(0, 50);
    await writeJsonFile(historyPath(), nextRaw);
    return normalizeHistory(nextRaw);
  });
  ipcMain.handle("history:delete-item", async (_event, id: string) => {
    const history = await readRawHistory();
    const nextRaw = history.filter((entry) => getHistoryEntryId(entry) !== id);
    await writeJsonFile(historyPath(), nextRaw);
    return normalizeHistory(nextRaw);
  });
  ipcMain.handle("history:clear", async () => writeJsonFile(historyPath(), []));
  ipcMain.handle("generation:config:get", async () => generationService?.getConfig());
  ipcMain.handle("generation:config:save", async (_event, config) => generationService?.saveConfig(config));
  ipcMain.handle("generation:provider:save", async (_event, provider) => generationService?.saveProvider(provider));
  ipcMain.handle("generation:provider:duplicate", async (_event, id: string) =>
    generationService?.duplicateProvider(id)
  );
  ipcMain.handle("generation:provider:delete", async (_event, id: string) => generationService?.deleteProvider(id));
  ipcMain.handle("generation:provider:select", async (_event, id: string) => generationService?.selectProvider(id));
  ipcMain.handle("generation:provider:reorder", async (_event, ids: string[]) =>
    generationService?.reorderProviders(ids)
  );
  ipcMain.handle("generation:tasks:get", async () => generationService?.getTasks());
  ipcMain.handle("generation:task:create", async (_event, request) => generationService?.createTask(request));
  ipcMain.handle("generation:task:cancel", async (_event, id: string) => generationService?.cancelTask(id));
  ipcMain.handle("generation:task:visibility", async (_event, update) =>
    generationService?.updateTaskVisibility(update)
  );
  ipcMain.handle("generation:task:delete", async (_event, id: string) => generationService?.deleteTask(id));
  ipcMain.handle("generation:tasks:clear", async () => generationService?.clearTasks());
  ipcMain.handle("generation:outputs:save", async (_event, request: GenerationOutputsSaveRequest) =>
    saveGenerationOutputs(request)
  );
  ipcMain.handle("imageEdit:tasks:get", async () => imageEditService?.getTasks());
  ipcMain.handle("imageEdit:task:create", async (_event, request) => imageEditService?.createTask(request));
  ipcMain.handle("imageEdit:output:protected-variant:save", async (_event, request: ImageEditProtectedVariantSaveRequest) =>
    imageEditService?.saveProtectedVariant(request)
  );
  ipcMain.handle("imageEdit:task:cancel", async (_event, id: string) => imageEditService?.cancelTask(id));
  ipcMain.handle("imageEdit:task:retry", async (_event, id: string) => imageEditService?.retryTask(id));
  ipcMain.handle("imageEdit:task:restore", async (_event, id: string) => imageEditService?.restoreTask(id));
  ipcMain.handle("imageEdit:task:visibility", async (_event, update) =>
    imageEditService?.updateTaskVisibility(update)
  );
  ipcMain.handle("imageEdit:task:delete", async (_event, id: string) => imageEditService?.deleteTask(id));
  ipcMain.handle("imageEdit:tasks:clear", async () => imageEditService?.clearTasks());
  ipcMain.handle("imageEdit:outputs:save", async (_event, request: ImageEditOutputsSaveRequest) =>
    saveImageEditOutputs(request)
  );
  ipcMain.handle("json:export", async (_event, payload: StyleAnalysis) => {
    const result = await dialog.showSaveDialog({
      title: "导出 JSON",
      defaultPath: `style-analysis-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf8");
    return { canceled: false, filePath: result.filePath };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell } from "electron";
import { join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import type {
  AnalyzeImageRequest,
  AnalyzeImageResponse,
  FusePromptRequest,
  FusePromptResponse,
  HistoryItem,
  GenerationOutputsSaveRequest,
  ImageEditAnnotationResolveRequest,
  ImageEditAnnotationResolveResponse,
  ImageEditOutputsSaveRequest,
  ModelConfig,
  ModelConfigUpdate,
  StyleAnalysis
} from "../src/shared/types";
import {
  manualImageEditAnnotationResolution,
  normalizeOriginAnnotationItems,
  parseImageEditAnnotationResolution
} from "../src/shared/image-edit-regeneration";
import { normalizeFusedPromptResult, normalizeStyleAnalysis } from "../src/shared/schema";
import { GenerationService } from "./generation";
import { ImageEditService, imageEditAnnotationContentHash } from "./image-edit";
import { clearWindowsSessionData } from "./session-cleanup";
import { windowsApplicationMenuTemplate } from "./windows-menu";
import { normalizeWindowsTextRemovalResolution } from "./windows-image-edit";
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
  modelRequestTimeoutMessage,
  modelRequestTimeoutMs,
  normalizeHistory,
  normalizeHistoryItemForStorage,
  parseExtractedJson,
  readJsonFile,
  shouldCacheImageEditAnnotationResolution,
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

const WINDOWS_DATA_CLEAR_ERROR_MESSAGE = "已抹除全部本机数据。";

const e2eUserDataDir = process.env.IMAGE_STYLE_E2E_USER_DATA_DIR?.trim();
if (!app.isPackaged && e2eUserDataDir) app.setPath("userData", resolve(e2eUserDataDir));

const userDataDir = () => app.getPath("userData");
const configPath = () => join(userDataDir(), "config.json");
const historyPath = () => join(userDataDir(), "history.json");

let mainWindow: BrowserWindow | null = null;
let runtimeConfig: EffectiveModelConfig | null = null;
let analyzeAbortController: AbortController | null = null;
let fuseAbortController: AbortController | null = null;
let localDataEpoch = 0;
const annotationAbortControllers = new Set<AbortController>();
let generationService: GenerationService | null = null;
let imageEditService: ImageEditService | null = null;
const imageEditAnnotationResolutionCache = new Map<string, ImageEditAnnotationResolveResponse>();
const imageEditAnnotationResolutionsInFlight = new Set<string>();

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
  if (process.platform === "win32") {
    localDataEpoch += 1;
    const reason = new Error(WINDOWS_DATA_CLEAR_ERROR_MESSAGE);
    analyzeAbortController?.abort(reason);
    fuseAbortController?.abort(reason);
    for (const controller of annotationAbortControllers) controller.abort(reason);
    imageEditAnnotationResolutionCache.clear();
    imageEditAnnotationResolutionsInFlight.clear();
  }
  runtimeConfig = { ...defaultEffectiveConfig };
  await writeStoredConfig(runtimeConfig);
  await writeJsonFile(historyPath(), []);
  await generationService?.clearAll();
  await imageEditService?.clearAll();
  await clearWindowsSessionData(session.defaultSession);
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

const resolveImageEditAnnotations = async (
  request: ImageEditAnnotationResolveRequest
): Promise<ImageEditAnnotationResolveResponse> => {
  if (!request.sourceImageDataUrl.startsWith("data:image/")) throw new Error("待修改生成图数据格式无效。");
  if (request.sourceImageModelDataUrl && !request.sourceImageModelDataUrl.startsWith("data:image/")) {
    throw new Error("模型用待修改图数据格式无效。");
  }
  if (!request.annotationImageDataUrl.startsWith("data:image/")) throw new Error("编号定位图数据格式无效。");
  const annotationItems = normalizeOriginAnnotationItems(request.annotationItems);
  const basePrompt = request.basePrompt.trim();
  if (!basePrompt) throw new Error("请先填写重生成基础提示词。");
  const contentHash = imageEditAnnotationContentHash(
    request.sourceImageDataUrl,
    annotationItems,
    request.instruction,
    basePrompt
  );
  const requestDataEpoch = localDataEpoch;
  const createdAt = new Date().toISOString();
  const finalizeResponse = (response: ImageEditAnnotationResolveResponse): ImageEditAnnotationResolveResponse => {
    if (requestDataEpoch !== localDataEpoch) throw new Error(WINDOWS_DATA_CLEAR_ERROR_MESSAGE);
    return response;
  };
  const fallback = (reason: string): ImageEditAnnotationResolveResponse => ({
    fallbackReason: reason,
    resolution: manualImageEditAnnotationResolution(annotationItems, { contentHash, createdAt }, reason)
  });
  const config = await getEffectiveConfig();
  if (!config.apiKey.trim()) {
    return finalizeResponse(fallback("视觉分析模型尚未配置，请手动补齐修改对象、目标修改和保留项后逐项确认。"));
  }
  const cacheKey = [contentHash, config.apiBaseUrl.trim(), config.modelName.trim()].join("\n");
  const cached = imageEditAnnotationResolutionCache.get(cacheKey);
  if (cached) return finalizeResponse(cached);
  if (imageEditAnnotationResolutionsInFlight.has(cacheKey)) {
    throw new Error("同一标注版本正在解析，请等待当前解析完成。");
  }
  imageEditAnnotationResolutionsInFlight.add(cacheKey);

  try {
    const systemPrompt = [
      "你是改图标注语义解析器。你只负责理解用户已经画出的编号标注，不生成图片，也不扩写修改目标。",
      "必须返回一个 JSON 对象，唯一顶层字段是 items。items 数量、index 和请求编号必须完全一致，不能缺号、重号或新增编号。",
      "每项字段固定为 index、target_object、current_state、requested_change、preserve、spatial_anchors、original_text、replacement_text、confidence、ambiguity。",
      "target_object 与 requested_change 必须非空。只根据待修改图、黑白编号定位图、结构化几何和用户原始说明识别对象；不得新增用户未要求的事实、品牌、文字、人物或修改目标。",
      "涉及文字替换时，original_text 和 replacement_text 必须拆分；replacement_text 只能逐字来自用户说明，无法确认则留空并在 ambiguity 说明。",
      process.platform === "win32"
        ? "纯删除文字或删除包含文字的对象时，不属于文字替换，original_text 和 replacement_text 必须同时留空。"
        : "",
      "对象不明确、文字不可辨认或置信度低于 0.80 时必须填写 ambiguity，不能猜测。所有说明使用中文。"
    ]
      .filter(Boolean)
      .join("\n");
    const userText = [
      `原始生图基础提示词：\n${basePrompt}`,
      `本轮总体说明：\n${request.instruction.trim() || "无"}`,
      `编号、用户局部说明和结构化几何：\n${JSON.stringify(annotationItems, null, 2)}`,
      "第一张图片是待修改生成图，只用于理解当前画面；第二张图片是低遮挡黑白编号定位图，只用于确认编号位置。"
    ].join("\n\n");

    try {
      return await withAbortableRequest("annotation", async (signal) => {
        if (requestDataEpoch !== localDataEpoch) throw new Error(WINDOWS_DATA_CLEAR_ERROR_MESSAGE);
        const post = async (includeResponseFormat: boolean): Promise<string> => {
          const response = await fetch(chatCompletionsEndpoint(config.apiBaseUrl), {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey.trim()}`
            },
            body: JSON.stringify({
              model: config.modelName,
              temperature: 0.1,
              max_tokens: 4096,
              ...(includeResponseFormat ? { response_format: { type: "json_object" } } : {}),
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: [
                    { type: "text", text: userText },
                    {
                      type: "image_url",
                      image_url: { url: request.sourceImageModelDataUrl || request.sourceImageDataUrl }
                    },
                    { type: "image_url", image_url: { url: request.annotationImageDataUrl } }
                  ]
                }
              ]
            })
          });
          const responseText = await response.text();
          if (!response.ok) throw new ModelHttpError(response.status, responseText);
          return completionTextFromResponse(responseText);
        };
        let rawText: string;
        try {
          rawText = await post(true);
        } catch (error) {
          if (!shouldRetryWithoutResponseFormat(error, true)) throw error;
          rawText = await post(false);
        }
        const parsed = parseExtractedJson(rawText, "改图标注解析结果");
        const response = finalizeResponse({
          resolution: normalizeWindowsTextRemovalResolution(
            parseImageEditAnnotationResolution(parsed, annotationItems, {
              contentHash,
              source: "vision_model",
              modelName: config.modelName,
              createdAt
            })
          )
        });
        if (shouldCacheImageEditAnnotationResolution(response)) {
          imageEditAnnotationResolutionCache.set(cacheKey, response);
        }
        return response;
      });
    } catch (error) {
      if (
        requestDataEpoch !== localDataEpoch ||
        (error instanceof Error && error.message === WINDOWS_DATA_CLEAR_ERROR_MESSAGE)
      ) {
        throw new Error(WINDOWS_DATA_CLEAR_ERROR_MESSAGE);
      }
      const reason = error instanceof Error ? error.message : String(error);
      return finalizeResponse(fallback(`视觉解析不可用：${reason} 请手动补齐并确认修改清单。`));
    }
  } finally {
    imageEditAnnotationResolutionsInFlight.delete(cacheKey);
  }
};

const withAbortableRequest = async <T>(
  kind: "analyze" | "fuse" | "annotation",
  task: (signal: AbortSignal) => Promise<T>
): Promise<T> => {
  const controller = new AbortController();
  if (kind === "analyze") analyzeAbortController = controller;
  if (kind === "fuse") fuseAbortController = controller;
  if (kind === "annotation") annotationAbortControllers.add(controller);

  const timeout = setTimeout(() => {
    controller.abort(new Error(modelRequestTimeoutMessage(kind)));
  }, modelRequestTimeoutMs(kind));

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
    if (kind === "annotation") annotationAbortControllers.delete(controller);
  }
};

const analyzeImage = async (request: AnalyzeImageRequest): Promise<AnalyzeImageResponse> => {
  const requestDataEpoch = localDataEpoch;
  const config = await getEffectiveConfig();
  if (!config.apiKey.trim()) {
    throw new Error("请先填写模型 API Key。");
  }
  if (!request.imageDataUrl.startsWith("data:image/")) {
    throw new Error("图片数据格式无效。");
  }

  return withAbortableRequest("analyze", async (signal) => {
  if (requestDataEpoch !== localDataEpoch) throw new Error(WINDOWS_DATA_CLEAR_ERROR_MESSAGE);
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
  const requestDataEpoch = localDataEpoch;
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
  if (requestDataEpoch !== localDataEpoch) throw new Error(WINDOWS_DATA_CLEAR_ERROR_MESSAGE);
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
  if (process.platform === "win32") {
    Menu.setApplicationMenu(Menu.buildFromTemplate(windowsApplicationMenuTemplate(!app.isPackaged)));
  }
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
  ipcMain.handle("imageEdit:annotations:resolve", async (_event, request: ImageEditAnnotationResolveRequest) =>
    resolveImageEditAnnotations(request)
  );
  ipcMain.handle("imageEdit:task:create", async (_event, request) => imageEditService?.createTask(request));
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

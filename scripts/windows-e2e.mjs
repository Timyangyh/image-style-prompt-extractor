import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

if (process.platform !== "win32") {
  throw new Error("Windows Electron E2E 只能在 Windows 环境运行。");
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = await mkdtemp(join(tmpdir(), "图片复刻大师 Windows E2E "));
const userDataDir = join(testRoot, "用户 数据");
const sourceImagePath = join(testRoot, "中文 路径", "公开测试图.png");
const savedImagePath = join(testRoot, "导出 结果", "测试输出.png");
const modelSecret = "windows-e2e-model-secret";
const generationSecret = "windows-e2e-generation-secret";
const browserMarker = "windows-e2e-browser-marker";
const imageBytes = await readFile(join(rootDir, "assets", "app-icon.png"));
const imageBase64 = imageBytes.toString("base64");
const imageDataUrl = `data:image/png;base64,${imageBase64}`;
const sourceIdentityDataUrl = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024)}`;

let annotationServerMode = "success";
const annotationRequests = [];
const annotationServer = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString("utf8");
  const body = JSON.parse(bodyText);
  const contentParts = (body.messages || [])
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []));
  const imageUrls = contentParts
    .filter((part) => part?.type === "image_url")
    .map((part) => part.image_url?.url || "");
  const anthropicImages = contentParts
    .filter((part) => part?.type === "image" && part.source?.type === "base64")
    .map((part) => part.source?.data || "");
  annotationRequests.push({
    path: request.url,
    authorization: request.headers.authorization,
    anthropicVersion: request.headers["anthropic-version"],
    imageLengths: anthropicImages.length
      ? anthropicImages.map((data) => data.length)
      : imageUrls.map((url) => url.length),
    containsIdentityImage:
      imageUrls.includes(sourceIdentityDataUrl) || anthropicImages.includes(sourceIdentityDataUrl.split(",")[1]),
    maxTokens: body.max_tokens,
    systemPrompt: body.system || body.messages?.find((message) => message?.role === "system")?.content || ""
  });

  response.setHeader("Content-Type", "application/json");
  if (annotationServerMode === "fail") {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: { message: "forced annotation failure" } }));
    return;
  }
  const resultText = JSON.stringify({
    items: [
      {
        index: 1,
        target_object: "左侧对话气泡",
        current_state: "气泡内文字为深度思考",
        requested_change: "删除该对话气泡及其内部文字",
        preserve: ["保持背景与构图"],
        spatial_anchors: ["编号 1 所在区域"],
        original_text: "深度思考",
        replacement_text: "",
        confidence: 0.95,
        ambiguity: ""
      }
    ]
  });
  response.end(
    JSON.stringify(
      body.system
        ? { content: [{ type: "text", text: resultText }] }
        : { choices: [{ message: { content: resultText } }] }
    )
  );
});
await new Promise((resolveListening, rejectListening) => {
  annotationServer.once("error", rejectListening);
  annotationServer.listen(0, "127.0.0.1", resolveListening);
});
const annotationServerAddress = annotationServer.address();
assert(annotationServerAddress && typeof annotationServerAddress !== "string");
const annotationApiBaseUrl = `http://127.0.0.1:${annotationServerAddress.port}/v1`;

let markImageEditRequest;
const imageEditRequestSeen = new Promise((resolveImageEditRequest) => {
  markImageEditRequest = resolveImageEditRequest;
});
const imageEditRequests = [];
const imageEditServer = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  imageEditRequests.push({
    path: request.url,
    model: body.model,
    prompt: body.prompt,
    referenceCount: Array.isArray(body.input_references) ? body.input_references.length : 0
  });
  markImageEditRequest();
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ data: [{ b64_json: imageBytes.toString("base64") }] }));
});
await new Promise((resolveListening, rejectListening) => {
  imageEditServer.once("error", rejectListening);
  imageEditServer.listen(0, "127.0.0.1", resolveListening);
});
const imageEditServerAddress = imageEditServer.address();
assert(imageEditServerAddress && typeof imageEditServerAddress !== "string");
const imageEditApiBaseUrl = `http://127.0.0.1:${imageEditServerAddress.port}/v1`;

let markPendingRequest;
const pendingRequestSeen = new Promise((resolvePendingRequest) => {
  markPendingRequest = resolvePendingRequest;
});
const hangingServer = createServer(() => markPendingRequest());
await new Promise((resolveListening, rejectListening) => {
  hangingServer.once("error", rejectListening);
  hangingServer.listen(0, "127.0.0.1", resolveListening);
});
const hangingServerAddress = hangingServer.address();
assert(hangingServerAddress && typeof hangingServerAddress !== "string");
const hangingApiBaseUrl = `http://127.0.0.1:${hangingServerAddress.port}/v1`;

await mkdir(dirname(sourceImagePath), { recursive: true });
await mkdir(dirname(savedImagePath), { recursive: true });
await cp(join(rootDir, "assets", "app-icon.png"), sourceImagePath);

const rendererErrors = [];
let electronApp;

const launchApp = async () => {
  const launched = await electron.launch({
    args: [rootDir],
    cwd: rootDir,
    env: {
      ...process.env,
      IMAGE_STYLE_E2E_USER_DATA_DIR: userDataDir
    },
    timeout: 60_000
  });
  const page = await launched.firstWindow({ timeout: 60_000 });
  page.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push(message.text());
  });
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  return { launched, page };
};

const seedStaleGenerationTask = async () => {
  const generationDir = join(userDataDir, "generation");
  await mkdir(generationDir, { recursive: true });
  const now = "2026-07-15T00:00:00.000Z";
  const task = {
    id: "windows-e2e-stale-task",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    status: "running",
    prompt: "Windows 重启恢复测试",
    finalPrompt: "Windows 重启恢复测试",
    promptSource: {
      kind: "universal",
      label: "Windows E2E",
      sourceImageDataUrl: imageDataUrl,
      sourceThumbnailDataUrl: imageDataUrl,
      sourceFileName: "公开测试图.png",
      importedAt: now
    },
    referenceImages: [],
    settings: {
      apiMode: "images",
      imageModel: "gpt-image-2",
      mainModel: "gpt-5.5",
      resolution: "1k",
      aspectRatio: "1:1",
      size: "1024x1024",
      quality: "auto",
      outputFormat: "png",
      moderation: "auto",
      background: "auto",
      promptMode: "original",
      n: 1
    },
    outputs: []
  };
  await writeFile(join(generationDir, "tasks.json"), JSON.stringify([task], null, 2));
};

const allFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const paths = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await allFiles(entryPath)));
    else if (entry.isFile()) paths.push(entryPath);
  }
  return paths;
};

try {
  let launchedState = await launchApp();
  electronApp = launchedState.launched;
  let page = launchedState.page;

  assert.equal(await page.title(), "图片复刻大师");
  await page.getByText("当前没有图片解析流程。").waitFor();
  const waitForFullScreen = async (expected) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const isFullScreen = await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false
      );
      if (isFullScreen === expected) return;
      await page.waitForTimeout(50);
    }
    throw new Error(`等待窗口${expected ? "进入" : "退出"}全屏超时`);
  };
  await page.getByRole("button", { name: "模型配置", exact: true }).click();
  const fullScreenPriorityDialog = page.getByRole("dialog", { name: "模型配置" });
  await fullScreenPriorityDialog.waitFor();
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setFullScreen(true);
  });
  await waitForFullScreen(true);
  const sendNativeEscapeEvent = (type) =>
    electronApp.evaluate(({ BrowserWindow }, inputType) => {
      BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({
        type: inputType,
        keyCode: "Escape"
      });
    }, type);
  await sendNativeEscapeEvent("keyDown");
  await waitForFullScreen(false);
  await sendNativeEscapeEvent("keyDown");
  assert.equal(
    await fullScreenPriorityDialog.isVisible(),
    true,
    "全屏 Escape 及其按键重复不应同时关闭渲染层弹窗"
  );
  await sendNativeEscapeEvent("keyUp");
  await sendNativeEscapeEvent("keyDown");
  await sendNativeEscapeEvent("keyUp");
  await fullScreenPriorityDialog.waitFor({ state: "hidden" });

  const themeStorageKey = "image-style-prompt-extractor:theme:v1";
  const currentTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (currentTheme === "dark") {
    await page.getByRole("button", { name: "切换为浅色模式", exact: true }).click();
  }
  await page.getByRole("button", { name: "切换为深色模式", exact: true }).click();
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), themeStorageKey),
    "dark",
    "Windows 主题选择应写入本机枚举偏好"
  );

  const layoutStorageKey = "image-style-prompt-extractor:resizable-layout:v1";
  const sidebarWorkspaceSeparatorName = "调整工作台导航与流程列表高度";
  const readSidebarWorkspaceLayout = async () => {
    const separator = page.getByRole("separator", {
      name: sidebarWorkspaceSeparatorName,
      exact: true
    });
    await separator.waitFor();
    return separator.evaluate((element) => {
      const parentRect = element.parentElement.getBoundingClientRect();
      const separatorRect = element.getBoundingClientRect();
      const lastNavigationButton = document
        .querySelector(".page-tabs button:last-child")
        ?.getBoundingClientRect();
      const workflowNavigator = document
        .querySelector(".workflow-navigator")
        ?.getBoundingClientRect();
      return {
        ratio: (separatorRect.top - parentRect.top) / parentRect.height,
        regionsSeparated:
          Boolean(lastNavigationButton && workflowNavigator) &&
          lastNavigationButton.bottom <= separatorRect.top + 1 &&
          separatorRect.bottom <= workflowNavigator.top + 1 &&
          workflowNavigator.top - lastNavigationButton.bottom >= 12,
        startSize: separatorRect.top - parentRect.top,
        valueNow: Number(element.getAttribute("aria-valuenow"))
      };
    });
  };
  const sidebarWorkspaceSeparator = page.getByRole("separator", {
    name: sidebarWorkspaceSeparatorName,
    exact: true
  });
  assert.equal(
    await sidebarWorkspaceSeparator.getAttribute("aria-orientation"),
    "horizontal",
    "Windows 应显示工作台导航与流程列表的横向分隔条"
  );
  const initialSidebarWorkspaceLayout = await readSidebarWorkspaceLayout();
  assert.equal(
    initialSidebarWorkspaceLayout.regionsSeparated,
    true,
    "Windows 默认布局中的工作台导航与流程列表仍然贴靠或重叠"
  );
  await sidebarWorkspaceSeparator.focus();
  await page.keyboard.press("ArrowDown");
  const keyboardAdjustedSidebarWorkspaceLayout = await readSidebarWorkspaceLayout();
  assert.ok(
    keyboardAdjustedSidebarWorkspaceLayout.valueNow >
      initialSidebarWorkspaceLayout.valueNow,
    "Windows 横向分隔条未响应向下方向键"
  );
  const sidebarWorkspaceSeparatorBox = await sidebarWorkspaceSeparator.boundingBox();
  assert.ok(sidebarWorkspaceSeparatorBox, "Windows 横向分隔条不可见");
  const sidebarWorkspaceSeparatorX =
    sidebarWorkspaceSeparatorBox.x + sidebarWorkspaceSeparatorBox.width / 2;
  await page.mouse.move(
    sidebarWorkspaceSeparatorX,
    sidebarWorkspaceSeparatorBox.y + sidebarWorkspaceSeparatorBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    sidebarWorkspaceSeparatorX,
    sidebarWorkspaceSeparatorBox.y + sidebarWorkspaceSeparatorBox.height / 2 + 44,
    { steps: 6 }
  );
  await page.mouse.up();
  const draggedSidebarWorkspaceLayout = await readSidebarWorkspaceLayout();
  assert.ok(
    draggedSidebarWorkspaceLayout.startSize >
      keyboardAdjustedSidebarWorkspaceLayout.startSize + 20,
    "Windows 横向分隔条的鼠标拖动未改变上下区域占比"
  );
  const storedSidebarWorkspaceRatio = await page.evaluate((key) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}")?.ratios?.[
        "sidebar-workspaces"
      ] ?? null;
    } catch {
      return null;
    }
  }, layoutStorageKey);
  assert.equal(
    Number.isFinite(storedSidebarWorkspaceRatio),
    true,
    "Windows 横向分隔条未保存合法比例"
  );

  await page.locator('input[type="file"]').first().setInputFiles(sourceImagePath);
  await page.locator('img[alt="待分析图片预览"]').waitFor();

  await page.getByRole("button", { name: "生图工作台" }).click();
  await page.getByText("当前没有生图流程。").waitFor();
  await page.getByRole("button", { name: "改图工作台" }).click();
  await page.getByText("当前没有改图流程。").waitFor();
  await page.getByRole("button", { name: "提示词提取" }).click();

  const modelConfig = await page.evaluate(async ({ secret }) => {
    return window.styleExtractor.saveConfig({
      apiBaseUrl: "https://api.example.invalid/v1",
      apiMode: "anthropic",
      apiKey: secret,
      modelName: "windows-e2e-vision",
      saveApiKey: true
    });
  }, { secret: modelSecret });
  assert.equal(modelConfig.hasApiKey, true);
  assert.equal(modelConfig.apiMode, "anthropic");
  assert.equal("apiKey" in modelConfig, false);

  const generationConfig = await page.evaluate(async ({ secret }) => {
    const current = await window.styleExtractor.getGenerationConfig();
    return window.styleExtractor.saveGenerationConfig({
      authSource: "api",
      activeProviderId: current.activeProviderId,
      providerName: "Windows E2E",
      providerType: "openai_compatible",
      apiBaseUrl: "https://api.example.invalid/v1",
      apiKey: secret,
      apiMode: "images",
      imageModel: "gpt-image-2",
      mainModel: "gpt-5.5",
      saveApiKey: true,
      imagesConcurrency: 1
    });
  }, { secret: generationSecret });
  assert.equal(generationConfig.hasApiKey, true);
  assert.equal("apiKey" in generationConfig, false);
  assert.equal(generationConfig.providers.some((provider) => "apiKey" in provider), false);

  await page.evaluate((marker) => localStorage.setItem("windows-e2e-private", marker), browserMarker);
  await electronApp.evaluate(async ({ session }, marker) => {
    await session.defaultSession.cookies.set({
      url: "https://windows-e2e.invalid",
      name: "windows-e2e-private",
      value: marker,
      expirationDate: Date.now() / 1000 + 3600
    });
  }, browserMarker);

  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, savedImagePath);
  const saveResult = await page.evaluate(async ({ dataUrl }) => {
    return window.styleExtractor.saveGenerationOutputs({
      outputs: [
        {
          taskId: "windows-e2e-save",
          outputId: "output-1",
          dataUrl,
          mimeType: "image/png",
          suggestedFileName: "测试输出.png"
        }
      ]
    });
  }, { dataUrl: imageDataUrl });
  assert.equal(saveResult.canceled, false);
  await access(savedImagePath);

  await electronApp.close();
  electronApp = undefined;

  const storedModelConfig = await readFile(join(userDataDir, "config.json"), "utf8");
  const storedGenerationConfig = await readFile(join(userDataDir, "generation", "config.json"), "utf8");
  assert.equal(storedModelConfig.includes(modelSecret), false);
  assert.equal(storedGenerationConfig.includes(generationSecret), false);
  assert.match(storedModelConfig, /encryptedApiKey/);
  assert.match(storedModelConfig, /"apiMode": "anthropic"/);
  assert.match(storedGenerationConfig, /encryptedApiKey/);

  await seedStaleGenerationTask();
  launchedState = await launchApp();
  electronApp = launchedState.launched;
  page = launchedState.page;

  const restartedTheme = await page.evaluate(
    (key) => ({
      stored: localStorage.getItem(key),
      theme: document.documentElement.dataset.theme
    }),
    themeStorageKey
  );
  assert.deepEqual(
    restartedTheme,
    { stored: "dark", theme: "dark" },
    "Windows 应用重启后应恢复显式深色偏好"
  );
  const restartedSidebarWorkspaceLayout = await readSidebarWorkspaceLayout();
  assert.ok(
    Math.abs(restartedSidebarWorkspaceLayout.ratio - storedSidebarWorkspaceRatio) <
      0.012,
    "Windows 应用重启后未恢复横向分隔条比例"
  );
  assert.equal(
    restartedSidebarWorkspaceLayout.regionsSeparated,
    true,
    "Windows 应用重启后的工作台导航与流程列表发生贴靠或重叠"
  );

  const recoveredTasks = await page.evaluate(() => window.styleExtractor.getGenerationTasks());
  assert.equal(recoveredTasks.length, 1);
  assert.equal(recoveredTasks[0].status, "failed");
  assert.match(recoveredTasks[0].error || "", /应用或生图进程已重启/);

  await page.evaluate(async ({ apiBaseUrl, secret }) => {
    await window.styleExtractor.saveConfig({
      apiBaseUrl,
      apiMode: "anthropic",
      apiKey: secret,
      modelName: "windows-e2e-annotation-vision",
      saveApiKey: true
    });
  }, { apiBaseUrl: annotationApiBaseUrl, secret: modelSecret });
  const annotationRequest = {
    sourceImageDataUrl: sourceIdentityDataUrl,
    sourceImageModelDataUrl: imageDataUrl,
    annotationImageDataUrl: imageDataUrl,
    annotationItems: [
      {
        index: 1,
        label: "标注 1",
        tool: "box",
        note: "替换为另一枚公开测试图标",
        geometry: {
          tool: "box",
          left: 0.1,
          top: 0.1,
          right: 0.5,
          bottom: 0.5,
          centerX: 0.3,
          centerY: 0.3,
          width: 0.4,
          height: 0.4
        }
      }
    ],
    instruction: "只修改编号区域",
    basePrompt: "保持公开测试图的基础构图。"
  };
  const resolvedAnnotations = await page.evaluate(
    (request) => window.styleExtractor.resolveImageEditAnnotations(request),
    annotationRequest
  );
  assert.equal(resolvedAnnotations.resolution.source, "vision_model");
  assert.equal(annotationRequests.length, 1);
  assert.equal(annotationRequests[0].path, "/v1/messages");
  assert.equal(annotationRequests[0].authorization, `Bearer ${modelSecret}`);
  assert.equal(annotationRequests[0].anthropicVersion, "2023-06-01");
  assert.deepEqual(annotationRequests[0].imageLengths, [imageBase64.length, imageBase64.length]);
  assert.equal(annotationRequests[0].containsIdentityImage, false);
  assert.equal(annotationRequests[0].maxTokens, 4096);
  assert.match(annotationRequests[0].systemPrompt, /纯删除文字或删除包含文字的对象/);
  assert.equal(resolvedAnnotations.resolution.items[0].originalText, undefined);
  assert.equal(resolvedAnnotations.resolution.items[0].replacementText, undefined);

  await page.evaluate((request) => window.styleExtractor.resolveImageEditAnnotations(request), annotationRequest);
  assert.equal(annotationRequests.length, 1, "成功的标注解析应复用内存缓存");

  await page.evaluate(async ({ apiBaseUrl, secret }) => {
    const current = await window.styleExtractor.getGenerationConfig();
    await window.styleExtractor.saveGenerationConfig({
      authSource: "api",
      activeProviderId: current.activeProviderId,
      providerName: "Windows E2E",
      providerType: "openrouter",
      apiBaseUrl,
      apiKey: secret,
      apiMode: "images",
      imageModel: "openai/gpt-image-2",
      mainModel: "gpt-5.5",
      saveApiKey: true,
      imagesConcurrency: 1
    });
  }, { apiBaseUrl: imageEditApiBaseUrl, secret: generationSecret });
  await page.getByRole("button", { name: "改图工作台" }).click();
  await page.locator('input[type="file"]').last().setInputFiles(sourceImagePath);
  await page.locator('img[alt="改图源图"]').waitFor();
  await page.getByLabel("原始生图提示词").fill("保持公开测试图的基础构图。");
  await page.getByRole("button", { name: "框选", exact: true }).click();
  await page.getByLabel("当前标注要求").fill("删除左侧对话气泡及其内部文字");
  const editStage = page.locator(".image-edit-stage");
  await editStage.scrollIntoViewIfNeeded();
  await editStage.click({ position: { x: 120, y: 120 } });
  await page.getByText("标注 1 · 框选").waitFor();
  await page.getByRole("button", { name: "解析修改清单", exact: true }).click();
  const confirmChecklist = page.getByRole("button", { name: "确认修改清单", exact: true });
  await confirmChecklist.waitFor();
  assert.equal(await page.getByLabel("原文字（换字时填写）").inputValue(), "");
  assert.equal(await page.getByLabel("新文字（换字时填写）").inputValue(), "");
  await page.getByRole("checkbox", { name: "我已检查此编号的对象、修改和保留项" }).check();
  assert.equal(await confirmChecklist.isEnabled(), true, "Windows 纯删除文字不应禁用确认修改清单");
  await confirmChecklist.click();
  await page.getByRole("button", { name: "修改清单已确认", exact: true }).waitFor();
  await page.getByRole("button", { name: "生成修订版", exact: true }).click();
  await Promise.race([
    imageEditRequestSeen,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Timed out waiting for image-edit API request.")), 10_000))
  ]);
  assert.equal(imageEditRequests.length, 1);
  assert.equal(imageEditRequests[0].path, "/v1/images");
  assert.equal(imageEditRequests[0].model, "openai/gpt-image-2");
  assert.match(imageEditRequests[0].prompt, /删除该对话气泡及其内部文字/);
  assert.equal(imageEditRequests[0].referenceCount, 0);

  const taskDeadline = Date.now() + 10_000;
  let completedEditTask;
  while (Date.now() < taskDeadline) {
    const tasks = await page.evaluate(() => window.styleExtractor.getImageEditTasks());
    completedEditTask = tasks.find((task) => task.status === "succeeded");
    if (completedEditTask) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  assert(completedEditTask, "Windows 改图任务应在 API 返回图片后完成");
  assert.equal(completedEditTask.outputs.length, 1);

  annotationServerMode = "fail";
  const failingAnnotationRequest = {
    ...annotationRequest,
    sourceImageDataUrl: `${sourceIdentityDataUrl}B`,
    instruction: "触发一次可重试的测试回退"
  };
  const firstFallback = await page.evaluate(
    (request) => window.styleExtractor.resolveImageEditAnnotations(request),
    failingAnnotationRequest
  );
  const secondFallback = await page.evaluate(
    (request) => window.styleExtractor.resolveImageEditAnnotations(request),
    failingAnnotationRequest
  );
  assert.equal(firstFallback.resolution.source, "manual_fallback");
  assert.equal(secondFallback.resolution.source, "manual_fallback");
  assert.equal(annotationRequests.length, 4, "失败回退不能被缓存，用户必须能够直接重试");

  await page.evaluate(async ({ apiBaseUrl, secret }) => {
    await window.styleExtractor.saveConfig({
      apiBaseUrl,
      apiMode: "chat_completions",
      apiKey: secret,
      modelName: "windows-e2e-hanging-vision",
      saveApiKey: true
    });
  }, { apiBaseUrl: hangingApiBaseUrl, secret: modelSecret });
  const inFlightAnalysis = page.evaluate(async ({ dataUrl }) => {
    try {
      await window.styleExtractor.analyzeImage({
        imageDataUrl: dataUrl,
        mimeType: "image/png",
        strictGeneralization: true
      });
      return { succeeded: true, error: "" };
    } catch (error) {
      return { succeeded: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, { dataUrl: imageDataUrl });
  await Promise.race([
    pendingRequestSeen,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("Timed out waiting for in-flight analysis.")), 10_000))
  ]);

  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "模型配置" }).click();
  await page.getByText("当前 Windows 设备").waitFor();
  await page.getByRole("button", { name: "抹除全部本机数据" }).click();
  await page.getByText(/Windows 运行时浏览数据已全部抹除/).waitFor({ timeout: 30_000 });
  const clearedAnalysis = await inFlightAnalysis;
  assert.equal(clearedAnalysis.succeeded, false);
  assert.match(clearedAnalysis.error, /已抹除全部本机数据/);

  const clearedState = await page.evaluate(async ({ layoutKey, themeKey }) => ({
    model: await window.styleExtractor.getConfig(),
    generation: await window.styleExtractor.getGenerationConfig(),
    history: await window.styleExtractor.getHistory(),
    generationTasks: await window.styleExtractor.getGenerationTasks(),
    imageEditTasks: await window.styleExtractor.getImageEditTasks(),
    layoutPreference: localStorage.getItem(layoutKey),
    localStorageMarker: localStorage.getItem("windows-e2e-private"),
    themePreference: localStorage.getItem(themeKey)
  }), { layoutKey: layoutStorageKey, themeKey: themeStorageKey });
  assert.equal(clearedState.model.hasApiKey, false);
  assert.equal(clearedState.generation.hasApiKey, false);
  assert.deepEqual(clearedState.history, []);
  assert.deepEqual(clearedState.generationTasks, []);
  assert.deepEqual(clearedState.imageEditTasks, []);
  assert.equal(clearedState.layoutPreference, null);
  assert.equal(clearedState.localStorageMarker, null);
  assert.equal(clearedState.themePreference, null);

  const runtimeState = await electronApp.evaluate(async ({ session }) => ({
    cookies: await session.defaultSession.cookies.get({ name: "windows-e2e-private" }),
    cacheSize: await session.defaultSession.getCacheSize()
  }));
  assert.deepEqual(runtimeState.cookies, []);
  assert.equal(runtimeState.cacheSize, 0);

  await electronApp.close();
  electronApp = undefined;

  const residualFiles = await allFiles(userDataDir);
  for (const filePath of residualFiles) {
    const bytes = await readFile(filePath);
    const text = bytes.toString("utf8");
    assert.equal(text.includes(modelSecret), false, `模型密钥残留在 ${filePath}`);
    assert.equal(text.includes(generationSecret), false, `生图密钥残留在 ${filePath}`);
  }
  await assert.rejects(access(join(userDataDir, "generation")));
  await assert.rejects(access(join(userDataDir, "image-edit")));
  assert.deepEqual(rendererErrors, []);
  await rm(testRoot, { recursive: true, force: true });
  await assert.rejects(access(testRoot));

  console.log("Windows Electron E2E passed: adjustable sidebar, deletion checklist confirmation, image-edit API request, encrypted config, restart recovery and cleanup.");
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined);
  const serverClosed = new Promise((resolveClose) => hangingServer.close(resolveClose));
  hangingServer.closeAllConnections();
  await serverClosed;
  const annotationServerClosed = new Promise((resolveClose) => annotationServer.close(resolveClose));
  annotationServer.closeAllConnections();
  await annotationServerClosed;
  const imageEditServerClosed = new Promise((resolveClose) => imageEditServer.close(resolveClose));
  imageEditServer.closeAllConnections();
  await imageEditServerClosed;
  await rm(testRoot, { recursive: true, force: true });
}

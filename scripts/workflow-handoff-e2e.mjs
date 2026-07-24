import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = await mkdtemp(join(tmpdir(), "image-style-workflow-handoff-"));
const userDataDir = join(testRoot, "user-data");
const generationDir = join(userDataDir, "generation");
const now = "2026-07-21T00:00:00.000Z";
const screenshotPath = process.env.WORKFLOW_HANDOFF_SCREENSHOT?.trim();
const visualScreenshotDir = process.env.LIQUID_PRO_SCREENSHOT_DIR?.trim();
const imageBytes = await readFile(join(rootDir, "assets", "app-icon.png"));
const imageDataUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;
const ratioFixtureDir = join(testRoot, "ratio-fixtures");
const ratioFixtures = [
  { name: "ratio-1x1.svg", width: 800, height: 800 },
  { name: "ratio-9x16.svg", width: 720, height: 1280 },
  { name: "ratio-16x9.svg", width: 1280, height: 720 },
  { name: "ratio-21x9.svg", width: 1680, height: 720 }
].map((fixture) => ({ ...fixture, path: join(ratioFixtureDir, fixture.name) }));

if (visualScreenshotDir) {
  await mkdir(ratioFixtureDir, { recursive: true });
  await Promise.all(
    ratioFixtures.map((fixture) =>
      writeFile(
        fixture.path,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${fixture.width}" height="${fixture.height}" viewBox="0 0 ${fixture.width} ${fixture.height}"><rect width="100%" height="100%" fill="#eaf1f0"/><path d="M0 ${fixture.height} L${fixture.width} 0" stroke="#0f756d" stroke-width="12"/><circle cx="${fixture.width / 2}" cy="${fixture.height / 2}" r="${Math.min(fixture.width, fixture.height) / 8}" fill="#f28b64"/></svg>`
      )
    )
  );
}

const history = [
  {
    id: "history-fused",
    createdAt: now,
    imageDataUrl,
    mimeType: "image/png",
    fileName: "fused-pending.png",
    thumbnailDataUrl: imageDataUrl,
    primaryType: "poster",
    universalStylePrompt: "融合测试风格",
    analysis: {
      style_reference: { universal_style_prompt: "融合测试风格" }
    },
    editedTextMarkdown: "# 融合前文字",
    fusedPromptResult: {
      fused_prompt: "融合后的最终提示词",
      fused_prompt_json: {}
    },
    fusedPromptCreatedAt: now
  },
  {
    id: "history-direct",
    createdAt: now,
    imageDataUrl,
    mimeType: "image/png",
    fileName: "direct-pending.png",
    thumbnailDataUrl: imageDataUrl,
    primaryType: "poster",
    universalStylePrompt: "直达测试风格",
    analysis: {
      style_reference: { universal_style_prompt: "直达测试风格" }
    },
    editedTextMarkdown: "# 编辑后直达标题"
  },
  {
    id: "history-capacity",
    createdAt: now,
    imageDataUrl,
    mimeType: "image/png",
    fileName: "capacity-pending.png",
    thumbnailDataUrl: imageDataUrl,
    primaryType: "poster",
    universalStylePrompt: "容量测试风格",
    analysis: {
      style_reference: { universal_style_prompt: "容量测试风格" }
    },
    editedTextMarkdown: "# 容量测试标题"
  },
  {
    id: "history-represented",
    createdAt: now,
    imageDataUrl,
    mimeType: "image/png",
    fileName: "represented-direct.png",
    thumbnailDataUrl: imageDataUrl,
    primaryType: "poster",
    universalStylePrompt: "已处理测试风格",
    analysis: {
      style_reference: { universal_style_prompt: "已处理测试风格" }
    },
    editedTextMarkdown: "# 已处理标题"
  }
];

const generationTask = {
  id: "e2e-generation-task",
  clientWorkflowId: "e2e-generation-workflow",
  createdAt: now,
  updatedAt: now,
  completedAt: now,
  status: "succeeded",
  visibility: "active",
  prompt: "生成一张公开测试图",
  finalPrompt: "生成一张公开测试图",
  promptSource: {
    kind: "manual",
    label: "E2E 已生成输出",
    sourceImageDataUrl: imageDataUrl,
    sourceThumbnailDataUrl: imageDataUrl,
    sourceFileName: "generation-output-seed.png",
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
  outputs: [
    {
      id: "e2e-generation-output",
      createdAt: now,
      dataUrl: imageDataUrl,
      mimeType: "image/png"
    },
    {
      id: "e2e-generation-output-dismissed",
      createdAt: now,
      dataUrl: imageDataUrl,
      mimeType: "image/png"
    },
    {
      id: "e2e-generation-output-cleared",
      createdAt: now,
      dataUrl: imageDataUrl,
      mimeType: "image/png"
    }
  ]
};

const priorDirectForFusedTask = {
  ...generationTask,
  id: "e2e-prior-direct-for-fused",
  clientWorkflowId: "e2e-prior-direct-for-fused-workflow",
  prompt: "融合前的普通文生图提示词",
  finalPrompt: "融合前的普通文生图提示词",
  promptSource: {
    kind: "text_to_image",
    label: "完整文生图提示词",
    historyItemId: "history-fused",
    sourceImageDataUrl: imageDataUrl,
    sourceThumbnailDataUrl: imageDataUrl,
    sourceFileName: "fused-pending.png",
    importedAt: now
  },
  outputs: []
};

const representedDirectTask = {
  ...generationTask,
  id: "e2e-represented-direct",
  clientWorkflowId: "e2e-represented-direct-workflow",
  prompt: "已经处理的普通文生图提示词",
  finalPrompt: "已经处理的普通文生图提示词",
  promptSource: {
    kind: "text_to_image",
    label: "完整文生图提示词",
    historyItemId: "history-represented",
    sourceImageDataUrl: imageDataUrl,
    sourceThumbnailDataUrl: imageDataUrl,
    sourceFileName: "represented-direct.png",
    importedAt: now
  },
  outputs: []
};

const visualStressTasks = visualScreenshotDir
  ? Array.from({ length: 47 }, (_, index) => ({
      ...generationTask,
      id: `e2e-visual-stress-${index + 1}`,
      clientWorkflowId: `e2e-visual-stress-workflow-${index + 1}`,
      prompt:
        index === 0
          ? "用于验证三千字提示词滚动区域。".repeat(200)
          : `视觉压力测试任务 ${index + 1}`,
      finalPrompt:
        index === 0
          ? "用于验证三千字提示词滚动区域。".repeat(200)
          : `视觉压力测试任务 ${index + 1}`,
      promptSource: {
        kind: "manual",
        label: "视觉压力测试",
        sourceFileName:
          index === 0
            ? `${"超长中文文件名".repeat(18)}.png`
            : `visual-stress-${index + 1}.png`,
        importedAt: now
      },
      outputs: []
    }))
  : [];

await mkdir(generationDir, { recursive: true });
await writeFile(join(userDataDir, "history.json"), JSON.stringify(history, null, 2));
await writeFile(
  join(generationDir, "tasks.json"),
  JSON.stringify(
    [generationTask, priorDirectForFusedTask, representedDirectTask, ...visualStressTasks],
    null,
    2
  )
);

const rendererErrors = [];
let electronApp;

try {
  electronApp = await electron.launch({
    args: [rootDir],
    cwd: rootDir,
    env: {
      ...process.env,
      IMAGE_STYLE_E2E_USER_DATA_DIR: userDataDir
    },
    timeout: 60_000
  });
  const page = await electronApp.firstWindow({ timeout: 60_000 });
  if (screenshotPath) await page.setViewportSize({ width: 1080, height: 720 });
  page.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push(message.text());
  });
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");

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
  const waitForTheme = (expected) =>
    page.waitForFunction(
      (theme) =>
        document.documentElement.dataset.theme === theme &&
        document.documentElement.style.colorScheme === theme,
      expected
    );

  await page.evaluate((key) => localStorage.removeItem(key), themeStorageKey);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await waitForTheme("dark");
  const lightModeButton = page.getByRole("button", { name: "切换为浅色模式", exact: true });
  await lightModeButton.focus();
  await page.keyboard.press("Enter");
  await waitForTheme("light");
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), themeStorageKey),
    "light",
    "键盘切换主题后应保存显式浅色偏好"
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await waitForTheme("light");
  await page.getByRole("button", { name: "生图工作台", exact: true }).click();
  await waitForTheme("light");
  await page.reload();
  await waitForTheme("light");

  await page.evaluate((key) => localStorage.setItem(key, "damaged"), themeStorageKey);
  await page.reload();
  await waitForTheme("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await waitForTheme("light");
  await page.evaluate((key) => localStorage.removeItem(key), themeStorageKey);
  await page.emulateMedia({ colorScheme: null });
  await page.reload();

  const layoutStorageKey = "image-style-prompt-extractor:resizable-layout:v1";
  const separatorState = async (name) => {
    const separator = page.getByRole("separator", { name, exact: true });
    await separator.waitFor();
    return separator.evaluate((element) => {
      const parentRect = element.parentElement.getBoundingClientRect();
      const separatorRect = element.getBoundingClientRect();
      return {
        endWidth: parentRect.right - separatorRect.right,
        parentWidth: parentRect.width,
        ratio: (separatorRect.left - parentRect.left) / parentRect.width,
        startWidth: separatorRect.left - parentRect.left,
        valueNow: Number(element.getAttribute("aria-valuenow"))
      };
    });
  };
  const dragSeparatorTo = async (name, clientX) => {
    const separator = page.getByRole("separator", { name, exact: true });
    const box = await separator.boundingBox();
    assert.ok(box, `${name} 不可见`);
    const y = box.y + Math.min(Math.max(box.height / 2, 4), box.height - 4);
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(clientX, y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(30);
  };
  const horizontalSeparatorState = async (name) => {
    const separator = page.getByRole("separator", { name, exact: true });
    await separator.waitFor();
    return separator.evaluate((element) => {
      const parentRect = element.parentElement.getBoundingClientRect();
      const separatorRect = element.getBoundingClientRect();
      return {
        endSize: parentRect.bottom - separatorRect.bottom,
        parentSize: parentRect.height,
        ratio: (separatorRect.top - parentRect.top) / parentRect.height,
        startSize: separatorRect.top - parentRect.top,
        valueNow: Number(element.getAttribute("aria-valuenow"))
      };
    });
  };
  const dragHorizontalSeparatorTo = async (name, clientY) => {
    const separator = page.getByRole("separator", { name, exact: true });
    const box = await separator.boundingBox();
    assert.ok(box, `${name} 不可见`);
    const x = box.x + Math.min(Math.max(box.width / 2, 4), box.width - 4);
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, clientY, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(30);
  };
  const storedLayoutRatio = (layoutId) =>
    page.evaluate(
      ({ key, id }) => {
        try {
          return JSON.parse(localStorage.getItem(key) || "{}")?.ratios?.[id] ?? null;
        } catch {
          return null;
        }
      },
      { key: layoutStorageKey, id: layoutId }
    );
  const exerciseSeparator = async ({
    layoutId,
    maximumStartWidth,
    minimumEndWidth,
    minimumStartWidth,
    name
  }) => {
    const separator = page.getByRole("separator", { name, exact: true });
    const initial = await separatorState(name);
    await separator.focus();
    await page.keyboard.press("ArrowRight");
    const afterSmallStep = await separatorState(name);
    assert.ok(
      afterSmallStep.valueNow > initial.valueNow,
      `${name} 的向右方向键未增大起始区域`
    );
    await page.keyboard.press("Shift+ArrowLeft");
    const afterLargeStep = await separatorState(name);
    assert.ok(
      afterLargeStep.valueNow < afterSmallStep.valueNow,
      `${name} 的 Shift + 向左方向键未执行大步调整`
    );

    const separatorBox = await separator.boundingBox();
    assert.ok(separatorBox, `${name} 不可见`);
    await dragSeparatorTo(name, separatorBox.x + separatorBox.width / 2 + 52);
    const afterDrag = await separatorState(name);
    assert.ok(
      afterDrag.startWidth > afterLargeStep.startWidth + 20,
      `${name} 的指针拖动未改变相邻区域占比`
    );

    await dragSeparatorTo(name, 0);
    const atMinimum = await separatorState(name);
    assert.ok(
      atMinimum.startWidth >= minimumStartWidth - 2,
      `${name} 突破了起始区域最小宽度`
    );

    await dragSeparatorTo(name, (page.viewportSize()?.width || 1320) - 1);
    const atMaximum = await separatorState(name);
    assert.ok(
      atMaximum.endWidth >= minimumEndWidth - 2,
      `${name} 突破了末端区域最小宽度`
    );
    if (maximumStartWidth) {
      assert.ok(
        atMaximum.startWidth <= maximumStartWidth + 2,
        `${name} 突破了起始区域最大宽度`
      );
    }

    const storedRatio = await storedLayoutRatio(layoutId);
    assert.equal(Number.isFinite(storedRatio), true, `${name} 未保存合法归一化比例`);
    assert.ok(
      Math.abs(storedRatio - atMaximum.ratio) < 0.003,
      `${name} 保存的比例与实际轨道不一致`
    );
    return storedRatio;
  };
  const assertPersistedSeparator = async (name, storedRatio) => {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const state = await separatorState(name);
      if (Math.abs(state.ratio - storedRatio) < 0.012) return;
      await page.waitForTimeout(25);
    }
    assert.fail(`${name} 在重新挂载后未恢复保存的比例`);
  };
  const assertPersistedHorizontalSeparator = async (name, storedRatio) => {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const state = await horizontalSeparatorState(name);
      if (Math.abs(state.ratio - storedRatio) < 0.012) return;
      await page.waitForTimeout(25);
    }
    assert.fail(`${name} 在重新挂载后未恢复保存的比例`);
  };
  const resetSeparator = async (name, layoutId) => {
    await page.getByRole("separator", { name, exact: true }).dblclick();
    await page.waitForTimeout(30);
    assert.equal(await storedLayoutRatio(layoutId), null, `${name} 双击后未恢复默认布局`);
  };

  const captureVisualState = async (state) => {
    if (!visualScreenshotDir) return;
    await mkdir(visualScreenshotDir, { recursive: true });
    const originalViewport = page.viewportSize() || { width: 1320, height: 860 };
    const sizes = [
      { width: 1440, height: 900 },
      { width: 1320, height: 860 },
      { width: 1180, height: 760 },
      { width: 1080, height: 720 }
    ];
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.evaluate(() => {
        document
          .querySelectorAll(
            ".workflow-navigator-list, .left-panel, .result-panel, .generation-controls, .generation-results, .generation-workspace, .image-edit-workspace"
          )
          .forEach((element) => {
            element.scrollTop = 0;
            element.scrollLeft = 0;
          });
      });
      await page.waitForTimeout(80);
      const layout = await page.evaluate(() => {
        const navigationButtons = Array.from(
          document.querySelectorAll(".page-tabs button")
        ).map((button) => button.getBoundingClientRect());
        const workflowRows = Array.from(
          document.querySelectorAll(".workflow-navigator-row")
        ).map((row) => row.getBoundingClientRect());
        const lastNavigationButton = navigationButtons.at(-1);
        const sidebarSeparator = document
          .querySelector('[data-layout-id="sidebar-workspaces"]')
          ?.getBoundingClientRect();
        const workflowNavigator = document
          .querySelector(".workflow-navigator")
          ?.getBoundingClientRect();
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          navigationVisible: navigationButtons.every(
            (rect) =>
              rect.width > 0 &&
              rect.height > 0 &&
              rect.left >= 0 &&
              rect.right <= window.innerWidth
          ),
          sidebarRegionsSeparated:
            Boolean(lastNavigationButton && sidebarSeparator && workflowNavigator) &&
            lastNavigationButton.bottom <= sidebarSeparator.top + 1 &&
            sidebarSeparator.bottom <= workflowNavigator.top + 1 &&
            workflowNavigator.top - lastNavigationButton.bottom >= 12,
          workflowRowsStable: workflowRows.every((rect) => rect.height >= 40)
        };
      });
      assert.ok(
        layout.scrollWidth <= layout.clientWidth + 1,
        `${state} ${size.width}x${size.height} 出现应用级横向滚动`
      );
      assert.equal(layout.navigationVisible, true, `${state} 的工作区导航不可见`);
      assert.equal(
        layout.sidebarRegionsSeparated,
        true,
        `${state} 的工作台导航、横向分隔条与流程列表发生贴靠或重叠`
      );
      assert.equal(layout.workflowRowsStable, true, `${state} 的流程行被长列表压缩`);
      await page.screenshot({
        path: join(visualScreenshotDir, `${state}-${size.width}x${size.height}-light.png`)
      });
    }

    await page.setViewportSize({ width: 1320, height: 860 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.waitForTimeout(80);
    await page.screenshot({
      path: join(visualScreenshotDir, `${state}-1320x860-dark.png`)
    });
    await page.evaluate(() => document.documentElement.classList.add("reduce-transparency"));
    await page.waitForTimeout(50);
    await page.screenshot({
      path: join(visualScreenshotDir, `${state}-1320x860-solid-fallback.png`)
    });
    await page.evaluate(() => document.documentElement.classList.remove("reduce-transparency"));
    await page.emulateMedia({ colorScheme: null, reducedMotion: null });
    await page.setViewportSize(originalViewport);
  };

  const extractionNav = page.locator('aside[aria-label="图片解析工作区流程导航"]');
  await extractionNav.getByText("direct-pending.png", { exact: true }).waitFor();
  const directExtractionMarker = await extractionNav
    .locator(".workflow-navigator-row")
    .filter({ hasText: "direct-pending.png" })
    .locator(".workflow-lineage-marker")
    .textContent();
  const fusedExtractionMarker = await extractionNav
    .locator(".workflow-navigator-row")
    .filter({ hasText: "fused-pending.png" })
    .locator(".workflow-lineage-marker")
    .textContent();

  await page.setViewportSize({ width: 1320, height: 860 });
  const sidebarWorkspaceSeparatorName = "调整工作台导航与流程列表高度";
  const sidebarWorkspaceSeparator = page.getByRole("separator", {
    name: sidebarWorkspaceSeparatorName,
    exact: true
  });
  assert.equal(
    await sidebarWorkspaceSeparator.getAttribute("aria-orientation"),
    "horizontal",
    "工作台导航与流程列表之间应使用横向分隔条"
  );
  const initialSidebarWorkspaceLayout = await horizontalSeparatorState(
    sidebarWorkspaceSeparatorName
  );
  await sidebarWorkspaceSeparator.focus();
  await page.keyboard.press("ArrowDown");
  const sidebarWorkspaceAfterSmallStep = await horizontalSeparatorState(
    sidebarWorkspaceSeparatorName
  );
  assert.ok(
    sidebarWorkspaceAfterSmallStep.valueNow > initialSidebarWorkspaceLayout.valueNow,
    "横向分隔条的向下方向键未增大工作台导航区域"
  );
  await page.keyboard.press("Shift+ArrowUp");
  const sidebarWorkspaceAfterLargeStep = await horizontalSeparatorState(
    sidebarWorkspaceSeparatorName
  );
  assert.ok(
    sidebarWorkspaceAfterLargeStep.valueNow < sidebarWorkspaceAfterSmallStep.valueNow,
    "横向分隔条的 Shift + 向上方向键未执行大步调整"
  );
  const sidebarWorkspaceSeparatorBox = await sidebarWorkspaceSeparator.boundingBox();
  assert.ok(sidebarWorkspaceSeparatorBox, "工作台导航横向分隔条不可见");
  await dragHorizontalSeparatorTo(
    sidebarWorkspaceSeparatorName,
    sidebarWorkspaceSeparatorBox.y + sidebarWorkspaceSeparatorBox.height / 2 + 52
  );
  const sidebarWorkspaceAfterDrag = await horizontalSeparatorState(
    sidebarWorkspaceSeparatorName
  );
  assert.ok(
    sidebarWorkspaceAfterDrag.startSize > sidebarWorkspaceAfterLargeStep.startSize + 20,
    "工作台导航横向分隔条的指针拖动未改变上下区域占比"
  );
  await dragHorizontalSeparatorTo(sidebarWorkspaceSeparatorName, 0);
  const sidebarWorkspaceAtMinimum = await horizontalSeparatorState(
    sidebarWorkspaceSeparatorName
  );
  assert.ok(
    sidebarWorkspaceAtMinimum.startSize >= 230,
    "工作台导航横向分隔条突破了桌面高度下的上方安全边界"
  );
  await dragHorizontalSeparatorTo(
    sidebarWorkspaceSeparatorName,
    (page.viewportSize()?.height || 860) - 1
  );
  const sidebarWorkspaceAtMaximum = await horizontalSeparatorState(
    sidebarWorkspaceSeparatorName
  );
  assert.ok(
    sidebarWorkspaceAtMaximum.startSize <= 362 &&
      sidebarWorkspaceAtMaximum.endSize >= 298,
    "工作台导航横向分隔条突破了流程列表的可用空间边界"
  );
  const sidebarWorkspaceRatio = await storedLayoutRatio("sidebar-workspaces");
  assert.equal(
    Number.isFinite(sidebarWorkspaceRatio),
    true,
    "工作台导航横向分隔条未保存合法归一化比例"
  );
  assert.ok(
    Math.abs(sidebarWorkspaceRatio - sidebarWorkspaceAtMaximum.ratio) < 0.003,
    "工作台导航横向分隔条保存的比例与实际位置不一致"
  );
  await page.getByRole("button", { name: "生图工作台", exact: true }).click();
  await page.getByRole("button", { name: "改图工作台", exact: true }).click();
  await page.getByRole("button", { name: "提示词提取", exact: true }).click();
  await assertPersistedHorizontalSeparator(
    sidebarWorkspaceSeparatorName,
    sidebarWorkspaceRatio
  );
  await page.setViewportSize({ width: 1080, height: 720 });
  const compactSidebarWorkspaceLayout = await horizontalSeparatorState(
    sidebarWorkspaceSeparatorName
  );
  assert.ok(
    compactSidebarWorkspaceLayout.startSize >= 198 &&
      compactSidebarWorkspaceLayout.endSize >= 298,
    "紧凑窗口下横向分隔条未保留导航与流程列表的安全高度"
  );
  await page.setViewportSize({ width: 1320, height: 860 });
  await assertPersistedHorizontalSeparator(
    sidebarWorkspaceSeparatorName,
    sidebarWorkspaceRatio
  );
  await page.reload();
  await assertPersistedHorizontalSeparator(
    sidebarWorkspaceSeparatorName,
    sidebarWorkspaceRatio
  );
  await resetSeparator(sidebarWorkspaceSeparatorName, "sidebar-workspaces");
  const resetSidebarWorkspaceLayout = await horizontalSeparatorState(
    sidebarWorkspaceSeparatorName
  );
  assert.ok(
    Math.abs(resetSidebarWorkspaceLayout.startSize - 240) <= 2,
    "横向分隔条双击后未恢复舒适的默认间距"
  );

  const appSidebarRatio = await exerciseSeparator({
    layoutId: "app-sidebar",
    maximumStartWidth: 360,
    minimumEndWidth: 720,
    minimumStartWidth: 200,
    name: "调整应用侧栏与主内容宽度"
  });
  const extractionPanelRatio = await exerciseSeparator({
    layoutId: "extraction",
    minimumEndWidth: 360,
    minimumStartWidth: 280,
    name: "调整图片输入区与结果区宽度"
  });
  await page.setViewportSize({ width: 1080, height: 720 });
  const compactAppLayout = await separatorState("调整应用侧栏与主内容宽度");
  const compactExtractionLayout = await separatorState("调整图片输入区与结果区宽度");
  assert.ok(
    compactAppLayout.startWidth >= 198 && compactAppLayout.endWidth >= 718,
    "窗口缩小时应用侧栏布局未遵守相邻区域最小尺寸"
  );
  assert.ok(
    compactExtractionLayout.startWidth >= 278 && compactExtractionLayout.endWidth >= 358,
    "窗口缩小时提示词提取布局未遵守相邻区域最小尺寸"
  );
  await page.setViewportSize({ width: 1320, height: 860 });
  await assertPersistedSeparator("调整应用侧栏与主内容宽度", appSidebarRatio);
  await assertPersistedSeparator("调整图片输入区与结果区宽度", extractionPanelRatio);
  await page.reload();
  await assertPersistedSeparator("调整应用侧栏与主内容宽度", appSidebarRatio);
  await assertPersistedSeparator("调整图片输入区与结果区宽度", extractionPanelRatio);
  await resetSeparator("调整应用侧栏与主内容宽度", "app-sidebar");
  await resetSeparator("调整图片输入区与结果区宽度", "extraction");

  await page.getByRole("button", { name: "生图工作台" }).click();
  const generationNav = page.locator('aside[aria-label="生图工作区流程导航"]');
  const directPending = generationNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "direct-pending.png" });
  const fusedPending = generationNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "fused-pending.png" });
  const capacityPending = generationNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "capacity-pending.png" });
  await directPending.waitFor();
  await fusedPending.waitFor();
  await capacityPending.waitFor();
  assert.equal(
    await generationNav
      .locator(".workflow-navigator-row-setup")
      .filter({ hasText: "represented-direct.png" })
      .count(),
    0
  );
  assert.equal((await directPending.locator(".workflow-navigator-subtitle").textContent())?.trim(), "待处理");
  assert.equal((await directPending.locator(".workflow-status-badge").textContent())?.trim(), "待处理");
  assert.equal(await directPending.locator(".workflow-navigator-close").count(), 1);
  assert.equal((await directPending.locator(".workflow-lineage-marker").textContent())?.trim(), directExtractionMarker?.trim());
  assert.equal((await fusedPending.locator(".workflow-lineage-marker").textContent())?.trim(), fusedExtractionMarker?.trim());
  await generationNav.getByText("进行中 0 / 5", { exact: true }).waitFor();

  await directPending.locator(".workflow-navigator-main").click();
  const generationPrompt = page.getByLabel("生图提示词");
  await generationPrompt.waitFor();
  const generationPanelRatio = await exerciseSeparator({
    layoutId: "generation",
    minimumEndWidth: 360,
    minimumStartWidth: 400,
    name: "调整生图控制区与结果区宽度"
  });
  await page.getByRole("button", { name: "提示词提取", exact: true }).click();
  await page.getByRole("button", { name: "生图工作台", exact: true }).click();
  await generationPrompt.waitFor();
  await assertPersistedSeparator("调整生图控制区与结果区宽度", generationPanelRatio);
  await resetSeparator("调整生图控制区与结果区宽度", "generation");
  assert.match(await generationPrompt.inputValue(), /编辑后直达标题/);
  await page.getByText("当前模式：文生图，不发送图片给生图模型", { exact: true }).waitFor();
  await generationNav.getByText("进行中 1 / 5", { exact: true }).waitFor();

  await fusedPending.locator(".workflow-navigator-main").click();
  await page.locator(".generation-source-strip").getByText("最终融合提示词", { exact: true }).waitFor();
  assert.equal(await generationPrompt.inputValue(), "融合后的最终提示词");
  await generationNav.getByText("进行中 2 / 5", { exact: true }).waitFor();

  const fusedGenerationRows = generationNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "fused-pending.png" });
  await page.getByRole("button", { name: "完整文生图提示词", exact: true }).click();
  assert.equal(await fusedGenerationRows.count(), 1);
  assert.match(await generationPrompt.inputValue(), /融合前文字/);
  await page.getByRole("button", { name: "最终融合提示词", exact: true }).click();
  assert.equal(await fusedGenerationRows.count(), 1);
  assert.equal(await generationPrompt.inputValue(), "融合后的最终提示词");
  await generationNav.getByText("进行中 2 / 5", { exact: true }).waitFor();

  for (let occupied = 3; occupied <= 5; occupied += 1) {
    await generationNav.getByRole("button", { name: "新建流程" }).click();
    await generationNav.getByText(`进行中 ${occupied} / 5`, { exact: true }).waitFor();
  }
  await capacityPending.locator(".workflow-navigator-main").click();
  const capacityDialog = page.getByRole("dialog", { name: "已达到并发上限" });
  await capacityDialog.waitFor();
  await capacityDialog.getByText("生图工作区最多同时处理 5 个流程，当前占用 5 / 5。", { exact: true }).waitFor();
  assert.equal(await capacityPending.locator(".workflow-navigator-close").count(), 1);
  await captureVisualState("capacity-dialog");
  assert.equal(
    await capacityDialog.evaluate((dialog) => dialog.contains(document.activeElement)),
    true,
    "容量弹窗打开后焦点未进入对话框"
  );
  await capacityDialog.getByRole("button", { name: "我知道了" }).click();
  await generationNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "手动生图" })
    .locator(".workflow-navigator-close")
    .first()
    .click();
  await generationNav.getByText("进行中 4 / 5", { exact: true }).waitFor();
  await capacityPending.locator(".workflow-navigator-main").click();
  await generationNav.getByText("进行中 5 / 5", { exact: true }).waitFor();
  assert.equal(await capacityPending.locator(".workflow-navigator-close").count(), 1);

  const generatedTaskRow = generationNav
    .locator(".workflow-navigator-row")
    .filter({ hasText: "generation-output-seed.png" });
  const generatedTaskMarker = await generatedTaskRow.locator(".workflow-lineage-marker").textContent();

  await page.getByRole("button", { name: "提示词提取" }).click();
  const directExtractionRow = extractionNav
    .locator(".workflow-navigator-row")
    .filter({ hasText: "direct-pending.png" });
  await directExtractionRow.locator(".workflow-navigator-main").click();
  await page.getByLabel("图中文字 Markdown 编辑区").fill("# 自动刷新后的直达标题");
  await captureVisualState("extract");

  await page.getByRole("button", { name: "生图工作台" }).click();
  const directGenerationRows = generationNav
    .locator(".workflow-navigator-row")
    .filter({ hasText: "direct-pending.png" });
  await directGenerationRows.getByText("已同步最新解析结果", { exact: true }).waitFor();
  assert.equal(await directGenerationRows.count(), 1);
  await directGenerationRows.locator(".workflow-navigator-main").click();
  assert.match(await generationPrompt.inputValue(), /自动刷新后的直达标题/);
  assert.equal(await page.getByRole("dialog", { name: "已达到并发上限" }).count(), 0);

  await generationPrompt.fill("用户手动保留的生图提示词");
  await page.getByRole("button", { name: "提示词提取" }).click();
  await page.getByLabel("图中文字 Markdown 编辑区").fill("# 第二次解析更新");
  await page.getByRole("button", { name: "生图工作台" }).click();
  await directGenerationRows
    .getByText("解析结果有更新，已保留生图手动修改", { exact: true })
    .waitFor();
  assert.equal(await directGenerationRows.count(), 1);
  assert.equal(await generationPrompt.inputValue(), "用户手动保留的生图提示词");

  await page.getByRole("button", { name: "完整文生图提示词", exact: true }).click();
  assert.equal(await directGenerationRows.count(), 1);
  assert.match(await generationPrompt.inputValue(), /第二次解析更新/);

  await page.getByRole("button", { name: "通用风格提示词", exact: true }).click();
  assert.equal(await directGenerationRows.count(), 1);
  assert.equal(await generationPrompt.inputValue(), "直达测试风格");
  await generationNav.getByText("进行中 5 / 5", { exact: true }).waitFor();
  if (screenshotPath) await page.screenshot({ path: screenshotPath });
  await captureVisualState("generate");
  if (visualScreenshotDir) {
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    const modelConfigDialog = page.getByRole("dialog", { name: "模型配置" });
    await modelConfigDialog.waitFor();
    await captureVisualState("model-config-dialog");
    await modelConfigDialog.getByRole("button", { name: "取消" }).click();
    const longContentTask = generationNav
      .locator(".workflow-navigator-row")
      .filter({ hasText: visualStressTasks[0].promptSource.sourceFileName });
    await longContentTask.locator(".workflow-navigator-main").click();
    await captureVisualState("generate-long-content");
  }
  assert.equal(
    await generationNav
      .locator(".workflow-navigator-row-setup")
      .filter({ hasText: "direct-pending.png" })
      .locator(".workflow-navigator-close")
      .count(),
    1
  );
  assert.equal(
    await generationNav
      .locator(".workflow-navigator-row-setup")
      .filter({ hasText: "fused-pending.png" })
      .locator(".workflow-navigator-close")
      .count(),
    1
  );
  assert.equal(await capacityPending.locator(".workflow-navigator-close").count(), 1);

  await page.getByRole("button", { name: "改图工作台" }).click();
  const imageEditNav = page.locator('aside[aria-label="改图工作区流程导航"]');
  let pendingImageEdit = imageEditNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "generation-output-seed.png · 01" });
  let dismissedPendingImageEdit = imageEditNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "generation-output-seed.png · 02" });
  let clearedPendingImageEdit = imageEditNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "generation-output-seed.png · 03" });
  await pendingImageEdit.waitFor();
  await dismissedPendingImageEdit.waitFor();
  await clearedPendingImageEdit.waitFor();
  assert.equal((await pendingImageEdit.locator(".workflow-navigator-subtitle").textContent())?.trim(), "待处理");
  assert.equal(await pendingImageEdit.locator(".workflow-navigator-close").count(), 1);
  assert.equal((await pendingImageEdit.locator(".workflow-lineage-marker").textContent())?.trim(), generatedTaskMarker?.trim());
  await imageEditNav.getByText("进行中 0 / 5", { exact: true }).waitFor();

  await dismissedPendingImageEdit.locator(".workflow-navigator-close").click();
  assert.equal(await dismissedPendingImageEdit.count(), 0);
  await page.reload();
  await page.getByRole("button", { name: "改图工作台" }).click();
  pendingImageEdit = imageEditNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "generation-output-seed.png · 01" });
  dismissedPendingImageEdit = imageEditNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "generation-output-seed.png · 02" });
  clearedPendingImageEdit = imageEditNav
    .locator(".workflow-navigator-row-setup")
    .filter({ hasText: "generation-output-seed.png · 03" });
  await pendingImageEdit.waitFor();
  await clearedPendingImageEdit.waitFor();
  assert.equal(await dismissedPendingImageEdit.count(), 0);

  const imageEditSourceInput = page.locator('input[type="file"]').last();
  const waitForImageEditInputReset = () =>
    imageEditSourceInput.evaluate(
      (input) =>
        new Promise((resolveReset, rejectReset) => {
          const deadline = Date.now() + 30_000;
          const check = () => {
            if (!input.value) {
              resolveReset();
              return;
            }
            if (Date.now() >= deadline) {
              rejectReset(new Error("等待改图文件输入重置超时"));
              return;
            }
            window.setTimeout(check, 25);
          };
          check();
        })
    );
  if (visualScreenshotDir) {
    for (const fixture of ratioFixtures) {
      await imageEditSourceInput.setInputFiles(fixture.path);
      await waitForImageEditInputReset();
      const fixtureRow = imageEditNav
        .locator(".workflow-navigator-row")
        .filter({ hasText: fixture.name });
      await fixtureRow.waitFor();
      const stage = page.locator(".image-edit-stage");
      await stage.waitFor();
      await page.setViewportSize({ width: 1440, height: 900 });
      await stage.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      const drawAnnotation = async (tool, start, end = start) => {
        if (tool) {
          await page
            .locator(".image-edit-tool-tabs")
            .getByRole("button", { name: tool, exact: true })
            .click();
        }
        await stage.scrollIntoViewIfNeeded();
        const drawBox = await stage.boundingBox();
        assert.ok(drawBox, `${fixture.name} 的改图标注画布不可见`);
        await page.mouse.move(
          drawBox.x + drawBox.width * start.x,
          drawBox.y + drawBox.height * start.y
        );
        await page.mouse.down();
        await page.mouse.move(
          drawBox.x + drawBox.width * end.x,
          drawBox.y + drawBox.height * end.y,
          { steps: 8 }
        );
        await page.mouse.up();
      };
      await drawAnnotation(null, { x: 0.27, y: 0.31 }, { x: 0.68, y: 0.69 });
      if (fixture.name === "ratio-1x1.svg") {
        await drawAnnotation("箭头", { x: 0.18, y: 0.75 }, { x: 0.65, y: 0.25 });
        await drawAnnotation("框选", { x: 0.42, y: 0.18 }, { x: 0.83, y: 0.55 });
        await drawAnnotation("文字", { x: 0.72, y: 0.72 });
      }

      const readAnnotationGeometry = () =>
        stage.evaluate((element) => {
          const stageRect = element.getBoundingClientRect();
          const labels = Array.from(
            element.querySelectorAll(".image-edit-annotation-label circle")
          ).map((label) => {
            const labelRect = label.getBoundingClientRect();
            return {
              aspectRatio: labelRect.width / labelRect.height,
              x: (labelRect.left + labelRect.width / 2 - stageRect.left) / stageRect.width,
              y: (labelRect.top + labelRect.height / 2 - stageRect.top) / stageRect.height
            };
          });
          if (!labels.length) return null;
          return {
            aspectRatio: stageRect.width / stageRect.height,
            labels
          };
        });

      const wideGeometry = await readAnnotationGeometry();
      assert.ok(wideGeometry, `${fixture.name} 未渲染标注编号`);
      assert.ok(
        Math.abs(wideGeometry.aspectRatio - fixture.width / fixture.height) < 0.02,
        `${fixture.name} 的画布比例发生变化`
      );
      assert.ok(
        wideGeometry.labels.every((label) => Math.abs(label.aspectRatio - 1) < 0.08),
        `${fixture.name} 的标注编号不是圆形`
      );

      await page.setViewportSize({ width: 1080, height: 720 });
      await stage.scrollIntoViewIfNeeded();
      await page.waitForTimeout(120);
      const compactGeometry = await readAnnotationGeometry();
      assert.ok(compactGeometry, `${fixture.name} 缩放后未渲染标注编号`);
      assert.ok(
        compactGeometry.labels.length === wideGeometry.labels.length &&
          compactGeometry.labels.every(
            (label, index) =>
              Math.abs(label.x - wideGeometry.labels[index].x) < 0.015 &&
              Math.abs(label.y - wideGeometry.labels[index].y) < 0.015
          ),
        `${fixture.name} 的标注在窗口缩放后发生漂移`
      );
      assert.ok(
        compactGeometry.labels.every((label) => Math.abs(label.aspectRatio - 1) < 0.08),
        `${fixture.name} 缩放后的标注编号不是圆形`
      );
      await page.screenshot({
        path: join(visualScreenshotDir, `edit-${fixture.name.replace(".svg", "")}-1080x720.png`)
      });

      await page.setViewportSize({ width: 1320, height: 860 });
      await fixtureRow.locator(".workflow-navigator-close").click();
      await fixtureRow.waitFor({ state: "detached" });
    }
  }
  for (let occupied = 1; occupied <= 5; occupied += 1) {
    await imageEditSourceInput.setInputFiles(join(rootDir, "assets", "app-icon.png"));
    await waitForImageEditInputReset();
    await imageEditNav.getByText(`进行中 ${occupied} / 5`, { exact: true }).waitFor();
  }
  await pendingImageEdit.locator(".workflow-navigator-main").click();
  const imageEditCapacityDialog = page.getByRole("dialog", { name: "已达到并发上限" });
  await imageEditCapacityDialog.waitFor();
  await imageEditCapacityDialog
    .getByText("改图工作区最多同时处理 5 个流程，当前占用 5 / 5。", { exact: true })
    .waitFor();
  assert.equal(await pendingImageEdit.count(), 1);
  await imageEditCapacityDialog.getByRole("button", { name: "我知道了" }).click();
  await imageEditNav.locator(".workflow-navigator-close").first().click();
  await imageEditNav.getByText("进行中 4 / 5", { exact: true }).waitFor();

  await pendingImageEdit.locator(".workflow-navigator-main").click();
  await page.locator('img[alt="改图源图"]').waitFor();
  await imageEditNav.getByText("generated-e2e-gene-01", { exact: true }).waitFor();
  await imageEditNav.getByText("进行中 5 / 5", { exact: true }).waitFor();
  assert.equal(await pendingImageEdit.count(), 0);
  await page.setViewportSize({ width: 1320, height: 860 });
  const resizeStage = page.locator(".image-edit-stage");
  const resizeStageBox = await resizeStage.boundingBox();
  assert.ok(resizeStageBox, "改图标注画布不可见");
  await page.mouse.move(
    resizeStageBox.x + resizeStageBox.width * 0.3,
    resizeStageBox.y + resizeStageBox.height * 0.32
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeStageBox.x + resizeStageBox.width * 0.66,
    resizeStageBox.y + resizeStageBox.height * 0.68,
    { steps: 8 }
  );
  await page.mouse.up();
  await resizeStage.locator(".image-edit-annotation-label circle").first().waitFor();
  const readResizeAnnotationGeometry = () =>
    resizeStage.evaluate((element) => {
      const stageRect = element.getBoundingClientRect();
      const circleRect = element
        .querySelector(".image-edit-annotation-label circle")
        .getBoundingClientRect();
      return {
        circleAspectRatio: circleRect.width / circleRect.height,
        stageWidth: stageRect.width,
        x: (circleRect.left + circleRect.width / 2 - stageRect.left) / stageRect.width,
        y: (circleRect.top + circleRect.height / 2 - stageRect.top) / stageRect.height
      };
    });
  await dragSeparatorTo("调整改图控制区与结果区宽度", 0);
  const annotationBeforePanelResize = await readResizeAnnotationGeometry();
  const imageEditPanelRatio = await exerciseSeparator({
    layoutId: "image-edit",
    minimumEndWidth: 360,
    minimumStartWidth: 440,
    name: "调整改图控制区与结果区宽度"
  });
  const annotationAfterPanelResize = await readResizeAnnotationGeometry();
  assert.ok(
    Math.abs(annotationAfterPanelResize.stageWidth - annotationBeforePanelResize.stageWidth) > 10,
    "拖动改图分隔线没有改变标注画布尺寸"
  );
  assert.ok(
    Math.abs(annotationAfterPanelResize.x - annotationBeforePanelResize.x) < 0.015 &&
      Math.abs(annotationAfterPanelResize.y - annotationBeforePanelResize.y) < 0.015,
    "拖动改图分隔线后归一化标注位置发生漂移"
  );
  assert.ok(
    Math.abs(annotationAfterPanelResize.circleAspectRatio - 1) < 0.08,
    "拖动改图分隔线后标注编号不再保持圆形"
  );
  await page.getByRole("button", { name: "提示词提取", exact: true }).click();
  await page.getByRole("button", { name: "改图工作台", exact: true }).click();
  await assertPersistedSeparator("调整改图控制区与结果区宽度", imageEditPanelRatio);
  await resetSeparator("调整改图控制区与结果区宽度", "image-edit");
  if (visualScreenshotDir) {
    const stage = page.locator(".image-edit-stage");
    const box = await stage.boundingBox();
    assert.ok(box, "改图标注画布不可见");
    await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.66, box.y + box.height * 0.68, { steps: 8 });
    await page.mouse.up();
  }
  await captureVisualState("edit");

  await imageEditNav
    .locator(".workflow-navigator-row")
    .filter({ hasText: "generated-e2e-gene-01" })
    .locator(".workflow-navigator-close")
    .click();
  await pendingImageEdit.waitFor();
  const acceptNextDialog = () => page.once("dialog", (dialog) => dialog.accept());
  acceptNextDialog();
  await imageEditNav.getByRole("button", { name: "清空改图历史" }).click();
  assert.equal(await pendingImageEdit.count(), 0);
  assert.equal(await clearedPendingImageEdit.count(), 0);

  await page.reload();
  await page.getByRole("button", { name: "改图工作台" }).click();
  assert.equal(
    await imageEditNav.locator(".workflow-navigator-row").filter({ hasText: "generation-output-seed.png" }).count(),
    0
  );

  await page.getByRole("button", { name: "生图工作台" }).click();
  acceptNextDialog();
  await generationNav.getByRole("button", { name: "清空生图历史" }).click();
  await generationNav.getByText("暂无流程", { exact: true }).waitFor();

  await page.getByRole("button", { name: "提示词提取" }).click();
  acceptNextDialog();
  await extractionNav.getByRole("button", { name: "清空图片解析历史" }).click();
  await extractionNav.getByText("暂无流程", { exact: true }).waitFor();

  assert.deepEqual(rendererErrors, []);
  console.log("Workflow handoff Electron E2E passed.");
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined);
  await rm(testRoot, { recursive: true, force: true });
}

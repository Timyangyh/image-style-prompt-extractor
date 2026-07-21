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
const imageBytes = await readFile(join(rootDir, "assets", "app-icon.png"));
const imageDataUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;

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

await mkdir(generationDir, { recursive: true });
await writeFile(join(userDataDir, "history.json"), JSON.stringify(history, null, 2));
await writeFile(
  join(generationDir, "tasks.json"),
  JSON.stringify([generationTask, priorDirectForFusedTask, representedDirectTask], null, 2)
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
  for (let occupied = 1; occupied <= 5; occupied += 1) {
    await imageEditSourceInput.setInputFiles(join(rootDir, "assets", "app-icon.png"));
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

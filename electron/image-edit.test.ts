import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import {
  ImageEditService,
  closestImageEditAspectRatio,
  forceOriginRegenerationResponsesAction,
  imageEditAnnotationContentHash,
  imageEditResolutionForDimensions,
  imageEditSettingsFromSource
} from "./image-edit";
import type { ImageEditCreateRequest } from "../src/shared/types";

const crcTable = Array.from({ length: 256 }, (_item, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const crc32 = (buffer: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
};

const pngCache = new Map<string, Buffer>();

const pngBytes = (width: number, height: number): Buffer => {
  const key = `${width}x${height}`;
  const cached = pngCache.get(key);
  if (cached) return cached;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  const row = Buffer.alloc(width * 4 + 1);
  row[0] = 0;
  for (let x = 0; x < width; x += 1) {
    const offset = 1 + x * 4;
    row[offset] = 32;
    row[offset + 1] = 96;
    row[offset + 2] = 160;
    row[offset + 3] = x === 0 ? 96 : 255;
  }
  for (let y = 0; y < height; y += 1) {
    row.copy(scanlines, y * row.length);
  }
  const buffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  pngCache.set(key, buffer);
  return buffer;
};

const dataUrl = (width: number, height: number): string =>
  `data:image/png;base64,${pngBytes(width, height).toString("base64")}`;

const jpeg1x1 =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//Z";
const webp1x1 = "data:image/webp;base64,UklGRiAAAABXRUJQVlA4IBQAAAAwAQCdASoBAAEADsD+JaQAA3AAAA==";

const createBaseRequest = (sourceDataUrl = dataUrl(1915, 821)): ImageEditCreateRequest => ({
  sourceImage: {
    id: "source-1",
    name: "source.png",
    mimeType: "image/png",
    dataUrl: sourceDataUrl,
    thumbnailDataUrl: dataUrl(320, 180),
    createdAt: "2026-06-25T00:00:00.000Z",
    sourcePointer: {
      kind: "uploaded_image",
      importedAt: "2026-06-25T00:00:00.000Z"
    }
  },
  annotationImage: {
    mimeType: "image/png",
    dataUrl: dataUrl(1915, 821),
    thumbnailDataUrl: dataUrl(320, 180),
    itemCount: 2,
    createdAt: "2026-06-25T00:00:00.000Z"
  },
  annotationItems: [
    {
      index: 1,
      label: "标注 1",
      tool: "box",
      note: "把右侧标题改成金色。",
      positionHint: "位于画面约 64% x 22%"
    },
    {
      index: 2,
      label: "标注 2",
      tool: "arrow",
      note: "去掉箭头指向的小红点。",
      positionHint: "位于画面约 22% x 58%"
    }
  ],
  instruction: "把右侧标题改成金色，但保留背景和人物。",
  settings: imageEditSettingsFromSource(sourceDataUrl, {
    apiMode: "responses",
    imageModel: "gpt-image-2",
    mainModel: "gpt-5.5",
    quality: "auto",
    outputFormat: "png",
    moderation: "auto",
    background: "auto",
    n: 1
  })
});

const createOriginRegenerationRequest = (
  withOriginalReference = true,
  sourceDataUrl = dataUrl(1915, 821)
): ImageEditCreateRequest => {
  const base = createBaseRequest(sourceDataUrl);
  const annotationItems: NonNullable<ImageEditCreateRequest["annotationItems"]> = [
    {
      index: 1,
      label: "标注 1",
      tool: "box",
      note: "只把右侧扩音器外壳改成青绿色。",
      positionHint: "框选左上角 85.1% x 1.2%，右下角 97.2% x 21.8%",
      geometry: {
        tool: "box",
        left: 0.851,
        top: 0.012,
        right: 0.972,
        bottom: 0.218,
        centerX: 0.9115,
        centerY: 0.115,
        width: 0.121,
        height: 0.206
      }
    }
  ];
  const regenerationContext = {
    basePrompt: "第一次生图的原始融合提示词。",
    generationTaskId: "generation-task-1",
    generationOutputId: "generation-output-1",
    sourceLabel: "最终融合提示词",
    importedAt: "2026-07-11T00:00:00.000Z",
    inputStrategy: withOriginalReference ? ("original_references" as const) : ("text_only" as const),
    originalReferences: withOriginalReference
      ? [
          {
            id: "origin-reference-1",
            name: "original-subject.png",
            mimeType: "image/png",
            dataUrl: dataUrl(64, 64),
            thumbnailDataUrl: dataUrl(32, 32),
            createdAt: "2026-07-11T00:00:00.000Z"
          }
        ]
      : []
  };
  const contentHash = imageEditAnnotationContentHash(
    sourceDataUrl,
    annotationItems,
    "保持主体身份和宏观构图。",
    regenerationContext.basePrompt
  );
  return {
    ...base,
    fidelityMode: "origin_regenerate",
    instruction: "保持主体身份和宏观构图。",
    annotationImage: { ...base.annotationImage, itemCount: 1 },
    annotationItems,
    annotationResolution: {
      contentHash,
      source: "vision_model",
      modelName: "vision-test",
      createdAt: "2026-07-11T00:00:00.000Z",
      confirmedAt: "2026-07-11T00:01:00.000Z",
      status: "confirmed",
      items: [
        {
          index: 1,
          targetObject: "右侧人物头顶上方的扩音器",
          currentState: "橙色外壳、白色喇叭口",
          requestedChange: "只将橙色外壳改为青绿色",
          preserve: ["保持大小、位置、角度和白色喇叭口", "不改变相邻人物脸部和手势"],
          spatialAnchors: ["位于右侧人物头顶上方"],
          confidence: 0.94,
          ambiguity: "",
          userConfirmed: true
        }
      ]
    },
    regenerationContext
  };
};

const createRequest = (sourceDataUrl = dataUrl(1915, 821)): ImageEditCreateRequest =>
  createOriginRegenerationRequest(true, sourceDataUrl);

const writeGenerationConfig = async (
  rootDir: string,
  provider: {
    providerType: "openai_compatible" | "openrouter";
    apiMode: "images" | "responses";
    apiBaseUrl: string;
    imageModel: string;
  }
) => {
  await mkdir(join(rootDir, "generation"), { recursive: true });
  await writeFile(
    join(rootDir, "generation", "config.json"),
    JSON.stringify({
      authSource: "api",
      activeProviderId: "provider-1",
      providers: [
        {
          id: "provider-1",
          name: provider.providerType === "openrouter" ? "OpenRouter" : "OpenAI-compatible",
          providerType: provider.providerType,
          apiBaseUrl: provider.apiBaseUrl,
          apiMode: provider.apiMode,
          imageModel: provider.imageModel,
          mainModel: "gpt-5.5",
          saveApiKey: true,
          apiKey: "test-key"
        }
      ]
    })
  );
};

const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> => {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for image edit state.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("image edit size helpers", () => {
  it("derives default edit resolution and nearest aspect ratio from source pixels", () => {
    expect(closestImageEditAspectRatio(1915, 821)).toBe("21:9");
    expect(imageEditResolutionForDimensions(1915, 821)).toBe("2k");
    expect(imageEditResolutionForDimensions(3840, 2160)).toBe("4k");
    const settings = imageEditSettingsFromSource(dataUrl(1915, 821), {
      apiMode: "responses",
      imageModel: "gpt-image-2",
      mainModel: "gpt-5.5",
      quality: "auto",
      outputFormat: "png",
      moderation: "auto",
      background: "auto",
      n: 1
    });
    expect(settings).toMatchObject({
      resolution: "2k",
      aspectRatio: "21:9",
      size: "2688x1152"
    });
  });

  it("forces origin regeneration Responses tools to generate", () => {
    const payload = forceOriginRegenerationResponsesAction({
      tools: [{ type: "image_generation", action: "edit", size: "864x1536" }]
    });
    expect(payload.tools).toEqual([{ type: "image_generation", action: "generate", size: "864x1536" }]);
  });
});

describe("ImageEditService task storage", () => {
  it("preserves canonical PNG, JPEG and WebP bytes while overriding renderer metadata from bytes", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-canonical-formats-"));
    try {
      const service = new ImageEditService(rootDir, {
        concurrency: 1,
        runner: async () => [{ dataUrl: dataUrl(64, 32), mimeType: "image/png", requestedSize: "1024x1024" }]
      });
      const fixtures = [
        { dataUrl: dataUrl(64, 32), mimeType: "image/png", width: 64, height: 32 },
        { dataUrl: jpeg1x1, mimeType: "image/jpeg", width: 1, height: 1 },
        { dataUrl: webp1x1, mimeType: "image/webp", width: 1, height: 1 }
      ] as const;

      for (const fixture of fixtures) {
        const request = createRequest(fixture.dataUrl);
        request.sourceImage = {
          ...request.sourceImage,
          mimeType: "image/gif",
          width: 999,
          height: 999
        };
        const task = await service.createTask(request);
        await waitFor(async () => (await service.getTasks()).some((item) => item.id === task.id && item.status === "succeeded"));
        const stored = (await service.getTasks()).find((item) => item.id === task.id);
        expect(stored?.sourceImage.mimeType).toBe(fixture.mimeType);
        expect(stored?.sourceImage.width).toBe(fixture.width);
        expect(stored?.sourceImage.height).toBe(fixture.height);
        expect(stored?.sourceIntegrity).toMatchObject({
          actualMimeType: fixture.mimeType,
          width: fixture.width,
          height: fixture.height,
          canonicalBytesPreserved: true
        });
        expect(Buffer.from(stored?.sourceImage.dataUrl.split(",")[1] || "", "base64")).toEqual(
          Buffer.from(fixture.dataUrl.split(",")[1], "base64")
        );
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("keeps a decodable transparent 4K source and rejects sources above 12 million pixels", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-canonical-4k-"));
    try {
      const service = new ImageEditService(rootDir, {
        concurrency: 1,
        runner: async () => [{ dataUrl: dataUrl(1024, 576), mimeType: "image/png", requestedSize: "3840x2160" }]
      });
      const fourKDataUrl = dataUrl(3840, 2160);
      const task = await service.createTask(createRequest(fourKDataUrl));
      await waitFor(async () => (await service.getTasks()).some((item) => item.id === task.id && item.status === "succeeded"));
      const stored = (await service.getTasks()).find((item) => item.id === task.id);
      expect(stored?.sourceIntegrity).toMatchObject({ width: 3840, height: 2160, pixelCount: 8_294_400 });
      expect(Buffer.from(stored?.sourceImage.dataUrl.split(",")[1] || "", "base64")).toEqual(pngBytes(3840, 2160));

      await expect(service.createTask(createRequest(dataUrl(4000, 3001)))).rejects.toThrow(/1200 万/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("uses the selected prior output bytes directly as the next canonical source", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-continue-lossless-"));
    try {
      const firstOutput = dataUrl(800, 600);
      const service = new ImageEditService(rootDir, {
        concurrency: 1,
        runner: async () => [{ dataUrl: firstOutput, mimeType: "image/png", requestedSize: "800x600" }]
      });
      const firstTask = await service.createTask(createRequest(dataUrl(640, 480)));
      await waitFor(async () => (await service.getTasks()).some((item) => item.id === firstTask.id && item.status === "succeeded"));
      const firstFinished = (await service.getTasks()).find((item) => item.id === firstTask.id);
      const nextRequest = createRequest(firstFinished?.outputs[0].dataUrl || "");
      nextRequest.sourceImage.sourcePointer = {
        kind: "restored_edit_output",
        imageEditTaskId: firstTask.id,
        imageEditOutputId: firstFinished?.outputs[0].id,
        importedAt: "2026-06-26T00:00:00.000Z"
      };
      const nextTask = await service.createTask(nextRequest);
      await waitFor(async () => (await service.getTasks()).some((item) => item.id === nextTask.id && item.status === "succeeded"));
      const nextFinished = (await service.getTasks()).find((item) => item.id === nextTask.id);
      expect(Buffer.from(nextFinished?.sourceImage.dataUrl.split(",")[1] || "", "base64")).toEqual(
        Buffer.from(firstOutput.split(",")[1], "base64")
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("stores large source and annotation images as assets while tasks.json keeps metadata", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-assets-"));
    try {
      const runner = vi.fn(async () => [
        {
          dataUrl: dataUrl(2688, 1152),
          mimeType: "image/png",
          requestedSize: "2688x1152",
          actualSize: "2688x1152",
          actualWidth: 2688,
          actualHeight: 1152
        }
      ]);
      const service = new ImageEditService(rootDir, { runner, concurrency: 1 });
      const task = await service.createTask(createRequest());
      expect(task.status).toBe("queued");

      await waitFor(async () => (await service.getTasks()).some((item) => item.id === task.id && item.status === "succeeded"));
      const [finished] = await service.getTasks();
      expect(finished.sourceImage.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(finished.annotationImage.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(finished.outputs[0].dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(finished.annotationItems).toHaveLength(1);
      expect(finished.finalPrompt).toContain("局部修订 1");

      const storedText = await readFile(join(rootDir, "image-edit", "tasks.json"), "utf8");
      expect(storedText).not.toContain(finished.sourceImage.dataUrl);
      expect(storedText).not.toContain(finished.annotationImage.dataUrl);
      expect(storedText).not.toContain(finished.outputs[0].dataUrl);
      expect(storedText).toContain("source.png");
      expect(storedText).toContain("annotation.png");
      expect(storedText).toContain("output-01.png");
      expect(storedText).toContain("只把右侧扩音器外壳改成青绿色。");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("stores multiple side-by-side reference candidates in one task", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-candidates-"));
    try {
      const runner = vi.fn(async (task) =>
        Array.from({ length: task.settings.n }, (_item, index) => ({
          dataUrl: dataUrl(1024 + index, 1024),
          mimeType: "image/png",
          requestedSize: "1024x1024",
          actualSize: `${1024 + index}x1024`,
          actualWidth: 1024 + index,
          actualHeight: 1024
        }))
      );
      const service = new ImageEditService(rootDir, { runner, concurrency: 1 });
      const request = createRequest(dataUrl(1024, 1024));
      request.settings.n = 3;

      const task = await service.createTask(request);
      await waitFor(async () => (await service.getTasks()).some((item) => item.id === task.id && item.status === "succeeded"));
      const [finished] = (await service.getTasks()).filter((item) => item.id === task.id);

      expect(finished.outputs).toHaveLength(3);
      expect(finished.error).toBeUndefined();
      expect(finished.outputs.map((output) => output.actualSize)).toEqual(["1024x1024", "1025x1024", "1026x1024"]);
      const storedText = await readFile(join(rootDir, "image-edit", "tasks.json"), "utf8");
      expect(storedText).toContain("output-01.png");
      expect(storedText).toContain("output-02.png");
      expect(storedText).toContain("output-03.png");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("cancels queued tasks and preserves independent clear boundaries", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-cancel-"));
    const pendingResponses: Array<() => void> = [];
    const runner = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          pendingResponses.push(() => reject(new Error("released")));
        })
    );
    try {
      const service = new ImageEditService(rootDir, { runner, concurrency: 1 });
      await mkdir(join(rootDir, "generation"), { recursive: true });
      await service.createTask(createRequest(dataUrl(1024, 1024)));
      const queued = await service.createTask(createRequest(dataUrl(1024, 1024)));
      await waitFor(() => runner.mock.calls.length === 1);
      const canceled = await service.cancelTask(queued.id);
      expect(canceled?.status).toBe("canceled");
      expect(runner).toHaveBeenCalledTimes(1);
      pendingResponses.shift()?.();
      await waitFor(async () => (await service.getTasks()).every((task) => task.status !== "queued" && task.status !== "running"));
      await service.clearTasks();
      expect((await stat(join(rootDir, "generation"))).isDirectory()).toBe(true);
      expect(await service.getTasks()).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("retries, restores and updates visibility without leaking source assets into task JSON", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-retry-"));
    try {
      const service = new ImageEditService(rootDir, {
        concurrency: 1,
        runner: async () => {
          throw new Error("model unavailable");
        }
      });
      const task = await service.createTask(createRequest(dataUrl(1024, 1024)));
      await waitFor(async () => (await service.getTasks()).some((item) => item.id === task.id && item.status === "failed"));
      const retried = await service.retryTask(task.id);
      expect(retried.id).not.toBe(task.id);
      expect(retried.sourceImage.sourcePointer).toMatchObject({
        kind: "restored_edit_output",
        imageEditTaskId: task.id
      });
      const restored = await service.restoreTask(task.id);
      expect(restored?.sourceImage.dataUrl).toMatch(/^data:image\/png;base64,/);
      await waitFor(async () => (await service.getTasks()).some((item) => item.id === retried.id && item.status === "failed"));
      const visibleTasks = await service.updateTaskVisibility({ id: task.id, visibility: "archived" });
      expect(visibleTasks.find((item) => item.id === task.id)?.visibility).toBe("archived");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("keeps removed-mode history readable but rejects legacy retries", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-legacy-readonly-"));
    try {
      const service = new ImageEditService(rootDir, {
        concurrency: 1,
        runner: async () => [{ dataUrl: dataUrl(864, 1536), mimeType: "image/png", requestedSize: "864x1536" }]
      });
      const task = await service.createTask(createRequest());
      await waitFor(async () =>
        (await service.getTasks()).some((item) => item.id === task.id && item.status === "succeeded")
      );
      const tasksPath = join(rootDir, "image-edit", "tasks.json");
      const stored = JSON.parse(await readFile(tasksPath, "utf8")) as Array<Record<string, unknown>>;
      stored[0].fidelityMode = "reference";
      await writeFile(tasksPath, JSON.stringify(stored, null, 2));

      const restarted = new ImageEditService(rootDir, { concurrency: 1 });
      const [legacyTask] = await restarted.getTasks();
      expect(legacyTask.fidelityMode).toBe("reference");
      expect(legacyTask.outputs[0].dataUrl).toMatch(/^data:image\/png;base64,/);
      await expect(restarted.retryTask(legacyTask.id)).rejects.toThrow("旧版改图任务仅保留历史结果");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("ImageEditService model routing", () => {
  it("stores origin references as separate assets and rejects stale or unconfirmed resolutions", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-origin-storage-"));
    try {
      const service = new ImageEditService(rootDir, {
        concurrency: 1,
        runner: async () => [{ dataUrl: dataUrl(864, 1536), mimeType: "image/png", requestedSize: "864x1536" }]
      });
      const request = createOriginRegenerationRequest();
      const task = await service.createTask(request);
      await waitFor(async () =>
        (await service.getTasks()).some((item) => item.id === task.id && item.status === "succeeded")
      );
      const storedJson = await readFile(join(rootDir, "image-edit", "tasks.json"), "utf8");
      expect(storedJson).not.toContain("data:image");
      expect(storedJson).not.toMatch(/api[_-]?key|access_token|refresh_token|id_token/i);
      const stored = JSON.parse(storedJson) as Array<{
        regenerationContext?: { originalReferences: Array<{ assetFileName: string }> };
      }>;
      const assetFileName = stored[0].regenerationContext?.originalReferences[0].assetFileName || "";
      expect(assetFileName).toMatch(/^origin-reference-01\./);
      expect((await stat(join(rootDir, "image-edit", "assets", task.id, assetFileName))).isFile()).toBe(true);
      const hydrated = (await service.getTasks()).find((item) => item.id === task.id);
      expect(hydrated?.regenerationContext?.originalReferences[0].dataUrl).toBe(dataUrl(64, 64));
      expect(hydrated?.diagnostics).toMatchObject({
        regenerationInputStrategy: "original_references",
        originReferenceCount: 1,
        currentSourceSubmitted: false,
        annotationImageSubmitted: false
      });
      const legacyStored = JSON.parse(storedJson) as Array<Record<string, any>>;
      legacyStored[0].sourceImage.thumbnailDataUrl = dataUrl(32, 32);
      legacyStored[0].annotationImage.thumbnailDataUrl = dataUrl(32, 32);
      await writeFile(join(rootDir, "image-edit", "tasks.json"), JSON.stringify(legacyStored, null, 2));
      const restartedService = new ImageEditService(rootDir, {
        concurrency: 1,
        runner: async () => [{ dataUrl: dataUrl(864, 1536), mimeType: "image/png", requestedSize: "864x1536" }]
      });
      const restartedTask = (await restartedService.getTasks()).find((item) => item.id === task.id);
      expect(restartedTask?.regenerationContext?.originalReferences[0].dataUrl).toBe(dataUrl(64, 64));
      expect(await readFile(join(rootDir, "image-edit", "tasks.json"), "utf8")).not.toContain("data:image");
      const retried = await restartedService.retryTask(task.id);
      await waitFor(async () =>
        (await restartedService.getTasks()).some((item) => item.id === retried.id && item.status === "succeeded")
      );
      expect(
        (await restartedService.getTasks()).find((item) => item.id === retried.id)?.regenerationContext
          ?.generationTaskId
      ).toBe("generation-task-1");

      await expect(
        service.createTask({
          ...request,
          annotationResolution: { ...request.annotationResolution!, status: "needs_review", confirmedAt: undefined }
        })
      ).rejects.toThrow(/尚未完成确认/);
      await expect(
        service.createTask({
          ...request,
          instruction: "已经变化的总体说明。"
        })
      ).rejects.toThrow(/已变化/);
      await restartedService.deleteTask(task.id);
      await restartedService.deleteTask(retried.id);
      await expect(stat(join(rootDir, "image-edit", "assets", task.id))).rejects.toThrow();
      await expect(stat(join(rootDir, "image-edit", "assets", retried.id))).rejects.toThrow();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("sends only original references for OpenAI-compatible origin regeneration", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-origin-openai-route-"));
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ b64_json: pngBytes(864, 1536).toString("base64") }] }), {
          status: 200
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await writeGenerationConfig(rootDir, {
        providerType: "openai_compatible",
        apiMode: "images",
        apiBaseUrl: "https://api.example.com/v1",
        imageModel: "gpt-image-2"
      });
      const service = new ImageEditService(rootDir, { concurrency: 1 });
      const task = await service.createTask(createOriginRegenerationRequest());
      await waitFor(async () =>
        (await service.getTasks()).some((item) => item.id === task.id && !["queued", "running"].includes(item.status))
      );
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.example.com/v1/images/edits");
      const form = init.body as FormData;
      expect(form.getAll("image")).toHaveLength(1);
      expect(form.getAll("mask")).toHaveLength(0);
      const image = form.get("image") as File;
      expect(image.size).toBe(pngBytes(64, 64).length);
      expect(String(form.get("prompt"))).toContain("第一次生图的原始融合提示词");
      expect(String(form.get("prompt"))).not.toMatch(/看标注图|按红框|修改这里/);
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("uses images/generations for text-only origin regeneration", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-origin-text-only-route-"));
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ b64_json: pngBytes(864, 1536).toString("base64") }] }), {
          status: 200
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await writeGenerationConfig(rootDir, {
        providerType: "openai_compatible",
        apiMode: "images",
        apiBaseUrl: "https://api.example.com/v1",
        imageModel: "gpt-image-2"
      });
      const service = new ImageEditService(rootDir, { concurrency: 1 });
      const task = await service.createTask(createOriginRegenerationRequest(false));
      await waitFor(async () =>
        (await service.getTasks()).some((item) => item.id === task.id && !["queued", "running"].includes(item.status))
      );
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.example.com/v1/images/generations");
      expect(init.body).toEqual(expect.any(String));
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(payload.prompt).toContain("第一次生图的原始融合提示词");
      expect(JSON.stringify(payload)).not.toContain("data:image");
      const finished = (await service.getTasks()).find((item) => item.id === task.id);
      expect(finished?.diagnostics?.regenerationInputStrategy).toBe("text_only");
      expect(finished?.diagnostics?.originReferenceCount).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("forces Responses origin regeneration to generate with only original references", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-origin-responses-route-"));
    const outputBase64 = pngBytes(864, 1536).toString("base64");
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          `data: ${JSON.stringify({
            type: "response.output_item.done",
            item: { type: "image_generation_call", result: outputBase64 }
          })}\ndata: [DONE]`,
          { status: 200 }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await writeGenerationConfig(rootDir, {
        providerType: "openai_compatible",
        apiMode: "responses",
        apiBaseUrl: "https://api.example.com/v1",
        imageModel: "gpt-image-2"
      });
      const service = new ImageEditService(rootDir, { concurrency: 1 });
      const task = await service.createTask(createOriginRegenerationRequest());
      await waitFor(async () =>
        (await service.getTasks()).some((item) => item.id === task.id && !["queued", "running"].includes(item.status))
      );
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.example.com/v1/responses");
      const payload = JSON.parse(String(init.body)) as {
        tools: Array<Record<string, unknown>>;
        input: Array<{ content: Array<Record<string, unknown>> }>;
      };
      expect(payload.tools[0]).toMatchObject({ action: "generate" });
      const inputImages = payload.input[0].content.filter((item) => item.type === "input_image");
      expect(inputImages).toHaveLength(1);
      expect(inputImages[0]).toMatchObject({ image_url: dataUrl(64, 64) });
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("routes OpenRouter origin regeneration with only original references and no edit inputs", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-origin-openrouter-route-"));
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ b64_json: pngBytes(864, 1536).toString("base64") }] }), {
          status: 200
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await writeGenerationConfig(rootDir, {
        providerType: "openrouter",
        apiMode: "images",
        apiBaseUrl: "https://openrouter.ai/api/v1",
        imageModel: "openai/gpt-image-2"
      });
      const service = new ImageEditService(rootDir, { concurrency: 1 });
      const task = await service.createTask(createOriginRegenerationRequest());
      await waitFor(async () =>
        (await service.getTasks()).some((item) => item.id === task.id && !["queued", "running"].includes(item.status))
      );
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://openrouter.ai/api/v1/images");
      const payload = JSON.parse(String(init.body)) as {
        input_references?: Array<{ image_url?: { url?: string } }>;
        [key: string]: unknown;
      };
      expect(payload.input_references).toEqual([{ type: "image_url", image_url: { url: dataUrl(64, 64) } }]);
      expect(JSON.stringify(payload)).not.toContain(dataUrl(1915, 821));
      expect(JSON.stringify(payload)).not.toMatch(/mask|input_fidelity/);
      const finished = (await service.getTasks()).find((item) => item.id === task.id);
      expect(finished?.fidelityMode).toBe("origin_regenerate");
      expect(finished?.outputs[0].protectedVariant).toBeUndefined();
      expect(finished?.outputs[0].compositeAudit).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

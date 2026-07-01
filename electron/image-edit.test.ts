import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ImageEditService,
  buildImageEditFinalPrompt,
  closestImageEditAspectRatio,
  imageEditMaskCapabilityForBackend,
  imageEditResolutionForDimensions,
  imageEditSettingsFromSource
} from "./image-edit";
import type { ImageEditCreateRequest } from "../src/shared/types";

const pngBytes = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  return buffer;
};

const dataUrl = (width: number, height: number): string =>
  `data:image/png;base64,${pngBytes(width, height).toString("base64")}`;

const createRequest = (sourceDataUrl = dataUrl(1915, 821)): ImageEditCreateRequest => ({
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

const createRequestWithLocalMask = (sourceDataUrl = dataUrl(1915, 821)): ImageEditCreateRequest => {
  const request = createRequest(sourceDataUrl);
  return {
    ...request,
    settings: {
      ...request.settings,
      size: "1915x821"
    },
    localProtectionMaskImage: {
      purpose: "local_protection",
      mimeType: "image/png",
      dataUrl: dataUrl(1915, 821),
      thumbnailDataUrl: dataUrl(320, 180),
      itemCount: 2,
      width: 1915,
      height: 821,
      createdAt: "2026-06-26T00:00:00.000Z",
      stats: {
        width: 1915,
        height: 821,
        itemCount: 2,
        transparentRatio: 0.08,
        bbox: "10,12,120x90",
        warnings: []
      }
    },
    pixelProtectionEnabled: true
  };
};

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

  it("builds a clean-edit final prompt with annotation removal constraints", () => {
    const prompt = buildImageEditFinalPrompt("删除左上角红框里的字", "1024x1024", createRequest().annotationItems);
    expect(prompt).toContain("标注 1（框选，位于画面约 64% x 22%）：把右侧标题改成金色。");
    expect(prompt).toContain("标注 2（箭头，位于画面约 22% x 58%）：去掉箭头指向的小红点。");
    expect(prompt).toContain("干净源图是主体、构图、纹理、文字和细节的唯一依据");
    expect(prompt).toContain("每个编号只对应下方同编号修改要求");
    expect(prompt).toContain("移除所有编号圆点、箭头、批注文字、框选线");
  });

  it("protects unmarked portrait skin from generated texture artifacts", () => {
    const prompt = buildImageEditFinalPrompt("在背景里增加金币元素", "3808x1632", createRequest().annotationItems);
    expect(prompt).toContain("未被编号标注覆盖的区域必须按干净源图保留");
    expect(prompt).toContain("人物脸部、五官、发际线、手臂、手部和所有裸露皮肤属于高保真保护区域");
    expect(prompt).toContain("不要新增斑驳暗纹、网格纹、水印感纹理");
    expect(prompt).toContain("不改变人物皮肤、脸部和肢体结构");
  });

  it("describes strict mask mode as source plus alpha mask instead of annotation image input", () => {
    const prompt = buildImageEditFinalPrompt("只修改标注区域", "1024x1024", createRequest().annotationItems, "strict_mask");
    expect(prompt).toContain("源图、alpha mask 和编号修改清单");
    expect(prompt).toContain("透明区域是允许编辑区，不透明区域必须按源图保留");
    expect(prompt).toContain("定位图只用于任务预览和下方文字清单，不作为模型图像输入");
  });
});

describe("image edit mask capability matrix", () => {
  it("only enables strict mask edits for OpenAI-compatible Images backends", () => {
    expect(
      imageEditMaskCapabilityForBackend({
        authSource: "api",
        providerType: "openai_compatible",
        apiMode: "images"
      })
    ).toMatchObject({ supportsMaskEdit: true });
    expect(
      imageEditMaskCapabilityForBackend({
        authSource: "api",
        providerType: "openai_compatible",
        apiMode: "responses"
      })
    ).toMatchObject({ supportsMaskEdit: false });
    expect(
      imageEditMaskCapabilityForBackend({
        authSource: "api",
        providerType: "openrouter",
        apiMode: "images"
      })
    ).toMatchObject({ supportsMaskEdit: false });
    expect(
      imageEditMaskCapabilityForBackend({
        authSource: "codex_oauth",
        providerType: "openai_compatible",
        apiMode: "responses"
      })
    ).toMatchObject({ supportsMaskEdit: false });
  });
});

describe("ImageEditService task storage", () => {
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
      expect(finished.annotationItems).toHaveLength(2);
      expect(finished.finalPrompt).toContain("标注 2（箭头");

      const storedText = await readFile(join(rootDir, "image-edit", "tasks.json"), "utf8");
      expect(storedText).not.toContain(finished.sourceImage.dataUrl);
      expect(storedText).not.toContain(finished.annotationImage.dataUrl);
      expect(storedText).not.toContain(finished.outputs[0].dataUrl);
      expect(storedText).toContain("source.png");
      expect(storedText).toContain("annotation.png");
      expect(storedText).toContain("output-01.png");
      expect(storedText).toContain("把右侧标题改成金色。");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("stores local protection masks and protected variants as assets", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-local-mask-assets-"));
    try {
      const runner = vi.fn(async () => [
        {
          dataUrl: dataUrl(1915, 821),
          mimeType: "image/png",
          requestedSize: "1915x821",
          actualSize: "1915x821",
          actualWidth: 1915,
          actualHeight: 821
        }
      ]);
      const service = new ImageEditService(rootDir, { runner, concurrency: 1 });
      const task = await service.createTask(createRequestWithLocalMask());
      await waitFor(async () => (await service.getTasks()).some((item) => item.id === task.id && item.status === "succeeded"));
      const [finished] = (await service.getTasks()).filter((item) => item.id === task.id);
      const updated = await service.saveProtectedVariant({
        taskId: finished.id,
        outputId: finished.outputs[0].id,
        dataUrl: dataUrl(1915, 821),
        mimeType: "image/png",
        width: 1915,
        height: 821,
        warnings: ["本地保护版是软件后处理结果，不是 AI 原始结果。"]
      });

      expect(updated.localProtectionMaskImage?.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(updated.localProtectionMaskImage?.purpose).toBe("local_protection");
      expect(updated.settings.size).toBe("1915x821");
      expect(updated.diagnostics?.requestedSize).toBe("1915x821");
      expect(updated.finalPrompt).toContain("1915x821");
      expect(updated.outputs).toHaveLength(1);
      expect(updated.outputs[0].protectedVariant?.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(updated.outputs[0].protectedVariant?.kind).toBe("pixel_protected");
      expect(updated.diagnostics?.localMaskSubmittedToBackend).toBe(false);
      expect(updated.diagnostics?.strictMaskSubmitted).toBe(false);
      expect(updated.diagnostics?.localMask?.transparentRatio).toBe(0.08);

      const storedText = await readFile(join(rootDir, "image-edit", "tasks.json"), "utf8");
      expect(storedText).toContain("local-protection-mask.png");
      expect(storedText).toContain("pixel-protected.png");
      expect(storedText).not.toContain(updated.sourceImage.dataUrl);
      expect(storedText).not.toContain(updated.localProtectionMaskImage?.dataUrl || "missing-local-mask");
      expect(storedText).not.toContain(updated.outputs[0].dataUrl);
      expect(storedText).not.toContain(updated.outputs[0].protectedVariant?.dataUrl || "missing-variant");
      expect(storedText).not.toContain("apiKey");
      expect(storedText).not.toContain("access_token");
      expect(storedText).not.toContain("refresh_token");
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
});

describe("ImageEditService model routing", () => {
  it("sends clean source and annotation images to OpenAI-compatible image edits", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-openai-route-"));
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ b64_json: pngBytes(2688, 1152).toString("base64") }]
          }),
          { status: 200 }
        )
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
      const task = await service.createTask(createRequest());
      await waitFor(async () => (await service.getTasks()).some((item) => item.id === task.id && item.status === "succeeded"));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.example.com/v1/images/edits");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      const form = init.body as FormData;
      expect(form.getAll("image")).toHaveLength(2);
      expect(form.get("model")).toBe("gpt-image-2");
      expect(String(form.get("prompt"))).toContain("最终输出必须是干净修订图");
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("sends strict mask edits as one PNG source image plus one PNG mask", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-strict-mask-route-"));
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ b64_json: pngBytes(2688, 1152).toString("base64") }]
          }),
          { status: 200 }
        )
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
      const request = createRequest();
      const task = await service.createTask({
        ...request,
        fidelityMode: "strict_mask",
        sourceImage: {
          ...request.sourceImage,
          mimeType: "image/png",
          dataUrl: dataUrl(1915, 821)
        },
        maskImage: {
          mimeType: "image/png",
          dataUrl: dataUrl(1915, 821),
          itemCount: 2,
          width: 1915,
          height: 821,
          createdAt: "2026-06-25T00:00:00.000Z"
        }
      });
      await waitFor(async () => (await service.getTasks()).some((item) => item.id === task.id && item.status === "succeeded"));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.example.com/v1/images/edits");
      const form = init.body as FormData;
      expect(form.getAll("image")).toHaveLength(1);
      expect(form.getAll("mask")).toHaveLength(1);
      expect(String(form.get("prompt"))).toContain("alpha mask");
      expect(String(form.get("prompt"))).toContain("定位图只用于任务预览");
      const [finished] = (await service.getTasks()).filter((item) => item.id === task.id);
      expect(finished.fidelityMode).toBe("strict_mask");
      expect(finished.maskImage?.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(finished.backend?.supportsMaskEdit).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects strict mask tasks on OpenRouter before sending a request", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-strict-mask-openrouter-"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await writeGenerationConfig(rootDir, {
        providerType: "openrouter",
        apiMode: "images",
        apiBaseUrl: "https://openrouter.ai/api/v1",
        imageModel: "openai/gpt-image-2"
      });
      const service = new ImageEditService(rootDir, { concurrency: 1 });
      const request = createRequest();
      await expect(
        service.createTask({
          ...request,
          fidelityMode: "strict_mask",
          maskImage: {
            mimeType: "image/png",
            dataUrl: dataUrl(1915, 821),
            itemCount: 2,
            width: 1915,
            height: 821,
            createdAt: "2026-06-25T00:00:00.000Z"
          }
        })
      ).rejects.toThrow(/OpenRouter .*不支持 alpha mask/);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("routes OpenRouter image edits through /images with fidelity warning", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "image-edit-openrouter-route-"));
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ b64_json: pngBytes(1915, 821).toString("base64") }]
          }),
          { status: 200 }
        )
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
      const task = await service.createTask(createRequestWithLocalMask());
      await waitFor(async () => (await service.getTasks()).some((item) => item.id === task.id && item.status === "succeeded"));
      const [finished] = (await service.getTasks()).filter((item) => item.id === task.id);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://openrouter.ai/api/v1/images");
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(payload.model).toBe("openai/gpt-image-2");
      expect(payload.size).toBe("1915x821");
      expect(payload.output_format).toBe("png");
      expect(payload.output_compression).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain("mask");
      expect(payload.input_references).toEqual([
        expect.objectContaining({ type: "image_url" }),
        expect.objectContaining({ type: "image_url" })
      ]);
      expect(finished.localProtectionMaskImage?.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(finished.diagnostics?.localMaskSubmittedToBackend).toBe(false);
      expect(finished.diagnostics?.strictMaskSubmitted).toBe(false);
      expect(finished.backend?.fidelityNote).toContain("不承诺严格源图保真");
      expect(finished.outputs[0].warnings?.join(" ")).toContain("不承诺严格源图保真");
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCodexResponsesPayload,
  buildImagesGenerationPayload,
  buildOpenRouterImagesPayload,
  buildResponsesPayload,
  generationEndpoint,
  GenerationService,
  normalizeGenerationBaseUrl,
  openRouterImagesEndpoint,
  parseImageDimensions,
  parseImagesResponse,
  parseOpenRouterImagesResponse,
  parseResponsesImageResponse
} from "./generation";
import { parseCodexAuthPayload } from "./codex-auth";
import {
  dataUrlToGenerationOutputBuffer,
  generationOutputExtension,
  generationOutputFileName,
  uniqueGenerationOutputPath
} from "./generation-save";
import { generationAspectRatioOptions, resolveGenerationSize } from "../src/shared/generation-size";
import type { GenerationRequestSettings, GenerationTask } from "../src/shared/types";

const settings: GenerationRequestSettings = {
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
  n: 2
};

const createGenerationRequest = (prompt: string) => ({
  prompt,
  promptSource: {
    kind: "universal" as const,
    label: "通用风格提示词",
    sourceImageDataUrl: "data:image/png;base64,c291cmNl",
    sourceThumbnailDataUrl: "data:image/png;base64,dGh1bWI=",
    sourceFileName: "source.png",
    importedAt: "2026-06-24T00:00:00.000Z"
  },
  referenceImages: [],
  settings: { ...settings, n: 1 }
});

const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> => {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for generation state.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

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

const jpegBytes = (width: number, height: number): Buffer =>
  Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9
  ]);

const webpBytes = (width: number, height: number): Buffer => {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer[20] = 0;
  buffer[21] = 0;
  buffer[22] = 0;
  buffer[23] = 0;
  buffer[24] = (width - 1) & 0xff;
  buffer[25] = ((width - 1) >> 8) & 0xff;
  buffer[26] = ((width - 1) >> 16) & 0xff;
  buffer[27] = (height - 1) & 0xff;
  buffer[28] = ((height - 1) >> 8) & 0xff;
  buffer[29] = ((height - 1) >> 16) & 0xff;
  return buffer;
};

const b64Image = (bytes: Buffer): string => bytes.toString("base64");

describe("generation endpoint helpers", () => {
  it("normalizes OpenAI-compatible image and responses endpoint URLs", () => {
    expect(normalizeGenerationBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(normalizeGenerationBaseUrl("https://api.example.com/v1/images/generations")).toBe(
      "https://api.example.com/v1"
    );
    expect(normalizeGenerationBaseUrl("https://api.example.com/v1/responses")).toBe(
      "https://api.example.com/v1"
    );
    expect(generationEndpoint("https://api.example.com/v1/", "images/edits")).toBe(
      "https://api.example.com/v1/images/edits"
    );
    expect(openRouterImagesEndpoint("https://openrouter.ai/api/v1/images")).toBe(
      "https://openrouter.ai/api/v1/images"
    );
  });
});

describe("generation request builders", () => {
  it("maps all supported 1K, 2K and 4K ratio presets into real request sizes", () => {
    expect(generationAspectRatioOptions.map((option) => option.value)).toEqual([
      "1:1",
      "4:5",
      "5:4",
      "3:4",
      "4:3",
      "2:3",
      "3:2",
      "9:16",
      "16:9",
      "9:21",
      "21:9"
    ]);
    expect(resolveGenerationSize("1k", "4:5")).toBe("1024x1280");
    expect(resolveGenerationSize("2k", "9:21")).toBe("1152x2688");
    expect(resolveGenerationSize("4k", "16:9")).toBe("3840x2160");
    expect(resolveGenerationSize("4k", "21:9")).toBe("3808x1632");
  });

  it("builds Images API generation payloads without undefined compression for png", () => {
    const payload = buildImagesGenerationPayload("生成一张产品图", {
      ...settings,
      resolution: "4k",
      aspectRatio: "16:9",
      size: "3840x2160"
    });
    expect(payload).toMatchObject({
      model: "gpt-image-2",
      prompt: "生成一张产品图",
      n: 2,
      size: "3840x2160",
      quality: "auto",
      output_format: "png",
      moderation: "auto"
    });
    expect(payload.output_compression).toBeUndefined();
  });

  it("builds Responses API image_generation tool payloads with input images", () => {
    const payload = buildResponsesPayload("改造这张图片", { ...settings, apiMode: "responses" }, [
      "data:image/png;base64,abc"
    ]);
    expect(payload).toMatchObject({
      stream: true,
      model: "gpt-5.5",
      store: false,
      tool_choice: { type: "image_generation" }
    });
    expect((payload.tools as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: "image_generation",
      action: "edit",
      model: "gpt-image-2",
      size: "1024x1024",
      output_format: "png",
      partial_images: 0
    });
    expect(
      (((payload.input as Array<Record<string, unknown>>)[0].content as Array<Record<string, string>>)[1])
    ).toEqual({ type: "input_image", image_url: "data:image/png;base64,abc" });
  });

  it("builds Codex OAuth responses payloads with internal backend fields", () => {
    const payload = buildCodexResponsesPayload(
      "生成海报",
      { ...settings, resolution: "4k", aspectRatio: "16:9", size: "3840x2160" },
      []
    );
    expect(payload).toMatchObject({
      instructions: "",
      stream: true,
      reasoning: { effort: "high", summary: "auto" },
      parallel_tool_calls: true,
      include: ["reasoning.encrypted_content"],
      model: "gpt-5.5",
      store: false
    });
    expect((payload.tools as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: "image_generation",
      action: "generate",
      model: "gpt-image-2",
      size: "3840x2160",
      partial_images: 0
    });
  });

  it("uses reference-generation semantics for non-default Responses sizes with input images", () => {
    const payload = buildResponsesPayload(
      "参考主体但输出横版海报",
      { ...settings, apiMode: "responses", resolution: "4k", aspectRatio: "16:9", size: "3840x2160" },
      [`data:image/png;base64,${b64Image(pngBytes(1086, 1448))}`]
    );
    expect((payload.tools as Array<Record<string, unknown>>)[0]).toMatchObject({
      type: "image_generation",
      action: "generate",
      size: "3840x2160"
    });
  });

  it("builds OpenRouter Images API payloads with exact size by default", () => {
    const payload = buildOpenRouterImagesPayload(
      "生成一张产品图",
      { ...settings, imageModel: "openai/gpt-image-2", quality: "high", outputCompression: 100 },
      []
    );
    expect(payload).toMatchObject({
      model: "openai/gpt-image-2",
      prompt: "生成一张产品图",
      n: 2,
      size: "1024x1024",
      quality: "high",
      background: "auto",
      output_format: "png"
    });
    expect(payload.output_compression).toBeUndefined();
    expect(payload.aspect_ratio).toBeUndefined();
    expect(payload.resolution).toBeUndefined();
  });

  it("only sends OpenRouter output compression for jpeg or webp", () => {
    const jpegPayload = buildOpenRouterImagesPayload(
      "生成一张产品图",
      { ...settings, imageModel: "openai/gpt-image-2", outputFormat: "jpeg", outputCompression: 76 },
      []
    );
    expect(jpegPayload).toMatchObject({
      output_format: "jpeg",
      output_compression: 76
    });
  });

  it("builds normalized OpenRouter fallback payloads with reference images", () => {
    const imageUrl = "data:image/png;base64,abc";
    const payload = buildOpenRouterImagesPayload(
      "按参考图生成",
      { ...settings, imageModel: "openai/gpt-image-2", resolution: "4k", aspectRatio: "16:9", size: "3840x2160" },
      [imageUrl],
      new Set(["resolution", "aspect_ratio"]),
      "openrouter_normalized"
    );
    expect(payload).toMatchObject({
      model: "openai/gpt-image-2",
      resolution: "4K",
      aspect_ratio: "16:9",
      input_references: [
        {
          type: "image_url",
          image_url: { url: imageUrl }
        }
      ]
    });
    expect(payload.size).toBeUndefined();
  });

  it("builds aspect-ratio-only OpenRouter fallback payloads", () => {
    const payload = buildOpenRouterImagesPayload(
      "生成 2K 方图",
      { ...settings, imageModel: "openai/gpt-image-2", resolution: "2k", aspectRatio: "1:1", size: "2048x2048" },
      [],
      new Set(["size"]),
      "openrouter_aspect_ratio"
    );
    expect(payload).toMatchObject({
      model: "openai/gpt-image-2",
      aspect_ratio: "1:1"
    });
    expect(payload.size).toBeUndefined();
    expect(payload.resolution).toBeUndefined();
  });
});

describe("codex oauth auth parsing", () => {
  it("parses Codex auth.json tokens without exposing token values in public config", () => {
    const claims = {
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_test"
      }
    };
    const jwt = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
    const state = parseCodexAuthPayload(
      {
        tokens: {
          access_token: jwt,
          refresh_token: "refresh-token"
        },
        last_refresh: "2026-06-14T00:00:00.000Z"
      },
      "/tmp/auth.json"
    );
    expect(state.path).toBe("/tmp/auth.json");
    expect(state.accessToken).toBe(jwt);
    expect(state.refreshToken).toBe("refresh-token");
    expect(state.accountId).toBe("acct_test");
    expect(state.lastRefresh).toBe("2026-06-14T00:00:00.000Z");
  });
});

describe("generation config defaults", () => {
  it("removes the complete generation data domain during privacy cleanup", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-clear-all-"));
    try {
      const service = new GenerationService(rootDir);
      await service.saveConfig({
        authSource: "api",
        providerType: "openai_compatible",
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "runtime-only-key",
        apiMode: "images",
        imageModel: "gpt-image-2",
        mainModel: "gpt-5.5",
        saveApiKey: false,
        imagesConcurrency: 1
      });
      await mkdir(join(rootDir, "generation", "assets"), { recursive: true });
      await writeFile(join(rootDir, "generation", "assets", "private-image.png"), "private-image");

      await service.clearAll("win32");

      await expect(readFile(join(rootDir, "generation", "config.json"), "utf8")).rejects.toThrow();
      await expect(readFile(join(rootDir, "generation", "assets", "private-image.png"), "utf8")).rejects.toThrow();
      await expect(service.getConfig()).resolves.toMatchObject({ hasApiKey: false });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("does not let an aborted Windows generation recreate cleared task data", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-clear-running-"));
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("Expected an abort signal."));
          return;
        }
        signal.addEventListener(
          "abort",
          () => reject(signal.reason instanceof Error ? signal.reason : new Error("Request aborted.")),
          { once: true }
        );
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const service = new GenerationService(rootDir);
      await service.saveConfig({
        authSource: "api",
        providerType: "openai_compatible",
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "runtime-only-key",
        apiMode: "images",
        imageModel: "gpt-image-2",
        mainModel: "gpt-5.5",
        saveApiKey: false,
        imagesConcurrency: 1
      });
      await service.createTask(createGenerationRequest("Windows 在途清理测试"));
      await waitFor(() => fetchMock.mock.calls.length === 1);

      await service.clearAll("win32");
      await new Promise((resolve) => setTimeout(resolve, 25));

      await expect(service.getTasks()).resolves.toEqual([]);
      await expect(readFile(join(rootDir, "generation", "tasks.json"), "utf8")).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("migrates the legacy default main model to gpt-5.5", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-config-"));
    try {
      await mkdir(join(rootDir, "generation"), { recursive: true });
      await writeFile(
        join(rootDir, "generation", "config.json"),
        JSON.stringify({ authSource: "codex_oauth", mainModel: "gpt-5.4-mini" })
      );
      const service = new GenerationService(rootDir);
      await expect(service.getConfig()).resolves.toMatchObject({
        authSource: "codex_oauth",
        mainModel: "gpt-5.5"
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("reads old generation configs with openai-compatible provider defaults", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-legacy-provider-type-"));
    try {
      await mkdir(join(rootDir, "generation"), { recursive: true });
      await writeFile(
        join(rootDir, "generation", "config.json"),
        JSON.stringify({
          authSource: "api",
          apiBaseUrl: "https://api.example.com/v1",
          apiMode: "responses",
          imageModel: "gpt-image-2",
          mainModel: "gpt-5.5"
        })
      );
      const service = new GenerationService(rootDir);
      await expect(service.getConfig()).resolves.toMatchObject({
        providerType: "openai_compatible",
        apiBaseUrl: "https://api.example.com/v1",
        apiMode: "responses",
        providers: [expect.objectContaining({ providerType: "openai_compatible" })]
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("keeps provider API keys in the main process and exposes only hasApiKey", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-providers-"));
    try {
      const service = new GenerationService(rootDir);
      let config = await service.saveProvider({
        name: "测试供应商",
        providerType: "openai_compatible",
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "secret-provider-key",
        apiMode: "responses",
        imageModel: "gpt-image-2",
        mainModel: "gpt-5.5",
        saveApiKey: false
      });
      expect(config.authSource).toBe("api");
      expect(config.providers).toHaveLength(2);
      expect(config.providers[1]).toMatchObject({
        name: "测试供应商",
        hasApiKey: true,
        apiMode: "responses"
      });
      expect("apiKey" in config.providers[1]).toBe(false);

      const copied = await service.duplicateProvider(config.activeProviderId);
      expect(copied.providers).toHaveLength(3);
      expect(copied.providers.find((provider) => provider.id === copied.activeProviderId)?.hasApiKey).toBe(true);

      const reordered = await service.reorderProviders(copied.providers.map((provider) => provider.id).reverse());
      expect(reordered.providers[0].id).toBe(copied.providers[copied.providers.length - 1].id);

      config = await service.deleteProvider(reordered.activeProviderId);
      expect(config.providers).toHaveLength(2);

      const storedText = await readFile(join(rootDir, "generation", "config.json"), "utf8");
      expect(storedText).not.toContain("secret-provider-key");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("saves OpenRouter providers with Images mode and OpenRouter defaults", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-openrouter-provider-"));
    try {
      const service = new GenerationService(rootDir);
      const config = await service.saveProvider({
        name: "OpenRouter",
        providerType: "openrouter",
        apiBaseUrl: "",
        apiKey: "openrouter-key",
        apiMode: "responses",
        imageModel: "",
        mainModel: "gpt-5.5",
        saveApiKey: false
      });
      const activeProvider = config.providers.find((provider) => provider.id === config.activeProviderId);
      expect(config).toMatchObject({
        authSource: "api",
        providerType: "openrouter",
        apiBaseUrl: "https://openrouter.ai/api/v1",
        apiMode: "images",
        imageModel: "openai/gpt-image-2",
        hasApiKey: true
      });
      expect(activeProvider).toMatchObject({
        providerType: "openrouter",
        apiMode: "images",
        imageModel: "openai/gpt-image-2",
        hasApiKey: true
      });
      expect("apiKey" in activeProvider!).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("generation task queue", () => {
  it("enqueues tasks immediately and only runs up to the configured concurrency", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-queue-"));
    const pendingResponses: Array<() => void> = [];
    const responseBody = JSON.stringify({
      data: [{ b64_json: b64Image(pngBytes(1024, 1024)) }]
    });
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(() => resolve(new Response(responseBody, { status: 200 })));
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const service = new GenerationService(rootDir);
      await service.saveConfig({
        authSource: "api",
        providerType: "openai_compatible",
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        apiMode: "images",
        imageModel: "gpt-image-2",
        mainModel: "gpt-5.5",
        saveApiKey: false,
        imagesConcurrency: 1
      });

      const first = await service.createTask(createGenerationRequest("第一张"));
      const second = await service.createTask(createGenerationRequest("第二张"));
      expect(first.status).toBe("queued");
      expect(second.status).toBe("queued");

      await waitFor(() => fetchMock.mock.calls.length === 1);
      let tasks = await service.getTasks();
      expect(tasks.filter((task) => task.status === "running")).toHaveLength(1);
      expect(tasks.find((task) => task.id === second.id)?.status).toBe("queued");

      pendingResponses.shift()?.();
      await waitFor(() => fetchMock.mock.calls.length === 2);
      tasks = await service.getTasks();
      expect(tasks.find((task) => task.id === first.id)?.status).toBe("succeeded");
      expect(tasks.find((task) => task.id === second.id)?.status).toBe("running");

      pendingResponses.shift()?.();
      await waitFor(async () => (await service.getTasks()).every((task) => task.status === "succeeded"));
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("cancels queued tasks without starting a request", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-cancel-"));
    const pendingResponses: Array<() => void> = [];
    const responseBody = JSON.stringify({
      data: [{ b64_json: b64Image(pngBytes(1024, 1024)) }]
    });
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(() => resolve(new Response(responseBody, { status: 200 })));
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const service = new GenerationService(rootDir);
      await service.saveConfig({
        authSource: "api",
        providerType: "openai_compatible",
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        apiMode: "images",
        imageModel: "gpt-image-2",
        mainModel: "gpt-5.5",
        saveApiKey: false,
        imagesConcurrency: 1
      });

      await service.createTask(createGenerationRequest("运行任务"));
      const queued = await service.createTask(createGenerationRequest("排队任务"));
      await waitFor(() => fetchMock.mock.calls.length === 1);

      await service.cancelTask(queued.id);
      pendingResponses.shift()?.();
      await waitFor(async () => {
        const tasks = await service.getTasks();
        return tasks.some((task) => task.id === queued.id && task.status === "canceled");
      });
      await waitFor(async () => {
        const tasks = await service.getTasks();
        return tasks.every((task) => task.status !== "queued" && task.status !== "running");
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("marks returned images with mismatched real dimensions as partial failures after one retry", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-size-mismatch-"));
    const responseBody = JSON.stringify({
      data: [{ b64_json: b64Image(pngBytes(1086, 1448)) }]
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(responseBody, { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const service = new GenerationService(rootDir);
      await service.saveConfig({
        authSource: "api",
        providerType: "openai_compatible",
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        apiMode: "images",
        imageModel: "gpt-image-2",
        mainModel: "gpt-5.5",
        saveApiKey: false,
        imagesConcurrency: 1
      });

      const task = await service.createTask({
        ...createGenerationRequest("横版 4K 海报"),
        settings: { ...settings, resolution: "4k", aspectRatio: "16:9", size: "3840x2160", n: 1 }
      });

      await waitFor(async () => {
        const tasks = await service.getTasks();
        return tasks.some((item) => item.id === task.id && item.status === "partial_failed");
      });
      const [finished] = (await service.getTasks()).filter((item) => item.id === task.id);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(finished).toMatchObject({
        status: "partial_failed",
        error: expect.stringContaining("1086x1448")
      });
      expect(finished.outputs[0]).toMatchObject({
        requestedSize: "3840x2160",
        actualSize: "1086x1448",
        sizeMismatch: true,
        error: expect.stringContaining("3840x2160")
      });
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("runs OpenRouter providers through the dedicated images endpoint", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-openrouter-task-"));
    const responseBody = JSON.stringify({
      data: [{ b64_json: b64Image(pngBytes(1024, 1024)), imageUrl: "https://cdn.example.com/ignored.png" }]
    });
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (init?.method === "GET" && requestUrl.endsWith("/images/models/openai/gpt-image-2/endpoints")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              endpoints: [
                {
                  supported_parameters: {
                    resolution: { type: "enum", values: ["1K", "2K", "4K"] },
                    aspect_ratio: { type: "enum", values: ["1:1", "16:9"] }
                  }
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response(responseBody, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const service = new GenerationService(rootDir);
      await service.saveConfig({
        authSource: "api",
        providerType: "openrouter",
        apiBaseUrl: "https://openrouter.ai/api/v1",
        apiKey: "openrouter-key",
        apiMode: "responses",
        imageModel: "openai/gpt-image-2",
        mainModel: "gpt-5.5",
        saveApiKey: false,
        imagesConcurrency: 1
      });

      const task = await service.createTask({
        ...createGenerationRequest("OpenRouter 生图"),
        referenceImages: [
          {
            id: "ref-1",
            name: "ref.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,cmVm",
            thumbnailDataUrl: "data:image/png;base64,cmVm",
            createdAt: "2026-06-25T00:00:00.000Z"
          }
        ],
        settings: { ...settings, apiMode: "responses", imageModel: "openai/gpt-image-2", n: 1 }
      });

      await waitFor(async () => {
        const tasks = await service.getTasks();
        return tasks.some((item) => item.id === task.id && item.status === "succeeded");
      });

      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(String(postCall?.[0])).toBe("https://openrouter.ai/api/v1/images");
      const payload = JSON.parse(String(postCall?.[1]?.body)) as Record<string, unknown>;
      expect(payload).toMatchObject({
        model: "openai/gpt-image-2",
        size: "1024x1024",
        input_references: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,cmVm" }
          }
        ]
      });
      expect(payload.resolution).toBeUndefined();
      expect(payload.aspect_ratio).toBeUndefined();
      const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(calledUrls.some((url) => url.endsWith("/images/generations"))).toBe(false);
      expect(calledUrls.some((url) => url.endsWith("/images/edits"))).toBe(false);
      expect(calledUrls.some((url) => url.endsWith("/responses"))).toBe(false);
      const [finished] = (await service.getTasks()).filter((item) => item.id === task.id);
      expect(finished.backend).toMatchObject({
        authSource: "api",
        providerType: "openrouter",
        apiMode: "images",
        imageModel: "openai/gpt-image-2"
      });
      expect(finished.outputs[0].requestSizeStrategy).toBe("exact_size");
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("falls back to OpenRouter resolution and aspect ratio when exact size is rejected", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-openrouter-size-fallback-"));
    const responseBody = JSON.stringify({
      data: [{ b64_json: b64Image(pngBytes(1024, 1024)) }]
    });
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (init?.method === "GET" && requestUrl.endsWith("/images/models/openai/gpt-image-2/endpoints")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              endpoints: [
                {
                  supported_parameters: {
                    resolution: { type: "enum", values: ["1K", "2K", "4K"] },
                    aspect_ratio: { type: "enum", values: ["1:1", "16:9"] }
                  }
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      if (body.size) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: "size is not supported by this endpoint" } }), {
            status: 400
          })
        );
      }
      return Promise.resolve(new Response(responseBody, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const service = new GenerationService(rootDir);
      await service.saveConfig({
        authSource: "api",
        providerType: "openrouter",
        apiBaseUrl: "https://openrouter.ai/api/v1",
        apiKey: "openrouter-key",
        apiMode: "images",
        imageModel: "openai/gpt-image-2",
        mainModel: "gpt-5.5",
        saveApiKey: false,
        imagesConcurrency: 1
      });

      const task = await service.createTask({
        ...createGenerationRequest("OpenRouter 降级生图"),
        settings: { ...settings, imageModel: "openai/gpt-image-2", n: 1 }
      });

      await waitFor(async () => {
        const tasks = await service.getTasks();
        return tasks.some((item) => item.id === task.id && item.status === "succeeded");
      });

      const postBodies = fetchMock.mock.calls
        .filter(([, init]) => init?.method === "POST")
        .map(([, init]) => JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
      expect(postBodies).toHaveLength(2);
      expect(postBodies[0]).toMatchObject({ size: "1024x1024" });
      expect(postBodies[1]).toMatchObject({ resolution: "1K", aspect_ratio: "1:1" });
      expect(postBodies[1].size).toBeUndefined();
      const [finished] = (await service.getTasks()).filter((item) => item.id === task.id);
      expect(finished.outputs[0].requestSizeStrategy).toBe("openrouter_normalized");
    } finally {
      vi.unstubAllGlobals();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("generation task visibility", () => {
  const storedTask = (status: GenerationTask["status"] = "succeeded"): GenerationTask => ({
    id: "task-visibility",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    completedAt: status === "succeeded" ? "2026-06-24T00:01:00.000Z" : undefined,
    status,
    prompt: "一张安静的产品图",
    finalPrompt: "一张安静的产品图",
    promptSource: createGenerationRequest("来源").promptSource,
    referenceImages: [],
    settings,
    outputs: []
  });

  it("archives, hides and restores tasks inside the generation task domain", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-visibility-"));
    try {
      await mkdir(join(rootDir, "generation"), { recursive: true });
      await writeFile(join(rootDir, "generation", "tasks.json"), JSON.stringify([storedTask()]));
      const service = new GenerationService(rootDir);

      let tasks = await service.updateTaskVisibility({ id: "task-visibility", visibility: "archived" });
      expect(tasks[0]).toMatchObject({ visibility: "archived" });
      expect(tasks[0].archivedAt).toBeTruthy();

      tasks = await service.updateTaskVisibility({ id: "task-visibility", visibility: "hidden" });
      expect(tasks[0]).toMatchObject({ visibility: "hidden" });
      expect(tasks[0].hiddenAt).toBeTruthy();

      tasks = await service.updateTaskVisibility({ id: "task-visibility", visibility: "active" });
      expect(tasks[0].visibility).toBe("active");
      expect(tasks[0].archivedAt).toBeUndefined();
      expect(tasks[0].hiddenAt).toBeUndefined();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("does not archive or hide active queued/running tasks", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-active-visibility-"));
    try {
      await mkdir(join(rootDir, "generation"), { recursive: true });
      await writeFile(join(rootDir, "generation", "tasks.json"), JSON.stringify([storedTask("running")]));
      const service = new GenerationService(rootDir);

      await expect(service.updateTaskVisibility({ id: "task-visibility", visibility: "hidden" })).rejects.toThrow(
        "排队中或生成中的任务需要先完成或取消后，才能归档或隐藏。"
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("generation response parsers", () => {
  it("reads real pixel dimensions from PNG, JPEG and WebP bytes", () => {
    expect(parseImageDimensions(pngBytes(3840, 2160))).toMatchObject({ width: 3840, height: 2160, size: "3840x2160" });
    expect(parseImageDimensions(jpegBytes(1086, 1448))).toMatchObject({ width: 1086, height: 1448, size: "1086x1448" });
    expect(parseImageDimensions(webpBytes(2048, 1152))).toMatchObject({ width: 2048, height: 1152, size: "2048x1152" });
  });

  it("parses Images API b64_json responses into data URLs", async () => {
    const response = JSON.stringify({
      data: [{ b64_json: b64Image(pngBytes(1024, 1024)), revised_prompt: "更完整的提示词" }],
      usage: { total_tokens: 12 }
    });
    await expect(parseImagesResponse(response, "test-key", settings)).resolves.toMatchObject([
      {
        dataUrl: `data:image/png;base64,${b64Image(pngBytes(1024, 1024))}`,
        mimeType: "image/png",
        revisedPrompt: "更完整的提示词",
        requestedSize: "1024x1024",
        actualSize: "1024x1024",
        sizeMismatch: false,
        usage: { total_tokens: 12 }
      }
    ]);
  });

  it("parses OpenRouter Images API b64_json and imageUrl responses", async () => {
    const b64 = b64Image(pngBytes(1024, 1024));
    const response = JSON.stringify({
      data: [
        { b64_json: b64, output_format: "png" },
        { imageUrl: `data:image/png;base64,${b64}` }
      ],
      usage: { total_tokens: 20 }
    });
    await expect(parseOpenRouterImagesResponse(response, "openrouter-key", settings)).resolves.toMatchObject([
      {
        dataUrl: `data:image/png;base64,${b64}`,
        mimeType: "image/png",
        requestedSize: "1024x1024",
        actualSize: "1024x1024",
        usage: { total_tokens: 20 }
      },
      {
        dataUrl: `data:image/png;base64,${b64}`,
        mimeType: "image/png",
        requestedSize: "1024x1024",
        actualSize: "1024x1024"
      }
    ]);
  });

  it("parses Responses API SSE image generation calls", () => {
    const b64 = b64Image(pngBytes(1024, 1024));
    const response = [
      `data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "image_generation_call", result: b64 } })}`,
      "data: [DONE]"
    ].join("\n");
    expect(parseResponsesImageResponse(response, settings)).toMatchObject([
      {
        dataUrl: `data:image/png;base64,${b64}`,
        mimeType: "image/png",
        actualSize: "1024x1024"
      }
    ]);
  });

  it("does not treat Responses partial images as final outputs", () => {
    const partialB64 = b64Image(pngBytes(256, 256));
    const finalB64 = b64Image(pngBytes(1024, 1024));
    const response = [
      `data: ${JSON.stringify({
        type: "response.image_generation_call.partial_image",
        item: { type: "image_generation_call", status: "in_progress", result: partialB64 }
      })}`,
      `data: ${JSON.stringify({
        type: "response.output_item.done",
        item: { type: "image_generation_call", status: "completed", result: finalB64 }
      })}`,
      "data: [DONE]"
    ].join("\n");
    expect(parseResponsesImageResponse(response, settings)).toMatchObject([
      {
        dataUrl: `data:image/png;base64,${finalB64}`,
        actualSize: "1024x1024"
      }
    ]);
  });
});

describe("generation output save helpers", () => {
  it("decodes base64 image data URLs for saving", () => {
    const { mimeType, buffer } = dataUrlToGenerationOutputBuffer(
      `data:image/webp;base64,${Buffer.from("saved-image").toString("base64")}`
    );
    expect(mimeType).toBe("image/webp");
    expect(buffer.toString()).toBe("saved-image");
  });

  it("maps output mime types to safe file names", () => {
    expect(generationOutputExtension("image/jpeg")).toBe("jpg");
    expect(generationOutputExtension("image/webp")).toBe("webp");
    expect(generationOutputExtension("image/png")).toBe("png");
    expect(generationOutputFileName("../bad:name?.jpeg", "image/jpeg")).toBe("bad-name-.jpg");
  });

  it("deduplicates generated image paths without overwriting existing files", () => {
    const directoryPath = join(tmpdir(), "generation-output-test");
    const existing = new Set([
      join(directoryPath, "generated.png"),
      join(directoryPath, "generated (2).png")
    ]);
    expect(uniqueGenerationOutputPath(directoryPath, "generated.png", (path) => existing.has(path))).toBe(
      join(directoryPath, "generated (3).png")
    );
  });
});

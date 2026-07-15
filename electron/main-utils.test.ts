import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ModelHttpError,
  chatCompletionsEndpoint,
  completionTextFromResponse,
  extractJsonText,
  modelRequestTimeoutMessage,
  modelRequestTimeoutMs,
  normalizeHistory,
  readJsonFile,
  shouldCacheImageEditAnnotationResolution,
  shouldRetryWithoutResponseFormat,
  writeJsonFile
} from "./main-utils";

describe("main process model utilities", () => {
  it("builds chat completions endpoints from common base URLs", () => {
    expect(chatCompletionsEndpoint("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1/chat/completions"
    );
    expect(chatCompletionsEndpoint("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1/chat/completions"
    );
    expect(chatCompletionsEndpoint("https://api.example.com")).toBe(
      "https://api.example.com/chat/completions"
    );
  });

  it("extracts JSON from fenced, explained, and pure responses", () => {
    expect(extractJsonText("```json\n{\"ok\":true}\n```")).toBe("{\"ok\":true}");
    expect(extractJsonText("说明文字 {\"ok\":true} 结束")).toBe("{\"ok\":true}");
    expect(extractJsonText("{\"ok\":true}")).toBe("{\"ok\":true}");
  });

  it("reads text content from chat completion responses", () => {
    expect(
      completionTextFromResponse(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }))
    ).toBe("{\"ok\":true}");
    expect(
      completionTextFromResponse(
        JSON.stringify({ choices: [{ message: { content: [{ text: "第一段" }, { text: "第二段" }] } }] })
      )
    ).toBe("第一段\n第二段");
    expect(() => completionTextFromResponse(JSON.stringify({ choices: [] }))).toThrow(
      "模型返回中没有可解析的文本内容"
    );
  });

  it("falls back without response_format for 4xx response-format attempts", () => {
    expect(shouldRetryWithoutResponseFormat(new ModelHttpError(400, "bad request"), true)).toBe(true);
    expect(shouldRetryWithoutResponseFormat(new ModelHttpError(500, "server error"), true)).toBe(false);
    expect(shouldRetryWithoutResponseFormat(new Error("response_format is unsupported"), true)).toBe(true);
    expect(shouldRetryWithoutResponseFormat(new ModelHttpError(400, "bad request"), false)).toBe(false);
  });

  it("uses a shorter bounded timeout for interactive annotation parsing", () => {
    expect(modelRequestTimeoutMs("annotation")).toBe(120_000);
    expect(modelRequestTimeoutMs("analyze")).toBe(300_000);
    expect(modelRequestTimeoutMessage("annotation")).toContain("标注解析请求超过 120 秒");
  });

  it("does not cache manual annotation fallbacks", () => {
    expect(
      shouldCacheImageEditAnnotationResolution({
        resolution: {
          contentHash: "manual",
          status: "needs_review",
          source: "manual_fallback",
          createdAt: "2026-07-15T00:00:00.000Z",
          items: []
        }
      })
    ).toBe(false);
    expect(
      shouldCacheImageEditAnnotationResolution({
        resolution: {
          contentHash: "vision",
          status: "needs_review",
          source: "vision_model",
          createdAt: "2026-07-15T00:00:00.000Z",
          items: []
        }
      })
    ).toBe(true);
  });
});

describe("main process history and JSON file utilities", () => {
  it("keeps legacy history entries that fail strict Chinese prompt checks", () => {
    const history = normalizeHistory([
      {
        id: "legacy-english",
        createdAt: "2026-05-12T00:00:00.000Z",
        thumbnailDataUrl: "data:image/jpeg;base64,abc",
        primaryType: "poster",
        universalStylePrompt: "Create a clean poster style with strong typography and vivid colors.",
        analysis: {
          style_reference: {
            universal_style_prompt:
              "Create a clean poster style with strong typography and vivid colors for a modern campaign."
          }
        }
      }
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].analysis.style_reference.universal_style_prompt).toContain("Create a clean poster");
  });

  it("writes JSON through a temp file and preserves valid content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "image-style-json-"));
    const path = join(dir, "data.json");
    try {
      await writeJsonFile(path, { ok: true });
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ok: true });
      await writeJsonFile(path, { ok: false, revision: 2 });
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ok: false, revision: 2 });
      expect((await readdir(dir)).filter((file) => file.includes(".tmp"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent Windows replacements without leaving backup files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "image-style-json-win-"));
    const path = join(dir, "tasks.json");
    try {
      await Promise.all(
        Array.from({ length: 12 }, (_item, revision) => writeJsonFile(path, { revision }, "win32"))
      );
      const stored = JSON.parse(await readFile(path, "utf8"));
      expect(stored.revision).toBeGreaterThanOrEqual(0);
      expect(stored.revision).toBeLessThan(12);
      expect((await readdir(dir)).filter((file) => file.includes(".tmp"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renames corrupt JSON aside instead of treating it as a new empty file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "image-style-corrupt-"));
    const path = join(dir, "history.json");
    try {
      await writeFile(path, "{\"broken\"", "utf8");
      await expect(readJsonFile(path, [])).resolves.toEqual([]);
      const files = await readdir(dir);
      expect(files.some((file) => file.startsWith("history.json.corrupt"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

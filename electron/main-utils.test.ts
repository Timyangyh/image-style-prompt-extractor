import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  ModelHttpError,
  anthropicMessagesEndpoint,
  anthropicTextFromResponse,
  buildVisionModelPayload,
  chatCompletionsEndpoint,
  completionTextFromResponse,
  extractJsonText,
  geminiGenerateContentEndpoint,
  geminiTextFromResponse,
  modelRequestTimeoutMessage,
  modelRequestTimeoutMs,
  normalizeHistory,
  normalizeVisionApiMode,
  readJsonFile,
  responsesEndpoint,
  responsesTextFromResponse,
  shouldCacheImageEditAnnotationResolution,
  shouldRetryWithoutResponseFormat,
  visionModelEndpoint,
  visionRequestHeaders,
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
    expect(chatCompletionsEndpoint("https://api.example.com/v1/responses")).toBe(
      "https://api.example.com/v1/chat/completions"
    );
    expect(responsesEndpoint("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1/responses"
    );
    expect(anthropicMessagesEndpoint("https://api.example.com")).toBe(
      "https://api.example.com/v1/messages"
    );
    expect(anthropicMessagesEndpoint("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/messages"
    );
    expect(anthropicMessagesEndpoint("https://api.example.com/v1/messages")).toBe(
      "https://api.example.com/v1/messages"
    );
    expect(anthropicMessagesEndpoint("https://api.example.com/anthropic")).toBe(
      "https://api.example.com/anthropic/v1/messages"
    );
    expect(geminiGenerateContentEndpoint("https://api.example.com/v1beta", "gemini-2.5-flash")).toBe(
      "https://api.example.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(
      visionModelEndpoint(
        "https://api.example.com/v1beta/models/old-model:generateContent",
        "gemini",
        "gemini-2.5-flash"
      )
    ).toBe("https://api.example.com/v1beta/models/gemini-2.5-flash:generateContent");
  });

  it("preserves Anthropic mode in stored configuration normalization", () => {
    expect(normalizeVisionApiMode("anthropic")).toBe("anthropic");
    expect(normalizeVisionApiMode(undefined)).toBe("chat_completions");
  });

  it("builds Responses, Anthropic, and Gemini native vision payloads without exposing keys", () => {
    const responsesPayload = buildVisionModelPayload({
      apiMode: "responses",
      modelName: "gpt-5.5",
      systemPrompt: "只返回 JSON",
      userText: "分析图片",
      imageDataUrls: ["data:image/png;base64,YWJj"],
      includeJsonFormat: true,
      temperature: 0.2,
      maxOutputTokens: 4096
    });
    expect(responsesPayload).toMatchObject({
      model: "gpt-5.5",
      store: false,
      max_output_tokens: 4096,
      text: { format: { type: "json_object" } },
      input: [
        { role: "system", content: [{ type: "input_text", text: "只返回 JSON" }] },
        {
          role: "user",
          content: [
            { type: "input_text", text: "分析图片" },
            { type: "input_image", image_url: "data:image/png;base64,YWJj" }
          ]
        }
      ]
    });

    const geminiPayload = buildVisionModelPayload({
      apiMode: "gemini",
      modelName: "gemini-2.5-flash",
      systemPrompt: "只返回 JSON",
      userText: "分析图片",
      imageDataUrls: ["data:image/jpeg;base64,YWJj"],
      includeJsonFormat: true,
      temperature: 0.1
    });
    expect(geminiPayload).toMatchObject({
      systemInstruction: { parts: [{ text: "只返回 JSON" }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "分析图片" },
            { inlineData: { mimeType: "image/jpeg", data: "YWJj" } }
          ]
        }
      ],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    });
    expect(JSON.stringify(geminiPayload)).not.toContain("api-key");

    const anthropicPayload = buildVisionModelPayload({
      apiMode: "anthropic",
      modelName: "vision-model",
      systemPrompt: "只返回 JSON",
      userText: "分析图片",
      imageDataUrls: ["data:image/png;base64,YWJj"],
      includeJsonFormat: true,
      temperature: 0.2,
      maxOutputTokens: 4096
    });
    expect(anthropicPayload).toEqual({
      model: "vision-model",
      system: "只返回 JSON",
      max_tokens: 4096,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "YWJj" }
            },
            { type: "text", text: "分析图片" }
          ]
        }
      ]
    });
    expect(
      buildVisionModelPayload({
        apiMode: "anthropic",
        modelName: "vision-model",
        systemPrompt: "只返回 JSON",
        userText: "分析图片",
        imageDataUrls: [],
        includeJsonFormat: false,
        temperature: 0.2
      })
    ).toMatchObject({ max_tokens: 16384 });
  });

  it("uses the correct auth headers for Gemini and Anthropic endpoints", () => {
    expect(
      visionRequestHeaders(
        "gemini",
        "google-key",
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
      )
    ).toMatchObject({ "x-goog-api-key": "google-key" });
    expect(
      visionRequestHeaders(
        "gemini",
        "proxy-key",
        "https://api.example.com/v1beta/models/gemini-2.5-flash:generateContent"
      )
    ).toMatchObject({ Authorization: "Bearer proxy-key" });
    const anthropicHeaders = visionRequestHeaders(
      "anthropic",
      "auth-token",
      "https://api.example.com/v1/messages"
    );
    expect(anthropicHeaders).toMatchObject({
      Authorization: "Bearer auth-token",
      "anthropic-version": "2023-06-01"
    });
    expect(anthropicHeaders).not.toHaveProperty("x-api-key");
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

  it("reads text content from Responses, Anthropic, and Gemini native responses", () => {
    expect(
      responsesTextFromResponse(
        JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] }] })
      )
    ).toBe("{\"ok\":true}");
    expect(
      anthropicTextFromResponse(
        JSON.stringify({ content: [{ type: "text", text: "{\"ok\":true}" }] })
      )
    ).toBe("{\"ok\":true}");
    expect(() =>
      anthropicTextFromResponse(JSON.stringify({ content: [{ type: "thinking" }] }))
    ).toThrow("Anthropic Messages 模型返回中没有可解析的文本内容");
    expect(
      geminiTextFromResponse(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] } }] })
      )
    ).toBe("{\"ok\":true}");
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

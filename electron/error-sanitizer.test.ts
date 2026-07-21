import { describe, expect, it } from "vitest";
import { sanitizePublicError } from "./error-sanitizer";

describe("renderer-facing error sanitization", () => {
  it("redacts JSON, header, query, JWT, base64 and private-path secrets", () => {
    const macPrivatePath = `/${["Users", "private-account", "Library", "Application Support", "tasks.json"].join("/")}`;
    const windowsPrivatePath = ["C:", "Users", "windows-owner", "AppData", "Local", "tasks.json"].join("\\");
    const sensitiveValues = [
      "provider-secret",
      "oauth-secret",
      "cookie-secret",
      "header-secret",
      "query-secret",
      "spaced-api-key-secret",
      "spaced-client-secret",
      "quoted client secret value",
      "escaped-value-secret",
      "basic-secret-value",
      "second-cookie-secret",
      "escaped-json-secret",
      "c2VjcmV0X2ltYWdl",
      "c2VjcmV0X3BheWxvYWQ_",
      "private-account",
      "windows-owner"
    ];
    const result = sanitizePublicError(
      [
        '{"api_key":"provider-secret","access_token":"oauth-secret","cookie":"cookie-secret","client_secret":"escaped\\\"escaped-value-secret"}',
        "Authorization: Bearer header-secret",
        "Authorization: Basic basic-secret-value",
        "Cookie: session=first-cookie-secret; refresh=second-cookie-secret",
        String.raw`{\"api_key\":\"escaped-json-secret\"}`,
        "https://example.invalid/fail?api_key=query-secret&mode=test",
        "API key: spaced-api-key-secret",
        "client secret: spaced-client-secret",
        'client secret="quoted client secret value"',
        "data:image/png;charset=utf-8;base64,c2VjcmV0X2ltYWdl\\nYWdhaW4=",
        "provider payload base64,c2VjcmV0X3BheWxvYWQ_",
        `'${macPrivatePath}'`,
        `'${windowsPrivatePath}'`
      ].join("\n")
    );

    for (const value of sensitiveValues) expect(result).not.toContain(value);
    expect(result).toContain("凭证已隐藏");
    expect(result).toContain("图片数据已隐藏");
    expect(result).toContain("编码数据已隐藏");
  });

  it("keeps a concise safe message readable and bounds its length", () => {
    expect(sanitizePublicError("网络请求超时，请稍后重试。")).toBe("网络请求超时，请稍后重试。");
    expect(sanitizePublicError("x".repeat(5000))?.length).toBe(600);
  });
});

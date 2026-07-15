import { describe, expect, it } from "vitest";
import { buildCodexHeaders, buildCodexUserAgent } from "./codex-request";

describe("Codex request identity", () => {
  it("reports the actual Windows platform without claiming a Mac architecture", () => {
    expect(
      buildCodexUserAgent({
        platform: "win32",
        arch: "x64",
        appVersion: "1.1.2",
        electronVersion: "39.8.5"
      })
    ).toBe("image-style-prompt-extractor/1.1.2 (Windows; x64) Electron/39.8.5");
  });

  it("preserves the established macOS request identity in this Windows-only release", () => {
    expect(buildCodexUserAgent({ platform: "darwin", arch: "arm64" })).toBe(
      "codex-tui/0.118.0 (Mac OS 26.3.1; arm64) Codex Desktop"
    );
  });

  it("keeps access tokens out of the user agent while including account routing", () => {
    const headers = buildCodexHeaders({ accessToken: "private-token", accountId: "account-1" });
    expect(headers.Authorization).toBe("Bearer private-token");
    expect(headers["User-Agent"]).not.toContain("private-token");
    expect(headers["Chatgpt-Account-Id"]).toBe("account-1");
    expect(headers.Session_id).toBeTruthy();
    expect(headers["X-Client-Request-Id"]).toBeTruthy();
  });
});

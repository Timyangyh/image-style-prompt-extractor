import { randomUUID } from "node:crypto";
import packageMetadata from "../package.json";

interface CodexHeaderAuthState {
  accessToken: string;
  accountId?: string;
}

interface CodexUserAgentOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  appVersion?: string;
  electronVersion?: string;
}

const platformName = (platform: NodeJS.Platform): string => {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform;
};

export const buildCodexUserAgent = ({
  platform = process.platform,
  arch = process.arch,
  appVersion = packageMetadata.version,
  electronVersion = process.versions.electron || "unknown"
}: CodexUserAgentOptions = {}): string => {
  if (platform === "darwin") return "codex-tui/0.118.0 (Mac OS 26.3.1; arm64) Codex Desktop";
  return `image-style-prompt-extractor/${appVersion} (${platformName(platform)}; ${arch}) Electron/${electronVersion}`;
};

export const buildCodexHeaders = (authState: CodexHeaderAuthState): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authState.accessToken}`,
    Accept: "text/event-stream",
    Connection: "Keep-Alive",
    Originator: "codex-tui",
    "User-Agent": buildCodexUserAgent(),
    Session_id: randomUUID(),
    "X-Client-Request-Id": randomUUID()
  };
  if (authState.accountId) headers["Chatgpt-Account-Id"] = authState.accountId;
  return headers;
};

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_CODEX_AUTH_PATH = join(homedir(), ".codex", "auth.json");
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export interface CodexAuthState {
  path: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId: string;
  lastRefresh?: string;
  raw: Record<string, unknown>;
}

export interface CodexAuthStatus {
  available: boolean;
  path: string;
  accountId?: string;
  lastRefresh?: string;
  error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringValue = (value: unknown): string => (typeof value === "string" ? value : "");

const decodeJwtClaims = (token: string): Record<string, unknown> => {
  const parts = token.split(".");
  if (parts.length !== 3) return {};
  const padding = "=".repeat((4 - (parts[1].length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(parts[1] + padding, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const extractAccountId = (tokens: Record<string, unknown>): string => {
  const stored = stringValue(tokens.account_id);
  if (stored) return stored;
  for (const tokenName of ["id_token", "access_token"]) {
    const claims = decodeJwtClaims(stringValue(tokens[tokenName]));
    const authClaim = claims["https://api.openai.com/auth"];
    if (isRecord(authClaim)) {
      const fromAuth = stringValue(authClaim.chatgpt_account_id) || stringValue(authClaim.account_id);
      if (fromAuth) return fromAuth;
    }
    const fromClaims = stringValue(claims.account_id);
    if (fromClaims) return fromClaims;
  }
  return "";
};

export const parseCodexAuthPayload = (payload: unknown, path = DEFAULT_CODEX_AUTH_PATH): CodexAuthState => {
  if (!isRecord(payload)) throw new Error("Codex OAuth 文件不是有效 JSON 对象。");
  const tokens = isRecord(payload.tokens) ? payload.tokens : payload;
  const accessToken = stringValue(tokens.access_token).trim();
  const refreshToken = stringValue(tokens.refresh_token).trim();
  const idToken = stringValue(tokens.id_token).trim();
  if (!accessToken && !refreshToken) {
    throw new Error("Codex OAuth 文件缺少 access_token 或 refresh_token。");
  }
  return {
    path,
    accessToken,
    refreshToken,
    idToken,
    accountId: extractAccountId(tokens),
    lastRefresh: stringValue(payload.last_refresh) || undefined,
    raw: payload
  };
};

export const loadCodexAuthState = async (path = DEFAULT_CODEX_AUTH_PATH): Promise<CodexAuthState> => {
  const text = await readFile(path, "utf8");
  return parseCodexAuthPayload(JSON.parse(text) as unknown, path);
};

export const getPublicCodexAuthError = (error: unknown): string => {
  const code = isRecord(error) ? stringValue(error.code) : "";
  if (code === "ENOENT") return "未检测到 Codex OAuth 登录，请先执行 codex login。";
  if (code === "EACCES" || code === "EPERM") {
    return "Codex OAuth 凭证不可读取，请检查本机文件权限。";
  }
  if (error instanceof SyntaxError) return "Codex OAuth 凭证格式无效，请重新执行 codex login。";
  if (
    error instanceof Error &&
    (error.message === "Codex OAuth 文件不是有效 JSON 对象。" ||
      error.message === "Codex OAuth 文件缺少 access_token 或 refresh_token。")
  ) {
    return error.message;
  }
  return "无法读取 Codex OAuth 登录状态，请重新执行 codex login。";
};

export const getCodexAuthStatus = async (path = DEFAULT_CODEX_AUTH_PATH): Promise<CodexAuthStatus> => {
  try {
    const state = await loadCodexAuthState(path);
    return {
      available: Boolean(state.accessToken || state.refreshToken),
      path: state.path,
      accountId: state.accountId || undefined,
      lastRefresh: state.lastRefresh
    };
  } catch (error) {
    return {
      available: false,
      path,
      error: getPublicCodexAuthError(error)
    };
  }
};

const formEncode = (values: Record<string, string>): string => new URLSearchParams(values).toString();

export const refreshCodexAuthState = async (
  state: CodexAuthState,
  signal?: AbortSignal
): Promise<CodexAuthState> => {
  if (!state.refreshToken) throw new Error("Codex OAuth 文件缺少 refresh_token，请先执行 codex login。");

  const latest = await loadCodexAuthState(state.path).catch(() => null);
  if (latest?.refreshToken && latest.refreshToken !== state.refreshToken) return latest;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: formEncode({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: state.refreshToken,
      scope: "openid profile email"
    })
  });
  const text = await response.text();
  if (!response.ok) {
    if (text.includes("refresh_token_reused") || text.includes("refresh token has already been used")) {
      throw new Error("Codex OAuth 刷新令牌已失效，请执行 codex logout 后重新 codex login。");
    }
    throw new Error(`Codex OAuth 刷新失败：HTTP ${response.status}: ${text}`);
  }

  let tokenPayload: Record<string, unknown>;
  try {
    tokenPayload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Codex OAuth 刷新接口返回不是有效 JSON。");
  }
  return persistRefreshedTokens(state, tokenPayload);
};

const persistRefreshedTokens = async (
  state: CodexAuthState,
  tokenPayload: Record<string, unknown>
): Promise<CodexAuthState> => {
  const now = new Date().toISOString();
  const raw = { ...state.raw };
  const tokens = isRecord(raw.tokens) ? { ...raw.tokens } : {};
  const accessToken = stringValue(tokenPayload.access_token) || state.accessToken;
  const refreshToken = stringValue(tokenPayload.refresh_token) || state.refreshToken;
  const idToken = stringValue(tokenPayload.id_token) || state.idToken;
  const accountId = extractAccountId({ ...tokens, access_token: accessToken, refresh_token: refreshToken, id_token: idToken });

  raw.tokens = {
    ...tokens,
    access_token: accessToken,
    refresh_token: refreshToken,
    id_token: idToken,
    account_id: accountId || state.accountId
  };
  raw.last_refresh = now;

  await mkdir(dirname(state.path), { recursive: true });
  const tempPath = `${state.path}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(raw, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, state.path);

  return parseCodexAuthPayload(raw, state.path);
};

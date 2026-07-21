const CREDENTIAL_KEY_PATTERN =
  "authorization|api(?:[_-]|\\s+)?key|access(?:[_-]|\\s+)?token|refresh(?:[_-]|\\s+)?token|id(?:[_-]|\\s+)?token|oauth(?:[_-]|\\s+)?token|client(?:[_-]|\\s+)?secret|cookie|credential|token";

const doubleQuotedJsonCredentialPattern = new RegExp(
  `"(${CREDENTIAL_KEY_PATTERN})"\\s*:\\s*"(?:\\\\.|[^"\\\\])*"`,
  "gi"
);
const singleQuotedJsonCredentialPattern = new RegExp(
  `'(${CREDENTIAL_KEY_PATTERN})'\\s*:\\s*'(?:\\\\.|[^'\\\\])*'`,
  "gi"
);
const assignedCredentialPattern = new RegExp(
  `\\b(${CREDENTIAL_KEY_PATTERN})\\b\\s*[:=]\\s*(?:bearer\\s+)?(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;"'&}\\]]+)`,
  "gi"
);
const credentialWordPattern = new RegExp(`\\b(?:${CREDENTIAL_KEY_PATTERN})\\b`, "gi");
const encodedPayloadPattern = "[a-z0-9+/_=-]+(?:(?:\\r?\\n[ \\t]*|\\\\[rn])[a-z0-9+/_=-]+)*";
const imageDataPattern = new RegExp(
  `data:image\\/[a-z0-9.+-]+(?:;[a-z0-9=.+_-]+)*;base64,${encodedPayloadPattern}`,
  "gi"
);
const genericBase64Pattern = new RegExp(`base64,${encodedPayloadPattern}`, "gi");

export const sanitizePublicError = (error: unknown): string | undefined => {
  if (error === undefined || error === null || error === "") return undefined;
  const source = error instanceof Error ? error.message : String(error);
  const sanitized = source
    .slice(0, 4000)
    .replace(imageDataPattern, "[图片数据已隐藏]")
    .replace(genericBase64Pattern, "[编码数据已隐藏]")
    .replace(doubleQuotedJsonCredentialPattern, '"凭证":"[凭证已隐藏]"')
    .replace(singleQuotedJsonCredentialPattern, "'凭证':'[凭证已隐藏]'")
    .replace(/\\+(["'])/g, "$1")
    .replace(doubleQuotedJsonCredentialPattern, '"凭证":"[凭证已隐藏]"')
    .replace(singleQuotedJsonCredentialPattern, "'凭证':'[凭证已隐藏]'")
    .replace(/\b(?:set-cookie|cookie)\s*:[^\r\n]*/gi, "凭证=[凭证已隐藏]")
    .replace(/authorization\s*:\s*(?:bearer|basic)\s+[^\s,;]+/gi, "凭证=[凭证已隐藏]")
    .replace(/\bbearer\s+["']?[a-z0-9._~+\/-]+["']?/gi, "[凭证已隐藏]")
    .replace(assignedCredentialPattern, "凭证=[凭证已隐藏]")
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "[凭证已隐藏]")
    .replace(/\b[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/gi, "[凭证已隐藏]")
    .replace(/(["'])(?:\/(?:Users|home)\/|[a-z]:\\Users\\).*?\1/gi, "$1[本机路径已隐藏]$1")
    .replace(/\/(?:Users|home)\/[^/\s"'<>]+/g, "[本机目录]")
    .replace(/[a-z]:\\Users\\[^\\\s"'<>]+/gi, "[本机目录]")
    .replace(credentialWordPattern, "凭证")
    .slice(0, 600);
  return sanitized || undefined;
};

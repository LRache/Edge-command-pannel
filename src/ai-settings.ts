export const AI_SETTINGS_STORAGE_KEY = "aiSettings";
export const SESSION_HEADER_PLACEHOLDER = "{{session}}";

const MAX_CUSTOM_HEADERS = 20;
const MAX_HEADER_VALUE_LENGTH = 1_000;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.4-mini",
  apiKey: "",
  translateTargetLanguage: "Simplified Chinese",
  headers: {}
};

export interface AiSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  translateTargetLanguage: string;
  headers: Record<string, string>;
}

export function normalizeAiSettings(value: unknown): AiSettings {
  const settings = isRecord(value) ? value : {};
  return {
    baseUrl: normalizeBaseUrl(settings.baseUrl),
    model: normalizeRequiredString(settings.model, DEFAULT_AI_SETTINGS.model),
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey.trim() : "",
    translateTargetLanguage: normalizeRequiredString(
      settings.translateTargetLanguage,
      DEFAULT_AI_SETTINGS.translateTargetLanguage
    ).slice(0, 80),
    headers: normalizeHeaders(settings.headers)
  };
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value).slice(0, MAX_CUSTOM_HEADERS)) {
    if (typeof headerValue === "string" && isValidHeader(name, headerValue)) {
      headers[name] = headerValue;
    }
  }

  return headers;
}

function isValidHeader(name: string, value: string): boolean {
  return (
    HEADER_NAME_PATTERN.test(name) &&
    value.length <= MAX_HEADER_VALUE_LENGTH &&
    !/[\r\n\0]/.test(value)
  );
}

/** Parses one `Name: value` header per line, ignoring blank lines and `#` comments. */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    const separator = line.indexOf(":");
    const name = separator > 0 ? line.slice(0, separator).trim() : "";
    const value = separator > 0 ? line.slice(separator + 1).trim() : "";
    if (!isValidHeader(name, value)) {
      throw new Error(`Header line ${index + 1} must look like "Name: value".`);
    }

    headers[name] = value;
  });

  if (Object.keys(headers).length > MAX_CUSTOM_HEADERS) {
    throw new Error(`At most ${MAX_CUSTOM_HEADERS} custom headers are supported.`);
  }

  return headers;
}

export function formatHeaderLines(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}

/**
 * Replaces {{session}} with the conversation's session ID. Headers that need a
 * session ID are left out when the request has none.
 */
export function resolveHeaders(
  headers: Record<string, string>,
  sessionId?: string
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!value.includes(SESSION_HEADER_PLACEHOLDER)) {
      resolved[name] = value;
    } else if (sessionId) {
      resolved[name] = value.replaceAll(SESSION_HEADER_PLACEHOLDER, sessionId);
    }
  }

  return resolved;
}

export function normalizeBaseUrl(value: unknown): string {
  const candidate = normalizeRequiredString(value, DEFAULT_AI_SETTINGS.baseUrl);
  const url = new URL(candidate);
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("API base URL must use HTTPS, except for localhost.");
  }

  url.hash = "";
  url.search = "";
  return url.href.replace(/\/+$/, "");
}

export function getOriginPattern(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

function normalizeRequiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

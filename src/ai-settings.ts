export const AI_SETTINGS_STORAGE_KEY = "aiSettings";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.4-mini",
  apiKey: ""
};

export interface AiSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function normalizeAiSettings(value: unknown): AiSettings {
  const settings = isRecord(value) ? value : {};
  return {
    baseUrl: normalizeBaseUrl(settings.baseUrl),
    model: normalizeRequiredString(settings.model, DEFAULT_AI_SETTINGS.model),
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey.trim() : ""
  };
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

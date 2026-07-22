export const URL_MAPPINGS_STORAGE_KEY = "commandPanelUrlMappings";

export interface UrlMapping {
  id: string;
  input: string;
  url: string;
}

export function normalizeMappingUrl(value: unknown): string {
  const input = String(value || "").trim();
  if (!input) {
    return "";
  }

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  const candidate = hasScheme ? input : `https://${input}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeUrlMappings(value: unknown): UrlMapping[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const id = typeof entry.id === "string" ? entry.id : "";
    const input = typeof entry.input === "string" ? entry.input.trim() : "";
    const url = normalizeMappingUrl(entry.url);
    return id && input && url ? [{ id, input, url }] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

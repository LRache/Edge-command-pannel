import {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  getOriginPattern,
  normalizeAiSettings,
  normalizeBaseUrl,
  type AiSettings
} from "./ai-settings";

const extensionApi = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;

const form = getElement<HTMLFormElement>("ai-settings-form");
const baseUrlInput = getElement<HTMLInputElement>("base-url");
const modelInput = getElement<HTMLInputElement>("model");
const apiKeyInput = getElement<HTMLInputElement>("api-key");
const status = getElement<HTMLDivElement>("status");
const saveButton = getElement<HTMLButtonElement>("save");

void loadSettings();
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

async function loadSettings(): Promise<void> {
  const values = await extensionApi.storage.local.get(AI_SETTINGS_STORAGE_KEY);
  let settings: AiSettings;
  try {
    settings = normalizeAiSettings(values[AI_SETTINGS_STORAGE_KEY]);
  } catch {
    settings = DEFAULT_AI_SETTINGS;
  }

  baseUrlInput.value = settings.baseUrl;
  modelInput.value = settings.model;
  apiKeyInput.value = settings.apiKey;
}

async function saveSettings(): Promise<void> {
  saveButton.disabled = true;
  setStatus("Saving…", "normal");

  try {
    const settings: AiSettings = {
      baseUrl: normalizeBaseUrl(baseUrlInput.value),
      model: modelInput.value.trim(),
      apiKey: apiKeyInput.value.trim()
    };
    if (!settings.model) {
      throw new Error("Model is required.");
    }
    if (!settings.apiKey) {
      throw new Error("API key is required.");
    }

    const originPattern = getOriginPattern(settings.baseUrl);
    const granted = await ensureOriginPermission(originPattern);
    if (!granted) {
      throw new Error(`Permission to connect to ${new URL(settings.baseUrl).origin} was not granted.`);
    }

    const previousSettings = await readStoredSettings();
    await extensionApi.storage.local.set({ [AI_SETTINGS_STORAGE_KEY]: settings });
    baseUrlInput.value = settings.baseUrl;
    const removedPreviousPermission = await removeUnusedOriginPermission(previousSettings, settings);
    if (removedPreviousPermission) {
      setStatus("Saved. You can now use ask in the command panel.", "success");
    } else {
      setStatus(
        "Saved, but the previous provider permission could not be removed. Remove it from the extension's site access settings.",
        "error"
      );
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to save AI settings.", "error");
  } finally {
    saveButton.disabled = false;
  }
}

async function readStoredSettings(): Promise<AiSettings | null> {
  const values = await extensionApi.storage.local.get(AI_SETTINGS_STORAGE_KEY);
  if (!Object.prototype.hasOwnProperty.call(values, AI_SETTINGS_STORAGE_KEY)) {
    return null;
  }

  try {
    return normalizeAiSettings(values[AI_SETTINGS_STORAGE_KEY]);
  } catch {
    return null;
  }
}

async function removeUnusedOriginPermission(
  previousSettings: AiSettings | null,
  nextSettings: AiSettings
): Promise<boolean> {
  if (!previousSettings) {
    return true;
  }

  const previousOrigin = getOriginPattern(previousSettings.baseUrl);
  const nextOrigin = getOriginPattern(nextSettings.baseUrl);
  if (previousOrigin === nextOrigin) {
    return true;
  }
  if (isRequiredOriginPermission(previousOrigin)) {
    return true;
  }

  try {
    const hasPreviousPermission = await extensionApi.permissions.contains({ origins: [previousOrigin] });
    if (!hasPreviousPermission) {
      return true;
    }

    return await extensionApi.permissions.remove({ origins: [previousOrigin] });
  } catch {
    return false;
  }
}

async function ensureOriginPermission(originPattern: string): Promise<boolean> {
  if (await extensionApi.permissions.contains({ origins: [originPattern] })) {
    return true;
  }

  return await extensionApi.permissions.request({ origins: [originPattern] });
}

function isRequiredOriginPermission(originPattern: string): boolean {
  const manifest = extensionApi.runtime.getManifest() as chrome.runtime.Manifest & {
    host_permissions?: string[];
    permissions?: string[];
  };
  const requiredOriginPatterns = [
    ...(manifest.host_permissions || []),
    ...(manifest.permissions || []).filter(isOriginMatchPattern)
  ];

  return requiredOriginPatterns.some((requiredPattern) =>
    doesPermissionPatternCoverOrigin(requiredPattern, originPattern)
  );
}

function doesPermissionPatternCoverOrigin(requiredPattern: string, originPattern: string): boolean {
  if (requiredPattern === "<all_urls>") {
    return true;
  }

  const required = parseOriginMatchPattern(requiredPattern);
  const origin = parseOriginMatchPattern(originPattern);
  if (!required || !origin) {
    return requiredPattern === originPattern;
  }

  return (
    doesSchemeMatch(required.scheme, origin.scheme) &&
    doesHostMatch(required.host, origin.host)
  );
}

function parseOriginMatchPattern(pattern: string): { scheme: string; host: string } | null {
  const match = /^(\*|http|https):\/\/([^/]+)\//.exec(pattern);
  if (!match) {
    return null;
  }

  const [, scheme, host] = match;
  if (!scheme || !host) {
    return null;
  }

  return { scheme, host };
}

function doesSchemeMatch(requiredScheme: string, originScheme: string): boolean {
  return requiredScheme === "*" || requiredScheme === originScheme;
}

function doesHostMatch(requiredHost: string, originHost: string): boolean {
  if (requiredHost === "*") {
    return true;
  }
  if (requiredHost.startsWith("*.")) {
    const baseHost = requiredHost.slice(2);
    return originHost === baseHost || originHost.endsWith(`.${baseHost}`);
  }

  return requiredHost === originHost;
}

function isOriginMatchPattern(permission: string): boolean {
  return permission === "<all_urls>" || /^(\*|http|https):\/\/[^/]+\//.test(permission);
}

function setStatus(message: string, kind: "normal" | "success" | "error"): void {
  status.textContent = message;
  status.dataset.kind = kind;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing settings element: ${id}`);
  }

  return element as T;
}

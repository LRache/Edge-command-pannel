import {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  getOriginPattern,
  normalizeAiSettings,
  normalizeBaseUrl,
  type AiSettings
} from "./ai-settings";

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
  const values = await chrome.storage.local.get(AI_SETTINGS_STORAGE_KEY);
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
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) {
      throw new Error(`Permission to connect to ${new URL(settings.baseUrl).origin} was not granted.`);
    }

    await chrome.storage.local.set({ [AI_SETTINGS_STORAGE_KEY]: settings });
    baseUrlInput.value = settings.baseUrl;
    setStatus("Saved. You can now use ask in the command panel.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to save AI settings.", "error");
  } finally {
    saveButton.disabled = false;
  }
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

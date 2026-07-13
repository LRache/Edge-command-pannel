import {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  getOriginPattern,
  normalizeAiSettings,
  normalizeBaseUrl,
  type AiSettings
} from "./ai-settings";
import {
  normalizeMappingUrl,
  normalizeUrlMappings,
  URL_MAPPINGS_STORAGE_KEY,
  type UrlMapping
} from "./url-mappings";
import {
  getErrorMessage,
  MESSAGE_TYPES,
  type MessageResponse,
  type PanelRequest
} from "./messages";

const extensionApi = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;

const form = getElement<HTMLFormElement>("ai-settings-form");
const baseUrlInput = getElement<HTMLInputElement>("base-url");
const modelInput = getElement<HTMLInputElement>("model");
const apiKeyInput = getElement<HTMLInputElement>("api-key");
const status = getElement<HTMLDivElement>("status");
const saveButton = getElement<HTMLButtonElement>("save");
const mappingForm = getElement<HTMLFormElement>("mapping-form");
const mappingIdInput = getElement<HTMLInputElement>("mapping-id");
const mappingInput = getElement<HTMLInputElement>("mapping-input");
const mappingUrlInput = getElement<HTMLInputElement>("mapping-url");
const mappingSaveButton = getElement<HTMLButtonElement>("mapping-save");
const mappingCancelButton = getElement<HTMLButtonElement>("mapping-cancel");
const mappingStatus = getElement<HTMLDivElement>("mapping-status");
const mappingList = getElement<HTMLDivElement>("mapping-list");
const mappingCount = getElement<HTMLSpanElement>("mapping-count");
let mappings: UrlMapping[] = [];
let editingMappingSnapshot: UrlMapping | null = null;

void loadSettings();
void loadMappings();
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});
mappingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveMapping();
});
mappingCancelButton.addEventListener("click", resetMappingForm);
extensionApi.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName !== "local" ||
    !Object.prototype.hasOwnProperty.call(changes, URL_MAPPINGS_STORAGE_KEY)
  ) {
    return;
  }

  mappings = normalizeUrlMappings(changes[URL_MAPPINGS_STORAGE_KEY]?.newValue);
  if (mappingIdInput.value && !mappings.some((mapping) => mapping.id === mappingIdInput.value)) {
    resetMappingForm();
  }
  renderMappings();
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

async function loadMappings(): Promise<void> {
  const values = await extensionApi.storage.local.get(URL_MAPPINGS_STORAGE_KEY);
  mappings = normalizeUrlMappings(values[URL_MAPPINGS_STORAGE_KEY]);
  renderMappings();
}

async function saveMapping(): Promise<void> {
  const input = mappingInput.value.trim();
  const url = normalizeMappingUrl(mappingUrlInput.value);
  const editingId = mappingIdInput.value;

  if (!input) {
    setMappingStatus("Enter the input text.", "error");
    return;
  }
  if (!url) {
    setMappingStatus("Enter a valid http:// or https:// URL.", "error");
    return;
  }

  let request: PanelRequest;
  if (editingId) {
    if (!editingMappingSnapshot || editingMappingSnapshot.id !== editingId) {
      setMappingStatus("This mapping changed. Select Edit again and retry.", "error");
      return;
    }
    request = {
      type: MESSAGE_TYPES.UPDATE_URL_MAPPING,
      id: editingId,
      input,
      url,
      expectedInput: editingMappingSnapshot.input,
      expectedUrl: editingMappingSnapshot.url
    };
  } else {
    request = { type: MESSAGE_TYPES.SAVE_URL_MAPPING, input, url };
  }

  mappingSaveButton.disabled = true;
  try {
    const response = await sendMessage<{ mapping: UrlMapping }>(request);
    if (!response.ok) {
      throw new Error(response.error);
    }

    await loadMappings();
    resetMappingForm();
    setMappingStatus(editingId ? "Mapping updated." : "Mapping added.", "success");
  } catch (error) {
    setMappingStatus(getErrorMessage(error, "Unable to save mapping."), "error");
  } finally {
    mappingSaveButton.disabled = false;
  }
}

function renderMappings(): void {
  mappingList.textContent = "";
  mappingCount.textContent = `${mappings.length} saved`;

  if (mappings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No mappings yet. Add your first one above.";
    mappingList.append(empty);
    return;
  }

  for (const mapping of mappings) {
    const row = document.createElement("article");
    row.className = "mapping-row";

    const details = document.createElement("div");
    const input = document.createElement("strong");
    input.textContent = mapping.input;
    const url = document.createElement("span");
    url.textContent = mapping.url;
    details.append(input, url);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(
      createMappingButton("Edit", () => editMapping(mapping)),
      createMappingButton("Delete", () => void deleteMapping(mapping), "danger")
    );
    row.append(details, actions);
    mappingList.append(row);
  }
}

function createMappingButton(
  label: string,
  handler: () => void,
  className = "secondary"
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function editMapping(mapping: UrlMapping): void {
  editingMappingSnapshot = { ...mapping };
  mappingIdInput.value = mapping.id;
  mappingInput.value = mapping.input;
  mappingUrlInput.value = mapping.url;
  mappingSaveButton.textContent = "Save changes";
  mappingCancelButton.hidden = false;
  mappingInput.focus();
}

async function deleteMapping(mapping: UrlMapping): Promise<void> {
  try {
    const response = await sendMessage({
      type: MESSAGE_TYPES.DELETE_URL_MAPPING,
      id: mapping.id,
      expectedInput: mapping.input,
      expectedUrl: mapping.url
    });
    if (!response.ok) {
      throw new Error(response.error);
    }

    await loadMappings();
    if (mappingIdInput.value === mapping.id) {
      resetMappingForm();
    }
    setMappingStatus("Mapping deleted.", "success");
  } catch (error) {
    setMappingStatus(getErrorMessage(error, "Unable to delete mapping."), "error");
  }
}

function resetMappingForm(): void {
  mappingForm.reset();
  mappingIdInput.value = "";
  editingMappingSnapshot = null;
  mappingSaveButton.textContent = "Add mapping";
  mappingCancelButton.hidden = true;
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

function setMappingStatus(message: string, kind: "success" | "error"): void {
  mappingStatus.textContent = message;
  mappingStatus.dataset.kind = kind;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing settings element: ${id}`);
  }

  return element as T;
}

async function sendMessage<T extends object = Record<string, never>>(
  request: PanelRequest
): Promise<MessageResponse<T>> {
  return (await extensionApi.runtime.sendMessage(request)) as MessageResponse<T>;
}

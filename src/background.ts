import {
  getErrorMessage,
  isPanelRequest,
  MESSAGE_TYPES,
  type PageContext,
  type PanelBookmark,
  type PanelTab,
  type ReleaseUpdateStatus,
  type Theme
} from "./messages";
import { AI_SETTINGS_STORAGE_KEY, normalizeAiSettings } from "./ai-settings";
import { requestPageAnswer } from "./ai-client";
import UPDATE_TRACKED_FILES from "../config/update-tracked-files.json";
import {
  normalizeMappingUrl,
  normalizeUrlMappings,
  URL_MAPPINGS_STORAGE_KEY,
  type UrlMapping
} from "./url-mappings";

const extensionApi = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
const actionApi = getActionApi();

const DEFAULT_THEME: Theme = "dark";
const THEME_STORAGE_KEY = "commandPanelTheme";
const THEMES = new Set<Theme>(["light", "dark"]);
const UPDATE_STATUS_STORAGE_KEY = "releaseUpdateStatus";
const UPDATE_ALARM_NAME = "checkReleaseUpdate";
const UPDATE_CHECK_INTERVAL_MINUTES = 360;
const UPDATE_CHECK_INTERVAL_MS = UPDATE_CHECK_INTERVAL_MINUTES * 60 * 1000;
const REPOSITORY_API_URL = "https://api.github.com/repos/LRache/Edge-command-pannel";
interface GitHubReleaseResponse {
  draft?: boolean;
  html_url?: string;
  name?: string;
  tag_name?: string;
}

interface GitHubCommitResponse {
  sha?: string;
  commit?: {
    tree?: { sha?: string };
  };
}

interface GitHubTreeResponse {
  truncated?: boolean;
  tree?: Array<{ path?: string; sha?: string; type?: string }>;
}

interface ExtensionActionApi {
  onClicked: {
    addListener(listener: (tab: chrome.tabs.Tab) => void | Promise<void>): void;
  };
  setBadgeText(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string }): Promise<void>;
}

interface TabInjectionApi {
  insertCSS(tabId: number, details: { file: string }): Promise<void>;
  executeScript(tabId: number, details: { file: string }): Promise<unknown[]>;
}

let updateCheckPromise: Promise<ReleaseUpdateStatus> | null = null;
let localBlobShasPromise: Promise<Map<string, string>> | null = null;

extensionApi.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-command-panel") {
    return;
  }

  await openCommandPanel(tab);
});

actionApi.onClicked.addListener(openCommandPanel);

extensionApi.runtime.onInstalled.addListener(() => {
  scheduleUpdateChecks();
  void getReleaseUpdateStatus({ force: true });
});

extensionApi.runtime.onStartup.addListener(() => {
  scheduleUpdateChecks();
  void getReleaseUpdateStatus();
});

extensionApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM_NAME) {
    void getReleaseUpdateStatus({ force: true });
  }
});

async function openCommandPanel(tab?: chrome.tabs.Tab): Promise<void> {
  const targetTab = tab?.id ? tab : await getActiveTab();
  if (!targetTab?.id || !isSupportedTabUrl(targetTab.url)) {
    return;
  }

  try {
    await ensurePanelInjected(targetTab.id);
    await extensionApi.tabs.sendMessage(targetTab.id, { type: MESSAGE_TYPES.TOGGLE_PANEL });
  } catch (error) {
    console.warn("Unable to open command panel on this page.", error);
  }
}

extensionApi.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
  if (!isPanelRequest(rawMessage)) {
    sendResponse({ ok: false, error: "Invalid extension request." });
    return false;
  }

  void handleMessage(rawMessage, sender)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));
  return true;
});

async function handleMessage(
  message: import("./messages").PanelRequest,
  sender: chrome.runtime.MessageSender
): Promise<object> {
  switch (message.type) {
    case MESSAGE_TYPES.GET_TABS:
      return { ok: true, tabs: await getCurrentWindowTabs(sender.tab?.windowId) };
    case MESSAGE_TYPES.GET_BOOKMARKS:
      return { ok: true, bookmarks: await getBookmarkBarItems() };
    case MESSAGE_TYPES.GET_URL_MAPPINGS:
      return { ok: true, mappings: await getUrlMappings() };
    case MESSAGE_TYPES.SAVE_URL_MAPPING:
      return { ok: true, mapping: await saveUrlMapping(message.input, message.url) };
    case MESSAGE_TYPES.GET_THEME:
      return { ok: true, theme: await getTheme() };
    case MESSAGE_TYPES.GET_UPDATE_STATUS:
      return { ok: true, status: await getReleaseUpdateStatus() };
    case MESSAGE_TYPES.SET_THEME:
      return { ok: true, theme: await setTheme(message.theme) };
    case MESSAGE_TYPES.ASK_PAGE:
      return { ok: true, answer: await askAboutPage(message.question, message.page) };
    case MESSAGE_TYPES.OPEN_AI_SETTINGS:
      await extensionApi.runtime.openOptionsPage();
      break;
    case MESSAGE_TYPES.NEW_TAB:
      await openNewTab(sender.tab?.windowId);
      break;
    case MESSAGE_TYPES.COPY_CURRENT_TAB:
      await copyCurrentTab(sender.tab?.id, sender.tab?.windowId);
      break;
    case MESSAGE_TYPES.CLOSE_CURRENT_TAB:
      await closeCurrentTab(sender.tab?.id);
      break;
    case MESSAGE_TYPES.RELOAD_CURRENT_TAB:
      await reloadCurrentTab(sender.tab?.id);
      break;
    case MESSAGE_TYPES.NAVIGATE_CURRENT_TAB:
      await navigateCurrentTab(sender.tab?.id, message.url);
      break;
    case MESSAGE_TYPES.ACTIVATE_TAB:
      await activateTab(message.tabId);
      break;
    case MESSAGE_TYPES.OPEN_BOOKMARK:
      await openBookmark(message.url, sender.tab?.windowId);
      break;
    default:
      throw new Error(`Unsupported background message: ${message.type}`);
  }

  return { ok: true };
}

async function askAboutPage(question: string, page: PageContext): Promise<string> {
  const values = await extensionApi.storage.local.get(AI_SETTINGS_STORAGE_KEY);
  const settings = normalizeAiSettings(values[AI_SETTINGS_STORAGE_KEY]);
  if (!settings.apiKey) {
    throw new Error("AI is not configured. Open AI Settings and add an API key.");
  }

  return requestPageAnswer(settings, question, page);
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await extensionApi.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function ensurePanelInjected(tabId: number): Promise<void> {
  try {
    await extensionApi.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.PING });
    return;
  } catch {
    await insertPanelFiles(tabId);
  }
}

async function insertPanelFiles(tabId: number): Promise<void> {
  if (extensionApi.scripting) {
    await extensionApi.scripting.insertCSS({
      target: { tabId },
      files: ["src/panel.css"]
    });
    await extensionApi.scripting.executeScript({
      target: { tabId },
      files: ["src/vendor/pinyin-pro.js", "src/content.js"]
    });
    return;
  }

  const tabsApi = extensionApi.tabs as typeof chrome.tabs & TabInjectionApi;
  await tabsApi.insertCSS(tabId, { file: "src/panel.css" });
  await tabsApi.executeScript(tabId, { file: "src/vendor/pinyin-pro.js" });
  await tabsApi.executeScript(tabId, { file: "src/content.js" });
}

async function getCurrentWindowTabs(windowId?: number): Promise<PanelTab[]> {
  const queryInfo: chrome.tabs.QueryInfo = Number.isInteger(windowId)
    ? { windowId }
    : { currentWindow: true };
  const tabs = await extensionApi.tabs.query(queryInfo);
  return tabs
    .sort(compareRecentActivity)
    .map((tab) => ({
      id: tab.id ?? -1,
      title: tab.title || "Untitled",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl || "",
      active: Boolean(tab.active)
    }));
}

async function getBookmarkBarItems(): Promise<PanelBookmark[]> {
  const tree = await extensionApi.bookmarks.getTree();
  const bookmarkBar = findBookmarkBar(tree);
  const bookmarks: PanelBookmark[] = [];
  flattenBookmarks(bookmarkBar?.children || [], [], bookmarks);

  return bookmarks.sort(compareBookmarkTitle);
}

async function getUrlMappings(): Promise<UrlMapping[]> {
  const values = await extensionApi.storage.local.get(URL_MAPPINGS_STORAGE_KEY);
  return normalizeUrlMappings(values[URL_MAPPINGS_STORAGE_KEY]);
}

async function saveUrlMapping(rawInput: string, rawUrl: string): Promise<UrlMapping> {
  const input = rawInput.trim();
  const url = normalizeMappingUrl(rawUrl);
  if (!input || input.length > 80) {
    throw new Error("Mapping name must contain 1 to 80 characters.");
  }
  if (!url) {
    throw new Error("Enter a valid http:// or https:// URL.");
  }

  const mappings = await getUrlMappings();
  if (mappings.some((mapping) => mapping.input.toLocaleLowerCase() === input.toLocaleLowerCase())) {
    throw new Error(`“${input}” already has a mapping.`);
  }

  const mapping = { id: crypto.randomUUID(), input, url };
  await extensionApi.storage.local.set({
    [URL_MAPPINGS_STORAGE_KEY]: [...mappings, mapping]
  });
  return mapping;
}

async function activateTab(tabId: number | undefined): Promise<void> {
  if (!isInteger(tabId)) {
    throw new Error("Invalid tab id.");
  }

  await extensionApi.tabs.update(tabId, { active: true });
}

async function openBookmark(url: string, windowId?: number): Promise<void> {
  if (!isSupportedTabUrl(url)) {
    throw new Error("Unsupported bookmark URL.");
  }

  const createProperties: chrome.tabs.CreateProperties = { url, active: true };
  if (isInteger(windowId)) {
    createProperties.windowId = windowId;
  }

  const tab = await extensionApi.tabs.create(createProperties);
  if (isInteger(windowId)) {
    await extensionApi.windows.update(windowId, { focused: true });
  }

  if (isInteger(tab.id)) {
    await extensionApi.tabs.update(tab.id, { active: true });
  }
}

async function openNewTab(windowId?: number): Promise<void> {
  const createProperties: chrome.tabs.CreateProperties = { active: true };
  if (isInteger(windowId)) {
    createProperties.windowId = windowId;
  }

  const tab = await extensionApi.tabs.create(createProperties);
  if (isInteger(windowId)) {
    await extensionApi.windows.update(windowId, { focused: true });
  }

  if (isInteger(tab.id)) {
    await extensionApi.tabs.update(tab.id, { active: true });
  }
}

async function copyCurrentTab(tabId?: number, windowId?: number): Promise<void> {
  if (!isInteger(tabId)) {
    throw new Error("Invalid current tab.");
  }

  const tab = await extensionApi.tabs.duplicate(tabId);
  if (isInteger(windowId)) {
    await extensionApi.windows.update(windowId, { focused: true });
  }

  if (isInteger(tab?.id)) {
    await extensionApi.tabs.update(tab.id, { active: true });
  }
}

async function closeCurrentTab(tabId?: number): Promise<void> {
  if (!isInteger(tabId)) {
    throw new Error("Invalid current tab.");
  }

  await extensionApi.tabs.remove(tabId);
}

async function reloadCurrentTab(tabId?: number): Promise<void> {
  if (!isInteger(tabId)) {
    throw new Error("Invalid current tab.");
  }

  setTimeout(() => {
    extensionApi.tabs.reload(tabId);
  }, 0);
}

async function navigateCurrentTab(tabId: number | undefined, url: string): Promise<void> {
  if (!isInteger(tabId)) {
    throw new Error("Invalid current tab.");
  }
  if (!isSupportedNavigationUrl(url)) {
    throw new Error("Unsupported URL.");
  }

  await extensionApi.tabs.update(tabId, { url });
}

async function getTheme(): Promise<Theme> {
  const values = await extensionApi.storage.local.get(THEME_STORAGE_KEY);
  const theme = values[THEME_STORAGE_KEY];
  return isTheme(theme) ? theme : DEFAULT_THEME;
}

async function setTheme(theme: Theme): Promise<Theme> {
  if (!THEMES.has(theme)) {
    throw new Error("Unsupported theme.");
  }

  await extensionApi.storage.local.set({ [THEME_STORAGE_KEY]: theme });
  return theme;
}

function scheduleUpdateChecks(): void {
  extensionApi.alarms.create(UPDATE_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES
  });
}

async function getReleaseUpdateStatus(
  { force = false }: { force?: boolean } = {}
): Promise<ReleaseUpdateStatus> {
  if (isFirefoxRuntime()) {
    const status = { available: false, checkedAt: Date.now() };
    await updateActionBadge(status);
    return status;
  }

  const values = await extensionApi.storage.local.get(UPDATE_STATUS_STORAGE_KEY);
  const storedStatus: unknown = values[UPDATE_STATUS_STORAGE_KEY];
  const cachedStatus = isReleaseUpdateStatus(storedStatus) ? storedStatus : undefined;
  const localFingerprint = await getLocalFingerprint();
  const cacheMatchesLocalFiles = cachedStatus?.localFingerprint === localFingerprint;
  const isFresh =
    cachedStatus?.checkedAt &&
    cacheMatchesLocalFiles &&
    Date.now() - cachedStatus.checkedAt < UPDATE_CHECK_INTERVAL_MS;

  if (!force && isFresh) {
    await updateActionBadge(cachedStatus);
    return cachedStatus;
  }

  if (updateCheckPromise) {
    return updateCheckPromise;
  }

  updateCheckPromise = checkLatestRelease()
    .then(async (status) => {
      await extensionApi.storage.local.set({ [UPDATE_STATUS_STORAGE_KEY]: status });
      await updateActionBadge(status);
      return status;
    })
    .catch(async (error) => {
      console.warn("Unable to check release updates.", error);
      if (cachedStatus && cacheMatchesLocalFiles) {
        await updateActionBadge(cachedStatus);
        return cachedStatus;
      }

      await updateActionBadge({ available: false, checkedAt: 0 });
      return { available: false, checkedAt: 0 };
    })
    .finally(() => {
      updateCheckPromise = null;
    });

  return updateCheckPromise;
}

async function checkLatestRelease(): Promise<ReleaseUpdateStatus> {
  // The /releases/latest endpoint excludes pre-releases, which this repository uses for builds.
  const releases = await fetchGitHubJson<GitHubReleaseResponse[]>(
    `${REPOSITORY_API_URL}/releases?per_page=20`
  );
  if (!Array.isArray(releases)) {
    throw new Error("Invalid repository release response.");
  }

  const release = releases.find((candidate) => !candidate.draft && candidate.tag_name);
  if (!release?.tag_name) {
    throw new Error("No published repository release is available.");
  }

  const encodedTag = encodeURIComponent(release.tag_name);
  const commit = await fetchGitHubJson<GitHubCommitResponse>(
    `${REPOSITORY_API_URL}/commits/${encodedTag}`
  );
  const treeSha = commit.commit?.tree?.sha;
  if (!commit.sha || !treeSha) {
    throw new Error("Invalid repository commit response.");
  }

  const tree = await fetchGitHubJson<GitHubTreeResponse>(
    `${REPOSITORY_API_URL}/git/trees/${treeSha}?recursive=1`
  );
  if (tree.truncated || !Array.isArray(tree.tree)) {
    throw new Error("Unable to read the complete repository tree.");
  }

  const remoteBlobShas = new Map<string, string>();
  for (const item of tree.tree) {
    if (item.type === "blob" && item.path && item.sha) {
      remoteBlobShas.set(item.path, item.sha);
    }
  }
  const localBlobShas = await getLocalBlobShas();
  const localFingerprint = getBlobFingerprint(localBlobShas);
  const matchesLatestRelease =
    UPDATE_TRACKED_FILES.every((path) => {
      return remoteBlobShas.get(path) === localBlobShas.get(path);
    });

  return {
    available: !matchesLatestRelease,
    checkedAt: Date.now(),
    localFingerprint,
    latestReleaseTag: release.tag_name,
    latestReleaseUrl:
      release.html_url ||
      `${REPOSITORY_API_URL.replace("api.github.com/repos", "github.com")}/releases/tag/${encodedTag}`,
    latestMessage: release.name || release.tag_name
  };
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub update check failed (${response.status}).`);
  }

  return (await response.json()) as T;
}

async function getLocalBlobShas(): Promise<Map<string, string>> {
  if (!localBlobShasPromise) {
    localBlobShasPromise = Promise.all(
      UPDATE_TRACKED_FILES.map(
        async (path): Promise<readonly [string, string]> => [path, await getLocalGitBlobSha(path)]
      )
    ).then((entries) => new Map(entries));
  }

  return localBlobShasPromise;
}

async function getLocalFingerprint(): Promise<string> {
  return getBlobFingerprint(await getLocalBlobShas());
}

function getBlobFingerprint(blobShas: ReadonlyMap<string, string>): string {
  return UPDATE_TRACKED_FILES.map((path) => `${path}:${blobShas.get(path) || ""}`).join("|");
}

async function getLocalGitBlobSha(path: string): Promise<string> {
  const response = await fetch(extensionApi.runtime.getURL(path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to read local extension file: ${path}`);
  }

  const contents = new Uint8Array(await response.arrayBuffer());
  const header = new TextEncoder().encode(`blob ${contents.byteLength}\0`);
  const gitBlob = new Uint8Array(header.byteLength + contents.byteLength);
  gitBlob.set(header);
  gitBlob.set(contents, header.byteLength);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", gitBlob));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function updateActionBadge(status: ReleaseUpdateStatus): Promise<void> {
  await actionApi.setBadgeText({ text: status.available ? "UP" : "" });
  if (status.available) {
    await actionApi.setBadgeBackgroundColor({ color: "#b45309" });
  }
}

function getActionApi(): ExtensionActionApi {
  const api = extensionApi as typeof chrome & {
    browserAction?: ExtensionActionApi;
  };
  return api.action ?? api.browserAction ?? chrome.action;
}

function isSupportedTabUrl(url = ""): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function isSupportedNavigationUrl(value = ""): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      ((url.protocol === "edge:" || url.protocol === "chrome:") && Boolean(url.hostname))
    );
  } catch {
    return false;
  }
}

function compareRecentActivity(a: chrome.tabs.Tab, b: chrome.tabs.Tab): number {
  if (a.active !== b.active) {
    return a.active ? -1 : 1;
  }

  const aLastAccessed = typeof a.lastAccessed === "number" ? a.lastAccessed : 0;
  const bLastAccessed = typeof b.lastAccessed === "number" ? b.lastAccessed : 0;
  if (aLastAccessed !== bLastAccessed) {
    return bLastAccessed - aLastAccessed;
  }

  return a.index - b.index;
}

function flattenBookmarks(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  folderPath: string[],
  output: PanelBookmark[]
): void {
  for (const node of nodes) {
    if (node.url) {
      if (isSupportedTabUrl(node.url)) {
        output.push({
          id: node.id,
          title: node.title || node.url,
          url: node.url,
          favIconUrl: getFaviconUrl(node.url),
          path: folderPath.join(" / ")
        });
      }
      continue;
    }

    const nextPath = node.title ? [...folderPath, node.title] : folderPath;
    flattenBookmarks(node.children || [], nextPath, output);
  }
}

function compareBookmarkTitle(a: PanelBookmark, b: PanelBookmark): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

function findBookmarkBar(
  tree: chrome.bookmarks.BookmarkTreeNode[]
): chrome.bookmarks.BookmarkTreeNode | undefined {
  const rootChildren = tree[0]?.children || [];
  return (
    rootChildren.find((node) => node.id === "1" || node.id === "toolbar_____") || rootChildren[0]
  );
}

function getFaviconUrl(pageUrl: string): string {
  if (isFirefoxRuntime()) {
    return "";
  }

  const faviconUrl = new URL(extensionApi.runtime.getURL("/_favicon/"));
  faviconUrl.searchParams.set("pageUrl", pageUrl);
  faviconUrl.searchParams.set("size", "32");
  return faviconUrl.toString();
}

function isFirefoxRuntime(): boolean {
  return globalThis.navigator?.userAgent.includes("Firefox") ?? false;
}

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isReleaseUpdateStatus(value: unknown): value is ReleaseUpdateStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const status = value as Record<string, unknown>;
  return typeof status.available === "boolean" && typeof status.checkedAt === "number";
}

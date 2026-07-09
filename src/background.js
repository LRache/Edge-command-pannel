const MESSAGE_TYPES = {
  PING: "PING",
  TOGGLE_PANEL: "TOGGLE_PANEL",
  GET_TABS: "GET_TABS",
  GET_BOOKMARKS: "GET_BOOKMARKS",
  GET_THEME: "GET_THEME",
  SET_THEME: "SET_THEME",
  NEW_TAB: "NEW_TAB",
  CLOSE_CURRENT_TAB: "CLOSE_CURRENT_TAB",
  RELOAD_CURRENT_TAB: "RELOAD_CURRENT_TAB",
  ACTIVATE_TAB: "ACTIVATE_TAB",
  OPEN_BOOKMARK: "OPEN_BOOKMARK"
};

const DEFAULT_THEME = "dark";
const THEME_STORAGE_KEY = "commandPanelTheme";
const THEMES = new Set(["light", "dark"]);

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-command-panel") {
    return;
  }

  await openCommandPanel(tab);
});

chrome.action.onClicked.addListener(openCommandPanel);

async function openCommandPanel(tab) {
  const targetTab = tab?.id ? tab : await getActiveTab();
  if (!targetTab?.id || !isSupportedTabUrl(targetTab.url)) {
    return;
  }

  try {
    await ensurePanelInjected(targetTab.id);
    await chrome.tabs.sendMessage(targetTab.id, { type: MESSAGE_TYPES.TOGGLE_PANEL });
  } catch (error) {
    console.warn("Unable to open command panel on this page.", error);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.GET_TABS) {
    getCurrentWindowTabs(sender.tab?.windowId)
      .then((tabs) => sendResponse({ ok: true, tabs }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.GET_BOOKMARKS) {
    getBookmarkBarItems()
      .then((bookmarks) => sendResponse({ ok: true, bookmarks }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.GET_THEME) {
    getTheme()
      .then((theme) => sendResponse({ ok: true, theme }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.SET_THEME) {
    setTheme(message.theme)
      .then((theme) => sendResponse({ ok: true, theme }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.NEW_TAB) {
    openNewTab(sender.tab?.windowId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.CLOSE_CURRENT_TAB) {
    closeCurrentTab(sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.RELOAD_CURRENT_TAB) {
    reloadCurrentTab(sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.ACTIVATE_TAB) {
    activateTab(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === MESSAGE_TYPES.OPEN_BOOKMARK) {
    openBookmark(message.url, sender.tab?.windowId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function ensurePanelInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.PING });
    return;
  } catch {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["src/panel.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/vendor/pinyin-pro.js", "src/pinyin.js", "src/content.js"]
    });
  }
}

async function getCurrentWindowTabs(windowId) {
  const queryInfo = Number.isInteger(windowId) ? { windowId } : { currentWindow: true };
  const tabs = await chrome.tabs.query(queryInfo);
  return tabs
    .filter((tab) => !tab.active)
    .sort(compareRecentActivity)
    .map((tab) => ({
      id: tab.id,
      title: tab.title || "Untitled",
      url: tab.url || "",
      favIconUrl: tab.favIconUrl || "",
      active: Boolean(tab.active)
    }));
}

async function getBookmarkBarItems() {
  const tree = await chrome.bookmarks.getTree();
  const bookmarkBar = findBookmarkBar(tree);
  const bookmarks = [];
  flattenBookmarks(bookmarkBar?.children || [], [], bookmarks);

  return bookmarks.sort(compareBookmarkTitle);
}

async function activateTab(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Invalid tab id.");
  }

  await chrome.tabs.update(tabId, { active: true });
}

async function openBookmark(url, windowId) {
  if (!isSupportedTabUrl(url)) {
    throw new Error("Unsupported bookmark URL.");
  }

  const createProperties = { url, active: true };
  if (Number.isInteger(windowId)) {
    createProperties.windowId = windowId;
  }

  const tab = await chrome.tabs.create(createProperties);
  if (Number.isInteger(windowId)) {
    await chrome.windows.update(windowId, { focused: true });
  }

  if (Number.isInteger(tab.id)) {
    await chrome.tabs.update(tab.id, { active: true });
  }
}

async function openNewTab(windowId) {
  const createProperties = { active: true };
  if (Number.isInteger(windowId)) {
    createProperties.windowId = windowId;
  }

  const tab = await chrome.tabs.create(createProperties);
  if (Number.isInteger(windowId)) {
    await chrome.windows.update(windowId, { focused: true });
  }

  if (Number.isInteger(tab.id)) {
    await chrome.tabs.update(tab.id, { active: true });
  }
}

async function closeCurrentTab(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Invalid current tab.");
  }

  await chrome.tabs.remove(tabId);
}

async function reloadCurrentTab(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Invalid current tab.");
  }

  setTimeout(() => {
    chrome.tabs.reload(tabId);
  }, 0);
}

async function getTheme() {
  const values = await chrome.storage.local.get(THEME_STORAGE_KEY);
  const theme = values[THEME_STORAGE_KEY];
  return THEMES.has(theme) ? theme : DEFAULT_THEME;
}

async function setTheme(theme) {
  if (!THEMES.has(theme)) {
    throw new Error("Unsupported theme.");
  }

  await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
  return theme;
}

function isSupportedTabUrl(url = "") {
  return url.startsWith("http://") || url.startsWith("https://");
}

function compareRecentActivity(a, b) {
  if (a.active !== b.active) {
    return a.active ? -1 : 1;
  }

  const aLastAccessed = Number.isFinite(a.lastAccessed) ? a.lastAccessed : 0;
  const bLastAccessed = Number.isFinite(b.lastAccessed) ? b.lastAccessed : 0;
  if (aLastAccessed !== bLastAccessed) {
    return bLastAccessed - aLastAccessed;
  }

  return a.index - b.index;
}

function flattenBookmarks(nodes, folderPath, output) {
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

function compareBookmarkTitle(a, b) {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

function findBookmarkBar(tree) {
  const rootChildren = tree[0]?.children || [];
  return rootChildren.find((node) => node.id === "1") || rootChildren[0];
}

function getFaviconUrl(pageUrl) {
  const faviconUrl = new URL(chrome.runtime.getURL("/_favicon/"));
  faviconUrl.searchParams.set("pageUrl", pageUrl);
  faviconUrl.searchParams.set("size", "32");
  return faviconUrl.toString();
}

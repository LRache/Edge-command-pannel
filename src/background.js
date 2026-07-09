const MESSAGE_TYPES = {
  PING: "PING",
  TOGGLE_PANEL: "TOGGLE_PANEL",
  GET_TABS: "GET_TABS",
  GET_BOOKMARKS: "GET_BOOKMARKS",
  ACTIVATE_TAB: "ACTIVATE_TAB",
  OPEN_BOOKMARK: "OPEN_BOOKMARK"
};

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
      files: ["src/content.js"]
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

  await chrome.tabs.create(createProperties);
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

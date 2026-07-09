(() => {
  if (globalThis.__edgeCommandPanelLoaded) {
    return;
  }

  globalThis.__edgeCommandPanelLoaded = true;

  const MESSAGE_TYPES = {
    PING: "PING",
    TOGGLE_PANEL: "TOGGLE_PANEL",
    GET_TABS: "GET_TABS",
    GET_BOOKMARKS: "GET_BOOKMARKS",
    ACTIVATE_TAB: "ACTIVATE_TAB",
    OPEN_BOOKMARK: "OPEN_BOOKMARK"
  };

  const ITEM_TYPES = {
    TAB: "tab",
    BOOKMARK: "bookmark"
  };

  const RECENT_TAB_DISPLAY_LIMIT = 8;

  const state = {
    root: null,
    input: null,
    list: null,
    status: null,
    sections: {
      [ITEM_TYPES.TAB]: [],
      [ITEM_TYPES.BOOKMARK]: []
    },
    visibleItems: [],
    selectedIndex: 0,
    previousFocus: null
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.PING) {
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === MESSAGE_TYPES.TOGGLE_PANEL) {
      togglePanel();
    }
  });

  function togglePanel() {
    if (state.root?.isConnected) {
      closePanel();
      return;
    }

    openPanel();
  }

  async function openPanel() {
    state.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ensurePanel();
    document.documentElement.append(state.root);
    state.root.hidden = false;
    state.input.value = "";
    state.selectedIndex = 0;
    state.input.focus();
    setStatus("Loading recent tabs and bookmark bar...");
    state.list.textContent = "";

    try {
      const [tabs, bookmarks] = await Promise.all([requestTabs(), requestBookmarks()]);
      state.sections[ITEM_TYPES.TAB] = tabs;
      state.sections[ITEM_TYPES.BOOKMARK] = bookmarks;
      applyFilter("");
    } catch (error) {
      state.sections[ITEM_TYPES.TAB] = [];
      state.sections[ITEM_TYPES.BOOKMARK] = [];
      state.visibleItems = [];
      renderResults({ tabs: [], bookmarks: [] });
      setStatus(error.message || "Unable to load command panel items.");
    }
  }

  function closePanel() {
    if (!state.root?.isConnected) {
      return;
    }

    state.root.remove();
    if (state.previousFocus?.isConnected) {
      state.previousFocus.focus();
    }
  }

  function ensurePanel() {
    if (state.root) {
      return;
    }

    state.root = document.createElement("div");
    state.root.className = "ecp-root";
    state.root.hidden = true;
    state.root.setAttribute("role", "dialog");
    state.root.setAttribute("aria-modal", "true");
    state.root.setAttribute("aria-label", "Command panel");

    const backdrop = document.createElement("button");
    backdrop.className = "ecp-backdrop";
    backdrop.type = "button";
    backdrop.setAttribute("aria-label", "Close command panel");
    backdrop.addEventListener("click", closePanel);

    const panel = document.createElement("section");
    panel.className = "ecp-panel";

    state.input = document.createElement("input");
    state.input.className = "ecp-input";
    state.input.type = "search";
    state.input.placeholder = "Search recent tabs and bookmark bar";
    state.input.autocomplete = "off";
    state.input.spellcheck = false;
    state.input.setAttribute("aria-label", "Search recent tabs and bookmark bar");
    state.input.addEventListener("input", () => applyFilter(state.input.value));
    state.input.addEventListener("keydown", handleKeyDown);

    state.status = document.createElement("div");
    state.status.className = "ecp-status";
    state.status.setAttribute("role", "status");

    state.list = document.createElement("div");
    state.list.className = "ecp-list";
    state.list.setAttribute("role", "listbox");
    state.list.setAttribute("aria-label", "Recent tabs and bookmark bar");

    panel.append(state.input, state.status, state.list);
    state.root.append(backdrop, panel);
  }

  async function requestTabs() {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_TABS });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load recent tabs.");
    }

    return (response.tabs || []).map((tab) => ({ ...tab, type: ITEM_TYPES.TAB }));
  }

  async function requestBookmarks() {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_BOOKMARKS });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load bookmark bar.");
    }

    return (response.bookmarks || []).map((bookmark) => ({
      ...bookmark,
      type: ITEM_TYPES.BOOKMARK
    }));
  }

  function applyFilter(query) {
    const normalizedQuery = normalize(query);
    const tabs = filterTabs(normalizedQuery);
    const bookmarks = filterItems(state.sections[ITEM_TYPES.BOOKMARK], normalizedQuery);

    state.visibleItems = [...tabs, ...bookmarks];
    if (state.selectedIndex >= state.visibleItems.length) {
      state.selectedIndex = Math.max(0, state.visibleItems.length - 1);
    }

    renderResults({ tabs, bookmarks });
  }

  function filterItems(items, normalizedQuery) {
    if (!normalizedQuery) {
      return [...items];
    }

    return items.filter((item) => {
      const searchable = `${item.title || ""} ${item.url || ""} ${item.path || ""}`;
      return normalize(searchable).includes(normalizedQuery);
    });
  }

  function filterTabs(normalizedQuery) {
    const tabs = filterItems(state.sections[ITEM_TYPES.TAB], normalizedQuery);
    return normalizedQuery ? tabs : tabs.slice(0, RECENT_TAB_DISPLAY_LIMIT);
  }

  function renderResults({ tabs, bookmarks }) {
    state.list.textContent = "";

    const fragment = document.createDocumentFragment();
    appendSection(fragment, "Recent Tabs", tabs, "No matching recent tabs");
    appendSection(fragment, "Bookmark Bar", bookmarks, "No matching bookmark bar items");
    state.list.append(fragment);
    syncSelectedItem();

    const tabLabel = `${tabs.length} recent tab${tabs.length === 1 ? "" : "s"}`;
    const bookmarkLabel = `${bookmarks.length} bookmark${bookmarks.length === 1 ? "" : "s"}`;
    setStatus(`${tabLabel}, ${bookmarkLabel}`);
  }

  function appendSection(fragment, title, items, emptyText) {
    const section = document.createElement("section");
    section.className = "ecp-section";

    const heading = document.createElement("div");
    heading.className = "ecp-section-title";
    heading.textContent = title;
    section.append(heading);

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ecp-empty ecp-empty-section";
      empty.textContent = emptyText;
      section.append(empty);
      fragment.append(section);
      return;
    }

    for (const item of items) {
      section.append(createItemButton(item));
    }

    fragment.append(section);
  }

  function createItemButton(item) {
    const option = document.createElement("button");
    option.className = "ecp-item";
    option.type = "button";
    option.setAttribute("role", "option");

    const itemIndex = state.visibleItems.indexOf(item);
    option.setAttribute("aria-selected", String(itemIndex === state.selectedIndex));
    option.dataset.selected = String(itemIndex === state.selectedIndex);
    option.addEventListener("mouseenter", () => {
      state.selectedIndex = itemIndex;
      syncSelectedItem();
    });
    option.addEventListener("click", () => selectItem(itemIndex));

    const icon = document.createElement("span");
    icon.className = "ecp-favicon";
    if (item.favIconUrl) {
      const image = document.createElement("img");
      image.src = item.favIconUrl;
      image.alt = "";
      image.loading = "lazy";
      icon.append(image);
    } else {
      icon.textContent = item.type === ITEM_TYPES.TAB ? "T" : "B";
    }

    const body = document.createElement("span");
    body.className = "ecp-item-body";

    const title = document.createElement("span");
    title.className = "ecp-title";
    title.textContent = item.title || "Untitled";

    const url = document.createElement("span");
    url.className = "ecp-url";
    url.textContent =
      item.type === ITEM_TYPES.BOOKMARK && item.path
        ? `${item.path} - ${cleanUrl(item.url)}`
        : cleanUrl(item.url);

    body.append(title, url);
    option.append(icon, body);

    if (item.active) {
      const active = document.createElement("span");
      active.className = "ecp-active";
      active.textContent = "Active";
      option.append(active);
    }

    return option;
  }

  function syncSelectedItem() {
    const items = [...state.list.querySelectorAll(".ecp-item")];
    items.forEach((item, index) => {
      const isSelected = index === state.selectedIndex;
      item.dataset.selected = String(isSelected);
      item.setAttribute("aria-selected", String(isSelected));
    });

    items[state.selectedIndex]?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      selectItem(state.selectedIndex);
    }
  }

  function moveSelection(delta) {
    if (state.visibleItems.length === 0) {
      return;
    }

    state.selectedIndex =
      (state.selectedIndex + delta + state.visibleItems.length) % state.visibleItems.length;
    syncSelectedItem();
  }

  async function selectItem(index) {
    const item = state.visibleItems[index];
    if (!item) {
      return;
    }

    const response = item.type === ITEM_TYPES.TAB ? await activateTab(item) : await openBookmark(item);
    if (!response?.ok) {
      setStatus(response?.error || "Unable to open item.");
      return;
    }

    closePanel();
  }

  async function activateTab(tab) {
    if (!tab?.id) {
      return { ok: false, error: "Invalid tab." };
    }

    setStatus("Switching tab...");
    return chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ACTIVATE_TAB,
      tabId: tab.id
    });
  }

  async function openBookmark(bookmark) {
    if (!bookmark?.url) {
      return { ok: false, error: "Invalid bookmark." };
    }

    setStatus("Opening bookmark...");
    return chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.OPEN_BOOKMARK,
      url: bookmark.url
    });
  }

  function setStatus(message) {
    state.status.textContent = message;
  }

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase();
  }

  function cleanUrl(url) {
    if (!url) {
      return "";
    }

    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  }
})();

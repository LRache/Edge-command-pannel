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
    GET_THEME: "GET_THEME",
    SET_THEME: "SET_THEME",
    NEW_TAB: "NEW_TAB",
    COPY_CURRENT_TAB: "COPY_CURRENT_TAB",
    CLOSE_CURRENT_TAB: "CLOSE_CURRENT_TAB",
    RELOAD_CURRENT_TAB: "RELOAD_CURRENT_TAB",
    ACTIVATE_TAB: "ACTIVATE_TAB",
    OPEN_BOOKMARK: "OPEN_BOOKMARK"
  };

  const ITEM_TYPES = {
    TAB: "tab",
    BOOKMARK: "bookmark",
    COMMAND: "command"
  };

  const RECENT_TAB_DISPLAY_LIMIT = 8;
  const pinyinSearch = globalThis.EdgeCommandPanelPinyin;
  const BUILT_IN_COMMANDS = [
    {
      type: ITEM_TYPES.COMMAND,
      id: "help-built-in-commands",
      title: "Help: Show Built-in Commands",
      subtitle: "Show all available built-in command panel commands",
      iconText: "?",
      action: "show-built-in-commands",
      aliases: "help commands builtin built-in command list show commands 帮助 命令 内置命令 查看命令 bangzhu mingling neizhimingling chakana mingling"
    },
    {
      type: ITEM_TYPES.COMMAND,
      id: "theme-light",
      title: "Theme: Use Light",
      subtitle: "Switch command panel to the light color style",
      iconText: "L",
      theme: "light",
      aliases: "theme light light theme 切换 明亮 亮色 浅色 白色 主题 明亮主题 qiehuan qhzt mingliang liangse"
    },
    {
      type: ITEM_TYPES.COMMAND,
      id: "theme-dark",
      title: "Theme: Use Dark",
      subtitle: "Switch command panel to the dark color style",
      iconText: "D",
      theme: "dark",
      aliases: "theme dark dark theme 切换 暗黑 深色 黑色 夜间 主题 暗黑主题 qiehuan qhzt anhei shense"
    },
    {
      type: ITEM_TYPES.COMMAND,
      id: "tab-new",
      title: "Tab: New Tab",
      subtitle: "Open a new active tab in the current window",
      iconText: "+",
      action: "new-tab",
      aliases: "tab new newtab new tab create tab 新建标签页 新标签页 打开标签页 xinjian biaoqianye xjbqy xinbiaoqianye"
    },
    {
      type: ITEM_TYPES.COMMAND,
      id: "tab-close-current",
      title: "Tab: Close Current Tab",
      subtitle: "Close the tab that is showing the command panel",
      iconText: "X",
      action: "close-current-tab",
      aliases: "tab close close tab close current tab 关闭标签页 关闭当前标签页 删除标签页 guanbi biaoqianye gbbqy guanbidangqianbiaoqianye"
    },
    {
      type: ITEM_TYPES.COMMAND,
      id: "tab-copy-current",
      title: "Tab: Copy Current Tab",
      subtitle: "Duplicate the current tab and switch to the copy",
      iconText: "C",
      action: "copy-current-tab",
      aliases: "copy duplicate clone tab copy tab duplicate tab copy current tab 复制标签页 复制当前标签页 克隆标签页 fuzhi biaoqianye fuzhidangqianbiaoqianye kelong biaoqianye"
    },
    {
      type: ITEM_TYPES.COMMAND,
      id: "window-reload",
      title: "Window: Reload",
      subtitle: "Reload the current tab that is showing the command panel",
      iconText: "R",
      action: "reload-current-tab",
      aliases: "reload refresh reload window reload tab window reload current tab 重新加载窗口 重新加载标签页 刷新 刷新页面 chongxin jiazai chuangkou cxjzck shuaxin"
    }
  ];

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
    theme: "dark",
    previousFocus: null,
    ignoreMouseSelectionUntil: 0
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
      const [theme, tabs, bookmarks] = await Promise.all([
        requestTheme(),
        requestTabs(),
        requestBookmarks()
      ]);
      applyTheme(theme);
      state.sections[ITEM_TYPES.TAB] = tabs;
      state.sections[ITEM_TYPES.BOOKMARK] = bookmarks;
      applyFilter("");
    } catch (error) {
      state.sections[ITEM_TYPES.TAB] = [];
      state.sections[ITEM_TYPES.BOOKMARK] = [];
      state.visibleItems = [];
      renderResults({ tabs: [], bookmarks: [], commands: [] });
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
    state.root.dataset.theme = state.theme;
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
    state.input.placeholder = "Search recent tabs, bookmark bar, and commands";
    state.input.autocomplete = "off";
    state.input.spellcheck = false;
    state.input.setAttribute("aria-label", "Search recent tabs, bookmark bar, and commands");
    state.input.addEventListener("input", () => applyFilter(state.input.value));
    state.input.addEventListener("keydown", handleKeyDown);

    state.status = document.createElement("div");
    state.status.className = "ecp-status";
    state.status.setAttribute("role", "status");

    state.list = document.createElement("div");
    state.list.className = "ecp-list";
    state.list.setAttribute("role", "listbox");
    state.list.setAttribute("aria-label", "Recent tabs, bookmark bar, and commands");

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

  async function requestTheme() {
    const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_THEME });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load theme.");
    }

    return response.theme || "dark";
  }

  function applyFilter(query) {
    const queryTerms = pinyinSearch.normalizeSearchTerms(query);
    const tabs = filterTabs(queryTerms);
    const bookmarks = filterBookmarks(queryTerms);
    const commands = filterCommands(queryTerms);

    state.visibleItems = [...tabs, ...bookmarks, ...commands];
    if (state.selectedIndex >= state.visibleItems.length) {
      state.selectedIndex = Math.max(0, state.visibleItems.length - 1);
    }

    renderResults({ tabs, bookmarks, commands });
  }

  function filterTabs(queryTerms) {
    const tabs = state.sections[ITEM_TYPES.TAB];
    if (queryTerms.length === 0) {
      return tabs.slice(0, RECENT_TAB_DISPLAY_LIMIT);
    }

    return rankItems(tabs, queryTerms, [
      ["title", 300],
      ["url", 200]
    ]);
  }

  function filterBookmarks(queryTerms) {
    const bookmarks = state.sections[ITEM_TYPES.BOOKMARK];
    if (queryTerms.length === 0) {
      return [...bookmarks];
    }

    return rankItems(bookmarks, queryTerms, [
      ["title", 300],
      ["url", 200],
      ["path", 100]
    ]);
  }

  function filterCommands(queryTerms) {
    if (queryTerms.length === 0) {
      return [];
    }

    return rankItems(BUILT_IN_COMMANDS, queryTerms, [
      ["title", 300],
      ["subtitle", 200],
      ["aliases", 100]
    ]);
  }

  function rankItems(items, queryTerms, fields) {
    return items
      .map((item, index) => ({
        item,
        index,
        match: scoreItemFields(item, queryTerms, fields)
      }))
      .filter((result) => result.match.matchedTerms > 0)
      .sort((a, b) => {
        return (
          b.match.matchedTerms - a.match.matchedTerms ||
          b.match.score - a.match.score ||
          a.index - b.index
        );
      })
      .map((result) => result.item);
  }

  function scoreItemFields(item, queryTerms, fields) {
    let matchedTerms = 0;
    let score = 0;

    for (const term of queryTerms) {
      const termScore = fields.reduce((bestScore, [field, baseScore]) => {
        const fieldScore = scoreText(getItemFieldSearchText(item, field), term, baseScore);
        return Math.max(bestScore, fieldScore);
      }, 0);

      if (termScore > 0) {
        matchedTerms += 1;
        score += termScore;
      }
    }

    return { matchedTerms, score };
  }

  function scoreText(searchText, normalizedQuery, baseScore) {
    if (searchText.startsWith(normalizedQuery)) {
      return baseScore + 50;
    }

    if (searchText.includes(` ${normalizedQuery}`)) {
      return baseScore + 25;
    }

    return searchText.includes(normalizedQuery) ? baseScore : 0;
  }

  function getItemFieldSearchText(item, field) {
    const key = `${field}SearchText`;
    if (!item[key]) {
      item[key] = pinyinSearch.buildSearchText(item[field] || "");
    }

    return item[key];
  }

  function renderResults({
    tabs = [],
    bookmarks = [],
    commands = [],
    includeEmptySections = true
  }) {
    state.list.textContent = "";

    const fragment = document.createDocumentFragment();
    if (includeEmptySections || tabs.length > 0) {
      appendSection(fragment, "Recent Tabs", tabs, "No matching recent tabs");
    }
    if (includeEmptySections || bookmarks.length > 0) {
      appendSection(fragment, "Bookmark Bar", bookmarks, "No matching bookmark bar items");
    }
    if (commands.length > 0) {
      appendSection(fragment, "Built-in Commands", commands, "");
    }
    state.list.append(fragment);
    syncSelectedItem();

    const tabLabel = `${tabs.length} recent tab${tabs.length === 1 ? "" : "s"}`;
    const bookmarkLabel = `${bookmarks.length} bookmark${bookmarks.length === 1 ? "" : "s"}`;
    const commandLabel =
      commands.length > 0 ? `, ${commands.length} command${commands.length === 1 ? "" : "s"}` : "";
    setStatus(`${tabLabel}, ${bookmarkLabel}${commandLabel}`);
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
    option.addEventListener("mousemove", () => {
      state.ignoreMouseSelectionUntil = 0;
    });
    option.addEventListener("mouseenter", () => {
      if (Date.now() < state.ignoreMouseSelectionUntil) {
        return;
      }

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
      icon.textContent = item.iconText || icon.textContent;
    }

    const body = document.createElement("span");
    body.className = "ecp-item-body";

    const title = document.createElement("span");
    title.className = "ecp-title";
    title.textContent = item.title || "Untitled";

    const url = document.createElement("span");
    url.className = "ecp-url";
    url.textContent =
      item.type === ITEM_TYPES.COMMAND
        ? item.subtitle
        :
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
    state.ignoreMouseSelectionUntil = Date.now() + 250;
    syncSelectedItem();
  }

  async function selectItem(index) {
    const item = state.visibleItems[index];
    if (!item) {
      return;
    }

    const response =
      item.type === ITEM_TYPES.TAB
        ? await activateTab(item)
        : item.type === ITEM_TYPES.BOOKMARK
          ? await openBookmark(item)
          : await runCommand(item);
    if (!response?.ok) {
      setStatus(response?.error || "Unable to open item.");
      return;
    }

    if (response.keepOpen) {
      return;
    }

    if (item.type !== ITEM_TYPES.COMMAND || item.action) {
      closePanel();
    }
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

  async function runCommand(command) {
    if (!command) {
      return { ok: false, error: "Invalid command." };
    }

    if (command.action === "new-tab") {
      setStatus("Opening new tab...");
      return chrome.runtime.sendMessage({ type: MESSAGE_TYPES.NEW_TAB });
    }

    if (command.action === "copy-current-tab") {
      setStatus("Copying current tab...");
      return chrome.runtime.sendMessage({ type: MESSAGE_TYPES.COPY_CURRENT_TAB });
    }

    if (command.action === "close-current-tab") {
      setStatus("Closing current tab...");
      return chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CLOSE_CURRENT_TAB });
    }

    if (command.action === "reload-current-tab") {
      setStatus("Reloading current tab...");
      return chrome.runtime.sendMessage({ type: MESSAGE_TYPES.RELOAD_CURRENT_TAB });
    }

    if (command.action === "show-built-in-commands") {
      showBuiltInCommands();
      return { ok: true, keepOpen: true };
    }

    if (!command.theme) {
      return { ok: false, error: "Invalid command." };
    }

    setStatus(`Switching to ${command.theme} theme...`);
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.SET_THEME,
      theme: command.theme
    });

    if (response?.ok) {
      applyTheme(response.theme);
      setStatus(`Using ${response.theme} theme.`);
    }

    return response;
  }

  function applyTheme(theme) {
    state.theme = theme === "light" ? "light" : "dark";
    if (state.root) {
      state.root.dataset.theme = state.theme;
    }
  }

  function showBuiltInCommands() {
    state.input.value = "help";
    state.selectedIndex = 0;
    state.visibleItems = [...BUILT_IN_COMMANDS];
    renderResults({
      tabs: [],
      bookmarks: [],
      commands: BUILT_IN_COMMANDS,
      includeEmptySections: false
    });
    setStatus(`${BUILT_IN_COMMANDS.length} built-in commands`);
  }

  function setStatus(message) {
    state.status.textContent = message;
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

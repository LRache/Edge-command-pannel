import { buildSearchText, normalizeSearchTerms } from "./pinyin";
import {
  getErrorMessage,
  isPanelRequest,
  MESSAGE_TYPES,
  type MessageResponse,
  type PanelBookmark,
  type PanelRequest,
  type PanelTab,
  type RepositoryUpdateStatus,
  type Theme
} from "./messages";

declare global {
  var __edgeCommandPanelLoaded: boolean | undefined;
}

const ITEM_TYPES = {
  TAB: "tab",
  BOOKMARK: "bookmark",
  COMMAND: "command"
} as const;

type ItemType = (typeof ITEM_TYPES)[keyof typeof ITEM_TYPES];
type CommandAction =
  | "show-built-in-commands"
  | "new-tab"
  | "close-current-tab"
  | "copy-current-tab"
  | "reload-current-tab"
  | "navigate-current-tab"
  | "open-update-page";

interface TabItem extends PanelTab {
  type: typeof ITEM_TYPES.TAB;
}

interface BookmarkItem extends PanelBookmark {
  type: typeof ITEM_TYPES.BOOKMARK;
}

interface CommandItem {
  type: typeof ITEM_TYPES.COMMAND;
  id: string;
  title: string;
  subtitle: string;
  iconText: string;
  aliases?: string;
  action?: CommandAction;
  theme?: Theme;
  url?: string;
}

type PanelItem = TabItem | BookmarkItem | CommandItem;
type SearchableField = "title" | "url" | "path" | "subtitle" | "aliases";
type SearchField = readonly [field: SearchableField, baseScore: number];
type ActionResponse =
  | { ok: true; keepOpen?: boolean }
  | { ok: false; error: string };

interface PanelState {
  root: HTMLDivElement | null;
  input: HTMLInputElement | null;
  list: HTMLDivElement | null;
  status: HTMLDivElement | null;
  sections: {
    tab: TabItem[];
    bookmark: BookmarkItem[];
  };
  visibleItems: PanelItem[];
  selectedIndex: number;
  theme: Theme;
  updateStatus: RepositoryUpdateStatus | null;
  previousFocus: HTMLElement | null;
  ignoreMouseSelectionUntil: number;
}

interface RenderOptions {
  tabs?: TabItem[];
  bookmarks?: BookmarkItem[];
  commands?: CommandItem[];
  urlCommands?: CommandItem[];
  updateCommands?: CommandItem[];
  includeEmptySections?: boolean;
}

(() => {
  if (globalThis.__edgeCommandPanelLoaded) {
    return;
  }

  globalThis.__edgeCommandPanelLoaded = true;

  const RECENT_TAB_DISPLAY_LIMIT = 8;
  const pinyinSearch = { buildSearchText, normalizeSearchTerms };
  const BUILT_IN_COMMANDS: CommandItem[] = [
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

  const state: PanelState = {
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
    updateStatus: null,
    previousFocus: null,
    ignoreMouseSelectionUntil: 0
  };

  const searchTextCache = new WeakMap<PanelItem, Map<SearchableField, string>>();

  chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
    if (!isPanelRequest(rawMessage)) {
      return false;
    }

    if (rawMessage.type === MESSAGE_TYPES.PING) {
      sendResponse({ ok: true });
      return false;
    }

    if (rawMessage.type === MESSAGE_TYPES.TOGGLE_PANEL) {
      togglePanel();
    }

    return false;
  });

  function togglePanel(): void {
    if (state.root?.isConnected) {
      closePanel();
      return;
    }

    openPanel();
  }

  async function openPanel(): Promise<void> {
    state.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const elements = ensurePanel();
    document.documentElement.append(elements.root);
    elements.root.hidden = false;
    elements.input.value = "";
    state.selectedIndex = 0;
    elements.input.focus();
    setStatus("Loading recent tabs and bookmark bar...");
    elements.list.textContent = "";

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
      void refreshUpdateStatus();
    } catch (error) {
      state.sections[ITEM_TYPES.TAB] = [];
      state.sections[ITEM_TYPES.BOOKMARK] = [];
      state.visibleItems = [];
      renderResults({ tabs: [], bookmarks: [], commands: [] });
      setStatus(getErrorMessage(error, "Unable to load command panel items."));
    }
  }

  function closePanel(): void {
    if (!state.root?.isConnected) {
      return;
    }

    state.root.remove();
    if (state.previousFocus?.isConnected) {
      state.previousFocus.focus();
    }
  }

  function ensurePanel(): {
    root: HTMLDivElement;
    input: HTMLInputElement;
    list: HTMLDivElement;
    status: HTMLDivElement;
  } {
    if (state.root && state.input && state.list && state.status) {
      return { root: state.root, input: state.input, list: state.list, status: state.status };
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
    const input = state.input;
    input.className = "ecp-input";
    input.type = "search";
    input.placeholder = "Search recent tabs, bookmark bar, and commands";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Search recent tabs, bookmark bar, and commands");
    input.addEventListener("input", () => applyFilter(input.value));
    input.addEventListener("keydown", handleKeyDown);

    state.status = document.createElement("div");
    state.status.className = "ecp-status";
    state.status.setAttribute("role", "status");

    state.list = document.createElement("div");
    state.list.className = "ecp-list";
    state.list.setAttribute("role", "listbox");
    state.list.setAttribute("aria-label", "Recent tabs, bookmark bar, and commands");

    panel.append(state.input, state.status, state.list);
    state.root.append(backdrop, panel);

    return { root: state.root, input: state.input, list: state.list, status: state.status };
  }

  async function requestTabs(): Promise<TabItem[]> {
    const response = await sendMessage<{ tabs: PanelTab[] }>({ type: MESSAGE_TYPES.GET_TABS });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load recent tabs.");
    }

    return (response.tabs || []).map((tab) => ({ ...tab, type: ITEM_TYPES.TAB }));
  }

  async function requestBookmarks(): Promise<BookmarkItem[]> {
    const response = await sendMessage<{ bookmarks: PanelBookmark[] }>({
      type: MESSAGE_TYPES.GET_BOOKMARKS
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load bookmark bar.");
    }

    return (response.bookmarks || []).map((bookmark) => ({
      ...bookmark,
      type: ITEM_TYPES.BOOKMARK
    }));
  }

  async function requestTheme(): Promise<Theme> {
    const response = await sendMessage<{ theme: Theme }>({ type: MESSAGE_TYPES.GET_THEME });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load theme.");
    }

    return response.theme || "dark";
  }

  async function refreshUpdateStatus(): Promise<void> {
    try {
      const response = await sendMessage<{ status: RepositoryUpdateStatus }>({
        type: MESSAGE_TYPES.GET_UPDATE_STATUS
      });
      if (!response?.ok) {
        return;
      }

      state.updateStatus = response.status || null;
      if (state.root?.isConnected) {
        applyFilter(state.input?.value ?? "");
      }
    } catch {
      // Update checks must not interfere with the command panel.
    }
  }

  function applyFilter(query: string): void {
    const queryTerms = pinyinSearch.normalizeSearchTerms(query);
    const bookmarks = filterBookmarks(queryTerms);
    const tabs = filterTabs(queryTerms, bookmarks);
    const commands = filterCommands(queryTerms);
    const urlCommand = createUrlCommand(query);
    const urlCommands = urlCommand ? [urlCommand] : [];
    const updateCommands = createUpdateCommands();

    state.visibleItems = [...tabs, ...bookmarks, ...commands, ...urlCommands, ...updateCommands];
    if (state.selectedIndex >= state.visibleItems.length) {
      state.selectedIndex = Math.max(0, state.visibleItems.length - 1);
    }

    renderResults({ tabs, bookmarks, commands, urlCommands, updateCommands });
  }

  function filterTabs(queryTerms: string[], matchedBookmarks: BookmarkItem[]): TabItem[] {
    const tabs = state.sections[ITEM_TYPES.TAB];
    if (queryTerms.length === 0) {
      return tabs.filter((tab) => !tab.active).slice(0, RECENT_TAB_DISPLAY_LIMIT);
    }

    const matchedTabs = rankItems(tabs, queryTerms, [
      ["title", 300],
      ["url", 200]
    ]);
    const matchedTabIds = new Set(matchedTabs.map((tab) => tab.id));
    const bookmarkUrlRanks = new Map();

    matchedBookmarks.forEach((bookmark, index) => {
      const comparableUrl = getComparableUrl(bookmark.url);
      if (comparableUrl && !bookmarkUrlRanks.has(comparableUrl)) {
        bookmarkUrlRanks.set(comparableUrl, index);
      }
    });

    const relatedTabs = tabs
      .filter((tab) => {
        return !matchedTabIds.has(tab.id) && bookmarkUrlRanks.has(getComparableUrl(tab.url));
      })
      .sort((a, b) => {
        return bookmarkUrlRanks.get(getComparableUrl(a.url)) - bookmarkUrlRanks.get(getComparableUrl(b.url));
      });

    return [...matchedTabs, ...relatedTabs];
  }

  function filterBookmarks(queryTerms: string[]): BookmarkItem[] {
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

  function filterCommands(queryTerms: string[]): CommandItem[] {
    if (queryTerms.length === 0) {
      return [];
    }

    return rankItems(BUILT_IN_COMMANDS, queryTerms, [
      ["title", 300],
      ["subtitle", 200],
      ["aliases", 100]
    ]);
  }

  function rankItems<T extends PanelItem>(
    items: readonly T[],
    queryTerms: string[],
    fields: readonly SearchField[]
  ): T[] {
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

  function scoreItemFields(
    item: PanelItem,
    queryTerms: string[],
    fields: readonly SearchField[]
  ): { matchedTerms: number; score: number } {
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

  function scoreText(searchText: string, normalizedQuery: string, baseScore: number): number {
    if (searchText.startsWith(normalizedQuery)) {
      return baseScore + 50;
    }

    if (searchText.includes(` ${normalizedQuery}`)) {
      return baseScore + 25;
    }

    return searchText.includes(normalizedQuery) ? baseScore : 0;
  }

  function getItemFieldSearchText(item: PanelItem, field: SearchableField): string {
    let itemCache = searchTextCache.get(item);
    if (!itemCache) {
      itemCache = new Map<SearchableField, string>();
      searchTextCache.set(item, itemCache);
    }

    const cachedText = itemCache.get(field);
    if (cachedText !== undefined) {
      return cachedText;
    }

    const searchText = pinyinSearch.buildSearchText(getSearchableValue(item, field));
    itemCache.set(field, searchText);
    return searchText;
  }

  function getComparableUrl(value: string): string {
    try {
      const url = new URL(value);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      if (url.protocol === "http:" || url.protocol === "https:") {
        const port = url.port ? `:${url.port}` : "";
        return `${url.hostname}${port}${pathname}`;
      }

      return `${url.protocol}//${url.host}${pathname}`;
    } catch {
      return "";
    }
  }

  function createUrlCommand(query: string): CommandItem | null {
    const url = normalizeInputUrl(query);
    if (!url) {
      return null;
    }

    return {
      type: ITEM_TYPES.COMMAND,
      id: "navigate-input-url",
      title: `Go to ${url}`,
      subtitle: "Open this URL in the current tab",
      iconText: ">",
      action: "navigate-current-tab",
      url
    };
  }

  function normalizeInputUrl(value: unknown): string {
    const input = String(value || "").trim();
    if (!input || /\s/.test(input)) {
      return "";
    }

    const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
    if (hasScheme && !/^(?:https?|edge|chrome):\/\//i.test(input)) {
      return "";
    }

    try {
      const url = new URL(hasScheme ? input : `https://${input}`);
      if (
        url.protocol !== "http:" &&
        url.protocol !== "https:" &&
        url.protocol !== "edge:" &&
        url.protocol !== "chrome:"
      ) {
        return "";
      }

      const isRecognizableBareHost =
        hasScheme ||
        url.hostname === "localhost" ||
        url.hostname.includes(".") ||
        url.hostname.includes(":");
      return isRecognizableBareHost ? url.href : "";
    } catch {
      return "";
    }
  }

  function createUpdateCommands(): CommandItem[] {
    const updateStatus = state.updateStatus;
    if (!updateStatus?.available || !updateStatus.latestCommitUrl) {
      return [];
    }

    const shortCommit = String(updateStatus.latestCommit || "").slice(0, 7);
    return [
      {
        type: ITEM_TYPES.COMMAND,
        id: "open-repository-update",
        title: `Update available${shortCommit ? ` (${shortCommit})` : ""}`,
        subtitle: updateStatus.latestMessage || "Open the latest repository commit",
        iconText: "U",
        action: "open-update-page",
        url: updateStatus.latestCommitUrl
      }
    ];
  }

  function renderResults({
    tabs = [],
    bookmarks = [],
    commands = [],
    urlCommands = [],
    updateCommands = [],
    includeEmptySections = true
  }: RenderOptions): void {
    const list = ensurePanel().list;
    list.textContent = "";

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
    if (urlCommands.length > 0) {
      appendSection(fragment, "Go to URL", urlCommands, "");
    }
    if (updateCommands.length > 0) {
      appendSection(fragment, "Update Available", updateCommands, "");
    }
    list.append(fragment);
    syncSelectedItem();

    const tabLabel = `${tabs.length} recent tab${tabs.length === 1 ? "" : "s"}`;
    const bookmarkLabel = `${bookmarks.length} bookmark${bookmarks.length === 1 ? "" : "s"}`;
    const commandCount = commands.length + urlCommands.length + updateCommands.length;
    const commandLabel =
      commandCount > 0 ? `, ${commandCount} command${commandCount === 1 ? "" : "s"}` : "";
    setStatus(`${tabLabel}, ${bookmarkLabel}${commandLabel}`);
  }

  function appendSection(
    fragment: DocumentFragment,
    title: string,
    items: PanelItem[],
    emptyText: string
  ): void {
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

  function createItemButton(item: PanelItem): HTMLButtonElement {
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
    if (item.type !== ITEM_TYPES.COMMAND && item.favIconUrl) {
      const image = document.createElement("img");
      image.src = item.favIconUrl;
      image.alt = "";
      image.loading = "lazy";
      icon.append(image);
    } else {
      icon.textContent =
        item.type === ITEM_TYPES.COMMAND
          ? item.iconText
          : item.type === ITEM_TYPES.TAB
            ? "T"
            : "B";
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

    if (item.type === ITEM_TYPES.TAB && item.active) {
      const active = document.createElement("span");
      active.className = "ecp-active";
      active.textContent = "Active";
      option.append(active);
    }

    return option;
  }

  function syncSelectedItem(): void {
    const items = [...ensurePanel().list.querySelectorAll<HTMLElement>(".ecp-item")];
    items.forEach((item, index) => {
      const isSelected = index === state.selectedIndex;
      item.dataset.selected = String(isSelected);
      item.setAttribute("aria-selected", String(isSelected));
    });

    items[state.selectedIndex]?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(event: KeyboardEvent): void {
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

  function moveSelection(delta: number): void {
    if (state.visibleItems.length === 0) {
      return;
    }

    state.selectedIndex =
      (state.selectedIndex + delta + state.visibleItems.length) % state.visibleItems.length;
    state.ignoreMouseSelectionUntil = Date.now() + 250;
    syncSelectedItem();
  }

  async function selectItem(index: number): Promise<void> {
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

  async function activateTab(tab: TabItem): Promise<ActionResponse> {
    if (!tab?.id) {
      return { ok: false, error: "Invalid tab." };
    }

    setStatus("Switching tab...");
    return sendMessage({
      type: MESSAGE_TYPES.ACTIVATE_TAB,
      tabId: tab.id
    });
  }

  async function openBookmark(bookmark: BookmarkItem): Promise<ActionResponse> {
    if (!bookmark?.url) {
      return { ok: false, error: "Invalid bookmark." };
    }

    setStatus("Opening bookmark...");
    return sendMessage({
      type: MESSAGE_TYPES.OPEN_BOOKMARK,
      url: bookmark.url
    });
  }

  async function runCommand(command: CommandItem): Promise<ActionResponse> {
    if (!command) {
      return { ok: false, error: "Invalid command." };
    }

    if (command.action === "new-tab") {
      setStatus("Opening new tab...");
      return sendMessage({ type: MESSAGE_TYPES.NEW_TAB });
    }

    if (command.action === "copy-current-tab") {
      setStatus("Copying current tab...");
      return sendMessage({ type: MESSAGE_TYPES.COPY_CURRENT_TAB });
    }

    if (command.action === "close-current-tab") {
      setStatus("Closing current tab...");
      return sendMessage({ type: MESSAGE_TYPES.CLOSE_CURRENT_TAB });
    }

    if (command.action === "reload-current-tab") {
      setStatus("Reloading current tab...");
      return sendMessage({ type: MESSAGE_TYPES.RELOAD_CURRENT_TAB });
    }

    if (command.action === "navigate-current-tab" && command.url) {
      setStatus(`Going to ${command.url}...`);
      return sendMessage({
        type: MESSAGE_TYPES.NAVIGATE_CURRENT_TAB,
        url: command.url
      });
    }

    if (command.action === "open-update-page" && command.url) {
      setStatus("Opening the latest repository commit...");
      return sendMessage({
        type: MESSAGE_TYPES.OPEN_BOOKMARK,
        url: command.url
      });
    }

    if (command.action === "show-built-in-commands") {
      showBuiltInCommands();
      return { ok: true, keepOpen: true };
    }

    if (!command.theme) {
      return { ok: false, error: "Invalid command." };
    }

    setStatus(`Switching to ${command.theme} theme...`);
    const response = await sendMessage<{ theme: Theme }>({
      type: MESSAGE_TYPES.SET_THEME,
      theme: command.theme
    });

    if (response?.ok) {
      applyTheme(response.theme);
      setStatus(`Using ${response.theme} theme.`);
    }

    return response;
  }

  function applyTheme(theme: Theme): void {
    state.theme = theme === "light" ? "light" : "dark";
    if (state.root) {
      state.root.dataset.theme = state.theme;
    }
  }

  function showBuiltInCommands(): void {
    ensurePanel().input.value = "help";
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

  function setStatus(message: string): void {
    ensurePanel().status.textContent = message;
  }

  function cleanUrl(url: string): string {
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

  function getSearchableValue(item: PanelItem, field: SearchableField): string {
    const value = (item as Partial<Record<SearchableField, string>>)[field];
    return value ?? "";
  }

  async function sendMessage<T extends object = Record<string, never>>(
    request: PanelRequest
  ): Promise<MessageResponse<T>> {
    return (await chrome.runtime.sendMessage(request)) as MessageResponse<T>;
  }
})();

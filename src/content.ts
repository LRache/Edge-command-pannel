import { buildSearchText, normalizeSearchTerm, normalizeSearchTerms } from "./pinyin";
import { extractPageContext } from "./page-context";
import { renderMarkdown } from "./markdown";
import {
  getErrorMessage,
  isPanelRequest,
  MAX_ASK_QUESTION_LENGTH,
  MESSAGE_TYPES,
  type MessageResponse,
  type PageContext,
  type PanelBookmark,
  type PanelRequest,
  type PanelTab,
  type ReleaseUpdateStatus,
  type Theme
} from "./messages";
import type { UrlMapping } from "./url-mappings";

declare global {
  var __edgeCommandPanelLoaded: boolean | undefined;
}

const ITEM_TYPES = {
  TAB: "tab",
  BOOKMARK: "bookmark",
  URL_MAPPING: "url-mapping",
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
  | "open-update-page"
  | "ask-current-page"
  | "open-ai-settings"
  | "create-url-mapping";

type PanelMode = "search" | "ask" | "mapping-name" | "mapping-url";

interface TabItem extends PanelTab {
  type: typeof ITEM_TYPES.TAB;
}

interface BookmarkItem extends PanelBookmark {
  type: typeof ITEM_TYPES.BOOKMARK;
}

interface UrlMappingItem extends UrlMapping {
  type: typeof ITEM_TYPES.URL_MAPPING;
  title: string;
  subtitle: string;
  iconText: string;
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
  question?: string;
}

type PanelItem = TabItem | BookmarkItem | UrlMappingItem | CommandItem;
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
    "url-mapping": UrlMappingItem[];
  };
  visibleItems: PanelItem[];
  selectedIndex: number;
  theme: Theme;
  updateStatus: ReleaseUpdateStatus | null;
  previousFocus: HTMLElement | null;
  ignoreMouseSelectionUntil: number;
  mode: PanelMode;
  asking: boolean;
  askRequestId: number;
  pageContext: PageContext | null;
  pendingMappingName: string;
}

interface RenderOptions {
  mappings?: UrlMappingItem[];
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
      id: "create-url-mapping",
      title: "Mapping: Add URL Mapping",
      subtitle: "Enter a name and URL without leaving the command panel",
      iconText: "↗",
      action: "create-url-mapping",
      aliases: "add create url mapping mappings custom shortcut keyword 配置 设置 新增 添加 网址 映射 自定义 输入 peizhi shezhi xinzeng tianjia wangzhi yingshe"
    },
    {
      type: ITEM_TYPES.COMMAND,
      id: "ask-current-page",
      title: "AI: Ask About This Page",
      subtitle: "Ask a question using the visible text on the current page",
      iconText: "AI",
      action: "ask-current-page",
      aliases: "ask ai page question current page summarize 询问 页面 问当前页面 总结页面 xunwen yemian zongjie"
    },
    {
      type: ITEM_TYPES.COMMAND,
      id: "configure-ai",
      title: "AI: Configure Provider",
      subtitle: "Set the OpenAI-compatible endpoint, model, and API key",
      iconText: "S",
      action: "open-ai-settings",
      aliases: "ai settings configure provider api key model 设置 AI 配置 模型 密钥 shezhi peizhi moxing miyao"
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
      [ITEM_TYPES.BOOKMARK]: [],
      [ITEM_TYPES.URL_MAPPING]: []
    },
    visibleItems: [],
    selectedIndex: 0,
    theme: "dark",
    updateStatus: null,
    previousFocus: null,
    ignoreMouseSelectionUntil: 0,
    mode: "search",
    asking: false,
    askRequestId: 0,
    pageContext: null,
    pendingMappingName: ""
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
    state.mode = "search";
    state.asking = false;
    state.pageContext = null;
    state.pendingMappingName = "";
    state.askRequestId += 1;
    elements.input.value = "";
    configureInputForMode();
    state.selectedIndex = 0;
    elements.input.focus();
    setStatus("Loading URL mappings, recent tabs, and bookmark bar...");
    elements.list.textContent = "";

    try {
      const [theme, tabs, bookmarks, mappings] = await Promise.all([
        requestTheme(),
        requestTabs(),
        requestBookmarks(),
        requestUrlMappings()
      ]);
      applyTheme(theme);
      state.sections[ITEM_TYPES.TAB] = tabs;
      state.sections[ITEM_TYPES.BOOKMARK] = bookmarks;
      state.sections[ITEM_TYPES.URL_MAPPING] = mappings;
      applyFilter("");
      void refreshUpdateStatus();
    } catch (error) {
      state.sections[ITEM_TYPES.TAB] = [];
      state.sections[ITEM_TYPES.BOOKMARK] = [];
      state.sections[ITEM_TYPES.URL_MAPPING] = [];
      state.visibleItems = [];
      renderResults({ mappings: [], tabs: [], bookmarks: [], commands: [] });
      setStatus(getErrorMessage(error, "Unable to load command panel items."));
    }
  }

  function closePanel(): void {
    if (!state.root?.isConnected) {
      return;
    }

    state.askRequestId += 1;
    state.asking = false;
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
    input.addEventListener("input", () => {
      if (state.mode === "search") {
        state.selectedIndex = 0;
        applyFilter(input.value);
      } else if (state.mode === "mapping-url") {
        state.selectedIndex = 0;
        renderMappingUrlChoices(input.value);
      }
    });
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

  async function requestUrlMappings(): Promise<UrlMappingItem[]> {
    const response = await sendMessage<{ mappings: UrlMapping[] }>({
      type: MESSAGE_TYPES.GET_URL_MAPPINGS
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to load URL mappings.");
    }

    return (response.mappings || []).map(toUrlMappingItem);
  }

  function toUrlMappingItem(mapping: UrlMapping): UrlMappingItem {
    return {
      ...mapping,
      type: ITEM_TYPES.URL_MAPPING,
      title: mapping.input,
      subtitle: mapping.url,
      iconText: "↗"
    };
  }

  async function refreshUpdateStatus(): Promise<void> {
    try {
      const response = await sendMessage<{ status: ReleaseUpdateStatus }>({
        type: MESSAGE_TYPES.GET_UPDATE_STATUS
      });
      if (!response?.ok) {
        return;
      }

      state.updateStatus = response.status || null;
      if (state.root?.isConnected && state.mode === "search") {
        applyFilter(state.input?.value ?? "");
      }
    } catch {
      // Update checks must not interfere with the command panel.
    }
  }

  function applyFilter(query: string): void {
    const queryTerms = pinyinSearch.normalizeSearchTerms(query);
    const mappings = filterUrlMappings(query, queryTerms);
    const normalizedQuery = normalizeSearchTerm(query);
    const hasExactMapping = mappings.some(
      (mapping) => normalizeSearchTerm(mapping.input) === normalizedQuery
    );
    const askCommand = createAskCommand(query);
    if (askCommand && !hasExactMapping) {
      state.selectedIndex = 0;
      state.visibleItems = [askCommand];
      renderResults({
        commands: [askCommand],
        includeEmptySections: false
      });
      return;
    }

    const bookmarks = filterBookmarks(queryTerms);
    const tabs = filterTabs(queryTerms, bookmarks);
    const commands = filterCommands(queryTerms);
    const urlCommand = createUrlCommand(query);
    const urlCommands = urlCommand ? [urlCommand] : [];
    const updateCommands = createUpdateCommands();

    state.visibleItems = [
      ...mappings,
      ...tabs,
      ...bookmarks,
      ...commands,
      ...urlCommands,
      ...updateCommands
    ];
    if (state.selectedIndex >= state.visibleItems.length) {
      state.selectedIndex = Math.max(0, state.visibleItems.length - 1);
    }

    renderResults({ mappings, tabs, bookmarks, commands, urlCommands, updateCommands });
  }

  function filterUrlMappings(query: string, queryTerms: string[]): UrlMappingItem[] {
    if (queryTerms.length === 0) {
      return [];
    }

    const normalizedQuery = normalizeSearchTerm(query);
    return rankItems(state.sections[ITEM_TYPES.URL_MAPPING], queryTerms, [
      ["title", 400],
      ["url", 100]
    ]).sort((a, b) => {
      const aExact = normalizeSearchTerm(a.input) === normalizedQuery;
      const bExact = normalizeSearchTerm(b.input) === normalizedQuery;
      return Number(bExact) - Number(aExact);
    });
  }

  function createAskCommand(query: string): CommandItem | null {
    const match = query.trim().match(/^(?:ask|问|询问)(?:\s+(.+))?$/i);
    if (!match) {
      return null;
    }

    const question = match[1]?.trim();
    return {
      type: ITEM_TYPES.COMMAND,
      id: "ask-input-question",
      title: question ? `Ask AI: ${question}` : "AI: Ask About This Page",
      subtitle: question
        ? "Send this question with the current page's visible text"
        : "Enter Ask mode for the current page",
      iconText: "AI",
      action: "ask-current-page",
      ...(question ? { question } : {})
    };
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
    if (!updateStatus?.available || !updateStatus.latestReleaseUrl) {
      return [];
    }

    const releaseTag = String(updateStatus.latestReleaseTag || "");
    return [
      {
        type: ITEM_TYPES.COMMAND,
        id: "open-release-update",
        title: `Update available${releaseTag ? ` (${releaseTag})` : ""}`,
        subtitle: updateStatus.latestMessage || "Open the latest release",
        iconText: "U",
        action: "open-update-page",
        url: updateStatus.latestReleaseUrl
      }
    ];
  }

  function renderResults({
    mappings = [],
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
    if (mappings.length > 0) {
      appendSection(fragment, "URL Mappings", mappings, "");
    }
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
      appendSection(fragment, "Update Available", updateCommands, "", "update");
    }
    list.append(fragment);
    syncSelectedItem();

    const mappingLabel =
      mappings.length > 0 ? `${mappings.length} URL mapping${mappings.length === 1 ? "" : "s"}, ` : "";
    const tabLabel = `${tabs.length} recent tab${tabs.length === 1 ? "" : "s"}`;
    const bookmarkLabel = `${bookmarks.length} bookmark${bookmarks.length === 1 ? "" : "s"}`;
    const commandCount = commands.length + urlCommands.length + updateCommands.length;
    const commandLabel =
      commandCount > 0 ? `, ${commandCount} command${commandCount === 1 ? "" : "s"}` : "";
    setStatus(`${mappingLabel}${tabLabel}, ${bookmarkLabel}${commandLabel}`);
  }

  function appendSection(
    fragment: DocumentFragment,
    title: string,
    items: PanelItem[],
    emptyText: string,
    variant: "default" | "update" = "default"
  ): void {
    const section = document.createElement("section");
    section.className = "ecp-section";
    if (variant === "update") {
      section.classList.add("ecp-section-update");
    }

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
    icon.textContent =
      item.type === ITEM_TYPES.COMMAND || item.type === ITEM_TYPES.URL_MAPPING
        ? item.iconText
        : (item.title.trim()[0] || "?").toUpperCase();
    if (
      item.type !== ITEM_TYPES.COMMAND &&
      item.type !== ITEM_TYPES.URL_MAPPING &&
      item.favIconUrl
    ) {
      const image = document.createElement("img");
      image.alt = "";
      image.addEventListener("load", () => icon.replaceChildren(image));
      image.src = item.favIconUrl;
    }

    const body = document.createElement("span");
    body.className = "ecp-item-body";

    const title = document.createElement("span");
    title.className = "ecp-title";
    title.textContent = item.title || "Untitled";

    const url = document.createElement("span");
    url.className = "ecp-url";
    url.textContent =
      item.type === ITEM_TYPES.COMMAND || item.type === ITEM_TYPES.URL_MAPPING
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
    if (state.mode === "mapping-name" || state.mode === "mapping-url") {
      if (event.key === "Escape") {
        event.preventDefault();
        if (state.mode === "mapping-url") {
          returnToMappingNameStep();
        } else {
          exitMappingMode();
        }
        return;
      }
      if (state.mode === "mapping-url" && event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
        return;
      }
      if (state.mode === "mapping-url" && event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (state.mode === "mapping-name") {
          submitMappingName(ensurePanel().input.value);
        } else {
          const selectedItem = state.visibleItems[state.selectedIndex];
          const selectedUrl =
            selectedItem?.type === ITEM_TYPES.TAB || selectedItem?.type === ITEM_TYPES.BOOKMARK
              ? selectedItem.url
              : ensurePanel().input.value;
          void submitMappingUrl(selectedUrl);
        }
      }
      return;
    }

    if (state.mode === "ask") {
      if (event.key === "Escape") {
        event.preventDefault();
        if (state.asking) {
          closePanel();
        } else {
          exitAskMode();
        }
        return;
      }
      if (event.key === "Enter" && !state.asking) {
        event.preventDefault();
        void submitAskQuestion(ensurePanel().input.value);
      }
      return;
    }

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

    if (
      state.mode === "mapping-url" &&
      (item.type === ITEM_TYPES.TAB || item.type === ITEM_TYPES.BOOKMARK)
    ) {
      await submitMappingUrl(item.url);
      return;
    }

    const response =
      item.type === ITEM_TYPES.TAB
        ? await activateTab(item)
        : item.type === ITEM_TYPES.BOOKMARK
          ? await openBookmark(item)
          : item.type === ITEM_TYPES.URL_MAPPING
            ? await openUrlMapping(item)
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

  async function openUrlMapping(mapping: UrlMappingItem): Promise<ActionResponse> {
    setStatus(`Opening ${mapping.input}...`);
    return sendMessage({
      type: MESSAGE_TYPES.OPEN_BOOKMARK,
      url: mapping.url
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
      setStatus("Opening the latest release...");
      return sendMessage({
        type: MESSAGE_TYPES.OPEN_BOOKMARK,
        url: command.url
      });
    }

    if (command.action === "show-built-in-commands") {
      showBuiltInCommands();
      return { ok: true, keepOpen: true };
    }

    if (command.action === "ask-current-page") {
      enterAskMode();
      if (command.question) {
        ensurePanel().input.value = command.question;
        void submitAskQuestion(command.question);
      }
      return { ok: true, keepOpen: true };
    }

    if (command.action === "open-ai-settings") {
      const response = await sendMessage({ type: MESSAGE_TYPES.OPEN_AI_SETTINGS });
      return response.ok ? { ok: true, keepOpen: true } : response;
    }

    if (command.action === "create-url-mapping") {
      enterMappingMode();
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

  function enterMappingMode(): void {
    state.mode = "mapping-name";
    state.pendingMappingName = "";
    state.visibleItems = [];
    state.selectedIndex = 0;

    const input = ensurePanel().input;
    input.value = "";
    configureInputForMode();
    renderMappingStep();
    setStatus("URL Mapping · Step 1 of 2");
    input.focus();
  }

  function submitMappingName(rawName: string): void {
    const name = rawName.trim();
    if (!name || name.length > 80) {
      setStatus("Enter a mapping name containing 1 to 80 characters.");
      return;
    }
    if (
      state.sections[ITEM_TYPES.URL_MAPPING].some(
        (mapping) => mapping.input.toLocaleLowerCase() === name.toLocaleLowerCase()
      )
    ) {
      setStatus(`“${name}” already has a mapping.`);
      return;
    }

    state.pendingMappingName = name;
    state.mode = "mapping-url";
    const input = ensurePanel().input;
    input.value = "";
    configureInputForMode();
    renderMappingUrlChoices("");
    input.focus();
  }

  async function submitMappingUrl(rawUrl: string): Promise<void> {
    const input = ensurePanel().input;
    if (!rawUrl.trim()) {
      setStatus("Enter the URL for this mapping.");
      return;
    }

    input.disabled = true;
    setStatus("Saving URL mapping...");
    let response: MessageResponse<{ mapping: UrlMapping }>;
    try {
      response = await sendMessage<{ mapping: UrlMapping }>({
        type: MESSAGE_TYPES.SAVE_URL_MAPPING,
        input: state.pendingMappingName,
        url: rawUrl
      });
    } catch (error) {
      input.disabled = false;
      setStatus(getErrorMessage(error, "Unable to save URL mapping."));
      input.focus();
      return;
    }

    if (!response.ok) {
      input.disabled = false;
      setStatus(response.error);
      input.focus();
      return;
    }

    const mapping = toUrlMappingItem(response.mapping);
    state.sections[ITEM_TYPES.URL_MAPPING] = [
      ...state.sections[ITEM_TYPES.URL_MAPPING],
      mapping
    ];
    state.mode = "search";
    state.pendingMappingName = "";
    state.selectedIndex = 0;
    input.disabled = false;
    input.value = mapping.input;
    configureInputForMode();
    applyFilter(mapping.input);
    setStatus(`Saved “${mapping.input}” → ${mapping.url}`);
    input.focus();
  }

  function returnToMappingNameStep(): void {
    state.mode = "mapping-name";
    state.visibleItems = [];
    state.selectedIndex = 0;
    const input = ensurePanel().input;
    input.value = state.pendingMappingName;
    configureInputForMode();
    renderMappingStep();
    setStatus("URL Mapping · Step 1 of 2");
    input.focus();
    input.select();
  }

  function exitMappingMode(): void {
    state.mode = "search";
    state.pendingMappingName = "";
    const input = ensurePanel().input;
    input.value = "";
    configureInputForMode();
    state.selectedIndex = 0;
    applyFilter("");
    input.focus();
  }

  function renderMappingStep(): void {
    const list = ensurePanel().list;
    list.textContent = "";

    const container = document.createElement("section");
    container.className = "ecp-ask ecp-ask-intro";
    const heading = document.createElement("div");
    heading.className = "ecp-section-title";
    const body = document.createElement("div");
    body.className = "ecp-ask-content";

    if (state.mode === "mapping-name") {
      heading.textContent = "Add URL Mapping · Step 1 of 2";
      body.textContent = "Enter a short name or keyword, then press Enter. Press Escape to cancel.";
    }

    container.append(heading, body);
    list.append(container);
  }

  function renderMappingUrlChoices(query: string): void {
    const queryTerms = pinyinSearch.normalizeSearchTerms(query);
    const bookmarks = filterBookmarks(queryTerms);
    const tabs = filterTabs(queryTerms, bookmarks);
    state.visibleItems = [...tabs, ...bookmarks];
    if (state.selectedIndex >= state.visibleItems.length) {
      state.selectedIndex = Math.max(0, state.visibleItems.length - 1);
    }

    renderResults({
      tabs,
      bookmarks,
      includeEmptySections: true
    });
    setStatus(
      `URL Mapping · Step 2 of 2 · Type a URL or choose a tab/bookmark for “${state.pendingMappingName}”`
    );
  }

  function enterAskMode(): void {
    state.mode = "ask";
    state.asking = false;
    state.pageContext = extractPageContext(document);
    state.visibleItems = [];
    state.selectedIndex = 0;

    const elements = ensurePanel();
    elements.input.value = "";
    configureInputForMode();
    renderAskMessage(
      "Ask a question about this page. Its visible text will only be sent to your configured AI service after you press Enter.",
      "intro"
    );
    setStatus(
      state.pageContext.text
        ? `Ready · ${state.pageContext.text.length.toLocaleString()} page characters${state.pageContext.truncated ? " (excerpt)" : ""}`
        : "No readable page text found"
    );
    elements.input.focus();
  }

  function exitAskMode(): void {
    state.askRequestId += 1;
    state.mode = "search";
    state.asking = false;
    state.pageContext = null;
    const input = ensurePanel().input;
    input.value = "";
    configureInputForMode();
    state.selectedIndex = 0;
    applyFilter("");
    input.focus();
  }

  async function submitAskQuestion(rawQuestion: string): Promise<void> {
    const question = rawQuestion.trim();
    if (!question) {
      setStatus("Enter a question about the current page.");
      return;
    }
    if (question.length > MAX_ASK_QUESTION_LENGTH) {
      renderAskMessage(
        `Questions can contain at most ${MAX_ASK_QUESTION_LENGTH.toLocaleString()} characters.`,
        "error"
      );
      setStatus("Question is too long");
      return;
    }
    const page = state.pageContext ?? extractPageContext(document);
    if (!page.text) {
      renderAskMessage("No readable visible text was found on this page.", "error");
      setStatus("Unable to ask without page text");
      return;
    }

    const requestId = ++state.askRequestId;
    state.asking = true;
    const input = ensurePanel().input;
    input.disabled = true;
    renderAskMessage("Asking AI…", "loading");
    setStatus(`Sending ${page.text.length.toLocaleString()} page characters to the configured AI service…`);

    try {
      const response = await sendMessage<{ answer: string }>({
        type: MESSAGE_TYPES.ASK_PAGE,
        question,
        page
      });
      if (requestId !== state.askRequestId || state.mode !== "ask") {
        return;
      }
      if (!response.ok) {
        renderAskError(response.error);
        setStatus("Ask failed");
        return;
      }

      renderAskMessage(response.answer, "answer");
      input.value = "";
      setStatus("Answer ready · Ask another question, or press Escape to return");
    } catch (error) {
      if (requestId !== state.askRequestId || state.mode !== "ask") {
        return;
      }
      renderAskError(getErrorMessage(error, "Unable to ask AI."));
      setStatus("Ask failed");
    } finally {
      if (requestId === state.askRequestId && state.mode === "ask") {
        state.asking = false;
        input.disabled = false;
        input.focus();
      }
    }
  }

  function renderAskError(message: string): void {
    renderAskMessage(message, "error", {
      actionLabel: "Open AI Settings",
      onAction: () => {
        void sendMessage({ type: MESSAGE_TYPES.OPEN_AI_SETTINGS });
      }
    });
  }

  function renderAskMessage(
    message: string,
    kind: "intro" | "loading" | "answer" | "error",
    action?: { actionLabel: string; onAction: () => void }
  ): void {
    const list = ensurePanel().list;
    list.textContent = "";

    const container = document.createElement("section");
    container.className = `ecp-ask ecp-ask-${kind}`;
    const heading = document.createElement("div");
    heading.className = "ecp-section-title";
    heading.textContent = kind === "answer" ? "AI Answer" : kind === "error" ? "Ask Error" : "Ask AI";
    const body = document.createElement("div");
    body.className = "ecp-ask-content";
    if (kind === "answer") {
      renderMarkdown(body, message);
    } else {
      body.textContent = message;
    }
    container.append(heading, body);

    if (action) {
      const button = document.createElement("button");
      button.className = "ecp-ask-action";
      button.type = "button";
      button.textContent = action.actionLabel;
      button.addEventListener("click", action.onAction);
      container.append(button);
    }

    list.append(container);
  }

  function configureInputForMode(): void {
    const input = ensurePanel().input;
    const isAskMode = state.mode === "ask";
    if (isAskMode) {
      input.placeholder = "Ask a question about the current page";
    } else if (state.mode === "mapping-name") {
      input.placeholder = "Mapping name, for example: mail";
    } else if (state.mode === "mapping-url") {
      input.placeholder = "URL, for example: https://outlook.office.com";
    } else {
      input.placeholder = "Type a URL mapping, or search tabs, bookmarks, and commands";
    }
    input.setAttribute("aria-label", input.placeholder);
    if (isAskMode) {
      input.maxLength = MAX_ASK_QUESTION_LENGTH;
    } else if (state.mode === "mapping-name") {
      input.maxLength = 80;
    } else if (state.mode === "mapping-url") {
      input.maxLength = 4_000;
    } else {
      input.removeAttribute("maxlength");
    }
    input.disabled = state.asking;
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
      mappings: [],
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

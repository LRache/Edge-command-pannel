export const MESSAGE_TYPES = {
  PING: "PING",
  TOGGLE_PANEL: "TOGGLE_PANEL",
  GET_TABS: "GET_TABS",
  GET_BOOKMARKS: "GET_BOOKMARKS",
  GET_URL_MAPPINGS: "GET_URL_MAPPINGS",
  SAVE_URL_MAPPING: "SAVE_URL_MAPPING",
  GET_THEME: "GET_THEME",
  GET_UPDATE_STATUS: "GET_UPDATE_STATUS",
  SET_THEME: "SET_THEME",
  ASK_PAGE: "ASK_PAGE",
  OPEN_AI_SETTINGS: "OPEN_AI_SETTINGS",
  NEW_TAB: "NEW_TAB",
  COPY_CURRENT_TAB: "COPY_CURRENT_TAB",
  CLOSE_CURRENT_TAB: "CLOSE_CURRENT_TAB",
  RELOAD_CURRENT_TAB: "RELOAD_CURRENT_TAB",
  NAVIGATE_CURRENT_TAB: "NAVIGATE_CURRENT_TAB",
  ACTIVATE_TAB: "ACTIVATE_TAB",
  OPEN_BOOKMARK: "OPEN_BOOKMARK"
} as const;

export const MAX_ASK_QUESTION_LENGTH = 2_000;

export type Theme = "light" | "dark";

export interface PanelTab {
  id: number;
  title: string;
  url: string;
  favIconUrl: string;
  active: boolean;
}

export interface PanelBookmark {
  id: string;
  title: string;
  url: string;
  favIconUrl: string;
  path: string;
}

export interface ReleaseUpdateStatus {
  available: boolean;
  checkedAt: number;
  localFingerprint?: string;
  latestReleaseTag?: string;
  latestReleaseUrl?: string;
  latestMessage?: string;
}

export interface PageContext {
  title: string;
  url: string;
  text: string;
  truncated: boolean;
}

export type PanelRequest =
  | { type: typeof MESSAGE_TYPES.PING }
  | { type: typeof MESSAGE_TYPES.TOGGLE_PANEL }
  | { type: typeof MESSAGE_TYPES.GET_TABS }
  | { type: typeof MESSAGE_TYPES.GET_BOOKMARKS }
  | { type: typeof MESSAGE_TYPES.GET_URL_MAPPINGS }
  | { type: typeof MESSAGE_TYPES.SAVE_URL_MAPPING; input: string; url: string }
  | { type: typeof MESSAGE_TYPES.GET_THEME }
  | { type: typeof MESSAGE_TYPES.GET_UPDATE_STATUS }
  | { type: typeof MESSAGE_TYPES.SET_THEME; theme: Theme }
  | { type: typeof MESSAGE_TYPES.ASK_PAGE; question: string; page: PageContext }
  | { type: typeof MESSAGE_TYPES.OPEN_AI_SETTINGS }
  | { type: typeof MESSAGE_TYPES.NEW_TAB }
  | { type: typeof MESSAGE_TYPES.COPY_CURRENT_TAB }
  | { type: typeof MESSAGE_TYPES.CLOSE_CURRENT_TAB }
  | { type: typeof MESSAGE_TYPES.RELOAD_CURRENT_TAB }
  | { type: typeof MESSAGE_TYPES.NAVIGATE_CURRENT_TAB; url: string }
  | { type: typeof MESSAGE_TYPES.ACTIVATE_TAB; tabId: number }
  | { type: typeof MESSAGE_TYPES.OPEN_BOOKMARK; url: string };

export type MessageResponse<T extends object = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export function isPanelRequest(value: unknown): value is PanelRequest {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case MESSAGE_TYPES.SAVE_URL_MAPPING:
      return (
        typeof value.input === "string" &&
        value.input.length <= 80 &&
        typeof value.url === "string" &&
        value.url.length <= 4_000
      );
    case MESSAGE_TYPES.SET_THEME:
      return value.theme === "light" || value.theme === "dark";
    case MESSAGE_TYPES.NAVIGATE_CURRENT_TAB:
    case MESSAGE_TYPES.OPEN_BOOKMARK:
      return typeof value.url === "string";
    case MESSAGE_TYPES.ASK_PAGE:
      return isValidAskPageRequest(value);
    case MESSAGE_TYPES.ACTIVATE_TAB:
      return Number.isInteger(value.tabId);
    default:
      return Object.values(MESSAGE_TYPES).some((type) => type === value.type);
  }
}

function isValidAskPageRequest(value: Record<string, unknown>): boolean {
  if (
    typeof value.question !== "string" ||
    !value.question.trim() ||
    value.question.length > MAX_ASK_QUESTION_LENGTH
  ) {
    return false;
  }
  if (!isRecord(value.page)) {
    return false;
  }

  return (
    typeof value.page.title === "string" &&
    value.page.title.length <= 1_000 &&
    typeof value.page.url === "string" &&
    value.page.url.length <= 4_000 &&
    typeof value.page.text === "string" &&
    value.page.text.length <= 60_100 &&
    typeof value.page.truncated === "boolean"
  );
}

export function getErrorMessage(error: unknown, fallback = "Unexpected error."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

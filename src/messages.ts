export const MESSAGE_TYPES = {
  PING: "PING",
  TOGGLE_PANEL: "TOGGLE_PANEL",
  GET_TABS: "GET_TABS",
  GET_BOOKMARKS: "GET_BOOKMARKS",
  GET_URL_MAPPINGS: "GET_URL_MAPPINGS",
  SAVE_URL_MAPPING: "SAVE_URL_MAPPING",
  UPDATE_URL_MAPPING: "UPDATE_URL_MAPPING",
  DELETE_URL_MAPPING: "DELETE_URL_MAPPING",
  GET_THEME: "GET_THEME",
  GET_UPDATE_STATUS: "GET_UPDATE_STATUS",
  SET_THEME: "SET_THEME",
  ASK_PAGE: "ASK_PAGE",
  TRANSLATE_SEGMENTS: "TRANSLATE_SEGMENTS",
  OPEN_AI_SETTINGS: "OPEN_AI_SETTINGS",
  NEW_TAB: "NEW_TAB",
  COPY_CURRENT_TAB: "COPY_CURRENT_TAB",
  CLOSE_CURRENT_TAB: "CLOSE_CURRENT_TAB",
  CLOSE_TAB: "CLOSE_TAB",
  RELOAD_CURRENT_TAB: "RELOAD_CURRENT_TAB",
  NAVIGATE_CURRENT_TAB: "NAVIGATE_CURRENT_TAB",
  ACTIVATE_TAB: "ACTIVATE_TAB",
  OPEN_BOOKMARK: "OPEN_BOOKMARK"
} as const;

export const MAX_ASK_QUESTION_LENGTH = 2_000;
export const MAX_TRANSLATE_SEGMENTS = 40;
export const MAX_TRANSLATE_SEGMENT_LENGTH = 4_000;
export const MAX_TRANSLATE_BATCH_LENGTH = 12_000;

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
  | {
      type: typeof MESSAGE_TYPES.UPDATE_URL_MAPPING;
      id: string;
      input: string;
      url: string;
      expectedInput: string;
      expectedUrl: string;
    }
  | {
      type: typeof MESSAGE_TYPES.DELETE_URL_MAPPING;
      id: string;
      expectedInput: string;
      expectedUrl: string;
    }
  | { type: typeof MESSAGE_TYPES.GET_THEME }
  | { type: typeof MESSAGE_TYPES.GET_UPDATE_STATUS }
  | { type: typeof MESSAGE_TYPES.SET_THEME; theme: Theme }
  | {
      type: typeof MESSAGE_TYPES.ASK_PAGE;
      question: string;
      page: PageContext;
      sessionId?: string | undefined;
    }
  | {
      type: typeof MESSAGE_TYPES.TRANSLATE_SEGMENTS;
      segments: string[];
      sessionId?: string | undefined;
    }
  | { type: typeof MESSAGE_TYPES.OPEN_AI_SETTINGS }
  | { type: typeof MESSAGE_TYPES.NEW_TAB }
  | { type: typeof MESSAGE_TYPES.COPY_CURRENT_TAB }
  | { type: typeof MESSAGE_TYPES.CLOSE_CURRENT_TAB }
  | { type: typeof MESSAGE_TYPES.RELOAD_CURRENT_TAB }
  | { type: typeof MESSAGE_TYPES.NAVIGATE_CURRENT_TAB; url: string }
  | { type: typeof MESSAGE_TYPES.ACTIVATE_TAB; tabId: number }
  | { type: typeof MESSAGE_TYPES.CLOSE_TAB; tabId: number }
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
      return isValidUrlMappingFields(value);
    case MESSAGE_TYPES.UPDATE_URL_MAPPING:
      return (
        isValidUrlMappingId(value.id) &&
        isValidUrlMappingFields(value) &&
        isValidUrlMappingExpectation(value)
      );
    case MESSAGE_TYPES.DELETE_URL_MAPPING:
      return isValidUrlMappingId(value.id) && isValidUrlMappingExpectation(value);
    case MESSAGE_TYPES.SET_THEME:
      return value.theme === "light" || value.theme === "dark";
    case MESSAGE_TYPES.NAVIGATE_CURRENT_TAB:
    case MESSAGE_TYPES.OPEN_BOOKMARK:
      return typeof value.url === "string";
    case MESSAGE_TYPES.ASK_PAGE:
      return isValidAskPageRequest(value) && isValidOptionalSessionId(value.sessionId);
    case MESSAGE_TYPES.TRANSLATE_SEGMENTS:
      return (
        isValidTranslateSegments(value.segments) && isValidOptionalSessionId(value.sessionId)
      );
    case MESSAGE_TYPES.ACTIVATE_TAB:
    case MESSAGE_TYPES.CLOSE_TAB:
      return Number.isInteger(value.tabId);
    default:
      return Object.values(MESSAGE_TYPES).some((type) => type === value.type);
  }
}

function isValidUrlMappingFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.input === "string" &&
    value.input.length <= 80 &&
    typeof value.url === "string" &&
    value.url.length <= 4_000
  );
}

function isValidUrlMappingId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100;
}

function isValidUrlMappingExpectation(value: Record<string, unknown>): boolean {
  return (
    typeof value.expectedInput === "string" &&
    value.expectedInput.length <= 80 &&
    typeof value.expectedUrl === "string" &&
    value.expectedUrl.length <= 4_000
  );
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

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Creates a random UUID v4. crypto.randomUUID is unavailable on insecure (http) pages. */
export function createSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isValidOptionalSessionId(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && SESSION_ID_PATTERN.test(value));
}

function isValidTranslateSegments(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TRANSLATE_SEGMENTS) {
    return false;
  }

  let totalLength = 0;
  for (const segment of value) {
    if (typeof segment !== "string" || segment.length > MAX_TRANSLATE_SEGMENT_LENGTH) {
      return false;
    }
    totalLength += segment.length;
  }

  return totalLength <= MAX_TRANSLATE_BATCH_LENGTH;
}

export function getErrorMessage(error: unknown, fallback = "Unexpected error."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

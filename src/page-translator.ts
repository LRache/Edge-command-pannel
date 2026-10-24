import {
  MAX_TRANSLATE_BATCH_LENGTH,
  MAX_TRANSLATE_SEGMENT_LENGTH,
  MAX_TRANSLATE_SEGMENTS,
  type MessageResponse
} from "./messages";

export type TranslateRequest = (
  segments: string[]
) => Promise<MessageResponse<{ translations: string[] }>>;

export interface PageTranslator {
  isActive(): boolean;
  start(): void;
  stop(): void;
}

const BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, dt, dd, td, th, blockquote, figcaption, summary, caption";
const CONTAINER_SELECTOR = `${BLOCK_SELECTOR}, div, section, article, ul, ol, dl, table, pre, header, footer, nav, aside, main, form`;
const SKIP_ANCESTOR_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "pre",
  "code",
  "kbd",
  "samp",
  "textarea",
  "input",
  "select",
  "option",
  "svg",
  "math",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[translate='no']",
  ".notranslate",
  ".ecp-root",
  ".ecp-translate-toast"
].join(", ");
const SKIP_TEXT_SELECTOR = "script, style, noscript, template, svg, .ecp-translation";
const TRANSLATION_CLASS = "ecp-translation";
const STATE_ATTRIBUTE = "data-ecp-translate";
const MAX_CONCURRENT_REQUESTS = 3;
const FLUSH_DELAY_MS = 120;
const RESCAN_DELAY_MS = 600;

interface Segment {
  element: HTMLElement;
  before: Node | null;
  text: string;
}

export function createPageTranslator(translate: TranslateRequest): PageTranslator {
  let active = false;
  let generation = 0;
  let intersectionObserver: IntersectionObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let flushTimer = 0;
  let rescanTimer = 0;
  let inFlight = 0;
  let translatedCount = 0;
  let failedCount = 0;
  const queue: Segment[] = [];
  const segments = new WeakMap<HTMLElement, Segment>();
  const toast = createToast();

  function start(): void {
    if (active) {
      return;
    }

    active = true;
    generation += 1;
    translatedCount = 0;
    failedCount = 0;
    intersectionObserver = new IntersectionObserver(handleIntersection, {
      rootMargin: "800px 0px"
    });
    mutationObserver = new MutationObserver(scheduleRescan);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    const found = scan();
    toast.show(found > 0 ? "Translating page…" : "Nothing to translate on this page.");
    if (found === 0) {
      toast.hideSoon();
    }
  }

  function stop(): void {
    active = false;
    generation += 1;
    intersectionObserver?.disconnect();
    mutationObserver?.disconnect();
    intersectionObserver = null;
    mutationObserver = null;
    window.clearTimeout(flushTimer);
    window.clearTimeout(rescanTimer);
    queue.length = 0;
    inFlight = 0;
    document.querySelectorAll(`.${TRANSLATION_CLASS}`).forEach((node) => node.remove());
    document
      .querySelectorAll(`[${STATE_ATTRIBUTE}]`)
      .forEach((node) => node.removeAttribute(STATE_ATTRIBUTE));
    toast.show("Translation removed.");
    toast.hideSoon();
  }

  function scan(): number {
    let found = 0;
    for (const element of document.body.querySelectorAll<HTMLElement>(`${BLOCK_SELECTOR}, div`)) {
      if (element.hasAttribute(STATE_ATTRIBUTE)) {
        continue;
      }

      const segment = createSegment(element);
      element.setAttribute(STATE_ATTRIBUTE, segment ? "pending" : "skip");
      if (!segment) {
        continue;
      }

      segments.set(element, segment);
      intersectionObserver?.observe(element);
      found += 1;
    }

    return found;
  }

  function scheduleRescan(records: MutationRecord[]): void {
    const hasForeignChange = records.some((record) =>
      [...record.addedNodes].some(
        (node) =>
          node instanceof HTMLElement &&
          !node.classList.contains(TRANSLATION_CLASS) &&
          !node.classList.contains("ecp-root") &&
          !node.classList.contains("ecp-translate-toast")
      )
    );
    if (!hasForeignChange) {
      return;
    }

    window.clearTimeout(rescanTimer);
    rescanTimer = window.setTimeout(() => {
      if (active) {
        scan();
      }
    }, RESCAN_DELAY_MS);
  }

  function handleIntersection(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }

      const element = entry.target as HTMLElement;
      intersectionObserver?.unobserve(element);
      const segment = segments.get(element);
      if (segment) {
        queue.push(segment);
      }
    }

    scheduleFlush();
  }

  function scheduleFlush(): void {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(flush, FLUSH_DELAY_MS);
  }

  function flush(): void {
    while (active && queue.length > 0 && inFlight < MAX_CONCURRENT_REQUESTS) {
      void sendBatch(takeBatch());
    }
  }

  function takeBatch(): Segment[] {
    const batch: Segment[] = [];
    let length = 0;
    while (batch.length < MAX_TRANSLATE_SEGMENTS) {
      const next = queue[0];
      if (!next || (batch.length > 0 && length + next.text.length > MAX_TRANSLATE_BATCH_LENGTH)) {
        break;
      }

      batch.push(next);
      length += next.text.length;
      queue.shift();
    }

    return batch;
  }

  async function sendBatch(batch: Segment[]): Promise<void> {
    const batchGeneration = generation;
    inFlight += 1;
    updateProgress();

    try {
      const response = await translate(batch.map((segment) => segment.text));
      if (batchGeneration !== generation) {
        return;
      }
      if (!response.ok) {
        throw new Error(response.error);
      }

      batch.forEach((segment, index) => {
        insertTranslation(segment, response.translations[index] ?? "");
      });
      translatedCount += batch.length;
    } catch (error) {
      if (batchGeneration !== generation) {
        return;
      }

      failedCount += batch.length;
      batch.forEach((segment) => segment.element.setAttribute(STATE_ATTRIBUTE, "error"));
      const message = error instanceof Error && error.message ? error.message : "Translation failed.";
      toast.show(`Translation failed: ${message}`, true);
      if (/not configured/i.test(message)) {
        queue.length = 0;
        return;
      }
    } finally {
      if (batchGeneration === generation) {
        inFlight -= 1;
        flush();
        updateProgress();
      }
    }
  }

  function updateProgress(): void {
    if (toast.isError()) {
      return;
    }

    const pending = queue.length + inFlight;
    if (pending > 0) {
      toast.show(`Translating… ${translatedCount} done`);
      return;
    }

    toast.show(
      failedCount > 0
        ? `Translated ${translatedCount}, failed ${failedCount}. Run translate again to remove.`
        : "Translated visible content. Scroll to translate more; run translate again to remove."
    );
    toast.hideSoon();
  }

  return {
    isActive: () => active,
    start,
    stop
  };
}

function createSegment(element: HTMLElement): Segment | null {
  if (element.closest(SKIP_ANCESTOR_SELECTOR) || element.getClientRects().length === 0) {
    return null;
  }

  const isDiv = element.tagName === "DIV";
  let text = "";
  let before: Node | null = null;
  for (const child of element.childNodes) {
    if (child instanceof HTMLElement && isContainer(child)) {
      before = child;
      break;
    }

    if (isDiv && child instanceof HTMLElement && child.tagName === "BR") {
      before = child;
      break;
    }

    text += getNodeText(child);
  }

  // Plain divs are translated when they hold text directly or contain only inline content,
  // so wrapper divs around other blocks are left to their children.
  const hasDirectText = [...element.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
  );
  if (isDiv && before && !hasDirectText) {
    return null;
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 2 || !/\p{L}/u.test(normalized)) {
    return null;
  }

  return {
    element,
    before,
    text: normalized.slice(0, MAX_TRANSLATE_SEGMENT_LENGTH)
  };
}

function isContainer(element: HTMLElement): boolean {
  if (element.matches(CONTAINER_SELECTOR)) {
    return true;
  }

  const display = getComputedStyle(element).display;
  return display === "block" || display === "flex" || display === "grid" || display === "table";
}

function getNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (!(node instanceof Element) || node.matches(SKIP_TEXT_SELECTOR)) {
    return "";
  }
  if (node.tagName === "BR") {
    return " ";
  }

  let text = "";
  for (const child of node.childNodes) {
    text += getNodeText(child);
  }

  return text;
}

function insertTranslation(segment: Segment, translation: string): void {
  const { element, before } = segment;
  const text = translation.replace(/\s+/g, " ").trim();
  element.setAttribute(STATE_ATTRIBUTE, "done");
  if (!text || text === segment.text || !element.isConnected) {
    return;
  }

  const node = document.createElement("span");
  node.className = TRANSLATION_CLASS;
  node.textContent = text;
  if (before && before.parentNode === element) {
    element.insertBefore(node, before);
  } else {
    element.append(node);
  }
}

interface Toast {
  show(message: string, isError?: boolean): void;
  hideSoon(delay?: number): void;
  isError(): boolean;
}

function createToast(): Toast {
  let element: HTMLDivElement | null = null;
  let hideTimer = 0;
  let error = false;

  function hideSoon(delay = 2_500): void {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      element?.remove();
      element = null;
      error = false;
    }, delay);
  }

  function show(message: string, isError = false): void {
    if (!element || !element.isConnected) {
      element = document.createElement("div");
      element.className = "ecp-translate-toast";
      element.setAttribute("role", "status");
      element.setAttribute("aria-live", "polite");
      document.documentElement.append(element);
    }

    window.clearTimeout(hideTimer);
    error = isError;
    element.dataset.kind = isError ? "error" : "info";
    element.textContent = message;
    if (isError) {
      hideSoon(6_000);
    }
  }

  return { show, hideSoon, isError: () => error };
}

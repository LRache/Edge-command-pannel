import {
  createSessionId,
  MAX_TRANSLATE_BATCH_LENGTH,
  MAX_TRANSLATE_SEGMENT_LENGTH,
  MAX_TRANSLATE_SEGMENTS,
  type MessageResponse
} from "./messages";

export type TranslateRequest = (
  segments: string[],
  sessionId: string
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
// Inline code and notranslate spans stay in the sentence they belong to; only content that is
// private or not shown to the reader is dropped from a segment's text.
const SKIP_DESCENDANT_SELECTOR = `${SKIP_TEXT_SELECTOR}, textarea, input, select, option`;
const TRANSLATION_CLASS = "ecp-translation";
const OWN_NODE_SELECTOR = `.${TRANSLATION_CLASS}, .ecp-root, .ecp-translate-toast`;
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
  // One session per translation run, so every batch shares upstream routing and prompt caching.
  let sessionId = "";
  let intersectionObserver: IntersectionObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let flushTimer = 0;
  let rescanTimer = 0;
  let inFlight = 0;
  let translatedCount = 0;
  let failedCount = 0;
  const queue: Segment[] = [];
  const segments = new WeakMap<HTMLElement, Segment[]>();
  // Scanned elements whose source content changed; they are re-segmented on the next rescan.
  const dirty = new Set<HTMLElement>();
  const toast = createToast();

  function start(): void {
    if (active) {
      return;
    }

    active = true;
    generation += 1;
    sessionId = createSessionId();
    translatedCount = 0;
    failedCount = 0;
    intersectionObserver = new IntersectionObserver(handleIntersection, {
      rootMargin: "800px 0px"
    });
    mutationObserver = new MutationObserver(scheduleRescan);
    mutationObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
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
    dirty.clear();
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

      const elementSegments = createSegments(element);
      element.setAttribute(STATE_ATTRIBUTE, elementSegments.length > 0 ? "pending" : "skip");
      if (elementSegments.length === 0) {
        continue;
      }

      segments.set(element, elementSegments);
      intersectionObserver?.observe(element);
      found += 1;
    }

    return found;
  }

  function scheduleRescan(records: MutationRecord[]): void {
    let hasForeignChange = false;
    for (const record of records) {
      const target =
        record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || target.closest(OWN_NODE_SELECTOR)) {
        continue;
      }
      if (
        record.type === "childList" &&
        [...record.addedNodes, ...record.removedNodes].every(isOwnNode)
      ) {
        continue;
      }

      hasForeignChange = true;
      const owner = target.closest<HTMLElement>(`[${STATE_ATTRIBUTE}]`);
      if (owner) {
        dirty.add(owner);
      }
    }
    if (!hasForeignChange) {
      return;
    }

    window.clearTimeout(rescanTimer);
    rescanTimer = window.setTimeout(() => {
      if (!active) {
        return;
      }

      dirty.forEach((element) => {
        if (hasSourceChanged(element)) {
          invalidate(element);
        }
      });
      dirty.clear();
      scan();
    }, RESCAN_DELAY_MS);
  }

  /** Drops an element's segments and translations so the next scan reads its current content. */
  function invalidate(element: HTMLElement): void {
    intersectionObserver?.unobserve(element);
    segments.delete(element);
    element.removeAttribute(STATE_ATTRIBUTE);
    element
      .querySelectorAll(`:scope > .${TRANSLATION_CLASS}`)
      .forEach((node) => node.remove());
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index]?.element === element) {
        queue.splice(index, 1);
      }
    }
  }

  /** Re-renders that keep the same text should not cost another translation request. */
  function hasSourceChanged(element: HTMLElement): boolean {
    const previous = segments.get(element);
    if (!previous) {
      return true;
    }

    const current = createSegments(element);
    return (
      current.length !== previous.length ||
      current.some((segment, index) => segment.text !== previous[index]?.text)
    );
  }

  /** False once the segment's source text changed after it was read, so a response is stale. */
  function isCurrent(segment: Segment): boolean {
    return (
      segments.get(segment.element)?.includes(segment) === true &&
      createSegments(segment.element).some((current) => current.text === segment.text)
    );
  }

  function handleIntersection(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }

      const element = entry.target as HTMLElement;
      intersectionObserver?.unobserve(element);
      queue.push(...(segments.get(element) ?? []));
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
      const response = await translate(
        batch.map((segment) => segment.text),
        sessionId
      );
      if (batchGeneration !== generation) {
        return;
      }
      if (!response.ok) {
        throw new Error(response.error);
      }

      batch.forEach((segment, index) => {
        if (isCurrent(segment)) {
          insertTranslation(segment, response.translations[index] ?? "");
        }
      });
      translatedCount += batch.length;
    } catch (error) {
      if (batchGeneration !== generation) {
        return;
      }

      failedCount += batch.length;
      batch
        .filter(isCurrent)
        .forEach((segment) => segment.element.setAttribute(STATE_ATTRIBUTE, "error"));
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

function createSegments(element: HTMLElement): Segment[] {
  if (
    element.closest(SKIP_ANCESTOR_SELECTOR) ||
    element.isContentEditable ||
    element.getClientRects().length === 0
  ) {
    return [];
  }

  // Each line of a plain div separated by <br> is its own segment, translated right after
  // that line; text in other blocks is read up to the first nested container.
  const isDiv = element.tagName === "DIV";
  const runs: { text: string; before: Node | null }[] = [];
  let text = "";
  let stoppedAtContainer = false;
  for (const child of element.childNodes) {
    // Inserted translations are block-level, so they must not end a run when re-reading.
    if (isOwnNode(child)) {
      continue;
    }
    if (child instanceof HTMLElement && isContainer(child)) {
      runs.push({ text, before: child });
      stoppedAtContainer = true;
      break;
    }

    if (isDiv && child instanceof HTMLElement && child.tagName === "BR") {
      runs.push({ text, before: child.nextSibling });
      text = "";
      continue;
    }

    text += getNodeText(child);
  }
  if (!stoppedAtContainer) {
    runs.push({ text, before: null });
  }

  // Plain divs are translated when they hold text directly or contain only inline content,
  // so wrapper divs around other blocks are left to their children.
  const hasDirectText = [...element.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
  );
  if (isDiv && stoppedAtContainer && !hasDirectText) {
    return [];
  }

  return runs.flatMap(({ text: runText, before }) => {
    const normalized = runText.replace(/\s+/g, " ").trim();
    if (normalized.length < 2 || !/\p{L}/u.test(normalized)) {
      return [];
    }

    return [{ element, before, text: normalized.slice(0, MAX_TRANSLATE_SEGMENT_LENGTH) }];
  });
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
  if (!(node instanceof Element) || node.matches(SKIP_DESCENDANT_SELECTOR)) {
    return "";
  }
  if (node.tagName === "BR") {
    return " ";
  }
  if (isPrivateOrHidden(node)) {
    return "";
  }

  let text = "";
  for (const child of node.childNodes) {
    text += getNodeText(child);
  }

  return text;
}

function isPrivateOrHidden(element: Element): boolean {
  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }

  const style = getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse";
}

function isOwnNode(node: Node): boolean {
  return node instanceof Element && node.matches(OWN_NODE_SELECTOR);
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

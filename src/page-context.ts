import type { PageContext } from "./messages";

const MAX_PAGE_TEXT_LENGTH = 60_000;

export function extractPageContext(document: Document): PageContext {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>("main, article, [role='main']")
  ];
  const primary = candidates
    .map((element) => normalizePageText(element.innerText))
    .sort((a, b) => b.length - a.length)[0];
  const bodyText = normalizePageText(document.body?.innerText ?? "");
  const fullText = primary && primary.length >= 500 ? primary : bodyText;
  const truncated = fullText.length > MAX_PAGE_TEXT_LENGTH;

  return {
    title: document.title.slice(0, 1_000),
    url: (document.location?.href ?? "").slice(0, 4_000),
    text: truncated ? createPageExcerpt(fullText) : fullText,
    truncated
  };
}

function normalizePageText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createPageExcerpt(text: string): string {
  const separator = "\n\n[Middle of page omitted because it is too long]\n\n";
  const headLength = Math.floor((MAX_PAGE_TEXT_LENGTH - separator.length) * 0.75);
  const tailLength = MAX_PAGE_TEXT_LENGTH - separator.length - headLength;
  return `${text.slice(0, headLength)}${separator}${text.slice(-tailLength)}`;
}

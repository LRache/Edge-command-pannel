import DOMPurify from "dompurify";
import { marked } from "marked";

export function renderMarkdown(container: HTMLElement, markdown: string): void {
  const rendered = marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true
  });
  const sanitized = DOMPurify.sanitize(rendered, {
    FORBID_ATTR: ["style"],
    FORBID_TAGS: [
      "audio",
      "button",
      "embed",
      "form",
      "iframe",
      "img",
      "input",
      "math",
      "object",
      "picture",
      "select",
      "source",
      "style",
      "svg",
      "textarea",
      "track",
      "video"
    ]
  });

  container.innerHTML = sanitized;
  for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
}

interface PinyinOptions {
  toneType: "none";
  separator: string;
  nonZh: "consecutive" | "removed";
  v: boolean;
  pattern?: "first";
}

interface PinyinPro {
  pinyin(value: string, options: PinyinOptions): string;
}

declare global {
  var pinyinPro: PinyinPro;
}

const pinyinPro = globalThis.pinyinPro;

export function buildSearchText(value: unknown): string {
  const source = String(value || "");
  const original = normalizeSearchTerm(source);
  const fullPinyin = normalizeSearchTerm(
    pinyinPro.pinyin(source, {
      toneType: "none",
      separator: "",
      nonZh: "consecutive",
      v: true
    })
  );
  const spacedPinyin = normalizeSearchTerm(
    pinyinPro.pinyin(source, {
      toneType: "none",
      separator: " ",
      nonZh: "consecutive",
      v: true
    })
  );
  const initials = normalizeSearchTerm(
    pinyinPro.pinyin(source, {
      pattern: "first",
      toneType: "none",
      separator: "",
      nonZh: "removed",
      v: true
    })
  );

  return [original, fullPinyin, spacedPinyin, initials].filter(Boolean).join(" ");
}

export function normalizeSearchTerm(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase();
}

export function normalizeSearchTerms(value: unknown): string[] {
  return [...new Set(normalizeSearchTerm(value).split(/\s+/).filter(Boolean))];
}

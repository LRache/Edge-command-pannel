(() => {
  if (globalThis.EdgeCommandPanelPinyin) {
    return;
  }

  const pinyinPro = globalThis.pinyinPro;

  function buildSearchText(value) {
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

  function normalizeSearchTerm(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLocaleLowerCase();
  }

  globalThis.EdgeCommandPanelPinyin = {
    buildSearchText,
    normalizeSearchTerm
  };
})();

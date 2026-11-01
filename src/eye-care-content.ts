import {
  EYE_CARE_DOMAINS_STORAGE_KEY,
  isEyeCareEnabledForHost,
  normalizeEyeCareDomains
} from "./eye-care";

(() => {
  const STYLE_ID = "edge-command-panel-eye-care";
  // A warm multiply overlay cuts blue light without filtering the page itself, so
  // position: fixed elements and page layout are left untouched.
  const EYE_CARE_CSS = `
html::after {
  content: "" !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
  background: rgba(255, 150, 40, 0.22) !important;
  mix-blend-mode: multiply !important;
}`;

  const extensionApi =
    (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;

  void extensionApi.storage.local.get(EYE_CARE_DOMAINS_STORAGE_KEY).then((values) => {
    applyDomains(values[EYE_CARE_DOMAINS_STORAGE_KEY]);
  });

  extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName === "local" &&
      Object.prototype.hasOwnProperty.call(changes, EYE_CARE_DOMAINS_STORAGE_KEY)
    ) {
      applyDomains(changes[EYE_CARE_DOMAINS_STORAGE_KEY]?.newValue);
    }
  });

  function applyDomains(value: unknown): void {
    const enabled = isEyeCareEnabledForHost(location.hostname, normalizeEyeCareDomains(value));
    const existing = document.getElementById(STYLE_ID);
    if (!enabled) {
      existing?.remove();
      return;
    }
    if (existing) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = EYE_CARE_CSS;
    document.documentElement.append(style);
  }
})();

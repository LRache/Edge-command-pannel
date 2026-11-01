export const EYE_CARE_DOMAINS_STORAGE_KEY = "commandPanelEyeCareDomains";

const MAX_EYE_CARE_DOMAINS = 500;

/** Accepts a bare domain, a `*.domain` pattern, or a full URL and returns its lowercase host. */
export function normalizeEyeCareDomain(value: unknown): string {
  const input = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\*?\./, "");
  if (!input) {
    return "";
  }

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  try {
    const url = new URL(hasScheme ? input : `https://${input}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : "";
  } catch {
    return "";
  }
}

export function normalizeEyeCareDomains(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const domains = value.map(normalizeEyeCareDomain).filter(Boolean);
  return [...new Set(domains)].slice(0, MAX_EYE_CARE_DOMAINS);
}

/** A domain entry also covers its subdomains, so `example.com` matches `www.example.com`. */
export function isEyeCareDomainMatch(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

export function isEyeCareEnabledForHost(hostname: string, domains: readonly string[]): boolean {
  return domains.some((domain) => isEyeCareDomainMatch(hostname, domain));
}

// src/core/url.ts
// Shared URL/hostname utilities used by background message routing and
// options-page site-allowlist management.

export function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

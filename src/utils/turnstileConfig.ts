export function getTurnstileSiteKey(): string {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim();
  if (!siteKey) {
    throw new Error(
      "Missing VITE_TURNSTILE_SITE_KEY. Set it to your Cloudflare Turnstile widget site key.",
    );
  }
  return siteKey;
}

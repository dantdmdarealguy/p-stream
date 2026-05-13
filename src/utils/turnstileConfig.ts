type RuntimeConfigWindow = typeof globalThis & {
  __CONFIG__?: {
    VITE_TURNSTILE_SITE_KEY?: string;
  };
};

export function getTurnstileSiteKey(): string {
  const runtimeConfig = globalThis as RuntimeConfigWindow;
  const siteKey =
    import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ??
    runtimeConfig.__CONFIG__?.VITE_TURNSTILE_SITE_KEY?.trim();

  if (!siteKey) {
    throw new Error(
      "Missing Turnstile site key. Set VITE_TURNSTILE_SITE_KEY in build-time env or provide window.__CONFIG__.VITE_TURNSTILE_SITE_KEY at runtime.",
    );
  }

  return siteKey;
}

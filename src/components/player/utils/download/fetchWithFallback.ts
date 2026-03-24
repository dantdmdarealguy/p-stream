import { conf } from "@/setup/config";

export interface DownloadFetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

function buildProxyUrl(proxyBase: string, target: string) {
  const parsed = new URL(proxyBase);
  parsed.searchParams.set("destination", target);
  return parsed.toString();
}

function toHeaders(headers?: Record<string, string>): Headers {
  const merged = new Headers();
  if (!headers) return merged;
  Object.entries(headers).forEach(([k, v]) => {
    if (v) merged.set(k, v);
  });
  return merged;
}

export async function fetchWithCorsFallback(
  url: string,
  options: DownloadFetchOptions = {},
): Promise<Response> {
  const directHeaders = toHeaders(options.headers);

  try {
    const directResponse = await fetch(url, {
      ...options,
      headers: directHeaders,
    });

    if (directResponse.ok) {
      return directResponse;
    }

    // Retry through proxy for CORS/host restrictions or access-denied responses.
    if (directResponse.status >= 400) {
      throw new Error(`Direct fetch failed: ${directResponse.status}`);
    }

    return directResponse;
  } catch (error) {
    const proxyUrl = conf().PROXY_URLS[0];
    if (!proxyUrl) throw error;

    const proxiedUrl = buildProxyUrl(proxyUrl, url);
    const proxiedHeaders = toHeaders(options.headers);
    return fetch(proxiedUrl, {
      ...options,
      headers: proxiedHeaders,
    });
  }
}

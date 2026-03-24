/**
 * Speed testing utility.
 * Downloads the first ~512 KB of a URL and measures throughput.
 * Supports fallback to CORS proxy on failure.
 */

import { getLoadbalancedProxyUrl } from "@/backend/providers/fetchers";

export interface SpeedTestResult {
  url: string;
  speedBps: number; // bytes per second
  ttfbMs: number; // time to first byte in milliseconds
  success: boolean;
  error?: string;
}

const SPEED_TEST_BYTES = 512 * 1024; // 512 KB
const TIMEOUT_MS = 8000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Build a proxy URL using the existing CORS proxy infrastructure.
 */
function buildProxiedUrl(originalUrl: string): string | null {
  const proxyBase = getLoadbalancedProxyUrl();
  if (!proxyBase) return null;
  return `${proxyBase}/${encodeURIComponent(originalUrl)}`;
}

/**
 * Attempt to fetch up to `maxBytes` from `url`, returning throughput data.
 */
async function measureSpeed(
  url: string,
  headers: Record<string, string> = {},
): Promise<SpeedTestResult> {
  const start = performance.now();
  let ttfbMs = 0;
  let bytesReceived = 0;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          ...headers,
          Range: `bytes=0-${SPEED_TEST_BYTES - 1}`,
        },
        mode: "cors",
        cache: "no-store",
      },
      TIMEOUT_MS,
    );

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}`);
    }

    ttfbMs = performance.now() - start;

    if (response.body) {
      const reader = response.body.getReader();
      while (bytesReceived < SPEED_TEST_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesReceived += value.byteLength;
      }
      reader.cancel().catch(() => {});
    } else {
      const buf = await response.arrayBuffer();
      bytesReceived = buf.byteLength;
    }

    const elapsedSec = (performance.now() - start) / 1000;
    const speedBps = elapsedSec > 0 ? bytesReceived / elapsedSec : 0;

    return { url, speedBps, ttfbMs, success: true };
  } catch (err: any) {
    return {
      url,
      speedBps: 0,
      ttfbMs: 0,
      success: false,
      error: err?.message ?? "unknown error",
    };
  }
}

/**
 * Speed-test a URL, falling back to the CORS proxy if the direct fetch fails.
 */
export async function speedTestUrl(
  url: string,
  headers: Record<string, string> = {},
): Promise<SpeedTestResult> {
  const direct = await measureSpeed(url, headers);
  if (direct.success) return direct;

  const proxiedUrl = buildProxiedUrl(url);
  if (!proxiedUrl) return direct;

  const proxied = await measureSpeed(proxiedUrl, {});
  return proxied.success ? { ...proxied, url } : direct;
}

/**
 * Run speed tests on multiple URLs concurrently and return results sorted
 * fastest-first.
 */
export async function rankBySpeed(
  urls: Array<{ url: string; headers?: Record<string, string> }>,
): Promise<Array<SpeedTestResult & { originalUrl: string }>> {
  const results = await Promise.all(
    urls.map(async ({ url, headers }) => {
      const result = await speedTestUrl(url, headers);
      return { ...result, originalUrl: url };
    }),
  );

  return results.sort((a, b) => b.speedBps - a.speedBps);
}

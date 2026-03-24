/**
 * Core download engine.
 *
 * Supports:
 *  - Direct MP4/file downloads streamed to disk via File System Access API
 *    (showSaveFilePicker), with a memory-safe ReadableStream pipe.
 *  - HLS / M3U8 downloads: parses the playlist, fetches .ts segments
 *    sequentially, and concatenates them into a single .ts file on disk.
 *  - Automatic CORS proxy fallback when direct fetch fails.
 *  - Progress reporting: bytes written, current speed (B/s), ETA.
 */

import { getLoadbalancedProxyUrl } from "@/backend/providers/fetchers";
import {
  ParsedM3U8Media,
  parseM3U8,
  parseMasterPlaylist,
} from "@/utils/download/m3u8Parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DownloadType = "mp4" | "hls";

export interface DownloadProgressEvent {
  bytesWritten: number;
  totalBytes: number | null; // null when unknown (HLS)
  percentage: number | null;
  speedBps: number;
  etaSeconds: number | null;
  segmentsDone?: number;
  segmentsTotal?: number;
}

export interface DownloadOptions {
  url: string;
  filename: string;
  type: DownloadType;
  headers?: Record<string, string>;
  onProgress?: (event: DownloadProgressEvent) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProxiedUrl(originalUrl: string): string | null {
  const proxyBase = getLoadbalancedProxyUrl();
  if (!proxyBase) return null;
  return `${proxyBase}/${encodeURIComponent(originalUrl)}`;
}

async function fetchWithFallback(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  // Try direct first
  try {
    const res = await fetch(url, { ...init, mode: "cors" });
    if (res.ok || res.status === 206) return res;
    // non-ok but fetched — still return for caller to handle
    return res;
  } catch {
    // CORS or network error — try proxy
    const proxied = buildProxiedUrl(url);
    if (!proxied)
      throw new Error(`Failed to fetch ${url} and no proxy available`);
    const res = await fetch(proxied, { ...init, mode: "cors" });
    if (res.ok || res.status === 206) return res;
    throw new Error(`Proxy fetch failed with status ${res.status}`);
  }
}

// Speed smoothing window (last N samples)
class SpeedTracker {
  private samples: Array<{ bytes: number; time: number }> = [];

  private readonly windowMs = 3000;

  record(bytes: number) {
    const now = performance.now();
    this.samples.push({ bytes, time: now });
    // Prune old samples
    const cutoff = now - this.windowMs;
    this.samples = this.samples.filter((s) => s.time >= cutoff);
  }

  get speedBps(): number {
    if (this.samples.length < 2) return 0;
    const oldest = this.samples[0];
    const newest = this.samples[this.samples.length - 1];
    const elapsed = (newest.time - oldest.time) / 1000;
    const bytes = this.samples.slice(1).reduce((a, s) => a + s.bytes, 0);
    return elapsed > 0 ? bytes / elapsed : 0;
  }
}

// ---------------------------------------------------------------------------
// File System Access API helpers
// ---------------------------------------------------------------------------

type FSWritableStream = {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
};

async function openSaveFile(
  suggestedName: string,
): Promise<FSWritableStream | null> {
  if (!("showSaveFilePicker" in window)) return null;
  try {
    const ext = suggestedName.split(".").pop() ?? "ts";
    const handle = await (window as any).showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: "Video file",
          accept: { "video/*": [`.${ext}`] },
        },
      ],
    });
    const writable = await handle.createWritable();
    return {
      async write(data: Uint8Array) {
        await writable.write(data);
      },
      async close() {
        await writable.close();
      },
    };
  } catch (err: any) {
    // User cancelled or API unavailable
    if (err?.name === "AbortError") throw err;
    return null;
  }
}

/**
 * Fallback: collect all chunks in memory, then trigger a <a download> click.
 * Only suitable for smaller files (< ~500 MB).
 */
function makeMemoryWriter() {
  const chunks: Uint8Array[] = [];
  return {
    chunks,
    async write(data: Uint8Array) {
      chunks.push(data);
    },
    async flush(filename: string) {
      const blob = new Blob(chunks as BlobPart[], { type: "video/mp2t" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
  };
}

// ---------------------------------------------------------------------------
// MP4 / direct file download
// ---------------------------------------------------------------------------

async function downloadDirectFile(opts: DownloadOptions): Promise<void> {
  const { url, filename, headers = {}, onProgress, signal } = opts;
  const response = await fetchWithFallback(url, { headers, signal });
  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : null;

  const tracker = new SpeedTracker();
  let bytesWritten = 0;
  const startTime = performance.now();

  const writer = await openSaveFile(filename);
  const memWriter = writer ? null : makeMemoryWriter();

  const destination = writer ?? memWriter!;

  if (!response.body) throw new Error("No response body");
  const reader = response.body.getReader();

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      await destination.write(value);
      bytesWritten += value.byteLength;
      tracker.record(value.byteLength);
      const speedBps = tracker.speedBps;
      const percentage = totalBytes ? (bytesWritten / totalBytes) * 100 : null;
      const remainingBytes = totalBytes ? totalBytes - bytesWritten : null;
      const etaSeconds =
        remainingBytes !== null && speedBps > 0
          ? remainingBytes / speedBps
          : null;
      onProgress?.({
        bytesWritten,
        totalBytes,
        percentage,
        speedBps,
        etaSeconds,
      });
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  if (memWriter) {
    await memWriter.flush(filename);
  } else {
    await writer!.close();
  }

  // Final progress update
  const elapsed = (performance.now() - startTime) / 1000;
  onProgress?.({
    bytesWritten,
    totalBytes: bytesWritten,
    percentage: 100,
    speedBps: elapsed > 0 ? bytesWritten / elapsed : 0,
    etaSeconds: 0,
  });
}

// ---------------------------------------------------------------------------
// HLS / M3U8 download
// ---------------------------------------------------------------------------

async function fetchM3U8Text(
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  const res = await fetchWithFallback(url, { headers });
  if (!res.ok) throw new Error(`M3U8 fetch failed: ${res.status}`);
  return res.text();
}

async function downloadHLS(opts: DownloadOptions): Promise<void> {
  const { url, filename, headers = {}, onProgress, signal } = opts;

  // Step 1: fetch and parse the M3U8
  const m3u8Text = await fetchM3U8Text(url, headers);
  const parsed = parseM3U8(m3u8Text, url);

  let mediaPlaylist: ParsedM3U8Media;

  if (parsed.type === "master") {
    // Pick the highest bandwidth variant (user has already selected resolution)
    const sorted = [...parsed.variants].sort(
      (a, b) => b.bandwidth - a.bandwidth,
    );
    const best = sorted[0];
    if (!best) throw new Error("No variants found in master playlist");
    const mediaText = await fetchM3U8Text(best.url, headers);
    const mediaParsed = parseM3U8(mediaText, best.url);
    if (mediaParsed.type !== "media")
      throw new Error("Expected media playlist");
    mediaPlaylist = mediaParsed;
  } else {
    mediaPlaylist = parsed;
  }

  const { segments } = mediaPlaylist;
  if (segments.length === 0) throw new Error("No segments found in playlist");

  const writer = await openSaveFile(filename);
  const memWriter = writer ? null : makeMemoryWriter();
  const destination = writer ?? memWriter!;

  const tracker = new SpeedTracker();
  let bytesWritten = 0;
  const startTime = performance.now();

  for (let i = 0; i < segments.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const seg = segments[i];
    const segRes = await fetchWithFallback(seg.url, { headers, signal });
    if (!segRes.ok) throw new Error(`Segment fetch failed: ${segRes.status}`);

    if (segRes.body) {
      const reader = segRes.body.getReader();
      try {
        while (true) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          const { done, value } = await reader.read();
          if (done) break;
          await destination.write(value);
          bytesWritten += value.byteLength;
          tracker.record(value.byteLength);
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    } else {
      const buf = await segRes.arrayBuffer();
      const data = new Uint8Array(buf);
      await destination.write(data);
      bytesWritten += data.byteLength;
      tracker.record(data.byteLength);
    }

    const segsDone = i + 1;
    const speedBps = tracker.speedBps;
    const segmentsRemaining = segments.length - segsDone;
    const avgBytesPerSeg = segsDone > 0 ? bytesWritten / segsDone : 0;
    const remainingBytes = segmentsRemaining * avgBytesPerSeg;
    const etaSeconds = speedBps > 0 ? remainingBytes / speedBps : null;
    const percentage = (segsDone / segments.length) * 100;

    onProgress?.({
      bytesWritten,
      totalBytes: null,
      percentage,
      speedBps,
      etaSeconds,
      segmentsDone: segsDone,
      segmentsTotal: segments.length,
    });
  }

  if (memWriter) {
    await memWriter.flush(filename);
  } else {
    await writer!.close();
  }

  const elapsed = (performance.now() - startTime) / 1000;
  onProgress?.({
    bytesWritten,
    totalBytes: bytesWritten,
    percentage: 100,
    speedBps: elapsed > 0 ? bytesWritten / elapsed : 0,
    etaSeconds: 0,
    segmentsDone: segments.length,
    segmentsTotal: segments.length,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a download. Returns a promise that resolves when the download is complete.
 * Progress updates are delivered via `opts.onProgress`.
 *
 * Pass an AbortSignal via `opts.signal` to support cancellation.
 */
export async function startDownload(opts: DownloadOptions): Promise<void> {
  if (opts.type === "hls") {
    return downloadHLS(opts);
  }
  return downloadDirectFile(opts);
}

/**
 * Resolve the actual media playlist URL for an HLS stream.
 * If the URL is a master playlist, this picks the variant closest to the
 * requested height (e.g. 1080 for "1080p").
 */
export async function resolveHLSVariant(
  masterUrl: string,
  targetHeight: number,
  headers: Record<string, string> = {},
): Promise<string> {
  const text = await fetchM3U8Text(masterUrl, headers);
  const parsed = parseM3U8(text, masterUrl);
  if (parsed.type === "media") return masterUrl;

  const variants = [...parsed.variants].sort((a, b) => {
    const ha = a.resolution
      ? parseInt(a.resolution.split("x")[1] ?? "0", 10)
      : 0;
    const hb = b.resolution
      ? parseInt(b.resolution.split("x")[1] ?? "0", 10)
      : 0;
    return Math.abs(ha - targetHeight) - Math.abs(hb - targetHeight);
  });

  return variants[0]?.url ?? masterUrl;
}

/**
 * Resolve variants from a master M3U8 playlist, returning available options.
 */
export async function getHLSVariants(
  masterUrl: string,
  headers: Record<string, string> = {},
) {
  const text = await fetchM3U8Text(masterUrl, headers);
  const parsed = parseM3U8(text, masterUrl);
  if (parsed.type === "media") return null; // already a media playlist
  return parsed.variants;
}

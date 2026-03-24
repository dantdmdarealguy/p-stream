import {
  SourceQuality,
  SourceSliceSource,
  qualityToString,
} from "@/stores/player/utils/qualities";

import { fetchWithCorsFallback } from "./fetchWithFallback";
import { parseM3U8 } from "./m3u8";
import { DownloadCandidate, ProbeResult, ResolutionOption } from "./types";

const QUALITY_ORDER: SourceQuality[] = [
  "4k",
  "1080",
  "720",
  "480",
  "360",
  "unknown",
];

async function probeCandidate(
  candidate: DownloadCandidate,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const start = performance.now();
  const response = await fetchWithCorsFallback(candidate.url, {
    method: "GET",
    headers: {
      ...candidate.headers,
      Range: "bytes=0-1048575",
    },
    signal,
  });

  const ttfbMs = performance.now() - start;

  if (!response.body) {
    return {
      ttfbMs,
      bytesPerSecond: 0,
    };
  }

  const reader = response.body.getReader();
  let totalRead = 0;
  let finished = false;
  while (!finished && totalRead < 1024 * 1024) {
    const { done, value } = await reader.read();
    if (done) {
      finished = true;
      break;
    }

    totalRead += value.byteLength;
  }

  reader.cancel().catch(() => {});

  const elapsedSeconds = Math.max((performance.now() - start) / 1000, 0.001);
  return {
    ttfbMs,
    bytesPerSecond: totalRead / elapsedSeconds,
  };
}

function sourceHeaders(source: SourceSliceSource) {
  return {
    ...(source.headers ?? {}),
    ...(source.preferredHeaders ?? {}),
  };
}

async function hlsCandidates(
  source: SourceSliceSource,
): Promise<DownloadCandidate[]> {
  if (source.type !== "hls") return [];

  const response = await fetchWithCorsFallback(source.url, {
    headers: sourceHeaders(source),
  });
  const content = await response.text();
  const parsed = parseM3U8(content, source.url);

  if (parsed.type === "master") {
    return parsed.variants.map((variant) => ({
      id: `${variant.resolution}:${variant.url}`,
      url: variant.url,
      resolution: variant.resolution,
      protocol: "hls",
      headers: sourceHeaders(source),
    }));
  }

  return [
    {
      id: `unknown:${source.url}`,
      url: source.url,
      resolution: "unknown",
      protocol: "hls",
      headers: sourceHeaders(source),
    },
  ];
}

function fileCandidates(source: SourceSliceSource): DownloadCandidate[] {
  if (source.type !== "file") return [];

  return Object.entries(source.qualities)
    .filter(([, value]) => Boolean(value?.url))
    .map(([quality, value]) => ({
      id: `${quality}:${value?.url}`,
      url: value!.url,
      resolution: quality as SourceQuality,
      protocol: "file",
      headers: sourceHeaders(source),
    }));
}

export async function evaluateDownloadSources(
  source: SourceSliceSource,
  signal?: AbortSignal,
): Promise<ResolutionOption[]> {
  const candidates =
    source.type === "hls"
      ? await hlsCandidates(source)
      : fileCandidates(source);

  const grouped: Record<SourceQuality, DownloadCandidate[]> = {
    "4k": [],
    "1080": [],
    "720": [],
    "480": [],
    "360": [],
    unknown: [],
  };

  candidates.forEach((candidate) => {
    grouped[candidate.resolution].push(candidate);
  });

  const ranked: ResolutionOption[] = [];

  for (const resolution of QUALITY_ORDER) {
    const list = grouped[resolution];
    if (list.length === 0) continue;

    let bestCandidate = list[0];
    let bestScore = 0;

    // Probe each stream in the same quality tier and keep the fastest.
    for (const candidate of list) {
      const probe = await probeCandidate(candidate, signal);
      if (probe.bytesPerSecond > bestScore) {
        bestScore = probe.bytesPerSecond;
        bestCandidate = candidate;
      }
    }

    ranked.push({
      resolution,
      label: qualityToString(resolution),
      bestCandidateId: bestCandidate.id,
      speedScore: bestScore,
      candidates: list,
    });
  }

  return ranked;
}

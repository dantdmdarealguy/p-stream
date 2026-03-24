import { SourceQuality } from "@/stores/player/utils/qualities";

import { HlsVariant, ParsedM3U8 } from "./types";

function resolveUrl(baseUrl: string, maybeRelative: string): string {
  return new URL(maybeRelative, baseUrl).toString();
}

function normalizeQuality(value?: string): SourceQuality {
  if (!value) return "unknown";
  if (value.includes("3840") || value.includes("2160")) return "4k";
  if (value.includes("1920") || value.includes("1080")) return "1080";
  if (value.includes("1280") || value.includes("720")) return "720";
  if (value.includes("854") || value.includes("480")) return "480";
  if (value.includes("640") || value.includes("360")) return "360";
  return "unknown";
}

function parseResolution(tagLine: string): SourceQuality {
  const match = tagLine.match(/RESOLUTION=(\d+x\d+)/i);
  if (!match?.[1]) return "unknown";
  return normalizeQuality(match[1]);
}

export function parseM3U8(content: string, baseUrl: string): ParsedM3U8 {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const variants: HlsVariant[] = [];
  const segments: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      const nextLine = lines[i + 1];
      if (nextLine && !nextLine.startsWith("#")) {
        variants.push({
          url: resolveUrl(baseUrl, nextLine),
          resolution: parseResolution(line),
        });
        i += 1;
      }
      continue;
    }

    if (!line.startsWith("#")) {
      segments.push(resolveUrl(baseUrl, line));
    }
  }

  if (variants.length > 0) {
    return {
      type: "master",
      variants,
      segments: [],
    };
  }

  return {
    type: "media",
    variants: [],
    segments,
  };
}

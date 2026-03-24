/**
 * Lightweight M3U8 parser for extracting segment URLs and resolution metadata.
 * Handles both master playlists and media playlists.
 */

export interface M3U8Variant {
  url: string;
  bandwidth: number;
  resolution?: string; // e.g. "1920x1080"
  codecs?: string;
}

export interface M3U8Segment {
  url: string;
  duration: number;
}

export interface ParsedM3U8Media {
  type: "media";
  segments: M3U8Segment[];
  totalDuration: number;
  isEndList: boolean;
}

export interface ParsedM3U8Master {
  type: "master";
  variants: M3U8Variant[];
}

export type ParsedM3U8 = ParsedM3U8Media | ParsedM3U8Master;

function isMasterPlaylist(content: string): boolean {
  return content.includes("#EXT-X-STREAM-INF");
}

function resolveUrl(base: string, relative: string): string {
  if (relative.startsWith("http://") || relative.startsWith("https://")) {
    return relative;
  }
  try {
    const baseUrl = new URL(base);
    if (relative.startsWith("/")) {
      return `${baseUrl.origin}${relative}`;
    }
    const basePath = baseUrl.pathname.substring(
      0,
      baseUrl.pathname.lastIndexOf("/") + 1,
    );
    return `${baseUrl.origin}${basePath}${relative}`;
  } catch {
    return relative;
  }
}

export function parseMasterPlaylist(
  content: string,
  baseUrl: string,
): M3U8Variant[] {
  const lines = content.split("\n").map((l) => l.trim());
  const variants: M3U8Variant[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const attrs = line.substring("#EXT-X-STREAM-INF:".length);
      const bandwidthMatch = attrs.match(/BANDWIDTH=(\d+)/);
      const resolutionMatch = attrs.match(/RESOLUTION=([\dx]+)/i);
      const codecsMatch = attrs.match(/CODECS="([^"]+)"/);

      const nextLine = lines[i + 1];
      if (nextLine && !nextLine.startsWith("#")) {
        variants.push({
          url: resolveUrl(baseUrl, nextLine),
          bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0,
          resolution: resolutionMatch ? resolutionMatch[1] : undefined,
          codecs: codecsMatch ? codecsMatch[1] : undefined,
        });
        i += 1;
      }
    }
  }

  return variants;
}

export function parseMediaPlaylist(
  content: string,
  baseUrl: string,
): ParsedM3U8Media {
  const lines = content.split("\n").map((l) => l.trim());
  const segments: M3U8Segment[] = [];
  let currentDuration = 0;
  let totalDuration = 0;
  let isEndList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("#EXTINF:")) {
      const durationStr = line.substring("#EXTINF:".length).split(",")[0];
      currentDuration = parseFloat(durationStr) || 0;
    } else if (line.startsWith("#EXT-X-ENDLIST")) {
      isEndList = true;
    } else if (
      line.length > 0 &&
      !line.startsWith("#") &&
      currentDuration > 0
    ) {
      segments.push({
        url: resolveUrl(baseUrl, line),
        duration: currentDuration,
      });
      totalDuration += currentDuration;
      currentDuration = 0;
    }
  }

  return { type: "media", segments, totalDuration, isEndList };
}

export function parseM3U8(content: string, baseUrl: string): ParsedM3U8 {
  if (isMasterPlaylist(content)) {
    return {
      type: "master",
      variants: parseMasterPlaylist(content, baseUrl),
    };
  }
  return parseMediaPlaylist(content, baseUrl);
}

/**
 * Map M3U8 resolution string (e.g. "1920x1080") to a quality label like "1080p".
 */
export function resolutionToQualityLabel(resolution: string): string {
  const parts = resolution.split("x");
  const height = parts[1] ?? parts[0];
  if (!height) return "Unknown";
  const h = parseInt(height, 10);
  if (h >= 2160) return "4K";
  if (h >= 1080) return "1080p";
  if (h >= 720) return "720p";
  if (h >= 480) return "480p";
  if (h >= 360) return "360p";
  return `${h}p`;
}

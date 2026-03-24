/**
 * Standalone episode scraping utility for the download system.
 * Uses the same providers infrastructure as the player, but outside of
 * the player store context.
 */

import { ScrapeMedia } from "@p-stream/providers";

import { getProviders } from "@/backend/providers/providers";
import { DownloadSource } from "@/components/overlays/DownloadModal";
import { convertRunoutputToSource } from "@/components/player/utils/convertRunoutputToSource";
import {
  SourceSliceSource,
  qualityToString,
} from "@/stores/player/utils/qualities";

export interface EpisodeScrapeMeta {
  showTmdbId: string;
  showTitle: string;
  releaseYear: number;
  imdbId?: string;
  seasonNumber: number;
  seasonTmdbId: string;
  seasonTitle: string;
  episodeNumber: number;
  episodeTmdbId: string;
  episodeTitle: string;
}

function sourceToDownloadSources(source: SourceSliceSource): DownloadSource[] {
  const headers = {
    ...(source.headers ?? {}),
    ...(source.preferredHeaders ?? {}),
  };

  if (source.type === "hls") {
    return [{ qualityLabel: "Auto", url: source.url, type: "hls", headers }];
  }
  if (source.type === "file") {
    return Object.entries(source.qualities)
      .filter(([, q]) => !!q?.url)
      .map(([quality, q]) => ({
        qualityLabel: qualityToString(quality as any),
        url: q!.url,
        type: "mp4" as const,
        headers,
      }));
  }
  return [];
}

/**
 * Scrape available download sources for a single episode.
 * Returns an array of DownloadSource options, empty if nothing found.
 */
export async function scrapeEpisodeSources(
  meta: EpisodeScrapeMeta,
): Promise<DownloadSource[]> {
  const scrapeMedia: ScrapeMedia = {
    type: "show",
    title: meta.showTitle,
    releaseYear: meta.releaseYear,
    tmdbId: meta.showTmdbId,
    imdbId: meta.imdbId,
    season: {
      number: meta.seasonNumber,
      tmdbId: meta.seasonTmdbId,
      title: meta.seasonTitle,
    },
    episode: {
      number: meta.episodeNumber,
      tmdbId: meta.episodeTmdbId,
    },
  };

  const providers = getProviders();

  const result = await providers.runAll({
    media: scrapeMedia,
  });

  if (!result?.stream) return [];

  const source = convertRunoutputToSource({ stream: result.stream });
  return sourceToDownloadSources(source);
}

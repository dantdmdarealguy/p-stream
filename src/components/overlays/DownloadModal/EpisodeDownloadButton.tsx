/**
 * EpisodeDownloadButton
 *
 * Renders a small download icon button for an episode card.
 * On click: scrapes sources for the episode, then opens a DownloadModal.
 *
 * Also provides EpisodeSeasonDownloadButton for bulk season downloads.
 */

import classNames from "classnames";
import { useCallback, useId, useState } from "react";

import { Icon, Icons } from "@/components/Icon";
import { DownloadModal, DownloadSource } from "@/components/overlays/DownloadModal";
import { useModal } from "@/components/overlays/Modal";
import { useDownloadStore } from "@/stores/downloads";
import {
  EpisodeScrapeMeta,
  scrapeEpisodeSources,
} from "@/utils/download/episodeScraper";

// ---------------------------------------------------------------------------
// Single episode download button
// ---------------------------------------------------------------------------

interface EpisodeDownloadButtonProps {
  /** Episode-level scraping metadata */
  scrapeMeta: EpisodeScrapeMeta;
  /** Label shown as title in modal and filename, e.g. "Show S1E3 - Title" */
  label: string;
  className?: string;
  /** Stop click from propagating to the parent episode link */
  stopPropagation?: boolean;
}

type ScrapeState = "idle" | "loading" | "ready" | "error";

export function EpisodeDownloadButton({
  scrapeMeta,
  label,
  className,
  stopPropagation = true,
}: EpisodeDownloadButtonProps) {
  // Use a stable, unique id per button instance
  const uid = useId().replace(/:/g, "");
  const modalId = `ep-dl-${uid}`;

  const modal = useModal(modalId);
  const [scrapeState, setScrapeState] = useState<ScrapeState>("idle");
  const [sources, setSources] = useState<DownloadSource[]>([]);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      if (stopPropagation) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (scrapeState === "ready") {
        modal.show();
        return;
      }

      setScrapeState("loading");
      try {
        const found = await scrapeEpisodeSources(scrapeMeta);
        setSources(found);
        setScrapeState("ready");
        modal.show();
      } catch {
        setScrapeState("error");
        setTimeout(() => setScrapeState("idle"), 3000);
      }
    },
    [scrapeState, scrapeMeta, modal, stopPropagation],
  );

  const icon =
    scrapeState === "loading"
      ? Icons.ELLIPSIS
      : scrapeState === "error"
        ? Icons.X
        : Icons.DOWNLOAD;

  return (
    <>
      <DownloadModal id={modalId} sources={sources} title={label} />
      <button
        type="button"
        onClick={handleClick}
        className={classNames(
          "p-1.5 bg-black/50 rounded-full hover:bg-black/80 transition-colors",
          scrapeState === "loading" && "animate-pulse",
          scrapeState === "error" && "text-red-400",
          className,
        )}
        title={
          scrapeState === "loading"
            ? "Finding sources…"
            : scrapeState === "error"
              ? "Failed to find sources"
              : "Download episode"
        }
      >
        <Icon icon={icon} className="h-4 w-4 text-white/80" />
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Season bulk download button
// ---------------------------------------------------------------------------

interface SeasonEpisode {
  id: number;
  name: string;
  episode_number: number;
  season_number: number;
}

interface SeasonDownloadButtonProps {
  episodes: SeasonEpisode[];
  showTitle: string;
  showTmdbId: string;
  releaseYear: number;
  imdbId?: string;
  seasonNumber: number;
  seasonTmdbId: string;
  seasonTitle: string;
  className?: string;
}

type BulkState = "idle" | "scraping" | "done" | "error";

export function SeasonDownloadButton({
  episodes,
  showTitle,
  showTmdbId,
  releaseYear,
  imdbId,
  seasonNumber,
  seasonTmdbId,
  seasonTitle,
  className,
}: SeasonDownloadButtonProps) {
  const enqueue = useDownloadStore((s) => s.enqueue);
  const [bulkState, setBulkState] = useState<BulkState>("idle");
  const [progress, setProgress] = useState(0);

  const handleDownloadSeason = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (bulkState !== "idle") return;

      setBulkState("scraping");
      setProgress(0);

      let queued = 0;
      for (let i = 0; i < episodes.length; i++) {
        const ep = episodes[i];
        try {
          const sources = await scrapeEpisodeSources({
            showTmdbId,
            showTitle,
            releaseYear,
            imdbId,
            seasonNumber,
            seasonTmdbId,
            seasonTitle,
            episodeNumber: ep.episode_number,
            episodeTmdbId: ep.id.toString(),
            episodeTitle: ep.name,
          });

          if (sources.length > 0) {
            // Pick the best quality source (first = highest priority after speed ranking)
            const best = sources[0];
            const label = `${showTitle} S${seasonNumber
              .toString()
              .padStart(2, "0")}E${ep.episode_number.toString().padStart(2, "0")} - ${ep.name}`;
            const ext = best.type === "hls" ? "ts" : "mp4";
            enqueue({
              title: label,
              filename: `${label.replace(/[^a-zA-Z0-9 ._-]/g, "")}.${ext}`,
              url: best.url,
              type: best.type,
              headers: best.headers ?? {},
              qualityLabel: best.qualityLabel,
            });
            queued++;
          }
        } catch {
          // Skip failed episodes
        }
        setProgress(Math.round(((i + 1) / episodes.length) * 100));
      }

      setBulkState(queued > 0 ? "done" : "error");
      setTimeout(() => {
        setBulkState("idle");
        setProgress(0);
      }, 3000);
    },
    [
      bulkState,
      episodes,
      showTitle,
      showTmdbId,
      releaseYear,
      imdbId,
      seasonNumber,
      seasonTmdbId,
      seasonTitle,
      enqueue,
    ],
  );

  const label =
    bulkState === "scraping"
      ? `Finding sources… ${progress}%`
      : bulkState === "done"
        ? "Queued!"
        : bulkState === "error"
          ? "No sources found"
          : "Download Season";

  return (
    <button
      type="button"
      onClick={handleDownloadSeason}
      disabled={bulkState === "scraping"}
      className={classNames(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
        "bg-denim-800 hover:bg-denim-700 text-white",
        bulkState === "scraping" && "opacity-70 cursor-wait",
        bulkState === "done" && "bg-green-700",
        bulkState === "error" && "bg-red-800",
        className,
      )}
    >
      <Icon
        icon={Icons.DOWNLOAD}
        className={classNames(
          "text-base",
          bulkState === "scraping" && "animate-pulse",
        )}
      />
      {label}
    </button>
  );
}

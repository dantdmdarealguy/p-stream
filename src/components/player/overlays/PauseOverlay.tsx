import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  getEpisodeDetails,
  getMediaDetails,
  getMediaLogo,
} from "@/backend/metadata/tmdb";
import { TMDBContentTypes } from "@/backend/metadata/types/tmdb";
import { Icon, Icons } from "@/components/Icon";
import { useShouldShowControls } from "@/components/player/hooks/useShouldShowControls";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLastNonPlayerLink } from "@/stores/history";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";
import { durationExceedsHour, formatSeconds } from "@/utils/formatSeconds";

/** How long (ms) after pause before showing the overlay. */
const SHOW_OVERLAY_DELAY_MS = 2000;
/** How long (ms) after pause before showing the "Are you still watching?" prompt. */
const STILL_WATCHING_DELAY_MS = 3 * 60 * 1000;

interface PauseDetails {
  voteAverage: number | null;
  genres: string[];
  runtime: number | null;
}

export function PauseOverlay() {
  const isPaused = usePlayerStore((s) => s.mediaPlaying.isPaused);
  const status = usePlayerStore((s) => s.status);
  const meta = usePlayerStore((s) => s.meta);
  const { duration, time } = usePlayerStore((s) => s.progress);
  const display = usePlayerStore((s) => s.display);
  const enablePauseOverlay = usePreferencesStore((s) => s.enablePauseOverlay);
  const enableImageLogos = usePreferencesStore((s) => s.enableImageLogos);
  const { isMobile } = useIsMobile();
  const { showTargets } = useShouldShowControls();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const backUrl = useLastNonPlayerLink();

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [details, setDetails] = useState<PauseDetails>({
    voteAverage: null,
    genres: [],
    runtime: null,
  });

  // Track whether playback has actually started at least once
  // so the overlay never appears during source scraping / initial load
  const hasPlayedRef = useRef(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [stillWatchingVisible, setStillWatchingVisible] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stillWatchingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Mark that real playback has started only when the player is actively playing
  useEffect(() => {
    if (!isPaused && status === playerStatus.PLAYING) {
      hasPlayedRef.current = true;
    }
  }, [isPaused, status]);

  useEffect(() => {
    if (isPaused && hasPlayedRef.current && status === playerStatus.PLAYING) {
      // Show the pause overlay after a short delay
      timerRef.current = setTimeout(() => {
        setOverlayVisible(true);
      }, SHOW_OVERLAY_DELAY_MS);

      // Show "Are you still watching?" after a longer delay
      stillWatchingTimerRef.current = setTimeout(() => {
        setStillWatchingVisible(true);
      }, STILL_WATCHING_DELAY_MS);
    } else {
      // Clear overlay when unpaused
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (stillWatchingTimerRef.current) {
        clearTimeout(stillWatchingTimerRef.current);
        stillWatchingTimerRef.current = null;
      }
      setOverlayVisible(false);
      setStillWatchingVisible(false);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (stillWatchingTimerRef.current) {
        clearTimeout(stillWatchingTimerRef.current);
        stillWatchingTimerRef.current = null;
      }
    };
  }, [isPaused, status]);

  let shouldShow = overlayVisible && enablePauseOverlay;
  if (isMobile && status === playerStatus.SCRAPING) shouldShow = false;
  if (isMobile && showTargets) shouldShow = false;

  // Fetch logo
  useEffect(() => {
    let mounted = true;
    const fetchLogo = async () => {
      if (!meta?.tmdbId || !enableImageLogos) {
        setLogoUrl(null);
        return;
      }

      try {
        const type =
          meta.type === "movie" ? TMDBContentTypes.MOVIE : TMDBContentTypes.TV;
        const url = await getMediaLogo(meta.tmdbId, type);
        if (mounted) setLogoUrl(url || null);
      } catch {
        if (mounted) setLogoUrl(null);
      }
    };

    fetchLogo();
    return () => {
      mounted = false;
    };
  }, [meta?.tmdbId, meta?.type, enableImageLogos]);

  // Fetch rating / runtime details
  useEffect(() => {
    let mounted = true;
    const fetchDetails = async () => {
      if (!meta?.tmdbId) {
        setDetails({ voteAverage: null, genres: [], runtime: null });
        return;
      }
      try {
        const type =
          meta.type === "movie" ? TMDBContentTypes.MOVIE : TMDBContentTypes.TV;

        const isShowWithEpisode =
          meta.type === "show" && meta.season && meta.episode;
        let voteAverage: number | null = null;

        if (isShowWithEpisode) {
          const episodeData = await getEpisodeDetails(
            meta.tmdbId,
            meta.season?.number ?? 0,
            meta.episode?.number ?? 0,
          );
          if (mounted && episodeData?.vote_average != null) {
            voteAverage = episodeData.vote_average;
          }
        }

        const data = await getMediaDetails(meta.tmdbId, type, false);
        if (mounted && data) {
          const genres = (data.genres ?? []).map(
            (g: { name: string }) => g.name,
          );
          const finalVoteAverage = isShowWithEpisode
            ? voteAverage
            : typeof data.vote_average === "number"
              ? data.vote_average
              : null;

          let runtime: number | null = null;
          if (isShowWithEpisode) {
            const epData = await getEpisodeDetails(
              meta.tmdbId,
              meta.season?.number ?? 0,
              meta.episode?.number ?? 0,
            );
            runtime = (epData as any)?.runtime ?? null;
          } else {
            runtime = (data as any)?.runtime ?? null;
          }

          setDetails({ voteAverage: finalVoteAverage, genres, runtime });
        }
      } catch {
        if (mounted)
          setDetails({ voteAverage: null, genres: [], runtime: null });
      }
    };

    fetchDetails();
    return () => {
      mounted = false;
    };
  }, [meta?.tmdbId, meta?.type, meta?.season, meta?.episode]);

  if (!meta) return null;

  const overview =
    meta.type === "show" ? meta.episode?.overview : meta.overview;

  const formatRuntime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const progressPct =
    duration > 0 ? Math.max(0, Math.min(1, time / duration)) * 100 : 0;
  const showHours = durationExceedsHour(duration);
  const formattedTime = formatSeconds(time, showHours);
  const formattedDuration = formatSeconds(duration, showHours);

  const handleResume = () => {
    display?.play();
    setStillWatchingVisible(false);
  };

  const handleSkipBackward = () => {
    display?.setTime(Math.max(0, time - 10));
  };

  const handleSkipForward = () => {
    display?.setTime(Math.min(duration, time + 10));
  };

  const handleGoBack = () => {
    navigate(backUrl);
  };

  return (
    <>
      {/* "Are you still watching?" prompt – shown after 3 minutes of pause.
          Rendered OUTSIDE the opacity container so it never becomes an invisible
          click trap when shouldShow is false (e.g. mobile controls visible). */}
      {stillWatchingVisible && (
        <div className="absolute inset-0 z-[61] flex items-center justify-center pointer-events-auto bg-black/60 backdrop-blur-sm">
          <div className="bg-video-context-background border border-white/10 rounded-2xl p-8 max-w-sm w-full mx-4 text-center shadow-2xl">
            <p className="text-white text-xl font-semibold mb-2">
              {t(
                "player.pauseOverlay.stillWatching",
                "Are you still watching?",
              )}
            </p>
            <p className="text-white/60 text-sm mb-6">
              {t(
                "player.pauseOverlay.stillWatchingDesc",
                "P-Stream paused your video to save data.",
              )}
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleResume}
                className="w-full py-3 px-6 bg-white text-black font-semibold rounded-lg hover:bg-white/90 active:scale-95 transition-all"
              >
                {t("player.pauseOverlay.keepWatching", "Keep Watching")}
              </button>
              <button
                type="button"
                onClick={handleGoBack}
                className="w-full py-3 px-6 bg-white/10 text-white rounded-lg hover:bg-white/20 active:scale-95 transition-all"
              >
                {t("player.pauseOverlay.goBack", "Go Back")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main pause overlay with fade-in/out transition */}
      <div
        className={`absolute inset-0 z-[60] flex flex-col bg-black/50 transition-opacity duration-700 pointer-events-none ${
          shouldShow ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Main content – left-center aligned, vertically anchored near bottom */}
      <div className="flex-1 flex items-end pb-28 md:pb-36">
        <div className="ml-10 md:ml-24 lg:ml-32 max-w-lg lg:max-w-2xl">
          {/* "You are watching" label */}
          <p className="text-sm text-white/70 mb-3 tracking-wide uppercase">
            {t("player.pauseOverlay.youAreWatching", "You are watching")}
          </p>

          {/* Title / Logo */}
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={meta.title}
              className="mb-4 max-h-36 object-contain drop-shadow-lg"
            />
          ) : (
            <h1 className="mb-3 text-4xl lg:text-5xl font-bold text-white drop-shadow-lg">
              {meta.title}
            </h1>
          )}

          {/* Season / Episode info */}
          {meta.type === "show" && meta.season && meta.episode && (
            <p className="text-lg text-white/70 mb-1">
              {t("media.episodeDisplay", {
                season: meta.season.number,
                episode: meta.episode.number,
              })}
            </p>
          )}

          {/* Episode title */}
          {meta.type === "show" && meta.episode?.title && (
            <h2 className="mb-3 text-2xl font-semibold text-white drop-shadow-md">
              {meta.episode.title}
            </h2>
          )}

          {/* Description */}
          {overview && (
            <p className="text-sm lg:text-base text-white/70 drop-shadow-md line-clamp-3 mb-4 max-w-xl">
              {overview}
            </p>
          )}

          {/* Rating + Runtime */}
          <div className="flex items-center gap-2 text-sm text-white/80">
            {details.voteAverage !== null && details.voteAverage > 0 && (
              <>
                <span className="text-yellow-400">⭐</span>
                <span>{details.voteAverage.toFixed(1)}</span>
              </>
            )}
            {details.runtime && details.runtime > 0 && (
              <>
                {details.voteAverage !== null && details.voteAverage > 0 && (
                  <span className="text-white/40">·</span>
                )}
                <span>{formatRuntime(details.runtime)}</span>
              </>
            )}
            {duration > 0 && !details.runtime && (
              <>
                {details.voteAverage !== null && details.voteAverage > 0 && (
                  <span className="text-white/40">·</span>
                )}
                <span>{formatRuntime(Math.round(duration / 60))}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Centered playback controls */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex items-center gap-6 md:gap-10 pointer-events-auto">
          {/* Skip backward 10 s */}
          <button
            type="button"
            aria-label={t("player.controls.skipBack", "Skip back 10 seconds")}
            onClick={handleSkipBackward}
            className="flex flex-col items-center gap-1 text-white/80 hover:text-white active:scale-90 transition-all"
          >
            <Icon
              icon={Icons.SKIP_BACKWARD}
              className="text-3xl md:text-4xl drop-shadow"
            />
            <span className="text-xs font-medium">10</span>
          </button>

          {/* Play / Resume button */}
          <button
            type="button"
            aria-label={t("player.controls.play", "Play")}
            onClick={handleResume}
            className="w-16 h-16 md:w-20 md:h-20 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm border border-white/30 active:scale-90 transition-all shadow-2xl"
          >
            <Icon
              icon={Icons.PLAY}
              className="text-3xl md:text-4xl text-white drop-shadow"
            />
          </button>

          {/* Skip forward 10 s */}
          <button
            type="button"
            aria-label={t(
              "player.controls.skipForward",
              "Skip forward 10 seconds",
            )}
            onClick={handleSkipForward}
            className="flex flex-col items-center gap-1 text-white/80 hover:text-white active:scale-90 transition-all"
          >
            <Icon
              icon={Icons.SKIP_FORWARD}
              className="text-3xl md:text-4xl drop-shadow"
            />
            <span className="text-xs font-medium">10</span>
          </button>
        </div>
      </div>

      {/* Progress bar + time – sits above the player's own control bar */}
      {duration > 0 && (
        <div className="absolute bottom-16 md:bottom-20 left-0 right-0 px-10 md:px-16 pointer-events-none">
          {/* Time labels */}
          <div className="flex justify-between text-xs text-white/60 mb-1.5 font-mono">
            <span>{formattedTime}</span>
            <span>{formattedDuration}</span>
          </div>
          {/* Thin progress track */}
          <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/70 rounded-full transition-[width] duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

        {/* "Paused" indicator – bottom right, above controls */}
        <div className="absolute bottom-20 right-8 md:right-12">
          <span className="text-sm text-white/50 tracking-wider">
            {t("player.pauseOverlay.paused", "Paused")}
          </span>
        </div>
      </div>
    </>
  );
}

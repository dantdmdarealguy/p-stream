import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";
import { usePreferencesStore } from "@/stores/preferences";

type NetworkStats = {
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
  saveData: boolean | null;
};

type VideoStats = {
  bitrate: number | null;
  bandwidthEstimate: number | null;
  droppedFrames: number | null;
  totalFrames: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  codecSet: string | null;
};

const DEFAULT_NETWORK_STATS: NetworkStats = {
  effectiveType: null,
  downlink: null,
  rtt: null,
  saveData: null,
};

const DEFAULT_VIDEO_STATS: VideoStats = {
  bitrate: null,
  bandwidthEstimate: null,
  droppedFrames: null,
  totalFrames: null,
  width: null,
  height: null,
  videoCodec: null,
  audioCodec: null,
  codecSet: null,
};

function readConnectionStats(): NetworkStats {
  const connection =
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection;
  if (!connection) return DEFAULT_NETWORK_STATS;
  return {
    effectiveType: connection.effectiveType ?? null,
    downlink: typeof connection.downlink === "number" ? connection.downlink : null,
    rtt: typeof connection.rtt === "number" ? connection.rtt : null,
    saveData: typeof connection.saveData === "boolean" ? connection.saveData : null,
  };
}

function formatMbps(value: number | null) {
  if (value === null || Number.isNaN(value)) return "unknown";
  return `${value.toFixed(1)} Mbps`;
}

function formatBitrate(value: number | null) {
  if (value === null || Number.isNaN(value)) return "unknown";
  return `${(value / 1_000_000).toFixed(2)} Mbps`;
}

function StatRow(props: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-xs sm:text-sm">
      <span className="text-type-secondary">{props.label}</span>
      <span className="text-white text-right">{props.value}</span>
    </div>
  );
}

export function StatsOverlay() {
  const { t } = useTranslation();
  const enableStatsOverlay = usePreferencesStore((s) => s.enableStatsOverlay);
  const status = usePlayerStore((s) => s.status);
  const progress = usePlayerStore((s) => s.progress);
  const display = usePlayerStore((s) => s.display);
  const [networkStats, setNetworkStats] = useState<NetworkStats>(
    readConnectionStats(),
  );
  const [videoStats, setVideoStats] = useState<VideoStats>(DEFAULT_VIDEO_STATS);

  useEffect(() => {
    if (!enableStatsOverlay || status !== playerStatus.PLAYING) return;

    const connection =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;
    const handleConnectionChange = () => {
      setNetworkStats(readConnectionStats());
    };

    if (connection?.addEventListener) {
      connection.addEventListener("change", handleConnectionChange);
    }

    const updateStats = () => {
      const debugInfo = display?.getDebugInfo?.() ?? DEFAULT_VIDEO_STATS;
      const video = document.getElementById("video-element") as
        | (HTMLVideoElement & {
            getVideoPlaybackQuality?: () => VideoPlaybackQuality;
            webkitDroppedFrameCount?: number;
            webkitDecodedFrameCount?: number;
          })
        | null;
      const playbackQuality = video?.getVideoPlaybackQuality?.();
      const droppedFrames =
        playbackQuality?.droppedVideoFrames ??
        video?.webkitDroppedFrameCount ??
        null;
      const totalFrames =
        playbackQuality?.totalVideoFrames ??
        video?.webkitDecodedFrameCount ??
        null;
      const width = video?.videoWidth ?? debugInfo.width ?? null;
      const height = video?.videoHeight ?? debugInfo.height ?? null;

      setVideoStats({
        bitrate: debugInfo.bitrate ?? null,
        bandwidthEstimate: debugInfo.bandwidthEstimate ?? null,
        droppedFrames,
        totalFrames,
        width,
        height,
        videoCodec: debugInfo.videoCodec ?? null,
        audioCodec: debugInfo.audioCodec ?? null,
        codecSet: debugInfo.codecSet ?? null,
      });
    };

    updateStats();
    const interval = setInterval(updateStats, 1000);

    return () => {
      clearInterval(interval);
      if (connection?.removeEventListener) {
        connection.removeEventListener("change", handleConnectionChange);
      }
    };
  }, [display, enableStatsOverlay, status]);

  const bufferAhead = useMemo(() => {
    return Math.max(0, progress.buffered - progress.time);
  }, [progress.buffered, progress.time]);

  const bufferPercent = useMemo(() => {
    if (progress.duration <= 0) return null;
    return Math.min(100, (progress.buffered / progress.duration) * 100);
  }, [progress.buffered, progress.duration]);

  if (!enableStatsOverlay || status !== playerStatus.PLAYING) return null;

  const connectionLabel = networkStats.effectiveType ?? "unknown";
  const downlinkLabel = formatMbps(networkStats.downlink);
  const rttLabel =
    networkStats.rtt === null || Number.isNaN(networkStats.rtt)
      ? "unknown"
      : `${Math.round(networkStats.rtt)} ms`;
  const saveDataLabel =
    networkStats.saveData === null
      ? "unknown"
      : networkStats.saveData
        ? "on"
        : "off";

  const bufferLabel =
    bufferPercent === null
      ? `${bufferAhead.toFixed(1)}s`
      : `${bufferAhead.toFixed(1)}s (${bufferPercent.toFixed(0)}%)`;
  const droppedFramesLabel =
    videoStats.droppedFrames === null
      ? "unknown"
      : `${videoStats.droppedFrames}${
          videoStats.totalFrames !== null
            ? ` / ${videoStats.totalFrames}`
            : ""
        }`;
  const resolutionLabel =
    videoStats.width && videoStats.height
      ? `${videoStats.width}x${videoStats.height}`
      : "unknown";
  const codecLabel =
    videoStats.videoCodec ||
    videoStats.audioCodec ||
    videoStats.codecSet
      ? [
          videoStats.videoCodec,
          videoStats.audioCodec,
          videoStats.codecSet,
        ]
          .filter(Boolean)
          .join(" / ")
      : "unknown";

  return (
    <div className="absolute left-4 top-16 z-50 pointer-events-none">
      <div className="rounded-lg bg-black/70 p-3 text-white font-mono space-y-3 min-w-[220px] shadow-lg">
        <div className="text-[0.65rem] uppercase tracking-wide text-type-secondary">
          {t("player.menus.settings.statsForNerds", "Stats for Nerds")}
        </div>
        <div className="space-y-2">
          <div className="text-[0.6rem] uppercase tracking-wide text-type-secondary">
            Network
          </div>
          <StatRow label="Connection" value={connectionLabel} />
          <StatRow label="Downlink" value={downlinkLabel} />
          <StatRow label="RTT" value={rttLabel} />
          <StatRow label="Save Data" value={saveDataLabel} />
          <StatRow
            label="Estimated Bandwidth"
            value={formatBitrate(videoStats.bandwidthEstimate)}
          />
        </div>
        <div className="space-y-2">
          <div className="text-[0.6rem] uppercase tracking-wide text-type-secondary">
            Video
          </div>
          <StatRow label="Current Bitrate" value={formatBitrate(videoStats.bitrate)} />
          <StatRow label="Buffer Ahead" value={bufferLabel} />
          <StatRow label="Dropped Frames" value={droppedFramesLabel} />
          <StatRow label="Resolution" value={resolutionLabel} />
          <StatRow label="Codec" value={codecLabel} />
        </div>
      </div>
    </div>
  );
}

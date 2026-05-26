import { useEffect, useState } from "react";

import { usePlayerStore } from "@/stores/player/store";

interface Stats {
  resolution: string;
  bitrate: string;
  bandwidth: string;
  bufferHealth: string;
  droppedFrames: number;
  totalFrames: number;
  codec: string;
  playbackRate: string;
  volume: string;
}

function collectStats(
  video: HTMLVideoElement,
  hlsStats: {
    bandwidth: number;
    levelBitrate: number | null;
    videoCodec: string | null;
  } | null,
): Stats {
  const quality = video.getVideoPlaybackQuality();
  const resolution =
    video.videoWidth && video.videoHeight
      ? `${video.videoWidth}×${video.videoHeight}`
      : "—";

  const buffered = video.buffered;
  let bufferAhead = 0;
  if (buffered.length > 0 && !Number.isNaN(video.currentTime)) {
    for (let i = 0; i < buffered.length; i += 1) {
      if (
        buffered.start(i) <= video.currentTime &&
        buffered.end(i) >= video.currentTime
      ) {
        bufferAhead = buffered.end(i) - video.currentTime;
        break;
      }
    }
  }

  const bandwidth = hlsStats
    ? `${(hlsStats.bandwidth / 1000).toFixed(0)} kbps`
    : "—";
  const bitrate = hlsStats?.levelBitrate
    ? `${(hlsStats.levelBitrate / 1000).toFixed(0)} kbps`
    : "—";
  const codec = hlsStats?.videoCodec ?? "—";

  return {
    resolution,
    bitrate,
    bandwidth,
    bufferHealth: `${bufferAhead.toFixed(1)} s`,
    droppedFrames: quality?.droppedVideoFrames ?? 0,
    totalFrames: quality?.totalVideoFrames ?? 0,
    codec,
    playbackRate: `${video.playbackRate}×`,
    volume: `${Math.round(video.volume * 100)}%`,
  };
}

export function StatsOverlay() {
  const showStatsOverlay = usePlayerStore((s) => s.interface.showStatsOverlay);
  const display = usePlayerStore((s) => s.display);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!showStatsOverlay) {
      setStats(null);
      return;
    }

    const update = () => {
      const video = document.getElementById(
        "video-element",
      ) as HTMLVideoElement | null;
      if (!video) return;
      const hlsStats = display?.getHlsStats() ?? null;
      setStats(collectStats(video, hlsStats));
    };

    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [showStatsOverlay, display]);

  if (!showStatsOverlay || !stats) return null;

  const rows: [string, string][] = [
    ["Resolution", stats.resolution],
    ["Codec", stats.codec],
    ["Bandwidth", stats.bandwidth],
    ["Level Bitrate", stats.bitrate],
    ["Buffer Health", stats.bufferHealth],
    ["Dropped / Total", `${stats.droppedFrames} / ${stats.totalFrames}`],
    ["Playback Rate", stats.playbackRate],
    ["Volume", stats.volume],
  ];

  return (
    <div className="absolute top-4 right-4 z-50 pointer-events-none">
      <div className="bg-black/80 text-white text-xs font-mono rounded-lg px-3 py-2 min-w-[220px] space-y-0.5">
        <p className="font-bold text-sm mb-1 text-video-context-light">
          Stats for Nerds
        </p>
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <span className="text-white/60">{label}</span>
            <span className="text-white text-right">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

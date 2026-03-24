import { useMemo } from "react";

import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import {
  createEpisodeFileName,
  useDownloadManager,
} from "@/components/player/download/DownloadManagerContext";
import { DownloadTask } from "@/components/player/utils/download/types";

function formatBytesPerSecond(value: number) {
  const mb = value / (1024 * 1024);
  return `${mb.toFixed(2)} MB/s`;
}

function formatEta(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "-";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  const remaining = Math.ceil(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function TaskRow({ task }: { task: DownloadTask }) {
  const { pauseTask, resumeTask, cancelTask } = useDownloadManager();

  const statusColor =
    task.status === "completed"
      ? "text-green-400"
      : task.status === "error"
        ? "text-red-400"
        : task.status === "paused"
          ? "text-yellow-400"
          : "text-white/80";

  const action = useMemo(() => {
    if (task.status === "running") {
      return (
        <Button
          className="px-2 py-1 text-xs"
          theme="secondary"
          onClick={() => pauseTask(task.id)}
        >
          <Icon icon={Icons.PAUSE} className="mr-1 text-xs" /> Pause
        </Button>
      );
    }

    if (task.status === "paused") {
      return (
        <Button
          className="px-2 py-1 text-xs"
          theme="purple"
          onClick={() => {
            resumeTask(task.id).catch(() => {});
          }}
        >
          <Icon icon={Icons.PLAY} className="mr-1 text-xs" /> Resume
        </Button>
      );
    }

    return null;
  }, [pauseTask, resumeTask, task.id, task.status]);

  return (
    <div className="rounded-lg border border-video-context-border bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-white line-clamp-1">
          {task.fileName}
        </div>
        <span className={`text-xs capitalize ${statusColor}`}>
          {task.status}
        </span>
      </div>
      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-video-context-border">
        <div
          className="h-full bg-buttons-purple transition-all duration-200"
          style={{
            width: `${Math.max(0, Math.min(task.metrics.progress, 100))}%`,
          }}
        />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-type-secondary">
        <span>{task.metrics.progress.toFixed(1)}%</span>
        <span className="text-right">
          {formatBytesPerSecond(task.metrics.speedBytesPerSecond)}
        </span>
        <span>ETA: {formatEta(task.metrics.etaSeconds)}</span>
        <span className="text-right">
          {task.sourceOptions[0]?.label ?? "-"}
        </span>
      </div>
      <div className="flex gap-2">
        {action}
        {(task.status === "running" ||
          task.status === "paused" ||
          task.status === "queued") && (
          <Button
            className="px-2 py-1 text-xs"
            theme="danger"
            onClick={() => cancelTask(task.id)}
          >
            Cancel
          </Button>
        )}
      </div>
      {task.error ? (
        <p className="mt-2 text-xs text-red-300">{task.error}</p>
      ) : null}
    </div>
  );
}

export function DownloadManagerPanel() {
  const { tasks, queueLength } = useDownloadManager();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white">Download Manager</p>
        <span className="text-xs text-type-secondary">
          Queued: {queueLength}
        </span>
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-lg border border-video-context-border bg-black/20 p-3 text-xs text-type-secondary">
          No downloads yet.
        </p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

export function buildDownloadFileName(input: {
  title: string;
  mediaType: "movie" | "show";
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
}) {
  return createEpisodeFileName({
    title: input.title,
    mediaType: input.mediaType,
    seasonNumber: input.seasonNumber,
    episodeNumber: input.episodeNumber,
    episodeTitle: input.episodeTitle,
  });
}

import { nanoid } from "nanoid";
import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { fetchWithCorsFallback } from "@/components/player/utils/download/fetchWithFallback";
import { parseM3U8 } from "@/components/player/utils/download/m3u8";
import { evaluateDownloadSources } from "@/components/player/utils/download/sourceEvaluation";
import {
  DownloadMediaMeta,
  DownloadResolution,
  DownloadTask,
} from "@/components/player/utils/download/types";
import { SourceSliceSource } from "@/stores/player/utils/qualities";

interface TaskRuntime {
  abortController?: AbortController;
  fileHandle?: FileSystemFileHandle;
  paused: boolean;
  cancelled: boolean;
  segmentIndex: number;
}

interface QueueItem {
  media: DownloadMediaMeta;
  fileName: string;
  sourceResolver: () => Promise<SourceSliceSource>;
  preferredResolution?: DownloadResolution;
}

interface DownloadManagerContextValue {
  tasks: DownloadTask[];
  activeTaskId: string | null;
  queueLength: number;
  createTaskFromSource: (
    source: SourceSliceSource,
    media: DownloadMediaMeta,
    fileName: string,
  ) => Promise<string>;
  enqueueResolvedTask: (
    sourceResolver: () => Promise<SourceSliceSource>,
    media: DownloadMediaMeta,
    fileName: string,
    preferredResolution?: DownloadResolution,
  ) => Promise<void>;
  setResolution: (taskId: string, resolution: DownloadResolution) => void;
  startTask: (taskId: string) => Promise<void>;
  pauseTask: (taskId: string) => void;
  resumeTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => void;
}

const DownloadManagerContext =
  createContext<DownloadManagerContextValue | null>(null);

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "download";
}

function getTaskCandidate(task: DownloadTask) {
  const selectedResolution = task.selectedResolution;
  const fallback = task.sourceOptions[0];
  if (selectedResolution === "auto") return fallback;

  return (
    task.sourceOptions.find(
      (option) => option.resolution === selectedResolution,
    ) ?? fallback
  );
}

function updateMetrics(
  bytesDownloaded: number,
  totalBytes: number | null,
  startedAt: number,
) {
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  const speedBytesPerSecond = bytesDownloaded / elapsedSeconds;
  const progress = totalBytes
    ? Math.min((bytesDownloaded / totalBytes) * 100, 100)
    : 0;
  const etaSeconds =
    totalBytes && speedBytesPerSecond > 0
      ? Math.max((totalBytes - bytesDownloaded) / speedBytesPerSecond, 0)
      : null;

  return {
    bytesDownloaded,
    totalBytes,
    speedBytesPerSecond,
    etaSeconds,
    progress,
  };
}

async function pickWritable(
  task: DownloadTask,
  existing?: FileSystemFileHandle,
): Promise<{
  handle: FileSystemFileHandle;
  writable: FileSystemWritableFileStream;
}> {
  if (typeof window.showSaveFilePicker !== "function") {
    throw new Error(
      "This browser does not support streaming downloads to disk.",
    );
  }

  const handle =
    existing ??
    (await window.showSaveFilePicker({
      suggestedName: sanitizeFilename(task.fileName),
      types: [
        {
          description: "Video",
          accept: {
            "video/mp4": [".mp4"],
            "video/mp2t": [".ts"],
          },
        },
      ],
    }));

  const writable = await handle.createWritable({
    keepExistingData: Boolean(existing),
  });

  return {
    handle,
    writable,
  };
}

export function DownloadManagerProvider({ children }: PropsWithChildren) {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const runtimeRef = useRef<Record<string, TaskRuntime>>({});

  const updateTask = useCallback(
    (taskId: string, updater: (task: DownloadTask) => DownloadTask) => {
      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? updater(task) : task)),
      );
    },
    [],
  );

  const resolveAndCreateTask = useCallback(
    async (
      source: SourceSliceSource,
      media: DownloadMediaMeta,
      fileName: string,
      preferredResolution: DownloadResolution = "auto",
    ) => {
      const taskId = nanoid();
      const now = Date.now();
      const initialTask: DownloadTask = {
        id: taskId,
        createdAt: now,
        updatedAt: now,
        status: "probing",
        source,
        selectedResolution: preferredResolution,
        sourceOptions: [],
        metrics: {
          bytesDownloaded: 0,
          totalBytes: null,
          speedBytesPerSecond: 0,
          etaSeconds: null,
          progress: 0,
        },
        fileName,
        media,
      };

      setTasks((prev) => [initialTask, ...prev]);

      try {
        const options = await evaluateDownloadSources(source);
        updateTask(taskId, (task) => ({
          ...task,
          updatedAt: Date.now(),
          status: "queued",
          sourceOptions: options,
          selectedResolution:
            task.selectedResolution === "auto" ||
            !options.some((o) => o.resolution === task.selectedResolution)
              ? (options[0]?.resolution ?? "auto")
              : task.selectedResolution,
        }));
      } catch (error) {
        updateTask(taskId, (task) => ({
          ...task,
          updatedAt: Date.now(),
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to evaluate sources",
        }));
      }

      return taskId;
    },
    [updateTask],
  );

  const processQueue = useCallback(async () => {
    if (activeTaskId) return;

    const next = queueRef.current.shift();
    if (!next) return;

    try {
      const source = await next.sourceResolver();
      const taskId = await resolveAndCreateTask(
        source,
        next.media,
        next.fileName,
        next.preferredResolution,
      );
      await Promise.resolve();
      setActiveTaskId(taskId);
    } catch {
      setActiveTaskId(null);
      processQueue().catch(() => {});
    }
  }, [activeTaskId, resolveAndCreateTask]);

  const enqueueResolvedTask = useCallback(
    async (
      sourceResolver: () => Promise<SourceSliceSource>,
      media: DownloadMediaMeta,
      fileName: string,
      preferredResolution: DownloadResolution = "auto",
    ) => {
      queueRef.current.push({
        sourceResolver,
        media,
        fileName,
        preferredResolution,
      });

      if (!activeTaskId) {
        processQueue().catch(() => {});
      }
    },
    [activeTaskId, processQueue],
  );

  const runTask = useCallback(
    async (taskId: string, resume = false) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const candidateOption = getTaskCandidate(task);
      const candidate = candidateOption?.candidates.find(
        (item) => item.id === candidateOption.bestCandidateId,
      );
      if (!candidate) {
        updateTask(taskId, (prev) => ({
          ...prev,
          status: "error",
          error: "No downloadable source for selected resolution",
          updatedAt: Date.now(),
        }));
        return;
      }

      const runtime = runtimeRef.current[taskId] ?? {
        paused: false,
        cancelled: false,
        segmentIndex: 0,
      };
      const abortController = new AbortController();
      runtime.abortController = abortController;
      runtime.paused = false;
      runtime.cancelled = false;
      runtimeRef.current[taskId] = runtime;

      updateTask(taskId, (prev) => ({
        ...prev,
        status: "running",
        updatedAt: Date.now(),
      }));

      let writable: FileSystemWritableFileStream | undefined;
      let fileHandle = runtime.fileHandle;
      const startedAt = Date.now();
      let bytesDownloaded = task.metrics.bytesDownloaded;

      try {
        const picked = await pickWritable(
          task,
          resume ? fileHandle : undefined,
        );
        fileHandle = picked.handle;
        runtime.fileHandle = fileHandle;
        writable = picked.writable;

        if (resume && bytesDownloaded > 0) {
          await writable.seek(bytesDownloaded);
        }

        if (candidate.protocol === "file") {
          const response = await fetchWithCorsFallback(candidate.url, {
            headers: {
              ...candidate.headers,
              ...(resume && bytesDownloaded > 0
                ? { Range: `bytes=${bytesDownloaded}-` }
                : {}),
            },
            signal: abortController.signal,
          });

          const lengthHeader = response.headers.get("content-length");
          const partialLength = lengthHeader
            ? Number.parseInt(lengthHeader, 10)
            : NaN;
          const totalBytes =
            Number.isFinite(partialLength) && partialLength > 0
              ? partialLength + bytesDownloaded
              : null;

          if (!response.body) throw new Error("Download stream unavailable");
          const reader = response.body.getReader();

          let isStreaming = true;
          while (isStreaming) {
            const { done, value } = await reader.read();
            if (done) {
              isStreaming = false;
              continue;
            }
            if (!value) continue;

            await writable.write(value);
            bytesDownloaded += value.byteLength;
            const metrics = updateMetrics(
              bytesDownloaded,
              totalBytes,
              startedAt,
            );
            updateTask(taskId, (prev) => ({
              ...prev,
              metrics,
              updatedAt: Date.now(),
            }));
          }
        } else {
          const playlistResponse = await fetchWithCorsFallback(candidate.url, {
            headers: candidate.headers,
            signal: abortController.signal,
          });
          const playlistText = await playlistResponse.text();
          let parsed = parseM3U8(playlistText, candidate.url);

          if (parsed.type === "master") {
            const resolvedVariant =
              parsed.variants.find(
                (v) => v.resolution === candidateOption?.resolution,
              ) ?? parsed.variants[0];
            if (!resolvedVariant) throw new Error("No HLS variant available");

            const mediaPlaylistResponse = await fetchWithCorsFallback(
              resolvedVariant.url,
              {
                headers: candidate.headers,
                signal: abortController.signal,
              },
            );
            const mediaPlaylistText = await mediaPlaylistResponse.text();
            parsed = parseM3U8(mediaPlaylistText, resolvedVariant.url);
          }

          const totalSegments = parsed.segments.length;
          for (let i = runtime.segmentIndex; i < totalSegments; i += 1) {
            const segmentUrl = parsed.segments[i];
            const segmentResponse = await fetchWithCorsFallback(segmentUrl, {
              headers: candidate.headers,
              signal: abortController.signal,
            });
            if (!segmentResponse.body) continue;

            const reader = segmentResponse.body.getReader();
            let hasChunk = true;
            while (hasChunk) {
              const { done, value } = await reader.read();
              if (done) {
                hasChunk = false;
                continue;
              }
              if (!value) continue;

              await writable.write(value);
              bytesDownloaded += value.byteLength;
            }

            runtime.segmentIndex = i + 1;
            const progress =
              totalSegments > 0 ? ((i + 1) / totalSegments) * 100 : 0;
            const metrics = {
              ...updateMetrics(bytesDownloaded, null, startedAt),
              progress,
            };

            updateTask(taskId, (prev) => ({
              ...prev,
              metrics,
              updatedAt: Date.now(),
            }));
          }
        }

        await writable.close();
        runtime.segmentIndex = 0;
        updateTask(taskId, (prev) => ({
          ...prev,
          status: "completed",
          updatedAt: Date.now(),
          metrics: {
            ...prev.metrics,
            progress: 100,
            etaSeconds: 0,
          },
        }));
      } catch (error) {
        const isAbort =
          error instanceof DOMException &&
          (error.name === "AbortError" || error.message.includes("aborted"));

        if (runtime.cancelled) {
          updateTask(taskId, (prev) => ({
            ...prev,
            status: "cancelled",
            updatedAt: Date.now(),
          }));
        } else if (runtime.paused && isAbort) {
          updateTask(taskId, (prev) => ({
            ...prev,
            status: "paused",
            updatedAt: Date.now(),
          }));
        } else {
          updateTask(taskId, (prev) => ({
            ...prev,
            status: "error",
            error: error instanceof Error ? error.message : "Download failed",
            updatedAt: Date.now(),
          }));
        }

        if (writable) {
          await writable.close().catch(() => {});
        }
      } finally {
        runtime.abortController = undefined;
        setActiveTaskId((current) => (current === taskId ? null : current));
        processQueue().catch(() => {});
      }
    },
    [processQueue, tasks, updateTask],
  );

  const createTaskFromSource = useCallback(
    async (
      source: SourceSliceSource,
      media: DownloadMediaMeta,
      fileName: string,
    ) => {
      return resolveAndCreateTask(source, media, fileName, "auto");
    },
    [resolveAndCreateTask],
  );

  const startTask = useCallback(
    async (taskId: string) => {
      setActiveTaskId(taskId);
      await runTask(taskId, false);
    },
    [runTask],
  );

  const pauseTask = useCallback((taskId: string) => {
    const runtime = runtimeRef.current[taskId];
    if (!runtime?.abortController) return;
    runtime.paused = true;
    runtime.abortController.abort();
  }, []);

  const resumeTask = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status !== "paused") return;
      setActiveTaskId(taskId);
      await runTask(taskId, true);
    },
    [runTask, tasks],
  );

  const retryTask = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.status !== "error") return;
      // Clear the previous error and resume from the last known position.
      // runtime.segmentIndex and task.metrics.bytesDownloaded are preserved
      // from the failed run, so the download continues rather than restarting.
      updateTask(taskId, (prev) => ({
        ...prev,
        status: "queued",
        error: undefined,
        updatedAt: Date.now(),
      }));
      setActiveTaskId(taskId);
      await runTask(taskId, true);
    },
    [runTask, tasks, updateTask],
  );

  const cancelTask = useCallback(
    (taskId: string) => {
      const runtime = runtimeRef.current[taskId];
      if (runtime?.abortController) {
        runtime.cancelled = true;
        runtime.abortController.abort();
      } else {
        updateTask(taskId, (prev) => ({
          ...prev,
          status: "cancelled",
          updatedAt: Date.now(),
        }));
      }
    },
    [updateTask],
  );

  const setResolution = useCallback(
    (taskId: string, resolution: DownloadResolution) => {
      updateTask(taskId, (task) => {
        if (task.status === "running") return task;
        return {
          ...task,
          selectedResolution: resolution,
          updatedAt: Date.now(),
        };
      });
    },
    [updateTask],
  );

  const value = useMemo<DownloadManagerContextValue>(
    () => ({
      tasks,
      activeTaskId,
      queueLength: queueRef.current.length,
      createTaskFromSource,
      enqueueResolvedTask,
      setResolution,
      startTask,
      pauseTask,
      resumeTask,
      retryTask,
      cancelTask,
    }),
    [
      tasks,
      activeTaskId,
      createTaskFromSource,
      enqueueResolvedTask,
      setResolution,
      startTask,
      pauseTask,
      resumeTask,
      retryTask,
      cancelTask,
    ],
  );

  return (
    <DownloadManagerContext.Provider value={value}>
      {children}
    </DownloadManagerContext.Provider>
  );
}

export function useDownloadManager() {
  const context = useContext(DownloadManagerContext);
  if (!context) {
    throw new Error(
      "useDownloadManager must be used within DownloadManagerProvider",
    );
  }
  return context;
}

export function createEpisodeFileName(media: DownloadMediaMeta) {
  if (media.mediaType === "movie") return `${media.title}.mp4`;

  const season = String(media.seasonNumber ?? 0).padStart(2, "0");
  const episode = String(media.episodeNumber ?? 0).padStart(2, "0");
  return `${media.title}.S${season}E${episode}.${sanitizeFilename(media.episodeTitle ?? "episode")}.mp4`;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle>;
  }
}

/**
 * Zustand download manager store.
 *
 * Tracks all active, queued, completed and failed downloads.
 * Each download has a unique id, progress state and an AbortController
 * for cancellation.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import {
  DownloadProgressEvent,
  DownloadType,
  startDownload,
} from "@/utils/download/streamDownloader";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DownloadStatus =
  | "queued"
  | "preparing"
  | "downloading"
  | "done"
  | "failed"
  | "cancelled";

export interface DownloadItem {
  id: string;
  title: string;
  filename: string;
  url: string;
  type: DownloadType;
  headers: Record<string, string>;
  status: DownloadStatus;
  progress: DownloadProgressEvent;
  error?: string;
  /** Quality label selected by the user, e.g. "1080p" */
  qualityLabel: string;
}

interface DownloadStore {
  downloads: DownloadItem[];
  /** Add a download to the queue and start it immediately. Returns the item id. */
  enqueue(opts: {
    title: string;
    filename: string;
    url: string;
    type: DownloadType;
    headers?: Record<string, string>;
    qualityLabel?: string;
  }): string;
  cancel(id: string): void;
  remove(id: string): void;
  clearCompleted(): void;
}

// ---------------------------------------------------------------------------
// Abort controller registry (outside Zustand — not serialisable)
// ---------------------------------------------------------------------------

const abortControllers = new Map<string, AbortController>();

function makeId(): string {
  return `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const emptyProgress: DownloadProgressEvent = {
  bytesWritten: 0,
  totalBytes: null,
  percentage: null,
  speedBps: 0,
  etaSeconds: null,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useDownloadStore = create<DownloadStore>()(
  immer((set, get) => ({
    downloads: [],

    enqueue({ title, filename, url, type, headers = {}, qualityLabel = "" }) {
      const id = makeId();
      const controller = new AbortController();
      abortControllers.set(id, controller);

      const item: DownloadItem = {
        id,
        title,
        filename,
        url,
        type,
        headers,
        qualityLabel,
        status: "queued",
        progress: emptyProgress,
      };

      set((s) => {
        s.downloads.push(item);
      });

      // Kick off download asynchronously
      (async () => {
        set((s) => {
          const dl = s.downloads.find((d) => d.id === id);
          if (dl) dl.status = "preparing";
        });

        try {
          await startDownload({
            url,
            filename,
            type,
            headers,
            signal: controller.signal,
            onProgress(ev) {
              set((s) => {
                const dl = s.downloads.find((d) => d.id === id);
                if (!dl) return;
                dl.status = "downloading";
                dl.progress = ev;
              });
            },
          });

          // Only mark done if not cancelled
          const current = get().downloads.find((d) => d.id === id);
          if (current && current.status !== "cancelled") {
            set((s) => {
              const dl = s.downloads.find((d) => d.id === id);
              if (dl) {
                dl.status = "done";
                dl.progress = {
                  ...dl.progress,
                  percentage: 100,
                  etaSeconds: 0,
                };
              }
            });
          }
        } catch (err: any) {
          const isCancelled =
            err?.name === "AbortError" || controller.signal.aborted;

          set((s) => {
            const dl = s.downloads.find((d) => d.id === id);
            if (!dl) return;
            if (isCancelled) {
              dl.status = "cancelled";
            } else {
              dl.status = "failed";
              dl.error = err?.message ?? "Download failed";
            }
          });
        } finally {
          abortControllers.delete(id);
        }
      })();

      return id;
    },

    cancel(id) {
      abortControllers.get(id)?.abort();
      abortControllers.delete(id);
      set((s) => {
        const dl = s.downloads.find((d) => d.id === id);
        if (
          dl &&
          (dl.status === "downloading" ||
            dl.status === "queued" ||
            dl.status === "preparing")
        ) {
          dl.status = "cancelled";
        }
      });
    },

    remove(id) {
      abortControllers.get(id)?.abort();
      abortControllers.delete(id);
      set((s) => {
        s.downloads = s.downloads.filter((d) => d.id !== id);
      });
    },

    clearCompleted() {
      set((s) => {
        s.downloads = s.downloads.filter(
          (d) =>
            d.status !== "done" &&
            d.status !== "failed" &&
            d.status !== "cancelled",
        );
      });
    },
  })),
);

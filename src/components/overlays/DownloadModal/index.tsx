/**
 * DownloadModal – the main download UI.
 *
 * Shows:
 *  1. A resolution dropdown (populated from available sources).
 *  2. A speed-testing phase that ranks sources by download speed.
 *  3. A Download button that starts the selected download.
 *  4. A live progress view for active downloads (percentage, speed, ETA,
 *     cancel button).
 *
 * Usage:
 *   <DownloadModal id="download-modal" />
 *   // Open it with: useModal("download-modal").show()
 *
 * Pass `initialSources` to supply available quality options from outside.
 */

import classNames from "classnames";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/buttons/Button";
import { Icon, Icons } from "@/components/Icon";
import { Modal, ModalCard, useModal } from "@/components/overlays/Modal";
import { Heading2, Paragraph } from "@/components/utils/Text";
import { DownloadItem, useDownloadStore } from "@/stores/downloads";
import { getHLSVariants } from "@/utils/download/streamDownloader";
import { resolutionToQualityLabel } from "@/utils/download/m3u8Parser";
import { rankBySpeed } from "@/utils/download/speedTest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DownloadSource {
  /** Human-readable quality label, e.g. "1080p", "720p", "4K" */
  qualityLabel: string;
  url: string;
  type: "mp4" | "hls";
  headers?: Record<string, string>;
}

interface DownloadModalProps {
  id: string;
  /** Available download sources (usually populated from the player source). */
  sources?: DownloadSource[];
  /** Title used as the suggested filename base. */
  title?: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
}

function formatETA(seconds: number | null): string {
  if (seconds === null || seconds === Infinity) return "--:--";
  const s = Math.ceil(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Active download row
// ---------------------------------------------------------------------------

function DownloadRow({ item }: { item: DownloadItem }) {
  const cancel = useDownloadStore((s) => s.cancel);
  const remove = useDownloadStore((s) => s.remove);
  const { progress, status } = item;

  const pct = progress.percentage ?? 0;

  const statusLabel = {
    queued: "Queued",
    preparing: "Preparing…",
    downloading: "Downloading",
    done: "Complete",
    failed: "Failed",
    cancelled: "Cancelled",
  }[status];

  return (
    <div className="bg-denim-800 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-white font-medium text-sm line-clamp-1 max-w-[70%]">
          {item.title}{" "}
          <span className="text-type-secondary text-xs ml-1">
            {item.qualityLabel}
          </span>
        </span>
        <span
          className={classNames("text-xs font-semibold", {
            "text-type-secondary": status === "queued" || status === "preparing",
            "text-buttons-purple": status === "downloading",
            "text-green-400": status === "done",
            "text-red-400": status === "failed" || status === "cancelled",
          })}
        >
          {statusLabel}
        </span>
      </div>

      {/* Progress bar */}
      {(status === "downloading" || status === "done") && (
        <div className="w-full bg-denim-700 rounded-full h-2 overflow-hidden">
          <div
            className="h-2 rounded-full bg-purple-600 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Stats row */}
      {status === "downloading" && (
        <div className="flex items-center justify-between text-xs text-type-secondary">
          <span>
            {pct.toFixed(1)}%{" "}
            {progress.segmentsTotal
              ? `(${progress.segmentsDone}/${progress.segmentsTotal} segs)`
              : formatBytes(progress.bytesWritten)}
          </span>
          <span>
            {formatSpeed(progress.speedBps)} · ETA{" "}
            {formatETA(progress.etaSeconds)}
          </span>
        </div>
      )}

      {status === "failed" && item.error && (
        <p className="text-xs text-red-400">{item.error}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {(status === "downloading" ||
          status === "queued" ||
          status === "preparing") && (
          <button
            type="button"
            onClick={() => cancel(item.id)}
            className="text-xs text-type-secondary hover:text-white transition-colors"
          >
            Cancel
          </button>
        )}
        {(status === "done" ||
          status === "failed" ||
          status === "cancelled") && (
          <button
            type="button"
            onClick={() => remove(item.id)}
            className="text-xs text-type-secondary hover:text-white transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolution selector
// ---------------------------------------------------------------------------

interface QualityOption {
  label: string;
  source: DownloadSource;
  speedBps?: number;
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function DownloadModal({ id, sources = [], title = "Video" }: DownloadModalProps) {
  const modal = useModal(id);
  const enqueue = useDownloadStore((s) => s.enqueue);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);
  const downloads = useDownloadStore((s) => s.downloads);

  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<QualityOption | null>(
    null,
  );
  const [isTestingSpeed, setIsTestingSpeed] = useState(false);
  const [speedTestDone, setSpeedTestDone] = useState(false);

  // Flatten HLS master sources into per-resolution options
  const buildOptions = useCallback(async () => {
    if (sources.length === 0) return;
    setIsTestingSpeed(true);
    setSpeedTestDone(false);

    const allOptions: DownloadSource[] = [];

    await Promise.all(
      sources.map(async (src) => {
        if (src.type === "hls") {
          try {
            const variants = await getHLSVariants(src.url, src.headers ?? {});
            if (variants && variants.length > 0) {
              variants.forEach((v) => {
                allOptions.push({
                  qualityLabel: v.resolution
                    ? resolutionToQualityLabel(v.resolution)
                    : src.qualityLabel,
                  url: v.url,
                  type: "hls",
                  headers: src.headers,
                });
              });
            } else {
              allOptions.push(src);
            }
          } catch {
            allOptions.push(src);
          }
        } else {
          allOptions.push(src);
        }
      }),
    );

    // Deduplicate by qualityLabel + url
    const seen = new Set<string>();
    const unique = allOptions.filter((s) => {
      const key = `${s.qualityLabel}::${s.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Speed-test each option
    const ranked = await rankBySpeed(
      unique.map((s) => ({ url: s.url, headers: s.headers })),
    );

    // Build final options ordered by quality label (highest first) but preserving
    // the fastest source per label
    const byLabel = new Map<string, QualityOption>();
    ranked.forEach((r) => {
      const src = unique.find((u) => u.url === r.originalUrl);
      if (!src) return;
      const existing = byLabel.get(src.qualityLabel);
      if (!existing || r.speedBps > (existing.speedBps ?? 0)) {
        byLabel.set(src.qualityLabel, {
          label: src.qualityLabel,
          source: src,
          speedBps: r.speedBps,
        });
      }
    });

    const qualityOrder = ["4K", "1080p", "720p", "480p", "360p"];
    const sorted = [...byLabel.values()].sort((a, b) => {
      const ai = qualityOrder.indexOf(a.label);
      const bi = qualityOrder.indexOf(b.label);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    setQualityOptions(sorted);
    setSelectedQuality(sorted[0] ?? null);
    setIsTestingSpeed(false);
    setSpeedTestDone(true);
  }, [sources]);

  useEffect(() => {
    if (modal.isShown && sources.length > 0) {
      buildOptions();
    }
    if (!modal.isShown) {
      setQualityOptions([]);
      setSelectedQuality(null);
      setSpeedTestDone(false);
      setIsTestingSpeed(false);
    }
  }, [modal.isShown, buildOptions, sources.length]);

  const handleDownload = useCallback(() => {
    if (!selectedQuality) return;
    const { source } = selectedQuality;
    const sanitized = title.replace(/[^a-zA-Z0-9 ._-]/g, "").trim();
    const ext = source.type === "hls" ? "ts" : "mp4";
    const filename = `${sanitized} [${selectedQuality.label}].${ext}`;
    enqueue({
      title: sanitized,
      filename,
      url: source.url,
      type: source.type,
      headers: source.headers ?? {},
      qualityLabel: selectedQuality.label,
    });
    modal.hide();
  }, [selectedQuality, title, enqueue, modal]);

  const activeDownloads = downloads.filter(
    (d) => d.status === "downloading" || d.status === "queued" || d.status === "preparing",
  );
  const finishedDownloads = downloads.filter(
    (d) => d.status === "done" || d.status === "failed" || d.status === "cancelled",
  );
  const hasFinished = finishedDownloads.length > 0;

  return (
    <Modal id={id}>
      <ModalCard>
        <div className="flex items-center justify-between mb-6">
          <Heading2 className="!mt-0 !mb-0">
            <Icon icon={Icons.DOWNLOAD} className="inline-block mr-2 text-xl" />
            Download
          </Heading2>
          <button
            type="button"
            onClick={modal.hide}
            className="text-type-secondary hover:text-white transition-colors p-1"
          >
            <Icon icon={Icons.X} className="text-xl" />
          </button>
        </div>

        {/* Source / quality section */}
        {sources.length > 0 && (
          <div className="mb-6">
            <p className="text-sm font-medium text-type-secondary mb-3">
              Select quality
            </p>

            {isTestingSpeed && (
              <div className="flex items-center gap-3 text-type-secondary text-sm py-3">
                <span className="animate-spin text-lg">⟳</span>
                Testing source speeds…
              </div>
            )}

            {!isTestingSpeed && qualityOptions.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {qualityOptions.map((opt) => (
                  <button
                    key={opt.label + opt.source.url}
                    type="button"
                    onClick={() => setSelectedQuality(opt)}
                    className={classNames(
                      "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                      selectedQuality?.label === opt.label
                        ? "bg-buttons-purple text-white"
                        : "bg-denim-800 text-type-secondary hover:bg-denim-700 hover:text-white",
                    )}
                  >
                    {opt.label}
                    {opt.speedBps && opt.speedBps > 0 ? (
                      <span className="ml-1.5 text-xs opacity-70">
                        {formatSpeed(opt.speedBps)}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}

            {speedTestDone && selectedQuality && (
              <Button
                theme="purple"
                className="w-full"
                onClick={handleDownload}
                icon={Icons.DOWNLOAD}
              >
                Download {selectedQuality.label}
              </Button>
            )}

            {speedTestDone && !selectedQuality && (
              <Paragraph className="text-red-400 text-sm">
                No download sources available.
              </Paragraph>
            )}
          </div>
        )}

        {sources.length === 0 && (
          <Paragraph className="text-type-secondary text-sm mb-4">
            No sources available. Start playing a video first, then open this
            dialog to download it.
          </Paragraph>
        )}

        {/* Active downloads */}
        {activeDownloads.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase text-type-secondary mb-2 tracking-wider">
              Active Downloads
            </p>
            <div className="space-y-3">
              {activeDownloads.map((dl) => (
                <DownloadRow key={dl.id} item={dl} />
              ))}
            </div>
          </div>
        )}

        {/* Finished downloads */}
        {hasFinished && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase text-type-secondary tracking-wider">
                Completed
              </p>
              <button
                type="button"
                onClick={clearCompleted}
                className="text-xs text-type-secondary hover:text-white transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="space-y-3">
              {finishedDownloads.map((dl) => (
                <DownloadRow key={dl.id} item={dl} />
              ))}
            </div>
          </div>
        )}
      </ModalCard>
    </Modal>
  );
}

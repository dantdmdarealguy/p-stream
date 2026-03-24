import {
  SourceQuality,
  SourceSliceSource,
} from "@/stores/player/utils/qualities";

export type DownloadResolution = SourceQuality | "auto";

export type DownloadTaskStatus =
  | "queued"
  | "probing"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "error";

export interface DownloadCandidate {
  id: string;
  url: string;
  resolution: SourceQuality;
  protocol: "file" | "hls";
  headers: Record<string, string>;
}

export interface ResolutionOption {
  resolution: SourceQuality;
  label: string;
  bestCandidateId: string;
  speedScore: number;
  candidates: DownloadCandidate[];
}

export interface DownloadMetrics {
  bytesDownloaded: number;
  totalBytes: number | null;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  progress: number;
}

export interface DownloadMediaMeta {
  mediaType: "movie" | "show";
  title: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
}

export interface DownloadTask {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: DownloadTaskStatus;
  source: SourceSliceSource;
  selectedResolution: DownloadResolution;
  selectedCandidateId?: string;
  sourceOptions: ResolutionOption[];
  metrics: DownloadMetrics;
  error?: string;
  fileName: string;
  media: DownloadMediaMeta;
}

export interface ProbeResult {
  ttfbMs: number;
  bytesPerSecond: number;
}

export interface DownloadController {
  pause: () => void;
  cancel: () => void;
  resume: () => void;
}

export type PlaylistType = "master" | "media";

export interface HlsVariant {
  url: string;
  resolution: SourceQuality;
}

export interface ParsedM3U8 {
  type: PlaylistType;
  variants: HlsVariant[];
  segments: string[];
}

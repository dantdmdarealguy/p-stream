import { MediaPlaylist } from "hls.js";

import { MWMediaType } from "@/backend/metadata/types/mw";
import { AudioTrack, CaptionListItem } from "@/stores/player/slices/source";
import { LoadableSource, SourceQuality } from "@/stores/player/utils/qualities";
import { Listener } from "@/utils/events";

export type DisplayErrorType = "hls" | "htmlvideo" | "global";
export type DisplayError = {
  stackTrace?: string;
  message?: string;
  key?: string;
  errorName: string;
  type: DisplayErrorType;
  hls?: {
    details: string;
    fatal: boolean;
    level?: number;
    levelDetails?: {
      url: string;
      width: number;
      height: number;
      bitrate: number;
    };
    frag?: {
      url: string;
      baseurl: string;
      duration: number;
      start: number;
      sn: number | string;
    };
    type: string;
    url?: string;
  };
};

export type DisplayInterfaceEvents = {
  play: void;
  pause: void;
  fullscreen: boolean;
  volumechange: number;
  time: number;
  duration: number;
  buffered: number;
  loading: boolean;
  qualities: SourceQuality[];
  changedquality: SourceQuality | null;
  audiotracks: AudioTrack[];
  changedaudiotrack: AudioTrack | null;
  needstrack: boolean;
  canairplay: boolean;
  airplayconnected: boolean;
  playbackrate: number;
  error: DisplayError;
};

export type DisplayDebugInfo = {
  bitrate: number | null;
  bandwidthEstimate: number | null;
  level: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  codecSet: string | null;
};

export interface qualityChangeOptions {
  source: LoadableSource | null;
  automaticQuality: boolean;
  preferredQuality: SourceQuality | null;
  startAt: number;
}

export interface DisplayMeta {
  title: string;
  type: MWMediaType;
  poster?: string;
}

export interface DisplayCaption {
  id: string;
  srtData: string;
  language: string;
  url?: string;
}

export type DisplayType = "web" | "casting";

export interface DisplayInterface extends Listener<DisplayInterfaceEvents> {
  play(): void;
  pause(): void;
  load(ops: qualityChangeOptions): void;
  changeQuality(
    automaticQuality: boolean,
    preferredQuality: SourceQuality | null,
  ): void;
  changeAudioTrack(audioTrack: AudioTrack): void;
  processVideoElement(video: HTMLVideoElement): void;
  processContainerElement(container: HTMLElement): void;
  toggleFullscreen(): void;
  togglePictureInPicture(): void;
  setSeeking(active: boolean): void;
  setVolume(vol: number): void;
  setTime(t: number): void;
  destroy(): void;
  startAirplay(): void;
  setPlaybackRate(rate: number): void;
  setMeta(meta: DisplayMeta): void;
  setCaption(caption: DisplayCaption | null): void;
  getDebugInfo(): DisplayDebugInfo | null;
  getType(): DisplayType;
  getCaptionList(): CaptionListItem[];
  getSubtitleTracks(): MediaPlaylist[];
  setSubtitlePreference(lang: string): Promise<void>;
}

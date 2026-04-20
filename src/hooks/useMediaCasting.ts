/// <reference types="chromecast-caf-sender" />

import { useCallback } from "react";

import { useChromecastAvailable } from "@/hooks/useChromecastAvailable";
import { usePlayerStore } from "@/stores/player/store";
import { isSafari } from "@/utils/detectFeatures";

/**
 * Unified hook for Chromecast and AirPlay casting state and controls.
 *
 * - On Chrome/Edge with Cast SDK loaded, exposes Chromecast state.
 * - On Safari (or any browser where `webkitShowPlaybackTargetPicker` is
 *   available), exposes AirPlay state.
 * - On unsupported browsers both `isChromecastAvailable` and
 *   `isAirplayAvailable` will be false.
 */
export function useMediaCasting() {
  const chromecastApiAvailable = useChromecastAvailable();
  const canAirplay = usePlayerStore((s) => s.interface.canAirplay);
  const isCasting = usePlayerStore((s) => s.interface.isCasting);
  const isAirplaying = usePlayerStore((s) => s.interface.isAirplaying);
  const display = usePlayerStore((s) => s.display);
  const remotePlayer = usePlayerStore((s) => s.casting.player);

  /** True when the Chromecast SDK is loaded and at least one device was found. */
  const isChromecastAvailable =
    !!chromecastApiAvailable && !isSafari && !!window.cast?.framework;

  /**
   * True when AirPlay is available.  AirPlay availability is signalled either
   * via the `webkitplaybacktargetavailabilitychanged` event (which sets
   * `canAirplay` in the store) or by detecting a Safari browser (where the
   * picker should always be accessible).
   */
  const isAirplayAvailable = canAirplay || isSafari;

  /**
   * Whether any kind of remote casting is currently active (Chromecast **or**
   * AirPlay).
   */
  const isAnyCasting = isCasting || isAirplaying;

  /**
   * Display name of the remote Chromecast device, if connected.
   * Falls back to `undefined` when not casting or name is unavailable.
   */
  const castDeviceName: string | undefined =
    isCasting &&
    remotePlayer?.displayName &&
    remotePlayer.displayName !== "Default Media Receiver"
      ? remotePlayer.displayName
      : undefined;

  /**
   * Trigger the AirPlay device picker.  No-op if the current display does
   * not support AirPlay.
   */
  const startAirplay = useCallback(() => {
    display?.startAirplay();
  }, [display]);

  /**
   * Open the Google Cast device picker via the SDK.  No-op if the Cast SDK
   * is not available.
   */
  const startChromecast = useCallback(() => {
    if (!isChromecastAvailable) return;
    try {
      cast.framework.CastContext.getInstance().requestSession();
    } catch (err) {
      // `requestSession` throws when the user dismisses the picker or a
      // session is already in progress — both are expected non-fatal cases.
      // Log anything else so genuinely unexpected errors are not silently lost.
      if (!(err instanceof Error) || !err.message.includes("cancel")) {
        console.warn("[useMediaCasting] requestSession error:", err);
      }
    }
  }, [isChromecastAvailable]);

  /**
   * Convenience: open whichever picker is relevant for the current browser.
   * - Safari → AirPlay picker
   * - Chrome/Edge with Cast SDK → Chromecast picker
   */
  const startCasting = useCallback(() => {
    if (isSafari) {
      startAirplay();
    } else {
      startChromecast();
    }
  }, [startAirplay, startChromecast]);

  return {
    /** Whether the Chromecast SDK is ready and has found devices. */
    isChromecastAvailable,
    /** Whether AirPlay is available on this device/browser. */
    isAirplayAvailable,
    /** Whether a Chromecast session is currently active. */
    isCasting,
    /** Whether AirPlay is currently streaming to a wireless target. */
    isAirplaying,
    /** True if either Chromecast or AirPlay is active. */
    isAnyCasting,
    /** Friendly name of the connected Chromecast device (if known). */
    castDeviceName,
    /** Open the AirPlay device picker. */
    startAirplay,
    /** Open the Chromecast device picker. */
    startChromecast,
    /** Open the most appropriate casting picker for the current browser. */
    startCasting,
  };
}

import { FetchError, ofetch } from "ofetch";

import { getAuthHeaders } from "@/backend/accounts/auth";
import { AccountWithToken } from "@/stores/auth";
import { KeyboardShortcuts } from "@/utils/keyboardShortcuts";

export interface CustomThemeSettings {
  primary?: string;
  secondary?: string;
  tertiary?: string;
  activeTheme?: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  savedCustomThemes?: {
    id: string;
    name: string;
    primary: string;
    secondary: string;
    tertiary: string;
  }[];
  hiddenDefaultThemes?: string[];
}

export interface SettingsInput {
  applicationLanguage?: string;
  applicationTheme?: string | null;
  defaultSubtitleLanguage?: string;
  proxyUrls?: string[] | null;
  febboxKey?: string | null;
  debridToken?: string | null;
  debridService?: string;
  tidbKey?: string | null;
  enableThumbnails?: boolean;
  enableAutoplay?: boolean;
  enableSkipCredits?: boolean;
  enableAutoSkipSegments?: boolean;
  enableDiscover?: boolean;
  enableFeatured?: boolean;
  enableDetailsModal?: boolean;
  enableImageLogos?: boolean;
  enableCarouselView?: boolean;
  enableMinimalCards?: boolean;
  forceCompactEpisodeView?: boolean;
  sourceOrder?: string[] | null;
  enableSourceOrder?: boolean;
  lastSuccessfulSource?: string | null;
  enableLastSuccessfulSource?: boolean;
  embedOrder?: string[] | null;
  enableEmbedOrder?: boolean;
  proxyTmdb?: boolean;
  enableLowPerformanceMode?: boolean;
  enableNativeSubtitles?: boolean;
  enableHoldToBoost?: boolean;
  homeSectionOrder?: string[] | null;
  manualSourceSelection?: boolean;
  enableDoubleClickToSeek?: boolean;
  enableAutoResumeOnPlaybackError?: boolean;
  enablePauseOverlay?: boolean;
  enableNumberKeySeeking?: boolean;
  keyboardShortcuts?: KeyboardShortcuts;
  customTheme?: CustomThemeSettings;
}

export interface SettingsResponse {
  applicationTheme?: string | null;
  applicationLanguage?: string | null;
  defaultSubtitleLanguage?: string | null;
  proxyUrls?: string[] | null;
  febboxKey?: string | null;
  debridToken?: string | null;
  debridService?: string;
  tidbKey?: string | null;
  enableThumbnails?: boolean;
  enableAutoplay?: boolean;
  enableSkipCredits?: boolean;
  enableAutoSkipSegments?: boolean;
  enableDiscover?: boolean;
  enableFeatured?: boolean;
  enableDetailsModal?: boolean;
  enableImageLogos?: boolean;
  enableCarouselView?: boolean;
  enableMinimalCards?: boolean;
  forceCompactEpisodeView?: boolean;
  sourceOrder?: string[] | null;
  enableSourceOrder?: boolean;
  lastSuccessfulSource?: string | null;
  enableLastSuccessfulSource?: boolean;
  embedOrder?: string[] | null;
  enableEmbedOrder?: boolean;
  proxyTmdb?: boolean;
  enableLowPerformanceMode?: boolean;
  enableNativeSubtitles?: boolean;
  enableHoldToBoost?: boolean;
  homeSectionOrder?: string[] | null;
  manualSourceSelection?: boolean;
  enableDoubleClickToSeek?: boolean;
  enableAutoResumeOnPlaybackError?: boolean;
  enablePauseOverlay?: boolean;
  enableNumberKeySeeking?: boolean;
  keyboardShortcuts?: KeyboardShortcuts;
  customTheme?: CustomThemeSettings;
}

function putSettings(
  url: string,
  account: AccountWithToken,
  settings: SettingsInput,
) {
  return ofetch<SettingsResponse>(`/users/${account.userId}/settings`, {
    method: "PUT",
    body: settings,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

export async function updateSettings(
  url: string,
  account: AccountWithToken,
  settings: SettingsInput,
) {
  try {
    return await putSettings(url, account, settings);
  } catch (error) {
    if (
      !(error instanceof FetchError) ||
      error.statusCode !== 400 ||
      settings.debridService !== "torbox"
    ) {
      throw error;
    }

    try {
      const { debridService: _unsupportedService, ...compatSettings } =
        settings;
      return await putSettings(url, account, compatSettings);
    } catch (compatError) {
      if (
        !(compatError instanceof FetchError) ||
        compatError.statusCode !== 400
      ) {
        throw compatError;
      }

      const {
        debridService: _unsupportedService,
        debridToken: _unsupportedToken,
        ...legacySafeSettings
      } = settings;
      return putSettings(url, account, legacySafeSettings);
    }
  }
}

export function getSettings(url: string, account: AccountWithToken) {
  return ofetch<SettingsResponse>(`/users/${account.userId}/settings`, {
    method: "GET",
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

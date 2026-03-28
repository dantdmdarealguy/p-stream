import { FetchError, ofetch } from "ofetch";

import { getAuthHeaders } from "@/backend/accounts/auth";
import { AccountWithToken } from "@/stores/auth";

import { BookmarkInput } from "./bookmarks";
import { ProgressInput } from "./progress";
import { SettingsInput } from "./settings";
import { WatchHistoryInput } from "./watchHistory";

export function importProgress(
  url: string,
  account: AccountWithToken,
  progressItems: ProgressInput[],
) {
  return ofetch<void>(`/users/${account.userId}/progress/import`, {
    method: "PUT",
    body: progressItems,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

export function importBookmarks(
  url: string,
  account: AccountWithToken,
  bookmarks: BookmarkInput[],
) {
  return ofetch<void>(`/users/${account.userId}/bookmarks`, {
    method: "PUT",
    body: bookmarks,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

export function importGroupOrder(
  url: string,
  account: AccountWithToken,
  groupOrder: string[],
) {
  return ofetch<void>(`/users/${account.userId}/group-order`, {
    method: "PUT",
    body: groupOrder,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

export function importWatchHistory(
  url: string,
  account: AccountWithToken,
  watchHistoryItems: WatchHistoryInput[],
) {
  return ofetch<void>(`/users/${account.userId}/watch-history/import`, {
    method: "PUT",
    body: watchHistoryItems,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

function putImportedSettings(
  url: string,
  account: AccountWithToken,
  settings: SettingsInput,
) {
  return ofetch<void>(`/users/${account.userId}/settings`, {
    method: "PUT",
    body: settings,
    baseURL: url,
    headers: getAuthHeaders(account.token),
  });
}

export async function importSettings(
  url: string,
  account: AccountWithToken,
  settings: SettingsInput,
) {
  try {
    return await putImportedSettings(url, account, settings);
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
      return await putImportedSettings(url, account, compatSettings);
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
      return putImportedSettings(url, account, legacySafeSettings);
    }
  }
}

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import { NotificationItem } from "@/components/overlays/notificationsModal/types";

export type InAppNotificationInput = Omit<
  NotificationItem,
  "guid" | "pubDate"
> &
  Partial<Pick<NotificationItem, "guid" | "pubDate">>;

interface NotificationsStore {
  /** Notifications pushed programmatically from anywhere in the app */
  inAppNotifications: NotificationItem[];
  /** Notifications fetched from RSS/Atom feeds (synced by NotificationModal) */
  rssNotifications: NotificationItem[];
  /** GUIDs of notifications that have been read (synced by NotificationModal) */
  readNotifications: string[];

  /**
   * Push an in-app notification that will appear in the notification bell/modal.
   * `guid` and `pubDate` are optional — they are auto-generated when omitted.
   *
   * @example
   * ```ts
   * import { useNotificationsStore } from "@/stores/notifications";
   *
   * useNotificationsStore.getState().pushNotification({
   *   title: "New episode available",
   *   description: "Season 2 Episode 5 is now streaming.",
   *   category: "announcement",
   *   link: "/watch/some-show",
   *   source: "My Feature",
   * });
   * ```
   */
  pushNotification: (notification: InAppNotificationInput) => void;

  /** Replace the RSS notification list (called by NotificationModal after each fetch) */
  setRssNotifications: (notifications: NotificationItem[]) => void;

  /** Replace the read-notifications list (called by NotificationModal on state change) */
  setReadNotifications: (guids: string[]) => void;

  /** Remove all programmatically-added in-app notifications */
  clearInAppNotifications: () => void;
}

export const useNotificationsStore = create<NotificationsStore>()(
  immer((set) => ({
    inAppNotifications: [],
    rssNotifications: [],
    readNotifications: [],

    pushNotification: (notification) =>
      set((state) => {
        const guid = notification.guid ?? `inapp-${crypto.randomUUID()}`;
        const pubDate = notification.pubDate ?? new Date().toISOString();
        // Avoid duplicates
        if (state.inAppNotifications.some((n) => n.guid === guid)) return;
        state.inAppNotifications.unshift({
          ...notification,
          link: notification.link ?? "",
          guid,
          pubDate,
          source: notification.source ?? "in-app",
        });
      }),

    setRssNotifications: (notifications) =>
      set((state) => {
        state.rssNotifications = notifications;
      }),

    setReadNotifications: (guids) =>
      set((state) => {
        state.readNotifications = guids;
      }),

    clearInAppNotifications: () =>
      set((state) => {
        state.inAppNotifications = [];
      }),
  })),
);

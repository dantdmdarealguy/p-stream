import { useOverlayStack } from "@/stores/interface/overlayStack";
import { useNotificationsStore } from "@/stores/notifications";

import { NotificationItem } from "../types";

const MAX_BADGE_COUNT = 99;

// Hook to manage notifications
export function useNotifications() {
  const { showModal, hideModal, isModalVisible } = useOverlayStack();
  const modalId = "notifications";

  const inAppNotifications = useNotificationsStore((s) => s.inAppNotifications);
  const rssNotifications = useNotificationsStore((s) => s.rssNotifications);
  const readNotificationGuids = useNotificationsStore(
    (s) => s.readNotifications,
  );
  const pushNotification = useNotificationsStore((s) => s.pushNotification);

  // Merged list: in-app notifications appear first (most recent), then RSS
  const notifications: NotificationItem[] = [
    ...inAppNotifications,
    ...rssNotifications,
  ];

  const readSet = new Set(readNotificationGuids);
  const unreadNotifications = notifications.filter((n) => !readSet.has(n.guid));
  const unreadCount =
    unreadNotifications.length > MAX_BADGE_COUNT
      ? (`${MAX_BADGE_COUNT}+` as const)
      : unreadNotifications.length;

  const openNotifications = () => {
    showModal(modalId);
  };

  const closeNotifications = () => {
    hideModal(modalId);
  };

  const isNotificationsOpen = () => {
    return isModalVisible(modalId);
  };

  /** @deprecated Use the reactive `unreadCount` value directly instead */
  const getUnreadCount = () => unreadCount;

  return {
    /** All notifications (in-app + RSS), in-app items shown first */
    notifications,
    /** Reactive unread count; capped at "99+" */
    unreadCount,
    /** Push an in-app notification into the notification bell/modal */
    pushNotification,
    openNotifications,
    closeNotifications,
    isNotificationsOpen,
    getUnreadCount,
  };
}

// Components
export { NotificationModal } from "./components/NotificationModal";
export { DetailView } from "./components/DetailView";
export { ListView } from "./components/ListView";
export { SettingsView } from "./components/SettingsView";

// Hooks
export { useNotifications } from "./hooks/useNotifications";

// Types
export type {
  NotificationItem,
  NotificationModalProps,
  ModalView,
  DetailViewProps,
  SettingsViewProps,
  ListViewProps,
} from "./types";

// Utils
export {
  getAllFeeds,
  getFetchUrl,
  getSourceName,
  formatDate,
  getCategoryColor,
  getCategoryLabel,
} from "./utils";

// Store — use this to push in-app notifications from anywhere in the app:
//
//   import { useNotificationsStore } from "@/stores/notifications";
//   useNotificationsStore.getState().pushNotification({
//     title: "Hello",
//     description: "World",
//     category: "announcement",
//   });
//
// Or inside a React component via the useNotifications hook:
//
//   const { pushNotification } = useNotifications();
//   pushNotification({ title: "Hello", description: "World", category: "announcement" });
export { useNotificationsStore } from "@/stores/notifications";
export type { InAppNotificationInput } from "@/stores/notifications";

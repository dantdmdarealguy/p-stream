import { BookmarkMediaItem } from "@/stores/bookmarks";
import { ProgressMediaItem } from "@/stores/progress";
import { SortOption, sortMediaItems } from "@/utils/mediaSorting";
import { MediaItem } from "@/utils/mediaTypes";

export type SortSections = SortOption;

export function getList(
  bookmarks: Record<string, BookmarkMediaItem>,
): MediaItem[] {
  return Object.entries(bookmarks).map(
    ([id, b]) => ({ id, ...b }) as MediaItem,
  );
}

export function sortMedia(
  items: MediaItem[],
  sortBy: SortOption,
  bookmarks?: Record<string, BookmarkMediaItem>,
  progressItems?: Record<string, ProgressMediaItem>,
  runtimeData?: Record<string, number>,
): MediaItem[] {
  return sortMediaItems(items, sortBy, bookmarks, progressItems, runtimeData);
}

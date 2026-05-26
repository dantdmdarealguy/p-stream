import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { usePlayerStore } from "@/stores/player/store";

export function StatsForNerds() {
  const showStatsOverlay = usePlayerStore((s) => s.interface.showStatsOverlay);
  const setShowStatsOverlay = usePlayerStore((s) => s.setShowStatsOverlay);

  return (
    <VideoPlayerButton
      onClick={() => setShowStatsOverlay(!showStatsOverlay)}
      icon={Icons.TACHOMETER}
    />
  );
}

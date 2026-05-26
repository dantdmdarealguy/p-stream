import { useTranslation } from "react-i18next";

import { Icons } from "@/components/Icon";
import { VideoPlayerButton } from "@/components/player/internals/Button";
import { usePlayerStore } from "@/stores/player/store";

export function StatsForNerds() {
  const { t } = useTranslation();
  const showStatsOverlay = usePlayerStore((s) => s.interface.showStatsOverlay);
  const setShowStatsOverlay = usePlayerStore((s) => s.setShowStatsOverlay);

  return (
    <VideoPlayerButton
      onClick={() => setShowStatsOverlay(!showStatsOverlay)}
      icon={Icons.TACHOMETER}
    >
      <span className="sr-only">
        {t("player.statsOverlay.toggle", "Toggle stats overlay")}
      </span>
    </VideoPlayerButton>
  );
}

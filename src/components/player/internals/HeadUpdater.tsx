import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";

import { usePlayerStore } from "@/stores/player/store";

export function HeadUpdater() {
  const { t } = useTranslation();
  const meta = usePlayerStore((s) => s.meta);

  if (!meta) return null;

  const isShow = meta.type === "show";
  const humanizedEpisodeId = isShow
    ? t("media.episodeDisplay", {
        season: meta.season?.number,
        episode: meta.episode?.number,
      })
    : "";

  const title = isShow
    ? `${meta.title} - ${humanizedEpisodeId}`
    : meta.title;

  const year = meta.releaseYear ? ` (${meta.releaseYear})` : "";
  const displayTitle = isShow ? title : `${meta.title}${year}`;
  const pageTitle = `${displayTitle} - P-Stream`;

  const description =
    meta.overview ||
    `Watch ${meta.title} on P-Stream for free, with no ads.`;

  // Poster is already resolved and stored in the player meta
  const imageUrl = meta.poster || "/embed-preview.png";

  const ogType = isShow ? "video.tv_show" : "video.movie";

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />

      {/* Open Graph */}
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:site_name" content="P-Stream" />

      {/* Twitter / X Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
    </Helmet>
  );
}

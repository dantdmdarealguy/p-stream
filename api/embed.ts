/**
 * Vercel serverless function for social media embed previews.
 *
 * When social media bots (Discord, Twitter, Telegram, etc.) crawl a media
 * page URL, they cannot execute JavaScript and therefore only see the
 * generic meta tags in the static index.html. This function intercepts those
 * bot requests, fetches real TMDB data, and returns an HTML page with
 * media-specific Open Graph / Twitter Card meta tags.
 *
 * Regular users are NOT routed here (see vercel.json "has" condition).
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
const POSTER_BASE = "https://image.tmdb.org/t/p/w780";

function isV4Token(key: string): boolean {
  return key.split(".").length === 3;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface TMDBMovieResponse {
  title?: string;
  overview?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  runtime?: number;
}

interface TMDBShowResponse {
  name?: string;
  overview?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
}

type TMDBResponse = TMDBMovieResponse & TMDBShowResponse;

async function fetchTMDB(
  endpoint: string,
  apiKey: string,
): Promise<TMDBResponse | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let url: string;

  if (isV4Token(apiKey)) {
    headers.Authorization = `Bearer ${apiKey}`;
    url = `${TMDB_BASE}${endpoint}`;
  } else {
    url = `${TMDB_BASE}${endpoint}?api_key=${encodeURIComponent(apiKey)}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return res.json();
}

export default async function handler(req: any, res: any) {
  // req.query.media is the wildcard path captured by vercel.json
  // e.g. "tmdb-movie-286217-the-martian" or "tmdb-tv-79744-the-rookie/427613/5885619"
  const mediaParam = req.query.media;
  const mediaPath = Array.isArray(mediaParam)
    ? mediaParam.join("/")
    : typeof mediaParam === "string"
      ? mediaParam
      : "";

  if (!mediaPath) {
    return res.redirect(302, "/");
  }

  const redirectTarget = `/media/${mediaPath}`;

  // First segment is the media identifier (e.g. "tmdb-movie-286217-the-martian")
  const mediaId = mediaPath.split("/")[0];
  const parts = mediaId.split("-");

  // Expect format: tmdb-{type}-{id}-{slug...}
  if (parts.length < 3 || parts[0] !== "tmdb") {
    return res.redirect(302, redirectTarget);
  }

  const tmdbType = parts[1]; // "movie" or "tv"
  const tmdbId = parts[2]; // numeric TMDB id

  if ((tmdbType !== "movie" && tmdbType !== "tv") || !tmdbId) {
    return res.redirect(302, redirectTarget);
  }

  const apiKey = process.env.VITE_TMDB_READ_API_KEY;
  if (!apiKey) {
    return res.redirect(302, redirectTarget);
  }

  try {
    const endpoint =
      tmdbType === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
    const data = await fetchTMDB(endpoint, apiKey);

    if (!data) {
      return res.redirect(302, redirectTarget);
    }

    const title = (data.title || data.name || "P-Stream") as string;
    const overview = (
      data.overview || `Watch ${title} on P-Stream for free, with no ads.`
    ) as string;
    const releaseDate = (
      data.release_date ||
      data.first_air_date ||
      ""
    ) as string;
    const year = releaseDate.slice(0, 4);

    // Prefer backdrop for wide og:image (better for social previews),
    // fall back to poster, then generic preview image.
    const imageUrl = data.backdrop_path
      ? `${BACKDROP_BASE}${data.backdrop_path}`
      : data.poster_path
        ? `${POSTER_BASE}${data.poster_path}`
        : "/embed-preview.png";

    const ogType = tmdbType === "movie" ? "video.movie" : "video.tv_show";
    const displayTitle = year ? `${title} (${year})` : title;
    const pageTitle = `${displayTitle} - P-Stream`;

    // Safely embed the redirect target in HTML/JS contexts
    const safeRedirect = encodeURI(redirectTarget);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(overview)}">

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(overview)}">
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:site_name" content="P-Stream">
  <meta property="og:url" content="${escapeHtml(redirectTarget)}">

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(overview)}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">

  <!-- Redirect humans to the actual SPA page immediately -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(safeRedirect)}">
  <link rel="canonical" href="${escapeHtml(redirectTarget)}">
</head>
<body>
  <script>window.location.replace(${JSON.stringify(safeRedirect)});</script>
  <p>Redirecting to <a href="${escapeHtml(safeRedirect)}">${escapeHtml(pageTitle)}</a>…</p>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
    return res.status(200).send(html);
  } catch {
    return res.redirect(302, redirectTarget);
  }
}

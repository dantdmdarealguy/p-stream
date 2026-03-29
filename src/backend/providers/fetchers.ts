import {
  Fetcher,
  makeSimpleProxyFetcher,
  setM3U8ProxyUrl,
} from "@p-stream/providers";

import { sendExtensionRequest } from "@/backend/extension/messaging";
import { getApiToken, setApiToken } from "@/backend/helpers/providerApi";
import { getM3U8ProxyUrls, getProxyUrls } from "@/utils/proxyUrls";

import { convertBodyToObject, getBodyTypeFromBody } from "../extension/request";

type TorrentParseInput = {
  title?: string;
  name?: string;
  description?: string;
  url?: string;
};

type DebridParsedStream = {
  resolution?: string;
  codec?: string;
  audio?: string;
  container?: string;
  title: string;
  url: string;
};

const TORRENT_PARSE_URL = "https://torrent-parse.pstream.mov";

function parseResolution(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("4k") || lower.includes("2160p")) return "2160p";
  if (lower.includes("1080p")) return "1080p";
  if (lower.includes("720p")) return "720p";
  if (lower.includes("480p")) return "480p";
  if (lower.includes("360p")) return "360p";
  return undefined;
}

function parseCodec(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (
    lower.includes("h265") ||
    lower.includes("x265") ||
    lower.includes("hevc")
  )
    return "h265";
  if (lower.includes("h264") || lower.includes("x264")) return "h264";
  if (lower.includes("av1")) return "av1";
  return undefined;
}

function parseAudio(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("aac")) return "aac";
  if (lower.includes("ddp")) return "ddp";
  if (lower.includes("dts")) return "dts";
  if (lower.includes("ac3")) return "ac3";
  return undefined;
}

function parseContainer(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes(".mp4") || lower.includes(" mp4 ")) return "mp4";
  if (lower.includes(".mkv") || lower.includes(" mkv ")) return "mkv";
  if (lower.includes(".webm") || lower.includes(" webm ")) return "webm";
  return undefined;
}

function parseDebridStreamsLocally(body?: unknown): DebridParsedStream[] {
  let payload: unknown = body;
  if (typeof body === "string") {
    try {
      payload = JSON.parse(body);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(payload)) return [];

  return payload
    .map((item) => {
      const stream = item as TorrentParseInput;
      if (!stream?.url) return null;
      const title =
        stream.title || stream.name || stream.description || stream.url;
      const inspectionText = `${title} ${stream.description || ""} ${stream.url}`;

      return {
        title,
        url: stream.url,
        resolution: parseResolution(inspectionText),
        codec: parseCodec(inspectionText),
        audio: parseAudio(inspectionText),
        container: parseContainer(inspectionText),
      } satisfies DebridParsedStream;
    })
    .filter((stream): stream is DebridParsedStream => Boolean(stream));
}

function makeLoadbalancedList(getter: () => string[]) {
  let listIndex = -1;
  return () => {
    const fetchers = getter();
    if (listIndex === -1 || listIndex >= fetchers.length) {
      listIndex = Math.floor(Math.random() * fetchers.length);
    }
    const proxyUrl = fetchers[listIndex];
    listIndex = (listIndex + 1) % fetchers.length;
    return proxyUrl;
  };
}

export const getLoadbalancedProxyUrl = makeLoadbalancedList(getProxyUrls);
function getEnabledM3U8ProxyUrls() {
  const allM3U8ProxyUrls = getM3U8ProxyUrls();
  const enabledProxies = localStorage.getItem("m3u8-proxy-enabled");

  if (!enabledProxies) {
    return allM3U8ProxyUrls;
  }

  try {
    const enabled = JSON.parse(enabledProxies);
    return allM3U8ProxyUrls.filter(
      (_url, index) => enabled[index.toString()] !== false,
    );
  } catch {
    return allM3U8ProxyUrls;
  }
}

export const getLoadbalancedM3U8ProxyUrl = makeLoadbalancedList(
  getEnabledM3U8ProxyUrls,
);

async function fetchButWithApiTokens(
  input: RequestInfo | URL,
  init?: RequestInit | undefined,
): Promise<Response> {
  const apiToken = await getApiToken();
  const headers = new Headers(init?.headers);
  if (apiToken) headers.set("X-Token", apiToken);
  const response = await fetch(
    input,
    init
      ? {
          ...init,
          headers,
        }
      : undefined,
  );
  const newApiToken = response.headers.get("X-Token");
  if (newApiToken) setApiToken(newApiToken);
  return response;
}

export function setupM3U8Proxy() {
  const proxyUrl = getLoadbalancedM3U8ProxyUrl();
  if (proxyUrl) {
    setM3U8ProxyUrl(proxyUrl);
  }
}

export function makeLoadBalancedSimpleProxyFetcher() {
  const fetcher: Fetcher = async (a, b) => {
    // Upstream parser service for debrid metadata can be intermittently down.
    // Return a best-effort local parse so debrid scraping can still continue.
    if (a === TORRENT_PARSE_URL) {
      return {
        statusCode: 200,
        headers: new Headers(),
        finalUrl: a,
        body: parseDebridStreamsLocally(b.body),
      };
    }

    const currentFetcher = makeSimpleProxyFetcher(
      getLoadbalancedProxyUrl(),
      fetchButWithApiTokens,
    );
    return currentFetcher(a, b);
  };
  return fetcher;
}

function makeFinalHeaders(
  readHeaders: string[],
  headers: Record<string, string>,
): Headers {
  const lowercasedHeaders = readHeaders.map((v) => v.toLowerCase());
  return new Headers(
    Object.entries(headers).filter((entry) =>
      lowercasedHeaders.includes(entry[0].toLowerCase()),
    ),
  );
}

export function makeExtensionFetcher() {
  const fetcher: Fetcher = async (url, ops) => {
    const result = await sendExtensionRequest<any>({
      url,
      ...ops,
      body: convertBodyToObject(ops.body),
      bodyType: getBodyTypeFromBody(ops.body),
    });
    if (!result?.success) throw new Error(`extension error: ${result?.error}`);
    const res = result.response;
    return {
      body: res.body,
      finalUrl: res.finalUrl,
      statusCode: res.statusCode,
      headers: makeFinalHeaders(ops.readHeaders, res.headers),
    };
  };
  return fetcher;
}

# P-Stream Fork — AI Agent Technical Reference Guide

> **Source of Truth** for how AI agents should be implemented, how they interact with this fork, and what patterns must be followed or avoided.

---

## Table of Contents

1. [Fork Overview](#1-fork-overview)
2. [Architecture Deep-Dive](#2-architecture-deep-dive)
3. [Agent Implementation](#3-agent-implementation)
4. [Communication Protocol](#4-communication-protocol)
5. [Constraints](#5-constraints)

---

## 1. Fork Overview

### What is P-Stream?

P-Stream is a **React 18 SPA (Single Page Application)** that aggregates streaming sources for movies and TV shows. It is self-hostable, PWA-capable, and supports both browser and desktop (Electron) targets.

### Key Differences from Upstream `p-stream/p-stream`

| Area | Upstream | This Fork (`xp-technologies-dev`) |
|---|---|---|
| **Providers package** | `github:p-stream/providers#production` | `github:xp-technologies-dev/providers#production` |
| **Homepage** | `https://p-stream.github.io/docs/` | `https://github.com/xp-technologies-dev/p-stream` |
| **Package name** | `p-stream` | `P-Stream` |
| **Version** | varies | `5.3.7` |

### Tech Stack at a Glance

- **Framework**: React 18.3 + TypeScript 5.9
- **Build**: Vite 5.4 (multi-chunk splitting, optional PWA via `VITE_PWA_ENABLED`)
- **State**: Zustand 4.5 + Immer (immutable slice pattern)
- **HTTP**: `ofetch` 1.4.1 for metadata calls; `@p-stream/providers` fetcher API for scraping
- **Extension bridge**: `@plasmohq/messaging` 0.6.2 (Plasmo framework)
- **Media**: `hls.js` 1.6 for HLS playback; `subsrt-ts` for subtitle parsing
- **Routing**: React Router 6 (hash mode by default, browser history via `NORMAL_ROUTER`)

### Important Runtime Entry Points

| File | Purpose |
|---|---|
| `src/setup/config.ts` | `RuntimeConfig` — parses `VITE_*` env vars and `window.__CONFIG__` into a typed config object |
| `src/backend/providers/providers.ts` | `getProviders()` — selects the correct fetching strategy per environment |
| `src/backend/extension/messaging.ts` | All extension messaging primitives (send, timeout, rule IDs) |
| `src/backend/extension/streams.ts` | `prepareStream()` — extracts domains and injects headers for a chosen stream |
| `src/backend/providers/fetchers.ts` | Loadbalanced proxy, M3U8 proxy, and extension fetcher factories |
| `src/hooks/useProviderScrape.tsx` | React hook that drives the full scrape lifecycle and emits UI events |

---

## 2. Architecture Deep-Dive

### Fetching Strategy Selection

`getProviders()` (in `src/backend/providers/providers.ts`) chooses one of three targets at runtime:

```
Desktop app detected  →  target: NATIVE     + makeExtensionFetcher()
Extension active      →  target: BROWSER_EXTENSION  + makeExtensionFetcher()
Default (browser)     →  target: BROWSER    + makeLoadBalancedSimpleProxyFetcher()
```

`isExtensionActiveCached()` (in `src/backend/extension/messaging.ts`) is a **synchronous, cached** boolean.  It is set to `true` by any successful extension `sendMessage()` call and to `false` on failure.  Agents must **never call `isExtensionActive()` (async) inside a hot render path** — use the cached variant.

### Loadbalanced Proxy Round-Robin

`makeLoadbalancedList(getter)` (`src/backend/providers/fetchers.ts`) wraps any `string[]` getter into a stateful round-robin cursor:

```typescript
// Initial index is random; subsequent calls are sequential mod length.
listIndex = Math.floor(Math.random() * fetchers.length); // init
proxyUrl  = fetchers[listIndex];
listIndex = (listIndex + 1) % fetchers.length;           // advance
```

Two separate loadbalanced lists exist:

- `getLoadbalancedProxyUrl` — general HTTP proxy for provider scraping
- `getLoadbalancedM3U8ProxyUrl` — HLS playlist proxy (filtered by `localStorage["m3u8-proxy-enabled"]`)

### Stream Domain Rule System

Before a stream plays, `prepareStream(stream)` in `src/backend/extension/streams.ts`:

1. **Extracts hostnames** from either `stream.playlist` (HLS) or all `stream.qualities[*].url` (file).
2. **Merges headers** from `stream.headers` and `stream.preferredHeaders`.
3. **Calls `setDomainRule()`** which sends a `prepareStream` message to the extension with `ruleId: RULE_IDS.PREPARE_STREAM (1)`.

The extension then intercepts requests to those hostnames and injects the required headers (bypassing CORS / authentication requirements of the CDN).

Rule IDs are constants in `src/backend/extension/messaging.ts`:

```typescript
RULE_IDS = { PREPARE_STREAM: 1, SET_DOMAINS_HLS: 2, SET_DOMAINS_HLS_AUDIO: 3 }
```

### Scraping Lifecycle Events

The `@p-stream/providers` package emits `FullScraperEvents` during a scrape:

```
init          →  list of all sourceIds that will be tried
start(id)     →  a specific source/embed begins scraping
update(evt)   →  status / percentage change for a source
discoverEmbeds(evt)  →  embed sub-sources found within a scraper
end           →  scrape complete (success or exhausted)
```

`useProviderScrape()` (`src/hooks/useProviderScrape.tsx`) subscribes to all events and maintains `sources: Record<string, ScrapingSegment>` and `sourceOrder: ScrapingItems[]` in React state.  Any agent that initiates a scrape **must** use this hook or replicate its event wiring to correctly track state.

### State Management (Zustand + Immer Slices)

The player store (`src/stores/player/`) is composed from named slices:

```
createSourceSlice       → stream metadata, playerStatus, current source/embed
createPlayingSlice      → playback position, duration, buffering
createInterfaceSlice    → UI overlay state
createProgressSlice     → watched-progress tracking
createDisplaySlice      → aspect ratio, zoom
createCastingSlice      → Chromecast / casting state
createThumbnailSlice    → preview thumbnails
createSkipSegmentsSlice → intro/credits skip segments
```

Slices are composed with `immer` middleware — **all state mutations must be written as mutations inside an `immer` producer; never replace the whole state object**.

Persisted stores use the `__MW::*` localStorage namespace (e.g. `__MW::preferences`).

---

## 3. Agent Implementation

### What an "Agent" Means in This Codebase

There is no dedicated agent framework in P-Stream.  An **agent** is any autonomous process (a React hook, a background task, or a scraping pipeline) that:

1. Receives a media descriptor (`ScrapeMedia`).
2. Calls `getProviders().scrapeMedia()` to find a playable source.
3. Feeds the result back into the player store.
4. Optionally calls `prepareStream()` when the extension is active.

The canonical implementation lives in `src/hooks/useProviderScrape.tsx`.  Use the boilerplate below when building a new agent or extending the scraping flow.

### Boilerplate: Custom Scraping Agent Hook

```typescript
// src/hooks/useMyAgent.tsx
import {
  FullScraperEvents,
  RunOutput,
  ScrapeMedia,
} from "@p-stream/providers";
import { useCallback, useRef, useState } from "react";

import { isExtensionActiveCached } from "@/backend/extension/messaging";
import { prepareStream } from "@/backend/extension/streams";
import { getProviders } from "@/backend/providers/providers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = "idle" | "scraping" | "success" | "error";

export interface AgentState {
  status: AgentStatus;
  output: RunOutput | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMyAgent() {
  const [state, setState] = useState<AgentState>({
    status: "idle",
    output: null,
    error: null,
  });

  // Keep an AbortController ref so the caller can cancel mid-scrape.
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (media: ScrapeMedia) => {
    // Cancel any previous run.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState({ status: "scraping", output: null, error: null });

    try {
      // 1. Obtain the correct provider instance for the current environment.
      //    getProviders() automatically selects NATIVE / BROWSER_EXTENSION /
      //    BROWSER based on cached extension state — never call makeProviders()
      //    directly from agent code.
      const providers = getProviders();

      // 2. Wire up FullScraperEvents for progress reporting.
      const events: FullScraperEvents = {
        init: (evt) => {
          // evt.sourceIds — array of provider IDs that will be tried.
          console.debug("[agent] init", evt.sourceIds);
        },
        start: (id) => {
          console.debug("[agent] start", id);
        },
        update: (evt) => {
          // evt.id, evt.status ("pending" | "success" | "failure" | "notfound"),
          // evt.percentage (0-100), evt.reason, evt.error
          console.debug("[agent] update", evt);
        },
        discoverEmbeds: (evt) => {
          console.debug("[agent] discoverEmbeds", evt.embeds.length);
        },
      };

      // 3. Scrape — this is the main async operation.
      const output = await providers.scrapeMedia({
        media,
        events,
        // Pass the AbortSignal so the scrape stops if aborted.
        signal: ctrl.signal,
      });

      if (ctrl.signal.aborted) return;

      // 4. If the extension is active, register domain rules so headers are
      //    injected automatically when the player fetches the stream.
      if (output && isExtensionActiveCached()) {
        const stream = output.stream ?? output.embeds?.[0]?.stream;
        if (stream) await prepareStream(stream);
      }

      setState({ status: "success", output, error: null });
    } catch (err: any) {
      if (ctrl.signal.aborted) return;
      setState({ status: "error", output: null, error: err?.message ?? "Unknown error" });
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: "idle", output: null, error: null });
  }, []);

  return { state, run, cancel };
}
```

### Boilerplate: Connecting Agent Output to the Player Store

```typescript
// Example: inside a page component that owns the player
import { useMyAgent } from "@/hooks/useMyAgent";
import { playerStatus } from "@/stores/player/slices/source";
import { usePlayerStore } from "@/stores/player/store";

function PlayerPage({ media }: { media: ScrapeMedia }) {
  const { state, run, cancel } = useMyAgent();
  const setStatus = usePlayerStore((s) => s.setStatus);
  const setSource = usePlayerStore((s) => s.setSource);

  useEffect(() => {
    run(media);
    return () => cancel();
  }, [media]);

  useEffect(() => {
    if (state.status === "scraping") {
      setStatus(playerStatus.SCRAPING);
    } else if (state.status === "success" && state.output) {
      setStatus(playerStatus.PLAYING);
      setSource(state.output);
    } else if (state.status === "error") {
      setStatus(playerStatus.SCRAPE_NOT_FOUND);
    }
  }, [state]);

  return <Player />;
}
```

### Boilerplate: Registering a Custom Proxy Fetcher

If an agent needs to route requests through a one-off proxy (e.g. for a specific CDN), use `singularProxiedFetch` rather than constructing raw `fetch` calls:

```typescript
import { singularProxiedFetch } from "@/backend/helpers/fetch";

const data = await singularProxiedFetch<MyResponseType>(
  "https://my-proxy.example.com",   // proxy base URL
  "https://target-api.example.com/endpoint",
  {
    method: "GET",
    headers: { Accept: "application/json" },
  },
);
// singularProxiedFetch automatically:
//   - appends ?destination=<encoded target URL>
//   - injects the current X-Token header
//   - extracts and caches any refreshed X-Token from the response
```

---

## 4. Communication Protocol

### Overview

All communication between the frontend and the browser extension uses **Plasmo's relay messaging** (`@plasmohq/messaging`).  There is no WebSocket or server-sent events channel for the extension bridge — it is strictly request/response over the browser extension message bus.

### Message Types

Defined in `src/backend/extension/plasmo.ts` and re-exported via `MessagesMetadata`:

| Message Name | Request Fields | Response Fields | Description |
|---|---|---|---|
| `hello` | _(none)_ | `version`, `allowed`, `hasPermission` | Heartbeat / capability check |
| `makeRequest` | `url`, `method`, `headers?`, `body?`, `bodyType?` | `response.statusCode`, `.headers`, `.finalUrl`, `.body` | Proxy an HTTP request through the extension |
| `prepareStream` | `ruleId`, `targetDomains[]`, `requestHeaders?`, `responseHeaders?` | `success` | Register declarative network rules for a CDN domain |
| `openPage` | `page`, `redirectUrl` | `success` | Instruct the extension to open a page (e.g. auth flow) |

All responses conform to `ExtensionBaseResponse<T>`:

```typescript
type ExtensionBaseResponse<T> =
  | ({ success: true } & T)
  | { success: false; error: string };
```

Always check `result?.success` before accessing response fields.

### Message Flow Diagram

```
┌───────────────────────────────────────────────────────────┐
│  React Component / Hook                                   │
│                                                           │
│  useProviderScrape()                                      │
│        │                                                  │
│        ▼                                                  │
│  getProviders().scrapeMedia(media, events)                 │
│        │                    │                             │
│        │           FullScraperEvents                      │
│        │           (init / start / update / end)          │
│        ▼                                                  │
│  makeExtensionFetcher() ──► sendExtensionRequest()        │
│       OR                         │                        │
│  makeLoadBalancedSimpleProxyFetcher()                     │
└──────────────────────────────────┼────────────────────────┘
                                   │ @plasmohq/messaging
                                   │ sendToBackgroundViaRelay()
                                   ▼
                    ┌──────────────────────────────┐
                    │  Browser Extension           │
                    │  Background Script           │
                    │  (makeRequest handler)       │
                    └──────────────────────────────┘
                                   │
                                   ▼ HTTP (with injected headers)
                    ┌──────────────────────────────┐
                    │  External CDN / Provider API │
                    └──────────────────────────────┘
```

### Startup Delay

The extension messaging module enforces a **500 ms startup delay** after page load before any message is sent:

```typescript
// src/backend/extension/messaging.ts
const isExtensionReady = new Promise<void>((resolve) => {
  setTimeout(() => resolve(), 500);
});
```

All `sendMessage()` calls `await isExtensionReady` internally.  Agents must not attempt to work around this delay.

### Extension Heartbeat / Capability Check

Call `extensionInfo()` (wraps `hello` with a 500 ms timeout) to determine extension availability:

```typescript
const info = await extensionInfo();
// info is null if extension not installed or timed out.

if (info?.success) {
  const versionOk = isAllowedExtensionVersion(info.version); // semver ^1.0.2
  const active = info.allowed && info.hasPermission && versionOk;
}
```

Use the synchronous `isExtensionActiveCached()` in render paths or inside `getProviders()` calls — it reflects the last known state without triggering a new async message.

### API Token Flow

The backend API uses short-lived JWT tokens transported on the `X-Token` HTTP header:

```
Request  →  X-Token: <current_token>
Response ←  X-Token: <refreshed_token>   (if present, replaces cached token)
```

`getApiToken()` / `setApiToken()` in `src/backend/helpers/providerApi.ts` manage this in-memory.  `singularProxiedFetch` and `fetchButWithApiTokens` (used by `makeLoadBalancedSimpleProxyFetcher`) handle injection and extraction automatically.  Agents that construct raw `fetch` calls **must** use these helpers.

### M3U8 Proxy Initialization

`setupM3U8Proxy()` in `src/backend/providers/fetchers.ts` must be called once before HLS streams are served.  It is called:

- On module load inside `src/backend/providers/providers.ts`
- Again inside the `BROWSER` target branch of `getProviders()` to refresh the URL after each scrape

Agents that bypass `getProviders()` and build their own `makeProviders()` call must call `setupM3U8Proxy()` themselves.

---

## 5. Constraints

### Hard Rules — Never Do These

| # | Constraint | Reason |
|---|---|---|
| 1 | **Never call `isExtensionActive()` (async) in a render or hot code path** | It sends a 500 ms-delayed extension message on every call; use `isExtensionActiveCached()` instead. |
| 2 | **Never call `makeProviders()` directly in feature code** | All environment-specific fetcher wiring lives in `getProviders()` / `getAllProviders()`. Calling `makeProviders()` directly bypasses target selection and M3U8 proxy setup. |
| 3 | **Never hardcode proxy URLs** | Proxy URLs come from `RuntimeConfig.PROXY_URLS` and `RuntimeConfig.M3U8_PROXY_URLS` (from env vars). Hardcoded URLs break multi-instance deployments and loadbalancing. |
| 4 | **Never store API tokens in `localStorage` or `sessionStorage`** | The `X-Token` JWT is kept in-memory only via `getApiToken()`/`setApiToken()`. Persisting it is a security risk. |
| 5 | **Never mutate Zustand state outside an `immer` producer** | All player store slices use `immer` middleware. Direct state replacement causes reference equality issues and breaks Zustand subscriptions. |
| 6 | **Never bypass `singularProxiedFetch` / `mwFetch` for backend API calls** | These functions inject `X-Token`, handle token refresh, and route through the loadbalanced proxy. Raw `fetch` to backend endpoints will break token management. |
| 7 | **Never send a `prepareStream` message with a `ruleId` outside `RULE_IDS`** | Rule IDs 1, 2, 3 are reserved constants. Unknown IDs cause undefined behavior in the extension. |
| 8 | **Never assume the extension is available** | `isExtensionActiveCached()` may return `false` at any time. Always implement a graceful fallback to the proxy path. |
| 9 | **Never skip the `extensionInfo()` version check** | The minimum allowed extension version is `^1.0.2` (semver range in `isAllowedExtensionVersion()`). Older extensions may be missing required message handlers. |
| 10 | **Always use `pnpm` with the committed lockfile; never use `npm` or `yarn`** | The repository enforces `pnpm` via the `preinstall` script (`only-allow pnpm`). CI uses a frozen lockfile (`--frozen-lockfile`). When adding or updating dependencies, commit the updated `pnpm-lock.yaml` alongside `package.json`. |

### Configuration Constraints

- Environment variables must be prefixed with `VITE_` to be exposed to the frontend at build time (Vite convention).
- Runtime config (`window.__CONFIG__`) overrides build-time env vars — agents must read from `RuntimeConfig` (via `src/setup/config.ts`), not directly from `import.meta.env`.
- `DISALLOWED_IDS` must be respected.  Before surfacing any media result, verify its `movie-{tmdbId}` or `show-{tmdbId}` identifier is not in `RuntimeConfig.DISALLOWED_IDS`.
- `CDN_REPLACEMENTS` is an array of `[from, to]` URL string pairs applied to stream URLs. Any agent that constructs or transforms stream URLs must apply these replacements.

### State Management Constraints

- All persistent stores use the `__MW::*` localStorage key namespace.  Do not read or write keys in this namespace directly — use the appropriate Zustand store.
- The player store slice pattern means each slice owns its own initial state and action functions.  New functionality must be added as a new slice (`createMySlice`) or inside the most relevant existing slice — never as ad-hoc fields on a neighboring slice.
- `usePlayerStore` must only be accessed inside React components or hooks (it uses React context). Background tasks that need player state must receive it via prop or callback.

### Security Constraints

- Content rendered from external sources (subtitles, banner messages) must be sanitized with `DOMPurify` before being set as `innerHTML`.
- TMDB API keys (`TMDB_READ_API_KEY`) are read-only keys. Never log or expose them client-side beyond what Vite's env injection already does.
- The BIP39 / `@noble/hashes` / `node-forge` crypto libraries are used exclusively for passphrase-based account encryption.  Do not use them for any other purpose without a security review.
- Cloudflare Turnstile (`@marsidev/react-turnstile`) and Google reCAPTCHA v3 tokens are single-use.  Never cache or re-use a captcha token across requests.

### Build & Deployment Constraints

- The Vite chunk split configuration in `vite.config.mts` is intentional — `hls`, `auth`, `locales`, `caption-parsing`, and `react-dom` are separate chunks for performance. Do not merge these into the main bundle.
- PWA support is **opt-in** (`VITE_PWA_ENABLED=true`). Do not enable it by default in any deployment script.
- The Docker image uses a two-stage build (Node 20 Alpine builder → nginx Alpine runtime). The `dist/` directory is the only build artifact that enters the production stage.

---

*This document was generated from analysis of the `dantdmdarealguy/p-stream` repository (GitHub fork owner) at version `5.3.7`. The codebase itself identifies `xp-technologies-dev/p-stream` as its upstream. Update this file when architectural patterns change significantly.*

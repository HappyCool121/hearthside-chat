# Onboarding notes: Hearthside to AdRouter

This is the friction log for P2. The integration followed only the public
[SDK 0.1.0 README](https://github.com/adrouter/browser-sdk/blob/v0.1.0/README.md) and the
AdRouter console. The standalone baseline is tag `v0.1-standalone` (f40244d), which passed P1 on
19 October 2026. It records friction, not prompts, replies or credentials.

## Steps followed

1. Downloaded `adrouter-browser-sdk-0.1.0.tgz` and its `.json` manifest from the v0.1.0 release.
   The SHA-256 (`0387d8f9…7eed`) and sha512 integrity matched the manifest.
2. Installed it with `npm install <release URL>`. The lockfile records the same sha512 integrity.
3. Added `server/adrouter.ts` and the six Function routes from README §2.
4. Replaced the direct DeepSeek adapter, its cookie and its history trimming with the SDK proxy,
   client and `SponsoredCard`.
5. Added the gateway measurement origin to the CSP, a paused-by-default `ADROUTER_ENABLED`
   switch and a visible sponsorship opt-out.
6. After the first hosted test failed (friction 12), installed `adrouter-browser-sdk-0.1.1.tgz`
   from the v0.1.1 release the same way. The SHA-256 (`d990f6b5…3134`) and sha512 integrity
   matched the manifest.

## Friction

| # | Where | What happened | What we did |
| --- | --- | --- | --- |
| 1 | §2 bindings | The README names `PUBLISHER_ORIGIN`, `TURNSTILE_SECRET` and `SESSION_SIGNING_SECRET`. Hearthside already had `PUBLIC_ORIGIN`, `TURNSTILE_SECRET_KEY` and `SESSION_SECRET` holding the same values. It is not obvious the names are only examples | Mapped the existing bindings in `server/adrouter.ts`; nothing re-entered |
| 2 | §1 / §2 IDs | The provider connection and placement IDs exist only after console setup, and the README does not say where non-secret IDs should live | Pages secrets `ADROUTER_PROVIDER_CONNECTION_ID` and `ADROUTER_PLACEMENT_ID`, kept out of this public repository and set after console setup |
| 3 | §2 pause | "Preserve the publisher's explicit paused state" has no example or recommended response | `/api/chat` returns the SDK's safe-error shape with `app_disabled` before Turnstile or the gateway, so the client maps it |
| 4 | §4 React | `useAdRouterChat` starts with empty history and cannot be seeded from browser storage, so reload persistence and New story would regress | Used the core client (§3) with the React `SponsoredCard` |
| 5 | §3 lifecycle | The client disposes itself on `pagehide`. After a Safari back/forward-cache restore it stays disposed and `sendTurn` throws. Not documented | Recreate the client on `pageshow` when `persisted` is true |
| 6 | §2 headers | A middleware that overwrites `Cache-Control` drops the proxy's `no-transform` on streamed replies | `protect()` keeps `no-transform` when the response already has it |
| 7 | §2 CSP | The measurement origin must be in `connect-src` in two places, Pages static `_headers` and Function responses. The origin appears only in §3's endpoint example | Both use `https://adrouter-v3.fly.dev`; a test keeps them equal |
| 8 | §5 card | The built-in card exposes classes only for the root and demo label. Page styles leaked in: our placeholder `p` rule made the body italic | Scoped placeholder styles; styled card children with child selectors |
| 9 | §5 measurement | The renderer's checks are stricter than the prose: every element at least 12px, no positioned `pointer-events:none` layer overlapping, at most 2,000 body elements | Card kept in normal flow between the conversation and composer; browser tests assert `rendered` and `visibility` with no `render_failed` in Chromium and WebKit |
| 10 | §1 install | "Verify downloaded tarballs" gives no command | `shasum -a 256` against the manifest's `sha256`, then the lockfile integrity |
| 11 | §6 interruption | The README asks publishers to keep an interrupted partial answer separate from history, but standalone Hearthside discarded it | The partial reply is shown as "interrupted, not kept"; it is never stored or sent |
| 12 | §2 runtime | First hosted test: every `/api/chat` returned 503 `service_unavailable` while `/api/session` worked, and the console recorded no turns. SDK 0.1.0's gateway relay passed `redirect: 'error'` to `fetch`, which the Workers runtime rejects with a TypeError after Turnstile and before any gateway request. Node tests stubbed `fetch`, so nothing caught it | Fixed in SDK 0.1.1. `test:workerd` now runs the built Functions in workerd and fails on 0.1.0 |

No other friction was found in the session, Turnstile, persona or trimming. The static
`systemInstruction` path needed no persona header.

## Console and activation (to be completed)

Console setup, the qualification outcome, the inventory version, placement review and the first
gateway turn will be recorded as outcomes only, with no IDs that are credentials:

- App created for `https://hearthside-chat.pages.dev`, paused: _pending_
- DeepSeek connection qualified (Original, Short multi-turn, Unicode): _pending_
- Inventory `demo-2026-10-19.1` loaded and prepared (32): _pending_
- Placement reviewed and publisher key issued: _pending_
- First gateway turn succeeded; publisher DeepSeek secret deleted: _pending_

## Sponsor-only integration, 21 October 2026

AdRouter retired its inference gateway, so Hearthside went back to calling DeepSeek itself and added a
sponsor call from the page. Compared with the gateway integration:

- No server changes for AdRouter at all: the publishable key is public and goes to the page through `/api/config`.
- The chat path is the standalone code again; AdRouter cannot break it.
- One CSP entry (`connect-src https://api.adrouter.co`) in both `server/security.ts` and `public/_headers`.
- The default card is unstyled on request and styled with Hearthside's own CSS (`adr-*` classes); no
  readability or overlay checks to satisfy.
- Friction: SDK 0.4.0 is not published yet, so the single-file bundle is vendored with its source commit and hash.

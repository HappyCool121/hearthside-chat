# Hearthside

A small character chat. Meet Rowan, the keeper of an imagined forest inn.
React/Vite serves the browser. Cloudflare Pages Functions relay each turn to the AdRouter V3
gateway through the public [AdRouter browser SDK 0.1.1](https://github.com/adrouter/browser-sdk).
The gateway calls DeepSeek with the publisher's own key (BYOK) and may offer a sponsored card
beside the unchanged answer. The character prompt and every credential stay on the server.

The standalone version, which called DeepSeek directly with no AdRouter code, is tag
[`v0.1-standalone`](https://github.com/HappyCool121/hearthside-chat/tree/v0.1-standalone). It
passed standalone acceptance on 19 October 2026. [ONBOARDING-NOTES.md](ONBOARDING-NOTES.md)
records the friction of the onboarding change.

## Run and verify

Requires Node.js 22.13 or newer and npm. Install exactly the locked dependencies:

```sh
npm ci
npm test
npm run build
npm run test:workerd
npm run test:browser
```

`npm run dev` previews the interface only. `npm run preview` serves the built interface and
Functions with Wrangler. Inference requires the exact configured HTTPS origin, a Cloudflare
trusted IP, a real Turnstile widget and an approved AdRouter app. Tests inject synthetic
Turnstile, gateway and measurement responses; they never make paid calls. `test:workerd` builds
the Functions bundle and runs it in workerd, the Cloudflare runtime, with every outbound fetch
intercepted. Browser tests use
Chromium and WebKit. Install their engines with `npx playwright install chromium webkit` if
needed. WebKit emulation does not prove iPhone Safari.

The SDK comes from its GitHub release tarball, not npm. Before changing it, verify the downloaded
tarball's SHA-256 against the release's `.tgz.json` manifest. The lockfile pins its integrity.

## What the onboarding changed

| Standalone (`v0.1-standalone`) | Onboarded |
| --- | --- |
| `server/chat.ts` called `api.deepseek.com` directly | `server/adrouter.ts` builds `createPublisherProxy` for the gateway |
| `__Host-hearthside` session cookie | SDK `__Host-adr_session` cookie, signed with the same `SESSION_SECRET` |
| `shared/history.ts` trimmed history | SDK client trims to 14 messages and 12,000 bytes, with the same visible notice |
| `/api/chat` streamed text events | `/api/chat`, `/api/turns/:id`, `/api/turns/:id/cancel`, `/api/feedback` and `/api/client-events` relay gateway events |
| Empty reserved card area | `SponsoredCard` in the reserved area, plus a "Show sponsored suggestions" opt-out |
| `STANDALONE_ENABLED` switch | `ADROUTER_ENABLED` switch; no direct-provider fallback remains |

## Binding inventory

| Binding | Where | Purpose |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | Wrangler var (SDK `allowedOrigin`) | Exact HTTPS publisher origin |
| `ADROUTER_GATEWAY_ORIGIN` | Wrangler var | `https://adrouter-v3.fly.dev` |
| `ADROUTER_MODEL` | Wrangler var | Catalog model `deepseek-v4-flash` of the qualified connection |
| `TURNSTILE_SITE_KEY` | Pages secret, returned by `/api/config` | Public, hostname-specific widget key |
| `TURNSTILE_SECRET_KEY` | Pages secret (SDK `turnstileSecret`) | Turnstile success, hostname and `chat` action |
| `SESSION_SECRET` | Pages secret (SDK `sessionSigningSecret`) | Signs `__Host-adr_session` cookies; at least 32 random bytes |
| `REFERENCE_HMAC_SECRET` | Pages secret | Pseudonymous session and IP references; a separate value of at least 32 random bytes |
| `ADROUTER_APP_CREDENTIAL` | Pages secret | Publisher key issued in the AdRouter console |
| `ADROUTER_PROVIDER_CONNECTION_ID` | Pages secret | Qualified DeepSeek connection ID from the console (not a credential) |
| `ADROUTER_PLACEMENT_ID` | Pages secret | Reviewed placement ID from the console (not a credential) |
| `ADROUTER_ENABLED` | Pages secret, defaults to paused | Explicit publisher switch; chat is refused unless it is `true` |

`/api/config` reports enabled only when the switch is `true` and every binding is present. It
exposes only that state, the site key and the model ID. No Vite environment variables are needed.
The browser bundle never contains the character prompt or a server credential. The
`DEEPSEEK_API_KEY` and `STANDALONE_ENABLED` secrets from the standalone version are no longer
read; delete them after the first successful gateway turn.

## Deploy and enable

The project is `hearthside-chat` on Cloudflare Pages; production origin is
`https://hearthside-chat.pages.dev`. It uses direct upload, so merging a GitHub PR does not deploy
it. The deployment script rejects a dirty checkout or a commit differing from the fetched
`origin/main`. Select the account with `CLOUDFLARE_ACCOUNT_ID` in the deployment shell.

Enter credential values yourself at the interactive prompts. Never paste secret values into chat,
command arguments, source, logs or screenshots.

```sh
npx wrangler pages secret put ADROUTER_APP_CREDENTIAL --project-name hearthside-chat
npx wrangler pages secret put REFERENCE_HMAC_SECRET --project-name hearthside-chat
npx wrangler pages secret put ADROUTER_PROVIDER_CONNECTION_ID --project-name hearthside-chat
npx wrangler pages secret put ADROUTER_PLACEMENT_ID --project-name hearthside-chat
npm run deploy
```

Deploy first with `ADROUTER_ENABLED` unset, so the publisher stays paused. Enable in this order:

1. Gateway admission on.
2. Console readiness shows no blockers.
3. Enable the Hearthside app in the console.
4. Set `ADROUTER_ENABLED` to `true` with `wrangler pages secret put`, then `npm run deploy`.
5. Complete one gateway turn and confirm a successful model outcome in the console.
6. Delete `DEEPSEEK_API_KEY` and `STANDALONE_ENABLED` with `wrangler pages secret delete`, then
   `npm run deploy` again.

To pause, set `ADROUTER_ENABLED` to `false` and deploy, then pause the app in the console.

## Requests, storage and cost

Each turn creates a signed session, then sends the visible conversation and a fresh Turnstile
token to `/api/chat`. The Function verifies Turnstile and forwards the turn, with the server-owned
prompt, to the gateway. The gateway calls `deepseek-v4-flash` with thinking off and output capped
at 512 tokens. DeepSeek bills the publisher's own key, held in the gateway's encrypted provider
connection. This is not free inference. No automatic retries, fallback provider or paid replays
exist. Stop cancels the turn. An interrupted reply is shown as "interrupted, not kept" and is
never stored or sent back to the model. A paid call may already have been consumed even when no
answer completes; do not automatically resubmit it.

Gateway limits are 50 turns per session, 100 per IP, 1,000 per app and 2,000 overall per
Singapore day, with one active turn at a time. History sent to the model is limited to 14
messages and 12,000 UTF-8 bytes, dropping the oldest first and showing a notice. The latest
message is kept intact; an oversized latest message is rejected.

Up to 100 messages are saved in this browser's local storage, without any publisher database or
server transcript. "New story" clears them after confirmation. Do not use the chat for sensitive
personal information. Sensitive topics never receive a sponsored card, and the answer continues.

## Sponsored cards

Every card visibly shows "Sponsored", the advertiser, the title and body, and a destination link.
Pilot cards are fictional and also show "Demo campaign · fictional brand · not a paid placement";
their destination is AdRouter's fictional-brand disclaimer page. Card text stays outside model
messages, stored conversation and copied answers. Untick "Show sponsored suggestions" to opt out;
the answer is unchanged. A card counts as a test view only after at least half of it has been
visible for one continuous second in a focused window. Test views are not revenue, and no money
moves to the publisher in this pilot.

Licensed under MIT. The character and scene are fictional.

# Hearthside

A small character chat. Meet Rowan, the keeper of an imagined forest inn.
React/Vite serves the browser. A Cloudflare Pages Function calls DeepSeek with Hearthside's own
key, as the standalone version did. Separately, the page asks AdRouter for a sponsored suggestion
for the latest message and shows it beside a completed answer, using the
[AdRouter browser SDK](https://github.com/adrouter/browser-sdk) 0.4.0. If AdRouter is off, paused or
unreachable, Rowan answers exactly the same. The character prompt and every credential stay on the
server.

The standalone version, with no AdRouter code, is tag
[`v0.1-standalone`](https://github.com/HappyCool121/hearthside-chat/tree/v0.1-standalone). From
19 to 21 October 2026 Hearthside instead routed its inference through the AdRouter gateway; AdRouter
retired that path on 21 October (sponsor-only). [ONBOARDING-NOTES.md](ONBOARDING-NOTES.md) records the
friction of both integrations.

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
Functions with Wrangler. Chat requires the exact configured HTTPS origin, a Cloudflare trusted IP
and a real Turnstile widget. Tests inject synthetic Turnstile, DeepSeek and AdRouter responses; they
never make paid calls. `test:workerd` runs the built Functions in workerd, the Cloudflare runtime,
with every outbound fetch intercepted. Browser tests use Chromium and WebKit (install with
`npx playwright install chromium webkit`); WebKit emulation does not prove iPhone Safari.

The SDK is vendored as one file, `src/vendor/adrouter.min.js`, because 0.4.0 is a release candidate.
`src/vendor/SOURCE.json` records the Router commit it was built from and its SHA-256. Once 0.4.0 is
published, replace it with the release asset and check the hash.

## How the two halves fit

| Concern | Where |
| --- | --- |
| Rowan's answers | `/api/chat` → DeepSeek (`deepseek-v4-flash`, thinking off, 512 output tokens), Turnstile and a `__Host-hearthside` session cookie |
| History | The browser keeps up to 100 messages; 14 messages / 12,000 bytes go to the model, oldest dropped first with a notice |
| Sponsors | The page calls `adrouter.match(latest message)` alongside the chat request, with the app's publishable key from `/api/config`. The card appears only beside a complete answer |
| Measurement | The SDK reports rendered, viewed (half on screen for a second, tab visible) and clicked to AdRouter |
| Switches | `CHAT_ENABLED` for chat, `ADROUTER_ENABLED` for sponsors; independent |

## Binding inventory

| Binding | Where | Purpose |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | Wrangler var | Exact HTTPS publisher origin |
| `CHAT_ENABLED` | Pages secret, defaults to paused | Chat is refused unless it is `true` |
| `DEEPSEEK_API_KEY` | Pages secret | Hearthside's own DeepSeek key |
| `TURNSTILE_SITE_KEY` | Pages secret, returned by `/api/config` | Public, hostname-specific widget key |
| `TURNSTILE_SECRET_KEY` | Pages secret | Turnstile success, hostname and `chat` action |
| `SESSION_SECRET` | Pages secret | Signs `__Host-hearthside` cookies; at least 32 random bytes |
| `ADROUTER_ENABLED` | Pages secret, defaults to off | Sponsored suggestions are shown only when it is `true` |
| `ADROUTER_PUBLIC_KEY` | Pages secret, returned by `/api/config` | The app's publishable key (`v3pk_…`) from the AdRouter console; public by design, works only from `PUBLIC_ORIGIN` |

`/api/config` returns the chat state, the Turnstile site key and, when sponsors are on, the publishable
key and `https://api.adrouter.co`. The browser bundle never contains the character prompt, the
DeepSeek key or any other server credential. The gateway-era bindings `ADROUTER_APP_CREDENTIAL`,
`ADROUTER_PROVIDER_CONNECTION_ID`, `ADROUTER_PLACEMENT_ID`, `REFERENCE_HMAC_SECRET`,
`ADROUTER_GATEWAY_ORIGIN` and `ADROUTER_MODEL` are no longer read; delete them.

## Deploy and enable

The project is `hearthside-chat` on Cloudflare Pages; production origin is
`https://hearthside-chat.pages.dev`. It uses direct upload, so merging a GitHub PR does not deploy
it. The deployment script rejects a dirty checkout or a commit differing from the fetched
`origin/main`. Select the account with `CLOUDFLARE_ACCOUNT_ID` in the deployment shell.

Enter credential values yourself at the interactive prompts. Never paste secret values into chat,
command arguments, source, logs or screenshots.

```sh
npx wrangler pages secret put DEEPSEEK_API_KEY --project-name hearthside-chat
npx wrangler pages secret put ADROUTER_PUBLIC_KEY --project-name hearthside-chat
npm run deploy
```

Deploy first with `CHAT_ENABLED` and `ADROUTER_ENABLED` unset. Then:

1. Set `CHAT_ENABLED` to `true` and deploy; confirm Rowan answers.
2. In the AdRouter console, create a publishable key for the app; an owner reviews the site and enables the app.
3. Set `ADROUTER_ENABLED` to `true` and deploy; confirm a card appears beside an answer.

To pause sponsors only, set `ADROUTER_ENABLED` to `false` and deploy (or pause the app in the
console); chat continues. To pause chat, set `CHAT_ENABLED` to `false` and deploy.

## Requests, storage and cost

Each message creates or checks a signed session, then sends the visible conversation and a fresh
Turnstile token to `/api/chat`. The Function verifies Turnstile and calls DeepSeek once with the
server-owned prompt; DeepSeek bills Hearthside's own key. No automatic retries, fallback provider or
paid replays exist. Stop cancels the reply. An interrupted reply is never stored or sent back to the model.

When sponsors are on and the visitor has not opted out, the latest message (only that message) is sent
to AdRouter, which may keep it for up to 90 days to measure and improve sponsor matching. Up to 100
messages are saved in this browser's local storage, without any publisher database or server
transcript. "New story" clears them after confirmation. Do not use the chat for sensitive personal
information. Sensitive topics never receive a sponsored card, and the answer continues.

## Sponsored cards

Every card visibly shows "Sponsored", the advertiser, the title and body, and a destination link.
Demo cards are fictional and also show "Demo campaign · fictional brand · not a paid placement".
Card text stays outside model messages, stored conversation and copied answers. Untick "Show
sponsored suggestions" to opt out; nothing is sent to AdRouter and the answer is unchanged. Views are
counts, not revenue; no money moves to the publisher in this test.

Licensed under MIT. The character and scene are fictional.

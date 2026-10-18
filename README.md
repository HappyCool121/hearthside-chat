# Hearthside

A small character chat. Meet Rowan, the keeper of an imagined forest inn.
React/Vite serves the browser; a Cloudflare Pages Function calls DeepSeek directly and streams
the reply. The character prompt and provider key stay on the server. No publisher database,
analytics, gateway or advertising SDK is included in this standalone version.

## Run and verify

Requires Node.js 22.13 or newer and npm. Install exactly the locked dependencies:

```sh
npm ci
npm test
npm run build
npm run build:functions
npm run test:browser
```

`npm run dev` previews the interface only. `npm run preview` serves the built interface and
Functions with Wrangler. Inference requires the exact configured HTTPS origin, a Cloudflare
trusted IP and a real Turnstile widget. Tests inject synthetic transport responses; they never
make paid calls. Browser tests use Chromium and WebKit. Install their engines with
`npx playwright install chromium webkit` if needed. WebKit emulation does not prove iPhone Safari.

## Deploy to Cloudflare Pages

The project is `hearthside-chat`; production origin is `https://hearthside-chat.pages.dev`.
It uses direct upload, so merging a GitHub PR does not deploy it. Use Wrangler because the
deployment includes Functions. All release source and the lockfile must be reviewed and merged
before deployment. The deployment script rejects a dirty checkout or a commit differing from
the fetched `origin/main`.

```sh
git fetch origin main
git switch main
git merge --ff-only origin/main
npm ci
npx wrangler whoami
npm run deploy
```

Select the intended Cloudflare account with `CLOUDFLARE_ACCOUNT_ID` in the deployment shell.
The project must exist as a direct-upload Pages project with production branch `main`.

Create a managed Turnstile widget for `hearthside-chat.pages.dev`. Enter values yourself using
the interactive prompts below. Never paste secret values into chat, command arguments, source,
logs or screenshots. A session secret needs at least 32 random bytes from a password manager.

```sh
npx wrangler pages secret put TURNSTILE_SITE_KEY --project-name hearthside-chat
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name hearthside-chat
npx wrangler pages secret put SESSION_SECRET --project-name hearthside-chat
npx wrangler pages secret put DEEPSEEK_API_KEY --project-name hearthside-chat
```

When ready for the short standalone acceptance session, set `STANDALONE_ENABLED` to `true`
using the platform prompt, then deploy the same clean merged commit again so its bindings apply:

```sh
npx wrangler pages secret put STANDALONE_ENABLED --project-name hearthside-chat
npm run deploy
```

After desktop and iPhone Safari acceptance, set it to `false` with the same command and redeploy.
Only tag `v0.1-standalone` after the public chat has passed standalone acceptance. This tag records
the independent source baseline for the later onboarding PR.

## Binding inventory

| Binding | Visibility | Purpose |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | Public, in Wrangler config | Exact HTTPS origin for mutation checks |
| `TURNSTILE_SITE_KEY` | Public, returned by `/api/config` | Hostname-specific widget |
| `STANDALONE_ENABLED` | Public state, defaults to paused | Explicit direct-inference switch |
| `TURNSTILE_SECRET_KEY` | Server secret | Turnstile verification, hostname and `chat` action |
| `SESSION_SECRET` | Server secret | HMAC signing for `__Host-hearthside` cookies |
| `DEEPSEEK_API_KEY` | Server secret | Direct provider calls during standalone proof |

Only enabled state, the site key and model ID reach `/api/config`. No Vite environment variables
are needed. The browser bundle must never contain the character prompt or a server credential.
The session cookie is Secure, HttpOnly, SameSite=Strict and valid for one day. All mutating routes
reject other origins. The trusted IP header comes from Cloudflare; do not expose the Function
behind a proxy that permits the caller to choose it.

## Requests, storage and cost

Each turn verifies Turnstile on the server before one direct request to
`https://api.deepseek.com/chat/completions`. The model is `deepseek-v4-flash`, resolved from the
canonical model catalog on 18 October 2026 (catalog schema 2, digest
`sha256:82df16507c35823aa8256f958af1e22042935399ebfd273d819459e8fe859a19`). Thinking is
disabled and output is capped at 512 tokens. The provider bills the key's owner; this is not free
inference. No automatic provider retries, fallback provider, tool calls or paid replays exist.
The 60-second deadline and Stop button abort the upstream request. An interrupted reply is
removed from stored history and is not reported as completed. A paid call may already have been
consumed even when no answer completes; do not automatically resubmit it.

Requests are limited to 64 KiB. Browser history sent to the provider is limited to 14 messages and
12,000 UTF-8 bytes, dropping the oldest messages first and displaying a notice. The latest user
message is kept intact; an oversized latest message is rejected. These byte limits are not an
exact tokenizer. Input, output and Turnstile tokens are processed transiently and never logged
by application code. Disable request-body collection in any additional monitoring you configure.

Up to 100 messages are saved in this browser's local storage, without any server transcript.
“New story” clears that local transcript after confirmation. Do not use the chat for sensitive
personal information. The browser sends retained conversation text to the provider for inference.

## Standalone acceptance and later onboarding

Verify a completed response, Stop, an interrupted stream, reload persistence, “New story”,
visible history trimming, a narrow viewport and the real iPhone Safari keyboard. Record only
source SHA, deployment ID, date and pass/fail outcomes, without prompts or replies. P1 requires
working direct chat on the public URL before any gateway integration.

The reserved card area is empty in standalone. The later “Onboard to AdRouter” PR will follow
the public SDK README, install its release tarball, replace this direct adapter and client stream,
and record friction in `ONBOARDING-NOTES.md`. No direct-provider fallback may remain after cutover;
the operator deletes this project's DeepSeek secret after the gateway integration succeeds.
Sponsored cards must visibly say “Sponsored” and identify the advertiser. Fictional demo cards
also require “Demo campaign · fictional brand · not a paid placement”. Their text stays outside
model messages, stored conversation and copied answers.

Licensed under MIT. The character and scene are fictional.

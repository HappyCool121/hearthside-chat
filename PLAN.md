# Plan: Standalone Hearthside publisher

## Goal
Prove one independent character chat on its public Pages URL before any gateway integration.

## Context
The operator authorised the public HappyCool121/hearthside-chat repository and Pages deployment
on 18 October 2026. React/Vite and Pages Functions; one character, Rowan; direct DeepSeek
streaming using the catalog-resolved deepseek-v4-flash. No publisher database or gateway SDK.

## Research Summary
Cloudflare Pages Functions need Wrangler direct upload. Turnstile is validated on the server
against the exact hostname and chat action. Static headers do not replace Function response headers.

## Constraints
Secret entry remains operator-controlled. No secret files or values in source or receipts.
Build from a clean merged commit. Do not integrate before standalone acceptance is recorded.
No automatic paid retries. Source versions, deployment IDs and acceptance outcomes stay distinct.

## Out of Scope
Gateway integration, managed inference, payments, multiple characters and a publisher database.

## Reversibility
Chat is paused by default. Keep the standalone source and tag immutable after acceptance.
Integrate later in one reviewed successor PR. Preserve unknown paid outcomes; never replay them.

## Step A: Independent implementation
### Status
`review`
### Tasks
- [x] Server prompt, streamed provider adapter, bounded body, 512 output tokens.
- [x] Exact origin, hostname/action Turnstile and signed __Host- session cookie.
- [x] Browser history, visible UTF-8 trimming and responsive reserved placement.
- [x] Owning source, Functions, browser and package checks pass.
### Relevant Files
server/, functions/, shared/, src/, tests/, package.json, wrangler.jsonc
### Do Not Modify
Private credentials, browser sessions, existing published artifacts.
### Acceptance Criteria
- [x] Negative auth/body/stream scenarios pass; no retries and no browser credential leak.
- [x] Desktop and mobile browser layouts pass without horizontal overflow.
### Validation Results
Typecheck, 9 server tests, production browser/Functions builds, 3 Chromium/WebKit browser tests and npm audit pass. Desktop/mobile screenshots visually inspected. Physical iPhone and real-provider proof remain pending.

## Step B: Deployment and standalone proof
### Status
`done`
### Tasks
- [x] Review and merge source PR; deploy exact clean main through Wrangler.
- [x] Operator creates Turnstile widget and enters server secrets through platform prompts.
- [x] Operator verifies desktop and iPhone Safari chat; record P1 metadata and tag v0.1-standalone.
- [x] Pause direct inference after P1 before integration.
### Acceptance Criteria
- [x] Public standalone inference works; artifact IDs and P1 result recorded without chat content.
### Validation Results
P1 passed on 19 October 2026 (operator-attested): desktop Safari and physical iPhone Safari on
deployment 1f3c7412 from f40244d. Annotated tag v0.1-standalone points to f40244d. Paused again
in deployment 2dbff893 from the same commit: `/api/config` enabled false, chat 503 before any
provider call. Recorded in adrouter/operations #6.

## Step C: Final verification and cleanup
### Status
`todo`
### Tasks
- [ ] Review diff, secret scan, verify clean commit and deployed public bytes.
- [ ] Record remaining operator actions and acceptance limits.
### Acceptance Criteria
- [ ] No secrets, prompts, replies or private session content in acceptance receipts.
### Validation Results
Not run.

## Step D: Onboard to AdRouter
### Status
`review`
### Tasks
- [x] Verify and install the SDK 0.1.0 release tarball; follow only its public README and the console.
- [x] Replace the direct adapter, cookie and trimming with the SDK proxy, client and SponsoredCard.
- [x] Map existing bindings; add the paused-by-default ADROUTER_ENABLED switch and an opt-out.
- [x] Record friction in ONBOARDING-NOTES.md.
- [x] Operator reviews the binding inventory and merges; deploy paused; ordered activation.
- [x] First hosted test failed on SDK 0.1.0 (friction 12): install the SDK 0.1.1 release tarball and
      run the built Functions in workerd in CI.
- [ ] Deploy SDK 0.1.1 and complete one successful gateway turn.
- [ ] After the first successful gateway turn, delete DEEPSEEK_API_KEY and STANDALONE_ENABLED.
### Acceptance Criteria
- [x] No direct-provider code or fallback; paused publisher never reaches Turnstile or the gateway.
- [x] Card shows every required label and passes the SDK render and visibility checks in tests.
- [ ] P2 recorded after review; P3–P11 follow on the hosted gateway.
### Validation Results
Typecheck, 7 server tests, production browser/Functions builds, 4 workerd Functions tests,
4 Chromium/WebKit browser tests and npm audit pass. The first hosted test, on SDK 0.1.0, never
reached the gateway. SDK 0.1.1 is not yet exercised on the hosted gateway.

## Follow-up Work
P2–P11 acceptance on desktop and physical iPhone Safari after ordered activation.

## Decision Log
| Date | Decision | Rationale | Impact |
| --- | --- | --- | --- |
| 2026-10-18 | Independent standalone first; inference paused by default | Operator's execution sequence | P1 precedes SDK integration |
| 2026-10-19 | Core SDK client with React SponsoredCard, not useAdRouterChat | The hook cannot be seeded from browser history | Reload persistence and New story keep working |
| 2026-10-19 | Fix the Workers relay in SDK 0.1.1, not inside Hearthside | Released SDK bytes are immutable, and P2 follows only the public SDK | One dependency change; `test:workerd` guards the runtime |

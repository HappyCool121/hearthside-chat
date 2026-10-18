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
Typecheck, 8 server tests, production browser/Functions builds, 3 Chromium/WebKit browser tests and npm audit pass. Desktop/mobile screenshots visually inspected. Physical iPhone and real-provider proof remain pending.

## Step B: Deployment and standalone proof
### Status
`todo`
### Tasks
- [ ] Review and merge source PR; deploy exact clean main through Wrangler.
- [ ] Operator creates Turnstile widget and enters server secrets through platform prompts.
- [ ] Operator verifies desktop and iPhone Safari chat; record P1 metadata and tag v0.1-standalone.
- [ ] Pause direct inference after P1 before integration.
### Acceptance Criteria
- [ ] Public standalone inference works; artifact IDs and P1 result recorded without chat content.
### Validation Results
Not run.

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

## Follow-up Work
After P1, one onboarding PR installs the public release and removes the direct-provider secret.

## Decision Log
| Date | Decision | Rationale | Impact |
| --- | --- | --- | --- |
| 2026-10-18 | Independent standalone first; inference paused by default | Operator's execution sequence | P1 precedes SDK integration |

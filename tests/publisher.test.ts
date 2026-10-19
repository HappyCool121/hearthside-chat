import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SYSTEM, type Env } from '../server/adrouter.ts';
import { CSP, GATEWAY_ORIGIN, errorResponse, protect } from '../server/security.ts';
import { onRequestPost as chat } from '../functions/api/chat.ts';
import { onRequestPost as session } from '../functions/api/session.ts';
import { onRequestGet as config } from '../functions/api/config.ts';

const origin = 'https://hearthside-chat.pages.dev';
const env: Env = { PUBLIC_ORIGIN: origin, ADROUTER_GATEWAY_ORIGIN: GATEWAY_ORIGIN, ADROUTER_MODEL: 'deepseek-v4-flash',
  ADROUTER_ENABLED: 'true', ADROUTER_APP_CREDENTIAL: 'synthetic-app-credential-fixture',
  ADROUTER_PROVIDER_CONNECTION_ID: 'synthetic-connection', ADROUTER_PLACEMENT_ID: 'synthetic-placement',
  REFERENCE_HMAC_SECRET: 'synthetic-reference-fixture-32-characters', TURNSTILE_SITE_KEY: 'synthetic-public-site',
  TURNSTILE_SECRET_KEY: 'synthetic-server-challenge', SESSION_SECRET: 'synthetic-session-fixture-32-characters-long' };
const context = (request: Request, bindings: Env = env) => ({ request, env: bindings, next: async () => new Response() }) as never;

type Call = { url: string; init?: RequestInit };
function transport(verify: object = { success: true, hostname: 'hearthside-chat.pages.dev', action: 'chat' }) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('siteverify')) return Response.json(verify);
    return new Response('{"type":"turn.started"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}
async function cookie(bindings: Env = env) {
  const response = await session(context(new Request(origin + '/api/session', { method: 'POST', headers: { Origin: origin } }), bindings));
  assert.equal(response.status, 200);
  const value = response.headers.get('Set-Cookie')!;
  assert.match(value, /^__Host-adr_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  return value.split(';')[0];
}
async function turn(bindings: Env = env, headers: Record<string, string> = {}) {
  return new Request(origin + '/api/chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
    'CF-Connecting-IP': '192.0.2.1', 'Idempotency-Key': crypto.randomUUID(), Cookie: await cookie(bindings), ...headers },
  body: JSON.stringify({ contract_version: '3.0-mvp.1', interaction_id: crypto.randomUUID(), created_at: new Date().toISOString(),
    messages: [{ role: 'user', content: 'A synthetic test.' }], sponsorship_enabled: true, turnstile_token: 'synthetic-one-use-token' }) });
}

test('a paused or incomplete publisher refuses chat before Turnstile or the gateway', async () => {
  for (const bindings of [{ ...env, ADROUTER_ENABLED: 'false' }, { ...env, ADROUTER_ENABLED: undefined },
    { ...env, ADROUTER_APP_CREDENTIAL: undefined }, { ...env, ADROUTER_PLACEMENT_ID: '' }]) {
    const request = await turn({ ...env, SESSION_SECRET: bindings.SESSION_SECRET });
    const mock = transport();
    try {
      const response = await chat(context(request, bindings));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'app_disabled');
      assert.equal(mock.calls.length, 0);
    } finally { mock.restore(); }
  }
});

test('configuration reports enabled only with the switch and every binding, and exposes no server value', async () => {
  assert.equal((await config(context(new Request(origin), env)).json()).enabled, true);
  for (const name of ['ADROUTER_ENABLED', 'ADROUTER_APP_CREDENTIAL', 'ADROUTER_PROVIDER_CONNECTION_ID', 'ADROUTER_PLACEMENT_ID',
    'REFERENCE_HMAC_SECRET', 'TURNSTILE_SECRET_KEY', 'SESSION_SECRET'] as const)
    assert.equal((await config(context(new Request(origin), { ...env, [name]: undefined })).json()).enabled, false, name);
  const raw = await config(context(new Request(origin), env)).text();
  for (const secret of [env.ADROUTER_APP_CREDENTIAL!, env.REFERENCE_HMAC_SECRET!, env.TURNSTILE_SECRET_KEY!, env.SESSION_SECRET!, SYSTEM])
    assert.ok(!raw.includes(secret));
});

test('one verified turn goes only to the gateway, with the server prompt, mapped bindings and catalog model', async () => {
  const request = await turn(); const mock = transport();
  try {
    const response = await chat(context(request));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"type":"turn.started"}\n');
    assert.deepEqual(mock.calls.map(call => call.url), ['https://challenges.cloudflare.com/turnstile/v0/siteverify', GATEWAY_ORIGIN + '/v3/gateway/turns']);
    assert.equal(JSON.parse(String(mock.calls[0].init?.body)).secret, env.TURNSTILE_SECRET_KEY);
    const headers = new Headers(mock.calls[1].init?.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${env.ADROUTER_APP_CREDENTIAL}`);
    const payload = JSON.parse(String(mock.calls[1].init?.body));
    assert.equal(payload.inference_mode, 'byok'); assert.equal(payload.model, 'deepseek-v4-flash');
    assert.equal(payload.provider_connection_id, env.ADROUTER_PROVIDER_CONNECTION_ID);
    assert.deepEqual(payload.sponsorship, { enabled: true, placement_id: env.ADROUTER_PLACEMENT_ID });
    assert.equal(payload.max_output_tokens, 512);
    assert.deepEqual(payload.messages[0], { role: 'system', content: SYSTEM });
    assert.equal(payload.messages.length, 2);
    assert.ok(!JSON.stringify(payload).includes('synthetic-one-use-token'));
  } finally { mock.restore(); }
});

test('Turnstile hostname, action and success are enforced before the gateway is called', async () => {
  for (const verify of [{ success: false }, { success: true, hostname: 'other.example', action: 'chat' },
    { success: true, hostname: 'hearthside-chat.pages.dev', action: 'other' }]) {
    const request = await turn(); const mock = transport(verify);
    try {
      const response = await chat(context(request));
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'turnstile_failed');
      assert.equal(mock.calls.length, 1);
    } finally { mock.restore(); }
  }
});

test('foreign origins and missing trusted IPs make no external calls', async () => {
  for (const headers of [{ Origin: 'https://other.example' }, { 'CF-Connecting-IP': '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const request = await turn(env, headers); const mock = transport();
    try {
      assert.equal((await chat(context(request))).status, 403);
      assert.equal(mock.calls.length, 0);
    } finally { mock.restore(); }
  }
});

test('security headers allow only the gateway measurement origin and keep streams untransformed', async () => {
  assert.ok(CSP.includes(`connect-src 'self' https://challenges.cloudflare.com ${GATEWAY_ORIGIN};`));
  assert.ok(readFileSync('public/_headers', 'utf8').includes(`Content-Security-Policy: ${CSP}\n`));
  assert.equal(JSON.parse(readFileSync('wrangler.jsonc', 'utf8')).vars.ADROUTER_GATEWAY_ORIGIN, GATEWAY_ORIGIN);
  const streamed = protect(new Response('x', { headers: { 'Cache-Control': 'no-store, no-transform' } }));
  assert.equal(streamed.headers.get('Cache-Control'), 'no-store, no-transform');
  assert.equal(protect(new Response('x')).headers.get('Cache-Control'), 'no-store');
  const error = errorResponse();
  assert.equal(error.status, 503); assert.equal((await error.json()).error.code, 'service_unavailable');
  assert.match(error.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/);
});

test('no direct provider path, provider credential or standalone switch remains', () => {
  for (const file of ['server/adrouter.ts', 'server/security.ts', 'functions/_middleware.ts', 'functions/api/chat.ts',
    'functions/api/config.ts', 'functions/api/session.ts', 'src/main.tsx', 'wrangler.jsonc'])
    assert.doesNotMatch(readFileSync(file, 'utf8'), /api\.deepseek\.com|DEEPSEEK_API_KEY|STANDALONE_ENABLED/, file);
});

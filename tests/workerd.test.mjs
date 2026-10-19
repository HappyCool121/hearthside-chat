import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Runs the built Functions bundle in workerd, the Cloudflare runtime. Every outbound fetch is
// intercepted, so these tests make no network or paid calls.
const script = await readFile('output/functions/index.js', 'utf8');
const origin = 'https://hearthside-chat.pages.dev';
const GATEWAY = 'https://adrouter-v3.fly.dev';
const bindings = { PUBLIC_ORIGIN: origin, ADROUTER_GATEWAY_ORIGIN: GATEWAY, ADROUTER_MODEL: 'deepseek-v4-flash',
  ADROUTER_ENABLED: 'true', ADROUTER_APP_CREDENTIAL: 'synthetic-app-credential-fixture',
  ADROUTER_PROVIDER_CONNECTION_ID: 'synthetic-connection', ADROUTER_PLACEMENT_ID: 'synthetic-placement',
  REFERENCE_HMAC_SECRET: randomBytes(32).toString('hex'), TURNSTILE_SITE_KEY: 'synthetic-public-site',
  TURNSTILE_SECRET_KEY: 'synthetic-server-challenge', SESSION_SECRET: randomBytes(32).toString('hex') };
const STREAM = '{"type":"turn.started"}\n{"type":"turn.completed"}\n';
const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '192.0.2.1' };

async function start(overrides = {}, gateway = () => new Response(STREAM, { headers: { 'Content-Type': 'application/x-ndjson' } })) {
  const calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'hearthside', modules: true, script, compatibilityDate: '2026-10-18',
    bindings: { ...bindings, ...overrides }, serviceBindings: { ASSETS: () => new Response('Not found', { status: 404 }) },
    outboundService: async request => {
      const url = new URL(request.url), body = await request.text();
      calls.push({ method: request.method, url: url.origin + url.pathname, authorization: request.headers.get('Authorization'), body });
      if (url.origin === 'https://challenges.cloudflare.com') return Response.json({ success: true, hostname: 'hearthside-chat.pages.dev', action: 'chat' });
      if (url.origin === GATEWAY) return gateway(url);
      return new Response('Unexpected outbound request', { status: 599 });
    } }));
  const session = await mf.dispatchFetch(origin + '/api/session', { method: 'POST', headers });
  assert.equal(session.status, 200);
  return { mf, calls, cookie: session.headers.get('Set-Cookie').split(';')[0] };
}
const chat = (mf, cookie) => mf.dispatchFetch(origin + '/api/chat', { method: 'POST',
  headers: { ...headers, Cookie: cookie, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
  body: JSON.stringify({ contract_version: '3.0-mvp.1', interaction_id: crypto.randomUUID(), created_at: new Date().toISOString(),
    messages: [{ role: 'user', content: 'A synthetic test.' }], sponsorship_enabled: true, turnstile_token: 'synthetic-one-use-token' }) });

test('chat verifies Turnstile once and streams the gateway reply in workerd', async () => {
  const { mf, calls, cookie } = await start();
  try {
    const response = await chat(mf, cookie);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/x-ndjson');
    assert.match(response.headers.get('Cache-Control'), /no-transform/);
    assert.equal(await response.text(), STREAM);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url}`),
      ['POST https://challenges.cloudflare.com/turnstile/v0/siteverify', `POST ${GATEWAY}/v3/gateway/turns`]);
    const turn = JSON.parse(calls[1].body);
    assert.equal(calls[1].authorization, 'Bearer synthetic-app-credential-fixture');
    assert.equal(turn.messages[0].role, 'system');
    assert.match(turn.messages[0].content, /You are Rowan/);
    assert.equal(turn.provider_connection_id, 'synthetic-connection');
    assert.equal(turn.sponsorship.placement_id, 'synthetic-placement');
    assert.equal(calls[1].body.includes('192.0.2.1'), false);
  } finally { await mf.dispose(); }
});

test('status, cancel, feedback and client events relay to the gateway in workerd', async () => {
  const { mf, calls, cookie } = await start({}, () => Response.json({}));
  try {
    const post = (path, body) => mf.dispatchFetch(origin + path, { method: 'POST',
      headers: { ...headers, Cookie: cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const responses = [
      await mf.dispatchFetch(origin + '/api/turns/synthetic-turn', { headers: { ...headers, Cookie: cookie } }),
      await post('/api/turns/synthetic-turn/cancel'),
      await post('/api/feedback', { contract_version: '3.0-mvp.1', feedback_id: crypto.randomUUID(), turn_id: 'synthetic-turn', answer: 'helpful' }),
      await post('/api/client-events', { contract_version: '3.0-mvp.1', event_id: crypto.randomUUID(), turn_id: 'synthetic-turn',
        type: 'stream_completed', occurred_at: new Date().toISOString(), sdk_version: '0.1.1' })];
    assert.deepEqual(responses.map(response => response.status), [200, 200, 200, 200]);
    assert.deepEqual(calls.map(call => `${call.method} ${call.url}`), [`GET ${GATEWAY}/v3/gateway/turns/synthetic-turn`,
      `POST ${GATEWAY}/v3/gateway/turns/synthetic-turn/cancel`, `POST ${GATEWAY}/v3/publisher/feedback`, `POST ${GATEWAY}/v3/publisher/client-events`]);
  } finally { await mf.dispose(); }
});

test('paused publisher refuses chat in workerd with no outbound call', async () => {
  const { mf, calls, cookie } = await start({ ADROUTER_ENABLED: 'false' });
  try {
    const response = await chat(mf, cookie);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'app_disabled');
    assert.equal(calls.length, 0);
  } finally { await mf.dispose(); }
});

test('a gateway redirect is refused, not followed or forwarded, in workerd', async () => {
  const { mf, calls, cookie } = await start({}, () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/' } }));
  try {
    const response = await chat(mf, cookie);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'service_unavailable');
    assert.equal(response.headers.has('Location'), false);
    assert.deepEqual(calls.map(call => call.url), ['https://challenges.cloudflare.com/turnstile/v0/siteverify', `${GATEWAY}/v3/gateway/turns`]);
  } finally { await mf.dispose(); }
});

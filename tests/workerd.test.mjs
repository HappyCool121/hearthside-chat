import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Runs the built Functions bundle in workerd, the Cloudflare runtime. Every outbound fetch is
// intercepted, so these tests make no network or paid calls.
const script = await readFile('output/functions/index.js', 'utf8');
const origin = 'https://hearthside-chat.pages.dev';
const bindings = { PUBLIC_ORIGIN: origin, CHAT_ENABLED: 'true', TURNSTILE_SITE_KEY: 'synthetic-public-site',
  TURNSTILE_SECRET_KEY: 'synthetic-server-challenge', SESSION_SECRET: randomBytes(32).toString('hex'), DEEPSEEK_API_KEY: 'synthetic-provider-fixture',
  ADROUTER_ENABLED: 'true', ADROUTER_PUBLIC_KEY: 'v3pk_00000000-0000-4000-8000-000000000001_' + 'p'.repeat(43) };
const STREAM = 'data: {"choices":[{"delta":{"content":"Synthetic reply."},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const headers = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '192.0.2.1' };

async function start(overrides = {}) {
  const calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'hearthside', modules: true, script, compatibilityDate: '2026-10-18',
    bindings: { ...bindings, ...overrides }, serviceBindings: { ASSETS: () => new Response('Not found', { status: 404 }) },
    outboundService: async request => {
      const url = new URL(request.url); await request.text();
      calls.push(`${request.method} ${url.origin}${url.pathname}`);
      if (url.origin === 'https://challenges.cloudflare.com') return Response.json({ success: true, hostname: 'hearthside-chat.pages.dev', action: 'chat' });
      if (url.origin === 'https://api.deepseek.com') return new Response(STREAM, { headers: { 'Content-Type': 'text/event-stream' } });
      return new Response('Unexpected outbound request', { status: 599 });
    } }));
  return { mf, calls };
}
async function chat(mf) {
  const session = await mf.dispatchFetch(origin + '/api/session', { method: 'POST', headers });
  assert.equal(session.status, 200);
  return mf.dispatchFetch(origin + '/api/chat', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json',
    Cookie: session.headers.get('Set-Cookie').split(';')[0] },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'A synthetic test.' }], turnstile: 'synthetic-one-use-token' }) });
}

test('workerd: Rowan answers through DeepSeek directly; AdRouter is never called by the server', async () => {
  const { mf, calls } = await start();
  try {
    const reply = await chat(mf);
    assert.equal(reply.status, 200);
    assert.equal(await reply.text(), '{"type":"text","text":"Synthetic reply."}\n{"type":"done"}\n');
    assert.equal(reply.headers.get('Cache-Control'), 'no-store, no-transform');
    assert.match(reply.headers.get('Content-Security-Policy'), /connect-src [^;]*https:\/\/api\.adrouter\.co/);
    assert.deepEqual(calls, ['POST https://challenges.cloudflare.com/turnstile/v0/siteverify', 'POST https://api.deepseek.com/chat/completions']);
    const config = await (await mf.dispatchFetch(origin + '/api/config')).json();
    assert.equal(config.enabled, true);
    assert.deepEqual(config.sponsors, { publicKey: bindings.ADROUTER_PUBLIC_KEY, apiOrigin: 'https://api.adrouter.co' });
  } finally { await mf.dispose(); }
});

test('workerd: with sponsors off the chat is unchanged; with chat paused nothing paid starts', async () => {
  const ads = await start({ ADROUTER_ENABLED: 'false' });
  try {
    assert.equal((await chat(ads.mf)).status, 200);
    assert.equal((await (await ads.mf.dispatchFetch(origin + '/api/config')).json()).sponsors, null);
  } finally { await ads.mf.dispose(); }
  const paused = await start({ CHAT_ENABLED: 'false' });
  try {
    const reply = await chat(paused.mf);
    assert.equal(reply.status, 503); assert.deepEqual(await reply.json(), { error: 'chat_paused' });
    assert.deepEqual(paused.calls, []);
  } finally { await paused.mf.dispose(); }
});

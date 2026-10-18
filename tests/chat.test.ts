import assert from 'node:assert/strict';
import test from 'node:test';
import { chat, MODEL } from '../server/chat.ts';
import { boundedJson, errorResponse, issueSession, verifySession, type Bindings } from '../server/security.ts';
import { trimHistory } from '../shared/history.ts';
import { onRequestGet } from '../functions/api/config.ts';
const origin = 'https://hearthside-chat.pages.dev';
const env: Bindings = { PUBLIC_ORIGIN: origin, STANDALONE_ENABLED: 'true', SESSION_SECRET: 'synthetic-session-fixture-32-characters-long',
  TURNSTILE_SITE_KEY: 'synthetic-public-site', TURNSTILE_SECRET_KEY: 'synthetic-server-challenge', DEEPSEEK_API_KEY: 'synthetic-provider-fixture' };
async function request(body: unknown = { messages: [{ role: 'user', content: 'A synthetic test.' }], turnstile: 'synthetic-one-use-token' }, headers = {}, now?: number) {
  return new Request(origin + '/api/chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
    'CF-Connecting-IP': '192.0.2.1', Cookie: (await issueSession(env, now)).split(';')[0], ...headers }, body: JSON.stringify(body) });
}
function transport(options: { verify?: object; status?: number; stream?: string } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('siteverify')) return Response.json(options.verify ?? { success: true, hostname: 'hearthside-chat.pages.dev', action: 'chat' });
    return new Response(options.stream ?? 'data: {"choices":[{"delta":{"content":"Synthetic reply."},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: options.status ?? 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  return { calls, fetcher: fetcher as typeof fetch };
}
test('sessions reject tampering, expiry, duplicate cookies and a foreign signing key', async () => {
  const req = await request(); assert.match(await verifySession(req, env), /^[0-9a-f-]{36}$/);
  const cookie = req.headers.get('Cookie')!;
  for (const value of [cookie + 'x', cookie + '; ' + cookie]) {
    await assert.rejects(verifySession(await request(undefined, { Cookie: value }), env), { code: 'session_required' });
  }
  await assert.rejects(verifySession(req, { ...env, SESSION_SECRET: 'different-synthetic-fixture-long-enough' }), { code: 'session_required' });
  await assert.rejects(verifySession(await request(undefined, {}, Date.now() - 86_401_000), env), { code: 'session_required' });
  assert.match(await issueSession(env), /; Path=\/; Secure; HttpOnly; SameSite=Strict;/);
});
test('pause, origin, trusted IP and input rejection make no external calls', async () => {
  const mock = transport();
  await assert.rejects(chat(await request(), { ...env, STANDALONE_ENABLED: 'false' }, mock.fetcher), { code: 'chat_paused' });
  for (const headers of [{ Origin: 'https://other.example' }, { 'CF-Connecting-IP': '' }, { 'Sec-Fetch-Site': 'cross-site' }])
    await assert.rejects(chat(await request(undefined, headers), env, mock.fetcher));
  for (const body of [{ messages: [{ role: 'system', content: 'Injected prompt' }], turnstile: 't' },
    { messages: [{ role: 'user', content: 'x' }], turnstile: 't', model: 'other' },
    { messages: [{ role: 'user', content: '🦉'.repeat(4000) }], turnstile: 't' }])
    await assert.rejects(chat(await request(body), env, mock.fetcher));
  assert.equal(mock.calls.length, 0);
});
test('fresh server Turnstile validation binds the hostname and action before payment', async () => {
  for (const verify of [{ success: false }, { success: true, hostname: 'other.example', action: 'chat' },
    { success: true, hostname: 'hearthside-chat.pages.dev', action: 'other' }]) {
    const mock = transport({ verify });
    await assert.rejects(chat(await request(), env, mock.fetcher), { code: 'verification_failed' });
    assert.equal(mock.calls.length, 1);
  }
});
test('one direct call streams only text with server prompt, catalog model and 512 output tokens', async () => {
  const mock = transport(); const response = await chat(await request(), env, mock.fetcher);
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events, [{ type: 'text', text: 'Synthetic reply.' }, { type: 'done' }]);
  assert.equal(mock.calls.length, 2);
  const payload = JSON.parse(String(mock.calls[1].init?.body));
  assert.equal(payload.model, MODEL); assert.equal(payload.max_tokens, 512); assert.deepEqual(payload.thinking, { type: 'disabled' });
  assert.equal(payload.messages[0].role, 'system'); assert.match(payload.messages[0].content, /Rowan/);
  assert.equal(payload.messages.length, 2);
  assert.equal(mock.calls[1].url, 'https://api.deepseek.com/chat/completions');
});
test('provider errors and incomplete or malformed streams never retry or report success', async () => {
  const failed = transport({ status: 500 });
  await assert.rejects(chat(await request(), env, failed.fetcher), { code: 'provider_unavailable' });
  assert.equal(failed.calls.length, 2);
  for (const stream of ['data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
    'data: not-json\n\n', 'data: {"choices":[{"delta":{"reasoning_content":"Hidden"}}]}\n\n',
    'data: ' + 'x'.repeat(65_537) + '\n']) {
    const mock = transport({ stream }); const body = await (await chat(await request(), env, mock.fetcher)).text();
    assert.match(body, /"type":"error"/); assert.doesNotMatch(body, /"type":"done"/);
    assert.equal(mock.calls.length, 2);
  }
});
test('body bounds count streamed UTF-8 bytes even without content-length', async () => {
  const req = new Request(origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(65_537) });
  await assert.rejects(boundedJson(req), { code: 'body_too_large' });
});
test('Unicode history trims oldest messages visibly and preserves the entire latest message', () => {
  const latest = { role: 'user' as const, content: '🦉 The latest message.' };
  const messages = [...Array.from({ length: 20 }, () => ({ role: 'assistant' as const, content: 'é'.repeat(1000) })), latest];
  const result = trimHistory(messages);
  assert.ok(result.removed > 0); assert.ok(result.messages.length <= 14);
  assert.ok(new TextEncoder().encode(JSON.stringify(result.messages)).length <= 12_000);
  assert.deepEqual(result.messages.at(-1), latest);
  assert.throws(() => trimHistory([{ ...latest, content: '🦉'.repeat(4000) }]));
});
test('public configuration and sanitized errors expose no server values', async () => {
  const response = onRequestGet({ env } as never); const raw = await response.text();
  for (const secret of [env.DEEPSEEK_API_KEY!, env.SESSION_SECRET!, env.TURNSTILE_SECRET_KEY!]) assert.ok(!raw.includes(secret));
  const error = errorResponse(new Error('synthetic-private-upstream-detail'));
  assert.equal(error.status, 503); assert.ok(!(await error.text()).includes('synthetic-private-upstream-detail'));
  assert.equal(error.headers.get('Cache-Control'), 'no-store');
  assert.match(error.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/);
});

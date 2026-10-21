import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium, webkit } from 'playwright';

const root = resolve('dist');
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + new URL(req.url, 'http://local').pathname.replace(/\/$/, '/index.html'));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir('output/browser', { recursive: true });
const API = 'https://api.adrouter.co';
const PUBLIC_KEY = 'v3pk_00000000-0000-4000-8000-000000000001_' + 'p'.repeat(43);
const DEMO = 'Demo campaign · fictional brand · not a paid placement';
const creative = { advertiser_name: 'Synthetic Lantern Co', title: 'A synthetic lantern for long evenings',
  body: 'Synthetic body copy for a fictional brand.', destination_url: 'https://app-staging.adrouter.co/demo-sponsors/#synthetic-lantern' };
const offer = () => { const issued = new Date(); return { contract_version: '3.1-match.1', request_id: crypto.randomUUID(), outcome: 'offer', reason: null, replayed: false,
  offer: { offer_id: crypto.randomUUID(), request_id: crypto.randomUUID(), placement_id: crypto.randomUUID(), creative_revision_id: crypto.randomUUID(),
    disclosure: 'Sponsored', synthetic: true, creative, issued_at: issued.toISOString(), expires_at: new Date(issued.getTime() + 3600_000).toISOString(),
    reporting_receipt: 'synthetic-receipt', measurement: { minimum_ratio: 0.5, continuous_ms: 1000 } } }; };
const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization,Content-Type,Idempotency-Key', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
const reply = text => `{"type":"text","text":${JSON.stringify(text)}}\n{"type":"done"}\n`;
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('hearthside.conversation.v1')));
async function open(browserType, viewport, adrouter = 'offer') {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  const state = { errors: [], chats: [], matches: [], events: [], adrouter, chat: 'complete' };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({ contentType: 'text/javascript', body:
    `window.turnstile={render(el,options){window.testChallenge=options;options.callback('synthetic-browser-token');return 'fixture';},reset(){window.testChallenge.callback('synthetic-browser-token');},remove(){}};` }));
  await page.route('**/api/config', route => route.fulfill({ json: { enabled: true, siteKey: 'synthetic-public-key', model: 'deepseek-v4-flash',
    sponsors: { publicKey: PUBLIC_KEY, apiOrigin: API } } }));
  await page.route('**/api/session', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/chat', route => {
    state.chats.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'application/x-ndjson',
      body: state.chat === 'interrupted' ? '{"type":"text","text":"Synthetic partial reply."}\n{"type":"error","error":"provider_unavailable"}\n' : reply('Synthetic completed reply.') });
  });
  await page.route(API + '/**', async route => {
    const request = route.request();
    if (state.adrouter === 'down') return route.abort('connectionrefused');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.url().endsWith('/v3/sponsor/match')) {
      state.matches.push({ body: request.postDataJSON(), authorization: request.headers().authorization });
      return route.fulfill({ headers: cors, json: offer() });
    }
    const event = request.postDataJSON().events[0]; state.events.push(event.type);
    return route.fulfill({ status: 202, headers: cors, json: { results: [{ event_id: event.event_id, result: 'accepted',
      qualification: event.type === 'visibility' ? 'qualified_test_view' : 'not_qualified', reason: null }] } });
  });
  await page.goto(origin);
  await page.getByRole('heading', { name: 'A conversation with Rowan' }).waitFor();
  return { browser, page, state };
}
async function send(page, text) {
  await page.getByLabel('Your message to Rowan').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

try {
  for (const [name, browserType, viewport] of [['desktop-chromium', chromium, { width: 1440, height: 1000 }], ['mobile-webkit', webkit, { width: 390, height: 844 }]]) {
    test(name, async () => {
      const { browser, page, state } = await open(browserType, viewport);
      try {
        await page.getByRole('button', { name: 'Tell me about this place.' }).click();
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByText('Synthetic completed reply.', { exact: true }).waitFor();
        assert.deepEqual(state.chats[0].messages, [{ role: 'user', content: 'Tell me about this place.' }]);
        assert.equal(state.matches.length, 1);
        assert.equal(state.matches[0].body.prompt, 'Tell me about this place.', 'only the latest message goes to AdRouter');
        assert.equal(state.matches[0].authorization, 'Bearer ' + PUBLIC_KEY);

        // The card sits in the reserved space with its label and link, and the SDK reports it rendered and viewed.
        const card = page.locator('.adr-card');
        await card.waitFor();
        for (const text of ['Sponsored', creative.advertiser_name, creative.title, creative.body, DEMO])
          assert.ok(await card.getByText(text, { exact: true }).isVisible(), text);
        assert.equal(await card.getByRole('link', { name: 'Visit sponsor' }).getAttribute('href'), creative.destination_url);
        await card.scrollIntoViewIfNeeded();
        for (let i = 0; i < 40 && !state.events.includes('visibility'); i++) await page.waitForTimeout(100);
        assert.ok(state.events.includes('rendered')); assert.ok(state.events.includes('visibility'));
        await page.screenshot({ path: `output/browser/${name}.png`, fullPage: true });

        // Sponsor copy stays out of the stored conversation and the next model request.
        assert.ok(!JSON.stringify(await stored(page)).includes(creative.advertiser_name));
        await send(page, 'A second synthetic message');
        await page.getByText('Synthetic completed reply.', { exact: true }).nth(1).waitFor();
        assert.ok(!JSON.stringify(state.chats[1]).includes(creative.advertiser_name));

        // Opting out sends nothing to AdRouter.
        await page.getByLabel('Show sponsored suggestions').uncheck();
        assert.equal(await page.locator('.adr-card').count(), 0);
        await send(page, 'A third synthetic message');
        await page.getByText('Synthetic completed reply.', { exact: true }).nth(2).waitFor();
        assert.equal(state.matches.length, 2);
        await page.getByLabel('Show sponsored suggestions').check();

        // An interrupted reply never gets a card and is never stored as history.
        state.chat = 'interrupted';
        await send(page, 'Synthetic interrupted turn');
        await page.getByRole('alert').waitFor();
        assert.equal(await page.locator('.adr-card').count(), 0);
        assert.ok(!(await stored(page)).some(message => message.content === 'Synthetic partial reply.'));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(state.errors, []);
      } finally { await browser.close(); }
    });
  }
  test('with AdRouter unreachable Rowan answers, with no card and no page error', async () => {
    const { browser, page, state } = await open(chromium, { width: 1200, height: 900 }, 'down');
    try {
      await send(page, 'Is there a story behind that forest?');
      await page.getByText('Synthetic completed reply.', { exact: true }).waitFor();
      assert.equal(await page.locator('.adr-card').count(), 0);
      assert.ok(await page.getByText('A little space beside the story.').isVisible());
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.deepEqual(state.errors, []);
    } finally { await browser.close(); }
  });
  test('paused chat renders clearly and never starts paid requests', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(); let calls = 0;
      await page.route('**/api/config', route => route.fulfill({ json: { enabled: false, siteKey: '', model: 'deepseek-v4-flash', sponsors: null } }));
      await page.route('**/api/chat', route => { calls++; return route.abort(); });
      await page.goto(origin); await page.getByText(/The inn is resting/).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Send message' }).isDisabled(), true);
      assert.equal(await page.getByLabel('Show sponsored suggestions').count(), 0);
      assert.equal(calls, 0);
    } finally { await browser.close(); }
  });
  test('the browser bundle holds no server prompt, provider address or secret', async () => {
    const assets = (await readdir(resolve(root, 'assets'))).filter(file => file.endsWith('.js'));
    const bundle = (await Promise.all(assets.map(file => readFile(resolve(root, 'assets', file), 'utf8')))).join('\n');
    assert.ok(bundle.includes('/v3/sponsor/match'));
    for (const forbidden of ['You are Rowan', 'api.deepseek.com', 'DEEPSEEK_API_KEY', 'TURNSTILE_SECRET_KEY', 'SESSION_SECRET'])
      assert.ok(!bundle.includes(forbidden), forbidden);
    assert.doesNotMatch(bundle, /v3_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}/, 'no AdRouter secret key');
  });
} finally {
  // Node's test queue runs after module evaluation; close after the queued tests finish.
  test.after(() => new Promise(resolve => server.close(resolve)));
}

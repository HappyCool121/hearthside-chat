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
const CONTRACT = '3.0-mvp.1';
const DEMO = 'Demo campaign · fictional brand · not a paid placement';
const creative = { advertiser_name: 'Synthetic Lantern Co', title: 'A synthetic lantern for long evenings',
  body: 'Synthetic body copy for a fictional brand.', destination_url: 'https://app-staging.adrouter.co/demo-sponsors/#synthetic-lantern' };
function events(mode, interaction) {
  const turn = crypto.randomUUID(); let sequence = 0;
  const event = (type, data) => JSON.stringify({ type, turn_id: turn, sequence: ++sequence, data }) + '\n';
  const offer = { offer_id: crypto.randomUUID(), interaction_id: interaction, placement_id: 'synthetic-placement',
    creative_revision_id: 'synthetic-revision', disclosure: 'Sponsored', synthetic: true, creative,
    issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 300_000).toISOString(),
    reporting_receipt: 'synthetic-receipt', measurement: { minimum_ratio: 0.5, continuous_ms: 1000 } };
  const usage = { status: 'known', input_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 5, estimated_cost_microusd: 1, rate_revision: 'synthetic' };
  let body = event('turn.started', { interaction_id: interaction, contract_version: CONTRACT });
  if (mode === 'interrupted') return { turn, body: body + event('model.delta', { text: 'Synthetic partial reply.' }) };
  body += event('model.delta', { text: 'Synthetic completed reply.' });
  body += mode === 'offer' ? event('sponsor.offer', offer) : event('sponsor.none', { reason: 'opt_out' });
  body += event('model.completed', { finish_reason: 'stop' }) + event('usage.final', usage) + event('turn.completed', { state: 'completed' });
  return { turn, body };
}
const status = (turn, interaction, success) => ({ contract_version: CONTRACT, turn_id: turn, interaction_id: interaction,
  state: success ? 'completed' : 'interrupted', model_outcome: success ? 'success' : 'unknown', sponsor_outcome: 'none', offer_id: null,
  usage: null, created_at: new Date().toISOString(), finished_at: null, safe_error_code: null });
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('hearthside.conversation.v1')));

try {
  for (const [name, browserType, viewport] of [['desktop-chromium', chromium, { width: 1440, height: 1000 }],
    ['mobile-webkit', webkit, { width: 390, height: 844 }]]) {
    test(name, async () => {
      const browser = await browserType.launch();
      try {
        const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const requests = [], measurements = [], turns = new Map();
        let mode = 'offer';
        await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({ contentType: 'text/javascript', body:
          `window.turnstile={render(el,options){window.testChallenge=options;options.callback('synthetic-browser-token');return 'fixture';},reset(){window.testChallenge.callback('synthetic-browser-token');},remove(){}};` }));
        await page.route('**/api/config', route => route.fulfill({ json: { enabled: true, siteKey: 'synthetic-public-key', model: 'deepseek-v4-flash' } }));
        await page.route('**/api/session', route => route.fulfill({ json: { ready: true } }));
        await page.route('**/api/client-events', route => route.fulfill({ status: 202, json: { accepted: true } }));
        await page.route('**/api/chat', async route => {
          const body = route.request().postDataJSON(); requests.push({ body, headers: route.request().headers() });
          const reply = events(mode, body.interaction_id); turns.set(reply.turn, { interaction: body.interaction_id, success: mode !== 'interrupted' });
          await route.fulfill({ contentType: 'application/x-ndjson', body: reply.body });
        });
        await page.route('**/api/turns/*', route => {
          const turn = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
          const known = turns.get(turn); return route.fulfill({ json: status(turn, known.interaction, known.success) });
        });
        await page.route('https://adrouter-v3.fly.dev/v3/sponsor/events', route => {
          const batch = route.request().postDataJSON(); measurements.push(...batch.events);
          return route.fulfill({ json: { results: batch.events.map(e => ({ event_id: e.event_id, result: 'accepted',
            qualification: e.type === 'visibility' ? 'qualified_test_view' : 'unknown' })) } });
        });
        await page.goto(origin);
        await page.getByRole('heading', { name: 'A conversation with Rowan' }).waitFor();
        assert.ok(await page.getByLabel('Reserved placement').isVisible());
        await page.getByRole('button', { name: 'Tell me about this place.' }).click();
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByText('Synthetic completed reply.', { exact: true }).waitFor();
        assert.equal(requests.length, 1);
        assert.deepEqual(requests[0].body.messages, [{ role: 'user', content: 'Tell me about this place.' }]);
        assert.equal(requests[0].body.sponsorship_enabled, true);
        assert.equal(requests[0].body.turnstile_token, 'synthetic-browser-token');
        assert.match(requests[0].headers['idempotency-key'], /^[0-9a-f-]{36}$/);
        assert.equal(requests[0].headers['x-adrouter-persona'], undefined);

        // The card shows every required label, and the SDK accepts it as rendered and viewable.
        const card = page.getByLabel('Sponsored placement · demo campaign');
        await card.waitFor();
        for (const text of ['Sponsored', creative.advertiser_name, creative.title, creative.body, DEMO])
          assert.ok(await card.getByText(text, { exact: true }).isVisible(), text);
        assert.equal(await card.getByRole('link', { name: 'Visit sponsor' }).getAttribute('href'), creative.destination_url);
        for (let i = 0; i < 40 && !measurements.some(e => e.type === 'visibility'); i++) await page.waitForTimeout(100);
        assert.deepEqual(measurements.filter(e => e.type === 'render_failed').map(e => e.failure), []);
        assert.ok(measurements.some(e => e.type === 'rendered'), 'rendered event');
        assert.ok(measurements.some(e => e.type === 'visibility'), 'visibility event');
        await page.screenshot({ path: `output/browser/${name}.png`, fullPage: true });

        // Sponsor copy stays out of the stored conversation and the next model request.
        assert.ok(!JSON.stringify(await stored(page)).includes(creative.advertiser_name));
        await page.reload();
        await page.getByText('Synthetic completed reply.', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        mode = 'none';
        await page.getByLabel('Show sponsored suggestions').uncheck();
        await page.getByLabel('Your message to Rowan').fill('A second synthetic message');
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByText('Synthetic completed reply.', { exact: true }).nth(1).waitFor();
        assert.equal(requests[1].body.sponsorship_enabled, false);
        assert.ok(!JSON.stringify(requests[1].body).includes(creative.advertiser_name));
        assert.equal(await page.getByLabel('Sponsored placement · demo campaign').count(), 0);

        // A long conversation is trimmed by the SDK, with a visible notice.
        await page.evaluate(() => localStorage.setItem('hearthside.conversation.v1', JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'Synthetic history 🦉 '.repeat(50) })))));
        await page.reload();
        await page.getByLabel('Your message to Rowan').fill('Latest synthetic message 🦉');
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByText(/Earlier messages are no longer sent/).waitFor();
        await page.getByText('Synthetic completed reply.', { exact: true }).waitFor();
        const last = requests.at(-1).body;
        assert.ok(last.messages.length <= 14); assert.ok(Buffer.byteLength(JSON.stringify(last.messages)) <= 12_000);
        assert.equal(last.messages.at(-1).content, 'Latest synthetic message 🦉');

        // An interrupted reply stays visible but is never stored or sent as history.
        mode = 'interrupted';
        await page.getByLabel('Your message to Rowan').fill('Synthetic interrupted turn');
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByRole('alert').waitFor();
        assert.equal(requests.length, 4);
        await page.getByText('Synthetic partial reply.', { exact: true }).waitFor();
        await page.getByText('ROWAN · INTERRUPTED, NOT KEPT').waitFor();
        assert.ok(!(await stored(page)).some(m => m.content === 'Synthetic partial reply.'));
        mode = 'none';
        await page.getByLabel('Your message to Rowan').fill('After the interruption');
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByText('Synthetic completed reply.', { exact: true }).last().waitFor();
        assert.ok(!requests.at(-1).body.messages.some(m => m.content === 'Synthetic partial reply.'));
        assert.deepEqual(errors, []);
      } finally { await browser.close(); }
    });
  }
  test('paused configuration renders clearly and never starts paid requests', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage(); let calls = 0;
      await page.route('**/api/config', route => route.fulfill({ json: { enabled: false, siteKey: '', model: 'deepseek-v4-flash' } }));
      await page.route('**/api/chat', route => { calls++; return route.abort(); });
      await page.goto(origin); await page.getByText(/The inn is resting/).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Send message' }).isDisabled(), true);
      assert.equal(calls, 0);
    } finally { await browser.close(); }
  });
  test('the browser bundle holds no server prompt or direct provider address', async () => {
    const assets = (await readdir(resolve(root, 'assets'))).filter(file => file.endsWith('.js'));
    const bundle = (await Promise.all(assets.map(file => readFile(resolve(root, 'assets', file), 'utf8')))).join('\n');
    assert.ok(bundle.includes('https://adrouter-v3.fly.dev/v3/sponsor/events'));
    for (const forbidden of ['You are Rowan', 'api.deepseek.com', 'ADROUTER_APP_CREDENTIAL', 'REFERENCE_HMAC_SECRET', 'TURNSTILE_SECRET_KEY', 'SESSION_SECRET'])
      assert.ok(!bundle.includes(forbidden), forbidden);
  });
} finally {
  // Node's test queue runs after module evaluation; close after the queued tests finish.
  test.after(() => new Promise(resolve => server.close(resolve)));
}

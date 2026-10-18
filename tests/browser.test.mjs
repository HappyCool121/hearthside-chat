import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
try {
  for (const [name, browserType, viewport] of [['desktop-chromium', chromium, { width: 1440, height: 1000 }],
    ['mobile-webkit', webkit, { width: 390, height: 844 }]]) {
    test(name, async () => {
      const browser = await browserType.launch();
      try {
        const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const requests = [];
        let interrupted = false;
        await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({ contentType: 'text/javascript', body:
          `window.turnstile={render(el,options){window.testChallenge=options;options.callback('synthetic-browser-token');return 'fixture';},reset(){window.testChallenge.callback('synthetic-browser-token');},remove(){}};` }));
        await page.route('**/api/config', route => route.fulfill({ json: { enabled: true, siteKey: 'synthetic-public-key', model: 'deepseek-v4-flash' } }));
        await page.route('**/api/session', route => route.fulfill({ json: { ok: true } }));
        await page.route('**/api/chat', async route => {
          requests.push(route.request().postDataJSON());
          await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'text', text: interrupted ? 'Synthetic partial reply.' : 'Synthetic completed reply.' }) + '\n' +
            JSON.stringify(interrupted ? { type: 'error', error: 'stream_interrupted' } : { type: 'done' }) + '\n' });
        });
        await page.goto(origin);
        await page.getByRole('heading', { name: 'A conversation with Rowan' }).waitFor();
        assert.ok(await page.getByLabel('Reserved placement').isVisible());
        await page.getByRole('button', { name: 'Tell me about this place.' }).click();
        assert.equal(await page.getByLabel('Your message to Rowan').inputValue(), 'Tell me about this place.');
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByText('Synthetic completed reply.', { exact: true }).waitFor();
        assert.equal(requests.length, 1);
        assert.deepEqual(requests[0].messages, [{ role: 'user', content: 'Tell me about this place.' }]);
        await page.reload();
        await page.getByText('Synthetic completed reply.', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: `output/browser/${name}.png`, fullPage: true });
        // A long conversation is trimmed before transport, with a visible notice.
        await page.evaluate(() => localStorage.setItem('hearthside.conversation.v1', JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'Synthetic history 🦉 '.repeat(50) })))));
        await page.reload();
        await page.getByLabel('Your message to Rowan').fill('Latest synthetic message 🦉');
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByText(/Earlier messages are no longer sent/).waitFor();
        await page.getByText('Synthetic completed reply.', { exact: true }).waitFor();
        const last = requests.at(-1);
        assert.ok(last.messages.length <= 14); assert.ok(Buffer.byteLength(JSON.stringify(last.messages)) <= 12_000);
        assert.equal(last.messages.at(-1).content, 'Latest synthetic message 🦉');
        assert.ok(last.messages.every(m => ['user', 'assistant'].includes(m.role)));
        interrupted = true;
        await page.getByLabel('Your message to Rowan').fill('Synthetic interrupted turn');
        await page.getByRole('button', { name: 'Send message' }).click();
        await page.getByRole('alert').waitFor();
        assert.equal(requests.length, 3);
        assert.equal(await page.getByText('Synthetic partial reply.', { exact: true }).count(), 0);
        assert.ok(!JSON.parse(await page.evaluate(() => localStorage.getItem('hearthside.conversation.v1'))).some(m => m.content === 'Synthetic partial reply.'));
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
} finally {
  // Node's test queue runs after module evaluation; close after the queued tests finish.
  test.after(() => new Promise(resolve => server.close(resolve)));
}

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { CONFIG } = require('./fixture.cjs');

test('fresh HTTP service saves variants without bootstrap files, rejects cross-origin writes, and hides secrets', { timeout: 15000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-http-'));
  const child = spawn(process.execPath, ['server.cjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: dir, PUBLIC_ORIGIN: 'http://127.0.0.1:8080', GRAFANA_IRM_HOST: 'example.grafana.net' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    fs.rmSync(dir, { recursive: true });
  });
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Server exited before startup'); })]);
  const api = (url, options) => fetch(`http://127.0.0.1:8080${url}`, options);
  const headers = { origin: 'http://127.0.0.1:8080', 'content-type': 'application/json' };
  const initial = await (await api('/api/status')).json();
  assert.equal(initial.runtime.paused, true); assert.equal(initial.config.zip, ''); assert.equal(initial.config.barkConfigured, false);
  const input = { ...CONFIG, color: 'nightsky', capacity: '2tb', barkKey: 'fake_private_test_key', barkEnabled: true, irmWebhook: 'https://example.grafana.net/fake-private-token' };
  assert.equal((await api('/api/settings', { method: 'PUT', headers: { ...headers, origin: 'http://evil.test' }, body: JSON.stringify(input) })).status, 403);
  assert.equal((await api('/api/settings', { method: 'PUT', headers: { ...headers, 'content-type': 'text/plain' }, body: JSON.stringify(input) })).status, 415);
  const saved = await api('/api/settings', { method: 'PUT', headers, body: JSON.stringify(input) });
  assert.equal(saved.status, 200);
  const settings = await saved.json(); assert.equal(settings.capacity, '2tb'); assert.equal(settings.barkConfigured, true);
  const state = await (await api('/api/status')).json(); assert.match(state.product.url, /2tb-night-sky-t-mobile$/);
  for (const route of ['/api/settings', '/api/status', '/api/history']) {
    const text = await (await api(route)).text(); assert.ok(!text.includes(input.barkKey)); assert.ok(!text.includes('fake-private-token'));
  }
  assert.equal((await api('/api/settings', { method: 'PUT', headers, body: JSON.stringify(input) })).status, 409);
  assert.equal((await api('/api/discover', { method: 'POST', headers, body: JSON.stringify({ ...input, color: 'bad' }) })).status, 400);
});

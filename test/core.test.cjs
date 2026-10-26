const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, Monitor, validate, randomDelay, retryAfter } = require('../core.cjs');
const { CONFIG: DEFAULTS, PRODUCT, STORES, parseInventory } = require('./fixture.cjs');
const secrets = { barkKey: 'fake_key_for_test', irmWebhook: '' };
function fixture(t, collect, post = async () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-test-'));
  const store = new Store(dir, secrets);
  const m = new Monitor(store, collect || (async c => ({ stores: c.stores.map(id => ({ id, name: STORES[id], status: 'unavailable', checkedAt: Date.now() })) })), post);
  t.after(() => { clearTimeout(m.timer); store.close(); fs.rmSync(dir, { recursive: true }); });
  return { m, store, dir };
}
function ready(m, changes = {}) { m.save({ ...DEFAULTS, barkEnabled: true, ...changes }, ''); m.v.runtime.paused = false; }
const nativeStore = (id, pickup = 'unavailable', overrides = {}) => ({ storeNumber: id, storeName: STORES[id], partsAvailability: { [PRODUCT.part]: { partNumber: PRODUCT.part, pickupDisplay: pickup, pickupSearchQuote: 'Available today', ...overrides } } });
test('random intervals honor saved boundaries, exclude whole seconds, and respect Retry-After', () => {
  for (let i = 0; i < 10000; i++) {
    for (const [min, max] of [[60001, 179999], [180001, 599999], [85211, 87345]]) {
      const n = randomDelay(min, max); assert.ok(n >= min && n <= max && n % 1000 !== 0);
    }
  }
  assert.equal(randomDelay(60001, 179999, 600000, 0), null);
  assert.equal(randomDelay(60001, 179999, 179999, 0), 179999);
  assert.equal(randomDelay(60001, 179999, 180000, 0), null);
});
test('Retry-After seconds and dates preserve absolute server lower bound', () => {
  assert.equal(retryAfter('600', 1000), 601000);
  assert.equal(retryAfter('Mon, 26 Oct 2026 10:00:00 GMT', 0), Date.parse('2026-10-26T10:00:00Z'));
  assert.equal(retryAfter('invalid', 1000), 0);
});
test('parser accepts both known structures; missing, duplicate, unknown and wrong-part entries stay UNKNOWN', () => {
  const raw = [nativeStore('R001', 'available'), nativeStore('R002', 'unavailable'), nativeStore('R003', 'mystery')];
  for (const data of [{ body: { stores: raw } }, { body: { content: { pickupMessage: { stores: raw } } } }]) {
    assert.deepEqual(parseInventory(data, DEFAULTS.stores, 1).map(s => s.status), ['available', 'unavailable', 'UNKNOWN', 'UNKNOWN']);
  }
  assert.equal(parseInventory({ body: { stores: [nativeStore('R001', 'available', { partNumber: 'OTHER' })] } }, ['R001'], 1)[0].status, 'UNKNOWN');
  assert.equal(parseInventory({ body: { stores: [nativeStore('R001'), nativeStore('R001')] } }, ['R001'], 1)[0].status, 'UNKNOWN');
  assert.throws(() => parseInventory({}, ['R001'], 1));
});
test('settings are atomic, versioned, constrained and cannot activate missing phone credentials', t => {
  const { m } = fixture(t);
  const before = JSON.stringify(m.v);
  for (const input of [{ ...DEFAULTS, zip: '9803' }, { ...DEFAULTS, stores: [] }, { ...DEFAULTS, normalMax: 180000 }, { ...DEFAULTS, retryMax: 600000 }, { ...DEFAULTS, barkEnabled: 'yes' }, { ...DEFAULTS, irmEnabled: true }]) assert.throws(() => m.save(input, ''));
  assert.equal(JSON.stringify(m.v), before);
  m.save({ ...DEFAULTS, barkEnabled: true }, '');
  assert.equal(m.v.config.version, 2); assert.ok(m.v.config.confirmed); assert.equal(m.v.secrets.barkKey, secrets.barkKey);
  assert.throws(() => m.save(DEFAULTS, ''), { status: 409 });
  assert.throws(() => m.save({ ...m.v.config, clear_barkKey: true }, ''));
});
test('IRM URL is restricted to exact approved HTTPS host and never redirects by configuration', () => {
  const base = { ...DEFAULTS, irmEnabled: true };
  assert.throws(() => validate({ ...base, irmWebhook: 'https://evil.test/a' }, DEFAULTS, secrets, 'example.grafana.net'));
  assert.throws(() => validate({ ...base, irmWebhook: 'http://example.grafana.net/a' }, DEFAULTS, secrets, 'example.grafana.net'));
  assert.throws(() => validate({ ...base, irmWebhook: 'https://example.grafana.net@evil.test/a' }, DEFAULTS, secrets, 'example.grafana.net'));
  assert.ok(validate({ ...base, irmWebhook: 'https://example.grafana.net/integrations/key' }, DEFAULTS, secrets, 'example.grafana.net').config.irmEnabled);
});
test('SQLite retains pause, updated config, channel switches and key across restart', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-restart-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  let store = new Store(dir, secrets); const m = new Monitor(store);
  m.save({ ...DEFAULTS, zip: '98105', barkKey: 'updated_key', barkEnabled: true }, '');
  store.value.runtime.paused = true; store.commit(); store.close();
  store = new Store(dir, { ...secrets, barkKey: 'must_not_overwrite' });
  assert.equal(store.value.config.zip, '98105'); assert.equal(store.value.secrets.barkKey, 'updated_key'); assert.ok(store.value.runtime.paused); assert.ok(store.value.config.barkEnabled);
  assert.equal(fs.statSync(path.join(dir, 'monitor.sqlite')).mode & 0o777, 0o600); store.close();
});
test('HTTP 541 yields UNKNOWN, no inventory pushes, no fake success, and bounded retry', async t => {
  const sent = [];
  const { m } = fixture(t, async () => { throw { safeMessage: 'HTTP 541，尚无有效库存结果' }; }, async (...args) => sent.push(args));
  ready(m); await m.run();
  assert.ok(m.v.runtime.stores.every(s => s.status === 'UNKNOWN'));
  assert.equal(m.v.runtime.lastComplete, null); assert.equal(sent.length, 0); assert.equal(m.v.runtime.phase, 'retrying');
  assert.ok(m.v.runtime.waitMs >= 180001 && m.v.runtime.waitMs <= 599999);
});
test('persistent available stock generates a new Bark id each round and only selected available stores', async t => {
  const sent = [];
  const { m } = fixture(t, async c => ({ stores: c.stores.map(id => ({ id, name: STORES[id], status: id === 'R001' ? 'available' : 'unavailable', description: 'Today', checkedAt: Date.now() })) }), async (url, payload) => sent.push(payload));
  ready(m); await m.run(); await m.run();
  assert.equal(sent.length, 2); assert.notEqual(sent[0].id, sent[1].id);
  assert.equal(sent[0].level, 'active'); assert.equal(sent[0].url, PRODUCT.url); assert.equal(sent[0].device_key, secrets.barkKey); assert.ok(m.v.runtime.lastComplete);
});
test('partial response preserves valid available stores, never updates full-success timestamp', async t => {
  const sent = [];
  const { m } = fixture(t, async () => ({ stores: parseInventory({ body: { stores: [nativeStore('R001', 'available')] } }, DEFAULTS.stores, Date.now()) }), async (_, p) => sent.push(p));
  ready(m); await m.run(); assert.equal(sent.length, 1); assert.equal(m.v.runtime.lastComplete, null); assert.equal(m.v.runtime.failures, 1);
});
test('target changes during a query discard old-version results and stock pushes', async t => {
  let resolve;
  const pending = new Promise(r => resolve = r), sent = [];
  const { m } = fixture(t, () => pending, async (_, p) => sent.push(p)); ready(m);
  const running = m.run();
  m.save({ ...m.v.config, zip: '98105' }, '');
  resolve({ stores: [{ id: 'R001', status: 'available', checkedAt: Date.now() }] }); await running;
  assert.equal(sent.length, 0); assert.ok(m.v.runtime.stores.every(s => s.status === 'UNKNOWN')); assert.equal(m.v.config.zip, '98105');
});
test('disable Bark or pause while first push is in flight cancels subsequent store submissions', async t => {
  for (const operation of ['disable', 'pause']) {
    let release, entered;
    const waiting = new Promise(r => release = r), first = new Promise(r => entered = r), sent = [];
    const { m } = fixture(t, async c => ({ stores: c.stores.map(id => ({ id, name: STORES[id], status: 'available', checkedAt: Date.now() })) }), async (_, p) => { sent.push(p); entered(); await waiting; });
    ready(m); const running = m.run(); await first;
    if (operation === 'disable') m.save({ ...m.v.config, barkEnabled: false }, ''); else await m.control('pause');
    release(); await running; assert.equal(sent.length, 1);
  }
});
test('fault alert is sent once after 3 failures and 30 minutes; recovery sends once', async t => {
  let fail = true; const sent = [];
  const { m } = fixture(t, async c => { if (fail) throw { safeMessage: 'HTTP 541' }; return { stores: c.stores.map(id => ({ id, status: 'unavailable', checkedAt: Date.now() })) }; }, async (_, p) => sent.push(p));
  ready(m); m.v.runtime.startedAt = Date.now() - 1800001;
  await m.run(); await m.run(); assert.equal(sent.length, 0);
  await m.run(); await m.run(); assert.equal(sent.length, 1); assert.match(sent[0].title, /故障/);
  fail = false; await m.run(); await m.run(); assert.equal(sent.length, 2); assert.match(sent[1].title, /恢复/);
});
test('Retry-After exceeding maximum pauses queries and immediately reports through Bark', async t => {
  const sent = [];
  const { m } = fixture(t, async () => { throw { safeMessage: 'HTTP 429', retryAt: Date.now() + 900000 }; }, async (_, p) => sent.push(p));
  ready(m); await m.run(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(m.v.runtime.paused); assert.equal(m.v.runtime.nextAt, null); assert.equal(m.v.runtime.phase, 'attention'); assert.equal(sent.length, 1);
});
test('request query cannot advance the scheduled deadline; no overlapping collection', async t => {
  let release; const { m } = fixture(t, () => new Promise(r => release = r)); ready(m); m.schedule();
  const at = m.v.runtime.nextAt; await m.control('query'); assert.equal(m.v.runtime.nextAt, at);
  const running = m.run(); await m.run(); release({ stores: m.v.config.stores.map(id => ({ id, status: 'unavailable', checkedAt: Date.now() })) }); await running;
});
test('events and screenshots have strict limits and pruned files are deleted', t => {
  const { store, dir } = fixture(t); fs.mkdirSync(path.join(dir, 'diagnostics'));
  for (let i = 0; i < 205; i++) { fs.writeFileSync(path.join(dir, 'diagnostics', `${i}.png`), 'test'); store.event('error', 'test', `${i}`); }
  store.commit(); assert.equal(store.value.events.length, 200); assert.equal(store.value.events.filter(e => e.diagnostic).length, 20); assert.equal(fs.readdirSync(path.join(dir, 'diagnostics')).length, 20);
});
test('startup keeps pause, marks previous result stale and never sends a stock notification', t => {
  const { m } = fixture(t); m.v.config = structuredClone(DEFAULTS); m.v.runtime.stores[0] = { id: 'R001', status: 'available', lastValid: { status: 'available', checkedAt: 1 } }; m.start();
  assert.equal(m.v.runtime.stores[0].status, 'UNKNOWN'); assert.equal(m.v.runtime.stores[0].lastValid.status, 'available'); assert.equal(m.timer, null);
});
test('phone failures cool down independently while Bark and later queries continue', async t => {
  const sent = [];
  const { m } = fixture(t, async c => ({ stores: c.stores.map(id => ({ id, name: STORES[id], status: 'available', checkedAt: Date.now() })) }), async (url, p) => { if (url !== 'https://api.day.app/push') throw { safeMessage: 'HTTP 429', retryAt: Date.now() + 900000 }; sent.push(p); });
  m.save({ ...DEFAULTS, barkEnabled: true, irmEnabled: true, irmWebhook: 'https://example.grafana.net/key' }, 'example.grafana.net'); m.v.runtime.paused = false;
  await m.run(); assert.equal(m.v.runtime.irm.state, 'paused'); assert.equal(sent.length, 4); assert.equal(m.v.runtime.paused, false);
  await m.run(); assert.equal(sent.length, 8);
});
test('phone test remains alerting long enough for dispatch and is resolved by the next query', async t => {
  const sent = [];
  const { m } = fixture(t, undefined, async (_, payload) => sent.push(payload));
  m.save({ ...DEFAULTS, irmEnabled: true, irmWebhook: 'https://example.grafana.net/key' }, 'example.grafana.net');
  await m.control('test-irm');
  assert.equal(sent.length, 1); assert.equal(sent[0].state, 'alerting'); assert.equal(m.v.runtime.irm.groups.length, 1);
  m.v.runtime.paused = false; await m.run();
  assert.equal(sent.length, 2); assert.equal(sent[1].state, 'OK'); assert.equal(sent[1].group_key, sent[0].group_key); assert.equal(m.v.runtime.irm.groups.length, 0);
});
test('notification adapter accepts Grafana JSON string Ok. and Bark code 200, rejects unknown responses and honors retry headers', async t => {
  const { post } = require('../core.cjs');
  let response = new Response(JSON.stringify('Ok.'));
  t.mock.method(globalThis, 'fetch', async (_, options) => { assert.equal(options.redirect, 'error'); return response; });
  await post('https://example.grafana.net/webhook', {}, 'irm');
  response = new Response(JSON.stringify({ code: 200 })); await post('https://api.day.app/push', {}, 'bark');
  response = new Response(JSON.stringify({})); await assert.rejects(post('https://example.grafana.net/webhook', {}, 'irm'), { safeMessage: '服务未明确接受通知' });
  response = new Response(JSON.stringify('error')); await assert.rejects(post('https://example.grafana.net/webhook', {}, 'irm'));
  response = new Response('unavailable', { status: 429, headers: { 'retry-after': '600' } });
  await assert.rejects(post('https://example.grafana.net/webhook', {}, 'irm'), error => error.safeMessage === 'HTTP 429' && error.retryAt >= Date.now() + 599000);
});

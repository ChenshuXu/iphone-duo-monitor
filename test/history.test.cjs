const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store, Monitor } = require('../core.cjs');
const { CONFIG: DEFAULTS, STORES, PRODUCT } = require('./fixture.cjs');
const DAY = 86400000;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-history-'));
  const store = new Store(dir, { barkKey: 'private_test_key', irmWebhook: '' });
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true });
  });
  return { store, dir };
}

function record(store, statuses, at = Date.now(), config = DEFAULTS) {
  const id = randomUUID();
  store.beginQuery(config, id, at);
  const stores = config.stores.map((id, i) => ({
    id,
    name: STORES[id],
    status: statuses[i] || 'UNKNOWN',
    checkedAt: at,
    description: 'Result',
  }));
  store.finishQuery(id, { stores }, at + 100);
  return id;
}

test('history retains every per-store result beyond the event limit, survives reopen, and never exposes notification secrets', (t) => {
  const { store, dir } = fixture(t);
  const now = Date.now();
  for (let i = 0; i < 210; i++) {
    record(store, ['available', 'unavailable', 'unavailable', 'unavailable'], now - i * 1000);
    store.event('query', 'summary');
  }
  store.commit();
  assert.equal(store.value.events.length, 200);
  const reopened = new Store(dir, store.secrets);
  try {
    const data = reopened.history();
    assert.equal(data.total, 210);
    assert.equal(data.summary.availableRounds, 210);
    assert.equal(data.summary.byStore[0].name, STORES.R001);
    assert.equal(data.summary.byStore[0].count, 210);
    assert.equal(data.items[0].stores[0].status, 'available');
    assert.equal(data.items[0].config.zip, DEFAULTS.zip);
    assert.ok(!JSON.stringify(data).includes('private_test_key'));
  } finally {
    reopened.close();
  }
});
test('60-day retention preserves the boundary and prunes older results; 1/7/30/60 day filters apply', (t) => {
  const { store } = fixture(t);
  const now = Date.now();
  record(store, ['unavailable'], now - 60 * DAY - 1);
  record(store, ['unavailable'], now - 60 * DAY);
  record(store, ['unavailable'], now - 29 * DAY);
  record(store, ['unavailable'], now - 6 * DAY);
  record(store, ['unavailable'], now - DAY + 1000);
  store.pruneHistory(now);
  assert.equal(store.history(new URLSearchParams(), now).total, 4);
  for (const [days, expected] of [
    [1, 1],
    [7, 2],
    [30, 3],
    [60, 4],
  ]) {
    assert.equal(store.history(new URLSearchParams({ days: String(days) }), now).total, expected);
  }
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM queries').get().n, 4);
});
test('rounds with stock survive the 60-day retention and appear under all records', (t) => {
  const { store } = fixture(t);
  const now = Date.now();
  const old = record(store, ['available'], now - 400 * DAY);
  record(store, ['unavailable'], now - 61 * DAY);
  record(store, ['unavailable'], now - DAY);
  store.pruneHistory(now);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM queries').get().n, 2);
  assert.equal(store.history(new URLSearchParams(), now).total, 1);
  const all = store.history(new URLSearchParams({ days: 'all', available: '1' }), now);
  assert.equal(all.total, 1);
  assert.equal(all.items[0].id, old);
  assert.equal(store.history(new URLSearchParams({ days: 'all' }), now).total, 2);
});
test('history filters availability by the selected store, keeps partial/failed rounds and pages stable across new arrivals', (t) => {
  const { store } = fixture(t);
  const now = Date.now();
  for (let i = 0; i < 61; i++) {
    record(store, ['available', 'unavailable', 'unavailable', 'unavailable'], now - 1000);
  }
  record(store, ['UNKNOWN', 'available'], now - 500);
  record(store, [], now - 200);
  assert.equal(store.history().summary.unknownRounds, 2);
  assert.equal(store.history(new URLSearchParams({ available: '1', store: 'R002' })).total, 1);
  assert.equal(store.history(new URLSearchParams({ available: '1', store: 'R100' })).total, 0);
  assert.equal(
    store.history(new URLSearchParams({ available: '1', store: 'R002' })).summary.byStore[0].count,
    1,
  );
  assert.equal(store.history(new URLSearchParams({ outcome: 'partial' })).total, 1);
  assert.equal(store.history(new URLSearchParams({ outcome: 'failed' })).total, 1);
  const first = store.history();
  assert.equal(first.items.length, 50);
  assert.ok(first.nextCursor);
  record(store, ['unavailable'], now);
  const second = store.history(new URLSearchParams({ cursor: first.nextCursor }));
  assert.equal(second.items.length, 13);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map((q) => q.id)).size, 63);
  assert.equal(store.history(new URLSearchParams({ store: 'R420' })).total, 0);
  for (const params of [
    { days: '61' },
    { store: 'x' },
    { available: 'yes' },
    { outcome: 'x' },
    { cursor: 'bad' },
    { cursor: Buffer.from(JSON.stringify([now, "' OR 1=1"])).toString('base64url') },
  ]) {
    assert.throws(() => store.history(new URLSearchParams(params)), { status: 400 });
  }
});
test('in-flight query is preserved as interrupted after restart', (t) => {
  const { store, dir } = fixture(t);
  const id = randomUUID();
  store.beginQuery(DEFAULTS, id, Date.now());
  assert.equal(store.history().items[0].outcome, 'checking');
  const reopened = new Store(dir, store.secrets);
  try {
    const q = reopened.history().items[0];
    assert.equal(q.id, id);
    assert.equal(q.outcome, 'interrupted');
    assert.ok(q.stores.every((s) => s.status === 'UNKNOWN'));
  } finally {
    reopened.close();
  }
});
test('a database without a history start time begins history now without inventing records', (t) => {
  const { store, dir } = fixture(t);
  delete store.value.historyStartedAt;
  store.value.runtime.round = randomUUID();
  store.value.runtime.lastComplete = Date.now();
  store.commit();
  const before = Date.now();
  const reopened = new Store(dir, store.secrets);
  try {
    const data = reopened.history();
    assert.equal(data.total, 0);
    assert.ok(data.historyStartedAt >= before);
    assert.equal(reopened.secrets.barkKey, 'private_test_key');
  } finally {
    reopened.close();
  }
});
test('every actual Monitor attempt is archived, including failed and superseded results, without changing notifications', async (t) => {
  const { store } = fixture(t);
  let fail = false;
  let change = false;
  const sent = [];
  const m = new Monitor(
    store,
    async (c) => {
      if (fail) {
        throw {
          safeMessage: 'Timeout',
          diagnostics: { failedStep: '等待取货弹窗可见', steps: [], network: [] },
        };
      }
      if (change) {
        m.save({ ...m.v.config, zip: '98105' }, '');
      }
      return {
        stores: c.stores.map((id) => ({
          id,
          name: STORES[id],
          status: 'available',
          checkedAt: Date.now(),
        })),
      };
    },
    async (_, payload) => sent.push(payload),
  );
  t.after(() => clearTimeout(m.timer));
  m.save({ ...DEFAULTS, barkEnabled: true }, '');
  m.v.runtime.paused = false;
  await m.run();
  fail = true;
  await m.run();
  fail = false;
  change = true;
  await m.run();
  const data = store.history();
  assert.equal(data.total, 3);
  assert.equal(data.summary.availableRounds, 2);
  assert.equal(data.summary.unknownRounds, 1);
  assert.equal(data.items.filter((q) => q.superseded).length, 1);
  assert.equal(data.items.find((q) => q.superseded).config.zip, '10001');
  assert.equal(store.value.config.zip, '98105');
  assert.equal(data.items.find((q) => q.outcome === 'failed').error, 'Timeout');
  assert.equal(
    data.items.find((q) => q.outcome === 'failed').diagnostics.failedStep,
    '等待取货弹窗可见',
  );
  assert.equal(sent.length, 4);
});
test('existing history schema gains diagnostics without losing prior records, and diagnostics survive restart', (t) => {
  const { store, dir } = fixture(t);
  record(store, ['unavailable']);
  store.db.exec('ALTER TABLE queries DROP COLUMN diagnostics_json');
  let reopened = new Store(dir, store.secrets);
  const id = randomUUID();
  const diagnostics = {
    failedStep: '定位并点击取货入口',
    steps: [{ step: '定位并点击取货入口', at: Date.now(), durationMs: 90000 }],
    network: [{ kind: 'http', status: 503 }],
  };
  reopened.beginQuery(DEFAULTS, id, Date.now());
  reopened.finishQuery(id, {
    stores: DEFAULTS.stores.map((id) => ({ id, status: 'UNKNOWN' })),
    error: 'Timeout',
    diagnostics,
  });
  reopened.close();
  reopened = new Store(dir, store.secrets);
  try {
    const data = reopened.history();
    assert.equal(data.total, 2);
    assert.deepEqual(data.items.find((q) => q.id === id).diagnostics, diagnostics);
    assert.equal(data.items.find((q) => q.id !== id).diagnostics, null);
    assert.equal(reopened.secrets.barkKey, 'private_test_key');
  } finally {
    reopened.close();
  }
});

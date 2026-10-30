const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  Store,
  Monitor,
  DEFAULTS,
  COLORS,
  CAPACITIES,
  CARRIERS,
  productFor,
  validate,
  parseInventory,
} = require('../core.cjs');
const { CONFIG } = require('./fixture.cjs');

test('fresh installation contains no personal target or notification credentials and remains paused', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-fresh-'));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true });
  });
  assert.equal(store.value.config.zip, '');
  assert.deepEqual(store.value.config.catalog, {});
  assert.deepEqual(store.value.config.stores, []);
  assert.equal(store.value.secrets, undefined);
  assert.deepEqual(store.secrets, {});
  assert.equal(store.value.runtime.paused, true);
  await assert.rejects(new Monitor(store).control('resume'));
});

test('every offered color, capacity and carrier produces a distinct Apple US variant', () => {
  const urls = new Set();
  for (const color of Object.keys(COLORS)) {
    for (const capacity of Object.keys(CAPACITIES)) {
      for (const carrier of Object.keys(CARRIERS)) {
        const config = { ...CONFIG, color, capacity, carrier };
        assert.equal(validate(config, DEFAULTS, {}).config.capacity, capacity);
        const product = productFor(config);
        urls.add(product.url);
        assert.ok(product.name.includes(COLORS[color].name));
        assert.ok(product.name.includes(CAPACITIES[capacity]));
        assert.equal(new URL(product.url).hostname, 'www.apple.com');
      }
    }
  }
  assert.equal(urls.size, 32);
  for (const change of [
    { color: '__proto__' },
    { capacity: '128gb' },
    { carrier: 'evil.test' },
    { zip: '1000' },
    { catalog: {} },
    { catalog: { R001: 3 } },
    { stores: ['R999'] },
  ]) {
    assert.throws(() => validate({ ...CONFIG, ...change }, DEFAULTS, {}));
  }
});

test('a new ZIP, catalog and variant change stock, purchase links and history together', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-variants-'));
  const store = new Store(dir, { barkKey: 'fake_test_key' });
  const sent = [];
  const monitor = new Monitor(
    store,
    async (c) => ({
      stores: c.stores.map((id) => ({
        id,
        name: c.catalog[id],
        status: 'available',
        checkedAt: Date.now(),
      })),
    }),
    async (_, payload) => sent.push(payload),
  );
  t.after(() => {
    clearTimeout(monitor.timer);
    store.close();
    fs.rmSync(dir, { recursive: true });
  });
  monitor.save({ ...CONFIG, barkEnabled: true }, '');
  monitor.v.runtime.paused = false;
  await monitor.run();
  monitor.save(
    {
      ...monitor.v.config,
      zip: '90210',
      color: 'nightsky',
      capacity: '1tb',
      carrier: 'unlocked',
      catalog: { R999: 'Apple Other City' },
      stores: ['R999'],
    },
    '',
  );
  assert.equal(monitor.v.runtime.lastComplete, null);
  assert.equal(monitor.v.runtime.stores[0].status, 'UNKNOWN');
  await monitor.run();
  const last = sent.at(-1);
  assert.match(last.url, /1tb-night-sky-unlocked$/);
  assert.match(last.body, /Night Sky/);
  assert.match(last.body, /1TB/);
  assert.match(last.body, /Apple Other City/);
  const history = store.history().items;
  assert.equal(history.length, 2);
  assert.equal(history[0].config.zip, '90210');
  assert.equal(history[0].config.product.url, last.url);
  assert.notEqual(history[1].config.product.url, last.url);
  const data = {
    body: {
      stores: [
        {
          storeNumber: 'R999',
          storeName: 'Apple Other City',
          partsAvailability: { 'NEW123/A': { partNumber: 'NEW123/A', pickupDisplay: 'available' } },
        },
      ],
    },
  };
  assert.equal(
    parseInventory(data, ['R999'], 1, 'NEW123/A', monitor.v.config.catalog)[0].status,
    'available',
  );
  assert.equal(
    parseInventory(data, ['R999'], 1, 'OLD123/A', monitor.v.config.catalog)[0].status,
    'UNKNOWN',
  );
});

test('an unresolved phone group prevents changing the environment webhook on restart', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-webhook-'));
  const credentials = { irmWebhook: 'https://example.grafana.net/old' };
  const store = new Store(dir, credentials);
  const monitor = new Monitor(store);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true });
  });
  monitor.save({ ...CONFIG, irmEnabled: true });
  monitor.v.runtime.irm.groups.push({ group_key: 'test' });
  store.commit();
  const before = store.db.prepare('SELECT json FROM state').get().json;
  for (const next of [{}, { irmWebhook: 'https://example.grafana.net/new' }]) {
    assert.throws(() => new Store(dir, next), /原 GRAFANA_IRM_WEBHOOK/);
  }
  assert.equal(store.db.prepare('SELECT json FROM state').get().json, before);
});

test('environment credentials configure a fresh paused install without being written into SQLite', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-env-'));
  const credentials = {
    barkKey: 'environment_only_key',
    irmWebhook: 'https://example.grafana.net/environment-only-token',
  };
  const store = new Store(dir, credentials);
  const monitor = new Monitor(store);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true });
  });
  assert.equal(store.value.runtime.paused, true);
  assert.equal(store.value.config.barkEnabled, true);
  assert.equal(store.value.config.irmEnabled, true);
  assert.equal(store.value.runtime.bark.state, 'idle');
  assert.equal(store.value.runtime.irm.state, 'idle');
  const persisted = store.db.prepare('SELECT json FROM state').get().json;
  assert.equal(JSON.parse(persisted).secrets, undefined);
  assert.ok(!persisted.includes(credentials.barkKey));
  assert.ok(!persisted.includes(credentials.irmWebhook));
  monitor.save({ ...CONFIG, barkEnabled: false, irmEnabled: false });
  const reopened = new Store(dir, credentials);
  try {
    assert.equal(reopened.value.config.barkEnabled, false);
    assert.equal(reopened.value.config.irmEnabled, false);
  } finally {
    reopened.close();
  }
});

test('removing environment credentials disables channels without resetting history or cooldowns', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-env-clear-'));
  let store = new Store(dir, {
    barkKey: 'environment_only_key',
    irmWebhook: 'https://example.grafana.net/token',
  });
  const id = require('node:crypto').randomUUID();
  store.beginQuery(CONFIG, id, Date.now());
  store.finishQuery(id, { stores: [] });
  store.value.runtime.bark.notBefore = Date.now() + 900000;
  const deadline = store.value.runtime.bark.notBefore;
  store.commit();
  store.close();
  store = new Store(dir);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true });
  });
  assert.equal(store.value.config.barkEnabled, false);
  assert.equal(store.value.config.irmEnabled, false);
  assert.equal(store.value.runtime.bark.notBefore, deadline);
  assert.equal(store.history().total, 1);
  assert.equal(store.value.config.version, 2);
});

test('legacy database credentials require environment migration and are no longer used or stored afterwards', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-legacy-secrets-'));
  const credentials = {
    barkKey: 'legacy_private_key',
    irmWebhook: 'https://example.grafana.net/legacy-private-token',
  };
  const store = new Store(dir, credentials);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true });
  });
  store.value.secrets = credentials;
  delete store.value.runtime.irm.webhookHash;
  store.commit();
  const before = store.db.prepare('SELECT json FROM state').get().json;
  assert.throws(() => new Store(dir), /先迁入 .env/);
  assert.equal(store.db.prepare('SELECT json FROM state').get().json, before);
  const migrated = new Store(dir, credentials);
  try {
    assert.deepEqual(migrated.secrets, credentials);
    const persisted = migrated.db.prepare('SELECT json FROM state').get().json;
    assert.equal(JSON.parse(persisted).secrets, undefined);
    assert.ok(!persisted.includes(credentials.barkKey));
    assert.ok(!persisted.includes(credentials.irmWebhook));
  } finally {
    migrated.close();
  }
  const rotated = new Store(dir, { barkKey: 'new_environment_key' });
  try {
    assert.equal(rotated.secrets.barkKey, 'new_environment_key');
    assert.equal(rotated.secrets.irmWebhook, undefined);
  } finally {
    rotated.close();
  }
});

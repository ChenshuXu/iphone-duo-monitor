const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  Store,
  Monitor,
  validate,
  validateSecrets,
  randomDelay,
  retryAfter,
  COLORS,
  CAPACITIES,
  CARRIERS,
} = require('../core.cjs');
const { CONFIG: DEFAULTS, PRODUCT, STORES, parseInventory } = require('./fixture.cjs');
const secrets = { barkKey: 'fake_key_for_test', irmWebhook: '' };
const phoneSecrets = { ...secrets, irmWebhook: 'https://example.grafana.net/key' };

function fixture(t, collect, post = async () => {}, credentials = secrets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-test-'));
  const store = new Store(dir, credentials);
  const m = new Monitor(
    store,
    collect ||
      (async (c) => ({
        stores: c.stores.map((id) => ({
          id,
          name: STORES[id],
          status: 'unavailable',
          checkedAt: Date.now(),
        })),
      })),
    post,
  );
  t.after(() => {
    clearTimeout(m.timer);
    clearTimeout(m.barkRetryTimer);
    store.close();
    fs.rmSync(dir, { recursive: true });
  });
  return { m, store, dir };
}

function ready(m, changes = {}) {
  m.save({ ...DEFAULTS, barkEnabled: true, ...changes }, '');
  m.v.runtime.paused = false;
}

const nativeStore = (id, pickup = 'unavailable', overrides = {}) => ({
  storeNumber: id,
  storeName: STORES[id],
  partsAvailability: {
    [PRODUCT.part]: {
      partNumber: PRODUCT.part,
      pickupDisplay: pickup,
      pickupSearchQuote: 'Available today',
      ...overrides,
    },
  },
});
test('random intervals honor saved boundaries, exclude whole seconds, and respect Retry-After', () => {
  for (let i = 0; i < 10000; i++) {
    for (const [min, max] of [
      [60001, 179999],
      [180001, 599999],
      [85211, 87345],
    ]) {
      const n = randomDelay(min, max);
      assert.ok(n >= min && n <= max && n % 1000 !== 0);
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
  const raw = [
    nativeStore('R001', 'available'),
    nativeStore('R002', 'unavailable'),
    nativeStore('R003', 'mystery'),
  ];
  for (const data of [
    { body: { stores: raw } },
    { body: { content: { pickupMessage: { stores: raw } } } },
  ]) {
    assert.deepEqual(
      parseInventory(data, DEFAULTS.stores, 1).map((s) => s.status),
      ['available', 'unavailable', 'UNKNOWN', 'UNKNOWN'],
    );
  }
  assert.equal(
    parseInventory(
      { body: { stores: [nativeStore('R001', 'available', { partNumber: 'OTHER' })] } },
      ['R001'],
      1,
    )[0].status,
    'UNKNOWN',
  );
  assert.equal(
    parseInventory({ body: { stores: [nativeStore('R001'), nativeStore('R001')] } }, ['R001'], 1)[0]
      .status,
    'UNKNOWN',
  );
  assert.throws(() => parseInventory({}, ['R001'], 1));
});
test('settings are atomic, versioned, constrained and cannot activate missing phone credentials', (t) => {
  const { m } = fixture(t);
  const before = JSON.stringify(m.v);
  for (const input of [
    { ...DEFAULTS, zip: '9803' },
    { ...DEFAULTS, stores: [] },
    { ...DEFAULTS, normalMax: 180000 },
    { ...DEFAULTS, retryMax: 600000 },
    { ...DEFAULTS, barkEnabled: 'yes' },
    { ...DEFAULTS, irmEnabled: true },
  ]) {
    assert.throws(() => m.save(input, ''));
  }
  assert.equal(JSON.stringify(m.v), before);
  m.save({ ...DEFAULTS, barkEnabled: true }, '');
  assert.equal(m.v.config.version, 2);
  assert.ok(m.v.config.confirmed);
  assert.equal(m.store.secrets.barkKey, secrets.barkKey);
  assert.throws(() => m.save(DEFAULTS, ''), { status: 409 });
  assert.throws(() => m.save({ ...m.v.config, clear_barkKey: true }, ''));
});
test('environment credentials restrict Grafana to official HTTPS hosts and an optional exact pin', () => {
  for (const irmWebhook of [
    'https://evil.test/a',
    'http://example.grafana.net/a',
    'https://example.grafana.net@evil.test/a',
    'https://example.grafana.net:444/a',
    'https://example.grafana.net/a#secret',
  ]) {
    assert.throws(() => validateSecrets({ irmWebhook }));
  }
  assert.doesNotThrow(() =>
    validateSecrets({ irmWebhook: 'https://example.grafana.net/integrations/key' }),
  );
  assert.throws(() => validateSecrets(phoneSecrets, 'other.grafana.net'));
  assert.doesNotThrow(() => validateSecrets(phoneSecrets, 'example.grafana.net'));
});
test('SQLite retains pause and switches while credentials follow the current environment on restart', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-restart-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  let store = new Store(dir, secrets);
  const m = new Monitor(store);
  m.save({ ...DEFAULTS, zip: '98105', barkEnabled: true }, '');
  store.value.runtime.paused = true;
  store.commit();
  store.close();
  store = new Store(dir, { ...secrets, barkKey: 'new_environment_key' });
  assert.equal(store.value.config.zip, '98105');
  assert.equal(store.secrets.barkKey, 'new_environment_key');
  assert.ok(store.value.runtime.paused);
  assert.ok(store.value.config.barkEnabled);
  assert.equal(fs.statSync(path.join(dir, 'monitor.sqlite')).mode & 0o777, 0o600);
  store.close();
});
test('HTTP 541 yields UNKNOWN, no inventory pushes, no fake success, and bounded retry', async (t) => {
  const sent = [];
  const { m } = fixture(
    t,
    async () => {
      throw { safeMessage: 'HTTP 541，尚无有效库存结果' };
    },
    async (...args) => sent.push(args),
  );
  ready(m);
  await m.run();
  assert.ok(m.v.runtime.stores.every((s) => s.status === 'UNKNOWN'));
  assert.equal(m.v.runtime.lastComplete, null);
  assert.equal(sent.length, 0);
  assert.equal(m.v.runtime.phase, 'retrying');
  assert.ok(m.v.runtime.waitMs >= 180001 && m.v.runtime.waitMs <= 599999);
});
test('persistent available stock generates a new Bark id each round and only selected available stores', async (t) => {
  const sent = [];
  const { m } = fixture(
    t,
    async (c) => ({
      stores: c.stores.map((id) => ({
        id,
        name: STORES[id],
        status: id === 'R001' ? 'available' : 'unavailable',
        description: 'Today',
        checkedAt: Date.now(),
      })),
    }),
    async (url, payload) => sent.push(payload),
  );
  ready(m);
  await m.run();
  await m.run();
  assert.equal(sent.length, 2);
  assert.notEqual(sent[0].id, sent[1].id);
  assert.equal(sent[0].level, 'active');
  assert.equal(sent[0].url, PRODUCT.url);
  assert.equal(sent[0].device_key, secrets.barkKey);
  assert.ok(m.v.runtime.lastComplete);
});
test('stock Bark ids stay within the 64-byte APNs collapse ID limit for every product', async (t) => {
  const sent = [];
  const { m } = fixture(
    t,
    async (c) => ({
      stores: c.stores.map((id) => ({
        id,
        name: STORES[id],
        status: 'available',
        description: 'Today',
        checkedAt: Date.now(),
      })),
    }),
    async (url, payload) => sent.push(payload),
  );
  for (const color of Object.keys(COLORS)) {
    for (const capacity of Object.keys(CAPACITIES)) {
      for (const carrier of Object.keys(CARRIERS)) {
        ready(m, { color, capacity, carrier, version: m.v.config.version });
        await m.run();
      }
    }
  }
  await m.control('test-bark');
  assert.ok(sent.length >= 33);
  assert.ok(sent.every((p) => Buffer.byteLength(p.id) <= 64));
  assert.equal(new Set(sent.map((p) => p.id)).size, sent.length);
});

test('Bark HTTP 429 without Retry-After backs off and skips same-round retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const sent = [];
  const { m } = fixture(
    t,
    async (c) => ({
      stores: c.stores.map((id) => ({
        id,
        name: STORES[id],
        status: 'available',
        checkedAt: Date.now(),
      })),
    }),
    async (url, payload) => {
      sent.push(payload);
      throw { safeMessage: 'HTTP 429', status: 429, retryAt: 0 };
    },
  );
  ready(m);
  const start = Date.now();
  await m.run();
  assert.ok(m.v.runtime.bark.notBefore >= start + m.v.config.retryMin);
  t.mock.timers.tick(30000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
});

test('a Bark retry finishing during shutdown does not arm another retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  let attempts = 0;
  let finish;
  const { m } = fixture(
    t,
    async (c) => ({
      stores: c.stores.map((id) => ({
        id,
        name: STORES[id],
        status: id === 'R001' ? 'available' : 'unavailable',
        checkedAt: Date.now(),
      })),
    }),
    async () => {
      attempts++;
      if (attempts === 1) {
        throw { safeMessage: 'HTTP 500' };
      }
      await new Promise((resolve) => (finish = resolve));
      throw { safeMessage: 'HTTP 500' };
    },
  );
  ready(m);
  await m.run();
  t.mock.timers.tick(10001);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
  const timer = m.barkRetryTimer;
  const stopped = m.stop();
  finish();
  await stopped;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(m.barkRetryTimer, timer);
});

test('failed stock Bark retries in its round with the same id, then stops', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const sent = [];
  let failures = 2;
  const { m } = fixture(
    t,
    async (c) => ({
      stores: c.stores.map((id) => ({
        id,
        name: STORES[id],
        status: id === 'R001' ? 'available' : 'unavailable',
        description: 'Today',
        checkedAt: Date.now(),
      })),
    }),
    async (url, payload) => {
      sent.push(payload);
      if (failures > 0) {
        failures--;
        throw { safeMessage: 'HTTP 500' };
      }
    },
  );
  ready(m);
  await m.run();
  assert.equal(sent.length, 1);
  assert.equal(m.v.runtime.bark.pending.length, 1);
  t.mock.timers.tick(10001);
  await flush();
  assert.equal(sent.length, 2);
  t.mock.timers.tick(10001);
  await flush();
  assert.equal(sent.length, 3);
  assert.equal(new Set(sent.map((p) => p.id)).size, 1);
  assert.equal(m.v.runtime.bark.state, 'accepted');
  assert.equal(m.v.runtime.bark.pending.length, 0);

  failures = 9;
  sent.length = 0;
  await m.run();
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(10001);
    await flush();
  }
  assert.equal(sent.length, 3);
});

test('pausing cancels a queued stock Bark retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const sent = [];
  const { m } = fixture(
    t,
    async (c) => ({
      stores: c.stores.map((id) => ({
        id,
        name: STORES[id],
        status: 'available',
        checkedAt: Date.now(),
      })),
    }),
    async (url, payload) => {
      sent.push(payload);
      throw { safeMessage: 'HTTP 500' };
    },
  );
  ready(m);
  await m.run();
  const attempts = sent.length;
  await m.control('pause');
  t.mock.timers.tick(10001);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, attempts);
});

test('partial response preserves valid available stores, never updates full-success timestamp', async (t) => {
  const sent = [];
  const { m } = fixture(
    t,
    async () => ({
      stores: parseInventory(
        { body: { stores: [nativeStore('R001', 'available')] } },
        DEFAULTS.stores,
        Date.now(),
      ),
    }),
    async (_, p) => sent.push(p),
  );
  ready(m);
  await m.run();
  assert.equal(sent.length, 1);
  assert.equal(m.v.runtime.lastComplete, null);
  assert.equal(m.v.runtime.failures, 1);
});
test('target changes during a query discard old-version results and stock pushes', async (t) => {
  let resolve;
  const pending = new Promise((r) => (resolve = r));
  const sent = [];
  const { m } = fixture(
    t,
    () => pending,
    async (_, p) => sent.push(p),
  );
  ready(m);
  const running = m.run();
  m.save({ ...m.v.config, zip: '98105' }, '');
  resolve({ stores: [{ id: 'R001', status: 'available', checkedAt: Date.now() }] });
  await running;
  assert.equal(sent.length, 0);
  assert.ok(m.v.runtime.stores.every((s) => s.status === 'UNKNOWN'));
  assert.equal(m.v.config.zip, '98105');
});
test('disable Bark or pause while first push is in flight cancels subsequent store submissions', async (t) => {
  for (const operation of ['disable', 'pause']) {
    let release;
    let entered;
    const waiting = new Promise((r) => (release = r));
    const first = new Promise((r) => (entered = r));
    const sent = [];
    const { m } = fixture(
      t,
      async (c) => ({
        stores: c.stores.map((id) => ({
          id,
          name: STORES[id],
          status: 'available',
          checkedAt: Date.now(),
        })),
      }),
      async (_, p) => {
        sent.push(p);
        entered();
        await waiting;
      },
    );
    ready(m);
    const running = m.run();
    await first;
    if (operation === 'disable') {
      m.save({ ...m.v.config, barkEnabled: false }, '');
    } else {
      await m.control('pause');
    }
    release();
    await running;
    assert.equal(sent.length, 1);
  }
});
test('fault alert is sent once after 3 failures and 30 minutes; recovery sends once', async (t) => {
  let fail = true;
  const sent = [];
  const { m } = fixture(
    t,
    async (c) => {
      if (fail) {
        throw { safeMessage: 'HTTP 541' };
      }
      return {
        stores: c.stores.map((id) => ({ id, status: 'unavailable', checkedAt: Date.now() })),
      };
    },
    async (_, p) => sent.push(p),
  );
  ready(m);
  m.v.runtime.startedAt = Date.now() - 1800001;
  await m.run();
  await m.run();
  assert.equal(sent.length, 0);
  await m.run();
  await m.run();
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /故障/);
  fail = false;
  await m.run();
  await m.run();
  assert.equal(sent.length, 2);
  assert.match(sent[1].title, /恢复/);
});
test('Retry-After exceeding maximum pauses queries and immediately reports through Bark', async (t) => {
  const sent = [];
  const { m } = fixture(
    t,
    async () => {
      throw { safeMessage: 'HTTP 429', retryAt: Date.now() + 900000 };
    },
    async (_, p) => sent.push(p),
  );
  ready(m);
  await m.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(m.v.runtime.paused);
  assert.equal(m.v.runtime.nextAt, null);
  assert.equal(m.v.runtime.phase, 'attention');
  assert.equal(sent.length, 1);
});
test('request query advances to the persisted minimum interval and repeated clicks keep the same timer', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  let calls = 0;
  const { m, dir } = fixture(t, async (c) => {
    calls++;
    return { stores: c.stores.map((id) => ({ id, status: 'unavailable', checkedAt: Date.now() })) };
  });
  ready(m);
  m.schedule();
  const floor = Date.now() + m.v.config.normalMin;
  const original = m.v.runtime.nextAt;
  assert.equal(m.v.runtime.notBefore, floor);
  const reopened = new Store(dir, secrets);
  try {
    assert.equal(reopened.value.runtime.notBefore, floor);
  } finally {
    reopened.close();
  }
  assert.equal((await m.control('query')).queryStatus, 'scheduled');
  assert.equal(m.v.runtime.nextAt, floor);
  assert.ok(m.v.runtime.nextAt <= original);
  t.mock.timers.tick(10000);
  assert.equal((await m.control('query')).queryStatus, 'scheduled');
  assert.equal(m.v.runtime.nextAt, floor);
  t.mock.timers.tick(m.v.config.normalMin - 10001);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(m.store.history().items[0].outcome, 'complete');
});
test('eligible request query starts collection, reports the current version, and never overlaps', async (t) => {
  let release;
  let began;
  const collecting = new Promise((resolve) => {
    began = resolve;
  });
  let calls = 0;
  const { m } = fixture(t, () => {
    calls++;
    began();
    return new Promise((r) => (release = r));
  });
  await assert.rejects(m.control('query'), /请先恢复监控/);
  ready(m);
  m.v.runtime.notBefore = Date.now() - 1;
  assert.equal((await m.control('query')).queryStatus, 'started');
  assert.equal(m.v.runtime.phase, 'checking');
  assert.equal(m.v.runtime.configVersion, m.v.config.version);
  assert.equal(m.store.history().items[0].id, m.v.runtime.round);
  assert.equal((await m.control('query')).queryStatus, 'busy');
  await m.run();
  await collecting;
  assert.equal(calls, 1);
  release({
    stores: m.v.config.stores.map((id) => ({ id, status: 'unavailable', checkedAt: Date.now() })),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(m.busy, false);
  assert.equal(m.store.history().total, 1);
  await m.stop();
  await assert.rejects(m.control('query'), { status: 409 });
});

test('pause, disabling phone calls and shutdown resolve a group only after its alert finishes', async (t) => {
  for (const action of ['pause', 'disable', 'stop']) {
    let release;
    let began;
    const started = new Promise((resolve) => {
      began = resolve;
    });
    const sent = [];
    let remote;
    const { m } = fixture(
      t,
      undefined,
      async (_, payload) => {
        sent.push(payload.state);
        if (payload.state === 'alerting') {
          began();
          await new Promise((resolve) => {
            release = resolve;
          });
        }
        remote = payload.state;
      },
      phoneSecrets,
    );
    m.save({ ...DEFAULTS, irmEnabled: true });
    const sending = m.control('test-irm');
    await started;
    let cleanup;
    if (action === 'disable') {
      m.save({ ...m.v.config, irmEnabled: false });
      cleanup = m.cleanupIrm();
    } else {
      cleanup = action === 'pause' ? m.control('pause') : m.stop();
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sent, ['alerting'], action);
    release();
    await Promise.all([sending, cleanup]);
    assert.deepEqual(sent, ['alerting', 'OK'], action);
    assert.equal(remote, 'OK', action);
    assert.equal(m.v.runtime.irm.groups.length, 0, action);
    assert.equal(m.v.runtime.irm.state, action === 'disable' ? 'disabled' : 'idle');
  }
});

test('pause retains a failed in-flight phone group and its Retry-After deadline', async (t) => {
  let reject;
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const sent = [];
  const { m } = fixture(
    t,
    undefined,
    async (_, payload) => {
      sent.push(payload.state);
      began();
      await new Promise((_, fail) => {
        reject = fail;
      });
    },
    phoneSecrets,
  );
  m.save({ ...DEFAULTS, irmEnabled: true });
  const sending = m.control('test-irm');
  await started;
  const paused = m.control('pause');
  const retryAt = Date.now() + 3600000;
  reject({ safeMessage: 'HTTP 429', retryAt });
  await Promise.all([sending, paused]);
  assert.deepEqual(sent, ['alerting']);
  assert.equal(m.v.runtime.paused, true);
  assert.equal(m.v.runtime.irm.groups.length, 1);
  assert.equal(m.v.runtime.irm.notBefore, retryAt);
});

test('Bark failures use a short cooldown independently of query retries and allow testing at the deadline', async (t) => {
  let now = Date.now();
  let requests = 0;
  t.mock.method(Date, 'now', () => now);
  const { m, dir } = fixture(t, undefined, async () => {
    requests++;
    if (requests === 1) {
      throw new Error('Network timeout');
    }
  });
  ready(m, { retryMin: 500001, retryMax: 599999 });
  assert.equal(await m.bark({ id: 'stock', title: 'Stock', body: 'Stock' }), false);
  assert.equal(m.v.runtime.bark.state, 'cooldown');
  const deadline = now + 10000;
  assert.equal(m.v.runtime.bark.notBefore, deadline);
  const reopened = new Store(dir, secrets);
  try {
    assert.equal(reopened.value.runtime.bark.notBefore, deadline);
  } finally {
    reopened.close();
  }
  now = deadline - 1;
  await assert.rejects(m.control('test-bark'), { status: 429 });
  assert.equal(requests, 1);
  now = deadline;
  await m.control('test-bark');
  assert.equal(requests, 2);
  assert.equal(m.v.runtime.bark.state, 'accepted');
  assert.equal(m.v.runtime.bark.notBefore, 0);
});

test('Bark tests and stock pushes serialize and cannot erase or bypass Retry-After', async (t) => {
  for (const limitedRequest of [1, 2]) {
    let release;
    let began;
    const started = new Promise((resolve) => {
      began = resolve;
    });
    const retryAt = Date.now() + 3600000;
    let requests = 0;
    const { m, dir } = fixture(t, undefined, async () => {
      requests++;
      if (requests === 1) {
        began();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      if (requests === limitedRequest) {
        throw { safeMessage: 'HTTP 429', retryAt };
      }
    });
    ready(m);
    const stock = m.bark({ id: 'stock', title: 'Stock', body: 'Stock' }, { activeOnly: true });
    await started;
    const testing = m.control('test-bark');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);
    release();
    await Promise.all([stock, testing]);
    assert.equal(requests, limitedRequest);
    assert.equal(m.v.runtime.bark.state, 'cooldown');
    assert.equal(m.v.runtime.bark.notBefore, retryAt);
    assert.equal(await m.bark({ id: 'later', title: 'Later', body: 'Later' }), false);
    assert.equal(requests, limitedRequest);
    const reopened = new Store(dir, secrets);
    try {
      assert.equal(reopened.value.runtime.bark.notBefore, retryAt);
    } finally {
      reopened.close();
    }
  }
});

test('queued stock notifications are cancelled when monitoring pauses or its target changes', async (t) => {
  for (const action of ['pause', 'target', 'stop']) {
    let release;
    let began;
    const started = new Promise((resolve) => {
      began = resolve;
    });
    let requests = 0;
    const { m } = fixture(t, undefined, async () => {
      requests++;
      began();
      await new Promise((resolve) => {
        release = resolve;
      });
    });
    ready(m);
    const first = m.bark({ id: 'first', title: 'First', body: 'First' });
    await started;
    const queued = m.bark({ id: 'queued', title: 'Queued', body: 'Queued' }, { activeOnly: true });
    let stopped;
    if (action === 'target') {
      m.save({ ...m.v.config, zip: '10002' });
    } else {
      stopped = action === 'pause' ? m.control('pause') : m.stop();
    }
    release();
    await Promise.all([first, stopped]);
    assert.equal(await queued, false, action);
    assert.equal(requests, 1, action);
  }
});

test('notification state commit failures propagate without being reported as network failures', async (t) => {
  for (const channel of ['bark', 'alert', 'cleanup']) {
    let accepted = false;
    const { m, store } = fixture(
      t,
      undefined,
      async () => {
        accepted = true;
      },
      phoneSecrets,
    );
    m.save({ ...DEFAULTS, barkEnabled: true, irmEnabled: true });
    if (channel === 'cleanup') {
      await m.control('test-irm');
    }
    accepted = false;
    const failure = Object.assign(new Error('database is busy'), { code: 'SQLITE_BUSY' });
    const commit = store.commit.bind(store);
    let failed = false;
    t.mock.method(store, 'commit', () => {
      if (accepted && !failed) {
        failed = true;
        throw failure;
      }
      commit();
    });
    let operation;
    if (channel === 'bark') {
      operation = m.bark({ id: 'test', title: 'Test', body: 'Test' });
    } else if (channel === 'alert') {
      operation = m.submitIrm('test', 'Test', 'Test');
    } else {
      operation = m.cleanupIrm();
    }
    await assert.rejects(operation, (e) => e === failure);
    assert.equal(accepted, true);
    assert.equal(
      m.v.events.some((e) => /网络错误|请求失败|发送失败/.test(e.message)),
      false,
    );
  }
});
test('request query preserves error minimum and Retry-After even when the target changes in flight', async (t) => {
  let now = Date.now();
  let reject;
  t.mock.method(Date, 'now', () => now);
  const { m } = fixture(t, () => new Promise((_, r) => (reject = r)));
  ready(m);
  const running = m.run();
  await new Promise((resolve) => setImmediate(resolve));
  m.save({ ...m.v.config, zip: '10002' });
  now += 1000;
  const retryAt = now + 300000;
  reject({ safeMessage: 'HTTP 429', retryAt });
  await running;
  assert.equal(m.v.runtime.notBefore, retryAt);
  assert.equal(m.v.runtime.phase, 'retrying');
  assert.equal((await m.control('query')).queryStatus, 'scheduled');
  assert.equal(m.v.runtime.nextAt, retryAt);
  const item = m.store.history().items[0];
  assert.equal(item.superseded, true);
  assert.equal(item.outcome, 'failed');
  now = retryAt;
  m.v.runtime.notBefore = 0;
  m.schedule(true);
  assert.equal((await m.control('query')).queryStatus, 'scheduled');
  assert.equal(m.v.runtime.nextAt, now + m.v.config.retryMin);
});
test('events keep 200 live entries, 30 days in SQLite, 20 screenshots, and stock events permanently', (t) => {
  const { store, dir } = fixture(t);
  const DAY = 86400000;
  fs.mkdirSync(path.join(dir, 'diagnostics'));
  for (let i = 0; i < 205; i++) {
    fs.writeFileSync(path.join(dir, 'diagnostics', `${i}.png`), 'test');
    store.event('error', 'test', `${i}`);
  }
  store.commit();
  assert.equal(store.value.events.length, 200);
  assert.equal(store.value.events.filter((e) => e.diagnostic).length, 20);
  assert.equal(fs.readdirSync(path.join(dir, 'diagnostics')).length, 20);
  assert.ok(store.hasDiagnostic('204'));
  assert.ok(!store.hasDiagnostic('0'));
  const seen = new Set();
  let page = store.eventLog();
  assert.equal(page.retentionDays, 30);
  assert.equal(page.items.length, 50);
  for (;;) {
    for (const e of page.items) {
      seen.add(e.id);
    }
    if (!page.nextCursor) {
      break;
    }
    page = store.eventLog(new URLSearchParams({ before: page.nextCursor }));
  }
  assert.equal(seen.size, 205);

  const now = Date.now();
  store.event('query', 'routine expired');
  store.event('query', 'routine boundary');
  store.event('query', '第 7 版查询完成：1 家可取货，5 家有效。', undefined, true);
  const [stock, boundary, expired] = store.value.events;
  expired.at = now - 30 * DAY - 1000;
  boundary.at = now - 30 * DAY + 60000;
  stock.at = now - 400 * DAY;
  store.commit();
  const messages = (type) =>
    store.eventLog(new URLSearchParams(type ? { type } : {})).items.map((e) => e.message);
  assert.ok(!messages().includes('routine expired'));
  assert.ok(messages().includes('routine boundary'));
  assert.deepEqual(messages('stock'), ['第 7 版查询完成：1 家可取货，5 家有效。']);
  assert.equal(messages('error').length, 50);
  assert.ok(!store.value.events.some((e) => e.message === 'routine expired'));
  for (const params of [{ type: 'x' }, { before: 'abc' }, { before: '0' }]) {
    assert.throws(() => store.eventLog(new URLSearchParams(params)), /事件筛选条件无效/);
  }

  const reopened = new Store(dir, store.secrets);
  try {
    assert.equal(reopened.value.events.length, 200);
    assert.ok(reopened.value.events.every((e) => Number.isSafeInteger(e.seq)));
    assert.equal(reopened.value.events[0].message, '第 7 版查询完成：1 家可取货，5 家有效。');
    assert.equal(reopened.value.events[0].keep, true);
    const state = JSON.parse(reopened.db.prepare('SELECT json FROM state WHERE id=1').get().json);
    assert.ok(!('events' in state));
  } finally {
    reopened.close();
  }
});
test('legacy events stored in the state JSON migrate in order and keep stock records', (t) => {
  const { store, dir } = fixture(t);
  const DAY = 86400000;
  const now = Date.now();
  const legacy = [
    { id: 'e5', at: now - 1000, type: 'query', message: '第 7 版查询完成：0 家可取货，5 家有效。' },
    {
      id: 'e4',
      at: now - 2000,
      type: 'bark',
      message: 'iPhone Duo · Alderwood：Bark 服务已接受。',
    },
    { id: 'e3', at: now - 3000, type: 'bark', message: '测试通知：Bark 服务已接受。' },
    {
      id: 'e2',
      at: now - 40 * DAY,
      type: 'query',
      message: '第 7 版查询完成：2 家可取货，5 家有效。',
    },
    { id: 'e1', at: now - 40 * DAY, type: 'control', message: '已暂停监控。' },
  ];
  const state = JSON.parse(store.db.prepare('SELECT json FROM state WHERE id=1').get().json);
  store.db
    .prepare('UPDATE state SET json=? WHERE id=1')
    .run(JSON.stringify({ ...state, events: legacy }));
  const reopened = new Store(dir, store.secrets);
  try {
    assert.deepEqual(
      reopened.value.events.map((e) => [e.id, !!e.keep]),
      [
        ['e5', false],
        ['e4', true],
        ['e3', false],
        ['e2', true],
      ],
    );
    assert.deepEqual(
      reopened.eventLog(new URLSearchParams({ type: 'stock' })).items.map((e) => e.id),
      ['e4', 'e2'],
    );
    const saved = JSON.parse(reopened.db.prepare('SELECT json FROM state WHERE id=1').get().json);
    assert.ok(!('events' in saved));
  } finally {
    reopened.close();
  }
});
test('stock rounds mark their query and notification events for permanent retention', async (t) => {
  let fail = true;
  let available = true;
  const { m } = fixture(
    t,
    async (c) => ({
      stores: c.stores.map((id) => ({
        id,
        name: STORES[id],
        status: available && id === 'R001' ? 'available' : 'unavailable',
        description: 'Today',
        checkedAt: Date.now(),
      })),
    }),
    async () => {
      if (fail) {
        throw { safeMessage: 'HTTP 500' };
      }
    },
  );
  ready(m);
  await m.run();
  clearTimeout(m.barkRetryTimer);
  const kept = () => m.store.eventLog(new URLSearchParams({ type: 'stock' })).items;
  assert.deepEqual(
    kept().map((e) => e.message),
    [
      `iPhone Duo · ${STORES.R001}：Bark 发送失败：HTTP 500；Bark 渠道独立冷却。`,
      '第 1 版查询完成：1 家可取货，4 家有效。',
    ].map((text) => text.replace('第 1 版', `第 ${m.v.config.version} 版`)),
  );
  fail = false;
  m.v.runtime.bark.notBefore = 0;
  await m.run();
  assert.equal(kept()[0].message, `iPhone Duo · ${STORES.R001}：Bark 服务已接受。`);
  available = false;
  await m.run();
  await m.bark({ id: 'test', title: 'test', body: 'test' }, { test: true });
  assert.equal(kept().length, 4);
  assert.ok(!m.v.events[0].keep);
  assert.ok(!m.v.events[1].keep);
});
test('startup keeps pause, marks previous result stale and never sends a stock notification', (t) => {
  const { m } = fixture(t);
  m.v.config = structuredClone(DEFAULTS);
  m.v.runtime.stores[0] = {
    id: 'R001',
    status: 'available',
    lastValid: { status: 'available', checkedAt: 1 },
  };
  m.start();
  assert.equal(m.v.runtime.stores[0].status, 'UNKNOWN');
  assert.equal(m.v.runtime.stores[0].lastValid.status, 'available');
  assert.equal(m.timer, null);
});
test('phone failures cool down independently while Bark and later queries continue', async (t) => {
  const sent = [];
  const { m } = fixture(
    t,
    async (c) => ({
      stores: c.stores.map((id) => ({
        id,
        name: STORES[id],
        status: 'available',
        checkedAt: Date.now(),
      })),
    }),
    async (url, p) => {
      if (url !== 'https://api.day.app/push') {
        throw { safeMessage: 'HTTP 429', retryAt: Date.now() + 900000 };
      }
      sent.push(p);
    },
    phoneSecrets,
  );
  m.save({ ...DEFAULTS, barkEnabled: true, irmEnabled: true }, 'example.grafana.net');
  m.v.runtime.paused = false;
  await m.run();
  assert.equal(m.v.runtime.irm.state, 'cooldown');
  assert.equal(sent.length, 4);
  assert.equal(m.v.runtime.paused, false);
  await m.run();
  assert.equal(sent.length, 8);
});
test('phone test remains alerting long enough for dispatch and is resolved by the next query', async (t) => {
  const sent = [];
  const { m } = fixture(t, undefined, async (_, payload) => sent.push(payload), phoneSecrets);
  m.save({ ...DEFAULTS, irmEnabled: true }, 'example.grafana.net');
  await m.control('test-irm');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].state, 'alerting');
  assert.equal(m.v.runtime.irm.groups.length, 1);
  m.v.runtime.paused = false;
  await m.run();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].state, 'OK');
  assert.equal(sent[1].group_key, sent[0].group_key);
  assert.equal(m.v.runtime.irm.groups.length, 0);
});
test('notification adapter accepts Grafana JSON string Ok. and Bark code 200, rejects unknown responses and honors retry headers', async (t) => {
  const { post } = require('../core.cjs');
  let response = new Response(JSON.stringify('Ok.'));
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    assert.equal(options.redirect, 'error');
    return response;
  });
  await post('https://example.grafana.net/webhook', {}, 'irm');
  response = new Response(JSON.stringify({ code: 200 }));
  await post('https://api.day.app/push', {}, 'bark');
  response = new Response(JSON.stringify({}));
  await assert.rejects(post('https://example.grafana.net/webhook', {}, 'irm'), {
    safeMessage: '服务未明确接受通知',
  });
  response = new Response(JSON.stringify('error'));
  await assert.rejects(post('https://example.grafana.net/webhook', {}, 'irm'));
  response = new Response('unavailable', { status: 429, headers: { 'retry-after': '600' } });
  await assert.rejects(
    post('https://example.grafana.net/webhook', {}, 'irm'),
    (error) =>
      error.safeMessage === 'HTTP 429' &&
      error.status === 429 &&
      error.retryAt >= Date.now() + 599000,
  );
});

test('phone honours a long Retry-After across restart and can clear its group when the deadline expires', async (t) => {
  let now = Date.now();
  let limited = true;
  t.mock.method(Date, 'now', () => now);
  const sent = [];
  const retryAt = now + 900000;
  const { m, dir } = fixture(
    t,
    undefined,
    async (_, payload) => {
      sent.push(payload);
      if (limited) {
        throw { safeMessage: 'HTTP 429', retryAt };
      }
    },
    phoneSecrets,
  );
  m.save({ ...DEFAULTS, irmEnabled: true }, 'example.grafana.net');
  await m.control('test-irm');
  assert.equal(m.v.runtime.irm.state, 'cooldown');
  assert.equal(m.v.runtime.irm.notBefore, retryAt);
  const reopened = new Store(dir, m.store.secrets);
  try {
    assert.equal(reopened.value.runtime.irm.notBefore, retryAt);
  } finally {
    reopened.close();
  }
  m.save({ ...m.v.config, irmEnabled: false }, 'example.grafana.net');
  m.save({ ...m.v.config, irmEnabled: true }, 'example.grafana.net');
  assert.equal(m.v.runtime.irm.state, 'cooldown');
  assert.equal(m.v.runtime.irm.notBefore, retryAt);
  now = retryAt - 1;
  await assert.rejects(m.control('cleanup-irm'), { status: 429 });
  await assert.rejects(m.control('recover-irm'), { status: 400 });
  assert.equal(sent.length, 1);
  limited = false;
  now = retryAt;
  await m.control('cleanup-irm');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].state, 'OK');
  assert.equal(sent[1].group_key, sent[0].group_key);
  assert.equal(m.v.runtime.irm.groups.length, 0);
  assert.equal(m.v.runtime.irm.notBefore, 0);
  assert.equal(m.v.runtime.paused, true);
  assert.equal(m.timer, null);
  await m.control('test-irm');
  assert.equal(sent.length, 3);
  assert.equal(sent[2].state, 'alerting');
});

test('legacy permanent phone pause requires explicit recovery and retains the old webhook until cleanup', async (t) => {
  for (const legacyState of ['paused', 'disabled']) {
    const sent = [];
    const { m, dir } = fixture(t, undefined, async (_, payload) => sent.push(payload), {
      ...secrets,
      irmWebhook: 'https://example.grafana.net/old',
    });
    m.save({ ...DEFAULTS, irmEnabled: true }, 'example.grafana.net');
    await m.control('test-irm');
    m.v.runtime.irm.state = legacyState;
    m.v.runtime.irm.notBefore = Number.MAX_SAFE_INTEGER;
    m.publish();
    const reopened = new Store(dir, m.store.secrets);
    try {
      assert.equal(reopened.value.runtime.irm.notBefore, Number.MAX_SAFE_INTEGER);
    } finally {
      reopened.close();
    }
    await assert.rejects(m.control('cleanup-irm'), { status: 429 });
    assert.throws(() =>
      m.save(
        { ...m.v.config, irmWebhook: 'https://example.grafana.net/new' },
        'example.grafana.net',
      ),
    );
    assert.equal(sent.length, 1);
    await m.control('recover-irm');
    assert.equal(sent.length, 2);
    assert.equal(sent[1].state, 'OK');
    assert.equal(m.v.runtime.irm.groups.length, 0);
    assert.equal(m.v.runtime.paused, true);
    assert.equal(m.v.runtime.irm.notBefore, 0);
    const changed = new Store(dir, { ...secrets, irmWebhook: 'https://example.grafana.net/new' });
    try {
      assert.equal(changed.secrets.irmWebhook, 'https://example.grafana.net/new');
    } finally {
      changed.close();
    }
  }
});

test('phone cleanup stays paused, rejects active queries/tests and reports a failed cleanup without dropping the group', async (t) => {
  const { m } = fixture(t, undefined, undefined, phoneSecrets);
  m.save({ ...DEFAULTS, irmEnabled: true }, 'example.grafana.net');
  await m.control('test-irm');
  for (const flag of ['busy', 'testing']) {
    m[flag] = true;
    await assert.rejects(m.control('cleanup-irm'), { status: 409 });
    m[flag] = false;
  }
  m.v.runtime.paused = false;
  await assert.rejects(m.control('cleanup-irm'), { status: 409 });
  m.v.runtime.paused = true;
  m.post = async () => {
    throw { safeMessage: 'HTTP 503' };
  };
  await assert.rejects(m.control('cleanup-irm'), { status: 502 });
  assert.equal(m.v.runtime.irm.groups.length, 1);
  assert.equal(m.v.runtime.paused, true);
  assert.equal(m.timer, null);
});

test('Bark rate limit stops same-round pushes and manual tests, survives restart, and resumes only with fresh stock', async (t) => {
  let now = Date.now();
  let limited = true;
  t.mock.method(Date, 'now', () => now);
  const barkSent = [];
  const phoneSent = [];
  const retryAt = now + 900000;
  const { m, dir } = fixture(
    t,
    async (c) => ({
      stores: c.stores.map((id) => ({ id, name: STORES[id], status: 'available', checkedAt: now })),
    }),
    async (_, payload, channel) => {
      if (channel === 'bark') {
        barkSent.push(payload);
        if (limited) {
          throw { safeMessage: 'HTTP 429', retryAt };
        }
      } else {
        phoneSent.push(payload);
      }
    },
    phoneSecrets,
  );
  m.save({ ...DEFAULTS, barkEnabled: true, irmEnabled: true }, 'example.grafana.net');
  m.v.runtime.paused = false;
  await m.run();
  assert.equal(barkSent.length, 1);
  assert.equal(phoneSent.length, 1);
  assert.equal(m.v.runtime.bark.state, 'cooldown');
  assert.equal(m.v.runtime.bark.notBefore, retryAt);
  assert.ok(m.v.runtime.nextAt < retryAt);
  const reopened = new Store(dir, m.store.secrets);
  try {
    assert.equal(reopened.value.runtime.bark.notBefore, retryAt);
  } finally {
    reopened.close();
  }
  m.save({ ...m.v.config, barkEnabled: false }, 'example.grafana.net');
  m.save({ ...m.v.config, barkEnabled: true }, 'example.grafana.net');
  assert.equal(m.v.runtime.bark.state, 'cooldown');
  assert.equal(m.v.runtime.bark.notBefore, retryAt);
  now = retryAt - 1;
  await assert.rejects(m.control('test-bark'), { status: 429 });
  await m.run();
  assert.equal(barkSent.length, 1);
  assert.ok(phoneSent.length > 1);
  limited = false;
  now = retryAt;
  await m.run();
  assert.equal(barkSent.length, 5);
  assert.ok(
    barkSent.slice(1).every((p) => p.id !== barkSent[0].id && p.id.endsWith(m.v.runtime.round)),
  );
  assert.equal(m.v.runtime.bark.state, 'accepted');
  assert.equal(m.v.runtime.bark.notBefore, 0);
});

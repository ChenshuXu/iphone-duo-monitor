const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { CONFIG } = require('./fixture.cjs');

async function startServer(t, script, environment = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-http-'));
  const child = spawn(process.execPath, script ? ['-e', script] : ['server.cjs'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DATA_DIR: dir,
      PUBLIC_ORIGIN: 'http://127.0.0.1:8080',
      BARK_KEY: '',
      GRAFANA_IRM_WEBHOOK: '',
      GRAFANA_IRM_HOST: '',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(async () => {
    if (child.connected) {
      child.disconnect();
    }
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(dir, { recursive: true });
  });
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(() => {
      throw new Error('Server exited before startup');
    }),
  ]);
  const api = (url, options) => fetch(`http://127.0.0.1:8080${url}`, options);
  return {
    api,
    child,
    advance: async (ms) => {
      const reply = once(child, 'message');
      child.send(ms);
      await reply;
    },
  };
}

const observeRequests = `
  const http = require('node:http');
  const createServer = http.createServer;
  http.createServer = function(handler) {
    return createServer.call(this, (req, res) => {
      req.on('aborted', () => process.send('aborted:' + req.url));
      const result = handler(req, res);
      process.send('request:' + req.url);
      return result;
    });
  };
`;

function message(child, expected) {
  return new Promise((resolve) => {
    const listener = (value) => {
      if (value === expected) {
        child.off('message', listener);
        resolve();
      }
    };
    child.on('message', listener);
  });
}

function pendingRequest(route, input, method = 'POST') {
  const payload = JSON.stringify(input);
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(
      {
        hostname: '127.0.0.1',
        port: 8080,
        path: route,
        method,
        headers: {
          origin: 'http://127.0.0.1:8080',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    request.on('error', reject);
    request.write(payload.slice(0, 1));
  });
  return { request, response, finish: () => request.end(payload.slice(1)) };
}

test(
  'invalid request URLs and aborted uploads do not terminate the HTTP service',
  { timeout: 15000 },
  async (t) => {
    const { api, child } = await startServer(t, `${observeRequests} require('./server.cjs');`);
    const invalid = await new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port: 8080, path: '//[' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      request.on('error', reject);
    });
    assert.equal(invalid, 400);
    for (const [route, input, method] of [
      ['/api/control', { action: 'pause' }, 'POST'],
      ['/api/settings', CONFIG, 'PUT'],
      ['/api/discover', CONFIG, 'POST'],
    ]) {
      const received = message(child, `request:${route}`);
      const aborted = message(child, `aborted:${route}`);
      const pending = pendingRequest(route, input, method);
      const disconnected = assert.rejects(pending.response, { code: 'ECONNRESET' });
      await received;
      pending.request.destroy();
      await Promise.all([aborted, disconnected]);
      assert.equal((await api('/api/status')).status, 200);
      assert.equal(child.exitCode, null);
    }
  },
);

test(
  'discovery excludes overlapping discoveries and mutations whose bodies arrived earlier',
  { timeout: 15000 },
  async (t) => {
    const { api, child } = await startServer(
      t,
      `
    ${observeRequests}
    const Module = require('node:module');
    const load = Module._load;
    const releases = [];
    process.on('message', () => { for (const release of releases) release(); });
    Module._load = function(request, parent, isMain) {
      if (request === './browser.cjs' && parent.filename.endsWith('/server.cjs')) return { AppleBrowser: class {
        async collect() {
          process.send('collecting');
          await new Promise(resolve => releases.push(resolve));
          return { catalog: { R001: 'Test Store' } };
        }
        async close() {}
      } };
      return load.call(this, request, parent, isMain);
    };
    require('./server.cjs');
  `,
    );
    const headers = { origin: 'http://127.0.0.1:8080', 'content-type': 'application/json' };
    assert.equal(
      (await api('/api/settings', { method: 'PUT', headers, body: JSON.stringify(CONFIG) })).status,
      200,
    );
    const pending = [];
    for (const [route, input, method] of [
      ['/api/discover', CONFIG, 'POST'],
      ['/api/control', { action: 'resume' }, 'POST'],
      ['/api/settings', { ...CONFIG, version: 2 }, 'PUT'],
    ]) {
      const received = message(child, `request:${route}`);
      pending.push(pendingRequest(route, input, method));
      await received;
    }
    const collecting = message(child, 'collecting');
    const discovery = api('/api/discover', {
      method: 'POST',
      headers,
      body: JSON.stringify(CONFIG),
    });
    await collecting;
    try {
      for (const request of pending) {
        request.finish();
      }
      assert.deepEqual(await Promise.all(pending.map((p) => p.response)), [409, 409, 409]);
      const status = await (await api('/api/status')).json();
      assert.equal(status.runtime.paused, true);
      assert.equal(status.config.version, 2);
    } finally {
      child.send('release');
      for (const request of pending) {
        request.request.destroy();
      }
      assert.equal((await discovery).status, 200);
    }
    assert.equal(
      (await api('/api/discover', { method: 'POST', headers, body: JSON.stringify(CONFIG) }))
        .status,
      429,
    );
  },
);

test(
  'fresh HTTP service saves variants without bootstrap files, rejects cross-origin writes, and hides secrets',
  { timeout: 15000 },
  async (t) => {
    const credentials = {
      BARK_KEY: 'fake_private_test_key',
      GRAFANA_IRM_WEBHOOK: 'https://example.grafana.net/fake-private-token',
    };
    const { api } = await startServer(t, undefined, credentials);
    const headers = { origin: 'http://127.0.0.1:8080', 'content-type': 'application/json' };
    const initial = await (await api('/api/status')).json();
    const translations = await api('/i18n.js');
    assert.equal(translations.status, 200);
    assert.match(translations.headers.get('content-type'), /javascript/);
    assert.match(await translations.text(), /monitorI18n/);
    const log = await (await api('/api/event-log')).json();
    assert.equal(log.retentionDays, 30);
    assert.equal(log.nextCursor, null);
    assert.equal(log.items[0].message, '服务启动；旧库存待重新核验。');
    assert.equal(log.items[0].seq, initial.events[0].seq);
    assert.equal((await api('/api/event-log?type=unknown')).status, 400);
    assert.equal((await api('/api/event-log?before=-1')).status, 400);
    assert.equal((await api('/api/diagnostics/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.deepEqual(initial.retention, { historyDays: 60, eventDays: 30 });
    assert.equal(initial.runtime.paused, true);
    assert.equal(initial.config.zip, '');
    assert.equal(initial.config.barkConfigured, true);
    assert.equal(initial.config.irmConfigured, true);
    assert.equal(initial.config.barkEnabled, true);
    assert.equal(initial.config.irmEnabled, true);
    const input = { ...CONFIG, color: 'nightsky', capacity: '2tb', barkEnabled: true };
    assert.equal(
      (
        await api('/api/settings', {
          method: 'PUT',
          headers: { ...headers, origin: 'http://evil.test' },
          body: JSON.stringify(input),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await api('/api/settings', {
          method: 'PUT',
          headers: { ...headers, 'content-type': 'text/plain' },
          body: JSON.stringify(input),
        })
      ).status,
      415,
    );
    const saved = await api('/api/settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify(input),
    });
    assert.equal(saved.status, 200);
    const settings = await saved.json();
    assert.equal(settings.capacity, '2tb');
    assert.equal(settings.barkConfigured, true);
    const state = await (await api('/api/status')).json();
    assert.match(state.product.url, /2tb-night-sky-t-mobile$/);
    for (const route of ['/api/settings', '/api/status', '/api/history']) {
      const text = await (await api(route)).text();
      assert.ok(!text.includes(credentials.BARK_KEY));
      assert.ok(!text.includes('fake-private-token'));
    }
    for (const field of ['barkKey', 'irmWebhook', 'clear_barkKey', 'clear_irmWebhook']) {
      assert.equal(
        (
          await api('/api/settings', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ ...settings, [field]: 'attempted-change' }),
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (await api('/api/settings', { method: 'PUT', headers, body: JSON.stringify(input) })).status,
      409,
    );
    assert.equal(
      (
        await api('/api/discover', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...input, color: 'bad' }),
        })
      ).status,
      400,
    );
  },
);

test(
  'discovery and manual queries share a cooldown, and the control API starts eligible queries',
  { timeout: 15000 },
  async (t) => {
    const { api, advance } = await startServer(
      t,
      `
    const Module = require('node:module'), load = Module._load;
    let now = Date.now(); Date.now = () => now;
    process.on('message', ms => { now += ms; process.send('advanced'); });
    Module._load = function(request, parent, isMain) {
      if (request === './browser.cjs' && parent.filename.endsWith('/server.cjs')) return { AppleBrowser: class {
        async collect(c, id, discover) {
          now += 61000;
          if (!discover) return { stores: c.stores.map(id => ({ id, name: c.catalog[id], status: 'unavailable', checkedAt: now })) };
          if (c.zip === '10002') throw { safeMessage: 'HTTP 429', retryAt: now + 900000 };
          if (c.zip === '10003') throw { safeMessage: 'HTTP 503' };
          return { catalog: { R001: 'Test Store' }, product: { part: 'TEST/A' } };
        }
        async close() {}
      } };
      return load.call(this, request, parent, isMain);
    };
    require('./server.cjs');
  `,
    );
    const discover = async (zip = '10001') => {
      const res = await api('/api/discover', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:8080', 'content-type': 'application/json' },
        body: JSON.stringify({ ...CONFIG, zip }),
      });
      await res.json();
      return res.status;
    };
    const pushes = [];
    let pushed = () => {};
    const nextPush = () =>
      new Promise((resolve) => {
        pushed = resolve;
      });
    const stream = http.get({ hostname: '127.0.0.1', port: 8080, path: '/api/events' });
    t.after(() => stream.destroy());
    stream.on('response', (res) => {
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          pushes.push(JSON.parse(part.slice('data: '.length)));
          pushed();
        }
      });
    });
    await nextPush();
    assert.ok(Array.isArray(pushes[0].events));
    const discoveryPush = nextPush();
    assert.equal(await discover(), 200);
    await discoveryPush;
    // A discovery publishes state without adding an event, so its push leaves events out.
    assert.equal(Object.hasOwn(pushes[1], 'events'), false);
    assert.equal(await discover(), 429);
    await advance(59999);
    assert.equal(await discover(), 429);
    await advance(1);
    assert.equal(await discover('10002'), 502);
    await advance(899999);
    assert.equal(await discover(), 429);
    await advance(1);
    assert.equal(await discover(), 200);
    await advance(60000);
    assert.equal(await discover('10003'), 502);
    await advance(179999);
    assert.equal(await discover(), 429);
    await advance(1);
    assert.equal(await discover(), 200);
    const headers = { origin: 'http://127.0.0.1:8080', 'content-type': 'application/json' };
    const state = await (await api('/api/status')).json();
    assert.equal(state.runtime.notBefore - state.serverTime, 60000);
    assert.equal(
      (await api('/api/settings', { method: 'PUT', headers, body: JSON.stringify(CONFIG) })).status,
      200,
    );
    const control = async (action) =>
      (
        await api('/api/control', { method: 'POST', headers, body: JSON.stringify({ action }) })
      ).json();
    await control('resume');
    const scheduled = await control('query');
    assert.equal(scheduled.queryStatus, 'scheduled');
    assert.equal(scheduled.runtime.nextAt - scheduled.serverTime, CONFIG.normalMin);
    assert.equal((await (await api('/api/history')).json()).total, 0);
    await advance(CONFIG.normalMin);
    assert.equal((await control('query')).queryStatus, 'started');
    const history = await (await api('/api/history')).json();
    assert.equal(history.total, 1);
    assert.equal(history.items[0].outcome, 'complete');
    await control('pause');
    assert.equal(await discover(), 429);
  },
);

test(
  'a missing diagnostic screenshot and a non-object JSON body are rejected without stopping the service',
  { timeout: 15000 },
  async (t) => {
    const diagnostic = '00000000-0000-4000-8000-000000000001';
    const { api, child } = await startServer(
      t,
      `
    const { Store } = require('./core.cjs');
    const seeded = new Store(process.env.DATA_DIR);
    seeded.event('error', 'Seeded failure', '${diagnostic}');
    seeded.commit();
    seeded.close();
    require('./server.cjs');
  `,
    );
    const missing = await api(`/api/diagnostics/${diagnostic}`);
    assert.equal(missing.status, 404);
    await missing.json();
    const headers = { origin: 'http://127.0.0.1:8080', 'content-type': 'application/json' };
    const list = await api('/api/control', { method: 'POST', headers, body: '[]' });
    assert.equal(list.status, 400);
    assert.equal((await list.json()).error, 'JSON 对象格式错误。');
    const broken = await api('/api/control', { method: 'POST', headers, body: '{' });
    assert.equal(broken.status, 400);
    assert.equal((await broken.json()).error, 'JSON 格式错误。');
    assert.equal((await api('/api/status')).status, 200);
    assert.equal(child.exitCode, null);
  },
);

test('invalid environment credentials fail before startup without logging their values', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-invalid-env-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  for (const environment of [
    { BARK_KEY: 'private invalid key' },
    { GRAFANA_IRM_WEBHOOK: 'http://example.grafana.net/DO_NOT_LOG_PRIVATE_TOKEN' },
    {
      GRAFANA_IRM_WEBHOOK: 'https://example.grafana.net/DO_NOT_LOG_PRIVATE_TOKEN',
      GRAFANA_IRM_HOST: 'other.grafana.net',
    },
  ]) {
    const child = spawnSync(process.execPath, ['server.cjs'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        DATA_DIR: dir,
        PUBLIC_ORIGIN: 'http://127.0.0.1:8080',
        BARK_KEY: '',
        GRAFANA_IRM_WEBHOOK: '',
        GRAFANA_IRM_HOST: '',
        ...environment,
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.notEqual(child.status, 0);
    assert.ok(!child.stderr.includes('private invalid key'));
    assert.ok(!child.stderr.includes('DO_NOT_LOG_PRIVATE_TOKEN'));
    assert.equal(fs.existsSync(path.join(dir, 'monitor.sqlite')), false);
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { productFor, COLORS, CAPACITIES, CARRIERS } = require('../core.cjs');
const { PRODUCT, CONFIG: DEFAULTS, STORES } = require('./fixture.cjs');
const {
  AppleBrowser,
  waitForPickupResult,
  openPickupDialog,
  prepareProductPage,
  watchNetwork,
} = require('../browser.cjs');
const dockerOnly = process.platform !== 'linux' || !fs.existsSync('/.dockerenv');

test('network diagnostics capture relevant errors, strip credentials/query/fragment and detach listeners', () => {
  const page = new EventEmitter();
  const log = watchNetwork(page, () => '等待弹窗');
  const request = (url, resourceType = 'script') => ({
    url: () => url,
    resourceType: () => resourceType,
    method: () => 'GET',
    failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET secret_value' }),
  });
  page.emit(
    'requestfailed',
    request(
      'https://user:password@store.storeimages.cdn-apple.com/a.js?key=secret_value#secret_value',
    ),
  );
  page.emit('requestfailed', request('https://other.test/private?key=secret_value'));
  page.emit('requestfailed', request('https://www.apple.com/a.jpg', 'image'));
  assert.equal(log.errors.length, 1);
  assert.equal(log.errors[0].url, 'https://store.storeimages.cdn-apple.com/a.js');
  assert.equal(log.errors[0].error, 'net::ERR_CONNECTION_RESET');
  const req = request('https://www.apple.com/shop/fulfillment-messages?key=secret_value', 'fetch');
  page.emit('response', {
    status: () => 429,
    url: req.url,
    request: () => req,
    headers: () => ({ 'retry-after': '600', cookie: 'secret_value' }),
  });
  assert.equal(log.errors[1].status, 429);
  assert.ok(log.httpError.retryAt > Date.now() + 599000);
  for (let i = 0; i < 35; i++) {
    page.emit('requestfailed', request('https://www.apple.com/a.js'));
  }
  assert.equal(log.errors.length, 30);
  assert.equal(log.dropped, 7);
  assert.ok(!JSON.stringify(log).includes('secret_value'));
  assert.ok(!JSON.stringify(log).includes('password'));
  log.stop();
  assert.equal(page.listenerCount('requestfailed'), 0);
  assert.equal(page.listenerCount('response'), 0);
});

test(
  'pickup entry supports both layouts, excludes sticky/hidden duplicates and waits for initial results and ZIP prefill without depending on heading text',
  { skip: dockerOnly },
  async (t) => {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(2000);
    for (const [container, label, overlay] of [
      ['rf-pickup-quote-value', 'Check Availability', true],
      ['rf-pickup-quote-value', 'Apple Test Store', true],
      ['rf-pickup-quote-value', '查询取货', true],
      [
        'rf-pickup-quote-info',
        'Check another store<span class="visuallyhidden">iPhone Duo 256GB Star White</span>',
        false,
      ],
    ]) {
      await page.setContent(`<span class="rf-pickup-quote-sticky-value" style="position:fixed;top:-80px"><button class="rf-pickup-quote-overlay-trigger" data-ase-overlay="buac-overlay">Offscreen sticky duplicate</button></span>
      <span class="rf-pickup-quote-value"><button hidden class="rf-pickup-quote-overlay-trigger" data-ase-overlay="buac-overlay">Hidden duplicate</button></span>
      <script>setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<span class="${container}"><button class="rf-pickup-quote-overlay-trigger" ${overlay ? 'data-ase-overlay="buac-overlay"' : ''}>${label}</button></span>');document.querySelector('.${container} button:not([hidden])').onclick=()=>{document.body.insertAdjacentHTML('beforeend','<div role="dialog" aria-label="iPhone Availability"><input name="search"></div>');setTimeout(()=>{document.querySelector('[name=search]').value='10002';document.querySelector('[role=dialog]').insertAdjacentHTML('beforeend','<input hidden name="store-${PRODUCT.part}">')},250)}},250)</script>`);
      const steps = [];
      const dialog = await openPickupDialog(page, (s) => steps.push(s));
      assert.ok(await dialog.isVisible());
      assert.equal(await dialog.locator('input[name="search"]').inputValue(), '10002');
      assert.equal(steps.at(-1), '等待取货初始结果');
    }
    page.setDefaultTimeout(200);
    for (const [html, expected] of [
      ['', '定位并点击取货入口'],
      [
        '<span class="rf-pickup-quote-value"><button class="rf-pickup-quote-overlay-trigger" data-ase-overlay="buac-overlay">Apple Store</button></span>',
        '等待取货弹窗可见',
      ],
      [
        '<span class="rf-pickup-quote-value"><button class="rf-pickup-quote-overlay-trigger" data-ase-overlay="buac-overlay">Apple Store</button></span><div role="dialog" aria-label="iPhone Availability">Loading…</div>',
        '重新打开取货弹窗',
      ],
    ]) {
      await page.setContent(html);
      let step;
      await assert.rejects(
        openPickupDialog(page, (s) => (step = s), 200),
        { name: 'TimeoutError' },
      );
      assert.equal(step, expected);
    }
  },
);

test(
  'an empty pickup dialog is reopened once before the query fails',
  { skip: dockerOnly },
  async (t) => {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(1000);
    const entry =
      '<span class="rf-pickup-quote-value"><button class="rf-pickup-quote-overlay-trigger" data-ase-overlay="buac-overlay">Apple Store</button></span>';
    const script = (loadsOnOpen) => `<script>
      window.opens = 0;
      document.querySelector('button').onclick = () => {
        window.opens++;
        const results = window.opens === ${loadsOnOpen} ? '<input hidden name="store-${PRODUCT.part}">' : '';
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-label="iPhone Availability"><input name="search">' + results + '</div>');
      };
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          document.querySelector('[role=dialog]').remove();
        }
      });
      </script>`;

    await page.setContent(entry + script(2));
    const steps = [];
    const dialog = await openPickupDialog(page, (s) => steps.push(s), 200);
    assert.equal(await dialog.locator('input[name^="store-"]').count(), 1);
    assert.equal(steps.filter((s) => s === '重新打开取货弹窗').length, 1);
    assert.equal(steps.at(-1), '等待取货初始结果');

    await page.setContent(entry + script(3));
    let step;
    await assert.rejects(
      openPickupDialog(page, (s) => (step = s), 200),
      { name: 'TimeoutError' },
    );
    assert.equal(step, '等待取货初始结果');
    assert.equal(await page.evaluate(() => window.opens), 2);

    await page.setContent(entry + script(2));
    await assert.rejects(
      openPickupDialog(page, (s) => (step = s), 200, { httpError: { safeMessage: 'HTTP 429' } }),
      { name: 'TimeoutError' },
    );
    assert.equal(step, '等待取货初始结果');
    assert.equal(await page.evaluate(() => window.opens), 1);
  },
);

test(
  'product page recovers a redirect through enabled native choices, waits for the title and still rejects wrong specifications',
  { skip: dockerOnly },
  async (t) => {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(2000);
    const config = { ...DEFAULTS, color: 'nightsky', capacity: '512gb', carrier: 'unlocked' };
    const product = productFor(config);
    const choices = [
      ['dimensionColor', config.color],
      ['dimensionCapacity', config.capacity],
      ['tradeupinline', 'noTradeIn'],
      ['purchase_option_group', 'fullprice'],
      ['carrierModel', product.carrier],
    ];
    await page.route('https://www.apple.com/**', (route) => {
      if (new URL(route.request().url()).pathname === new URL(product.url).pathname) {
        return route.fulfill({
          contentType: 'text/html',
          body: '<title>Loading product…</title><script>setTimeout(()=>location.replace("/shop/buy-iphone/iphone-duo"),250)</script>',
        });
      }
      return route.fulfill({
        contentType: 'text/html',
        body: `<title>Shop iPhone Duo - Apple</title>
      ${choices.map(([name, value]) => `<fieldset disabled><input type="radio" name="${name}" value="${value}"><label>${name}</label></fieldset>`).join('')}
      <script>
        const inputs=[...document.querySelectorAll('input')]; window.changes=[];
        setTimeout(()=>inputs[0].closest('fieldset').disabled=false,250);
        inputs.forEach((input,i)=>input.onchange=()=>{window.changes.push(input.name);setTimeout(()=>{
          if(inputs[i+1]) inputs[i+1].closest('fieldset').disabled=false;
          else {document.title='Buy iPhone Duo 512GB Night Sky - Apple';history.replaceState({},'',${JSON.stringify(new URL(product.url).pathname)});}
        },100)});
      </script>`,
      });
    });
    await page.goto(product.url);
    assert.equal(page.url(), product.url);
    const steps = [];
    await prepareProductPage(page, config, (s) => steps.push(s));
    assert.equal(page.url(), product.url);
    assert.deepEqual(
      await page.evaluate(() => window.changes),
      choices.map(([name]) => name),
    );
    assert.equal(steps.filter((s) => s.startsWith('重新选择')).length, 5);
    await prepareProductPage(page, config, () => {});
    assert.equal((await page.evaluate(() => window.changes)).length, 5);
    for (const [name, wrong, expected] of [
      ['dimensionColor', 'starwhite', '核对商品颜色'],
      ['dimensionCapacity', '256gb', '核对商品容量'],
      ['carrierModel', 'VERIZON_IPHONEDUO', '核对商品运营商'],
    ]) {
      const input = page.locator(`input[name="${name}"]`);
      const original = await input.inputValue();
      await input.evaluate((e, value) => (e.value = value), wrong);
      let step;
      await assert.rejects(
        prepareProductPage(page, config, (s) => (step = s)),
        { code: 'ERR_ASSERTION' },
      );
      assert.equal(step, expected);
      await input.evaluate((e, value) => (e.value = value), original);
    }
    await page.evaluate(() => (document.title = 'Buy another iPhone - Apple'));
    page.setDefaultTimeout(200);
    let step;
    await assert.rejects(
      prepareProductPage(page, config, (s) => (step = s)),
      { name: 'TimeoutError' },
    );
    assert.equal(step, '等待商品页面就绪');
  },
);

test(
  'collector records network errors and exact HTTP failure stage without leaking URL query values',
  { skip: dockerOnly },
  async (t) => {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const context = await browser.newContext();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-diagnostics-'));
    t.after(() => fs.rmSync(dir, { recursive: true }));
    let inventoryStatus = 200;
    const raw = {
      body: {
        stores: DEFAULTS.stores.map((id) => ({
          storeNumber: id,
          storeName: STORES[id],
          partsAvailability: {
            [PRODUCT.part]: { partNumber: PRODUCT.part, pickupDisplay: 'unavailable' },
          },
        })),
      },
    };
    await context.route('https://www.apple.com/**', async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/broken.js') {
        return route.abort('connectionreset');
      }
      if (u.pathname === '/unavailable.js') {
        return route.fulfill({ status: 503, body: '', contentType: 'application/javascript' });
      }
      if (u.pathname === '/shop/fulfillment-messages') {
        return route.fulfill({
          status: inventoryStatus,
          json: raw,
          headers: { 'retry-after': '60' },
        });
      }
      if (u.pathname === '/') {
        return route.fulfill({ body: '<title>Apple</title>', contentType: 'text/html' });
      }
      return route.fulfill({
        contentType: 'text/html',
        body: `<title>Buy iPhone Duo 256GB Star White - T-Mobile - Apple</title>
      <script src="/broken.js?token=DO_NOT_LOG"></script><script src="/unavailable.js?token=DO_NOT_LOG"></script>
      <input name="dimensionColor" type="radio" checked value="starwhite"><input name="dimensionCapacity" type="radio" checked value="256gb"><input name="carrierModel" type="radio" checked value="${PRODUCT.carrier}">
      <span class="rf-pickup-quote-value"><button class="rf-pickup-quote-overlay-trigger" data-ase-overlay="buac-overlay" onclick="document.querySelector('[role=dialog]').hidden=false">Apple Test Store</button></span>
      <div role="dialog" aria-label="iPhone Availability" hidden><h2>Pick it up at an Apple Store near: 10001</h2><input name="search"><input hidden name="store-${PRODUCT.part}"></div>
      <script>document.querySelector('[name=search]').onkeydown=async e=>{if(e.key==='Enter'){const r=await fetch('/shop/fulfillment-messages?location='+e.target.value+'&parts.0=${PRODUCT.part}&cppart=${PRODUCT.carrier}');await r.json();document.querySelector('[role=dialog]').insertAdjacentHTML('beforeend','<input hidden name="store-${PRODUCT.part}">')}}</script>`,
      });
    });
    const collector = new AppleBrowser(dir);
    collector.browser = browser;
    const result = await collector.collect(DEFAULTS, require('node:crypto').randomUUID());
    assert.equal(result.stores.length, DEFAULTS.stores.length);
    assert.equal(result.diagnostics.failedStep, null);
    assert.ok(result.diagnostics.network.some((n) => n.error === 'net::ERR_CONNECTION_RESET'));
    assert.ok(result.diagnostics.network.some((n) => n.status === 503));
    assert.ok(!JSON.stringify(result.diagnostics).includes('DO_NOT_LOG'));
    assert.equal(context.pages().length, 0);
    const discovered = await collector.collect(DEFAULTS, require('node:crypto').randomUUID(), true);
    assert.deepEqual(discovered.catalog, STORES);
    assert.equal(discovered.product.part, PRODUCT.part);
    assert.equal(context.pages().length, 0);
    inventoryStatus = 503;
    await assert.rejects(collector.collect(DEFAULTS, require('node:crypto').randomUUID()), (e) => {
      assert.equal(e.diagnostics.failedStep, '校验库存 HTTP 状态');
      assert.match(e.safeMessage, /校验库存 HTTP 状态失败.*HTTP 503/);
      assert.ok(e.retryAt > Date.now());
      assert.equal(e.diagnostics.page.visibleDialogs, 1);
      assert.ok(!JSON.stringify(e.diagnostics).includes('DO_NOT_LOG'));
      return true;
    });
  },
);

test(
  'pickup waits beyond the old 20-second limit and validates expanded picker product, ZIP and available stores',
  { skip: process.platform !== 'linux' || !fs.existsSync('/.dockerenv') },
  async (t) => {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    await page.setContent(
      '<div role="dialog" aria-label="iPhone Availability"><h2>Pick it up at an Apple Store near: 10001</h2><span>Loading…</span></div>',
    );
    const dialog = page.getByRole('dialog', { name: 'iPhone Availability' });
    await page.evaluate(
      (part) =>
        setTimeout(() => {
          document
            .querySelector('[role="dialog"]')
            .insertAdjacentHTML(
              'beforeend',
              `<input type="radio" name="store-${part}" hidden><p>Apple Apple Test One</p>`,
            );
        }, 21000),
      PRODUCT.part,
    );
    const started = Date.now();
    await waitForPickupResult(
      dialog,
      '10001',
      [{ status: 'available', name: 'Apple Test One' }],
      PRODUCT.part,
    );
    assert.ok(Date.now() - started >= 20000);
    page.setDefaultTimeout(200);
    await assert.rejects(waitForPickupResult(dialog, '10002', [], PRODUCT.part), {
      name: 'TimeoutError',
    });
    await assert.rejects(
      waitForPickupResult(
        dialog,
        '10001',
        [{ status: 'available', name: 'Apple Test Other' }],
        PRODUCT.part,
      ),
      { name: 'TimeoutError' },
    );
    await page.locator('input').evaluate((e) => (e.name = 'store-WRONG-PART'));
    await assert.rejects(waitForPickupResult(dialog, '10001', [], PRODUCT.part), {
      name: 'TimeoutError',
    });
  },
);

test(
  'phone cleanup button works while paused, warns before clearing and cannot bypass a finite cooldown',
  { skip: dockerOnly },
  async (t) => {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ locale: 'zh-CN' });
    page.setDefaultTimeout(3000);
    await page.addInitScript(() => {
      window.EventSource = class {};
    });
    const config = {
      ...DEFAULTS,
      irmEnabled: true,
      barkConfigured: true,
      irmConfigured: true,
      options: { colors: COLORS, capacities: CAPACITIES, carriers: CARRIERS },
    };
    const runtime = {
      paused: true,
      phase: 'paused',
      stores: [],
      bark: { configured: true, state: 'cooldown', notBefore: Date.now() + 900000 },
      irm: {
        configured: true,
        state: 'accepted',
        pendingGroups: 1,
        notBefore: 0,
        legacyPaused: false,
      },
    };
    const actions = [];
    const submissions = [];
    await page.route('http://monitor.test/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/status') {
        return route.fulfill({
          json: {
            serverTime: Date.now(),
            config,
            product: productFor(config),
            retention: { historyDays: 60, eventDays: 30 },
            runtime,
            events: [],
          },
        });
      }
      if (pathname === '/api/history') {
        return route.fulfill({
          json: {
            retentionDays: 60,
            historyStartedAt: Date.now(),
            total: 0,
            summary: { total: 0, availableRounds: 0, unknownRounds: 0, byStore: [] },
            items: [],
            nextCursor: null,
          },
        });
      }
      if (pathname === '/api/settings') {
        submissions.push(route.request().postDataJSON());
        config.version++;
        return route.fulfill({ json: config });
      }
      if (pathname === '/api/control') {
        actions.push(route.request().postDataJSON().action);
        return route.fulfill({ json: { ok: true, runtime } });
      }
      if (!['/', '/i18n.js', '/app.js', '/style.css'].includes(pathname)) {
        return route.fulfill({ status: 404, body: '' });
      }
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      return route.fulfill({
        path: path.join(__dirname, '../public', file),
        contentType: file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      });
    });
    await page.goto('http://monitor.test/');
    await page.waitForFunction(() => document.querySelector('#toggle').textContent === '恢复监控');
    assert.equal(await page.locator('#bark-state').textContent(), '冷却中');
    assert.match(await page.locator('#bark-at').textContent(), /冷却至/);
    assert.equal(await page.locator('input[name="barkKey"], input[name="irmWebhook"]').count(), 0);
    assert.match(await page.locator('#bark-help').textContent(), /从 .env 配置/);
    await page.locator('#settings button[type=submit]').click();
    await page.waitForFunction(() =>
      document.querySelector('#save-message').textContent.includes('已保存'),
    );
    assert.equal(submissions.length, 1);
    for (const field of ['barkKey', 'irmWebhook', 'clear_barkKey', 'clear_irmWebhook']) {
      assert.equal(Object.hasOwn(submissions[0], field), false);
    }
    assert.equal(await page.locator('#cleanup-irm').isEnabled(), true);
    page.once('dialog', async (dialog) => {
      assert.match(dialog.message(), /电话已发出/);
      await dialog.dismiss();
    });
    await page.locator('#cleanup-irm').click();
    assert.deepEqual(actions, []);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#cleanup-irm').click();
    await page.waitForFunction(() =>
      document.querySelector('#operation-message').textContent.includes('已保存'),
    );
    assert.deepEqual(actions, ['cleanup-irm']);
    assert.equal(await page.locator('#toggle').textContent(), '恢复监控');
    await page.clock.install();
    await page.evaluate(() => toast('操作已保存。'));
    await page.clock.runFor(2000);
    assert.equal(await page.locator('#operation-message').isVisible(), true);
    await page.evaluate(() => toast('操作已保存。'));
    await page.clock.runFor(2000);
    assert.equal(await page.locator('#operation-message').isVisible(), true);
    await page.clock.runFor(1000);
    assert.equal(await page.locator('#operation-message').isVisible(), false);
    runtime.irm.notBefore = Date.now() + 900000;
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#toggle').textContent === '恢复监控');
    assert.equal(await page.locator('#cleanup-irm').isEnabled(), false);
    runtime.irm.notBefore = Number.MAX_SAFE_INTEGER;
    runtime.irm.legacyPaused = true;
    runtime.irm.pendingGroups = 0;
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('#irm-at').textContent.includes('旧版遗留暂停'),
    );
    page.once('dialog', async (dialog) => {
      assert.match(dialog.message(), /确认 Grafana 的限流已解除/);
      await dialog.accept();
    });
    await page.locator('#cleanup-irm').click();
    await page.waitForFunction(() =>
      document.querySelector('#operation-message').textContent.includes('已保存'),
    );
    assert.deepEqual(actions, ['cleanup-irm', 'recover-irm']);
    runtime.paused = false;
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#toggle').textContent === '暂停监控');
    assert.equal(await page.locator('#cleanup-irm').isEnabled(), false);
  },
);

test(
  'request query button explains scheduled, started and busy results, and shows the current round',
  { skip: dockerOnly },
  async (t) => {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ locale: 'zh-CN' });
    page.setDefaultTimeout(3000);
    await page.addInitScript(() => {
      window.EventSource = class {
        constructor() {
          window.testStream = this;
        }
      };
    });
    const config = {
      ...DEFAULTS,
      options: { colors: COLORS, capacities: CAPACITIES, carriers: CARRIERS },
    };
    const runtime = {
      paused: false,
      phase: 'waiting',
      nextAt: Date.now() + 60001,
      stores: [],
      bark: {},
      irm: {},
    };
    const snapshot = () => ({
      serverTime: Date.now(),
      config,
      product: productFor(config),
      retention: { historyDays: 60, eventDays: 30 },
      runtime,
      events: [],
    });
    let queryStatus = 'scheduled';
    const actions = [];
    await page.route('http://monitor.test/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/status') {
        return route.fulfill({ json: snapshot() });
      }
      if (pathname === '/api/history') {
        return route.fulfill({
          json: {
            total: 0,
            summary: { total: 0, availableRounds: 0, unknownRounds: 0, byStore: [] },
            items: [],
          },
        });
      }
      if (pathname === '/api/control') {
        actions.push(route.request().postDataJSON().action);
        return route.fulfill({ json: { ok: true, queryStatus, serverTime: Date.now(), runtime } });
      }
      if (!['/', '/i18n.js', '/app.js', '/style.css'].includes(pathname)) {
        return route.fulfill({ status: 404, body: '' });
      }
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      return route.fulfill({
        path: path.join(__dirname, '../public', file),
        contentType: file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      });
    });
    await page.goto('http://monitor.test/');
    await page.locator('#query').click();
    await page.waitForFunction(() =>
      document.querySelector('#operation-message').textContent.includes('已安排查询'),
    );
    assert.match(
      await page.locator('#operation-message').textContent(),
      /^已安排查询，约 \d+ 秒后（.+）。$/,
    );
    queryStatus = 'started';
    await page.locator('#query').click();
    await page.waitForFunction(() =>
      document.querySelector('#operation-message').textContent.includes('已开始查询'),
    );
    runtime.phase = 'checking';
    runtime.nextAt = null;
    runtime.configVersion = config.version;
    await page.evaluate(
      (data) => window.testStream.onmessage({ data: JSON.stringify(data) }),
      snapshot(),
    );
    assert.equal(await page.locator('#countdown').textContent(), '查询中');
    assert.equal(
      await page.locator('#inventory-note').textContent(),
      `本轮配置：第 ${config.version} 版`,
    );
    queryStatus = 'busy';
    await page.locator('#query').click();
    await page.waitForFunction(() =>
      document
        .querySelector('#operation-message')
        .textContent.includes('正在查询中，请等待本轮结果'),
    );
    runtime.paused = true;
    runtime.phase = 'paused';
    await page.evaluate(
      (data) => window.testStream.onmessage({ data: JSON.stringify(data) }),
      snapshot(),
    );
    assert.equal(await page.locator('#query').isEnabled(), false);
    assert.deepEqual(actions, ['query', 'query', 'query']);
  },
);

test(
  'dashboard switches languages, translates history and errors, and retains drafts without writing settings',
  { skip: dockerOnly },
  async (t) => {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ locale: 'en-US' });
    page.setDefaultTimeout(3000);
    await page.addInitScript(() => {
      window.EventSource = class {};
    });
    const now = Date.now();
    const config = {
      ...DEFAULTS,
      version: 7,
      confirmed: true,
      irmEnabled: true,
      barkConfigured: true,
      irmConfigured: true,
      options: { colors: COLORS, capacities: CAPACITIES, carriers: CARRIERS },
    };
    const error = '打开商品页失败（超时）：商品页 HTTP 429；诊断截图未能保存';
    const stores = config.stores.map((id) => ({
      id,
      name: STORES[id],
      status: 'UNKNOWN',
      checkedAt: now,
      description: error,
    }));
    const runtime = {
      paused: true,
      phase: 'paused',
      lastAttempt: now,
      lastComplete: null,
      stores,
      bark: { configured: true, state: 'cooldown', attemptedAt: now - 2000, notBefore: now - 1000 },
      irm: { configured: true, state: 'idle', pendingGroups: 0 },
    };
    const history = {
      retentionDays: 60,
      historyStartedAt: now - 86400000,
      total: 1,
      summary: { total: 1, availableRounds: 0, unknownRounds: 1, byStore: [] },
      nextCursor: null,
      items: [
        {
          id: 'test-round',
          startedAt: now - 5000,
          finishedAt: now,
          config: { ...config, product: productFor(config) },
          stores,
          outcome: 'failed',
          error,
          superseded: true,
          source: 'snapshot',
          diagnostics: {
            failedStep: '打开商品页',
            errorType: 'TimeoutError',
            droppedNetworkErrors: 3,
            steps: [{ step: '打开商品页', at: now - 5000, durationMs: 5000 }],
            network: [
              {
                at: now,
                step: '打开商品页',
                resourceType: 'document',
                method: 'GET',
                url: 'https://www.apple.com/shop',
                kind: 'http',
                status: 429,
              },
            ],
            page: { readyState: 'complete', visibleDialogs: 1, pickupButtons: [{ visible: true }] },
          },
        },
      ],
    };
    const writes = [];
    await page.route('http://monitor.test/**', (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET') {
        writes.push({ path: pathname, body: request.postDataJSON() });
      }
      if (pathname === '/api/status') {
        return route.fulfill({
          json: {
            serverTime: Date.now(),
            config,
            product: productFor(config),
            retention: { historyDays: 60, eventDays: 30 },
            runtime,
            events: [{ at: now, message: '设置已保存，第 7 版。' }],
          },
        });
      }
      if (pathname === '/api/history') {
        return route.fulfill({ json: history });
      }
      if (pathname === '/api/settings') {
        return route.fulfill({
          status: 409,
          json: { error: '设置已被其他页面修改，请重新载入后保存。' },
        });
      }
      if (!['/', '/i18n.js', '/app.js', '/style.css'].includes(pathname)) {
        return route.fulfill({ status: 404, body: '' });
      }
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      return route.fulfill({
        path: path.join(__dirname, '../public', file),
        contentType: file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      });
    });
    await page.goto('http://monitor.test/');
    await page.waitForFunction(() =>
      document.querySelector('#history-list').textContent.includes('Execution steps'),
    );
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.title(), 'iPhone Duo · Pickup monitor');
    assert.equal(await page.locator('#language').getAttribute('aria-label'), 'Language');
    assert.equal(await page.locator('#toggle').textContent(), 'Resume monitoring');
    assert.equal(await page.locator('#bark-state').textContent(), 'Failed');
    assert.match(await page.locator('#bark-at').textContent(), /Last attempt/);
    assert.match(await page.locator('#events').textContent(), /Settings saved, version 7/);
    const untranslated = await page.evaluate(() => {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const remaining = [];
      while (walk.nextNode()) {
        if (
          !walk.currentNode.parentElement.closest('#language') &&
          /\p{Script=Han}/u.test(walk.currentNode.nodeValue)
        ) {
          remaining.push(walk.currentNode.nodeValue);
        }
      }
      return remaining;
    });
    assert.deepEqual(untranslated, []);
    await page.locator('input[name=barkGroup]').fill('unsaved-draft');
    await page.locator('input[name=stores]').first().uncheck();
    await page.locator('#history-days').selectOption('7');
    await page.locator('.query-row>summary').click();
    const draft = await page.evaluate(() => [...new FormData(document.querySelector('#settings'))]);
    await page.locator('#language').selectOption('zh-CN');
    await page.waitForFunction(() =>
      document.querySelector('#history-list').textContent.includes('执行步骤与网络异常'),
    );
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
    assert.equal(await page.locator('#toggle').textContent(), '恢复监控');
    assert.equal(await page.locator('#save-message').textContent(), '有尚未保存的修改。');
    assert.equal(await page.locator('#history-days').inputValue(), '7');
    assert.equal(await page.locator('.query-row').getAttribute('open'), '');
    assert.deepEqual(
      await page.evaluate(() => [...new FormData(document.querySelector('#settings'))]),
      draft,
    );
    assert.deepEqual(writes, []);
    await page.locator('#language').selectOption('en');
    await page.locator('#settings button[type=submit]').click();
    await page.waitForFunction(() =>
      document
        .querySelector('#save-message')
        .textContent.includes('Settings changed in another page'),
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.barkGroup, 'unsaved-draft');
    page.once('dialog', async (dialog) => {
      assert.match(dialog.message(), /real test phone call/);
      await dialog.dismiss();
    });
    await page.locator('#test-irm').click();
    assert.equal(writes.length, 1);
    await page.locator('#language').selectOption('zh-CN');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#toggle').textContent === '恢复监控');
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
    await page.clock.install();
    const receivedAt = await page.evaluate(() => received);
    await page.clock.runFor(45001);
    await page.locator('#language').selectOption('en');
    assert.equal(await page.locator('#phase').textContent(), 'Status unverified');
    assert.equal(await page.evaluate(() => received), receivedAt);
  },
);

test(
  'dashboard reconnects after its first status request and event stream fail without a page reload',
  { skip: dockerOnly },
  async (t) => {
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ locale: 'en-US' });
    page.setDefaultTimeout(5000);
    await page.clock.install();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const config = {
      ...DEFAULTS,
      version: 3,
      confirmed: true,
      barkConfigured: false,
      irmConfigured: false,
      options: { colors: COLORS, capacities: CAPACITIES, carriers: CARRIERS },
    };
    const snapshot = {
      serverTime: Date.now(),
      config,
      product: productFor(config),
      retention: { historyDays: 60, eventDays: 30 },
      runtime: {
        paused: true,
        phase: 'paused',
        stores: [],
        bark: { configured: false, state: 'disabled' },
        irm: { configured: false, state: 'disabled', pendingGroups: 0 },
      },
      events: [],
    };
    let statusRequests = 0;
    let streams = 0;
    const writes = [];
    await page.route('http://monitor.test/**', (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET') {
        writes.push(pathname);
      }
      if (pathname === '/api/status') {
        statusRequests++;
        return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
      }
      if (pathname === '/api/events') {
        streams++;
        return route.fulfill({
          contentType: 'text/event-stream',
          body:
            streams === 1 ? 'retry: 20\n\n' : `retry: 60000\ndata: ${JSON.stringify(snapshot)}\n\n`,
        });
      }
      if (pathname === '/api/history') {
        return route.fulfill({
          json: {
            retentionDays: 60,
            historyStartedAt: Date.now(),
            total: 0,
            summary: { total: 0, availableRounds: 0, unknownRounds: 0, byStore: [] },
            items: [],
          },
        });
      }
      if (!['/', '/i18n.js', '/app.js', '/style.css'].includes(pathname)) {
        return route.fulfill({ status: 404, body: '' });
      }
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      return route.fulfill({
        path: path.join(__dirname, '../public', file),
        contentType: file.endsWith('.js')
          ? 'text/javascript'
          : file.endsWith('.css')
            ? 'text/css'
            : 'text/html',
      });
    });
    await page.goto('http://monitor.test/');
    await page.waitForFunction(() => !document.querySelector('#toggle').disabled);
    assert.equal(await page.locator('#toggle').textContent(), 'Resume monitoring');
    assert.equal(await page.locator('#version').textContent(), 'Version 3');
    assert.equal(statusRequests, 1);
    assert.equal(streams, 2);
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    const receivedAt = await page.evaluate(() => received);
    assert.ok(receivedAt > 0);
    await page.clock.runFor(46000);
    assert.equal(await page.locator('#phase').textContent(), 'Status unverified');
  },
);

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { productFor, COLORS, inventoryStores, parseInventory, retryAfter } = require('./core.cjs');

function networkURL(raw) {
  const u = new URL(raw);
  return /^https?:$/.test(u.protocol) &&
    ['apple.com', 'cdn-apple.com'].some(
      (host) => u.hostname === host || u.hostname.endsWith(`.${host}`),
    )
    ? u.origin + u.pathname
    : null;
}

function watchNetwork(page, currentStep) {
  const log = { errors: [], dropped: 0, httpError: null };
  const record = (request, fields) => {
    const url = networkURL(request.url());
    if (
      !url ||
      !['document', 'script', 'stylesheet', 'xhr', 'fetch'].includes(request.resourceType())
    ) {
      return;
    }
    log.errors.push({
      at: Date.now(),
      step: currentStep(),
      url,
      method: request.method(),
      resourceType: request.resourceType(),
      ...fields,
    });
    if (log.errors.length > 30) {
      log.errors.shift();
      log.dropped++;
    }
  };
  const failed = (request) =>
    record(request, {
      kind: 'requestfailed',
      error: /net::[A-Z0-9_]+/.exec(request.failure()?.errorText || '')?.[0] || 'REQUEST_FAILED',
    });
  const response = (res) => {
    if (res.status() < 400) {
      return;
    }
    record(res.request(), { kind: 'http', status: res.status() });
    const u = new URL(res.url());
    if (
      u.hostname === 'www.apple.com' &&
      ['/shop/fulfillment-messages', '/shop/retail/pickup-message'].includes(u.pathname)
    ) {
      log.httpError = {
        safeMessage: `HTTP ${res.status()}，尚无有效库存结果`,
        retryAt: retryAfter(res.headers()['retry-after']),
      };
    }
  };
  page.on('requestfailed', failed);
  page.on('response', response);
  log.stop = () => {
    page.off('requestfailed', failed);
    page.off('response', response);
  };
  return log;
}

async function openPickupDialog(page, progress) {
  progress('定位并点击取货入口');
  // The sticky header has an offscreen duplicate that still matches Playwright's :visible.
  await page
    .locator(
      ':is(.rf-pickup-quote-value, .rf-pickup-quote-info) button.rf-pickup-quote-overlay-trigger:visible',
    )
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'iPhone Availability' });
  progress('等待取货弹窗可见');
  await dialog.waitFor({ state: 'visible' });
  progress('等待取货初始结果');
  // Initial results also finish Apple's ZIP prefill; typing earlier can concatenate two ZIPs.
  await dialog.locator('input[name^="store-"]').first().waitFor({ state: 'attached' });
  await dialog.locator('input[name="search"]').waitFor({ state: 'visible' });
  return dialog;
}

async function prepareProductPage(page, config, progress = () => {}) {
  const product = productFor(config);
  const titleMatches = ({ color, capacity }) =>
    document.title.includes('iPhone Duo') &&
    document.title.includes(color) &&
    document.title.includes(capacity);
  const title = { color: COLORS[config.color].name, capacity: config.capacity.toUpperCase() };
  progress('等待商品页面就绪');
  await page.waitForFunction(
    ({ color, capacity }) =>
      (document.title.includes('iPhone Duo') &&
        document.title.includes(color) &&
        document.title.includes(capacity)) ||
      location.pathname.replace(/\/$/, '') === '/shop/buy-iphone/iphone-duo',
    title,
  );
  const url = new URL(page.url());
  assert.equal(url.origin, new URL(product.url).origin);
  if (url.pathname.replace(/\/$/, '') === '/shop/buy-iphone/iphone-duo') {
    for (const [name, value] of [
      ['dimensionColor', config.color],
      ['dimensionCapacity', config.capacity],
      ['tradeupinline', 'noTradeIn'],
      ['purchase_option_group', 'fullprice'],
      ['carrierModel', product.carrier],
    ]) {
      progress(`重新选择商品选项：${name}`);
      await page.waitForFunction(
        ([name, value]) =>
          document.querySelector(`input[name="${name}"][value="${value}"]`)?.matches(':enabled') ===
          true,
        [name, value],
      );
      const input = page.locator(`input[name="${name}"][value="${value}"]`);
      // Native keyboard selection avoids Apple's overlapping swatch labels and sticky bar.
      if (!(await input.isChecked())) {
        await input.press('Space');
      }
      assert.equal(await input.isChecked(), true);
    }
  }
  progress('核对商品标题');
  await page.waitForFunction(titleMatches, title);
  for (const [name, value, label] of [
    ['dimensionColor', config.color, '颜色'],
    ['dimensionCapacity', config.capacity, '容量'],
    ['carrierModel', product.carrier, '运营商'],
  ]) {
    progress(`核对商品${label}`);
    assert.equal(await page.locator(`input[name="${name}"]:checked`).inputValue(), value);
  }
}

async function waitForPickupResult(dialog, zip, stores, part, progress = () => {}) {
  progress('等待页面邮编结果');
  await dialog
    .getByRole('heading', { name: new RegExp(`Pick it up at an Apple Store near:.*${zip}`) })
    .waitFor();
  // The expanded picker identifies the product in store inputs rather than a summary sentence.
  progress('等待页面目标商品');
  await dialog.locator(`input[name="store-${part}"]`).first().waitFor({ state: 'attached' });
  for (const store of stores.filter((s) => s.status === 'available')) {
    progress(`等待页面有货门店：${store.name}`);
    await dialog.getByText(store.name, { exact: false }).first().waitFor();
  }
}

class AppleBrowser {
  constructor(dir) {
    this.dir = dir;
    this.browser = null;
    this.process = null;
  }

  async open() {
    if (this.browser?.isConnected()) {
      return;
    }
    assert.equal(process.platform, 'linux', '库存采集必须在 Docker 内执行。');
    await fs.access('/.dockerenv');
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) {
      throw new Error('旧 Chromium 仍在运行；需要人工检查，不能删除 profile 锁。');
    }
    const profile = path.join(this.dir, 'profile');
    await fs.mkdir(profile, { recursive: true, mode: 0o700 });
    this.process = spawn(
      chromium.executablePath(),
      [
        `--user-data-dir=${profile}`,
        '--remote-debugging-port=9222',
        '--remote-debugging-address=127.0.0.1',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1440,1100',
        '--lang=en-US',
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const child = this.process;
    try {
      const endpoint = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Chromium 启动超时。')), 15000);
        let log = '';
        child.once('error', () => {
          clearTimeout(timer);
          reject(new Error('Chromium 启动失败。'));
        });
        child.once('exit', () => {
          clearTimeout(timer);
          reject(new Error('Chromium 已退出，请检查 profile 占用或沙箱。'));
        });
        child.stderr.on('data', (data) => {
          log = (log + data).slice(-8192);
          const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
          if (match) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
      });
      this.browser = await chromium.connectOverCDP(endpoint);
    } catch (e) {
      child.kill('SIGTERM');
      throw e;
    }
  }

  async collect(config, round, discover = false) {
    const product = productFor(config);
    let page;
    let network;
    let step;
    const startedAt = Date.now();
    const steps = [];
    const progress = (name) => {
      step = name;
      steps.push({ step: name, at: Date.now() });
    };
    const diagnostics = (error) => {
      const now = Date.now();
      return {
        failedStep: error ? step : null,
        errorType: error?.name || null,
        elapsedMs: now - startedAt,
        steps: steps.map((s, i) => ({ ...s, durationMs: (steps[i + 1]?.at || now) - s.at })),
        network: [...(network?.errors || [])],
        droppedNetworkErrors: network?.dropped || 0,
      };
    };
    progress('启动浏览器');
    try {
      await this.open();
      progress('创建查询页面');
      const context = this.browser.contexts()[0];
      page = await context.newPage();
      for (const other of context.pages()) {
        if (other !== page) {
          await other.close();
        }
      }
      page.setDefaultTimeout(90000);
      network = watchNetwork(page, () => step);
      progress('打开 Apple 首页');
      await page.goto('https://www.apple.com/', { waitUntil: 'load', timeout: 45000 });
      progress('打开商品页');
      const navigation = await page.goto(product.url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      if (navigation && navigation.status() >= 400) {
        throw Object.assign(new Error(), {
          safeMessage: `商品页 HTTP ${navigation.status()}`,
          retryAt: retryAfter(navigation.headers()['retry-after']),
        });
      }
      await prepareProductPage(page, config, progress);
      const dialog = await openPickupDialog(page, progress);
      const part = (
        await dialog.locator('input[name^="store-"]').first().getAttribute('name')
      ).slice(6);
      assert.match(part, /^[A-Z0-9]+(?:\/A)?$/);
      progress('聚焦邮编输入框');
      const search = dialog.locator('input[name="search"]');
      await search.click();
      await search.press('ControlOrMeta+A');
      // A new page and a listener armed before Enter prevent reusing an earlier round's result.
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => {
            const u = new URL(res.url());
            return (
              u.hostname === 'www.apple.com' &&
              ['/shop/fulfillment-messages', '/shop/retail/pickup-message'].includes(u.pathname) &&
              u.searchParams.get('location') === config.zip &&
              u.searchParams.get('parts.0') === part
            );
          },
          { timeout: 90000 },
        ),
        (async () => {
          progress('输入并核对本轮邮编');
          await search.pressSequentially(config.zip, { delay: 75 });
          assert.equal(await search.inputValue(), config.zip);
          progress('提交本轮邮编');
          await search.press('Enter');
          progress('等待本轮库存响应');
        })(),
      ]);
      progress('校验库存 HTTP 状态');
      if (response.status() !== 200) {
        throw Object.assign(new Error(), {
          safeMessage: `HTTP ${response.status()}，尚无有效库存结果`,
          retryAt: retryAfter(response.headers()['retry-after']),
        });
      }
      progress('校验库存运营商');
      assert.equal(new URL(response.url()).searchParams.get('cppart'), product.carrier);
      progress('解析库存 JSON');
      const data = await response.json();
      const checkedAt = Date.now();
      progress('解析目标门店库存');
      const catalog = Object.fromEntries(
        inventoryStores(data).map((s) => [s.storeNumber, s.storeName]),
      );
      if (
        !Object.keys(catalog).length ||
        Object.keys(catalog).length > 50 ||
        Object.entries(catalog).some(
          ([id, name]) =>
            !/^R\d{3,6}$/.test(id) || typeof name !== 'string' || !name.trim() || name.length > 150,
        )
      ) {
        throw new Error('Apple 门店目录无效。');
      }
      const stores = parseInventory(
        data,
        discover ? Object.keys(catalog) : config.stores,
        checkedAt,
        part,
        discover ? catalog : config.catalog,
      );
      await waitForPickupResult(dialog, config.zip, stores, part, progress);
      if (discover) {
        return { catalog, product: { ...product, part } };
      }
      return {
        stores,
        diagnostics: diagnostics(),
        verification: {
          source: 'Docker Chromium page',
          browserVersion: this.browser.version(),
          uid: process.getuid(),
          request: { url: response.url(), status: response.status() },
          part,
          pageProductMatches: true,
          pageZipMatches: true,
        },
      };
    } catch (e) {
      const detail = e.safeMessage || network?.httpError?.safeMessage;
      e.safeMessage = `${step}失败（${e.name === 'TimeoutError' ? '超时' : '页面或数据不符合预期'}）${detail ? `：${detail}` : ''}`;
      e.retryAt = Math.max(e.retryAt || 0, network?.httpError?.retryAt || 0);
      e.diagnostics = diagnostics(e);
      if (!discover && page && !page.isClosed()) {
        let timer;
        try {
          const state = await Promise.race([
            page.evaluate(() => ({
              readyState: document.readyState,
              pickupButtons: [
                ...document.querySelectorAll('button.rf-pickup-quote-overlay-trigger'),
              ]
                .slice(0, 5)
                .map((e) => {
                  const r = e.getBoundingClientRect();
                  return {
                    text: e.textContent.trim().slice(0, 100),
                    overlay: e.getAttribute('data-ase-overlay'),
                    container: e.parentElement.className,
                    visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length),
                    inViewport:
                      r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
                    bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
                    disabled: e.disabled,
                  };
                }),
              visibleDialogs: [...document.querySelectorAll('[role="dialog"]')].filter(
                (e) => e.offsetWidth || e.offsetHeight || e.getClientRects().length,
              ).length,
            })),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('Diagnostic timeout')), 2000);
            }),
          ]);
          e.diagnostics.page = { url: networkURL(page.url()), ...state };
        } catch {
          e.diagnostics.pageStateUnavailable = true;
        } finally {
          clearTimeout(timer);
        }
        try {
          const dir = path.join(this.dir, 'diagnostics');
          await fs.mkdir(dir, { recursive: true, mode: 0o700 });
          await page.screenshot({ path: path.join(dir, `${round}.png`), timeout: 5000 });
          e.diagnostic = round;
        } catch {
          e.safeMessage += '；诊断截图未能保存';
        }
      }
      console.error(
        'Apple query failed:',
        JSON.stringify({ round, message: e.safeMessage, ...e.diagnostics }),
      );
      throw e;
    } finally {
      network?.stop();
      if (page && !page.isClosed()) {
        await page.close();
      }
    }
  }

  async close() {
    if (this.browser?.isConnected()) {
      const session = await this.browser.newBrowserCDPSession();
      await session.send('Browser.close');
    }
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.process.kill('SIGTERM');
          reject(new Error('Chromium 未正常退出。'));
        }, 5000);
        this.process.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = {
  AppleBrowser,
  waitForPickupResult,
  openPickupDialog,
  prepareProductPage,
  watchNetwork,
};

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { productFor, inventoryStores, parseInventory, retryAfter } = require('./core.cjs');

async function waitForPickupResult(dialog, zip, stores, part) {
  await dialog.getByRole('heading', { name: new RegExp(`Pick it up at an Apple Store near:.*${zip}`) }).waitFor();
  // The expanded picker identifies the product in store inputs rather than a summary sentence.
  await dialog.locator(`input[name="store-${part}"]`).first().waitFor({ state: 'attached' });
  for (const store of stores.filter(s => s.status === 'available')) await dialog.getByText(store.name, { exact: false }).first().waitFor();
}

class AppleBrowser {
  constructor(dir) { this.dir = dir; this.browser = null; this.process = null; }
  async open() {
    if (this.browser?.isConnected()) return;
    assert.equal(process.platform, 'linux', '库存采集必须在 Docker 内执行。');
    await fs.access('/.dockerenv');
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) throw new Error('旧 Chromium 仍在运行；需要人工检查，不能删除 profile 锁。');
    const profile = path.join(this.dir, 'profile');
    await fs.mkdir(profile, { recursive: true, mode: 0o700 });
    this.process = spawn(chromium.executablePath(), [
      `--user-data-dir=${profile}`, '--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1',
      '--no-first-run', '--no-default-browser-check', '--window-size=1440,1100', '--lang=en-US', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const child = this.process;
    try {
      const endpoint = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Chromium 启动超时。')), 15000);
        let log = '';
        child.once('error', () => { clearTimeout(timer); reject(new Error('Chromium 启动失败。')); });
        child.once('exit', () => { clearTimeout(timer); reject(new Error('Chromium 已退出，请检查 profile 占用或沙箱。')); });
        child.stderr.on('data', data => {
          log = (log + data).slice(-8192);
          const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
          if (match) { clearTimeout(timer); resolve(match[1]); }
        });
      });
      this.browser = await chromium.connectOverCDP(endpoint);
    } catch (e) { child.kill('SIGTERM'); throw e; }
  }
  async collect(config, round, discover = false) {
    const product = productFor(config);
    let page, httpError, step = '启动浏览器';
    try {
      await this.open();
      const context = this.browser.contexts()[0];
      page = await context.newPage();
      for (const other of context.pages()) if (other !== page) await other.close();
      page.setDefaultTimeout(90000);
      page.on('response', response => {
        const u = new URL(response.url());
        if (u.hostname === 'www.apple.com' && ['/shop/fulfillment-messages', '/shop/retail/pickup-message'].includes(u.pathname) && response.status() >= 400) {
          httpError = { safeMessage: `HTTP ${response.status()}，尚无有效库存结果`, retryAt: retryAfter(response.headers()['retry-after']) };
        }
      });
      step = '打开 Apple 页面';
      await page.goto('https://www.apple.com/', { waitUntil: 'load', timeout: 45000 });
      step = '核对商品配置';
      const navigation = await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (navigation && navigation.status() >= 400) throw Object.assign(new Error(), { safeMessage: `商品页 HTTP ${navigation.status()}`, retryAt: retryAfter(navigation.headers()['retry-after']) });
      assert.match(await page.title(), /iPhone Duo/);
      assert.equal(await page.locator('input[name="dimensionColor"]:checked').inputValue(), config.color);
      assert.equal(await page.locator('input[name="dimensionCapacity"]:checked').inputValue(), config.capacity);
      assert.equal(await page.locator('input[name="carrierModel"]:checked').inputValue(), product.carrier);
      step = '打开取货查询';
      await page.locator('button.rf-pickup-quote-overlay-trigger').filter({ hasText: 'Check Availability' }).click();
      const dialog = page.getByRole('dialog', { name: 'iPhone Availability' });
      await dialog.waitFor({ state: 'visible' });
      await dialog.getByRole('heading', { name: /Pick it up at an Apple Store near:/ }).waitFor();
      const partInput = dialog.locator('input[name^="store-"]').first();
      await partInput.waitFor({ state: 'attached' });
      const part = (await partInput.getAttribute('name')).slice(6);
      assert.match(part, /^[A-Z0-9]+(?:\/A)?$/);
      const search = dialog.locator('input[name="search"]');
      await search.click(); await search.press('ControlOrMeta+A');
      step = '提交本轮邮编查询';
      // A new page and a listener armed before Enter prevent reusing an earlier round's result.
      const [response] = await Promise.all([
        page.waitForResponse(res => {
          const u = new URL(res.url());
          return u.hostname === 'www.apple.com' && ['/shop/fulfillment-messages', '/shop/retail/pickup-message'].includes(u.pathname)
            && u.searchParams.get('location') === config.zip && u.searchParams.get('parts.0') === part;
        }, { timeout: 90000 }),
        (async () => {
          await search.pressSequentially(config.zip, { delay: 75 });
          assert.equal(await search.inputValue(), config.zip);
          await search.press('Enter');
        })(),
      ]);
      if (response.status() !== 200) throw Object.assign(new Error(), { safeMessage: `HTTP ${response.status()}，尚无有效库存结果`, retryAt: retryAfter(response.headers()['retry-after']) });
      assert.equal(new URL(response.url()).searchParams.get('cppart'), product.carrier);
      step = '校验库存响应及页面结果';
      const data = await response.json();
      const checkedAt = Date.now();
      const catalog = Object.fromEntries(inventoryStores(data).map(s => [s.storeNumber, s.storeName]));
      if (!Object.keys(catalog).length || Object.keys(catalog).length > 50 || Object.entries(catalog).some(([id, name]) => !/^R\d{3,6}$/.test(id) || typeof name !== 'string' || !name.trim() || name.length > 150)) throw new Error('Apple 门店目录无效。');
      const stores = parseInventory(data, discover ? Object.keys(catalog) : config.stores, checkedAt, part, discover ? catalog : config.catalog);
      await waitForPickupResult(dialog, config.zip, stores, part);
      if (discover) return { catalog, product: { ...product, part } };
      return { stores, verification: { source: 'Docker Chromium page', browserVersion: this.browser.version(), uid: process.getuid(), request: { url: response.url(), status: response.status() }, part, pageProductMatches: true, pageZipMatches: true } };
    } catch (e) {
      e.safeMessage = e.safeMessage || httpError?.safeMessage || `${step}失败（${e.name === 'TimeoutError' ? '超时' : '页面或数据不符合预期'}）`;
      e.retryAt = Math.max(e.retryAt || 0, httpError?.retryAt || 0);
      if (!discover && page && !page.isClosed()) {
        try {
          const dir = path.join(this.dir, 'diagnostics'); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
          await page.screenshot({ path: path.join(dir, `${round}.png`), timeout: 5000 }); e.diagnostic = round;
        } catch { e.safeMessage += '；诊断截图未能保存'; }
      }
      throw e;
    } finally {
      if (page && !page.isClosed()) await page.close();
    }
  }
  async close() {
    if (this.browser?.isConnected()) {
      const session = await this.browser.newBrowserCDPSession();
      await session.send('Browser.close');
    }
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.process.kill('SIGTERM'); reject(new Error('Chromium 未正常退出。')); }, 5000);
        this.process.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    if (this.browser) await this.browser.close();
  }
}
module.exports = { AppleBrowser, waitForPickupResult };

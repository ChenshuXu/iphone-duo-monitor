const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { PRODUCT } = require('./fixture.cjs');
const { waitForPickupResult } = require('../browser.cjs');

test('pickup waits beyond the old 20-second limit and validates expanded picker product, ZIP and available stores', { skip: process.platform !== 'linux' || !fs.existsSync('/.dockerenv') }, async t => {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  await page.setContent('<div role="dialog" aria-label="iPhone Availability"><h2>Pick it up at an Apple Store near: 10001</h2><span>Loading…</span></div>');
  const dialog = page.getByRole('dialog', { name: 'iPhone Availability' });
  await page.evaluate(part => setTimeout(() => {
    document.querySelector('[role="dialog"]').insertAdjacentHTML('beforeend', `<input type="radio" name="store-${part}" hidden><p>Apple Apple Test One</p>`);
  }, 21000), PRODUCT.part);
  const started = Date.now();
  await waitForPickupResult(dialog, '10001', [{ status: 'available', name: 'Apple Test One' }], PRODUCT.part);
  assert.ok(Date.now() - started >= 20000);
  page.setDefaultTimeout(200);
  await assert.rejects(waitForPickupResult(dialog, '10002', [], PRODUCT.part), { name: 'TimeoutError' });
  await assert.rejects(waitForPickupResult(dialog, '10001', [{ status: 'available', name: 'Apple Test Other' }], PRODUCT.part), { name: 'TimeoutError' });
  await page.locator('input').evaluate(e => e.name = 'store-WRONG-PART');
  await assert.rejects(waitForPickupResult(dialog, '10001', [], PRODUCT.part), { name: 'TimeoutError' });
});

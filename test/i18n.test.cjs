const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { translate, preferredLanguage } = require('../public/i18n.js');

test('language selection honors a saved choice and otherwise follows the browser', () => {
  assert.equal(preferredLanguage(null, 'zh-CN'), 'zh-CN');
  assert.equal(preferredLanguage(null, 'zh-TW'), 'zh-CN');
  assert.equal(preferredLanguage(null, 'en-US'), 'en');
  assert.equal(preferredLanguage(null, 'de-DE'), 'en');
  assert.equal(preferredLanguage('en', 'zh-CN'), 'en');
  assert.equal(preferredLanguage('zh-CN', 'en-US'), 'zh-CN');
  assert.equal(preferredLanguage('unsupported', 'zh-HK'), 'zh-CN');
});

test('every Chinese dashboard label and accessibility label has an English translation', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const labels = [...html.matchAll(/>([^<>]+)</g), ...html.matchAll(/aria-label="([^"]+)"/g)]
    .map((m) => m[1].trim())
    .filter((s) => /\p{Script=Han}/u.test(s) && s !== '中文');
  for (const label of labels) {
    assert.doesNotMatch(translate(label, 'en'), /\p{Script=Han}/u, label);
  }
});

test('historical events, nested failures and API validation errors translate without changing data', () => {
  assert.equal(
    translate('第 7 版查询完成：2 家可取货，4 家有效。', 'en'),
    'Version 7 query complete: 2 available, 4 valid stores.',
  );
  assert.equal(
    translate('Bark 发送失败：网络错误或超时；Bark 渠道独立冷却。', 'en'),
    'Bark failed: Network error or timeout. Bark is cooling down independently.',
  );
  assert.equal(
    translate('iPhone Duo · Alderwood：Bark 发送失败：HTTP 500；Bark 渠道独立冷却。', 'en'),
    'iPhone Duo · Alderwood: Bark failed: HTTP 500. Bark is cooling down independently.',
  );
  assert.equal(
    translate('iPhone Duo 监控故障：Bark 服务已接受。', 'en'),
    'iPhone Duo monitor fault: Bark accepted the notification.',
  );
  assert.equal(
    translate('打开商品页失败（超时）：商品页 HTTP 429；诊断截图未能保存', 'en'),
    'Open product page failed (timeout): Product page HTTP 429; diagnostic screenshot unavailable',
  );
  assert.equal(
    translate('执行步骤与网络异常（1 条，另有 3 条已省略）', 'en'),
    'Execution steps and network errors (1, 3 more omitted)',
  );
  assert.equal(
    translate('执行步骤与网络异常（0 条）', 'en'),
    'Execution steps and network errors (0)',
  );
  assert.equal(translate('商品选项 color 无效。', 'en'), 'Invalid product option: color.');
  assert.equal(
    translate('normalMin / normalMax 超出允许范围，须为整数毫秒且最小值小于最大值。', 'en'),
    'normalMin / normalMax must be integer milliseconds within the allowed range, with minimum less than maximum.',
  );
  const server = fs.readFileSync(path.join(__dirname, '../server.cjs'), 'utf8');
  for (const [, message] of server.matchAll(/fail\(\s*'([^']+)'/g)) {
    assert.doesNotMatch(translate(message, 'en'), /\p{Script=Han}/u, message);
  }
  const original = 'Apple Test One · https://www.apple.com/shop/buy-iphone/iphone-duo';
  assert.equal(translate(original, 'en'), original);
  assert.equal(translate('已暂停监控。', 'zh-CN'), '已暂停监控。');
});

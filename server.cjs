process.umask(0o077);
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { Store, Monitor, productFor, COLORS, CAPACITIES, CARRIERS, validateTarget, fail, post } = require('./core.cjs');
const { AppleBrowser } = require('./browser.cjs');

const dataDir = process.env.DATA_DIR || '/data';
const origin = process.env.PUBLIC_ORIGIN;
if (!origin || !['http:', 'https:'].includes(new URL(origin).protocol) || new URL(origin).origin !== origin) throw new Error('PUBLIC_ORIGIN 必须是无尾斜线的 HTTP(S) origin。');
const irmHost = process.env.GRAFANA_IRM_HOST || '';
if (irmHost && !/^[a-z0-9-]+\.(?:grafana\.net|grafana\.com)$/.test(irmHost)) throw new Error('GRAFANA_IRM_HOST 必须是固定的 Grafana 官方账户域名。');
const store = new Store(dataDir);
const browser = new AppleBrowser(dataDir);
const clients = new Set();
function settings() { return { ...store.value.config, barkConfigured: !!store.value.secrets.barkKey, irmConfigured: !!store.value.secrets.irmWebhook, irmReady: !!irmHost, options: { colors: COLORS, capacities: CAPACITIES, carriers: CARRIERS } }; }
function snapshot() {
  const r = store.value.runtime;
  return { serverTime: Date.now(), product: productFor(store.value.config), config: settings(), runtime: {
    paused: r.paused, phase: r.phase, startedAt: r.startedAt, lastAttempt: r.lastAttempt, lastComplete: r.lastComplete,
    nextAt: r.nextAt, waitMs: r.waitMs, failures: r.failures, notBefore: r.notBefore, stores: r.stores,
    round: r.round, configVersion: r.configVersion, verification: r.verification,
    bark: { state: !store.value.config.barkEnabled ? 'disabled' : r.bark.state, configured: !!store.value.secrets.barkKey, attemptedAt: r.bark.attemptedAt, pending: r.bark.pending?.length || 0 },
    irm: { state: !store.value.config.irmEnabled ? 'disabled' : r.irm.state, configured: !!store.value.secrets.irmWebhook, attemptedAt: r.irm.attemptedAt, notBefore: r.irm.notBefore },
  }, events: store.value.events };
}
function broadcast() {
  const message = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) {
    if (res.writableLength > 1024 * 1024) { res.destroy(); clients.delete(res); continue; }
    res.write(message);
  }
}
const monitor = new Monitor(store, (c, id) => browser.collect(c, id), post, broadcast);
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
async function body(req) {
  if (req.headers['content-type'] !== 'application/json') fail('仅接受 application/json。', 415);
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16384) fail('请求过大。', 413); }
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) fail('JSON 对象格式错误。'); return value; } catch { fail('JSON 格式错误。'); }
}
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, origin), route = url.pathname;
    if (req.headers.host !== new URL(origin).host && req.headers.host !== '127.0.0.1:8080') fail('Host 不匹配。', 400);
    if (!['GET', 'POST', 'PUT'].includes(req.method)) fail('方法不允许。', 405);
    if (req.method !== 'GET' && req.headers.origin !== origin) fail('来源校验失败。', 403);
    if (route === '/api/status' && req.method === 'GET') return send(res, 200, snapshot());
    if (route === '/api/history' && req.method === 'GET') return send(res, 200, store.history(url.searchParams));
    if (route === '/api/settings' && req.method === 'GET') return send(res, 200, settings());
    if (route === '/api/discover' && req.method === 'POST') {
      if (!store.value.runtime.paused || monitor.busy || discovering) fail('请先暂停监控并等待当前查询结束。', 409);
      const c = await body(req); validateTarget(c);
      if (Date.now() < discoveryNotBefore) fail('门店读取处于冷却，请稍后重试。', 429);
      discovering = true; discoveryNotBefore = Date.now() + 60000;
      try { return send(res, 200, await browser.collect(c, require('node:crypto').randomUUID(), true)); }
      catch (e) { discoveryNotBefore = Math.max(Date.now() + 180000, e.retryAt || 0); fail(e.safeMessage || '门店读取失败，请稍后重试。', 502); }
      finally { discovering = false; }
    }
    if (discovering && req.method !== 'GET') fail('正在读取门店，请等待结束。', 409);
    if (route === '/api/settings' && req.method === 'PUT') { monitor.save(await body(req), irmHost); return send(res, 200, settings()); }
    if (route === '/api/control' && req.method === 'POST') { await monitor.control((await body(req)).action); return send(res, 200, { ok: true, runtime: snapshot().runtime }); }
    if (route === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      clients.add(res); res.write(`data: ${JSON.stringify(snapshot())}\n\n`); req.on('close', () => clients.delete(res)); return;
    }
    const diagnostic = /^\/api\/diagnostics\/([a-f0-9-]{36})$/.exec(route);
    if (diagnostic && req.method === 'GET') {
      if (!store.value.events.some(e => e.diagnostic === diagnostic[1])) fail('诊断不存在。', 404);
      return send(res, 200, fs.readFileSync(path.join(dataDir, 'diagnostics', `${diagnostic[1]}.png`)), 'image/png');
    }
    if (assets[route] && req.method === 'GET') { const [file, type] = assets[route]; return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', file)), type); }
    fail('页面不存在。', 404);
  } catch (e) {
    if (res.headersSent) return res.end();
    send(res, e.status || 500, { error: e.status ? e.message : '服务处理失败，请检查服务运行状态。' });
    if (!e.status) { console.error('HTTP handler failed:', e.code || e.name); monitor.fatal(new Error('HTTP handler encountered an unexpected runtime/storage error')); }
  }
}
let discovering = false, discoveryNotBefore = 0;
const internal = http.createServer(handler);
internal.requestTimeout = 20000;
internal.listen(8080, '0.0.0.0');
const heartbeat = setInterval(broadcast, 15000);
const historyPrune = setInterval(() => { try { store.pruneHistory(); } catch (e) { monitor.fatal(e); } }, 3600000);
monitor.start();
console.log('iPhone Duo monitor listening; credentials and browser endpoints are not logged.');
let exiting = false;
async function stop() {
  if (exiting) return; exiting = true;
  const hardStop = setTimeout(() => process.exit(1), 120000); hardStop.unref();
  clearInterval(heartbeat);
  clearInterval(historyPrune);
  await monitor.stop();
  while (monitor.busy || discovering) await new Promise(resolve => setTimeout(resolve, 100));
  await browser.close();
  for (const res of clients.keys()) res.end();
  await new Promise(resolve => internal.close(resolve));
  store.close(); clearTimeout(hardStop);
}
process.on('SIGTERM', () => stop().catch(e => { console.error('Shutdown failed:', e.message); process.exit(1); }));
process.on('SIGINT', () => stop().catch(e => { console.error('Shutdown failed:', e.message); process.exit(1); }));

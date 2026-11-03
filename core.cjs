const { randomInt, randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const COLORS = {
  starwhite: { name: 'Star White', slug: 'star-white' },
  nightsky: { name: 'Night Sky', slug: 'night-sky' },
};
const CAPACITIES = { '256gb': '256GB', '512gb': '512GB', '1tb': '1TB', '2tb': '2TB' };
const CARRIERS = {
  't-mobile': { name: 'T-Mobile', value: 'TMOBILE_IPHONEDUO' },
  att: { name: 'AT&T', value: 'ATT_IPHONEDUO' },
  verizon: { name: 'Verizon', value: 'VERIZON_IPHONEDUO' },
  unlocked: { name: 'Connect to any carrier later', value: 'UNLOCKED/US' },
};

function productFor(c) {
  return {
    name: `iPhone Duo · ${CAPACITIES[c.capacity]} · ${COLORS[c.color].name} · ${CARRIERS[c.carrier].name}`,
    color: c.color,
    capacity: c.capacity,
    carrier: CARRIERS[c.carrier].value,
    url: `https://www.apple.com/shop/buy-iphone/iphone-duo/7.6-inch-display-${c.capacity}-${COLORS[c.color].slug}-${c.carrier}`,
  };
}

const DEFAULTS = {
  version: 1,
  confirmed: false,
  zip: '',
  color: 'starwhite',
  capacity: '256gb',
  carrier: 't-mobile',
  catalog: {},
  stores: [],
  normalMin: 60001,
  normalMax: 179999,
  retryMin: 180001,
  retryMax: 599999,
  barkEnabled: false,
  barkGroup: 'iphone-duo',
  barkTtl: 600,
  irmEnabled: false,
};

function validateTarget(c) {
  if (typeof c.zip !== 'string' || !/^\d{5}$/.test(c.zip)) {
    fail('邮编必须为五位美国 ZIP code。');
  }
  for (const [key, choices] of [
    ['color', COLORS],
    ['capacity', CAPACITIES],
    ['carrier', CARRIERS],
  ]) {
    if (typeof c[key] !== 'string' || !Object.hasOwn(choices, c[key])) {
      fail(`商品选项 ${key} 无效。`);
    }
  }
}

const HISTORY_DAYS = 60;
const DAY = 86400000;
const BARK_RETRY_DELAY = 10000;
const BARK_STOCK_RETRIES = 2;

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function validateSecrets(secrets, irmHost = '') {
  if (irmHost && !/^[a-z0-9-]+\.(?:grafana\.net|grafana\.com)$/.test(irmHost)) {
    fail('GRAFANA_IRM_HOST 必须是 Grafana 官方接收域名。');
  }
  if (
    secrets.barkKey &&
    (typeof secrets.barkKey !== 'string' || !/^[A-Za-z0-9_-]{5,256}$/.test(secrets.barkKey))
  ) {
    fail('BARK_KEY 格式无效，只填写设备 key。');
  }
  if (secrets.irmWebhook) {
    let u;
    try {
      u = new URL(secrets.irmWebhook);
    } catch {
      fail('GRAFANA_IRM_WEBHOOK 必须是 HTTPS 地址。');
    }
    if (
      typeof secrets.irmWebhook !== 'string' ||
      secrets.irmWebhook.length > 2048 ||
      u.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.(?:grafana\.net|grafana\.com)$/.test(u.hostname) ||
      (irmHost && u.hostname !== irmHost) ||
      u.port ||
      u.username ||
      u.password ||
      u.hash
    ) {
      fail(
        'GRAFANA_IRM_WEBHOOK 必须属于 Grafana 官方 HTTPS 接收域名，并与可选的 GRAFANA_IRM_HOST 一致。',
      );
    }
  }
}

function validate(input, current, secrets) {
  if (input.version !== current.version) {
    fail('设置已被其他页面修改，请重新载入后保存。', 409);
  }
  if (
    ['barkKey', 'irmWebhook', 'clear_barkKey', 'clear_irmWebhook'].some((k) =>
      Object.hasOwn(input, k),
    )
  ) {
    fail('通知凭据由 .env 管理，请修改 BARK_KEY / GRAFANA_IRM_WEBHOOK 后重新创建容器。');
  }
  const c = {};
  for (const key of Object.keys(DEFAULTS)) {
    c[key] = input[key];
  }
  validateTarget(c);
  if (
    !c.catalog ||
    typeof c.catalog !== 'object' ||
    Array.isArray(c.catalog) ||
    !Object.keys(c.catalog).length ||
    Object.keys(c.catalog).length > 50 ||
    Object.entries(c.catalog).some(
      ([id, name]) =>
        !/^R\d{3,6}$/.test(id) ||
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 150 ||
        /[\x00-\x1f]/.test(name),
    )
  ) {
    fail('请先读取该邮编的 Apple 门店。');
  }
  if (
    !Array.isArray(c.stores) ||
    !c.stores.length ||
    c.stores.some((id) => !Object.hasOwn(c.catalog, id)) ||
    new Set(c.stores).size !== c.stores.length
  ) {
    fail('请从门店目录中至少选择一家，且不能重复。');
  }
  for (const [min, max, low, high] of [
    ['normalMin', 'normalMax', 60001, 179999],
    ['retryMin', 'retryMax', 180001, 599999],
  ]) {
    if (
      ![c[min], c[max]].every(Number.isSafeInteger) ||
      c[min] < low ||
      c[max] > high ||
      c[min] >= c[max]
    ) {
      fail(`${min} / ${max} 超出允许范围，须为整数毫秒且最小值小于最大值。`);
    }
  }
  if (![c.barkEnabled, c.irmEnabled].every((v) => typeof v === 'boolean')) {
    fail('通知开关必须为布尔值。');
  }
  if (typeof c.barkGroup !== 'string' || !/^[\w-]{1,64}$/.test(c.barkGroup)) {
    fail('Bark 分组仅允许 1–64 位字母、数字、下划线和连字符。');
  }
  if (!Number.isSafeInteger(c.barkTtl) || c.barkTtl < 1 || c.barkTtl > 86400) {
    fail('Bark TTL 必须为 1–86400 秒。');
  }
  if (c.barkEnabled && !secrets.barkKey) {
    fail('启用 Bark 前请在 .env 配置 BARK_KEY。');
  }
  if (c.irmEnabled && !secrets.irmWebhook) {
    fail('启用电话前请在 .env 配置 GRAFANA_IRM_WEBHOOK。');
  }
  return { config: { ...c, confirmed: true, version: current.version + 1 } };
}

function randomDelay(min, max, notBefore = 0, now = Date.now()) {
  min = Math.max(min, Math.ceil(notBefore - now));
  if (min > max || (min === max && min % 1000 === 0)) {
    return null;
  }
  let n;
  do {
    n = randomInt(min, max + 1);
  } while (n % 1000 === 0);
  return n;
}

function retryAfter(value, now = Date.now()) {
  if (!value) {
    return 0;
  }
  if (/^\d+$/.test(value.trim())) {
    return Math.min(Number.MAX_SAFE_INTEGER, now + Number(value) * 1000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(now, date) : 0;
}

async function post(url, payload, channel) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  const retryAt = retryAfter(res.headers.get('retry-after'));
  if (!res.ok) {
    throw Object.assign(new Error(), { safeMessage: `HTTP ${res.status}`, retryAt });
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw Object.assign(new Error(), { safeMessage: '服务未返回有效 JSON', retryAt });
  }
  if (!(channel === 'bark' ? body?.code === 200 : body === 'Ok.')) {
    throw Object.assign(new Error(), { safeMessage: '服务未明确接受通知', retryAt });
  }
}

function inventoryStores(data) {
  const raw = data?.body?.content?.pickupMessage?.stores ?? data?.body?.stores;
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error('库存响应缺少已知的门店结构。');
  }
  return raw;
}

function parseInventory(data, selected, checkedAt, part, catalog) {
  const raw = inventoryStores(data);
  return selected.map((id) => {
    const matches = raw.filter((s) => s.storeNumber === id);
    const s = matches.length === 1 ? matches[0] : undefined;
    const p = s?.partsAvailability?.[part];
    const valid =
      p?.partNumber === part &&
      ['available', 'unavailable'].includes(p.pickupDisplay) &&
      s.storeName === catalog[id];
    return {
      id,
      name: catalog[id],
      status: valid ? p.pickupDisplay : 'UNKNOWN',
      checkedAt,
      description: valid
        ? [
            p.pickupSearchQuote,
            p.pickupDisplayText,
            p.pickupType,
            p.messageTypes?.regular?.storePickupQuote,
          ]
            .filter((v) => typeof v === 'string' && v)
            .join(' · ')
            .slice(0, 500)
        : '门店、商品或库存字段缺失或无法识别',
    };
  });
}

function unknownStores(config, previous = []) {
  return config.stores.map((id) => ({
    id,
    name: config.catalog[id],
    status: 'UNKNOWN',
    checkedAt: null,
    description: '尚未查询',
    lastValid: previous.find((s) => s.id === id)?.lastValid,
  }));
}

class Store {
  constructor(dir, secrets = {}, irmHost = '') {
    validateSecrets(secrets, irmHost);
    this.secrets = secrets;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    this.dir = dir;
    this.db = new DatabaseSync(path.join(dir, 'monitor.sqlite'));
    fs.chmodSync(path.join(dir, 'monitor.sqlite'), 0o600);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)',
    );
    const row = this.db.prepare('SELECT json FROM state WHERE id=1').get();
    if (row) {
      this.value = JSON.parse(row.json);
    } else {
      this.value = {
        config: {
          ...structuredClone(DEFAULTS),
          barkEnabled: !!secrets.barkKey,
          irmEnabled: !!secrets.irmWebhook,
        },
        runtime: {
          paused: true,
          startedAt: Date.now(),
          phase: 'paused',
          stores: unknownStores(DEFAULTS),
          failures: 0,
          notBefore: 0,
          lastComplete: null,
          nextAt: null,
          faultActive: false,
          faultPending: null,
          bark: { state: secrets.barkKey ? 'idle' : 'disabled' },
          irm: { state: secrets.irmWebhook ? 'idle' : 'disabled', groups: [], notBefore: 0 },
        },
        events: [],
      };
    }
    if (!this.value.config || !this.value.runtime) {
      throw new Error('配置数据库结构无效；不会自动重置。');
    }
    const legacy = this.value.secrets;
    if (legacy && ['barkKey', 'irmWebhook'].some((k) => legacy[k] && !secrets[k])) {
      this.db.close();
      throw new Error(
        '旧数据库仍有通知凭据；请先迁入 .env 的 BARK_KEY / GRAFANA_IRM_WEBHOOK，数据库未修改。',
      );
    }
    const phone = this.value.runtime.irm;
    const webhookHash = createHash('sha256')
      .update(secrets.irmWebhook || '')
      .digest('hex');
    const previousHash =
      phone.webhookHash ||
      (legacy?.irmWebhook ? createHash('sha256').update(legacy.irmWebhook).digest('hex') : null);
    if (phone.groups.length && previousHash !== webhookHash) {
      this.db.close();
      throw new Error(
        '仍有待清理电话分组；请使用原 GRAFANA_IRM_WEBHOOK 清理后，再替换或清除该环境变量。',
      );
    }
    delete this.value.secrets;
    phone.webhookHash = webhookHash;
    if (
      (!secrets.barkKey && this.value.config.barkEnabled) ||
      (!secrets.irmWebhook && this.value.config.irmEnabled)
    ) {
      this.value.config.version++;
    }
    if (!secrets.barkKey) {
      this.value.config.barkEnabled = false;
    }
    if (!secrets.irmWebhook) {
      this.value.config.irmEnabled = false;
    }
    this.commit();
    this.db.exec(`CREATE TABLE IF NOT EXISTS queries (
      id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, finished_at INTEGER,
      config_json TEXT NOT NULL, stores_json TEXT NOT NULL, outcome TEXT NOT NULL,
      available_count INTEGER NOT NULL DEFAULT 0, superseded INTEGER NOT NULL DEFAULT 0,
      error TEXT, verification_json TEXT, diagnostics_json TEXT, source TEXT NOT NULL DEFAULT 'live'
    ); CREATE INDEX IF NOT EXISTS queries_time ON queries(started_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS queries_available ON queries(available_count, started_at DESC)`);
    if (
      !this.db
        .prepare('PRAGMA table_info(queries)')
        .all()
        .some((c) => c.name === 'diagnostics_json')
    ) {
      this.db.exec('ALTER TABLE queries ADD COLUMN diagnostics_json TEXT');
    }
    if (!this.value.historyStartedAt) {
      this.value.historyStartedAt = Date.now();
      const r = this.value.runtime;
      const c = this.value.config;
      // Only the latest complete snapshot has enough evidence to recover per-store results.
      if (
        r.round &&
        r.configVersion === c.version &&
        r.lastComplete >= r.lastAttempt &&
        r.stores.length &&
        r.stores.every((s) => s.status !== 'UNKNOWN')
      ) {
        this.beginQuery(c, r.round, r.lastAttempt, 'snapshot');
        this.finishQuery(
          r.round,
          { stores: r.stores, verification: r.verification },
          r.lastComplete,
        );
      }
      this.commit();
    }
    for (const row of this.db
      .prepare("SELECT id, stores_json FROM queries WHERE outcome='checking'")
      .all()) {
      const stores = JSON.parse(row.stores_json).map((s) => ({
        ...s,
        status: 'UNKNOWN',
        description: '服务中断，未取得完整查询结果。',
      }));
      this.finishQuery(
        row.id,
        { stores, error: '服务中断，未取得完整查询结果。' },
        Date.now(),
        false,
        'interrupted',
      );
    }
    this.pruneHistory();
  }

  pruneHistory(now = Date.now()) {
    this.db.prepare('DELETE FROM queries WHERE started_at < ?').run(now - HISTORY_DAYS * DAY);
  }

  beginQuery(config, id, startedAt, source = 'live') {
    this.pruneHistory(startedAt);
    const target = {
      version: config.version,
      zip: config.zip,
      stores: config.stores,
      product: productFor(config),
    };
    this.db
      .prepare(
        'INSERT INTO queries(id, started_at, config_json, stores_json, outcome, source) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        startedAt,
        JSON.stringify(target),
        JSON.stringify(unknownStores(config)),
        'checking',
        source,
      );
  }

  finishQuery(id, result, finishedAt = Date.now(), superseded = false, outcome) {
    const stores = result.stores.map(({ id, name, status, checkedAt, description }) => ({
      id,
      name: name || id,
      status,
      checkedAt,
      description,
    }));
    const valid = stores.filter((s) => s.status !== 'UNKNOWN').length;
    outcome ||= valid === stores.length ? 'complete' : valid ? 'partial' : 'failed';
    this.db
      .prepare(
        'UPDATE queries SET finished_at=?, stores_json=?, outcome=?, available_count=?, superseded=?, error=?, verification_json=?, diagnostics_json=? WHERE id=?',
      )
      .run(
        finishedAt,
        JSON.stringify(stores),
        outcome,
        stores.filter((s) => s.status === 'available').length,
        Number(superseded),
        result.error || null,
        result.verification ? JSON.stringify(result.verification) : null,
        result.diagnostics ? JSON.stringify(result.diagnostics) : null,
        id,
      );
  }

  history(params = new URLSearchParams(), now = Date.now()) {
    const days = params.get('days') || '60';
    const store = params.get('store') || '';
    const outcome = params.get('outcome') || '';
    const available = params.get('available') || '0';
    if (
      !['1', '7', '30', '60'].includes(days) ||
      (store && !/^R\d{3,6}$/.test(store)) ||
      !['', 'checking', 'complete', 'partial', 'failed', 'interrupted'].includes(outcome) ||
      !['0', '1'].includes(available)
    ) {
      fail('历史查询筛选条件无效。');
    }
    this.pruneHistory(now);
    const where = ['q.started_at >= ?'];
    const args = [now - Number(days) * DAY];
    if (store) {
      where.push(
        "EXISTS(SELECT 1 FROM json_each(q.stores_json) s WHERE json_extract(s.value, '$.id')=?)",
      );
      args.push(store);
    }
    const base = where.join(' AND ');
    const hasStock = store
      ? "EXISTS(SELECT 1 FROM json_each(q.stores_json) s WHERE json_extract(s.value, '$.id')=? AND json_extract(s.value, '$.status')='available')"
      : 'q.available_count > 0';
    const summary = this.db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(${hasStock}),0) AS availableRounds, COALESCE(SUM(outcome IN ('partial','failed','interrupted')),0) AS unknownRounds FROM queries q WHERE ${base}`,
      )
      .get(...(store ? [store] : []), ...args);
    const byStore = this.db
      .prepare(
        `SELECT json_extract(s.value,'$.id') AS id, json_extract(s.value,'$.name') AS name, COUNT(*) AS count,
      MIN(COALESCE(json_extract(s.value,'$.checkedAt'),q.finished_at)) AS firstAt, MAX(COALESCE(json_extract(s.value,'$.checkedAt'),q.finished_at)) AS lastAt
      FROM queries q, json_each(q.stores_json) s WHERE ${base} AND q.available_count>0 AND json_extract(s.value,'$.status')='available' ${store ? "AND json_extract(s.value,'$.id')=?" : ''}
      GROUP BY json_extract(s.value,'$.id'), json_extract(s.value,'$.name') ORDER BY lastAt DESC`,
      )
      .all(...args, ...(store ? [store] : []));
    if (available === '1') {
      where.push(hasStock);
      if (store) {
        args.push(store);
      }
    }
    if (outcome) {
      where.push('q.outcome=?');
      args.push(outcome);
    }
    const total = this.db
      .prepare(`SELECT COUNT(*) AS n FROM queries q WHERE ${where.join(' AND ')}`)
      .get(...args).n;
    if (params.has('cursor')) {
      let cursor;
      try {
        cursor = JSON.parse(Buffer.from(params.get('cursor'), 'base64url').toString());
      } catch {
        fail('历史分页位置无效。');
      }
      if (
        !Array.isArray(cursor) ||
        cursor.length !== 2 ||
        !Number.isSafeInteger(cursor[0]) ||
        cursor[0] < 0 ||
        typeof cursor[1] !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(cursor[1])
      ) {
        fail('历史分页位置无效。');
      }
      where.push('(q.started_at < ? OR (q.started_at = ? AND q.id < ?))');
      args.push(cursor[0], cursor[0], cursor[1]);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM queries q WHERE ${where.join(' AND ')} ORDER BY started_at DESC, id DESC LIMIT 51`,
      )
      .all(...args);
    const more = rows.length > 50;
    const page = rows.slice(0, 50);
    const last = page.at(-1);
    return {
      retentionDays: HISTORY_DAYS,
      historyStartedAt: this.value.historyStartedAt,
      serverTime: now,
      total,
      summary: { ...summary, byStore },
      nextCursor: more
        ? Buffer.from(JSON.stringify([last.started_at, last.id])).toString('base64url')
        : null,
      items: page.map((r) => ({
        id: r.id,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        config: JSON.parse(r.config_json),
        stores: JSON.parse(r.stores_json),
        outcome: r.outcome,
        superseded: !!r.superseded,
        error: r.error,
        verification: r.verification_json ? JSON.parse(r.verification_json) : null,
        diagnostics: r.diagnostics_json ? JSON.parse(r.diagnostics_json) : null,
        source: r.source,
      })),
    };
  }

  commit() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT INTO state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
        .run(JSON.stringify(this.value));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    const diagDir = path.join(this.dir, 'diagnostics');
    const keep = this.value.events.filter((e) => e.diagnostic).map((e) => e.diagnostic);
    if (fs.existsSync(diagDir)) {
      for (const f of fs.readdirSync(diagDir)) {
        if (!keep.includes(f.replace(/\.png$/, ''))) {
          fs.unlinkSync(path.join(diagDir, f));
        }
      }
    }
  }

  event(type, message, diagnostic) {
    this.value.events.unshift({
      id: randomUUID(),
      at: Date.now(),
      type,
      message,
      ...(diagnostic ? { diagnostic } : {}),
    });
    this.value.events.length = Math.min(this.value.events.length, 200);
    let count = 0;
    for (const event of this.value.events) {
      if (event.diagnostic && ++count > 20) {
        delete event.diagnostic;
      }
    }
  }

  close() {
    this.db.close();
  }
}

class Monitor {
  constructor(store, collect, post, changed = () => {}) {
    this.store = store;
    this.collect = collect;
    this.post = post;
    this.changed = changed;
    this.busy = false;
    this.testing = false;
    this.timer = null;
    this.barkRetryTimer = null;
    this.stopping = false;
    // Tests, stock alerts and cleanup share queues; internal failures propagate to callers.
    this.barkQueue = Promise.resolve();
    this.irmQueue = Promise.resolve();
  }

  get v() {
    return this.store.value;
  }

  publish() {
    this.store.commit();
    this.changed();
  }

  event(type, message, diagnostic) {
    this.store.event(type, message, diagnostic);
  }

  start() {
    const r = this.v.runtime;
    r.bark.pending = [];
    r.phase = r.paused ? 'paused' : 'waiting';
    this.event('system', '服务启动；旧库存待重新核验。');
    r.stores = unknownStores(this.v.config, r.stores);
    this.publish();
    if (!r.paused) {
      this.schedule(r.failures > 0, true);
    }
    void this.cleanupIrm().catch((e) => this.fatal(e));
  }

  fatal(e) {
    console.error('Persistent state or runtime failure:', e.message);
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  }

  schedule(error = false, preserve = false) {
    clearTimeout(this.timer);
    const r = this.v.runtime;
    const c = this.v.config;
    if (r.paused || this.stopping) {
      r.nextAt = null;
      this.publish();
      return;
    }
    const now = Date.now();
    if (r.notBefore > now + c.normalMax) {
      error = true;
    }
    r.notBefore = Math.max(r.notBefore || 0, now + (error ? c.retryMin : c.normalMin));
    const delay = randomDelay(
      error ? c.retryMin : c.normalMin,
      error ? c.retryMax : c.normalMax,
      Math.max(r.notBefore, preserve ? r.nextAt || 0 : 0),
      now,
    );
    if (delay === null) {
      r.paused = true;
      r.phase = 'attention';
      r.nextAt = null;
      r.faultPending = {
        id: randomUUID(),
        title: '监控已暂停',
        body: 'Retry-After 要求超出已保存的等待范围，需要处理后恢复。',
      };
      this.event('error', r.faultPending.body);
      this.publish();
      void this.sendFault().catch((e) => this.fatal(e));
      return;
    }
    r.waitMs = delay;
    r.nextAt = now + delay;
    r.phase = error ? 'retrying' : 'waiting';
    this.publish();
    this.timer = setTimeout(() => this.run().catch((e) => this.fatal(e)), delay);
  }

  async control(action) {
    const r = this.v.runtime;
    if (action === 'pause') {
      clearTimeout(this.timer);
      r.paused = true;
      r.phase = 'paused';
      r.nextAt = null;
      r.bark.pending = [];
      this.event('control', '已暂停监控。');
      this.publish();
      await this.cleanupIrm();
    } else if (action === 'resume') {
      if (!this.v.config.confirmed) {
        fail('请先保存并确认门店设置。');
      }
      if (!r.paused) {
        return;
      }
      r.paused = false;
      r.stores = unknownStores(this.v.config, r.stores);
      this.event('control', '已恢复监控；按正式间隔安排查询。');
      this.schedule(r.failures > 0);
    } else if (action === 'query') {
      if (r.paused) {
        fail('请先恢复监控。');
      }
      if (this.stopping) {
        fail('服务正在停止，请稍后重试。', 409);
      }
      if (this.busy) {
        this.event('control', '正在查询；不会并发增加查询。');
        this.publish();
        return { queryStatus: 'busy' };
      }
      const delay = Math.max(0, (r.notBefore || 0) - Date.now());
      if (delay > 0) {
        clearTimeout(this.timer);
        r.nextAt = r.notBefore;
        r.waitMs = delay;
        this.event('control', '已请求查询；最短间隔或限流结束后立即执行。');
        this.publish();
        this.timer = setTimeout(() => this.run().catch((e) => this.fatal(e)), delay);
        return { queryStatus: 'scheduled' };
      }
      this.event('control', '已手动开始查询。');
      void this.run().catch((e) => this.fatal(e));
      return { queryStatus: 'started' };
    } else if (['cleanup-irm', 'recover-irm'].includes(action)) {
      if (!r.paused || this.busy || this.testing) {
        fail('请先暂停监控，并等待当前查询或通知测试结束。', 409);
      }
      if (action === 'recover-irm') {
        if (
          !['paused', 'disabled'].includes(r.irm.state) ||
          r.irm.notBefore !== Number.MAX_SAFE_INTEGER
        ) {
          fail('此操作仅用于旧版遗留的电话永久暂停。');
        }
        r.irm.notBefore = 0;
        r.irm.state = 'idle';
        this.publish();
      }
      if (Date.now() < (r.irm.notBefore || 0)) {
        fail('电话渠道仍在冷却，请等待截止时间后重试。', 429);
      }
      if (!(await this.cleanupIrm())) {
        fail('电话分组清理失败，请检查渠道状态后重试。', 502);
      }
    } else if (['test-bark', 'test-irm'].includes(action)) {
      if (this.testing) {
        fail('已有通知测试正在进行。', 409);
      }
      this.testing = true;
      try {
        if (action === 'test-bark') {
          if (!this.store.secrets.barkKey) {
            fail('Bark 尚未配置。');
          }
          if (Date.now() < (r.bark.notBefore || 0)) {
            fail('Bark 渠道仍在冷却，请稍后重试。', 429);
          }
          await this.bark(
            {
              id: `test-${randomUUID()}`,
              title: 'iPhone Duo 测试通知',
              body: '这是一条 Bark 测试通知，附有所选商品的购买链接。',
            },
            { test: true },
          );
        } else {
          if (!this.v.config.irmEnabled) {
            fail('电话尚未启用；等待 Grafana 配置。');
          }
          if (Date.now() < (r.irm.notBefore || 0)) {
            fail('电话渠道仍在冷却或暂停。');
          }
          if (!(await this.cleanupIrm())) {
            fail('旧电话分组尚未清理。');
          }
          await this.submitIrm(
            `test-${randomUUID()}`,
            'TEST: iPhone Duo phone notification test. This is not a stock alert.',
            'Test phone call',
          );
        }
      } finally {
        this.testing = false;
        this.publish();
      }
    } else {
      fail('未知操作。');
    }
  }

  save(input) {
    const old = this.v.config;
    const next = validate(input, old, this.store.secrets);
    const targetChanged =
      ['zip', 'color', 'capacity', 'carrier'].some((k) => old[k] !== next.config[k]) ||
      JSON.stringify(old.catalog) !== JSON.stringify(next.config.catalog) ||
      old.stores.join() !== next.config.stores.join();
    this.v.config = next.config;
    const r = this.v.runtime;
    if (targetChanged) {
      r.stores = unknownStores(next.config);
      r.lastComplete = null;
      r.startedAt = Date.now();
      r.failures = 0;
      r.bark.pending = [];
    }
    if (!next.config.barkEnabled) {
      r.bark.pending = [];
    }
    this.event('settings', `设置已保存，第 ${next.config.version} 版。`);
    this.publish();
    if (!this.busy && !r.paused) {
      this.schedule(r.failures > 0);
    }
    if (!next.config.irmEnabled) {
      void this.cleanupIrm().catch((e) => this.fatal(e));
    }
    return next.config;
  }

  bark(message, { test = false, activeOnly = false } = {}) {
    const version = this.v.config.version;
    this.barkQueue = this.barkQueue.then(() =>
      this.sendBark(message, { test, activeOnly, version }),
    );
    return this.barkQueue;
  }

  async sendBark(message, { test, activeOnly, version }) {
    const c = this.v.config;
    const r = this.v.runtime;
    if (
      c.version !== version ||
      (activeOnly && (r.paused || this.stopping)) ||
      (!test && !c.barkEnabled) ||
      Date.now() < (r.bark.notBefore || 0)
    ) {
      return false;
    }
    r.bark = { ...r.bark, state: 'pending', attemptedAt: Date.now() };
    this.publish();
    try {
      await this.post(
        'https://api.day.app/push',
        {
          device_key: this.store.secrets.barkKey,
          title: message.title,
          body: message.body,
          group: c.barkGroup,
          ttl: c.barkTtl,
          level: 'active',
          url: productFor(this.v.config).url,
          id: message.id,
        },
        'bark',
      );
    } catch (e) {
      r.bark.notBefore = Math.max(e.retryAt || 0, Date.now() + BARK_RETRY_DELAY);
      r.bark.state = 'cooldown';
      this.event(
        'error',
        `Bark 发送失败：${e.safeMessage || '网络错误或超时'}；Bark 渠道独立冷却。`,
      );
      this.publish();
      return false;
    }
    r.bark.state = 'accepted';
    r.bark.notBefore = 0;
    this.event('bark', `${test ? '测试通知' : message.title}：Bark 服务已接受。`);
    this.publish();
    return true;
  }

  async sendPendingBark(version) {
    const r = this.v.runtime;
    for (const message of [...r.bark.pending]) {
      if (r.paused || this.stopping || version !== this.v.config.version) {
        break;
      }
      if (await this.bark(message, { activeOnly: true })) {
        r.bark.pending = r.bark.pending.filter((m) => m.id !== message.id);
        this.publish();
      }
    }
  }

  // Stock usually disappears before the next round, so a failed alert retries within its round.
  scheduleBarkRetry(version, retries) {
    const r = this.v.runtime;
    const wait = (r.bark.notBefore || 0) - Date.now();
    if (!retries || !r.bark.pending.length || wait > BARK_RETRY_DELAY) {
      return;
    }
    const retry = async () => {
      await this.sendPendingBark(version);
      this.scheduleBarkRetry(version, retries - 1);
    };
    this.barkRetryTimer = setTimeout(
      () => retry().catch((e) => this.fatal(e)),
      Math.max(wait, 0) + 1,
    );
  }

  async sendFault() {
    const message = this.v.runtime.faultPending;
    if (message && (await this.bark(message))) {
      if (this.v.runtime.faultPending?.id === message.id) {
        this.v.runtime.faultPending = null;
      }
      this.publish();
    }
  }

  cleanupIrm() {
    this.irmQueue = this.irmQueue.then(() => this.resolveIrm());
    return this.irmQueue;
  }

  async resolveIrm() {
    const r = this.v.runtime.irm;
    if (!r.groups.length) {
      return true;
    }
    if (Date.now() < (r.notBefore || 0)) {
      return false;
    }
    for (const group of [...r.groups]) {
      try {
        await this.post(this.store.secrets.irmWebhook, { ...group, state: 'OK' }, 'irm');
      } catch (e) {
        this.irmFailure(e);
        if (!r.cleanupReported) {
          r.cleanupReported = true;
          this.v.runtime.faultPending = {
            id: randomUUID(),
            title: '电话渠道异常',
            body: '上一轮 IRM 分组清理失败，新电话暂停；Bark 和库存查询继续。',
          };
          await this.sendFault();
        }
        return false;
      }
      r.groups = r.groups.filter((g) => g.group_key !== group.group_key);
      r.notBefore = 0;
      r.state = this.v.config.irmEnabled ? 'idle' : 'disabled';
      r.cleanupReported = false;
      this.event('irm', '上一轮 IRM 分组已清理。');
      this.publish();
    }
    return true;
  }

  irmFailure(e) {
    const r = this.v.runtime.irm;
    const c = this.v.config;
    r.notBefore = Math.max(e.retryAt || 0, Date.now() + randomDelay(c.retryMin, c.retryMax));
    r.state = 'cooldown';
    r.attemptedAt = Date.now();
    this.event('error', `IRM 请求失败：${e.safeMessage || '网络错误或超时'}；电话渠道独立冷却。`);
    this.publish();
  }

  submitIrm(id, title, message, { activeOnly = false } = {}) {
    const version = this.v.config.version;
    this.irmQueue = this.irmQueue.then(() =>
      this.sendIrm(id, title, message, { activeOnly, version }),
    );
    return this.irmQueue;
  }

  async sendIrm(id, title, message, { activeOnly, version }) {
    const r = this.v.runtime.irm;
    if (
      this.v.config.version !== version ||
      (activeOnly && (this.v.runtime.paused || this.stopping)) ||
      !this.v.config.irmEnabled ||
      Date.now() < (r.notBefore || 0) ||
      r.groups.length
    ) {
      return;
    }
    const payload = {
      group_key: `iphone-duo-${id}`,
      state: 'alerting',
      title,
      message,
      url: productFor(this.v.config).url,
    };
    r.groups.push(payload);
    r.state = 'pending';
    r.attemptedAt = Date.now();
    this.publish();
    try {
      await this.post(this.store.secrets.irmWebhook, payload, 'irm');
    } catch (e) {
      this.irmFailure(e);
      return;
    }
    r.state = 'accepted';
    r.cleanupReported = false;
    this.event('irm', 'IRM 服务已接受分组，尚未确认电话接通。');
    this.publish();
  }

  async run() {
    const r = this.v.runtime;
    if (this.busy || r.paused || this.stopping) {
      return;
    }
    this.busy = true;
    clearTimeout(this.timer);
    clearTimeout(this.barkRetryTimer);
    const c = structuredClone(this.v.config);
    const round = randomUUID();
    const checkedAt = Date.now();
    this.store.beginQuery(c, round, checkedAt);
    r.lastAttempt = checkedAt;
    r.round = round;
    r.configVersion = c.version;
    r.verification = null;
    r.nextAt = null;
    r.phase = 'checking';
    r.bark.pending = [];
    this.publish();
    let error = false;
    let result;
    try {
      await this.cleanupIrm();
      try {
        result = await this.collect(c, round);
      } catch (e) {
        result = {
          stores: unknownStores(c).map((s) => ({
            ...s,
            checkedAt,
            description: e.safeMessage || '浏览器查询失败，请查看诊断。',
          })),
          error: e.safeMessage || '浏览器查询失败',
          retryAt: e.retryAt || 0,
          diagnostic: e.diagnostic,
          diagnostics: e.diagnostics,
        };
      }
      const finishedAt = Date.now();
      this.store.finishQuery(round, result, finishedAt, c.version !== this.v.config.version);
      error = result.stores.some((s) => s.status === 'UNKNOWN');
      r.notBefore = Math.max(
        r.notBefore || 0,
        finishedAt + (error ? c.retryMin : c.normalMin),
        result.retryAt || 0,
      );
      if (c.version !== this.v.config.version) {
        this.event(
          'query',
          `第 ${c.version} 版查询结束，设置已变更；仅保留历史，不更新当前库存或通知。`,
        );
        this.publish();
        return;
      }
      r.stores = result.stores.map((s) => ({
        ...s,
        lastValid:
          s.status !== 'UNKNOWN'
            ? { status: s.status, checkedAt: s.checkedAt }
            : r.stores.find((x) => x.id === s.id)?.lastValid,
      }));
      r.verification = result.verification || null;
      const complete = !error;
      if (complete) {
        r.lastComplete = finishedAt;
        r.failures = 0;
      } else {
        r.failures++;
      }
      this.event(
        complete ? 'query' : 'error',
        complete
          ? `第 ${c.version} 版查询完成：${r.stores.filter((s) => s.status === 'available').length} 家可取货，${r.stores.length} 家有效。`
          : `查询失败：${result.error || '部分门店未知'}，库存待确认。`,
        result.diagnostic,
      );
      if (
        !complete &&
        r.failures >= 3 &&
        finishedAt - (r.lastComplete || r.startedAt) >= 1800000 &&
        !r.faultActive
      ) {
        r.faultActive = true;
        r.faultPending = {
          id: randomUUID(),
          title: 'iPhone Duo 监控故障',
          body: '连续至少 3 轮失败且 30 分钟无完整成功查询，请打开管理页面检查。',
        };
      }
      if (complete && r.faultActive) {
        r.faultActive = false;
        r.faultPending = {
          id: randomUUID(),
          title: 'iPhone Duo 监控恢复',
          body: '全部目标门店已恢复有效查询。',
        };
      }
      const available = r.stores.filter((s) => s.status === 'available');
      if (!r.paused && this.v.config.barkEnabled) {
        r.bark.pending = available.map((s) => ({
          // Bark forwards this as the APNs collapse ID, which is limited to 64 bytes.
          id: `${s.id}-${round}`,
          title: `iPhone Duo · ${s.name}`,
          body: `${productFor(c).name}\n${s.name}\n${s.description}\nZIP ${c.zip}\n检查：${new Date(s.checkedAt).toISOString()}`,
        }));
      }
      this.publish();
      await this.sendFault();
      await this.sendPendingBark(c.version);
      this.scheduleBarkRetry(c.version, BARK_STOCK_RETRIES);
      if (!r.paused && !this.stopping && c.version === this.v.config.version && available.length) {
        await this.submitIrm(
          round,
          `iPhone Duo pickup available at ${available.map((s) => s.name).join(', ')}. Checked at ${new Date(finishedAt).toISOString()}. Check Bark for the purchase link.`,
          `${productFor(c).name}; ZIP ${c.zip}; ${new Date(finishedAt).toISOString()}`,
          { activeOnly: true },
        );
      }
    } finally {
      this.busy = false;
      if (r.paused) {
        r.phase = 'paused';
        this.publish();
      } else {
        this.schedule(error);
      }
    }
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.timer);
    clearTimeout(this.barkRetryTimer);
    await this.cleanupIrm();
    await this.barkQueue;
  }
}

module.exports = {
  COLORS,
  CAPACITIES,
  CARRIERS,
  productFor,
  validateTarget,
  validateSecrets,
  inventoryStores,
  DEFAULTS,
  Store,
  Monitor,
  validate,
  randomDelay,
  retryAfter,
  post,
  parseInventory,
  unknownStores,
  fail,
};

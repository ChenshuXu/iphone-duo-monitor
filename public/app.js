const $ = (s) => document.querySelector(s);
const form = $('#settings');
const languageKey = 'iphone-duo-language';
let language = monitorI18n.preferredLanguage(localStorage.getItem(languageKey), navigator.language);
const t = (text) => monitorI18n.translate(text, language);
const textSources = new WeakMap();
const pageTitle = document.title;
const staticText = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

while (staticText.nextNode()) {
  textSources.set(staticText.currentNode, staticText.currentNode.nodeValue);
}
const ariaLabels = [...document.querySelectorAll('[aria-label]')].map((el) => [
  el,
  el.getAttribute('aria-label'),
]);

function setText(el, text) {
  el.textContent = t(text);
  if (el.firstChild) {
    textSources.set(el.firstChild, String(text ?? ''));
  }
}

function applyLanguage() {
  document.documentElement.lang = language;
  document.title = t(pageTitle);
  $('#language').value = language;
  const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (texts.nextNode()) {
    const source = textSources.get(texts.currentNode);
    if (source !== undefined) {
      texts.currentNode.nodeValue = t(source);
    }
  }
  for (const [el, label] of ariaLabels) {
    el.setAttribute('aria-label', t(label));
  }
}

$('#language').onchange = (e) => {
  language = e.target.value;
  localStorage.setItem(languageKey, language);
  applyLanguage();
  historyKey = undefined;
  if (state) {
    render(state, false);
  }
};

applyLanguage();

let state;
let formVersion;
let populatedSettings;
let dirty = false;
let received = 0;
let offset = 0;
let catalog = {};
let discoveredTarget = null;
let historyAvailable = false;
let historyCursors = [null];
let historyNext = null;
let historyRequest = 0;
let historyKey;

const outcomeNames = {
  checking: '查询中',
  complete: '结果完整',
  partial: '部分未知',
  failed: '查询失败',
  interrupted: '查询中断',
};
const historyDate = (n) =>
  n
    ? new Date(n).toLocaleString(language, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : '—';
const phaseNames = {
  paused: '已暂停',
  waiting: '监控中',
  checking: '正在查询',
  retrying: '等待重试',
  attention: '需要处理',
};
const stockNames = { available: '可取货', unavailable: '无货', UNKNOWN: '未知' };
const channelNames = {
  disabled: '已停用',
  idle: '等待下一轮',
  pending: '待发送',
  accepted: '服务已接受',
  failed: '发送失败',
  cooldown: '冷却中',
  paused: '需要处理',
};
const channelStateName = (channel, now) => {
  if (!channel.configured) {
    return '未配置';
  }

  if (channel.state === 'cooldown' && !(channel.notBefore > now)) {
    return channelNames.failed;
  }

  return channelNames[channel.state] || '等待下一轮';
};
const date = (n) =>
  n
    ? new Date(n).toLocaleString(language, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      })
    : null;

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) {
    setText(el, text);
  }
  if (className) {
    el.className = className;
  }
  return el;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

let toastTimer;

function toast(message) {
  clearTimeout(toastTimer);
  const el = $('#operation-message');
  setText(el, message);
  el.hidden = false;
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

function targetInput() {
  return Object.fromEntries(
    ['zip', 'color', 'capacity', 'carrier'].map((k) => [k, form.elements[k].value]),
  );
}

function targetKey(c) {
  return JSON.stringify([c.zip, c.color, c.capacity, c.carrier]);
}

function renderStoreOptions(selected = []) {
  $('#store-options').replaceChildren(
    ...Object.entries(catalog).map(([id, name]) => {
      const label = node('label', undefined, 'check');
      const input = node('input');
      input.type = 'checkbox';
      input.name = 'stores';
      input.value = id;
      input.checked = selected.includes(id);
      label.append(input, document.createTextNode(name));
      return label;
    }),
  );
}

$('#discover').onclick = async (e) => {
  const button = e.target;
  const target = targetInput();
  button.disabled = true;
  setText($('#discover-message'), '正在打开 Apple 页面读取门店，可能需要几分钟…');

  try {
    const data = await api('/api/discover', { method: 'POST', body: JSON.stringify(target) });
    if (targetKey(targetInput()) !== targetKey(target)) {
      setText($('#discover-message'), '读取期间商品或邮编变化，请重新读取。');
      return;
    }

    catalog = data.catalog;
    discoveredTarget = targetKey(target);
    renderStoreOptions();
    dirty = true;
    setText(
      $('#discover-message'),
      `已读取 ${Object.keys(catalog).length} 家附近门店，请勾选要监控的门店并保存。`,
    );
  } catch (error) {
    setText($('#discover-message'), error.message);
  } finally {
    button.disabled = false;
  }
};

function populate(c) {
  formVersion = c.version;
  populatedSettings = JSON.stringify(c);

  for (const [key, options] of Object.entries({
    color: c.options.colors,
    capacity: c.options.capacities,
    carrier: c.options.carriers,
  })) {
    form.elements[key].replaceChildren(
      ...Object.entries(options).map(([value, data]) => {
        const o = node('option', typeof data === 'string' ? data : data.name);
        o.value = value;
        return o;
      }),
    );
  }
  catalog = c.catalog;
  discoveredTarget = targetKey(c);

  for (const k of ['zip', 'color', 'capacity', 'carrier', 'barkGroup', 'barkTtl']) {
    form.elements[k].value = c[k];
  }
  for (const k of ['normalMin', 'normalMax', 'retryMin', 'retryMax']) {
    form.elements[k].value = c[k] / 1000;
  }
  for (const k of ['barkEnabled', 'irmEnabled']) {
    form.elements[k].checked = c[k];
  }

  renderStoreOptions(c.stores);
  form.elements.barkEnabled.disabled = !c.barkConfigured;
  form.elements.irmEnabled.disabled = !c.irmConfigured;
  setText(
    $('#bark-help'),
    c.barkConfigured
      ? 'BARK_KEY 已从 .env 配置；更换后重新创建容器。'
      : '请在 .env 填写 BARK_KEY，再重新创建容器。',
  );
  setText(
    $('#irm-help'),
    c.irmConfigured
      ? 'Webhook 已从 .env 配置；接收者、路由和电话规则在 Grafana 中管理。'
      : '请在 .env 填写 GRAFANA_IRM_WEBHOOK，再重新创建容器。',
  );
  dirty = false;
  setText($('#version'), `第 ${c.version} 版`);
}

function render(data, fresh = true) {
  // The stream omits events when they have not changed since the previous push.
  if (!data.events) {
    data.events = state.events;
  }
  state = data;
  if (fresh) {
    received = Date.now();
    offset = data.serverTime - received;
  }

  const r = data.runtime;
  const c = data.config;

  setText($('#connection'), '● 已连接');
  setText($('#phase'), phaseNames[r.phase] || r.phase);
  $('#product-link').href = data.product.url;
  setText($('#product-name'), data.product.name);
  setText($('#last-attempt'), date(r.lastAttempt) || '尚未查询');
  setText($('#last-success'), date(r.lastComplete) || '尚未成功');
  setText($('#target'), `${c.zip} · ${c.stores.length} 家门店 · 第 ${c.version} 版`);
  setText($('#history-retention'), `保留最近 ${data.retention.historyDays} 天 · 有货记录永久保留`);
  setText($('#events-retention'), `保留 ${data.retention.eventDays} 天 · 有货相关永久保留`);

  $('#toggle').disabled = false;
  setText($('#toggle'), r.paused ? '恢复监控' : '暂停监控');
  $('#query').disabled = r.paused;
  setText(
    $('#inventory-note'),
    r.paused
      ? '库存已停止更新'
      : `本轮配置：${r.configVersion ? `第 ${r.configVersion} 版` : '尚未查询'}`,
  );

  $('#stores').replaceChildren(
    ...r.stores.map((s) => {
      const stale = r.paused || s.status === 'UNKNOWN';
      const el = node(
        'article',
        undefined,
        `store ${!stale && s.status === 'available' ? 'available' : ''}`,
      );
      el.append(
        node('h3', s.name),
        node(
          'div',
          stockNames[s.status],
          `stock ${s.status === 'UNKNOWN' ? 'unknown' : !stale && s.status === 'available' ? 'available' : ''}`,
        ),
        node('p', s.description, 'fine'),
        node('p', date(s.checkedAt) || '尚未查询', 'fine'),
      );
      if (r.paused) {
        el.append(node('p', '已暂停 · 结果已过期', 'stale'));
      }
      if (s.status === 'UNKNOWN' && s.lastValid) {
        el.append(
          node(
            'p',
            `上次有效：${stockNames[s.lastValid.status]} · ${date(s.lastValid.checkedAt)}（已过期）`,
            'stale',
          ),
        );
      }
      if (!stale && s.status === 'available') {
        const link = node('a', '前往购买 ↗', 'text-link');
        link.href = data.product.url;
        link.target = '_blank';
        link.rel = 'noopener';
        el.append(link);
      }
      return el;
    }),
  );

  for (const name of ['bark', 'irm']) {
    const channel = r[name];
    setText($(`#${name}-state`), channelStateName(channel, data.serverTime));
    setText(
      $(`#${name}-at`),
      channel.legacyPaused
        ? '旧版遗留暂停：确认服务侧限流已解除后，使用下方清理按钮恢复。'
        : channel.notBefore > data.serverTime
          ? `渠道冷却至 ${date(channel.notBefore)}`
          : channel.attemptedAt
            ? `最近尝试：${date(channel.attemptedAt)}`
            : '尚未发送',
    );
  }

  $('#test-bark').disabled = !c.barkConfigured;
  $('#test-irm').disabled = !c.irmEnabled;
  // Legacy recovery also restores a channel that has no groups left to clear.
  const cleanupReady =
    r.irm.legacyPaused || (r.irm.pendingGroups > 0 && !(r.irm.notBefore > data.serverTime));
  $('#cleanup-irm').disabled = !r.paused || !cleanupReady;
  setText(
    $('#irm-description'),
    c.irmEnabled
      ? '每轮有货时汇总门店，请求一通电话。'
      : '电话尚未启用。接收者、路由与电话规则在 Grafana 中管理。',
  );

  renderEvents();

  // Rebuilding the form on every push would close an open dropdown.
  if (!dirty) {
    if (populatedSettings !== JSON.stringify(c)) {
      populate(c);
    }
  } else if (formVersion !== c.version) {
    setText(
      $('#save-message'),
      `服务端已是第 ${c.version} 版。当前编辑内容仍保留；重新载入后再保存。`,
    );
  }

  {
    const known = new Set([...$('#history-store').options].map((o) => o.value));
    for (const [id, name] of Object.entries(c.catalog).filter(([id]) => !known.has(id))) {
      const option = node('option', name);
      option.value = id;
      $('#history-store').append(option);
    }
  }

  const key = `${r.lastAttempt}:${r.round}:${r.phase}`;
  if (historyKey !== key) {
    historyKey = key;
    void loadHistory();
  }
  tick();
}

async function loadHistory() {
  const request = ++historyRequest;
  setText($('#history-message'), '正在读取记录…');
  $('#history-prev').disabled = true;
  $('#history-next').disabled = true;
  const params = new URLSearchParams({
    days: $('#history-days').value,
    store: $('#history-store').value,
    outcome: $('#history-outcome').value,
    available: historyAvailable ? '1' : '0',
  });
  if (historyCursors.at(-1)) {
    params.set('cursor', historyCursors.at(-1));
  }
  try {
    const data = await api(`/api/history?${params}`);
    if (request !== historyRequest) {
      return;
    }
    historyNext = data.nextCursor;
    setText(
      $('#history-coverage'),
      `完整查询历史从 ${historyDate(data.historyStartedAt)} 开始，保留最近 ${data.retentionDays} 天，有货轮次永久保留。`,
    );
    setText($('#history-total'), data.summary.total.toLocaleString(language));
    setText($('#history-available'), data.summary.availableRounds.toLocaleString(language));
    setText($('#history-unknown'), data.summary.unknownRounds.toLocaleString(language));
    $('#history-stock-summary').hidden = !historyAvailable;
    $('#history-stock-summary').replaceChildren(
      ...data.summary.byStore.map((s) => {
        const card = node('article');
        card.append(
          node('h3', s.name),
          node('strong', `${s.count} 次有货查询`),
          node('p', `首次记录：${historyDate(s.firstAt)}`, 'fine'),
          node('p', `最近记录：${historyDate(s.lastAt)}`, 'fine'),
        );
        return card;
      }),
    );
    const open = new Set(
      [...document.querySelectorAll('.query-row[open]')].map((e) => e.dataset.id),
    );
    $('#history-list').replaceChildren(
      ...data.items.map((q) => {
        const row = node('details', undefined, 'query-row');
        row.dataset.id = q.id;
        row.open = open.has(q.id);
        const summary = node('summary');
        const time = node('div');
        time.append(
          node('time', historyDate(q.startedAt)),
          node(
            'div',
            q.finishedAt
              ? `完成 ${historyDate(q.finishedAt)} · ${Math.max(0, (q.finishedAt - q.startedAt) / 1000).toFixed(1)} 秒`
              : '等待本轮结果',
            'fine',
          ),
        );
        const available = q.stores.filter((s) => s.status === 'available');
        const unknown = q.stores.filter((s) => s.status === 'UNKNOWN');
        summary.append(
          time,
          node(
            'span',
            available.length ? '曾有货' : outcomeNames[q.outcome],
            `result-badge ${available.length ? 'has-stock' : q.outcome === 'complete' ? '' : 'uncertain'}`,
          ),
          node(
            'div',
            available.length
              ? available.map((s) => s.name).join(language === 'en' ? ', ' : '、')
              : q.outcome === 'checking'
                ? '正在查询门店库存'
                : unknown.length
                  ? `${unknown.length} 家未知 · ${q.stores.length - unknown.length} 家有效`
                  : `${q.stores.length} 家均无货`,
            available.length ? 'available-names' : '',
          ),
          node('span', `ZIP ${q.config.zip} · 第 ${q.config.version} 版`, 'fine'),
        );
        const detail = node('div', undefined, 'query-detail');
        detail.append(node('p', q.config.product.name, 'fine'));
        if (q.source === 'snapshot') {
          detail.append(node('p', '从更新前最近一次完整结果恢复的记录。', 'fine'));
        }
        if (q.superseded) {
          detail.append(
            node('p', '本轮进行时设置发生变化，结果仅存历史，未用于新配置或库存通知。', 'stale'),
          );
        }
        if (q.error) {
          detail.append(node('p', q.error, 'stale'));
        }
        if (q.diagnostics) {
          const d = q.diagnostics;
          const log = node('details', undefined, 'query-diagnostics');
          log.open = !!q.error;
          log.append(
            node(
              'summary',
              `执行步骤与网络异常（${d.network.length} 条${d.droppedNetworkErrors ? `，另有 ${d.droppedNetworkErrors} 条已省略` : ''}）`,
            ),
          );
          if (d.failedStep) {
            log.append(
              node(
                'p',
                `失败步骤：${d.failedStep} · ${d.errorType || 'Error'} · 本步 ${((d.steps.at(-1)?.durationMs || 0) / 1000).toFixed(1)} 秒`,
                'stale',
              ),
            );
          }
          const steps = node('ol');
          for (const s of d.steps) {
            steps.append(
              node(
                'li',
                `${historyDate(s.at)} · ${s.step} · ${(s.durationMs / 1000).toFixed(2)} 秒`,
              ),
            );
          }
          log.append(steps);
          if (d.page) {
            log.append(
              node(
                'p',
                `失败时页面：${d.page.readyState} · 可见弹窗 ${d.page.visibleDialogs} 个 · 取货入口 ${d.page.pickupButtons.length} 个（可见 ${d.page.pickupButtons.filter((b) => b.visible).length} 个）`,
                'fine',
              ),
            );
          }
          if (d.network.length) {
            log.append(node('p', '网络异常可能包含非关键资源，请结合失败步骤判断。', 'fine'));
            const network = node('ul');
            for (const n of d.network) {
              network.append(
                node(
                  'li',
                  `${historyDate(n.at)} · ${t(n.step)} · ${n.resourceType} · ${n.method} ${n.url} · ${n.kind === 'http' ? `HTTP ${n.status}` : n.error}`,
                ),
              );
            }
            log.append(network);
          } else {
            log.append(node('p', '本轮未捕获到相关网络错误。', 'fine'));
          }
          detail.append(log);
        }
        const results = node('ul');
        for (const s of q.stores) {
          const item = node('li');
          const heading = node('div', undefined, 'query-store-heading');
          heading.append(
            node('strong', s.name),
            node(
              'span',
              stockNames[s.status],
              `result-badge ${s.status === 'available' ? 'has-stock' : s.status === 'UNKNOWN' ? 'uncertain' : ''}`,
            ),
          );
          item.append(
            heading,
            node(
              'p',
              `${historyDate(s.checkedAt)} · ${t(s.description || (q.outcome === 'checking' ? '查询中' : '未提供说明'))}`,
              'fine',
            ),
          );
          results.append(item);
        }
        detail.append(results);
        row.append(summary, detail);
        return row;
      }),
    );
    setText(
      $('#history-message'),
      data.items.length
        ? '点击任一轮次，查看各门店结果和记录时间。'
        : historyAvailable
          ? '所选范围没有记录到有货。'
          : '所选范围暂无查询记录。',
    );
    setText(
      $('#history-page'),
      `第 ${historyCursors.length} 页 · 本页 ${data.items.length} / 共 ${data.total.toLocaleString(language)} 轮`,
    );
    $('#history-prev').disabled = historyCursors.length === 1;
    $('#history-next').disabled = !historyNext;
  } catch (e) {
    if (request === historyRequest) {
      setText($('#history-message'), `历史记录读取失败：${e.message}。请刷新重试。`);
    }
  }
}

const eventFilters = {
  '': () => true,
  stock: (e) => e.keep,
  notify: (e) => ['bark', 'irm'].includes(e.type),
  error: (e) => e.type === 'error',
  nonquery: (e) => e.type !== 'query',
};
let olderEvents = [];
let eventsDone = false;
let eventsLoading = false;
let eventsRequest = 0;

function eventOrder(a, b) {
  return (b.seq ?? Infinity) - (a.seq ?? Infinity) || b.at - a.at;
}

// Live events come from the status stream; older pages accumulate below them.
function shownEvents() {
  const filter = eventFilters[$('#event-filter').value];
  const live = (state?.events || []).filter(filter);
  const seen = new Set();
  const items = [];
  for (const e of [...live, ...olderEvents]) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      items.push(e);
    }
  }
  return items.sort(eventOrder);
}

function renderEvents() {
  const items = shownEvents();
  $('#events').replaceChildren(
    ...items.map((e) => {
      const el = node('li', undefined, e.keep ? 'kept' : '');
      el.append(node('time', date(e.at)), node('div', e.message));
      if (e.diagnostic) {
        const a = node('a', '查看本轮失败截图 ↗');
        a.href = `/api/diagnostics/${e.diagnostic}`;
        a.target = '_blank';
        a.rel = 'noopener';
        el.append(a);
      }
      return el;
    }),
  );
  $('#events-more').disabled = eventsLoading || eventsDone;
  if (eventsLoading) {
    setText($('#events-message'), '正在读取更早事件…');
  } else if (eventsDone) {
    setText($('#events-message'), items.length ? '没有更早事件。' : '没有符合条件的事件。');
  } else {
    setText($('#events-message'), '');
  }
}

async function loadOlderEvents() {
  const request = ++eventsRequest;
  const type = $('#event-filter').value;
  // Freeze what is shown so events leaving the live window are not lost.
  const shown = shownEvents();
  const seqs = [...(state?.events || []), ...olderEvents]
    .map((e) => e.seq)
    .filter((seq) => seq !== undefined);
  const params = new URLSearchParams({ type });
  if (seqs.length) {
    params.set('before', String(Math.min(...seqs)));
  }
  eventsLoading = true;
  renderEvents();
  try {
    const data = await api(`/api/event-log?${params}`);
    if (request !== eventsRequest) {
      return;
    }
    olderEvents = [...shown, ...data.items];
    eventsDone = !data.nextCursor;
  } catch (e) {
    if (request === eventsRequest) {
      toast(e.message);
    }
  } finally {
    if (request === eventsRequest) {
      eventsLoading = false;
      renderEvents();
    }
  }
}

$('#events-more').onclick = () => void loadOlderEvents();
$('#event-filter').onchange = () => {
  eventsRequest++;
  olderEvents = [];
  eventsDone = false;
  eventsLoading = false;
  renderEvents();
  if (shownEvents().length < 20) {
    void loadOlderEvents();
  }
};

function resetHistory() {
  historyCursors = [null];
  void loadHistory();
}

for (const id of ['history-days', 'history-store', 'history-outcome']) {
  $(`#${id}`).onchange = resetHistory;
}
for (const [id, available] of [
  ['history-all', false],
  ['history-stock', true],
]) {
  $(`#${id}`).onclick = () => {
    historyAvailable = available;
    for (const [tab, pressed] of [
      ['history-all', !available],
      ['history-stock', available],
    ]) {
      $(`#${tab}`).classList.toggle('primary', pressed);
      $(`#${tab}`).setAttribute('aria-pressed', String(pressed));
    }
    resetHistory();
  };
}
$('#history-refresh').onclick = () => void loadHistory();
$('#history-prev').onclick = () => {
  if (historyCursors.length > 1) {
    historyCursors.pop();
    void loadHistory();
  }
};
$('#history-next').onclick = () => {
  if (historyNext) {
    historyCursors.push(historyNext);
    void loadHistory();
  }
};

function tick() {
  if (!state) {
    return;
  }
  if (Date.now() - received > 45000) {
    setText($('#connection'), '● 状态连接中断');
    setText($('#countdown'), '—');
    setText($('#next-label'), '等待重新连接');
    setText($('#phase'), '运行状态待核实');
    return;
  }
  const r = state.runtime;
  if (r.paused) {
    setText($('#countdown'), '—');
    setText($('#next-label'), '恢复后重新查询');
  } else if (r.phase === 'checking') {
    setText($('#countdown'), '查询中');
    setText($('#next-label'), '正在核对页面与库存');
  } else {
    const n = Math.max(0, (r.nextAt - Date.now() - offset) / 1000);
    setText($('#countdown'), `${n.toFixed(1)}s`);
    setText($('#next-label'), '距下一次查询');
  }
}

async function control(action, button) {
  button.disabled = true;
  try {
    const result = await api('/api/control', { method: 'POST', body: JSON.stringify({ action }) });
    if (action === 'query') {
      const messages = {
        started: '已开始查询，请等待本轮结果。',
        busy: '正在查询中，请等待本轮结果。',
        scheduled: `已安排查询，约 ${Math.max(0, Math.ceil((result.runtime.nextAt - result.serverTime) / 1000))} 秒后（${date(result.runtime.nextAt)}）。`,
      };
      toast(messages[result.queryStatus]);
    } else {
      toast(action.startsWith('test') ? '测试请求已完成，请查看渠道状态与设备。' : '操作已保存。');
    }
  } catch (e) {
    toast(e.message);
  } finally {
    button.disabled = false;
  }
}

$('#toggle').onclick = (e) => control(state.runtime.paused ? 'resume' : 'pause', e.target);
$('#query').onclick = (e) => control('query', e.target);
$('#test-bark').onclick = (e) => {
  if (confirm(t('发送一条 Bark 测试通知？'))) {
    control('test-bark', e.target);
  }
};
$('#test-irm').onclick = (e) => {
  if (confirm(t('这会立即请求拨打一通测试电话。继续？'))) {
    control('test-irm', e.target);
  }
};
$('#cleanup-irm').onclick = (e) => {
  const legacy = state.runtime.irm.legacyPaused;
  if (
    confirm(
      t(
        legacy
          ? '旧版没有保留原重试截止时间。请先确认 Grafana 的限流已解除；继续将恢复电话渠道并清理旧分组，监控仍保持暂停。'
          : '请先确认测试电话已发出；清理分组可能撤回尚未拨出的通知。继续清理？监控仍保持暂停。',
      ),
    )
  ) {
    control(legacy ? 'recover-irm' : 'cleanup-irm', e.target);
  }
};
form.addEventListener('input', () => {
  dirty = true;
  setText($('#save-message'), '有尚未保存的修改。');
});
$('#reload-settings').onclick = async () => {
  try {
    populate(await api('/api/settings'));
    setText($('#save-message'), '已载入服务端设置。');
  } catch (e) {
    toast(e.message);
  }
};
form.onsubmit = async (e) => {
  e.preventDefault();
  const values = new FormData(form);
  if (values.getAll('stores').length === 0) {
    setText($('#save-message'), '请至少选择一家门店。');
    return;
  }
  if (discoveredTarget !== targetKey(targetInput())) {
    setText($('#save-message'), '商品或邮编已变化，请重新读取附近门店。');
    return;
  }
  const input = {
    version: formVersion,
    ...targetInput(),
    catalog,
    stores: values.getAll('stores'),
    barkGroup: values.get('barkGroup'),
    barkTtl: Number(values.get('barkTtl')),
  };
  for (const k of ['normalMin', 'normalMax', 'retryMin', 'retryMax']) {
    input[k] = Math.round(Number(values.get(k)) * 1000);
  }
  for (const k of ['barkEnabled', 'irmEnabled']) {
    input[k] = values.get(k) === 'on';
  }
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const saved = await api('/api/settings', { method: 'PUT', body: JSON.stringify(input) });
    populate(saved);
    setText($('#save-message'), `已保存，第 ${saved.version} 版。`);
  } catch (e) {
    setText($('#save-message'), e.message);
  } finally {
    button.disabled = false;
  }
};
const stream = new EventSource('/api/events');
stream.onmessage = (e) => render(JSON.parse(e.data));
stream.onerror = () => {
  setText($('#connection'), '● 正在重新连接');
};
setInterval(tick, 200);

(async () => {
  try {
    const initial = await api('/api/status');
    if (!state) {
      render(initial);
    }
  } catch (e) {
    if (!state) {
      toast(e.message);
    }
  }
})();

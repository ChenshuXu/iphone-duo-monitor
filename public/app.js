const $ = s => document.querySelector(s), form = $('#settings');
let state, formVersion, dirty = false, received = 0, offset = 0, catalog = {}, discoveredTarget = null;
let historyAvailable = false, historyCursors = [null], historyNext = null, historyRequest = 0, historyKey;
const outcomeNames = { checking: '查询中', complete: '结果完整', partial: '部分未知', failed: '查询失败', interrupted: '查询中断' };
const historyDate = n => n ? new Date(n).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';
const phaseNames = { paused: '已暂停', waiting: '监控中', checking: '正在查询', retrying: '等待重试', attention: '需要处理' };
const stockNames = { available: '可取货', unavailable: '无货', UNKNOWN: '未知' };
const channelNames = { disabled: '已停用', pending: '待发送', accepted: '服务已接受', failed: '发送失败', cooldown: '冷却中', paused: '需要处理' };
const date = n => n ? new Date(n).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }) : null;
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败'); return data;
}
function toast(message) { $('#operation-message').textContent = message; $('#operation-message').hidden = false; }
function targetInput() { return Object.fromEntries(['zip', 'color', 'capacity', 'carrier'].map(k => [k, form.elements[k].value])); }
function targetKey(c) { return JSON.stringify([c.zip, c.color, c.capacity, c.carrier]); }
function renderStoreOptions(selected = []) {
  $('#store-options').replaceChildren(...Object.entries(catalog).map(([id, name]) => {
    const label = node('label', undefined, 'check'), input = node('input'); input.type = 'checkbox'; input.name = 'stores'; input.value = id; input.checked = selected.includes(id); label.append(input, document.createTextNode(name)); return label;
  }));
}
$('#discover').onclick = async e => {
  const button = e.target, target = targetInput(); button.disabled = true;
  $('#discover-message').textContent = '正在打开 Apple 页面读取门店，可能需要几分钟…';
  try {
    const data = await api('/api/discover', { method: 'POST', body: JSON.stringify(target) });
    if (targetKey(targetInput()) !== targetKey(target)) { $('#discover-message').textContent = '读取期间商品或邮编变化，请重新读取。'; return; }
    catalog = data.catalog; discoveredTarget = targetKey(target); renderStoreOptions(); dirty = true;
    $('#discover-message').textContent = `已读取 ${Object.keys(catalog).length} 家附近门店，请勾选要监控的门店并保存。`;
  } catch (error) { $('#discover-message').textContent = error.message; }
  finally { button.disabled = false; }
};
function populate(c) {
  formVersion = c.version;
  for (const [key, options] of Object.entries({ color: c.options.colors, capacity: c.options.capacities, carrier: c.options.carriers })) {
    form.elements[key].replaceChildren(...Object.entries(options).map(([value, data]) => { const o = node('option', typeof data === 'string' ? data : data.name); o.value = value; return o; }));
  }
  catalog = c.catalog; discoveredTarget = targetKey(c);
  for (const k of ['zip', 'color', 'capacity', 'carrier', 'barkGroup', 'barkTtl']) form.elements[k].value = c[k];
  for (const k of ['normalMin', 'normalMax', 'retryMin', 'retryMax']) form.elements[k].value = c[k] / 1000;
  for (const k of ['barkEnabled', 'irmEnabled']) form.elements[k].checked = c[k];
  for (const k of ['barkKey', 'irmWebhook']) form.elements[k].value = '';
  for (const k of ['clear_barkKey', 'clear_irmWebhook']) form.elements[k].checked = false;
  renderStoreOptions(c.stores);
  for (const k of ['irmEnabled', 'irmWebhook', 'clear_irmWebhook']) form.elements[k].disabled = !c.irmReady;
  $('#irm-help').textContent = c.irmReady ? '固定 Grafana 域名已配置。接收者、路由与电话规则在 Grafana 中管理。' : '先按项目说明设置 Grafana 接收域名并重新启动容器，再填写 Webhook。';
  dirty = false; $('#version').textContent = `第 ${c.version} 版`;
}
function render(data) {
  state = data; received = Date.now(); offset = data.serverTime - received;
  const r = data.runtime, c = data.config;
  $('#connection').textContent = '● 已连接'; $('#phase').textContent = phaseNames[r.phase] || r.phase;
  $('#product-link').href = data.product.url; $('#product-name').textContent = data.product.name;
  $('#last-attempt').textContent = date(r.lastAttempt) || '尚未查询'; $('#last-success').textContent = date(r.lastComplete) || '尚未成功';
  $('#target').textContent = `${c.zip} · ${c.stores.length} 家门店 · 第 ${c.version} 版`;
  $('#toggle').disabled = false; $('#toggle').textContent = r.paused ? '恢复监控' : '暂停监控'; $('#query').disabled = r.paused;
  $('#inventory-note').textContent = r.paused ? '库存已停止更新' : `本轮配置：${r.configVersion ? `第 ${r.configVersion} 版` : '尚未查询'}`;
  $('#stores').replaceChildren(...r.stores.map(s => {
    const stale = r.paused || s.status === 'UNKNOWN';
    const el = node('article', undefined, `store ${!stale && s.status === 'available' ? 'available' : ''}`);
    el.append(node('h3', s.name), node('div', stockNames[s.status], `stock ${s.status === 'UNKNOWN' ? 'unknown' : !stale && s.status === 'available' ? 'available' : ''}`), node('p', s.description, 'fine'), node('p', date(s.checkedAt) || '尚未查询', 'fine'));
    if (r.paused) el.append(node('p', '已暂停 · 结果已过期', 'stale'));
    if (s.status === 'UNKNOWN' && s.lastValid) el.append(node('p', `上次有效：${stockNames[s.lastValid.status]} · ${date(s.lastValid.checkedAt)}（已过期）`, 'stale'));
    if (!stale && s.status === 'available') { const link = node('a', '前往购买 ↗', 'text-link'); link.href = data.product.url; link.target = '_blank'; link.rel = 'noopener'; el.append(link); }
    return el;
  }));
  for (const name of ['bark', 'irm']) {
    const channel = r[name]; $(`#${name}-state`).textContent = !channel.configured ? '未配置' : channelNames[channel.state] || '等待下一轮';
    $(`#${name}-at`).textContent = channel.attemptedAt ? `最近尝试：${date(channel.attemptedAt)}${channel.notBefore > data.serverTime ? ' · 渠道冷却中' : ''}` : '尚未发送';
  }
  $('#test-bark').disabled = !c.barkConfigured; $('#test-irm').disabled = !c.irmEnabled;
  $('#irm-description').textContent = c.irmEnabled ? '每轮有货时汇总门店，请求一通电话。服务接受请求不代表电话已接通。' : '电话尚未启用。接收者、路由与电话规则在 Grafana 中管理。';
  $('#events').replaceChildren(...data.events.map(e => {
    const el = node('li'); el.append(node('time', date(e.at)), node('div', e.message));
    if (e.diagnostic) { const a = node('a', '查看本轮失败截图 ↗'); a.href = `/api/diagnostics/${e.diagnostic}`; a.target = '_blank'; a.rel = 'noopener'; el.append(a); }
    return el;
  }));
  if (!dirty) populate(c); else if (formVersion !== c.version) $('#save-message').textContent = `服务端已是第 ${c.version} 版。当前编辑内容仍保留；重新载入后再保存。`;
  {
    const known = new Set([...$('#history-store').options].map(o => o.value));
    for (const [id, name] of Object.entries(c.catalog).filter(([id]) => !known.has(id))) { const option = node('option', name); option.value = id; $('#history-store').append(option); }
  }
  const key = `${r.lastAttempt}:${r.round}:${r.phase}`;
  if (historyKey !== key) { historyKey = key; void loadHistory(); }
  tick();
}
async function loadHistory() {
  const request = ++historyRequest;
  $('#history-message').textContent = '正在读取记录…';
  $('#history-prev').disabled = true; $('#history-next').disabled = true;
  const params = new URLSearchParams({ days: $('#history-days').value, store: $('#history-store').value, outcome: $('#history-outcome').value, available: historyAvailable ? '1' : '0' });
  if (historyCursors.at(-1)) params.set('cursor', historyCursors.at(-1));
  try {
    const data = await api(`/api/history?${params}`);
    if (request !== historyRequest) return;
    historyNext = data.nextCursor;
    $('#history-coverage').textContent = `完整查询历史从 ${historyDate(data.historyStartedAt)} 开始，保留最近 ${data.retentionDays} 天。更早仅保留迁移时可恢复的最近一次结果；未知时段不代表无货。`;
    $('#history-total').textContent = data.summary.total.toLocaleString();
    $('#history-available').textContent = data.summary.availableRounds.toLocaleString();
    $('#history-unknown').textContent = data.summary.unknownRounds.toLocaleString();
    $('#history-stock-summary').hidden = !historyAvailable;
    $('#history-stock-summary').replaceChildren(...data.summary.byStore.map(s => {
      const card = node('article'); card.append(node('h3', s.name), node('strong', `${s.count} 次有货查询`), node('p', `首次记录：${historyDate(s.firstAt)}`, 'fine'), node('p', `最近记录：${historyDate(s.lastAt)}`, 'fine')); return card;
    }));
    const open = new Set([...document.querySelectorAll('.query-row[open]')].map(e => e.dataset.id));
    $('#history-list').replaceChildren(...data.items.map(q => {
      const row = node('details', undefined, 'query-row'); row.dataset.id = q.id; row.open = open.has(q.id);
      const summary = node('summary'), time = node('div'); time.append(node('time', historyDate(q.startedAt)), node('div', q.finishedAt ? `完成 ${historyDate(q.finishedAt)} · ${Math.max(0, (q.finishedAt - q.startedAt) / 1000).toFixed(1)} 秒` : '等待本轮结果', 'fine'));
      const available = q.stores.filter(s => s.status === 'available'), unknown = q.stores.filter(s => s.status === 'UNKNOWN');
      summary.append(time, node('span', available.length ? '曾有货' : outcomeNames[q.outcome], `result-badge ${available.length ? 'has-stock' : q.outcome === 'complete' ? '' : 'uncertain'}`), node('div', available.length ? available.map(s => s.name).join('、') : q.outcome === 'checking' ? '正在查询门店库存' : unknown.length ? `${unknown.length} 家未知 · ${q.stores.length - unknown.length} 家有效` : `${q.stores.length} 家均无货`, available.length ? 'available-names' : ''), node('span', `ZIP ${q.config.zip} · 第 ${q.config.version} 版`, 'fine'));
      const detail = node('div', undefined, 'query-detail'); detail.append(node('p', q.config.product.name, 'fine'));
      if (q.source === 'snapshot') detail.append(node('p', '从更新前最近一次完整结果恢复的记录。', 'fine'));
      if (q.superseded) detail.append(node('p', '本轮进行时设置发生变化，结果仅存历史，未用于新配置或库存通知。', 'stale'));
      if (q.error) detail.append(node('p', q.error, 'stale'));
      const results = node('ul');
      for (const s of q.stores) {
        const item = node('li'), heading = node('div', undefined, 'query-store-heading'); heading.append(node('strong', s.name), node('span', stockNames[s.status], `result-badge ${s.status === 'available' ? 'has-stock' : s.status === 'UNKNOWN' ? 'uncertain' : ''}`));
        item.append(heading, node('p', `${historyDate(s.checkedAt)} · ${s.description || (q.outcome === 'checking' ? '查询中' : '未提供说明')}`, 'fine')); results.append(item);
      }
      detail.append(results); row.append(summary, detail); return row;
    }));
    $('#history-message').textContent = data.items.length ? '点击任一轮次，查看各门店结果和记录时间。' : historyAvailable ? '所选范围没有记录到有货。未查询或未知时段不代表无货。' : '所选范围暂无查询记录。';
    $('#history-page').textContent = `第 ${historyCursors.length} 页 · 本页 ${data.items.length} / 共 ${data.total.toLocaleString()} 轮`;
    $('#history-prev').disabled = historyCursors.length === 1; $('#history-next').disabled = !historyNext;
  } catch (e) { if (request === historyRequest) $('#history-message').textContent = `历史记录读取失败：${e.message}。请刷新重试。`; }
}
function resetHistory() { historyCursors = [null]; void loadHistory(); }
for (const id of ['history-days', 'history-store', 'history-outcome']) $(`#${id}`).onchange = resetHistory;
for (const [id, available] of [['history-all', false], ['history-stock', true]]) $(`#${id}`).onclick = () => {
  historyAvailable = available;
  for (const [tab, pressed] of [['history-all', !available], ['history-stock', available]]) { $(`#${tab}`).classList.toggle('primary', pressed); $(`#${tab}`).setAttribute('aria-pressed', String(pressed)); }
  resetHistory();
};
$('#history-refresh').onclick = () => void loadHistory();
$('#history-prev').onclick = () => { if (historyCursors.length > 1) { historyCursors.pop(); void loadHistory(); } };
$('#history-next').onclick = () => { if (historyNext) { historyCursors.push(historyNext); void loadHistory(); } };
function tick() {
  if (!state) return;
  if (Date.now() - received > 45000) { $('#connection').textContent = '● 状态连接中断'; $('#countdown').textContent = '—'; $('#next-label').textContent = '等待重新连接'; $('#phase').textContent = '运行状态待核实'; return; }
  const r = state.runtime;
  if (r.paused) { $('#countdown').textContent = '—'; $('#next-label').textContent = '恢复后重新查询'; }
  else if (r.phase === 'checking') { $('#countdown').textContent = '查询中'; $('#next-label').textContent = '正在核对页面与库存'; }
  else { const n = Math.max(0, (r.nextAt - Date.now() - offset) / 1000); $('#countdown').textContent = `${n.toFixed(1)}s`; $('#next-label').textContent = '距下一次查询'; }
}
async function control(action, button) {
  button.disabled = true;
  try { await api('/api/control', { method: 'POST', body: JSON.stringify({ action }) }); toast(action.startsWith('test') ? '测试请求已完成，请查看渠道状态与设备。' : '操作已保存。'); }
  catch (e) { toast(e.message); }
  finally { button.disabled = false; }
}
$('#toggle').onclick = e => control(state.runtime.paused ? 'resume' : 'pause', e.target);
$('#query').onclick = e => control('query', e.target);
$('#test-bark').onclick = e => { if (confirm('发送一条标明“测试”的 Bark 普通通知？此操作不会改变库存状态。')) control('test-bark', e.target); };
$('#test-irm').onclick = e => { if (confirm('这会立即请求拨打一通测试电话。继续？')) control('test-irm', e.target); };
form.addEventListener('input', () => { dirty = true; $('#save-message').textContent = '有尚未保存的修改。'; });
$('#reload-settings').onclick = async () => { try { populate(await api('/api/settings')); $('#save-message').textContent = '已载入服务端设置。'; } catch (e) { toast(e.message); } };
form.onsubmit = async e => {
  e.preventDefault(); const values = new FormData(form);
  if (values.getAll('stores').length === 0) { $('#save-message').textContent = '请至少选择一家门店。'; return; }
  if (discoveredTarget !== targetKey(targetInput())) { $('#save-message').textContent = '商品或邮编已变化，请重新读取附近门店。'; return; }
  const input = { version: formVersion, ...targetInput(), catalog, stores: values.getAll('stores'), barkGroup: values.get('barkGroup'), barkTtl: Number(values.get('barkTtl')) };
  for (const k of ['normalMin', 'normalMax', 'retryMin', 'retryMax']) input[k] = Math.round(Number(values.get(k)) * 1000);
  for (const k of ['barkEnabled', 'irmEnabled', 'clear_barkKey', 'clear_irmWebhook']) input[k] = values.get(k) === 'on';
  for (const k of ['barkKey', 'irmWebhook']) input[k] = values.get(k) || '';
  const button = form.querySelector('button[type=submit]'); button.disabled = true;
  try { const saved = await api('/api/settings', { method: 'PUT', body: JSON.stringify(input) }); populate(saved); $('#save-message').textContent = `已保存，第 ${saved.version} 版。`; }
  catch (e) { $('#save-message').textContent = e.message; }
  finally { button.disabled = false; }
};
(async () => {
  try {
    render(await api('/api/status'));
    const stream = new EventSource('/api/events');
    stream.onmessage = e => render(JSON.parse(e.data));
    stream.onopen = async () => { try { render(await api('/api/status')); } catch (e) { toast(e.message); } };
    stream.onerror = () => { $('#connection').textContent = '● 正在重新连接'; };
    setInterval(tick, 200);
  } catch (e) { toast(e.message); }
})();

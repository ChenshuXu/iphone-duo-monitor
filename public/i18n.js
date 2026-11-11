(() => {
  const english = {
    语言: 'Language',
    'iPhone Duo · 取货监控': 'iPhone Duo · Pickup monitor',
    正在连接: 'Connecting',
    '正在读取商品…': 'Loading product…',
    '查看购买页面 ↗': 'View purchase page ↗',
    正在读取状态: 'Loading status',
    下一次查询: 'Next query',
    上次尝试: 'Last attempt',
    尚未查询: 'Not queried yet',
    最近完整成功: 'Last complete success',
    尚未成功: 'No success yet',
    当前目标: 'Current target',
    加载中: 'Loading',
    请求查询: 'Request query',
    附近门店: 'Nearby stores',
    库存按监控周期更新: 'Inventory updates on the monitoring schedule',
    查询历史: 'Query history',
    '保留最近 60 天 · 有货记录永久保留': 'Last 60 days · Stock records kept permanently',
    全部记录: 'All records',
    '正在读取历史记录…': 'Loading query history…',
    查询轮次: 'Query rounds',
    出现有货的轮次: 'Rounds with stock',
    失败或结果不完整: 'Failed or incomplete',
    '按所选时间范围和门店汇总，有货次数按查询快照计数。时间使用浏览器所在时区。':
      'Summaries use the selected time range and store. Stock counts measure query snapshots. Times use your browser’s time zone.',
    历史视图: 'History view',
    全部查询: 'All queries',
    曾经有货: 'Previously available',
    时间范围: 'Time range',
    '最近 60 天': 'Last 60 days',
    '最近 30 天': 'Last 30 days',
    '最近 7 天': 'Last 7 days',
    '最近 24 小时': 'Last 24 hours',
    门店: 'Store',
    所有门店: 'All stores',
    查询结果: 'Outcome',
    全部结果: 'All outcomes',
    结果完整: 'Complete',
    部分未知: 'Partly unknown',
    查询失败: 'Failed',
    查询中断: 'Interrupted',
    查询中: 'Checking',
    刷新记录: 'Refresh history',
    查询记录列表: 'Query history list',
    上一页: 'Previous',
    '每页 50 轮': '50 rounds per page',
    下一页: 'Next',
    购买链接: 'Purchase link',
    '每轮明确有货时，按门店发送普通通知。':
      'Send an ordinary notification per available store each round.',
    尚未发送: 'Not sent yet',
    发送一次通知测试: 'Send one test notification',
    电话: 'Phone calls',
    待配置: 'Awaiting setup',
    '电话状态正在载入。': 'Loading phone status.',
    电话尚未启用: 'Phone calls disabled',
    拨打一通测试电话: 'Place one test call',
    清理电话分组: 'Clear phone alert groups',
    监控设置: 'Monitoring settings',
    '新设置在轮次边界生效。选择商品与邮编后，读取附近门店，再勾选至少一家。更换目标前请先暂停监控。':
      'Choose a product and ZIP code, discover nearby stores, and select at least one. Pause before changing targets; settings take effect between rounds.',
    美国邮编: 'US ZIP code',
    颜色: 'Color',
    容量: 'Capacity',
    运营商: 'Carrier',
    读取附近门店: 'Read nearby stores',
    '请填写邮编并选择商品，再读取门店。':
      'Enter a ZIP code and select a product, then read nearby stores.',
    监控门店: 'Monitored stores',
    '正常最短等待（秒）': 'Normal minimum wait (seconds)',
    '正常最长等待（秒）': 'Normal maximum wait (seconds)',
    '异常最短等待（秒）': 'Error minimum wait (seconds)',
    '异常最长等待（秒）': 'Error maximum wait (seconds)',
    '随机到毫秒并排除整秒。请求查询按最短间隔与服务端限流排期。':
      'Randomized to milliseconds, excluding whole seconds. Manual queries are scheduled around minimum waits and server rate limits.',
    'Bark 普通通知': 'Bark notifications',
    '启用 Bark': 'Enable Bark',
    '从 .env 读取 BARK_KEY。': 'Reads BARK_KEY from .env.',
    分组: 'Group',
    '历史保留（秒）': 'Message retention (seconds)',
    'Grafana IRM 电话': 'Grafana IRM phone calls',
    '等待配置后启用。': 'Configure credentials to enable.',
    启用电话: 'Enable phone calls',
    保存设置: 'Save settings',
    重新载入: 'Reload settings',
    '首次保存即确认选定门店；恢复监控是独立操作。':
      'Saving confirms the selected stores. Resume monitoring when ready.',
    最近事件: 'Recent events',
    '保留 30 天 · 有货相关永久保留': '30 days · Stock-related events kept permanently',
    事件类型: 'Event type',
    全部事件: 'All events',
    有货与提醒: 'Stock and alerts',
    通知发送: 'Notifications',
    错误: 'Errors',
    隐藏普通查询: 'Hide routine queries',
    加载更早事件: 'Load earlier events',
    '正在读取更早事件…': 'Loading earlier events…',
    '没有更早事件。': 'No earlier events.',
    '没有符合条件的事件。': 'No matching events.',
    '事件筛选条件无效。': 'Invalid event filter.',
    'Docker 独立运行 · 时间使用浏览器所在时区 · 购买后请暂停监控。':
      'Runs in Docker · Browser-local times · Pause after buying.',
    已暂停: 'Paused',
    监控中: 'Monitoring',
    正在查询: 'Checking',
    等待重试: 'Waiting to retry',
    需要处理: 'Needs attention',
    可取货: 'Available',
    无货: 'Unavailable',
    未知: 'Unknown',
    已停用: 'Disabled',
    等待下一轮: 'Waiting for next round',
    待发送: 'Pending',
    服务已接受: 'Service accepted',
    发送失败: 'Failed',
    冷却中: 'Cooling down',
    请求失败: 'Request failed',
    '正在打开 Apple 页面读取门店，可能需要几分钟…':
      'Reading stores from Apple; this may take a few minutes…',
    '读取期间商品或邮编变化，请重新读取。':
      'The product or ZIP changed during discovery. Read stores again.',
    '已读取 {count} 家附近门店，请勾选要监控的门店并保存。':
      'Found {count} nearby stores. Select stores and save.',
    'BARK_KEY 已从 .env 配置；更换后重新创建容器。':
      'BARK_KEY is configured in .env. Recreate the container after changing it.',
    '请在 .env 填写 BARK_KEY，再重新创建容器。':
      'Set BARK_KEY in .env, then recreate the container.',
    'Webhook 已从 .env 配置；接收者、路由和电话规则在 Grafana 中管理。':
      'Webhook configured in .env. Manage recipients, routing, and phone rules in Grafana.',
    '请在 .env 填写 GRAFANA_IRM_WEBHOOK，再重新创建容器。':
      'Set GRAFANA_IRM_WEBHOOK in .env, then recreate the container.',
    '第 {version} 版': 'Version {version}',
    '● 已连接': '● Connected',
    '{zip} · {count} 家门店 · 第 {version} 版': '{zip} · {count} stores · Version {version}',
    恢复监控: 'Resume monitoring',
    暂停监控: 'Pause monitoring',
    库存已停止更新: 'Inventory updates paused',
    '本轮配置：{version}': 'Current round: {version}',
    '已暂停 · 结果已过期': 'Paused · Results are stale',
    '上次有效：{status} · {time}（已过期）': 'Last valid: {status} · {time} (stale)',
    '前往购买 ↗': 'Buy on Apple ↗',
    未配置: 'Not configured',
    '旧版遗留暂停：确认服务侧限流已解除后，使用下方清理按钮恢复。':
      'Legacy pause: once the provider rate limit clears, use cleanup below to recover.',
    '渠道冷却至 {time}': 'Channel cooldown until {time}',
    '最近尝试：{time}': 'Last attempt: {time}',
    '每轮有货时汇总门店，请求一通电话。': 'Request one call per round with available stores.',
    '电话尚未启用。接收者、路由与电话规则在 Grafana 中管理。':
      'Phone calls disabled. Manage recipients, routing, and rules in Grafana.',
    '查看本轮失败截图 ↗': 'View failure screenshot ↗',
    '服务端已是第 {version} 版。当前编辑内容仍保留；重新载入后再保存。':
      'The server has version {version}. Your edits are retained; reload before saving.',
    '正在读取记录…': 'Loading records…',
    '完整查询历史从 {time} 开始，保留最近 {days} 天，有货轮次永久保留。更早仅保留迁移时可恢复的最近一次结果。':
      'Complete history starts at {time} and is retained for {days} days; rounds with stock are kept permanently. Older history includes only the latest recoverable snapshot.',
    '{count} 次有货查询': '{count} queries with stock',
    '首次记录：{time}': 'First recorded: {time}',
    '最近记录：{time}': 'Last recorded: {time}',
    '完成 {time} · {seconds} 秒': 'Finished {time} · {seconds} s',
    等待本轮结果: 'Waiting for this round',
    曾有货: 'Had stock',
    正在查询门店库存: 'Checking store inventory',
    '{unknown} 家未知 · {valid} 家有效': '{unknown} unknown · {valid} valid',
    '{count} 家均无货': 'All {count} stores unavailable',
    'ZIP {zip} · 第 {version} 版': 'ZIP {zip} · Version {version}',
    '从更新前最近一次完整结果恢复的记录。':
      'Recovered from the last complete result before the update.',
    '本轮进行时设置发生变化，结果仅存历史，未用于新配置或库存通知。':
      'Settings changed during this round. Results are kept in history without updating the new target or stock alerts.',
    '执行步骤与网络异常（{count} 条{more}）': 'Execution steps and network errors ({count}{more})',
    '，另有 {count} 条已省略': ', {count} more omitted',
    '失败步骤：{step} · {error} · 本步 {seconds} 秒': 'Failed step: {step} · {error} · {seconds} s',
    '{time} · {step} · {seconds} 秒': '{time} · {step} · {seconds} s',
    '失败时页面：{state} · 可见弹窗 {dialogs} 个 · 取货入口 {buttons} 个（可见 {visible} 个）':
      'Page at failure: {state} · {dialogs} visible dialogs · {buttons} pickup buttons ({visible} visible)',
    '网络异常可能包含非关键资源，请结合失败步骤判断。':
      'Network errors may include optional resources. Compare them with the failed step.',
    '本轮未捕获到相关网络错误。': 'No relevant network errors captured.',
    未提供说明: 'No description provided',
    '点击任一轮次，查看各门店结果和记录时间。':
      'Open a round to view store results and timestamps.',
    '所选范围没有记录到有货。': 'No stock recorded in this range.',
    '所选范围暂无查询记录。': 'No queries in the selected range.',
    '第 {page} 页 · 本页 {count} / 共 {total} 轮': 'Page {page} · {count} of {total} rounds',
    '历史记录读取失败：{error}。请刷新重试。': 'Could not load history: {error}. Refresh to retry.',
    '● 状态连接中断': '● Status connection lost',
    等待重新连接: 'Waiting to reconnect',
    运行状态待核实: 'Status unverified',
    恢复后重新查询: 'Queries resume when monitoring resumes',
    正在核对页面与库存: 'Verifying page and inventory',
    距下一次查询: 'Until next query',
    '已开始查询，请等待本轮结果。': 'Query started. Waiting for this round’s results.',
    '正在查询中，请等待本轮结果。': 'A query is running. Waiting for this round’s results.',
    '已安排查询，约 {seconds} 秒后（{time}）。':
      'Query scheduled in about {seconds} seconds ({time}).',
    '测试请求已完成，请查看渠道状态与设备。':
      'Test request completed. Check channel status and your device.',
    '操作已保存。': 'Operation saved.',
    '发送一条 Bark 测试通知？': 'Send one Bark test notification?',
    '这会立即请求拨打一通测试电话。继续？': 'Request a real test phone call now?',
    '旧版没有保留原重试截止时间。请先确认 Grafana 的限流已解除；继续将恢复电话渠道并清理旧分组，监控仍保持暂停。':
      'The old retry deadline was not saved. Confirm Grafana’s rate limit has cleared, then recover the phone channel and clear old groups? Monitoring stays paused.',
    '请先确认测试电话已发出；清理分组可能撤回尚未拨出的通知。继续清理？监控仍保持暂停。':
      'Confirm the test call was dispatched. Clear alert groups? This may withdraw pending calls; monitoring stays paused.',
    '有尚未保存的修改。': 'You have unsaved changes.',
    '已载入服务端设置。': 'Server settings loaded.',
    '请至少选择一家门店。': 'Select at least one store.',
    '商品或邮编已变化，请重新读取附近门店。': 'Product or ZIP changed. Read nearby stores again.',
    '已保存，第 {version} 版。': 'Saved version {version}.',
    '● 正在重新连接': '● Reconnecting',
    '仅接受 application/json。': 'Content-Type must be application/json.',
    '请求过大。': 'Request is too large.',
    '请求已中断。': 'The request was interrupted.',
    '请求地址无效。': 'Invalid request URL.',
    'JSON 对象格式错误。': 'A JSON object is required.',
    'JSON 格式错误。': 'Invalid JSON.',
    'Host 不匹配。': 'Host does not match PUBLIC_ORIGIN.',
    '方法不允许。': 'Method not allowed.',
    '来源校验失败。': 'Origin validation failed.',
    '请先暂停监控并等待当前查询结束。':
      'Pause monitoring and wait for the current query to finish.',
    'Apple 查询处于冷却，请稍后重试。': 'Apple queries are cooling down. Retry after the deadline.',
    '门店读取失败，请稍后重试。': 'Store discovery failed. Retry after cooldown.',
    '正在读取门店，请等待结束。': 'Store discovery is running. Wait for it to finish.',
    '诊断不存在。': 'Diagnostic not found.',
    '页面不存在。': 'Page not found.',
    '服务处理失败，请检查服务运行状态。':
      'The service could not process the request. Check its status.',
    '邮编必须为五位美国 ZIP code。': 'Enter a five-digit US ZIP code.',
    '商品选项 {option} 无效。': 'Invalid product option: {option}.',
    '设置已被其他页面修改，请重新载入后保存。':
      'Settings changed in another page. Reload before saving.',
    '通知凭据由 .env 管理，请修改 BARK_KEY / GRAFANA_IRM_WEBHOOK 后重新创建容器。':
      'Manage credentials in .env using BARK_KEY / GRAFANA_IRM_WEBHOOK, then recreate the container.',
    '请先读取该邮编的 Apple 门店。': 'Read Apple stores for this ZIP code first.',
    '请从门店目录中至少选择一家，且不能重复。':
      'Select at least one store from the discovered list, without duplicates.',
    '{min} / {max} 超出允许范围，须为整数毫秒且最小值小于最大值。':
      '{min} / {max} must be integer milliseconds within the allowed range, with minimum less than maximum.',
    '通知开关必须为布尔值。': 'Notification switches must be booleans.',
    'Bark 分组仅允许 1–64 位字母、数字、下划线和连字符。':
      'Bark group must contain 1–64 letters, digits, underscores, or hyphens.',
    'Bark TTL 必须为 1–86400 秒。': 'Bark TTL must be 1–86400 seconds.',
    '启用 Bark 前请在 .env 配置 BARK_KEY。': 'Set BARK_KEY in .env before enabling Bark.',
    '启用电话前请在 .env 配置 GRAFANA_IRM_WEBHOOK。':
      'Set GRAFANA_IRM_WEBHOOK in .env before enabling phone calls.',
    '历史查询筛选条件无效。': 'Invalid history filters.',
    '历史分页位置无效。': 'Invalid history cursor.',
    '请先保存并确认门店设置。': 'Save and confirm store settings first.',
    '请先恢复监控。': 'Resume monitoring first.',
    '服务正在停止，请稍后重试。': 'The service is stopping. Retry later.',
    '请先暂停监控，并等待当前查询或通知测试结束。':
      'Pause monitoring and wait for queries or notification tests to finish.',
    '此操作仅用于旧版遗留的电话永久暂停。':
      'This action is only for legacy permanent phone pauses.',
    '电话渠道仍在冷却，请等待截止时间后重试。':
      'Phone calls are cooling down. Retry after the deadline.',
    '电话分组清理失败，请检查渠道状态后重试。':
      'Phone group cleanup failed. Check channel status before retrying.',
    '已有通知测试正在进行。': 'A notification test is already running.',
    'Bark 尚未配置。': 'Bark is not configured.',
    'Bark 渠道仍在冷却，请稍后重试。': 'Bark is cooling down. Retry after the deadline.',
    '电话尚未启用；等待 Grafana 配置。': 'Phone calls are disabled. Complete Grafana setup first.',
    '电话渠道仍在冷却或暂停。': 'Phone calls are cooling down or paused.',
    '旧电话分组尚未清理。': 'Old phone alert groups still need cleanup.',
    '未知操作。': 'Unknown action.',
    '服务启动；旧库存待重新核验。': 'Service started; previous stock awaits a fresh check.',
    'Retry-After 要求超出已保存的等待范围，需要处理后恢复。':
      'Retry-After exceeds the configured wait range. Resolve the issue, then resume.',
    '已暂停监控。': 'Monitoring paused.',
    '已恢复监控；按正式间隔安排查询。': 'Monitoring resumed on the normal schedule.',
    '正在查询；不会并发增加查询。': 'A query is running; no additional query started.',
    '已请求查询；最短间隔或限流结束后立即执行。':
      'Query requested; starts when the minimum wait or rate limit ends.',
    '已手动开始查询。': 'Manual query started.',
    '设置已保存，第 {version} 版。': 'Settings saved, version {version}.',
    '{title}：Bark 服务已接受。': '{title}: Bark accepted the notification.',
    测试通知: 'Test notification',
    监控已暂停: 'Monitoring paused',
    电话渠道异常: 'Phone channel fault',
    'iPhone Duo 监控故障': 'iPhone Duo monitor fault',
    'iPhone Duo 监控恢复': 'iPhone Duo monitor recovered',
    '{title}：Bark 发送失败：{error}；Bark 渠道独立冷却。':
      '{title}: Bark failed: {error}. Bark is cooling down independently.',
    'Bark 发送失败：{error}；Bark 渠道独立冷却。':
      'Bark failed: {error}. Bark is cooling down independently.',
    网络错误或超时: 'Network error or timeout',
    '上一轮 IRM 分组已清理。': 'Previous IRM alert groups resolved.',
    'IRM 请求失败：{error}；电话渠道独立冷却。':
      'IRM request failed: {error}. Phone calls are cooling down independently.',
    'IRM 服务已接受分组，尚未确认电话接通。':
      'IRM accepted the group; phone receipt is unconfirmed.',
    '第 {version} 版查询结束，设置已变更；仅保留历史，不更新当前库存或通知。':
      'Version {version} query ended after settings changed. Results kept in history only.',
    '第 {version} 版查询完成：{available} 家可取货，{valid} 家有效。':
      'Version {version} query complete: {available} available, {valid} valid stores.',
    '查询失败：{error}，未知状态不是无货。':
      'Query failed: {error}. Unknown does not mean unavailable.',
    '查询失败：{error}，库存待确认。': 'Query failed: {error}. Stock status unknown.',
    部分门店未知: 'Some stores are unknown',
    '服务未返回有效 JSON': 'The service did not return valid JSON',
    服务未明确接受通知: 'The service did not confirm notification acceptance',
    '门店、商品或库存字段缺失或无法识别': 'Missing or unrecognized store, product, or stock fields',
    '服务中断，未取得完整查询结果。': 'Service interrupted before complete results were collected.',
    '浏览器查询失败，请查看诊断。': 'Browser query failed. Inspect diagnostics.',
    浏览器查询失败: 'Browser query failed',
    定位并点击取货入口: 'Find and click pickup entry',
    等待取货弹窗可见: 'Wait for pickup dialog',
    等待取货初始结果: 'Wait for initial pickup results',
    重新打开取货弹窗: 'Reopen pickup dialog',
    等待商品页面就绪: 'Wait for product page',
    '重新选择商品选项：{option}': 'Reselect product option: {option}',
    核对商品标题: 'Verify product title',
    '核对商品{option}': 'Verify product: {option}',
    等待页面邮编结果: 'Wait for ZIP results',
    等待页面目标商品: 'Wait for target product',
    '等待页面有货门店：{store}': 'Wait for available store: {store}',
    启动浏览器: 'Start browser',
    创建查询页面: 'Create query page',
    '打开 Apple 首页': 'Open Apple home page',
    打开商品页: 'Open product page',
    聚焦邮编输入框: 'Focus ZIP input',
    输入并核对本轮邮编: 'Enter and verify ZIP code',
    提交本轮邮编: 'Submit ZIP code',
    等待本轮库存响应: 'Wait for inventory response',
    '校验库存 HTTP 状态': 'Verify inventory HTTP status',
    校验库存运营商: 'Verify inventory carrier',
    '解析库存 JSON': 'Parse inventory JSON',
    解析目标门店库存: 'Parse target store inventory',
    超时: 'timeout',
    页面或数据不符合预期: 'unexpected page or data',
    'HTTP {status}，尚无有效库存结果': 'HTTP {status}, no valid inventory result',
    '商品页 HTTP {status}': 'Product page HTTP {status}',
    '{step}失败（{reason}）：{detail}；诊断截图未能保存':
      '{step} failed ({reason}): {detail}; diagnostic screenshot unavailable',
    '{step}失败（{reason}）；诊断截图未能保存':
      '{step} failed ({reason}); diagnostic screenshot unavailable',
    '{step}失败（{reason}）：{detail}': '{step} failed ({reason}): {detail}',
    '{step}失败（{reason}）': '{step} failed ({reason})',
  };

  const templates = Object.entries(english)
    .filter(([source]) => /\{\w+\}/.test(source))
    .map(([source, target]) => {
      const keys = [];
      const pattern = source
        .split(/(\{\w+\})/)
        .map((part) => {
          if (/^\{\w+\}$/.test(part)) {
            keys.push(part.slice(1, -1));
            return '([\\s\\S]*?)';
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      return { pattern: new RegExp(`^${pattern}$`), keys, target };
    });

  function translate(value, language) {
    const text = String(value ?? '');
    if (language !== 'en') {
      return text;
    }
    const source = text.trim();
    if (Object.hasOwn(english, source)) {
      return text.replace(source, () => english[source]);
    }
    for (const { pattern, keys, target } of templates) {
      const match = pattern.exec(source);
      if (match) {
        return text.replace(source, () =>
          target.replace(/\{(\w+)\}/g, (_, key) =>
            translate(match[keys.indexOf(key) + 1], language),
          ),
        );
      }
    }
    return text;
  }

  const preferredLanguage = (saved, browserLanguage) =>
    ['zh-CN', 'en'].includes(saved) ? saved : /^zh(?:-|$)/i.test(browserLanguage) ? 'zh-CN' : 'en';
  const api = { translate, preferredLanguage };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    globalThis.monitorI18n = api;
  }
})();

# Bark 与 Grafana 电话提醒配置

两种渠道可以单独使用。建议先保持监控暂停，完成配置并在手机上验收，再恢复监控。所有下文的 key、Webhook、域名和号码都使用自己的；**不要提交到 GitHub 或贴在 Issue 中**。

## Bark 推送

### 安装和取得设备 key

1. 在 iPhone App Store 安装 **Bark**，确认应用来源为官方 [Finb/Bark 项目](https://github.com/Finb/Bark)。打开并允许通知。
2. 进入 iPhone“设置 → 通知 → Bark”，允许通知，并按自己的需求启用声音、锁屏、通知中心和横幅。
3. Bark 首页会显示该设备的推送示例 URL，形如 `https://api.day.app/YOUR_DEVICE_KEY/测试内容`。只复制 `YOUR_DEVICE_KEY` 这一段到本项目，不要复制整个 URL、文字内容或斜线。
4. 本版只连接官方 `api.day.app`；如果应用当前设置的是自建服务器，需要使用官方服务器的设备 key。本版没有自建服务器地址选项。

### 保存、测试和确认

1. 先在监控页选好商品、邮编和门店。
2. 在“Bark 普通通知”填入设备 key，勾选“启用 Bark”。分组可保持 `iphone-duo`；“历史保留（秒）”默认为 600，可设 1–86400。
3. 保存设置。保存后输入框会清空，状态只显示“已配置”；空白表示保留旧 key，而不是删除。
4. 点击“发送一次通知测试”，确认。这会发一条带 **测试** 标识的普通通知，不查询 Apple，也不代表有货。测试按钮在已存 key 后可用，即使自动 Bark 开关关闭也可以手动测试。
5. 必须在 iPhone 上确认实际出现通知，点击通知确认打开的是所选商品的 Apple 购买页。

程序发送 `level=active` 普通通知，并附带购买 URL；不会强制绕过静音或专注模式，也不启用 critical / 连续铃声。`ttl` 控制 Bark 的消息存档保留时间，不表示库存有效时间。接口参数可参考官方 [Bark API](https://github.com/Finb/bark-server/blob/master/docs/API_V2.md)。

自动运行时，每轮每家明确有货门店发送一条通知。持续有货会继续提醒；失败轮次中的未知门店不会发送库存提醒。消息含商品、门店、检查时间和购买链接。主机能运行但采集长期失败时会发故障 / 恢复提醒；主机完全离线时无法自发提醒。

更换 key：在输入框填写新值并保存。删除 key：取消启用、勾选清除并保存。服务器数据库和备份包含 key，请保护数据卷；若已泄露，到 Bark 更新 key 并在此处重新填写。

## Grafana Cloud IRM 电话

这里使用的是 **Grafana Cloud IRM 的 incoming Webhook → 升级通知链 → 个人 Phone call 规则**。不需要自建 Grafana、Prometheus、仪表盘或 Grafana Alerting 规则。只有自建 Grafana 面板并不能拨电话。

需要自己有 Grafana Cloud stack 和 IRM 管理权限。可以从 [IRM 官方入门](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/get-started/)开始；费用、套餐额度和支持地区以自己账户当前账单及[电话支持说明](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/notify-responders/phone-and-sms/)为准，不把本指南当作永久免费或所有号码都能接通的保证。

下面名称是建议命名，可改名；关键是把接收人、Default 规则和默认路由连起来。

### A. 验证自己的接收号码

1. 打开自己的 Grafana Cloud stack，进入 **Alerts & IRM → IRM**。
2. 点击个人头像 → **Profile → IRM / IRM settings**，找到 **Phone verification**。
3. 输入国际格式号码，如 `+国家代码和号码`，不加空格、括号或横线。发送短信验证码并完成验证。号码只填写在 Grafana，不填到本项目。
4. 点击个人资料中的 **Make test call**，接听并听清测试内容。这一步只证明 Grafana 能拨到这个号码，还没有验证本项目的 Webhook 和路由。

具体入口可能随 Grafana 更新略有变化；参见[连接通知渠道](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/notify-responders/notification-channels/)。如果渠道不可选，检查 IRM 管理设置是否启用了电话渠道、号码是否已验证和所在地区是否受支持。

### B. 设置个人电话规则

1. 在同一 IRM 个人设置中打开 **Notification rules**。
2. 在 **Default notification rules** 中添加 **Phone call**，设置为立即执行。
3. 为这套用途保留一条立即 Phone call，不添加等待或重复步骤。若你已有用于其他工作的 Default 规则，先评估修改会影响哪些现有告警，也可以专门使用自己的另一个规则集合并在下一步选择它。
4. 保存。下一步通知链必须选择刚设置的规则集合；本指南用 **Default**。

只验证号码、未配置 Phone call 规则时，告警可能只发送邮件。可参阅[个人通知规则](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/notify-responders/personal-notification-rules/)。

### C. 创建通知链

1. IRM → **Escalation chains**（部分界面位于 Escalation / Routing）。创建 `iPhone Duo Phone`。
2. 添加一个立即通知指定用户的步骤（**Notify users / Notify persons**），选择你刚验证号码的用户。
3. 选择 **Default notification rules**。不要选到另一个没有 Phone call 的用户或 Important 规则。
4. 保持只有这一步，保存。无需配置排班、团队轮值、Wait 或 Repeat。

链负责选接收者，接收者的个人规则负责决定电话渠道，二者都需要配置。可参阅[升级通知链](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/escalation-and-routing/escalation-chains/)。

### D. 创建专用 incoming Webhook

1. IRM → **Integrations → Monitoring systems → Add integration**。
2. 选择 **Webhook / Simple Webhook**，命名 `iPhone Duo Pickup`，按账户要求指定团队并创建。
3. 复制该集成的 **HTTP Endpoint / Webhook URL**。这是接收告警的 incoming 地址，不是浏览器中的 stack 管理地址，也不是 outgoing webhook。
4. 本版使用专用 URL 中的 token，不发送额外 `Authorization` 头。不要在集成上打开 **Require a Grafana service account token**；若组织强制要求该选项，本版暂不支持，不要关闭组织要求来迁就本项目。
5. 不要把完整 URL 写进 `.env`、仓库或截图。后面只在监控页的密码字段填写一次。

创建入口与鉴权选项参见[集成管理](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/integrations/configure-integrations/)和[incoming Webhook](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/integrations/custom-integrations/incoming-webhooks/oncall-webhooks/)。

### E. 填写分组、恢复和显示模板

在该集成的 **Templates / Alert templates** 中逐项设置并保存。不同页面可能将模板分为 Behavioral 和 Appearance 两组。

| 字段 | 填写值 |
| --- | --- |
| Grouping / Grouping ID | `{{ payload.group_key }}` |
| Auto resolution / Resolve condition | `{{ payload.get("state", "").upper() == "OK" }}` |
| Source link | `{{ payload.url }}` |
| Web title | `{{ payload.title }}` |
| Web message | `{{ payload.message }}` |
| Phone call title / Phone call message | `{{ payload.title }}` |

**开启 Auto resolution / Allow source-based resolving**（如有独立开关）。不设置自动确认，不配置自动立即恢复的额外规则。电话所朗读字段要取 `payload.title`，其中有门店和检查时间。

这些值对应本项目的实际 JSON。下面是格式示例，不是可用 Webhook，也不代表真实库存：

```json
{
  "group_key": "iphone-duo-unique-round-id",
  "state": "alerting",
  "title": "TEST: iPhone Duo phone notification test. This is not a stock alert.",
  "message": "Test phone call",
  "url": "https://www.apple.com/shop/buy-iphone/iphone-duo"
}
```

恢复时以相同 `group_key` 发送 `state=OK`。因此不能用固定商品名分组，也不能让恢复事件生成另一个分组。可在 Grafana 模板预览中粘贴示例，检查 title、分组和恢复表达式；将 state 改为 `OK` 后恢复表达式应为 True。模板功能见[官方模板指南](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/escalation-and-routing/customize-alert-templates/)。

### F. 绑定 Default Route

回到 `iPhone Duo Pickup` 集成，找到 **Routes → Default Route**，将 escalation chain 选为 `iPhone Duo Phone` 并保存。新建集成只收到了数据但未绑定通知链时，不会通知接收者；参见[路由与升级流程](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/introduction/routing-and-escalation/)。

确认集成没有处于 Maintenance / Silence escalations / Disable alerts 状态，并且没有更高优先级的路由把这个 payload 导向别处。

### G. 配置自己实例的接收域名

完整 Webhook 可能形如 `https://oncall-prod-REGION.grafana.net/integrations/v1/SECRET/`。实际格式以你的集成为准，**不要复制示例当成真实地址**。

从自己的完整 Webhook 取 hostname（`https://` 后、第一个 `/` 前的部分），填入 `.env`：

```dotenv
GRAFANA_IRM_HOST=oncall-prod-REGION.grafana.net
```

这里 `REGION` 也必须换成真实值。不是你的 stack 管理域名，除非它恰好就是 Webhook hostname。程序只接受固定的官方 `*.grafana.net` / `*.grafana.com` HTTPS 域名，拒绝跳转、用户信息、片段和非默认端口。

```sh
docker compose up -d
```

刷新监控页。电话设置应该解锁；把完整 Webhook 填入“替换专用 Webhook”，勾选“启用电话”并保存。留空保存会保留旧地址，不回显原文。电话号码仍只保存在 Grafana。

### H. 从监控页测试整条链路

1. 保持监控暂停，点击“拨打一通测试电话”并确认。**这会真的请求拨打一通电话**，不要反复点击。
2. 在 Grafana 对应集成中看到标题以 TEST 开始的新 alert group，确认 route、chain、用户与 Phone call 的执行记录。
3. 在手机接听并确认听到 TEST 内容。监控页的“服务已接受”只说明 Webhook 响应成功，不能代替这一步。
4. 等电话发出并确认后，在本项目点击一次“暂停监控”（即使已经暂停也可以），清理测试分组。Grafana 应显示该分组 Resolved。测试不会立即自动恢复，以免电话尚未发出就被撤回。
5. 确认配置后恢复监控。每轮先恢复旧分组，再依据新的实际库存决定是否创建新的有货分组。

若旧分组恢复失败，电话渠道会独立冷却或暂停，Bark 和库存查询继续。修好恢复模板和服务状态后再处理；不要直接更换 / 删除尚有未恢复分组的 Webhook，页面会拒绝，以免丢失旧分组的恢复地址。先暂停并等清理成功，再更换。

每轮有货都会创建新的分组，接听 / 确认当前电话只影响本轮，不会暂停监控。**买到后务必在本项目暂停**。不要在通知链再加循环重拨，否则会叠加来电。静音、专注、垃圾来电过滤、运营商和服务方限制可能影响电话；按自己手机设置实测后再依赖。

## 故障排查

| 现象 | 检查位置 |
| --- | --- |
| 网页显示 Host / 来源校验失败 | 浏览器地址必须与 `.env` 的 `PUBLIC_ORIGIN` 完全一致；端口、协议也要一致，修改后重建容器 |
| Bark 未配置 / key 无效 | 只填 key，不填整个 URL；先保存设置，确认当前设备使用官方服务器 |
| Bark 服务接受但手机不显示 | iOS 通知权限、网络、通知汇总、专注和设备 key；普通通知不绕过静音 |
| 电话开关锁定 | `.env` 的 `GRAFANA_IRM_HOST` 是否已填写真实 Webhook hostname，是否运行 `docker compose up -d` 并刷新 |
| Webhook 不属于批准域名 | 填的是 incoming Webhook；hostname 必须与 `.env` 一致，不能填 stack 页面链接 |
| Grafana HTTP 401 / 403 | URL token 是否有效，是否意外开启额外 bearer token 要求；本版未实现额外鉴权头 |
| 有 alert group 没电话 | Default Route 绑定、chain 接收者、Default Phone call 规则、号码验证及 Maintenance 状态 |
| 个人 Make test call 成功，项目测试失败 | 个人测试跳过了 incoming / 模板 / route / chain，逐项检查这些环节 |
| 测试组一直 Firing | 收到电话后再点项目“暂停监控”；核对 grouping、恢复模板和 Auto resolution 开关 |
| HTTP 429 或电话冷却 | 查看渠道状态和服务侧限制，等待冷却；不要并发重试或绕过限流 |
| 修改 Webhook 被拒绝 | 先暂停并成功清理旧电话分组，保留旧地址直到恢复完成 |
| Apple 查询 UNKNOWN | 不是无货；检查事件、诊断截图、网页是否改版、网络或 Apple 限制，等待重试 |
| 整台机器离线没有告警 | 需要另外部署外部心跳监测；本版未提供 |

记录核对日期：2026-10-26。第三方界面和服务政策会变，以链接中的官方说明与账户实际状态为准。

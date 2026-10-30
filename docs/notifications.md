# Bark 与 Grafana 电话提醒配置

[中文](notifications.md) | [English](notifications.en.md)

两种渠道可以单独使用。建议先保持监控暂停，完成配置并在手机上验收，再恢复监控。所有下文的 key、Webhook、域名和号码都使用自己的；**不要提交到 GitHub 或贴在 Issue 中**。

## Bark 推送

### 安装和取得设备 key

1. 在 iPhone App Store 安装 **Bark**，确认应用来源为官方 [Finb/Bark 项目](https://github.com/Finb/Bark)。打开并允许通知。
2. 进入 iPhone“设置 → 通知 → Bark”，允许通知，并按自己的需求启用声音、锁屏、通知中心和横幅。
3. Bark 首页会显示该设备的推送示例 URL，形如 `https://api.day.app/YOUR_DEVICE_KEY/测试内容`。只复制 `YOUR_DEVICE_KEY` 这一段到本项目，不要复制整个 URL、文字内容或斜线。
4. 本版连接官方 `api.day.app`；如果应用当前设置的是自建服务器，请切换到官方服务器并取得设备 key。

### 配置、测试和确认

1. 在项目 `.env` 填写 `BARK_KEY='YOUR_DEVICE_KEY'`，只填 Bark 设备 key，不填完整 URL。
2. 运行 `docker compose up -d`，让 Compose 用新环境变量重新创建容器。全新数据库会启用已提供凭据的渠道，监控仍暂停；已有数据库保留网页开关，需要启用时在网页勾选“启用 Bark”并保存。
3. 在监控页选好商品、邮编和门店。Bark 分组可保持 `iphone-duo`；“历史保留（秒）”默认为 600，可设 1–86400。
4. 点击“发送一次通知测试”并确认，发送一条带测试标识的普通通知。只要 `.env` 已配置 key，即使自动 Bark 开关关闭也可手动测试，但仍遵守渠道冷却。
5. 在 iPhone 上确认实际出现通知，点击通知确认打开所选商品的 Apple 购买页。网页仅显示配置状态，不显示或接受修改凭据。

程序发送 `level=active` 普通通知，并附带购买 URL；声音和显示方式遵循手机的静音、专注及通知设置。`ttl` 控制 Bark 的消息存档保留时间。接口参数可参考官方 [Bark API](https://github.com/Finb/bark-server/blob/master/docs/API_V2.md)。

自动运行时，每轮每家明确有货门店发送一条通知。持续有货会继续提醒；失败轮次中的未知门店不会发送库存提醒。消息含商品、门店、检查时间和购买链接。主机能运行但采集长期失败时会发故障 / 恢复提醒；主机完全离线时无法自发提醒。

Bark 请求失败后独立冷却 180.001–599.999 秒，若 `Retry-After` 要求更久则等待该实际截止时间。页面显示冷却截止时间；同轮剩余门店、故障通知和手动测试均遵守该期限，重启或开关渠道不会清除冷却。库存查询和电话渠道继续；冷却结束后以新的查询结果发送，不补发旧库存提醒。

更换 key：修改 `.env` 的 `BARK_KEY` 后运行 `docker compose up -d`。删除 key：将该变量留空并重新创建容器，渠道自动停用。`.env` 需要单独安全备份，不在数据卷备份中；若 key 泄露，在 Bark 更新后修改 `.env`。

## Grafana Cloud IRM 电话

电话链路为 **Grafana Cloud IRM 的 incoming Webhook → 升级通知链 → 个人 Phone call 规则**，直接使用 Grafana Cloud 服务。

需要自己的 Grafana Cloud stack 和 IRM 管理权限。可以从 [IRM 官方入门](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/get-started/)开始；费用、套餐额度和支持地区见账户当前账单及[电话支持说明](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/notify-responders/phone-and-sms/)。

下面名称是建议命名，可改名；关键是把接收人、Default 规则和默认路由连起来。

### A. 验证自己的接收号码

1. 打开自己的 Grafana Cloud stack，进入 **Alerts & IRM → IRM**。
2. 点击个人头像 → **Profile → IRM / IRM settings**，找到 **Phone verification**。
3. 输入国际格式号码，如 `+国家代码和号码`，不加空格、括号或横线。发送短信验证码并完成验证。号码只填写在 Grafana，不填到本项目。
4. 点击个人资料中的 **Make test call**，接听并听清测试内容，确认号码可用。项目 Webhook 和路由在后续步骤中测试。

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
3. 选择刚配置 Phone call 的 **Default notification rules**。
4. 保持只有这一步，保存。无需配置排班、团队轮值、Wait 或 Repeat。

链负责选接收者，接收者的个人规则负责决定电话渠道，二者都需要配置。可参阅[升级通知链](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/escalation-and-routing/escalation-chains/)。

### D. 创建专用 incoming Webhook

1. IRM → **Integrations → Monitoring systems → Add integration**。
2. 选择 **Webhook / Simple Webhook**，命名 `iPhone Duo Pickup`，按账户要求指定团队并创建。
3. 复制该集成的 **HTTP Endpoint / Webhook URL**。这是接收告警的 incoming 地址，不是浏览器中的 stack 管理地址，也不是 outgoing webhook。
4. 本版使用专用 URL 中的 token，不发送额外 `Authorization` 头。不要在集成上打开 **Require a Grafana service account token**；若组织强制要求该选项，本版暂不支持，不要关闭组织要求来迁就本项目。
5. 把完整 URL 保存到被 Git 忽略的 `.env` 中的 `GRAFANA_IRM_WEBHOOK`；不要提交到仓库、Issue 或截图。

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

这些模板对应本项目的 JSON 字段。测试消息示例：

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

回到 `iPhone Duo Pickup` 集成，找到 **Routes → Default Route**，将 escalation chain 选为 `iPhone Duo Phone` 并保存，将收到的告警交给该通知链处理。参见[路由与升级流程](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/introduction/routing-and-escalation/)。

确认集成没有处于 Maintenance / Silence escalations / Disable alerts 状态，并且没有更高优先级的路由把这个 payload 导向别处。

### G. 在 .env 配置完整 Webhook

将自己的完整 incoming Webhook 填入项目 `.env`，下面仅为占位示例：

```dotenv
GRAFANA_IRM_WEBHOOK='https://oncall-prod-REGION.grafana.net/integrations/v1/YOUR_TOKEN/'
```

程序从 URL 识别接收域名，只接受 Grafana 官方 `*.grafana.net` / `*.grafana.com` HTTPS 地址，拒绝跳转、用户信息、片段和非默认端口。`GRAFANA_IRM_HOST` 可选，通常留空即可；填写时必须与该 URL 的 hostname 完全一致，用于额外固定域名。

```sh
docker compose up -d
```

刷新监控页，电话区域应显示已配置。全新数据库中该渠道自动启用，监控仍暂停；已有实例如先前关闭了电话，需要勾选“启用电话”并保存。网页不再提供 Webhook 输入框；更新或删除凭据需修改 `.env` 并重新创建容器，单独 restart 不会读取新环境变量。电话号码仍只保存在 Grafana。

### H. 从监控页测试整条链路

1. 保持监控暂停，点击“拨打一通测试电话”并确认，发送一次电话测试。
2. 在 Grafana 对应集成中看到标题以 TEST 开始的新 alert group，确认 route、chain、用户与 Phone call 的执行记录。
3. 在手机接听并确认听到 TEST 内容。“服务已接受”表示 Webhook 响应成功，手机接听完成送达验收。
4. 等电话发出并确认后，保持监控暂停，点击电话区域的“清理电话分组”并确认。Grafana 应显示该分组 Resolved；此操作不恢复监控，也不请求新电话。不要提前清理，以免撤回尚未拨出的测试电话；测试不会立即自动恢复。
5. 确认配置后恢复监控。每轮先恢复旧分组，再依据新的实际库存决定是否创建新的有货分组。

若发送或清理失败，电话渠道独立冷却 180.001–599.999 秒；服务要求更久时保留实际 `Retry-After` 截止时间，不设为永久暂停。该时间跨重启保留，测试和清理操作都不能提前重试。库存监控运行时，后续轮次会在截止时间后尝试清理；监控暂停时，修好模板或服务状态，等页面显示的截止时间后再点“清理电话分组”。Bark 和库存查询继续，不受电话冷却影响。

若页面明确显示“旧版遗留暂停”，旧程序没有保存原重试截止时间，无法自动恢复。先在 Grafana 确认限流或故障已解除，再暂停监控并点击“清理电话分组”，确认专门的恢复提示。这个人工恢复仅用于旧版遗留状态，不会绕过正常冷却。

更换 / 删除 `.env` 中的 Webhook 前，先在原地址下暂停监控并清理旧分组；若仍有未恢复分组，更改环境变量后的实例会拒绝启动。恢复原 `.env` 并重新创建容器，清理成功后再更换，避免丢失旧分组的恢复地址。

每轮有货都会创建新的分组并请求来电。**买到后请在本项目暂停监控**。通知链保持单次来电，避免叠加重拨。测试时使用平时的静音、专注和来电过滤设置，确认手机能收到。

## 故障排查

| 现象 | 检查位置 |
| --- | --- |
| 网页显示 Host / 来源校验失败 | 浏览器地址必须与 `.env` 的 `PUBLIC_ORIGIN` 完全一致；端口、协议也要一致，修改后重建容器 |
| Bark 未配置 / key 无效 | 核对 `.env` 的 BARK_KEY 只填设备 key；修改后重新创建容器，确认设备使用官方服务器 |
| Bark 服务接受但手机不显示 | iOS 通知权限、网络、通知汇总、专注和设备 key；普通通知不绕过静音 |
| 电话开关锁定 | `.env` 是否已填写 GRAFANA_IRM_WEBHOOK，是否运行 `docker compose up -d` 并刷新；已有实例还需开启电话开关 |
| Webhook 不属于批准域名 | 使用完整 incoming Webhook；可选的 GRAFANA_IRM_HOST 须匹配其 hostname，不能填 stack 管理链接 |
| Grafana HTTP 401 / 403 | URL token 是否有效，是否意外开启额外 bearer token 要求；本版未实现额外鉴权头 |
| 有 alert group 没电话 | Default Route 绑定、chain 接收者、Default Phone call 规则、号码验证及 Maintenance 状态 |
| 个人 Make test call 成功，项目测试失败 | 个人测试跳过了 incoming / 模板 / route / chain，逐项检查这些环节 |
| 测试组一直 Firing | 确认电话已发出，保持监控暂停并点“清理电话分组”；核对 grouping、恢复模板和 Auto resolution 开关 |
| Bark / 电话请求失败或 HTTP 429 | 按页面的冷却截止时间等待；手动测试、清理及重启不会绕过期限，另一渠道和库存查询继续 |
| 旧版遗留电话暂停 | 先在 Grafana 确认限流解除，再暂停监控，使用“清理电话分组”并确认专门的恢复提示 |
| 更换 Webhook 后拒绝启动 | 恢复原 .env 并重新创建容器，先清理旧分组，再修改 Webhook |
| 提示旧数据库凭据尚未迁移 | 先备份数据，把原 key / Webhook 安全迁入 .env 后重建容器；迁移前原记录保持不变 |
| Apple 查询 UNKNOWN | 库存待确认；检查事件、诊断截图、网页是否改版、网络或 Apple 限制，等待重试 |
| 整台机器离线没有告警 | 需要另外部署外部心跳监测；本版未提供 |

项目操作说明核对日期：2026-10-29；第三方界面与服务政策的上次核对为 2026-10-26，以链接中的官方说明与账户实际状态为准。

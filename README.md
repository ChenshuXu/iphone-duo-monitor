# iPhone Duo Pickup Monitor

[中文](README.md) | [English](README.en.md)

用 Docker 自托管的 Apple 美国官网 iPhone Duo 取货监控。网页选择邮编、颜色、容量、运营商及附近门店，有货时通过 **Bark 推送购买链接**，或通过 **Grafana Cloud IRM 拨打电话**。

- 自选五位美国 ZIP code；从 Apple 当次页面结果读取附近门店。
- Star White / Night Sky；256GB / 512GB / 1TB / 2TB；AT&T / T-Mobile / Verizon / 稍后连接运营商。
- 独立 Chromium 浏览器逐轮查询，核对商品、ZIP 和门店。页面变化或请求失败显示“未知”。
- 持久化配置、暂停状态及最近 60 天逐店查询历史，有货轮次永久保留，可筛选曾经有货的记录。
- Bark 与电话可独立开关；无需 Apple 账号，收到提醒后前往 Apple 官网购买。

支持 Apple **美国商店**的 iPhone Duo，商品选项已与 Apple 页面核对。库存显示查询时的状态，购买时以 Apple 页面为准。

![管理页面示例：90210、Night Sky、512GB](docs/dashboard.png)

管理页支持中文和 English，可在页头切换。首次访问跟随浏览器语言，手动选择保存在当前浏览器；切换时保留未保存的设置，日期和数字按所选语言显示，时区仍使用浏览器本地时区。

首次状态读取失败时，管理页仍会自动尝试重新连接；服务恢复后无需刷新页面。

## 交给 AI Agent 部署（首次使用推荐）

下载并解压这个仓库，或用 Git clone，然后让具有文件读写和终端执行能力的 AI Agent 打开整个项目目录。运行环境由 Agent 准备，数据库在首次启动时自动创建。把下面这段话交给它：

```text
请读取根目录 AGENTS.md 和 docs/agent-setup.md，帮我完成这个项目的首次配置、运行与部署。
先检查环境，再集中询问缺少的部署机器、美国邮编、商品选项、门店范围和通知渠道。
请完成配置、构建、启动和验收，并准备好 .env 供我直接填写凭据。
按我选择的通知渠道各做一次实际测试（电话渠道会来电）；
等我确认手机收到，再启用监控并等到第一轮真实查询完成。
最后给我访问地址、当前监控状态、验证结果，以及暂停、更新和备份方式。
```

完整步骤见 [AI Agent 首次配置与部署指南](docs/agent-setup.md)。Agent 会准备 Docker、处理本机或远程部署，并完成商品和门店配置。你需要配合账号登录、短信验证、手机通知权限和接收确认；只用 Bark 时无需配置 Grafana。

## 1. Docker 部署

需要 Docker Engine + Compose v2（或 Docker Desktop）、至少 2 GiB 可用内存，以及可访问 Apple 和所选通知服务的网络；Git 用于克隆和更新，ZIP 下载首次部署不需要 Git。容器内为 Linux，已验证 Linux x86_64；ARM64 / Apple Silicon 尚未验证。不要使用 `--privileged` 或关闭 Chromium 沙箱。

```sh
git clone https://github.com/ChenshuXu/iphone-duo-monitor.git
cd iphone-duo-monitor
cp .env.example .env
# 先编辑 .env，填入需要的通知凭据，再启动。
docker compose up -d --build
docker compose ps
```

在 `.env` 中填写需要的渠道，未使用的留空。下面都是占位示例，必须替换：

```dotenv
BARK_KEY='YOUR_BARK_DEVICE_KEY'
GRAFANA_IRM_WEBHOOK='https://oncall-prod-REGION.grafana.net/integrations/v1/YOUR_TOKEN/'
```

首次构建会下载较大的浏览器镜像。服务健康后在部署机器打开 **http://localhost:8088**，网页显示凭据是否已配置，并提供开关和测试；无需手工建数据库、复制 Cookie 或编辑商品编号。`.env` 由 Compose 注入容器环境，更新凭据后运行 `docker compose up -d` 重新创建容器，单独 `docker compose restart` 不会读取新值。

默认绑定 `127.0.0.1`，无登录。请保留本机访问，或通过 SSH 转发访问服务器：

```sh
ssh -L 8088:127.0.0.1:8088 your-user@your-server
```

然后在自己的电脑打开 http://localhost:8088。SSH 用户和服务器地址换成自己的。

### 局域网 / VPN 访问

如需要直接从手机访问，把 `.env` 改为实际服务器的局域网地址，例如：

```dotenv
PUBLIC_ORIGIN=http://192.168.10.20:8088
BIND_ADDRESS=192.168.10.20
PORT=8088
GRAFANA_IRM_HOST=
```

这是示例地址，必须替换为自己的。运行 `docker compose up -d` 后，浏览器也必须用完全相同的地址访问；`localhost`、`127.0.0.1`、IP 和主机名不能混用。`PUBLIC_ORIGIN` 不带路径或尾斜线，改端口时也要同步修改它。

所有能访问此端口的人都能修改设置、调用通知测试、查看历史和截图。通知凭据在部署机器的 `.env` 中填写。远程访问使用 SSH / 私有 VPN；公网访问需配置带 HTTPS、认证和访问控制的反向代理，并让 `PUBLIC_ORIGIN` 与外部 HTTPS 地址一致。

## 2. 选择自己的商品和门店

1. 首次安装是**暂停**状态；全新数据库中，填入凭据的通知渠道默认启用，未填的关闭。已有数据库保留网页开关，重启不会重新启用已关闭的渠道。
2. 在“监控设置”填写自己的美国邮编，选择颜色、容量和运营商。“Connect to any carrier later”对应 Apple 的稍后连接运营商选项。
3. 点击“读取附近门店”。容器会打开所选 Apple 商品页、核对页面选择并提交邮编，通常需要数十秒，网络慢时可能需要几分钟。
4. 勾选想去的门店，点击“保存设置”。目录包含本轮 Apple 返回的附近门店。
5. 按[通知配置指南](docs/notifications.md)完成 `.env` 和 Grafana 配置，在网页发送单次测试，确认手机实际收到。
6. 点击“恢复监控”。自动查询在上轮完成后随机等待：正常为 60.001–179.999 秒，异常为 180.001–599.999 秒。点击“请求查询”会在允许的最早时间执行：已满足最短间隔就立即开始，否则提前倒计时并显示预计时间；查询中再次点击不会重复发起。最短间隔和 Apple 限流不会被跳过，刷新网页也不会触发查询。

更换邮编、颜色、容量或运营商时，先暂停并等待当前轮结束，再重新读取门店、选择并保存，最后恢复。旧库存立即变为未知，旧轮次不用于新配置通知，旧查询保留其当时的商品和 ZIP。

门店读取的冷却从该次查询结束时开始：成功后至少 60 秒，失败后至少 180 秒，并尊重更长的 `Retry-After`。重启后仍需遵守该期限。遇到 Apple 拦截、验证码或未知页面时，查看采集诊断并处理。

## 3. Bark 与 Grafana 电话

完整步骤、模板、验收和排查见 **[通知配置指南](docs/notifications.md)**：

- [Bark：获取设备 key、权限、保存与测试](docs/notifications.md#bark-推送)
- [Grafana：号码验证、电话规则、通知链、Webhook 模板与路由](docs/notifications.md#grafana-cloud-irm-电话)
- [测试收不到通知时如何排查](docs/notifications.md#故障排查)

通知正文的检查时间使用 UTC，网页使用浏览器本地时区。

Bark 当前使用官方 `https://api.day.app/push`，不支持自建 Bark 服务器。每轮每家明确有货门店推送一条普通 `active` 通知；故障持续至少 3 轮且 30 分钟无完整成功后通知一次，恢复后再通知一次。

电话每轮汇总有货门店并创建新分组，持续有货会继续来电。**买到后请在本项目中暂停监控**。首次配置时接听测试电话，确认整条通知链路可用。

通知请求失败时，Bark 独立冷却 10 秒（HTTP 429 为 180.001–599.999 秒），电话渠道独立冷却 180.001–599.999 秒；若服务要求等待更久，则使用实际 `Retry-After` 截止时间，即使超过十分钟也不会永久停用。冷却跨重启保留，手动测试也不能绕过；库存查询和另一渠道继续。Bark 冷却期间不发送本轮其他门店。库存提醒失败后，若冷却不超过 10 秒，本轮在冷却结束后自动重试最多 2 次；下一轮开始后不再补发旧库存，按新结果决定提醒。

同一渠道的测试、库存提醒和电话分组清理按顺序执行；排队通知在发送前重新检查开关、冷却和配置版本。暂停、关闭电话或停止服务时，先等待正在发送的电话告警结束，再清理分组；若告警发送失败，仍保留分组及实际冷却期限。

电话测试确认收到后，在监控仍暂停时点击“清理电话分组”。此按钮只恢复旧告警分组，不发新电话、不恢复库存查询；若仍在冷却，等待页面显示的截止时间后再点。旧版遗留的永久电话暂停会显示专门说明，只有确认 Grafana 服务侧限流已解除后才使用清理按钮恢复，原 Webhook 在清理成功前仍需保留。完整步骤见通知指南。

通知凭据统一在 `.env` 中管理。

旧版从数据库读取凭据的实例，升级前先备份数据，并把原 Bark key / Webhook 安全迁入 `.env`；缺失时程序拒绝迁移，保留原配置和历史。成功启动后，旧 `secrets` 状态字段会被移除，新值以 `.env` 为准。更换或清除 Webhook 前，先使用原地址清理所有待恢复电话分组，否则新配置会拒绝启动。

## 4. 历史、更新与备份

“查询历史”按浏览器所在时区显示，支持最近 24 小时、7 / 30 / 60 天、全部记录、门店及结果筛选，每页 50 轮。每次实际监控查询都保存当轮商品、ZIP 和逐店结果；查询中退出会留下“中断”。门店发现只用于配置，不计入监控历史。有货次数表示查询快照数，不表示连续有货时长。

部署参数、Bark key 和完整 Grafana Webhook 统一放在独立的 `.env`，不要修改共用代码或 `compose.yaml` 中的默认值。商品、ZIP、门店、通知开关以及 Bark 分组 / TTL 由网页写入 SQLite；通知凭据只从进程环境读取，网页不能修改，也不写入新数据库的状态记录。`.env`、`data/`、数据库和 `local/` 私人运维目录均被 Git 与 Docker 构建上下文忽略；只提交 `.env.example` 中的空白或通用示例。已有安装使用绑定目录时，可在 `.env` 设置 `DATA_VOLUME=./data`，默认仍使用命名卷。

数据统一挂载到容器 `/data`，包括 SQLite 状态与历史、匿名浏览器资料和有限的诊断截图。实际位置由 `.env` 中的 `DATA_VOLUME` 决定：

| `DATA_VOLUME` | 存储位置 | `docker compose down` | `docker compose down -v` |
| --- | --- | --- | --- |
| 未设置或 `monitor-data` | Compose 命名卷，名称通常为 `<项目名>_monitor-data` | 保留数据 | **删除该命名卷及其中全部数据** |
| `./data`（或自己的绑定目录） | 部署目录中的 `data/`（或所填目录） | 保留目录和数据 | **仍保留目录和数据** |

不要只修改 `DATA_VOLUME` 来迁移已有数据；这只会切换挂载来源。`.env` 包含明文凭据，建议权限为 `0600`，需要单独安全备份。旧数据库及其旧备份可能仍残留历史凭据，继续作为敏感文件保护。`docker compose config` / `docker inspect` 的完整输出可能包含环境变量，不要公开分享。普通更新不会清空数据：

```sh
git pull --ff-only
docker compose up -d --build
docker compose logs --tail 50 monitor
```

暂停后重启会保持暂停；运行中更新会按正常等待恢复。事件保存在 SQLite，保留 30 天；查询历史保留 60 天；失败截图保留最近 20 张。出现有货的查询轮次，以及该轮的库存事件和 Bark / 电话发送结果（含失败）永久保留，不参与滚动清理。暂停期间也定时清理。

“最近事件”实时显示最新 200 条，可按类型筛选（有货与提醒、通知发送、错误、隐藏普通查询），并用“加载更早事件”向前翻页。升级时，旧版保存在状态中的事件会自动迁入事件表，其中可识别的有货查询和库存 Bark 记录标为永久保留。

备份时先暂停并停止服务，保证 SQLite 写入完成。以下命令适用于命名卷和绑定目录，在当前目录创建数据备份 `monitor-backup.tar.gz`；临时文件权限为 `0600`，只有备份成功且非空才替换旧备份：

```sh
sh <<'SH'
set -eu
umask 077
docker compose stop monitor
backup_tmp=$(mktemp ./monitor-backup.XXXXXX)
trap 'rm -f "$backup_tmp"' EXIT
if docker compose run --rm --no-deps --user 0 --entrypoint tar monitor -C /data -czf - . > "$backup_tmp" && test -s "$backup_tmp"; then
  mv -f "$backup_tmp" monitor-backup.tar.gz
  docker compose start monitor
else
  echo '备份失败，旧备份未替换，服务保持停止；请检查原因。' >&2
  exit 1
fi
SH
```

失败时命令返回非零状态，旧备份保持原样。处理后重新备份；如需先恢复服务，手动运行 `docker compose start monitor`。`.env` 不在数据备份中，需要另外安全保留。

恢复前设置好 `.env`，确认目标是一个**新的、空的命名卷或绑定目录**，并停止目标服务。运行 `docker compose create` 创建命名卷；若使用绑定目录，先准备空目录。随后执行：

```sh
docker compose run --rm --no-deps --user 0 --entrypoint tar -T monitor -C /data -xzf - < monitor-backup.tar.gz
docker compose up -d
```

恢复会带回备份时的暂停状态和网页设置；通知凭据由恢复机器的 `.env` 提供，不能仅靠数据卷备份恢复。不要覆盖运行中的数据库，也不要把本仓库外的旧家庭版数据库直接导入；其商品配置结构不同。

删除数据前先确认使用的是命名卷还是绑定目录：`down -v` 不会清除绑定目录里的数据库、历史或浏览器资料，也不会删除独立的 `.env`。诊断时不要手动删除 Chromium 的 Cookie 或 profile 锁；先确认旧容器和浏览器已停止。

查询历史中的“执行步骤与网络异常”保留每步耗时及 Apple 相关 HTTP / 网络错误，随查询历史保存（普通轮次 60 天，有货轮次永久）；URL 去除用户信息、查询参数和片段，不记录请求头、Cookie 或响应正文。旧记录没有的诊断无法补录。取货查询兼容两种页面入口、默认 ZIP 回填和商品页跳转后的选项恢复，并保持颜色、容量、运营商、商品编号与邮编校验。

## 5. 开发与验证

Node.js 24+：

```sh
npm ci
npm run format:check
npm test
```

使用 `npm run format` 统一 JavaScript、HTML 和 CSS 的缩进与换行。每行一个语句，变量声明分开，条件与循环使用花括号，按逻辑步骤留空行。

在非 Linux Docker 环境，Chromium 回归测试会明确跳过。与部署一致的完整检查：

```sh
docker compose build
docker run --rm --init --user 1000:1000 --shm-size=512m \
  --cap-drop=ALL --cap-add=SYS_CHROOT \
  --security-opt no-new-privileges:true \
  --security-opt seccomp=./seccomp_profile.json \
  -v "$PWD/test:/app/test:ro" -v "$PWD/README.md:/app/README.md:ro" \
  iphone-duo-monitor:local npm test
STORAGE_TEST_IMAGE=iphone-duo-monitor:local sh test/storage.test.sh
```

备份回归直接执行上文命令并模拟 Docker 失败，验证旧备份和文件权限；存储测试创建独立临时命名卷和绑定目录，核对 `down` / `down -v` 的保留行为并清理测试资源。自动化测试使用模拟 Apple 页面和通知发送器。参见[验证记录](docs/verification.md)。

非 root Chromium 使用随项目提供的 seccomp profile、`SYS_CHROOT` 和共享内存；CDP 只监听容器内部回环地址。主机禁用用户命名空间或策略阻止浏览器沙箱时，应修正主机兼容性，不要通过 `--no-sandbox` 规避。

服务器、Docker 或网络离线告警需另行配置外部心跳服务。

## License

[MIT](LICENSE)。第三方文件归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。浏览器基础镜像、Playwright 和第三方服务各自遵循其许可证与服务条款。

# AI Agent 首次配置与部署指南

[中文](agent-setup.md) | [English](agent-setup.en.md)

在用户指定的机器完成配置、部署和首轮查询验收。用户提供购买偏好、部署目标和通知账号，并配合手机侧验证。

管理页可在页头切换中文 / English。首次跟随浏览器语言，手动选择在当前浏览器保留。

以下命令在部署机器的仓库根目录执行，使用 POSIX shell；Windows 上使用能连接 Docker Desktop 的 WSL 终端。

## 1. 先检查，再集中补齐信息

先读根目录 [AGENTS.md](../AGENTS.md)、[README](../README.md) 和 [.env.example](../.env.example)，选择通知渠道后再读[通知指南](notifications.md)。

自行检查系统、CPU、Docker、端口、可用资源及已有配置。以下信息从对话或现有配置中取得，集中补问缺失项：

| 信息 | 需要得到的答案 |
| --- | --- |
| 部署位置 | 当前电脑，还是指定的常开服务器 / NAS / VM；远程部署需要可用的 SSH 或目标终端，以及目标目录 |
| 购买目标 | 五位美国 ZIP、颜色、容量、运营商；保留 ZIP 开头的零 |
| 门店范围 | 按店名指定、发现后再选，或该 ZIP 返回的全部附近门店 |
| 通知渠道 | Bark、Grafana IRM 电话、两者，或只查看网页 |

支持的选项以 `/api/settings` 返回的 `options` 为准。当前选项是 Star White / Night Sky，256GB / 512GB / 1TB / 2TB，AT&T / T-Mobile / Verizon / Connect to any carrier later。

默认采用单实例、命名卷、本机端口 `8088` 和 SSH 转发。其余配置按以下步骤完成；需要用户登录、填凭据或接收通知时，给出具体操作，同时继续其余准备。

## 2. 确认操作的是正确机器和实例

在目标机器执行：

```sh
pwd
docker version
docker compose version
docker context show
docker info --format 'OS={{.OSType}} Arch={{.Architecture}} Memory={{.MemTotal}}'
docker compose ls
```

逐项处理：

- 没有 Docker：按 [Docker Engine 官方安装说明](https://docs.docker.com/engine/install/)安装 Linux Engine 和 Compose 插件；桌面系统按 [Docker Desktop 官方说明](https://docs.docker.com/desktop/)安装并启动，使用 Linux 容器。需要管理员操作或系统重启时，由用户完成后继续。
- Docker 不可用：检查 daemon / Desktop、当前用户权限和 Docker context，连接用户指定的部署主机。
- 资源与架构：至少预留 2 GiB 可用内存，并检查构建所需磁盘空间。已验证 Linux x86_64 Docker；Apple Silicon（arm64）已通过镜像构建与自动化测试，真实 Apple 查询以及 Windows / NAS 的具体环境按本流程验收。
- 远程服务器：通过 SSH / 终端在目标目录 clone 仓库或传输源码，在目标机器配置 `.env`、构建和启动。
- 下载 ZIP：解压后进入含 `compose.yaml`、`Dockerfile` 和 `seccomp_profile.json` 的目录即可，无需 Git。

检查已有 `.env`、`compose.override.yaml`、容器和数据挂载；Git checkout 还要检查 `git status --short`。默认数据位于 Docker 命名卷，绑定目录则由 `DATA_VOLUME` 指定。

既有实例按第 9 节备份后更新。后续命令沿用同一目录、Docker context、Compose 项目名和挂载来源，以及原部署的 `-p`、`-f` 或 `--env-file` 参数。

## 3. 准备 .env 和访问地址

首次安装创建 `.env`，已有文件直接沿用：

```sh
umask 077
if [ ! -e .env ]; then
  cp .env.example .env
fi
chmod 600 .env
```

按用户选择编辑，通知凭据可稍后填写，服务首次启动时保持暂停：

| 变量 | 首次部署的处理 |
| --- | --- |
| `PUBLIC_ORIGIN` | 默认 `http://localhost:8088`；必须等于用户实际打开的协议、主机和端口，无路径和尾斜线 |
| `BIND_ADDRESS` | 默认 `127.0.0.1`，只接受部署主机本地访问 |
| `PORT` | 主机端口，默认 `8088`；修改时同步修改 `PUBLIC_ORIGIN`，容器内部仍为 `8080` |
| `DATA_VOLUME` | 默认 `monitor-data`，让 Compose 创建持久卷；全新安装不需要手工建库或建 `data/` |
| `BARK_KEY` | 使用 Bark 时填写设备 key |
| `GRAFANA_IRM_WEBHOOK` | 使用电话时填写专用 incoming Webhook 的完整 HTTPS 地址 |
| `GRAFANA_IRM_HOST` | 通常留空；需要固定域名时只填上述 Webhook 的 hostname，并确保完全一致 |

Agent 准备配置，用户通过目标机器的 `.env` 或安全输入填写凭据。凭据不进入 Git、聊天或公开输出；检查配置可用 `docker compose config --quiet`。Compose 会自动读取 `.env`。

商品、ZIP、门店和通知开关通过后续网页或 API 步骤保存；通知凭据从环境变量读取。

远程访问默认使用 SSH 转发。在用户电脑建立隧道，替换为自己的 SSH 用户与服务器：

```sh
ssh -N -L 8088:127.0.0.1:8088 your-user@your-server
```

然后在用户电脑打开 `http://localhost:8088`，服务器 `.env` 的 `PUBLIC_ORIGIN` 仍设为该地址。隧道关闭只影响管理访问，服务器监控继续运行。若本机端口已占用，可以选择其他隧道端口，但必须让 `PUBLIC_ORIGIN` 与浏览器最终地址一致。

本机部署端口冲突时选一个空闲端口，例如把 `PORT` 与 `PUBLIC_ORIGIN` 同步改为 `8089`。访问地址中的 `localhost` 或 `127.0.0.1` 也要与 `PUBLIC_ORIGIN` 一致。

局域网 / 私有 VPN 直连按 [README 的访问说明](../README.md#局域网--vpn-访问)设置实际地址。服务没有登录功能，公网访问需要 HTTPS、认证与访问控制。

## 4. 配置用户选择的通知渠道

Bark：按[通知指南的 Bark 部分](notifications.md#bark-推送)安装官方应用、允许 iOS 通知，取得 `api.day.app` 的设备 key 并写入 `.env`。只用 Bark 时无需 Grafana。Bark 使用普通通知，静音和专注模式在手机侧设置。

Grafana IRM 电话：按[通知指南的电话部分](notifications.md#grafana-cloud-irm-电话)完成以下配置：

1. 用户自己的 Cloud stack 与 IRM 权限，以及接收号码验证。
2. 接收用户的一条立即 Phone call 通知规则。
3. 指向该用户和相同规则集合的 escalation chain。
4. 专用 incoming Webhook 集成及其接收地址。
5. 通知指南列出的 grouping、恢复、显示及电话模板，以及 source-based auto resolution。
6. 集成的 Default Route 绑定上面的 chain，确认未处于 Maintenance / Silence 状态。
7. 完整 Webhook 保存到 `.env`，再进行项目侧整条链路测试。

有登录浏览器时，由 Agent 完成本项目的配置；否则给用户具体入口和值，完成后继续。账号登录、短信验证、手机权限和接听由用户处理。使用专用集成与通知链，电话额度、费用和支持地区以用户账号为准。

未选择的渠道保持凭据为空、开关关闭。只查看网页时，两种渠道都关闭。

## 5. 构建并启动暂停状态的服务

```sh
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
docker compose ps
docker compose logs --tail 50 monitor
```

`config --quiet` 只校验配置，不打印包含凭据的完整配置。首次构建需要下载浏览器基础镜像；`--wait-timeout` 用于构建后等待服务就绪。若安装的 Compose 不支持 `--wait`，可用 `docker compose up -d --build` 后检查 `ps`，等待服务变为 healthy。参数行为见 [Compose up 官方说明](https://docs.docker.com/reference/cli/docker/compose/up/)。

检查容器 healthy、重启次数稳定。此时 HTTP 服务已就绪，接下来配置商品并测试查询与通知。新数据卷保持暂停，填入凭据的渠道默认启用；已有数据库保留原开关和暂停状态。

使用容器自带 Node 读取状态：

```sh
docker compose exec -T monitor node --input-type=module <<'JS'
const response = await fetch('http://127.0.0.1:8080/api/status');
if (!response.ok) throw new Error(`状态检查失败：HTTP ${response.status}`);
const { config, runtime } = await response.json();
console.log(JSON.stringify({
  confirmed: config.confirmed, paused: runtime.paused, phase: runtime.phase,
  barkConfigured: config.barkConfigured, barkEnabled: config.barkEnabled,
  irmConfigured: config.irmConfigured, irmEnabled: config.irmEnabled,
  lastComplete: runtime.lastComplete, stores: runtime.stores
}, null, 2));
JS
```

从用户实际使用的地址打开管理页，确认“已连接”、设置可读。无法打开时检查地址、隧道和防火墙。

修改 `.env` 后运行 `docker compose up -d` 重新创建容器，刷新页面核对配置状态；`restart` 保留原进程环境。已有数据库后补凭据时，还需保存网页通知开关。若仍读到旧值，检查额外 Compose 文件或 shell 环境中的变量。

## 6. 发现门店并保存监控设置

通过管理页完成以下操作，也可使用后面的 HTTP 接口。

1. 确认监控暂停，当前查询已结束；首次安装本来就暂停。
2. 填写用户的 ZIP，选择颜色、容量、运营商。保留默认等待范围、Bark 分组和 TTL，除非用户有明确要求。
3. 点击“读取附近门店”，等这一轮结束。它会通过**部署容器内的 Chromium**访问 Apple，并返回这个商品与 ZIP 的真实目录；通常数十秒，慢时可能几分钟。
4. 根据用户选定的范围勾选门店。选择全部附近门店时直接全选；尚未决定时提供实际店名供用户选择。
5. 核对所选渠道开关，点击“保存设置”。重新载入后确认商品、ZIP、门店和开关一致，`confirmed` 为 true，监控仍暂停。

所选门店未出现在 Apple 返回的目录时，提供实际目录供用户调整。再次发现需等待成功后 60 秒、失败后 180 秒，或更长的 Retry-After。页面校验失败时查看诊断，库存状态保留为未知。

### 不依赖浏览器的 HTTP 操作

API 与管理页共用地址。宿主机调用时，URL 的 Host 与 `PUBLIC_ORIGIN` 匹配；写请求携带 `Origin: <PUBLIC_ORIGIN>` 和 `Content-Type: application/json`。

| 请求 | 输入与用途 |
| --- | --- |
| `GET /api/status` | 读取配置、暂停状态、渠道状态、当前门店结果和事件 |
| `GET /api/settings` | 取得当前完整设置、`version`、`options` 及凭据是否配置的布尔值 |
| `POST /api/discover` | JSON 包含字符串 `zip`、`color`、`capacity`、`carrier`；返回 `catalog` 和核对后的 `product`；本身不保存目录或设置 |
| `PUT /api/settings` | 以刚读取的完整设置为底稿，合并本次目标、真实 `catalog`、选中 ID 数组 `stores` 和通知开关；携带原 `version`，保存成功后版本递增 |
| `POST /api/control` | JSON 为 `{"action":"..."}`；支持 `pause`、`resume`、`query`、`test-bark`、`test-irm`、`cleanup-irm`；旧版恢复动作不用于首次配置 |
| `GET /api/history` | 读取真实监控轮次，检查 outcome、config、stores、verification 和 diagnostics；发现门店不产生监控历史；`days=all` 包含永久保留的有货轮次 |
| `GET /api/event-log` | 分页读取事件；`type` 为空、`stock`、`notify`、`error` 或 `nonquery`，`before` 传上一页的 `nextCursor` |

创建 `local/`，在 `local/target.json` 写入用户所选的四个字段，格式如下：

```json
{"zip":"90210","color":"nightsky","capacity":"512gb","carrier":"unlocked"}
```

颜色键为 `starwhite` / `nightsky`，容量键为 `256gb` / `512gb` / `1tb` / `2tb`，运营商键为 `att` / `t-mobile` / `verizon` / `unlocked`。名称到键的映射仍以当前 `options` 为准。

使用 curl 读取门店目录；下面采用默认地址，按实际配置替换 URL 和 Origin：

```sh
curl --silent --show-error --fail-with-body --max-time 300 \
  -H 'Origin: http://localhost:8088' \
  -H 'Content-Type: application/json' \
  --data-binary @local/target.json \
  http://localhost:8088/api/discover
```

将响应中的 `catalog`、所选门店和目标合并到当前完整设置，写成 `local/settings.json`。请求体使用设置字段，保留四个等待毫秒字段、Bark 分组 / TTL 和当前 `version`。商品信息 `product` 和通知凭据分别由程序与环境变量管理。保存设置：

```sh
curl --silent --show-error --fail-with-body \
  -X PUT -H 'Origin: http://localhost:8088' \
  -H 'Content-Type: application/json' \
  --data-binary @local/settings.json \
  http://localhost:8088/api/settings
```

由 Agent 准备和解析 JSON。没有 curl 时，通过 `docker compose exec -T monitor node --input-type=module` 使用内置 `fetch`，连接 `http://127.0.0.1:8080`；写请求的 Origin 取 `process.env.PUBLIC_ORIGIN`。根据 HTTP 状态和响应内容处理结果。

409 版本冲突时重新 GET 设置，合并后保存；发现门店要求监控暂停、当前查询结束。429 时等待冷却截止时间，502 时检查采集诊断。通知动作按下一节测试。

## 7. 测试通知，再启动首轮查询

保持暂停，按用户选定的渠道各测试一次。电话测试会实际请求来电。

- Bark：点击“发送一次通知测试”或调用 `test-bark`，由用户确认手机收到测试通知，点击可打开正确商品链接。
- 电话：启用电话开关，点击“拨打一通测试电话”或调用 `test-irm`。检查 Grafana 的 TEST 分组、route、chain 和电话记录；用户接听后，在暂停状态下调用“清理电话分组” / `cleanup-irm`，确认待清理组为零、Grafana 组已 Resolved。

核对 `runtime.bark.state` / `runtime.irm.state` 和事件，并记录手机接收结果；HTTP 200 或 accepted 表示服务已处理请求。失败时按[通知故障排查](notifications.md#故障排查)处理，冷却结束后复测。手机接收待确认时保持暂停，列为交接待办。

通知验收完成，或用户选择无通知运行后，点击“恢复监控” / 调用 `resume`。自动查询在轮次之间随机等待：正常 60.001 至 179.999 秒，异常 180.001 至 599.999 秒；首次恢复也等待。“请求查询” / `query` 会提前到允许的最早时间：满足最短间隔即开始，否则等待下限或限流结束；查询中返回当前状态。

HTTP `query` 响应中的 `queryStatus=scheduled` 表示已提前排期，`started` 表示采集已发起，`busy` 表示已有轮次正在执行。随后从状态和历史读取本轮结果。

首轮查询结束后，核对状态与历史：

- 查询配置的商品、ZIP 和门店与用户要求一致，属于这次保存的版本。
- 历史 `outcome` 为 `complete`，所有所选门店状态均为 `available` 或 `unavailable`。
- `verification` 显示容器 Chromium 采集，商品和邮编校验通过，库存 HTTP 状态正常；`lastComplete` 已更新。
- 轮次结束后仍在监控，显示下一轮时间；出现错误时查看历史“执行步骤与网络异常”、事件或失败截图，排查后按正常等待复验。

有效的无货结果也通过验收。有货时按启用渠道提醒；每轮持续有货都会再次提醒 / 请求电话，买到后在管理页暂停监控。

若为适配环境修改了代码，按 README 完成相应自动检查，再做上述部署验收。

## 8. 交接与日常操作

| 交接内容 | 要包含的信息 |
| --- | --- |
| 位置与访问 | 部署主机、仓库路径、Compose 项目名、浏览器地址；远程需要的隧道命令 |
| 当前设置 | 商品选项、ZIP、门店名称、启用渠道 |
| 当前运行 | healthy 与重启情况、监控运行 / 暂停、首轮真实查询时间和结果、下一轮状态 |
| 通知证据 | 各渠道未启用 / 服务接受 / 用户确认收到；电话测试分组是否清理 |
| 数据与维护 | `.env` 位置、命名卷或绑定目录、暂停 / 恢复 / 更新 / 备份入口 |
| 未完成项 | 待办、已做的排查、用户下一步 |

可将本次部署的路径、访问方式、数据位置和验收结果保存在忽略的 `local/` 运维说明中。

日常操作优先管理页的“暂停监控 / 恢复监控”。暂停会保存且跨重启保留；停止容器不等于保存暂停，原先运行中的实例再启动会继续排期。常用容器命令：

```sh
docker compose ps
docker compose logs --tail 50 monitor
docker compose stop monitor
docker compose start monitor
```

`restart: unless-stopped` 提供容器自动重启。持续监控需要主机、Docker 和网络保持运行；检查 daemon / Desktop 的开机启动设置。

## 9. 已有安装、更新与故障处理

读取原设置与部署记录，记录源码版本、镜像标识、挂载来源和暂停状态。按 [README 的备份步骤](../README.md#4-历史更新与备份)暂停并停止服务，完成一致性数据备份，另外保留 `.env`，再修改配置或升级。

- 普通更新：保留并处理 Git 工作区修改，`git pull --ff-only` 后执行 `docker compose up -d --build`。ZIP 安装替换源码时保留 `.env`、原挂载配置和项目名。更新后核对原暂停状态与运行排期。
- 改通知凭据：修改目标机器的 `.env` 后执行 `docker compose up -d`，重新读取状态。更换 / 清空 Grafana Webhook 前，在原地址下清理待恢复组。
- 旧数据库凭据迁移：按 README 将旧凭据迁入环境变量后启动。旧家庭版数据库结构不同，使用单独的迁移方案。
- 绑定目录权限：使专用数据目录可由容器 UID / GID `1000:1000` 写入。默认命名卷自动处理权限。
- 启动失败：检查日志、退出 / 健康情况、资源与端口，沿用 Compose 的安全设置。profile 被占用时先停止原容器和浏览器。
- Apple 查询失败 / 限流：在部署容器内检查网络和采集诊断，按冷却时间重试。
- 恢复：使用备份、对应版本与 `.env`，按 README 恢复到空的目标存储，再启动服务。

`down -v` 会删除命名卷全部数据，绑定目录则保留；修改 `DATA_VOLUME` 只切换挂载来源。迁移数据按备份与恢复流程操作。

# iPhone Duo Monitor — AI Agent 入口

[中文](#中文) | [English](#english)

## 中文

本仓库用于监控 Apple 美国商店的 iPhone Duo 门店取货库存。收到安装或部署请求后，按 [Agent 配置与部署指南](docs/agent-setup.md)完成配置、启动、验收和交接。

### 工作入口

- [README](README.md)：功能、运行方式、存储、备份与更新。
- [Agent 配置与部署指南](docs/agent-setup.md)：首次使用的信息收集、环境检查、配置、部署、HTTP 操作及完成条件。
- [通知指南](docs/notifications.md)：Bark 和 Grafana IRM 的实际配置步骤、模板与排查。
- [验证记录](docs/verification.md)：已验证的环境与检查范围。

先检查部署主机、Docker context、已有实例和本地修改，集中补问缺失信息，其余步骤直接执行。

### 文档维护

README 和 `docs/` 下的说明文档同时维护中英文版本：中文保留现有文件名，英文使用 `.en.md` 后缀。修改或新增文档时，同步更新两种版本的操作步骤、命令、配置参数、验证结果和相关链接，并在页面顶部提供语言切换。本文件在同一份 `AGENTS.md` 中维护两种语言。

前端翻译集中在 `public/i18n.js`，新增或修改界面文案时同步维护中英文。

### 配置与运行

- 部署参数与通知凭据放在被忽略的 `.env`；商品、ZIP、门店和通知开关通过网页或 HTTP API 保存。
- 私人运维记录放在被忽略的 `local/`，凭据与运行数据不进入 Git 或公开输出。存在 `local/AGENTS.md` 时，按需读取其中的私人运维入口。
- 既有安装沿用原 `.env`、`compose.override.yaml`、Compose 项目名和数据挂载，保留本地修改，更新前按 README 备份。
- 库存采集使用 Docker 内的 Linux Chromium，沿用 Compose 的非 root 用户、沙箱、seccomp、共享内存和限流设置。宿主机 Node 用于开发检查。
- 默认监听 `127.0.0.1`，远程管理使用 SSH 转发。服务没有登录功能，`PUBLIC_ORIGIN` 与用户实际打开的地址保持一致。
- 用用户的商品和 ZIP 发现门店，再按其选择保存至少一家门店。
- 所选通知渠道各做一次实际测试，确认手机收到后启动监控，并完成首轮查询验收。

### 修改代码时

代码首先要便于人阅读：每行一个语句，变量声明分开，条件与循环使用花括号，按逻辑步骤留空行。不要压缩 HTML、CSS 或 JavaScript；运行 `npm run format` 整理排版，运行 `npm run format:check` 检查格式。

复用现有 Node.js / Playwright / SQLite 结构和锁定依赖。运行 `npm ci`、`npm test`；修改浏览器或容器行为时还要运行 README 中的 Docker 检查。自动化测试使用模拟通知，结果区分通过和跳过。

## English

This repository monitors iPhone Duo pickup availability at Apple US stores. For installation or deployment requests, follow the [agent setup guide](docs/agent-setup.en.md) through configuration, startup, verification, and handoff.

### Entry points

- [README](README.en.md): features, deployment, storage, backups, and updates.
- [Agent setup guide](docs/agent-setup.en.md): first-time setup, environment checks, deployment, HTTP operations, and completion criteria.
- [Notification guide](docs/notifications.en.md): Bark and Grafana IRM setup, templates, and troubleshooting.
- [Verification record](docs/verification.en.md): tested environments and check coverage.

Check the deployment host, Docker context, existing instances, and local changes. Ask for missing information together, and proceed with the remaining steps.

### Documentation maintenance

Maintain Chinese and English versions of the README and documentation under `docs/`. Keep the existing filenames for Chinese and use the `.en.md` suffix for English. When adding or changing documentation, update both versions together, including procedures, commands, configuration parameters, verification results, and related links. Add language-switch links at the top of each page. Keep both language versions of these agent instructions in this single `AGENTS.md` file.

Frontend translations live in `public/i18n.js`. Maintain both languages when adding or changing interface text.

### Configuration and operation

- Store deployment parameters and notification credentials in the ignored `.env`. Save the product, ZIP code, stores, and notification switches through the dashboard or HTTP API.
- Keep private operations notes in the ignored `local/` directory. Credentials and runtime data stay out of Git and public output. If `local/AGENTS.md` exists, read its private operations pointers as needed.
- For existing installations, retain the original `.env`, `compose.override.yaml`, Compose project name, data mount, and local changes. Back up before updating, following the README.
- Collect inventory with Linux Chromium inside Docker, using the Compose settings for the non-root user, sandbox, seccomp, shared memory, and rate limits. Host Node.js is for development checks.
- Bind to `127.0.0.1` by default and use SSH forwarding for remote management. The service has no login; `PUBLIC_ORIGIN` must match the address opened by the user.
- Discover stores using the user's product and ZIP code, then save at least one store from their selection.
- Test each selected notification channel once, confirm receipt on the phone, then start monitoring and verify the first query.

### Code changes

Keep code human readable: use one statement per line, separate variable declarations, brace conditionals and loops, and separate logical steps with blank lines. Do not compress HTML, CSS, or JavaScript. Run `npm run format` to format the code and `npm run format:check` to check it.

Use the existing Node.js / Playwright / SQLite structure and locked dependencies. Run `npm ci` and `npm test`; changes to browser or container behavior also need the Docker checks in the README. Automated tests use simulated notifications. Report passed and skipped tests separately.

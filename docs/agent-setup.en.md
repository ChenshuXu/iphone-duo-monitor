# AI agent setup and deployment guide

[中文](agent-setup.md) | [English](agent-setup.en.md)

Complete configuration, deployment, and the first inventory query on the user's chosen machine. The user supplies purchase preferences, the deployment target, and notification accounts, and helps with phone verification.

Select Chinese or English in the dashboard header. The first visit follows the browser language, and a manual choice persists in that browser.

Run the commands below from the repository root on the deployment machine, using a POSIX shell. On Windows, use a WSL terminal connected to Docker Desktop.

## 1. Inspect the environment and collect missing information

Read [AGENTS.md](../AGENTS.md), the [README](../README.en.md), and [.env.example](../.env.example). Read the [notification guide](notifications.en.md) after the user selects channels.

Inspect the system, CPU, Docker, ports, available resources, and existing configuration yourself. Obtain the following from the conversation or saved configuration, and ask for missing items together:

| Information | Required answer |
| --- | --- |
| Deployment target | This computer or a specified always-on server / NAS / VM; remote deployment needs SSH or a target terminal and a destination directory |
| Product | Five-digit US ZIP code, color, capacity, and carrier; preserve leading zeros in ZIP codes |
| Stores | Named stores, selection after discovery, or all nearby stores returned for the ZIP code |
| Notifications | Bark, Grafana IRM phone calls, both, or dashboard only |

Use the `options` returned by `/api/settings`. Current choices are Star White / Night Sky; 256GB / 512GB / 1TB / 2TB; and AT&T / T-Mobile / Verizon / Connect to any carrier later.

Default to one instance, a named volume, host port `8088`, and SSH forwarding. Complete the remaining configuration below. When the user needs to log in, enter credentials, or receive a notification, give them the specific action and continue other preparation.

## 2. Identify the deployment machine and instance

Run on the target machine:

```sh
pwd
docker version
docker compose version
docker context show
docker info --format 'OS={{.OSType}} Arch={{.Architecture}} Memory={{.MemTotal}}'
docker compose ls
```

Handle the findings as follows:

- Docker missing: install Linux Engine and the Compose plugin using the [official Docker Engine instructions](https://docs.docker.com/engine/install/), or install and start [Docker Desktop](https://docs.docker.com/desktop/) on a desktop system with Linux containers. Have the user complete administrator actions or system restarts, then continue.
- Docker unavailable: check the daemon / Desktop, user permissions, and Docker context, and connect to the chosen deployment host.
- Resources and architecture: reserve at least 2 GiB of available memory and check disk space for the build. Linux x86_64 Docker has been verified. On Apple Silicon (arm64), the image builds and the automated tests pass. Follow this procedure to verify live Apple queries there and on the user's Windows or NAS environment.
- Remote server: clone or transfer the source into the target directory over SSH / a terminal, then configure `.env`, build, and start on that machine.
- ZIP download: extract it and enter the directory containing `compose.yaml`, `Dockerfile`, and `seccomp_profile.json`. Git is not required.

Check existing `.env`, `compose.override.yaml`, containers, and data mounts. For Git checkouts, also run `git status --short`. Data defaults to a Docker named volume; `DATA_VOLUME` can select a bind directory instead.

For an existing instance, back up and update using section 9. Retain the same directory, Docker context, Compose project name, mount source, and any original `-p`, `-f`, or `--env-file` arguments.

## 3. Prepare .env and the access address

Create `.env` for a new installation, or retain the existing file:

```sh
umask 077
if [ ! -e .env ]; then
  cp .env.example .env
fi
chmod 600 .env
```

Edit for the user's choices. Notification credentials can be entered later; the first startup remains paused:

| Variable | First-time setup |
| --- | --- |
| `PUBLIC_ORIGIN` | Defaults to `http://localhost:8088`; must match the browser's scheme, host, and port, with no path or trailing slash |
| `BIND_ADDRESS` | Defaults to `127.0.0.1` for access from the deployment machine |
| `PORT` | Host port, default `8088`; update `PUBLIC_ORIGIN` when changing it. The container still uses `8080` |
| `DATA_VOLUME` | Defaults to `monitor-data`; Compose creates persistent storage. No manual database or `data/` directory setup is needed |
| `BARK_KEY` | Bark device key when using Bark |
| `GRAFANA_IRM_WEBHOOK` | Full HTTPS URL of the dedicated incoming Webhook when using phone calls |
| `GRAFANA_IRM_HOST` | Usually empty; for an explicit host pin, use the Webhook URL's exact hostname |

The agent prepares configuration, and the user enters credentials in `.env` on the target machine or through a secure input. Keep credentials out of Git, chat, and public output. Use `docker compose config --quiet` to validate configuration. Compose reads `.env` automatically.

Save the product, ZIP code, stores, and channel switches through the dashboard or API later. Notification credentials come from environment variables.

Use SSH forwarding for remote access by default. On the user's computer, replace the SSH user and server and start the tunnel:

```sh
ssh -N -L 8088:127.0.0.1:8088 your-user@your-server
```

Open [http://localhost:8088](http://localhost:8088) on the user's computer. The server's `PUBLIC_ORIGIN` remains that address. Closing the tunnel ends management access while server monitoring continues. If the local port is occupied, choose another tunnel port and match `PUBLIC_ORIGIN` to the final browser address.

For a local deployment port conflict, choose an unused port, such as `8089`, and update both `PORT` and `PUBLIC_ORIGIN`. The hostname, including the choice of `localhost` or `127.0.0.1`, must also match.

For direct LAN / private VPN access, use the [README access instructions](../README.en.md#lan--vpn-access). The service has no login; public access needs HTTPS, authentication, and access control.

## 4. Configure the selected notification channels

Bark: follow the [Bark instructions](notifications.en.md#bark-push-notifications) to install the official app, allow iOS notifications, obtain the `api.day.app` device key, and save it in `.env`. Bark-only setups do not need Grafana. Bark uses ordinary notifications; configure silent and Focus behavior on the phone.

Grafana IRM phone calls: follow the [phone instructions](notifications.en.md#grafana-cloud-irm-phone-calls) to configure:

1. The user's Cloud stack, IRM permissions, and verified phone number.
2. One immediate Phone call rule for the recipient.
3. An escalation chain selecting that user and rule set.
4. A dedicated incoming Webhook integration and its receiving URL.
5. The grouping, resolution, display, and phone templates in the notification guide, plus source-based auto resolution.
6. The integration's Default Route pointing to the chain, with Maintenance / Silence off.
7. The full Webhook in `.env`, followed by a test from this project.

If a logged-in browser is available, the agent configures this project's integration. Otherwise, provide the exact page and values for the user, then continue. The user handles login, SMS verification, phone permissions, and answering calls. Use a dedicated integration and escalation chain; quotas, fees, and supported regions depend on the user's account.

Leave unused channels' credentials empty and switches off. For dashboard-only operation, disable both channels.

## 5. Build and start the paused service

```sh
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
docker compose ps
docker compose logs --tail 50 monitor
```

`config --quiet` validates configuration without printing credentials. The first build downloads the browser base image; `--wait-timeout` bounds the wait for service readiness after the build. If Compose lacks `--wait`, use `docker compose up -d --build`, then check `ps` until healthy. See the [Compose up reference](https://docs.docker.com/reference/cli/docker/compose/up/).

Check that the container is healthy and its restart count is stable. The HTTP service is now ready for product configuration and query / notification tests. A fresh volume starts paused, with credentialed channels enabled. An existing database keeps its switches and pause state.

Read status using Node.js inside the container:

```sh
docker compose exec -T monitor node --input-type=module <<'JS'
const response = await fetch('http://127.0.0.1:8080/api/status');
if (!response.ok) throw new Error(`Status check failed: HTTP ${response.status}`);
const { config, runtime } = await response.json();
console.log(JSON.stringify({
  confirmed: config.confirmed, paused: runtime.paused, phase: runtime.phase,
  barkConfigured: config.barkConfigured, barkEnabled: config.barkEnabled,
  irmConfigured: config.irmConfigured, irmEnabled: config.irmEnabled,
  lastComplete: runtime.lastComplete, stores: runtime.stores
}, null, 2));
JS
```

Open the user's actual management address and confirm that the dashboard says connected (已连接) and settings load. If it fails, check the address, tunnel, and firewall.

After editing `.env`, run `docker compose up -d` to recreate the container and refresh the page. `restart` keeps the old environment. When adding credentials to an existing database, also save the dashboard channel switch. If old values persist, check extra Compose files and exported shell variables.

## 6. Discover stores and save settings

Use the dashboard for these steps, or the HTTP API below.

1. Confirm that monitoring is paused and the current query has finished. A new installation already starts paused.
2. Enter the user's ZIP code, color, capacity, and carrier. Keep the default wait ranges, Bark group, and TTL unless the user requests changes.
3. Click **Read nearby stores (读取附近门店)** and wait for completion. Chromium in the deployment container queries Apple for that product and ZIP code. This usually takes tens of seconds and can take a few minutes.
4. Select the requested stores. Select all if the user chose all nearby stores; otherwise provide the actual names for selection.
5. Check channel switches and click **Save settings (保存设置)**. Reload and confirm the product, ZIP code, stores, and switches. `confirmed` should be true, with monitoring still paused.

If a requested store is absent from Apple's result, provide the actual list for the user to adjust. Discovery waits 60 seconds after success, 180 seconds after failure, or longer when `Retry-After` requires it. Inspect diagnostics for page validation failures; inventory remains unknown.

### HTTP operations without a browser

The API shares the dashboard address. For host requests, the URL's Host must match `PUBLIC_ORIGIN`. Write requests need `Origin: <PUBLIC_ORIGIN>` and `Content-Type: application/json`.

| Request | Input and purpose |
| --- | --- |
| `GET /api/status` | Read configuration, pause state, channels, store results, and events |
| `GET /api/settings` | Read complete settings, `version`, `options`, and credential-configuration booleans |
| `POST /api/discover` | Send string fields `zip`, `color`, `capacity`, and `carrier`; returns `catalog` and verified `product`, without saving settings |
| `PUT /api/settings` | Merge the target, discovered `catalog`, selected store ID array `stores`, and switches into the current complete settings. Include the current `version`; a successful save increments it |
| `POST /api/control` | Send `{"action":"..."}`; supports `pause`, `resume`, `query`, `test-bark`, `test-irm`, and `cleanup-irm`. Legacy recovery actions are separate from first-time setup |
| `GET /api/history` | Read monitoring rounds, including outcome, config, stores, verification, and diagnostics. Store discovery is excluded. `days=all` includes permanently retained rounds with stock |
| `GET /api/event-log` | Page through events. `type` is empty, `stock`, `notify`, `error`, or `nonquery`; pass the previous page's `nextCursor` as `before` |

Create `local/` and write the user's four target fields to `local/target.json`, using this format:

```json
{"zip":"90210","color":"nightsky","capacity":"512gb","carrier":"unlocked"}
```

Color keys are `starwhite` / `nightsky`; capacities are `256gb` / `512gb` / `1tb` / `2tb`; carriers are `att` / `t-mobile` / `verizon` / `unlocked`. Use the current `options` for name-to-key mappings.

Discover stores with curl. This example uses the default address; replace the URL and Origin to match the deployment:

```sh
curl --silent --show-error --fail-with-body --max-time 300 \
  -H 'Origin: http://localhost:8088' \
  -H 'Content-Type: application/json' \
  --data-binary @local/target.json \
  http://localhost:8088/api/discover
```

Merge the returned `catalog`, selected stores, and target into the complete current settings, and write `local/settings.json`. Include setting fields, keeping the four wait values in milliseconds, Bark group / TTL, and current `version`. The program manages `product`; environment variables manage credentials. Save:

```sh
curl --silent --show-error --fail-with-body \
  -X PUT -H 'Origin: http://localhost:8088' \
  -H 'Content-Type: application/json' \
  --data-binary @local/settings.json \
  http://localhost:8088/api/settings
```

The agent prepares and parses JSON. Without curl, use built-in `fetch` through `docker compose exec -T monitor node --input-type=module` and connect to `http://127.0.0.1:8080`. Set the write request Origin to `process.env.PUBLIC_ORIGIN`. Handle both the HTTP status and response content.

For a 409 version conflict, GET current settings again, merge, and save. Discovery needs paused monitoring and a finished query. For 429, wait until the cooldown deadline; for 502, inspect collection diagnostics. Test notifications as described next.

## 7. Test notifications and run the first query

Keep monitoring paused and test each chosen channel once. The phone test requests a real call.

- Bark: click **Send one test notification (发送一次通知测试)** or call `test-bark`. Have the user confirm that it arrives and opens the correct product link.
- Phone: enable the phone switch, then click **Place one test call (拨打一通测试电话)** or call `test-irm`. Inspect Grafana's TEST group, route, chain, and call records. After the user answers, use **Clear phone alert groups (清理电话分组)** / `cleanup-irm` while paused. Confirm zero pending groups and Resolved status in Grafana.

Check `runtime.bark.state` / `runtime.irm.state` and events, and record phone receipt. HTTP 200 or accepted indicates that the service processed the request. Follow [notification troubleshooting](notifications.en.md#troubleshooting) for failures, then retest after cooldown. If phone receipt is pending, keep monitoring paused and include it in the handoff.

After notification verification, or if the user chose operation without notifications, click **Resume monitoring (恢复监控)** / call `resume`. Automatic queries wait randomly between rounds: 60.001 to 179.999 seconds normally, or 180.001 to 599.999 seconds after errors; initial resume also waits. **Request query (请求查询)** / `query` advances to the earliest allowed time: immediately after the minimum interval, or when the wait / rate limit ends. During a query, it returns the current state.

In the HTTP response, `queryStatus=scheduled` means the query has been scheduled earlier, `started` means collection began, and `busy` means a round is already running. Read status and history afterward for the result.

After the first round, verify:

- Its product, ZIP code, stores, and saved configuration version match the user's choices.
- History has `outcome=complete`, with every selected store `available` or `unavailable`.
- `verification` identifies container Chromium collection, successful product / ZIP checks, and a successful inventory HTTP status; `lastComplete` has advanced.
- Monitoring remains active with a next-round time. For errors, inspect execution steps and network errors (执行步骤与网络异常), events, or failure screenshots, then verify again on the normal schedule.

A valid unavailable result passes verification. Available stock triggers enabled channels; each round with continuing availability sends another notification / call request. Pause in the dashboard after buying.

If you changed code for environment compatibility, run the README's relevant automated checks before completing deployment verification.

## 8. Handoff and everyday operation

| Handoff item | Include |
| --- | --- |
| Location and access | Deployment host, repository path, Compose project name, browser address, and remote tunnel command |
| Settings | Product options, ZIP code, store names, and enabled channels |
| Operation | Health and restart status, active / paused monitoring, first query time and result, and next round |
| Notifications | Each channel's disabled / accepted / receipt-confirmed status, and whether test phone groups were cleared |
| Data and maintenance | `.env` path, named volume or bind directory, and pause / resume / update / backup instructions |
| Pending work | Remaining tasks, investigation completed, and the user's next action |

Optionally save deployment paths, access instructions, data location, and verification results in ignored `local/` operations notes.

Use the dashboard's **Pause monitoring (暂停监控)** / **Resume monitoring (恢复监控)** controls for daily operation. Pause state persists across restarts. Stopping a container alone does not save a pause; a previously active instance resumes its schedule on startup. Common container commands:

```sh
docker compose ps
docker compose logs --tail 50 monitor
docker compose stop monitor
docker compose start monitor
```

`restart: unless-stopped` restarts the container automatically. Continuous monitoring needs the host, Docker, and network to stay running; check the daemon / Desktop startup settings.

## 9. Existing installations, updates, and troubleshooting

Read the existing settings and deployment notes, and record the source revision, image ID, mount source, and pause state. Follow the [README backup procedure](../README.en.md#4-history-updates-and-backups) to pause, stop, and create a consistent backup. Keep `.env` separately, then change configuration or update.

- Routine update: retain and handle local Git changes, run `git pull --ff-only`, then `docker compose up -d --build`. ZIP installations replace source while retaining `.env`, mounts, and project name. Check the previous pause state and query schedule afterward.
- Credential change: edit `.env` on the target and run `docker compose up -d`, then read status. Before replacing / clearing a Grafana Webhook, resolve pending groups at the original address.
- Legacy credential migration: move old credentials to environment variables following the README, then start. The old family edition uses a different database schema and needs a separate migration.
- Bind-directory permissions: make the dedicated data directory writable by container UID / GID `1000:1000`. Default named volumes handle permissions automatically.
- Startup failure: inspect logs, exit / health status, resources, and ports while retaining Compose's security settings. For an occupied profile, stop the original container and browser first.
- Apple failures / rate limits: inspect the network and collection diagnostics inside the deployment container, then retry after cooldown.
- Restore: use the backup, matching version, and `.env`. Restore into empty target storage following the README, then start.

`down -v` deletes all named-volume data while retaining bind directories. Changing `DATA_VOLUME` only switches the mount source. Use backup and restore to migrate data.

# Verification record

[中文](verification.md) | [English](verification.en.md)

Initial release checks: 2026-10-26. Later checks are recorded in the entries below.

## Automated checks

- The Linux x86_64 Docker image built successfully. A fresh Compose named volume started without private bootstrap files.
- All 31 tests passed in the deployment image, including a delayed-rendering regression using real sandboxed Chromium, with no skips.
- Local Node.js checks passed; browser tests skipped as expected outside Linux Docker.
- Coverage includes all 32 color / capacity / carrier configurations, valid ZIP codes and store catalogs, invalid option rejection, stale-result invalidation after product changes, and updated purchase links / notifications / history.
- Coverage includes pause and restart, random waits and Retry-After, partial unknown results, simulated continuing-stock notifications, independent phone cooldown and recovery, history pagination / 60-day pruning / interruption.
- HTTP checks cover fresh startup, settings saves, version conflicts, cross-origin / non-JSON write rejection, and credentials excluded from status / settings / history responses.
- Tests use fictional credentials and simulated notification senders, without requests to real notification services.

## Live Apple page checks

- Checked two colors, four capacities, and four carrier choices on the Apple US purchase page.
- Used an isolated empty data volume with `ZIP 90210 / Night Sky / 512GB / Connect to any carrier later`.
- Store discovery returned 12 stores near Los Angeles and dynamically read product number `MK1H4LL/A`.
- Selected Beverly Center and Century City in the dashboard. Saving updated the product title, purchase link, ZIP code, and monitored stores. After resuming, one real query completed with both stores unavailable, and history retained the matching product and ZIP code. The test instance was then paused.

## Verification scope

- All 32 combinations have configuration and URL unit coverage. Live browser collection used the example above.
- Notifications use simulated senders. Phone delivery, repeated calls, silent mode, and Focus behavior need testing after deployment.
- ARM64 / Apple Silicon, different Windows / NAS kernel policies, long-term stability, full-host outage alerts, and compatibility with future Apple page changes were not verified.

## 2026-10-29 Shared code integration checks

- Integrated pickup entry handling, ZIP prefill waits, product-page redirect recovery, and structured diagnostics while retaining dynamic product and store discovery. Redirect regression used Night Sky / 512GB / Connect to any carrier later and read the product number from the dialog.
- Locally, 32 of 36 tests passed and 4 Docker browser tests skipped. An isolated container on VM101 passed all 36 without skips. It reused the deployed image's pinned dependencies and mounted the updated code, with no production data or external network access; the production image was not replaced.
- Compose validation passed. Checked Git exclusions for private directories, environment files, and data, plus migration documentation links.

## 2026-10-29 Six README review fixes

- Backup now uses a private temporary file and replaces the old archive atomically only after successful, nonempty output. Failures exit nonzero and preserve the previous archive. Bark and phone cooldowns use actual deadlines across restarts and channel switches. Paused monitoring supports phone-group cleanup and separate confirmation for legacy permanent-pause recovery. Discovery cooldown begins after completion. README and notification instructions cover these changes and both storage types.
- Added 10 regression tests, bringing the suite to 46. Locally, 41 passed and 5 Docker browser tests skipped. A final isolated Linux x86_64 image built successfully and passed all 46 without skips. Browser regressions used real sandboxed Chromium with simulated pages, without live Apple requests.
- [Backup tests](../test/operations.test.cjs) extract and execute the README command. They cover stop failures, export failures, empty output, successful replacement, and permissions. Docker calls are simulated and do not read production data.
- [Storage verification](../test/storage.test.sh) used isolated named volumes and bind directories in real Docker. Both passed: `down` kept named-volume data, while `down -v` removed it; bind data survived both. Temporary containers, volumes, directories, and test image tags were removed.
- Final isolated image digest: `sha256:f9867da74c79815822678864a872453921a1a702aa6aba1b00426ef99120f1ee`. Tests mounted no production data and ran without external network access. VM101's production image, startup time, and zero-restart count remained unchanged and healthy.
- Migrating the older family-edition database remained a separate prerequisite for the production upgrade.

## 2026-10-29 Notification environment variables

- Bark keys and full Grafana Webhooks now come from Compose's `BARK_KEY` / `GRAFANA_IRM_WEBHOOK`; optional `GRAFANA_IRM_HOST` pins the host. The dashboard retains switches, status, group / TTL, and tests while removing credential inputs. The API rejects credential edits.
- On a fresh volume, credentialed channels default to enabled and monitoring stays paused. Existing installations retain switches and cooldowns. Credentials follow the process environment. Migration stops if legacy credentials have not been supplied through the environment, and pending phone groups block Webhook changes. The stored recovery destination is represented by a hash.
- Locally, 45 of 50 tests passed and 5 Docker browser tests skipped. A new Linux x86_64 image, `sha256:a5aa9587381175d4d16920f19d68263d2f7776ab78563b131c5d19c384c13ccb`, passed all 50 without skips.
- An isolated Compose project injected fictional credentials from a temporary `.env` and started on an empty named volume. The API confirmed configured, enabled channels with monitoring paused. API responses and SQLite state JSON contained no plaintext credentials. Test containers, volumes, networks, and image tags were removed afterward.
- Checked the private `.env` Compose injection and permissions, and confirmed real credentials were within ignored files. VM101 remained healthy, retaining its image, startup time, and zero-restart count. Old databases and backups remain sensitive files.

## 2026-10-29 Existing installation upgrade

- Deployed the environment-based credential version to the existing Docker instance using the image that passed the 50-test isolated regression. Preserved the original image, code, complete data, and a consistent SQLite backup before stopping, and prepared a rollback script.
- Added product options and the store catalog to a copy of the old personal configuration before the production migration. Configuration version, stores, pause state, and both switches retained their original values. The complete digest of old query records matched the pre-migration digest.
- Browser verification confirmed credential inputs were removed, environment configuration status was visible, and SSE updates worked. The container was healthy, with zero restarts and no OOM.
- On the normal random schedule, container Chromium completed one real Apple query in about 14.1 seconds with HTTP 200. All five selected stores returned valid results, and product / carrier / ZIP checks matched. Private deployment and rollback details remain in the ignored operations directory.
- Follow-up notification checks: continuing-stock alerts, phone silent / Focus behavior, and high-frequency provider limits.

## 2026-10-29 Request query button

- Fixed a button that only logged an event without querying or changing the schedule. It now starts immediately once the minimum interval has elapsed, otherwise moves the countdown to the earliest allowed time. During an active query, it returns current state. Repeated clicks add neither concurrency nor delay.
- Regression coverage includes timer-triggered collection, manual starts and concurrency, persistent minimum intervals, error retries, Retry-After preserved across target changes, shared discovery cooldown, and three API / dashboard responses. The round's configuration is updated when collection starts.
- Locally, 47 of 53 tests passed and 6 Docker browser tests skipped. Linux Docker image `sha256:e0f1fef1e223d0c58936ff9b48411025f11b1f8f10ff44c5705ba9b56c28075f` passed all 53 without skips. Tests used isolated data and simulated pages with no external network or notification service access.
- The same image was deployed, retaining health, settings, pause state, credentials file, and the digest of all old queries. Browser checks confirmed the new script and current configuration. The instance retained the user's paused state. Private backup and rollback locations remain in ignored operations notes.

## 2026-10-29 AI agent deployment instructions

- Added the public [agent entry](../AGENTS.md) and [setup guide](agent-setup.en.md), with a copyable request in the README. They cover environment checks, local / remote deployment, notifications, dashboard / HTTP configuration, the first real query, operations, and existing-installation handling. Private maintainer pointers remain ignored.
- Checked 24 local links and anchors, syntax for 8 shell blocks, and public / private ignore rules. Executed the documented `.env` creation command in a temporary directory and confirmed permissions `0600` and preservation of existing content on repeat execution.
- Ran the exact documented read-only status command against a fresh HTTP service with isolated temporary data. It confirmed unconfigured channels, an unconfirmed target, and paused monitoring, without Apple or notification requests.
- The workspace's Node.js suite passed 47 of 53 tests, with 6 Docker browser tests skipped on the local host. A full first-time deployment still needs verification on another fresh host.

## Chinese and English dashboard

- The header switches between Chinese and English. The first visit follows browser language, and a manual choice persists in that browser. Labels, status, history, diagnostics, events, errors, and confirmation dialogs are translated. Dates and numbers use the selected language and browser-local time zone. Translations live in `public/i18n.js`; stored history and API data formats are unchanged.
- Added [language and copy checks](../test/i18n.test.cjs) and a [browser regression](../test/browser.test.cjs) covering browser defaults, saved choices, static and accessibility labels, history and nested failures, draft preservation, version-conflict messages, and language switches that neither write settings nor mark a stale connection as fresh.
- An isolated Linux x86_64 image built successfully and passed all 57 tests without skips. It used a non-root user, real sandboxed Chromium, simulated pages, and separate data, with external networking disabled.
- Ego Browser checked language switching, retained drafts, and layout on an isolated test service. Desktop and 390px views had no horizontal overflow. The README, agent guide, and this record are maintained in both languages.
- Deployment status: deployed to the existing production instance on 2026-10-30. The service is healthy, with settings, pause state, credentials, and the query-history digest preserved. All 57 isolated Docker tests passed without skips before deployment, along with named-volume and bind-directory storage checks. After deployment, an isolated instance using the same image completed a live Apple query with valid results for every target store, without sending notifications or changing production monitoring state.

## 2026-10-30 full-project review fixes

- Fixed six issues: aborted uploads or invalid request URLs terminating the service, phone alerts racing with group cleanup, concurrent Bark responses overwriting rate-limit deadlines, discovery and mutation guards becoming stale while reading request bodies, notification state commit failures being misreported as network errors, and a failed initial status request preventing automatic dashboard recovery.
- Bark and phone operations use separate shared request queues. Phone cleanup waits for an in-flight alert, retaining groups and actual cooldown deadlines on failure. Queued stock notifications are cancelled after pausing, stopping, or configuration changes. Storage failures propagate to the existing service failure handling.
- Added eight regressions covering request ordering during pause / disabling calls / shutdown, failed group retention, both Bark response orders and persisted cooldowns, queued notification cancellation, commit failures in all three notification paths, three kinds of aborted uploads, overlapping discovery and mutations, and browser recovery after the first status request and event stream fail.
- Of 65 local tests, 57 passed and eight Linux Docker browser tests skipped as expected. Formatting and diff whitespace checks passed. A new isolated Linux x86_64 image built successfully and passed all 65 tests without skips. Browsers used real sandboxed Chromium, with external networking disabled and only simulated Apple pages, notification senders, and separate test data.
- Compose configuration validation passed, along with both named-volume and bind-directory storage checks. Temporary storage-test containers, volumes, and directories were cleaned up.
- Deployment status: all six fixes were deployed to the existing production instance on 2026-10-30. All 65 tests were rerun against the release image and passed without skips, along with both storage checks. Full configuration, pause state, notification switches, environment and Compose override files, mount source, and the complete history digest were retained. SQLite quick_check returned ok; the service is healthy with zero restarts and no OOM.
- The production HTTP service returns 400 for invalid request URLs and continues serving status after an aborted upload, without changing configuration or history. Ego Browser verified language switching on the actual dashboard. Simulating a failed initial status request inside the browser still allowed the event stream to restore the interface without a manual reload.
- After deployment, an isolated container using the same image and temporary data completed one live Apple query with HTTP 200. Product, carrier, ZIP, and all four target stores matched; all four stores were unavailable. No production data or notification credentials were mounted, no real notifications were sent, and no production history was added. Production monitoring remains in its original paused state.

## 2026-11-03 stock alert and empty dialog fixes

- A history review found 66-byte stock alert IDs, above the 64-byte APNs collapse ID limit. Bark reports these rejections as HTTP 500. Test and fault notices use shorter IDs, so they did not expose the issue. Stock alerts now use `store number-round UUID`, 41 bytes in total, with a length regression across all 32 product combinations.
- When a stock alert fails and the cooldown is 10 seconds or less, the round retries up to twice with the same ID. Regressions cover a successful retry, the attempt limit, cancellation on pause and shutdown, and HTTP 429 or a longer `Retry-After` not being bypassed. Test notifications and stock alerts share one ID helper.
- The pickup dialog occasionally opens without loading stores. Across 4,205 successful queries the longest wait was 1.45 seconds, while all 49 failures waited the full 90 seconds. The initial result wait is now 15 seconds; on timeout the dialog is closed and reopened once, and the query fails only if that also times out. After an Apple HTTP error the dialog is not reopened, so `Retry-After` is honored.
- Of 72 local tests, 63 passed and nine Linux Docker browser tests skipped as expected. The release image passed all 72 tests without skips in an isolated container, along with both named-volume and bind-directory storage checks.
- With the first wait forced to time out in an isolated container, the real Apple page completed the close, reopen, and query: HTTP 200, product and ZIP checks passed, and all five stores returned valid results. Whether reopening recovers a dialog that Apple leaves empty on its own depends on later production records.
- Deployment status: deployed to the existing production instance on 2026-11-03. Configuration, pause state, credentials, mounts, and the query-history digest were preserved. SQLite quick_check returned ok, and the service is healthy with zero restarts and no OOM. After deployment, one Bark notification marked as a test, using the real stock ID format and fields, returned success.

## 2026-11-10 event and stock record retention

- Events were previously kept only as the latest 200 entries in the state JSON. At roughly one round every two minutes, they rolled off in under seven hours, so the Bark results for six stock rounds on the morning of 11-10 could not be checked. Events now live in a separate SQLite table and are retained for 30 days. Rounds that found stock, together with their inventory events and Bark / phone delivery results (including failures), are kept permanently. Only the latest 20 failure screenshots are still kept.
- The dashboard shows the latest 200 events live, filters by stock and alerts, notifications, errors, or hiding routine queries, and pages back through earlier events. Query history gains an All records range for stock rounds older than 60 days. A new paginated `GET /api/event-log` endpoint is available.
- On upgrade, events in the old state JSON migrate to the event table in their original order. Recognizable stock queries and stock Bark records are marked for permanent retention, and the events are then removed from the state JSON.
- Of 75 local tests, 66 passed and nine Linux Docker browser tests skipped as expected. In an isolated container without network access, the first run of the release image hit one ECONNRESET in an HTTP test; three reruns of that file and two full-suite reruns all passed 75 of 75 without skips. Named-volume and bind-directory storage checks passed. New regressions cover the 30-day boundary, permanent retention, the screenshot limit, paging, legacy event migration, stock rounds beyond 60 days, and marking of successful and failed stock alerts.
- Deployment status: deployed to the existing production instance on 2026-11-10. The service was stopped and backed up first. Configuration, runtime state, credentials, mounts, and the digest of 9,277 query-history rows were preserved, and SQLite quick_check returned ok. All 200 legacy events migrated, two of them marked as permanent stock records. The live dashboard was checked for both languages, type filters, and loading earlier events. The first query after restart completed successfully with Apple HTTP 200, and all five stores were unavailable.

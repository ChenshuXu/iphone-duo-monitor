# Bark notifications and Grafana phone calls

[中文](notifications.md) | [English](notifications.en.md)

The two channels work independently. Keep monitoring paused while configuring and testing receipt on your phone, then resume. Use your own keys, Webhook, domain, and number, and keep them out of GitHub and Issues.

## Bark push notifications

### Install Bark and get the device key

1. Install **Bark** from the iPhone App Store, using the official [Finb/Bark project](https://github.com/Finb/Bark) to identify the app. Open it and allow notifications.
2. In iPhone Settings → Notifications → Bark, enable notifications and your preferred sound, lock-screen, Notification Center, and banner options.
3. Bark shows an example push URL such as `https://api.day.app/YOUR_DEVICE_KEY/测试内容`. Copy only `YOUR_DEVICE_KEY` into this project, excluding the rest of the URL, message, and slashes.
4. This version connects to official `api.day.app`. If your app uses a self-hosted server, switch to the official server and obtain its device key.

### Configure and test

1. Set `BARK_KEY='YOUR_DEVICE_KEY'` in `.env`, using the device key alone.
2. Run `docker compose up -d` to recreate the container with the new environment. A fresh database enables credentialed channels while keeping monitoring paused. Existing databases retain switches; select **Enable Bark (启用 Bark)** and save if needed.
3. Select the product, ZIP code, and stores. Keep the Bark group as `iphone-duo`. Message retention in seconds (历史保留（秒）) defaults to 600 and accepts 1 to 86400.
4. Click **Send one test notification (发送一次通知测试)** and confirm to send an ordinary notification marked as a test. A configured key permits manual testing even with automatic Bark notifications disabled; channel cooldown still applies.
5. Confirm receipt on the iPhone and tap the notification to open the selected Apple product page. The dashboard shows configuration status; credentials are managed through `.env`.

The request uses ordinary `level=active` notifications with the purchase URL. Sound and display follow the phone's silent, Focus, and notification settings. `ttl` controls Bark message archive retention. See the official [Bark API](https://github.com/Finb/bark-server/blob/master/docs/API_V2.md) for parameters.

Automatic operation sends one notification per explicitly available store per round. Continuing stock produces repeated reminders. Unknown stores in failed rounds receive no stock alert. Messages include the product, store, check time, and purchase link. A running host with prolonged collection failures can send fault / recovery notices; a fully offline host cannot notify itself.

Failed Bark requests cause an independent 10-second cooldown, or until a longer `Retry-After` deadline. This deadline is separate from the inventory query error retry interval. The dashboard shows the deadline. Remaining stores in the round, fault notices, and manual tests honor it. Restarts and channel switches retain cooldown. Queries and phone calls continue independently. When a stock alert fails and the cooldown is 10 seconds or less, the round retries up to twice with the same notification ID after each cooldown; a longer `Retry-After` waits for the next round. Once the next round starts, notifications use fresh results rather than replaying old stock.

Bark forwards the notification `id` as the APNs collapse ID, which is limited to 64 bytes. APNs rejects longer values and Bark returns HTTP 500. Stock alerts use `store number-round UUID`, 41 bytes in total.

To change a key, edit `BARK_KEY` in `.env` and run `docker compose up -d`. To remove it, leave the variable empty and recreate the container; the channel disables automatically. Back up `.env` securely and separately from the data volume. If a key leaks, replace it in Bark and update `.env`.

## Grafana Cloud IRM phone calls

The phone path is **Grafana Cloud IRM incoming Webhook → escalation chain → personal Phone call rule**, using Grafana Cloud directly.

Use your own Grafana Cloud stack with IRM administration permissions. Start with the [IRM getting-started guide](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/get-started/). Fees, quotas, and supported regions depend on your current account and the [phone support documentation](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/notify-responders/phone-and-sms/).

The names below are suggestions. The recipient, rule set, and default route must connect to one another.

### A. Verify the recipient number

1. Open your Grafana Cloud stack and go to **Alerts & IRM → IRM**.
2. Open your avatar → **Profile → IRM / IRM settings**, then **Phone verification**.
3. Enter the international number as `+` followed by country code and number, without spaces, parentheses, or hyphens. Complete SMS verification. The number is stored in Grafana, not this project.
4. Use **Make test call** in your profile and answer it to confirm the number works. Test the project Webhook and routing in the later steps.

Page locations may change. See [notification channels](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/notify-responders/notification-channels/). If phone calls are unavailable, check that IRM enables the channel, the number is verified, and the region is supported.

### B. Set the personal phone rule

1. In the same IRM profile, open **Notification rules**.
2. Add an immediate **Phone call** to **Default notification rules**.
3. Use one immediate call for this purpose, without waits or repeats. If Default already handles other work, assess the effect on existing alerts or use a separate rule set and select it in the next step.
4. Save. The escalation chain must use this same rule set; this guide uses **Default**.

Verifying the number without adding a Phone call rule may leave alerts using email only. See [personal notification rules](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/notify-responders/personal-notification-rules/).

### C. Create the escalation chain

1. In **IRM → Escalation chains**, sometimes under Escalation / Routing, create `iPhone Duo Phone`.
2. Add one immediate **Notify users / Notify persons** step and select the user whose number you verified.
3. Select **Default notification rules**, matching the Phone call rule from step B.
4. Save this single-step chain. Schedules, team rotations, Wait, and Repeat are unnecessary for this setup.

The chain chooses the recipient; the recipient's personal rule chooses the phone channel. See [escalation chains](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/escalation-and-routing/escalation-chains/).

### D. Create a dedicated incoming Webhook

1. Go to **IRM → Integrations → Monitoring systems → Add integration**.
2. Choose **Webhook / Simple Webhook**, name it `iPhone Duo Pickup`, and assign a team if required by the account.
3. Copy the integration's **HTTP Endpoint / Webhook URL**, the incoming alert receiver. This differs from the browser's stack management address and outgoing webhooks.
4. This version authenticates with the token in that dedicated URL and sends no extra `Authorization` header. It does not support **Require a Grafana service account token**. If your organization requires that option, this version does not support the organization's setup.
5. Store the full URL in `GRAFANA_IRM_WEBHOOK` in the ignored `.env`, keeping it out of the repository, Issues, and screenshots.

See [integration configuration](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/integrations/configure-integrations/) and [incoming Webhooks](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/integrations/custom-integrations/incoming-webhooks/oncall-webhooks/) for creation and authentication options.

### E. Set grouping, resolution, and display templates

Under the integration's **Templates / Alert templates**, set and save each field. The interface may split them into Behavioral and Appearance groups.

| Field | Value |
| --- | --- |
| Grouping / Grouping ID | `{{ payload.group_key }}` |
| Auto resolution / Resolve condition | `{{ payload.get("state", "").upper() == "OK" }}` |
| Source link | `{{ payload.url }}` |
| Web title | `{{ payload.title }}` |
| Web message | `{{ payload.message }}` |
| Phone call title / Phone call message | `{{ payload.title }}` |

Enable **Auto resolution / Allow source-based resolving** if there is a separate switch. Leave automatic acknowledgment and extra immediate-resolution rules off. Phone speech should read `payload.title`, which contains stores and check time.

These templates use this project's JSON fields. Example test message:

```json
{
  "group_key": "iphone-duo-unique-round-id",
  "state": "alerting",
  "title": "TEST: iPhone Duo phone notification test. This is not a stock alert.",
  "message": "Test phone call",
  "url": "https://www.apple.com/shop/buy-iphone/iphone-duo"
}
```

Resolution sends `state=OK` with the same `group_key`. Group by that unique key, so the resolution event reaches the original group. In Grafana's template preview, check the title, grouping, and resolve expression using this payload; changing state to `OK` should make the resolve expression True. See the [template guide](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/escalation-and-routing/customize-alert-templates/).

### F. Bind the Default Route

In the `iPhone Duo Pickup` integration, open **Routes → Default Route**, select the `iPhone Duo Phone` escalation chain, and save to send incoming alerts through that chain. See [routing and escalation](https://grafana.com/docs/grafana-cloud/observe-and-act/respond-to-incidents/introduction/routing-and-escalation/).

Check that Maintenance / Silence escalations / Disable alerts are off and that a higher-priority route is not sending this payload elsewhere.

### G. Configure the full Webhook in .env

Enter your incoming Webhook in `.env`, replacing this placeholder:

```dotenv
GRAFANA_IRM_WEBHOOK='https://oncall-prod-REGION.grafana.net/integrations/v1/YOUR_TOKEN/'
```

The program derives the receiver host from the URL and accepts official `*.grafana.net` / `*.grafana.com` HTTPS addresses. Redirects, URL user information, fragments, and non-default ports are rejected. `GRAFANA_IRM_HOST` is optional and normally empty; if set, it must match the URL's exact hostname as an additional pin.

```sh
docker compose up -d
```

Refresh the dashboard and check that the phone channel is configured. A fresh database enables it while remaining paused. Existing installations with the switch off need **Enable phone (启用电话)** checked and saved. Credentials are edited in `.env` and applied by recreating the container; `restart` retains the old environment. The phone number remains only in Grafana.

### H. Test the full path from the dashboard

1. Keep monitoring paused, click **Place one test call (拨打一通测试电话)**, and confirm to send one phone test.
2. Find a new alert group beginning with TEST in the Grafana integration. Inspect its route, chain, user, and Phone call execution records.
3. Answer the phone and confirm the TEST message. **Service accepted (服务已接受)** indicates a successful Webhook response; answering the call completes delivery verification.
4. After the call is received and confirmed, keep monitoring paused and use **Clear phone alert groups (清理电话分组)**. Confirm Resolved in Grafana. Cleanup does not resume monitoring or request another call. Waiting until receipt avoids withdrawing a call before dispatch; test groups do not resolve immediately on their own.
5. Resume after verification. Each round resolves old groups before deciding whether fresh stock needs a new one.

Failed sends or cleanup cause an independent phone cooldown of 180.001 to 599.999 seconds, or a longer actual `Retry-After` deadline. It survives restarts and applies to testing and cleanup. While monitoring runs, later rounds retry cleanup after the deadline. While paused, fix the templates or service issue, wait until the displayed deadline, then clear groups. Bark and inventory queries continue independently.

If the dashboard explicitly reports a legacy pause (旧版遗留暂停), the old version did not save the original retry deadline and cannot recover automatically. Confirm in Grafana that the rate limit or fault is cleared, pause monitoring, and use cleanup with the separate recovery confirmation. This recovery applies only to legacy permanent pauses; regular cooldowns still use their deadlines.

Before replacing / deleting the Webhook in `.env`, pause and clear old groups at the original address. Pending groups cause startup with a different Webhook to fail. Restore the original `.env`, recreate the container, finish cleanup, then change it.

Each round with stock creates a new group and requests a call. **Pause monitoring after buying.** Keep the chain to a single call to avoid extra redials. Test with your usual silent, Focus, and call-filter settings to confirm receipt.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Host / Origin validation error | Match the browser address exactly to `PUBLIC_ORIGIN`, including scheme and port; recreate the container after changes |
| Bark unconfigured / invalid key | Set only the device key in `.env`, recreate the container, and confirm the official Bark server is selected |
| Bark accepted but absent on the phone | Check iOS permissions, network, notification summary, Focus, and device key; ordinary notifications honor silent settings |
| Phone switch disabled | Set `GRAFANA_IRM_WEBHOOK`, run `docker compose up -d`, and refresh; existing instances also need the channel switch enabled |
| Webhook host rejected | Use the full incoming Webhook and an exact matching `GRAFANA_IRM_HOST` if set, rather than a stack management link |
| Grafana HTTP 401 / 403 | Check the URL token and extra bearer-token requirement; this version sends no extra authentication header |
| Alert group exists but no call | Check Default Route, chain recipient, Default Phone call rule, number verification, and Maintenance status |
| Profile Make test call works, project test fails | Check incoming integration, templates, route, and chain; the profile test skips these |
| Test group remains Firing | Confirm the call arrived, keep monitoring paused, and clear groups; check grouping, resolve template, and Auto resolution |
| Bark / phone failure or HTTP 429 | Wait for the displayed cooldown deadline; tests, cleanup, and restarts retain it. The other channel and queries continue |
| Legacy phone pause | Confirm Grafana's rate limit has cleared, pause, and use cleanup with the separate recovery confirmation |
| Startup fails after changing Webhook | Restore the original `.env`, recreate the container, clear old groups, then change the Webhook |
| Legacy database credentials need migration | Back up, move the original key / Webhook to `.env`, and recreate; existing records remain intact before migration |
| Apple query UNKNOWN | Stock status is unknown. Inspect events, diagnostic screenshots, page changes, network, or Apple limits |
| No alert when the whole machine is offline | Requires a separate external heartbeat monitor, which this version does not include |

Project instructions checked on 2026-10-29. Third-party interfaces and service policies were last checked on 2026-10-26; consult the linked official documentation and your account's current settings.

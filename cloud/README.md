# P210 cloud dashboard

Deployed at **https://aferiy-p210-monitor.pages.dev**. This project contains the Cloudflare Pages site, Pages Functions API, and D1 database schema. The site is read-only and starts with no readings. A local MQTT receiver and uploader are still needed to feed it from the P210.

## Access

The dashboard password is stored locally at `C:\Users\finla\AppData\Local\AferiyMonitor\dashboard-password.txt`. It was randomly generated and installed as an encrypted Cloudflare Pages secret. The upload key is in `ingest-secret.txt` in the same private directory; `session-secret.txt` signs browser sessions. These files are outside the project and are restricted to the Windows user, SYSTEM, and Administrators. Do not commit or share them.

The BrightEMS API token supplied by the user is **not** deployed to Cloudflare. It belongs to the future local collector if needed for device discovery. The Cloudflare API credential was used for deployment only and is not stored in this project.

## Data path

```text
P210 → local MQTT broker → local collector/decoder → HTTPS POST /api/ingest
                                               Cloudflare D1 → /api/status, /api/history → dashboard
```

The `POST /api/ingest` endpoint requires `Authorization: Bearer <ingest-secret>`. Body format:

```json
{
  "device_id": "P210",
  "samples": [
    {
      "sample_id": "unique-message-id",
      "recorded_at": "2026-11-10T12:00:00Z",
      "charge_percent": 72.5,
      "input_w": 0,
      "output_w": 180,
      "ac_input_w": 0,
      "dc_input_w": 0,
      "remaining_minutes": 420,
      "grid_present": false,
      "discharging": true,
      "fault": false,
      "raw": { "battery_soc": 72.5 }
    }
  ]
}
```

The endpoint accepts up to 20 samples per request and ignores repeated `(device_id, sample_id)` pairs. The collector should supply a stable unique ID per original battery message, batch at a sensible interval, and omit credentials from `raw`. Readings must be no more than seven days old and no more than five minutes in the future. The site marks data stale after two minutes without an upload. These limits can be tuned after observing the P210's actual update rate.

Dashboard API routes require a signed, HttpOnly, SameSite=Strict cookie obtained through `POST /api/login`. The browser handles this automatically. The site is publicly reachable but battery readings require the password. The static sign-in page is visible to anyone with its URL.

## Project layout

- `public/`: responsive dashboard and history chart.
- `functions/api/`: login, status, history and protected ingest endpoints.
- `schema.sql`: D1 tables and index.
- `wrangler.jsonc`: Pages and D1 configuration, without secrets.
- `tests/`: endpoint/authentication checks.

## Local development and deployment

From this directory, run `npm install`, then `npm test`. For local D1, run `npx wrangler d1 execute aferiy-p210-monitor --local --file schema.sql`, create a Git-ignored `.dev.vars` with local values for `DASHBOARD_PASSWORD`, `SESSION_SECRET`, and `INGEST_SECRET`, then run `npm run dev`.

Pushing changes under `cloud/` to GitHub `main` runs the checks and deploys through [the GitHub Actions workflow](../.github/workflows/deploy-pages.yml). The production D1 database is `aferiy-p210-monitor` (ID in `wrangler.jsonc`); the workflow applies its schema before deployment. Keep production secrets in Cloudflare Pages settings, never in `wrangler.jsonc`. A manual deployment remains possible with `npx wrangler pages deploy public --project-name aferiy-p210-monitor --branch main` when the Cloudflare API token is present in the process environment.

## Remaining work

1. Confirm the P210 listed under BrightEMS Controlled Devices and prepare an MQTT broker reachable from the battery on the home network.
2. Capture and decode real telemetry, then build the local collector/uploader using the ingest contract above.
3. Compare every exposed value with the app, extending the dashboard and database for any additional fields actually reported.
4. Build the Windows tray monitor and low-charge alerts against `/api/status`.
5. Decide whether the local receiver should run on an always-on device so history continues when the Windows PC is off.


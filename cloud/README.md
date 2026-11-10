# Cloudflare Pages dashboard

Deployed at [aferiy-p210-monitor.pages.dev](https://aferiy-p210-monitor.pages.dev). The dashboard and its status and history APIs are public and read-only. The status API returns only the measurements shown on the page; device identifiers and raw register dumps remain in D1. The separate [scheduled cloud collector](../worker/README.md) feeds this database through the BrightEMS cloud connection. The existing `/api/ingest` endpoint still requires its separate secret for an authenticated local fallback.

The old dashboard password and session secret are no longer used. The ingest secret must remain private. Never commit credentials.

From `cloud/`, run `npm ci` and `npm test`. A push to GitHub `main` triggers the Pages test/deploy workflow. The D1 database ID is in `wrangler.jsonc`; secrets are set in Cloudflare, outside the repository.

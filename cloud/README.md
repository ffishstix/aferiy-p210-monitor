# Cloudflare Pages dashboard

Deployed at [aferiy-p210-monitor.pages.dev](https://aferiy-p210-monitor.pages.dev). Pages Functions supply password-protected status and history; D1 stores samples. The separate [scheduled cloud collector](../worker/README.md) is designed to feed this database directly through the BrightEMS cloud connection. It still needs real-device validation. The existing `/api/ingest` endpoint remains available for an authenticated local fallback.

The dashboard password is stored in `C:\Users\finla\AppData\Local\AferiyMonitor\dashboard-password.txt` and in Cloudflare Pages encrypted secrets. Login creates a signed, HttpOnly cookie. The ingest endpoint has a separate secret. Never commit these credentials.

From `cloud/`, run `npm ci` and `npm test`. A push to GitHub `main` triggers the Pages test/deploy workflow. The D1 database ID is in `wrangler.jsonc`; secrets are set in Cloudflare, outside the repository.

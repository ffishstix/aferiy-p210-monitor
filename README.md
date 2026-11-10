# AFERIY P210 cloud monitor

Private dashboard: [aferiy-p210-monitor.pages.dev](https://aferiy-p210-monitor.pages.dev). Source: [GitHub](https://github.com/ffishstix/aferiy-p210-monitor).

The Cloudflare Pages site, D1 history database, and Windows tray program are built. A separate scheduled Cloudflare Worker is implemented to read the P210 via BrightEMS's existing cloud connection. **Real P210 readings have not yet been verified.** The Worker needs the BrightEMS account username and password as Cloudflare secrets before it can run. The Local MQTT token is a different credential and cannot be used for this cloud login.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the diagram and remaining steps. No account credentials or dashboard passwords are committed to this repository.

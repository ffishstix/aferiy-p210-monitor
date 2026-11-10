# AFERIY P210 cloud monitor

Private dashboard: [aferiy-p210-monitor.pages.dev](https://aferiy-p210-monitor.pages.dev). Source: [GitHub](https://github.com/ffishstix/aferiy-p210-monitor).

The Cloudflare Pages site, D1 history database, and Windows tray program are built. A scheduled Cloudflare Worker uses the P210's existing BrightEMS cloud connection; its first real reading was saved on 10 November 2026. The readings and alert logic still need comparison with the phone app. The Local MQTT token is not used for this cloud login.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the diagram and remaining steps. No account credentials or dashboard passwords are committed to this repository.

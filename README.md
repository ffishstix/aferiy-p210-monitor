# AFERIY P210 cloud monitor

Public battery status and history, with sign-in for controls: [aferiy-p210-monitor.pages.dev](https://aferiy-p210-monitor.pages.dev). Source: [GitHub](https://github.com/ffishstix/aferiy-p210-monitor).

The Cloudflare Pages site, D1 history database, and Windows tray program are live. A scheduled Cloudflare Worker uses the P210's existing BrightEMS cloud connection and saves a reading each minute. The owner compared live input/output readings with the phone app. Real low-battery alerts and every advanced field still need validation. The Local MQTT token is not used for this cloud login.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the diagram and remaining steps. No account credentials are committed to this repository.

Third-party code and protocol references are documented in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licensing

The original project code is dual-licensed under
[AGPLv3-or-later](https://www.gnu.org/licenses/agpl-3.0.html) or a separate
commercial license. See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for the
commercial licensing path. Third-party components retain their own licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

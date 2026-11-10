# AFERIY P210 Battery Watch

A private Cloudflare Pages dashboard for an AFERIY P210 power station, with a D1 history database and protected upload API. The hosted dashboard is at [aferiy-p210-monitor.pages.dev](https://aferiy-p210-monitor.pages.dev).

The cloud foundation is deployed, but **battery readings are not connected yet**. A local MQTT receiver near the P210 must decode its readings and send them to the upload endpoint. The Windows tray monitor and alerts are also still planned.

- [Project diagram and staged plan](PROJECT_PLAN.md)
- [Cloud application and setup](cloud/README.md)

No API tokens or passwords belong in this repository. The dashboard password and upload secret are kept on the owner's PC and in encrypted Cloudflare Pages secrets.

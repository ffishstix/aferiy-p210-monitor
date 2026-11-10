# P210 monitoring project

## Current state

The password-protected website and D1 database are live. A Cloudflare Worker is implemented and builds, but its connection to this particular P210 is **unverified** until BrightEMS account credentials are installed and a real reading is received. The Windows tray icon is implemented and now reads the hosted website. No battery data has been collected yet.

## Architecture

```mermaid
flowchart LR
  P[AFERIY P210] -- existing Wi-Fi / internet --> V[BrightEMS cloud]
  A[BrightEMS phone app] <--> V
  W[Cloudflare scheduled Worker] -- outbound API + MQTT WebSocket --> V
  W -- validated samples --> D[(Cloudflare D1 history)]
  S[Cloudflare Pages dashboard] <--> D
  T[Windows tray icon] -- authenticated HTTPS --> S
  U[Phone / remote browser] -- authenticated HTTPS --> S
```

Cloudflare connects **outward** to the vendor cloud every minute. The P210 keeps using its normal internet connection; the phone and Windows PC do not need to stay on. The tray icon runs only while Windows is on. The Local MQTT setting in BrightEMS should remain off for this route. Cloudflare Pages cannot accept the P210's raw inbound MQTT connection directly ([Cloudflare protocol support](https://developers.cloudflare.com/workers/reference/protocols/)); the cloud route uses the vendor's existing remote connection.

The cloud protocol is based on the community [fossibot-ha integration](https://github.com/ldiogoz/fossibot-ha), which connects to BrightEMS cloud and reads Modbus registers over vendor MQTT. That integration is not proof that this P210's cloud account/device supports the same read path. The Worker only requests readings; it never sends register-write commands. A [different community bridge warns](https://github.com/tkaufmann/fossibot-mqtt-bridge#status-and-limitations) that another login on the same account may sign the phone app out. A dedicated BrightEMS email/password account with the P210 shared to it is preferable if the app supports sharing.

## Steps to finish

1. The owner currently uses Google/Apple sign-in. Check whether BrightEMS lets the same account add an app-specific password, or whether the P210 can be shared with a separate email/password account. Never use a Google/Apple account password in the Worker. Put only the eventual BrightEMS-specific username/password in private `temo.txt` as `BRIGHTEMS_USERNAME` and `BRIGHTEMS_PASSWORD`.
2. Install those values as encrypted Cloudflare Worker secrets, deploy the scheduled Worker, and run one authenticated diagnostic collection. Confirm the account lists the P210 and yields a real Modbus response. If the account uses Google/Apple sign-in only, investigate an app password or other supported login.
3. Compare the first readings against BrightEMS: charge %, total and source input W, total and source output W, AC/grid state, and remaining-time field. Correct the register map for this firmware before treating values as reliable.
4. Display every verified reported field and mark absent fields as unavailable. The current Worker captures the mapped raw register values but has not verified the full app field inventory. Its runtime figure is a rough calculation using the P210's rated 2048 Wh capacity and current load; compare it with actual discharge behaviour before relying on it.
5. Verify Cloudflare samples continue while the PC is off, then check history graphs, stale-data handling, and the 15% tray notification during a safe discharge test. The tray never shuts down Windows automatically.
6. Set a suitable history retention/export policy after observing sample volume. Check Cloudflare D1 usage and Worker failures in the dashboard.

## Existing pieces

| Part | Location | State |
| --- | --- | --- |
| Hosted dashboard and history | `cloud/` | Deployed, waiting for readings |
| Cloud collector | `worker/` | Implemented; needs account secrets and real-device verification |
| Windows tray icon and alerts | `collector/tray.py` | Implemented; reads hosted status, needs live transition test |
| LAN broker/collector prototype | `collector/` | Superseded; not required for PC-off logging |
| GitHub deployment | `.github/workflows/deploy-pages.yml` | Pages deployment verified; Worker deployment follows credentials |

## Safety and limits

The 15% warning is based on fresh battery telemetry, not Windows' own battery reading. If the vendor cloud is unavailable or the P210 sleeps, the site and tray must label readings stale. The precise "PC is on battery" rule and ETA need real unplug/replug observations; current power-flow inference is provisional. The Cloudflare collector uses an unofficial vendor protocol that may change without notice. Do not rely on it as the sole protection against lost work.

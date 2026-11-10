# Cloud collector

This scheduled Cloudflare Worker logs into BrightEMS using account credentials, discovers the P210, gets vendor MQTT access, sends a read-only Modbus request over MQTT WebSocket, and stores the result in the website's D1 database once a minute. It uses the protocol described by [fossibot-ha](https://github.com/ldiogoz/fossibot-ha). A first real P210 reading was saved on 10 November 2026; the register values still need comparison with the phone app.

Required encrypted Worker secrets: `BRIGHTEMS_USERNAME`, `BRIGHTEMS_PASSWORD`, and `INGEST_SECRET` (for the private `/check` diagnostic endpoint). They are already installed in the owner's Cloudflare account. If the account controls multiple devices, configure `BRIGHTEMS_DEVICE_ID` to select the P210. The Local MQTT API token is not used. Run `npm ci`, `npm test`, and `npx wrangler deploy` from this directory after installing secrets. Never commit secrets to this repository.

The scheduled handler writes only after a valid Modbus response with a valid checksum and plausible charge %. Missing data produces no fake reading. The runtime figure is an unverified rough calculation from rated 2048 Wh capacity and current load. The first real response must be compared with the BrightEMS app before relying on status, ETA, or alerts.

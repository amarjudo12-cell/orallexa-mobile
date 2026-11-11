# Privacy design & verification

**Guarantee:** with the Claude debate switched off (the default), the app sends
nothing off the phone. With it switched on, the only destination is
`api.anthropic.com`, only when you tap *Run debate*, and only a computed market
snapshot — which you can read in full before sending.

## What never leaves the phone

| Data | Where it lives |
|---|---|
| Imported price CSVs | WebView app-private storage |
| Trade journal & notes | WebView app-private storage |
| Account size, risk %, settings | WebView app-private storage |
| Anthropic API key | WebView app-private storage (sent only as a header to api.anthropic.com) |
| Indicators, 10 strategies, backtests, risk sizing, verdict | Computed in memory, on device |

## How it is enforced (defence in depth)

1. **Egress guard** (`src/privacy/egress.ts`) wraps `fetch` and `XMLHttpRequest`
   and disables `WebSocket`, `EventSource` and `sendBeacon`. Non-allowlisted
   hosts are refused; the allowlisted host is refused too while the debate is off.
   Every attempt is shown live on the app's **Privacy** screen.
2. **Content-Security-Policy** (`index.html`): `connect-src 'self' https://api.anthropic.com`,
   and scripts, styles, fonts and images from the app bundle only. Enforced by
   the WebView itself, independent of the app's JavaScript.
3. **Android platform settings**
   - Only the `INTERNET` permission; location, contacts, phone, camera, mic,
     storage and advertising-ID permissions are force-removed even if a library asks.
   - `allowBackup=false` + data-extraction rules: app data is excluded from
     Google Drive backup and device-to-device transfer.
   - Network security config: no plain HTTP; user-installed CAs not trusted.
   - WebView usage metrics and Safe Browsing lookups to Google turned off.
   - Google Services / Firebase plugin removed; no analytics or crash SDKs.
   - Web content loads only from the APK (no `server.url`, no external navigation),
     WebView remote debugging off.
4. **What the Claude request contains** (`src/llm/debate.ts`): ticker (or
   `ASSET-A` if *Hide ticker* is on), last date and close, 1d/20d % change,
   RSI, MACD histogram, ADX, ATR %, MA position, regime, the on-device verdict,
   strategy votes and backtest Sharpe ratios. Never the journal, account size,
   position sizes or raw price history.

## Verification (all run in CI on every push)

| Check | Command | What it proves |
|---|---|---|
| Engine parity | `npm test` + `scripts/parity.py` | TS engine reproduces the original Python strategies exactly |
| No-egress E2E | `npm run test:privacy` | Using every feature produces **0** outbound requests; hostile code (fetch, XHR, WebSocket, EventSource, beacon, `<img>`, `<script>`, `<link>`) is blocked; in Claude mode exactly 3 requests go only to api.anthropic.com and contain none of: journal note, account size, file name, API key |
| Static audit | `npm run verify:privacy` | Every URL in the shipped bundle, the CSP, manifest, permissions, backup rules, network config and dependencies |
| APK audit | `node scripts/verify-apk.mjs <apk>` | The *merged* manifest of the compiled APK has no extra permissions, backup off, no Google services |

The tests capture traffic at the browser level, below the app's own guard, and
were mutation-checked: removing the guard and CSP makes the hostile-code test
fail, and planting a telemetry URL makes the static audit fail.

### Check it yourself on the phone
- Open **Privacy** — the live network log lists every attempted connection.
- Android Settings → Apps → Orallexa → Permissions: only network access.
- Optional: run the app with a firewall app (e.g. NetGuard) and watch it — with
  the debate off you will see no connections.

## Residual limits (honest list)
- The debate, when used, sends the snapshot above to Anthropic under your API key
  and Anthropic's data policies.
- The phone OS and its WebView component are outside the app's control (they
  receive their own system updates from Google).
- Storage is protected by Android's per-app sandbox and full-disk encryption,
  not an additional app-level encryption layer. Anyone with an unlocked,
  rooted phone could read it.

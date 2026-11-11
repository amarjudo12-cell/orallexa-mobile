# Orallexa Mobile (Android)

On-device mobile version of [alex-jb/orallexa-ai-trading-agent](https://github.com/alex-jb/orallexa-ai-trading-agent).
All analysis runs on the phone; see [PRIVACY.md](PRIVACY.md) for what that means and how it is verified.

**Educational research, not financial advice. Paper decisions only.**

## What's in it
- **Analyze** — import an OHLCV CSV (Yahoo Finance, broker or TradingView export), get the
  on-device BUY / SELL / WAIT verdict, regime, strategy votes, and a risk plan
  (ATR stop, target, position size capped at 20% of account).
- **Backtest** — all 10 strategies from the repo's `engine/strategies.py`
  with 0.1% cost + 0.1% slippage: return, Sharpe, max drawdown, trades, equity vs buy & hold.
- **Journal** — log decisions with notes, stored on the phone.
- **Privacy** — live log of every network attempt, storage summary, erase-all button.
- **Settings** — account/risk; optional Claude Bull / Bear / Judge debate (off by default).

Ported from the Python repo: `skills/technical_analysis_v2.py`, `engine/strategies.py`,
`engine/backtest.py`, `engine/evaluation.py`, `skills/risk_management.py`.
Parity is checked against the Python originals (`scripts/parity.py`): identical signals and metrics
for all 10 strategies across 3 datasets.

Not ported (they need servers, paid feeds or third-party services, which would break the
privacy goal): live market data, news/social scraping, Polymarket/Kalshi, Alpaca execution,
PyTorch/XGBoost models, voice, Telegram/X publishing, PostHog analytics.

## Build the APK

**Option A — GitHub Actions (no setup):** push this folder to a GitHub repo. The
*Android APK* workflow runs every test and privacy check, builds the APK, audits
its merged manifest, and attaches `app-debug.apk` as an artifact.

**Option B — locally** (Node 22, JDK 21, Android SDK / Android Studio):
```bash
npm ci
npm test                 # engine tests
npm run build            # web bundle -> dist/
npm run test:privacy     # end-to-end no-egress tests (Playwright)
npx cap sync android
npm run verify:privacy   # static audit
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```
Install: copy the APK to the phone and open it (allow "install unknown apps"),
or `adb install android/app/build/outputs/apk/debug/app-debug.apk`.

For a Play-Store-style release build, add a signing config and run `./gradlew assembleRelease`.

## Engine parity check
```bash
PARITY_DIR=/tmp/parity npx vitest run tests/parity.export.test.ts
python3 scripts/parity.py /path/to/orallexa-ai-trading-agent /tmp/parity
```

## Licence
MIT, as the original project (© alex-jb). This port keeps that licence.

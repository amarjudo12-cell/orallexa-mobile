// Optional Bull / Bear / Judge debate (the repo's llm/ debate, reduced to its core).
// This is the ONLY code path that sends anything off the phone. It sends a
// computed market snapshot — never the journal, datasets, account size or
// position sizes — and the user sees the exact JSON before it is sent.
import type { Analysis } from "../engine/decision";

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface Snapshot {
  ticker: string; last_date: string; bars: number; last_close: number;
  change_1d_pct: number; change_20d_pct: number; rsi14: number; macd_hist: number;
  adx: number; atr_pct: number; vs_ma20: string; vs_ma50: string; regime: string;
  on_device_verdict: string; strategy_votes: Record<string, number>;
  backtest_sharpe: Record<string, number>;
}

const r = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export function buildSnapshot(a: Analysis, ticker: string): Snapshot {
  const i = a.ind, n = i.close.length - 1;
  return {
    ticker, last_date: a.bars[n].date, bars: a.bars.length, last_close: r(i.close[n], 4),
    change_1d_pct: r((i.close[n] / i.close[n - 1] - 1) * 100),
    change_20d_pct: r((i.close[n] / i.close[Math.max(0, n - 20)] - 1) * 100),
    rsi14: r(i.RSI[n], 1), macd_hist: r(i.MACD_Hist[n], 4), adx: r(i.ADX[n], 1),
    atr_pct: r(i.ATR_Pct[n] * 100), vs_ma20: i.close[n] > i.MA20[n] ? "above" : "below",
    vs_ma50: i.close[n] > i.MA50[n] ? "above" : "below", regime: a.regime,
    on_device_verdict: a.verdict,
    strategy_votes: Object.fromEntries(a.votes.map(v => [v.key, v.signal])),
    backtest_sharpe: Object.fromEntries(a.backtests.map(b => [b.key, r(b.result.metrics.sharpe)])),
  };
}

const ROLES = {
  bull: "You are the BULL analyst in a trading debate. Using only the market snapshot, make the strongest evidence-based case for going long. 4 short bullet points, cite the numbers. No disclaimers.",
  bear: "You are the BEAR analyst in a trading debate. Using only the market snapshot, make the strongest evidence-based case against going long. 4 short bullet points, cite the numbers. No disclaimers.",
  judge: "You are the JUDGE. Weigh the bull and bear cases against the snapshot. Reply with line 1 exactly 'VERDICT: BUY', 'VERDICT: SELL' or 'VERDICT: WAIT', line 2 'CONFIDENCE: <0-100>', then 3 sentences of reasoning. Educational research only.",
};

export function requestBody(model: string, role: keyof typeof ROLES, snapshot: Snapshot, extra = "") {
  return {
    model, max_tokens: 500, system: ROLES[role],
    messages: [{ role: "user", content: `Market snapshot (JSON):\n${JSON.stringify(snapshot, null, 1)}${extra}` }],
  };
}

async function call(apiKey: string, body: object): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  return (json.content ?? []).map((c: { text?: string }) => c.text ?? "").join("").trim();
}

export async function runDebate(apiKey: string, model: string, s: Snapshot, onStep: (k: string, t: string) => void) {
  const bull = await call(apiKey, requestBody(model, "bull", s)); onStep("bull", bull);
  const bear = await call(apiKey, requestBody(model, "bear", s)); onStep("bear", bear);
  const judge = await call(apiKey, requestBody(model, "judge", s, `\n\nBULL CASE:\n${bull}\n\nBEAR CASE:\n${bear}`)); onStep("judge", judge);
  return { bull, bear, judge };
}

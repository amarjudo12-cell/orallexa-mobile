// On-device decision + risk sizing.
// Risk sizing is a direct port of skills/risk_management.py (RiskManagementSkill).
// The verdict combines the repo's own strategies at the latest bar using the
// regime_ensemble rule (see engine/strategies.py) — no network, no LLM.
import { Bar, computeIndicators, Indicators } from "./indicators";
import { STRATEGIES, detectRegime, Regime } from "./strategies";
import { backtest, BacktestResult } from "./backtest";

export type Verdict = "BUY" | "SELL" | "WAIT";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface Analysis {
  bars: Bar[];
  ind: Indicators;
  verdict: Verdict;
  confidence: number;      // 0..1 share of directional strategies agreeing
  riskLevel: RiskLevel;
  regime: Regime;
  votes: { key: string; label: string; signal: number }[];
  backtests: { key: string; label: string; result: BacktestResult }[];
  reasons: string[];
}

const DIRECTIONAL = ["double_ma", "macd_crossover", "bollinger_breakout", "rsi_reversal", "trend_momentum", "alpha_combo", "dual_thrust"];

export function analyze(bars: Bar[]): Analysis {
  const ind = computeIndicators(bars);
  const n = bars.length - 1;
  const signals = Object.fromEntries(Object.entries(STRATEGIES).map(([k, s]) => [k, s.fn(ind, s.params)]));
  const votes = Object.entries(STRATEGIES).map(([k, s]) => ({ key: k, label: s.label, signal: signals[k][n] }));
  const backtests = Object.entries(STRATEGIES).map(([k, s]) => ({ key: k, label: s.label, result: backtest(ind.close, signals[k]) }));

  const regime = detectRegime(ind)[n];
  const longCount = DIRECTIONAL.filter(k => signals[k][n] === 1).length;
  const c = ind.close[n];
  const bearish = ind.MACD_Hist[n] < 0 && c < ind.MA50[n] && c < ind.MA20[n];

  let verdict: Verdict = "WAIT";
  if (signals.regime_ensemble[n] === 1) verdict = "BUY";
  else if (longCount === 0 && bearish) verdict = "SELL";

  const confidence = verdict === "BUY" ? longCount / DIRECTIONAL.length
    : verdict === "SELL" ? 1 - longCount / DIRECTIONAL.length
    : Math.abs(longCount / DIRECTIONAL.length - 0.5);
  const atrPct = ind.ATR_Pct[n];
  const riskLevel: RiskLevel = atrPct < 0.02 ? "LOW" : atrPct < 0.04 ? "MEDIUM" : "HIGH";

  const reasons = [
    `Regime: ${regime} (ADX ${ind.ADX[n].toFixed(1)})`,
    `${longCount}/${DIRECTIONAL.length} strategies long at the last bar`,
    `RSI ${ind.RSI[n].toFixed(1)} · MACD hist ${ind.MACD_Hist[n] >= 0 ? "+" : ""}${ind.MACD_Hist[n].toFixed(3)}`,
    `Close ${c > ind.MA50[n] ? "above" : "below"} MA50, ${c > ind.MA20[n] ? "above" : "below"} MA20`,
    `ATR ${(atrPct * 100).toFixed(2)}% of price → ${riskLevel} risk`,
  ];
  if (regime === "volatile") reasons.push("Volatility spike: the regime filter sits out new entries");

  return { bars, ind, verdict, confidence, riskLevel, regime, votes, backtests, reasons };
}

export interface RiskOutput {
  positionSize: number; positionValue: number; stopLoss: number; takeProfit: number;
  riskAmount: number; riskReward: number; approved: boolean; reason: string;
}

const STOP_PCT: Record<RiskLevel, number> = { LOW: 0.015, MEDIUM: 0.025, HIGH: 0.04 };
const TARGET_PCT: Record<RiskLevel, number> = { LOW: 0.03, MEDIUM: 0.05, HIGH: 0.08 };

export function sizeRisk(verdict: Verdict, riskLevel: RiskLevel, account: number, riskPct: number, entry: number, atr?: number, tradesToday = 0, maxTrades = 5): RiskOutput {
  const reject = (reason: string): RiskOutput => ({ positionSize: 0, positionValue: 0, stopLoss: entry, takeProfit: entry, riskAmount: 0, riskReward: 0, approved: false, reason });
  if (tradesToday >= maxTrades) return reject(`Max trades/day reached (${tradesToday}/${maxTrades})`);
  if (verdict === "WAIT") return reject("Decision is WAIT — no position to size");
  const buy = verdict === "BUY";
  const stop = atr && atr > 0
    ? (buy ? entry - atr * 1.5 : entry + atr * 1.5)
    : (buy ? entry * (1 - STOP_PCT[riskLevel]) : entry * (1 + STOP_PCT[riskLevel]));
  const dist = Math.abs(entry - stop);
  const tp = buy ? entry * (1 + TARGET_PCT[riskLevel]) : entry * (1 - TARGET_PCT[riskLevel]);
  const riskDollars = account * riskPct;
  if (dist < 1e-6) return reject("Stop distance too small to size position safely");
  let size = riskDollars / dist, value = size * entry;
  const cap = account * 0.2;
  if (value > cap) { size = cap / entry; value = cap; }
  const rr = Math.abs(tp - entry) / dist;
  if (rr < 1.5) return reject(`Risk/reward ratio ${rr.toFixed(2)} is below minimum 1.5:1`);
  return { positionSize: size, positionValue: value, stopLoss: stop, takeProfit: tp, riskAmount: riskDollars, riskReward: rr, approved: true, reason: "" };
}

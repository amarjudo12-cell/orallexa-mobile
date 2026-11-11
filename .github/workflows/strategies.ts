// On-device port of engine/strategies.py. Each strategy returns one signal per bar:
// +1 long, 0 flat, -1 short/avoid (only vwap_reversion emits -1).
import { Indicators, Series, rollingMean, rollingMax, rollingMin, rollingQuantile, shift } from "./indicators";

type P = Record<string, number | boolean>;
type Strategy = (d: Indicators, p: P) => Series;

const num = (p: P, k: string, dflt: number) => (typeof p[k] === "number" ? (p[k] as number) : dflt);
const bool = (p: P, k: string, dflt: boolean) => (typeof p[k] === "boolean" ? (p[k] as boolean) : dflt);

export const double_ma: Strategy = (d, p) => {
  const fast = rollingMean(d.close, num(p, "fast_period", 20));
  const slow = rollingMean(d.close, num(p, "slow_period", 50));
  const useVol = bool(p, "use_volume", false);
  let pos = false;
  return d.close.map((_, i) => {
    const up = fast[i] > slow[i] && fast[i - 1] <= slow[i - 1];
    const down = fast[i] < slow[i] && fast[i - 1] >= slow[i - 1];
    if (up) pos = !useVol || d.Volume_Ratio[i] > 1.2;
    else if (down) pos = false;
    return pos ? 1 : 0;
  });
};

export const macd_crossover: Strategy = (d, p) => {
  const useTrend = bool(p, "use_trend_filter", true), th = num(p, "hist_threshold", 0);
  let pos = false;
  return d.close.map((c, i) => {
    const trendOk = !useTrend || c > d.MA50[i];
    if (d.MACD[i] > d.MACD_Signal[i] && d.MACD_Hist[i] > th && trendOk) pos = true;
    else if (d.MACD[i] < d.MACD_Signal[i]) pos = false;
    return pos ? 1 : 0;
  });
};

export const bollinger_breakout: Strategy = (d, p) => {
  const reqSq = bool(p, "require_squeeze", true), rsiMax = num(p, "rsi_filter_max", 75);
  let pos = false;
  return d.close.map((c, i) => {
    let entry = c > d.BB_Upper[i] && d.RSI[i] < rsiMax;
    if (reqSq) {
      let recent = 0;
      for (let j = Math.max(0, i - 5); j < i; j++) recent += d.BB_Squeeze[j];
      entry = entry && recent > 0;
    }
    if (entry && !pos) pos = true;
    else if (pos && c < d.BB_Mid[i]) pos = false;
    return pos ? 1 : 0;
  });
};

export const rsi_reversal: Strategy = (d, p) => {
  const os = num(p, "oversold", 30), ob = num(p, "overbought", 70), ex = num(p, "exit_rsi", 55);
  const adxF = bool(p, "use_adx_filter", true);
  let pos = false;
  return d.RSI.map((r, i) => {
    const range = !adxF || d.ADX[i] < 25;
    if (r < os && range && !pos) pos = true;
    else if (pos && (r > ex || r > ob)) pos = false;
    return pos ? 1 : 0;
  });
};

export const trend_momentum: Strategy = (d, p) => {
  const rmin = num(p, "rsi_min", 40), rmax = num(p, "rsi_max", 70), sl = num(p, "stop_loss", 0.05);
  const useMacd = bool(p, "use_macd", true), useVol = bool(p, "use_volume", true);
  let pos = false, entry = 0;
  return d.close.map((c, i) => {
    const trendOk = c > d.MA20[i] && c > d.MA50[i];
    const macdOk = !useMacd || d.MACD_Hist[i] > 0;
    const volOk = !useVol || d.Volume_Ratio[i] > 0.8;
    const rsiOk = rmin < d.RSI[i] && d.RSI[i] < rmax;
    const stopHit = pos && c < entry * (1 - sl);
    if (stopHit) pos = false;
    else if (trendOk && macdOk && volOk && rsiOk && !pos) { pos = true; entry = c; }
    else if (pos && !trendOk) pos = false;
    return pos ? 1 : 0;
  });
};

export const alpha_combo: Strategy = (d, p) => {
  const th = num(p, "score_threshold", 3);
  let pos = false;
  return d.close.map((c, i) => {
    let s = 0;
    s += d.ROC[i] > 0 ? 1 : 0;
    s += c > d.MA20[i] ? 1 : 0;
    s += c > d.MA50[i] ? 1 : 0;
    if (i >= 5) s += d.OBV[i] > d.OBV[i - 5] ? 1 : 0;
    s += c > d.VWAP[i] ? 1 : 0;
    s += d.MACD_Hist[i] > 0 ? 1 : 0;
    s += d.RSI[i] > 40 && d.RSI[i] < 65 ? 1 : 0;
    if (s >= th && !pos) pos = true;
    else if (s < th - 1.5 && pos) pos = false;
    return pos ? 1 : 0;
  });
};

export const dual_thrust: Strategy = (d, p) => {
  const lb = num(p, "lookback", 4), ku = num(p, "k_up", 0.5), kd = num(p, "k_down", 0.5);
  const hh = rollingMax(d.high, lb), lc = rollingMin(d.close, lb);
  const hc = rollingMax(d.close, lb), ll = rollingMin(d.low, lb);
  const range = shift(hh.map((h, i) => Math.max(h - lc[i], hc[i] - ll[i])));
  let pos = false;
  return d.close.map((c, i) => {
    const up = d.open[i] + ku * range[i], lo = d.open[i] - kd * range[i];
    if (Number.isNaN(up) || Number.isNaN(lo)) return 0;
    if (c > up && !pos) pos = true;
    else if (c < lo && pos) pos = false;
    return pos ? 1 : 0;
  });
};

const BASE: [Strategy, P][] = [
  [double_ma, { fast_period: 20, slow_period: 50, use_volume: false }],
  [macd_crossover, { use_trend_filter: true, hist_threshold: 0 }],
  [bollinger_breakout, { require_squeeze: true, rsi_filter_max: 75 }],
  [rsi_reversal, { oversold: 30, overbought: 70, exit_rsi: 55, use_adx_filter: true }],
  [trend_momentum, { rsi_min: 40, rsi_max: 70, use_macd: true, use_volume: true, stop_loss: 0.05 }],
  [dual_thrust, { lookback: 4, k_up: 0.5, k_down: 0.5 }],
];

function longVotes(d: Indicators): Series {
  const sigs = BASE.map(([fn, p]) => fn(d, p));
  return d.close.map((_, i) => sigs.reduce((a, s) => a + (s[i] === 1 ? 1 : 0), 0));
}

export const ensemble_vote: Strategy = (d, p) => {
  const k = num(p, "min_agree", 3);
  return longVotes(d).map(v => (v >= k ? 1 : 0));
};

export type Regime = "trending" | "ranging" | "volatile";

export function detectRegime(d: Indicators, adxTrend = 20, volLookback = 20): Regime[] {
  const atrPct = d.ATR.map((a, i) => a / d.close[i]);
  const med = rollingQuantile(atrPct, volLookback * 5, 0.5, volLookback);
  return d.close.map((_, i) => {
    let r: Regime = d.ADX[i] > adxTrend ? "trending" : "ranging";
    if (atrPct[i] > med[i] * 1.5) r = "volatile";
    return r;
  });
}

export const regime_ensemble: Strategy = (d, p) => {
  const tmin = num(p, "trend_min_agree", 2), rmin = num(p, "range_min_agree", 4);
  const reg = detectRegime(d, num(p, "adx_trend", 20));
  return longVotes(d).map((v, i) =>
    (reg[i] === "trending" && v >= tmin) || (reg[i] === "ranging" && v >= rmin) ? 1 : 0);
};

export const vwap_reversion: Strategy = (d, p) => {
  const th = num(p, "threshold", 0.01), os = num(p, "rsi_oversold", 35), ob = num(p, "rsi_overbought", 65);
  return d.close.map((c, i) => {
    const v = d.VWAP[i];
    if (Number.isNaN(v)) return 0;
    if (c > v * (1 + th) && d.RSI[i] > ob) return -1;
    if (c < v * (1 - th) && d.RSI[i] < os) return 1;
    return 0;
  });
};

export const STRATEGIES: Record<string, { fn: Strategy; params: P; label: string }> = {
  double_ma: { fn: double_ma, params: BASE[0][1], label: "Double MA crossover" },
  macd_crossover: { fn: macd_crossover, params: BASE[1][1], label: "MACD crossover" },
  bollinger_breakout: { fn: bollinger_breakout, params: BASE[2][1], label: "Bollinger breakout" },
  rsi_reversal: { fn: rsi_reversal, params: BASE[3][1], label: "RSI reversal" },
  trend_momentum: { fn: trend_momentum, params: BASE[4][1], label: "Trend + momentum" },
  alpha_combo: { fn: alpha_combo, params: { score_threshold: 3 }, label: "Alpha combo" },
  dual_thrust: { fn: dual_thrust, params: BASE[5][1], label: "Dual thrust" },
  ensemble_vote: { fn: ensemble_vote, params: { min_agree: 3 }, label: "Ensemble vote" },
  regime_ensemble: { fn: regime_ensemble, params: { trend_min_agree: 2, range_min_agree: 4, adx_trend: 20 }, label: "Regime ensemble" },
  vwap_reversion: { fn: vwap_reversion, params: { threshold: 0.01, rsi_oversold: 35, rsi_overbought: 65 }, label: "VWAP reversion" },
};

// On-device port of skills/technical_analysis_v2.py (TechnicalAnalysisSkillV2).
// Semantics deliberately mirror pandas: rolling(min_periods=1) skips NaN,
// ewm(adjust=False), sample std (ddof=1), and NaN comparisons evaluate false.

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Series = number[];

export interface Indicators {
  close: Series; open: Series; high: Series; low: Series; volume: Series;
  MA5: Series; MA10: Series; MA20: Series; MA50: Series; MA200: Series;
  EMA12: Series; EMA26: Series;
  MACD: Series; MACD_Signal: Series; MACD_Hist: Series;
  ADX: Series; Plus_DI: Series; Minus_DI: Series;
  RSI: Series; Stoch_K: Series; Stoch_D: Series; ROC: Series;
  BB_Mid: Series; BB_Upper: Series; BB_Lower: Series; BB_Pct: Series; BB_Width: Series;
  ATR: Series; ATR_Pct: Series; HV20: Series;
  OBV: Series; Volume_MA: Series; Volume_Ratio: Series; VWAP: Series;
  BB_Squeeze: Series;
}

const isNum = (x: number) => !Number.isNaN(x);

function windowVals(s: Series, i: number, w: number): number[] {
  const out: number[] = [];
  for (let j = Math.max(0, i - w + 1); j <= i; j++) if (isNum(s[j])) out.push(s[j]);
  return out;
}

export function rollingMean(s: Series, w: number): Series {
  return s.map((_, i) => {
    const v = windowVals(s, i, w);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  });
}

export function rollingSum(s: Series, w: number): Series {
  return s.map((_, i) => {
    const v = windowVals(s, i, w);
    return v.length ? v.reduce((a, b) => a + b, 0) : NaN;
  });
}

export function rollingStd(s: Series, w: number, minPeriods = 1): Series {
  return s.map((_, i) => {
    const v = windowVals(s, i, w);
    if (v.length < Math.max(2, minPeriods)) return NaN;
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  });
}

export function rollingMax(s: Series, w: number): Series {
  return s.map((_, i) => { const v = windowVals(s, i, w); return v.length ? Math.max(...v) : NaN; });
}

export function rollingMin(s: Series, w: number): Series {
  return s.map((_, i) => { const v = windowVals(s, i, w); return v.length ? Math.min(...v) : NaN; });
}

/** pandas Series.quantile(q) with linear interpolation, over a rolling window. */
export function rollingQuantile(s: Series, w: number, q: number, minPeriods = 1): Series {
  return s.map((_, i) => {
    const v = windowVals(s, i, w).sort((a, b) => a - b);
    if (v.length < minPeriods || v.length === 0) return NaN;
    const pos = (v.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  });
}

/** ewm(span, adjust=False).mean(); NaN inputs carry the previous value (ignore_na=False approximation for leading NaN). */
export function ewm(s: Series, span: number): Series {
  const a = 2 / (span + 1);
  const out: Series = [];
  let prev = NaN;
  for (const x of s) {
    if (!isNum(x)) { out.push(prev); continue; }
    prev = isNum(prev) ? a * x + (1 - a) * prev : x;
    out.push(prev);
  }
  return out;
}

export const shift = (s: Series, n = 1): Series => s.map((_, i) => (i - n >= 0 && i - n < s.length ? s[i - n] : NaN));
export const diff = (s: Series): Series => s.map((x, i) => (i === 0 ? NaN : x - s[i - 1]));

function trueRange(h: Series, l: Series, c: Series): Series {
  const pc = shift(c);
  return h.map((_, i) => {
    const parts = [h[i] - l[i], Math.abs(h[i] - pc[i]), Math.abs(l[i] - pc[i])].filter(isNum);
    return parts.length ? Math.max(...parts) : NaN;
  });
}

export function computeIndicators(bars: Bar[]): Indicators {
  const close = bars.map(b => b.close), high = bars.map(b => b.high);
  const low = bars.map(b => b.low), open = bars.map(b => b.open), volume = bars.map(b => b.volume);

  const MA5 = rollingMean(close, 5), MA10 = rollingMean(close, 10), MA20 = rollingMean(close, 20);
  const MA50 = rollingMean(close, 50), MA200 = rollingMean(close, 200);
  const EMA12 = ewm(close, 12), EMA26 = ewm(close, 26);

  const MACD = EMA12.map((x, i) => x - EMA26[i]);
  const MACD_Signal = ewm(MACD, 9);
  const MACD_Hist = MACD.map((x, i) => x - MACD_Signal[i]);

  // ADX (Wilder-style with ewm, matching the Python implementation)
  const hd = diff(high), ld = diff(low).map(x => -x);
  const plusRaw = hd.map(x => (x < 0 ? 0 : x));
  const minusRaw = ld.map(x => (x < 0 ? 0 : x));
  const plusDM = plusRaw.map((p, i) => (p > minusRaw[i] ? p : 0));
  const minusDM = minusRaw.map((m, i) => (m > plusRaw[i] ? m : 0));
  const tr = trueRange(high, low, close);
  const atrE = ewm(tr, 14);
  const pdm = ewm(plusDM, 14), mdm = ewm(minusDM, 14);
  const Plus_DI = pdm.map((x, i) => (100 * x) / atrE[i]);
  const Minus_DI = mdm.map((x, i) => (100 * x) / atrE[i]);
  const dx = Plus_DI.map((p, i) => (100 * Math.abs(p - Minus_DI[i])) / (p + Minus_DI[i] + 1e-9));
  const ADX = ewm(dx, 14);

  // RSI (simple rolling mean of gains/losses, as in the repo)
  const d = diff(close);
  const gain = rollingMean(d.map(x => (isNum(x) ? Math.max(x, 0) : NaN)), 14);
  const loss = rollingMean(d.map(x => (isNum(x) ? -Math.min(x, 0) : NaN)), 14);
  const RSI = gain.map((g, i) => 100 - 100 / (1 + g / (loss[i] + 1e-9)));

  const lowMin = rollingMin(low, 14), highMax = rollingMax(high, 14);
  const Stoch_K = close.map((c, i) => (100 * (c - lowMin[i])) / (highMax[i] - lowMin[i] + 1e-9));
  const Stoch_D = rollingMean(Stoch_K, 3);
  const ROC = close.map((c, i) => (i >= 10 ? (c / close[i - 10] - 1) * 100 : NaN));

  const BB_Mid = MA20;
  const std20 = rollingStd(close, 20);
  const BB_Upper = BB_Mid.map((m, i) => m + 2 * std20[i]);
  const BB_Lower = BB_Mid.map((m, i) => m - 2 * std20[i]);
  const BB_Pct = close.map((c, i) => (c - BB_Lower[i]) / (BB_Upper[i] - BB_Lower[i] + 1e-9));
  const BB_Width = BB_Upper.map((u, i) => (u - BB_Lower[i]) / (BB_Mid[i] + 1e-9));
  const sqThresh = rollingQuantile(BB_Width, 50, 0.2);
  const BB_Squeeze = BB_Width.map((w, i) => (w < sqThresh[i] ? 1 : 0));

  const ATR = rollingMean(tr, 14);
  const ATR_Pct = ATR.map((a, i) => a / (close[i] + 1e-9));
  const logRet = close.map((c, i) => (i === 0 ? NaN : Math.log(c / close[i - 1])));
  const HV20 = rollingStd(logRet, 20).map(x => x * Math.sqrt(252));

  let obv = 0;
  const OBV = close.map((c, i) => {
    const dir = i === 0 ? 0 : Math.sign(c - close[i - 1]);
    obv += dir * volume[i];
    return obv;
  });
  const Volume_MA = rollingMean(volume, 20);
  const Volume_Ratio = volume.map((v, i) => v / (Volume_MA[i] + 1e-9));
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const pvSum = rollingSum(tp.map((t, i) => t * volume[i]), 20), vSum = rollingSum(volume, 20);
  const VWAP = pvSum.map((p, i) => p / vSum[i]);

  return {
    close, open, high, low, volume, MA5, MA10, MA20, MA50, MA200, EMA12, EMA26,
    MACD, MACD_Signal, MACD_Hist, ADX, Plus_DI, Minus_DI, RSI, Stoch_K, Stoch_D, ROC,
    BB_Mid, BB_Upper, BB_Lower, BB_Pct, BB_Width, ATR, ATR_Pct, HV20,
    OBV, Volume_MA, Volume_Ratio, VWAP, BB_Squeeze,
  };
}

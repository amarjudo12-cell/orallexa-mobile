// On-device port of engine/backtest.py (simple_backtest) and engine/evaluation.py.
import { Series } from "./indicators";

export interface BacktestResult {
  equity: Series;          // net strategy equity curve
  market: Series;          // buy-and-hold equity curve
  netReturns: Series;
  metrics: Metrics;
  marketMetrics: Metrics;
  trades: number;          // number of entries (flat → long/short transitions)
  exposure: number;        // fraction of bars in a position
  totalCost: number;
}

export interface Metrics {
  totalReturn: number; annualizedReturn: number; sharpe: number; sortino: number;
  calmar: number; maxDrawdown: number; winRate: number;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a: number[]) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};

export function metricsFromReturns(r: number[]): Metrics {
  if (!r.length) return { totalReturn: 0, annualizedReturn: 0, sharpe: 0, sortino: 0, calmar: 0, maxDrawdown: 0, winRate: 0 };
  let cum = 1, peak = 1, mdd = 0;
  for (const x of r) { cum *= 1 + x; peak = Math.max(peak, cum); mdd = Math.min(mdd, (cum - peak) / peak); }
  const total = cum - 1;
  const m = mean(r), s = std(r);
  const sharpe = s && !Number.isNaN(s) ? (m / s) * Math.sqrt(252) : 0;
  const neg = r.filter(x => x < 0), ds = std(neg);
  const sortino = neg.length && ds && !Number.isNaN(ds) ? (m / ds) * Math.sqrt(252) : 0;
  const ann = Math.pow(1 + total, 252 / Math.max(r.length, 1)) - 1;
  return {
    totalReturn: total, annualizedReturn: ann, sharpe, sortino,
    calmar: mdd !== 0 ? ann / Math.abs(mdd) : 0, maxDrawdown: mdd,
    winRate: r.filter(x => x > 0).length / r.length,
  };
}

export function backtest(close: Series, signal: Series, cost = 0.001, slippage = 0.001, initial = 10000): BacktestResult {
  const ret = close.map((c, i) => (i === 0 ? 0 : c / close[i - 1] - 1));
  const net: number[] = [];
  let totalCost = 0, trades = 0, inPos = 0;
  for (let i = 0; i < close.length; i++) {
    const prev = i === 0 ? 0 : signal[i - 1];
    const change = i === 0 ? Math.abs(signal[0]) : Math.abs(signal[i] - signal[i - 1]);
    const tc = change * (cost + slippage);
    totalCost += tc;
    if (signal[i] !== 0 && prev === 0) trades++;
    if (signal[i] !== 0) inPos++;
    net.push(prev * ret[i] - tc);
  }
  let e = initial, m = initial;
  const equity = net.map(r => (e *= 1 + r));
  const market = ret.map(r => (m *= 1 + r));
  return {
    equity, market, netReturns: net, metrics: metricsFromReturns(net), marketMetrics: metricsFromReturns(ret),
    trades, exposure: close.length ? inPos / close.length : 0, totalCost,
  };
}

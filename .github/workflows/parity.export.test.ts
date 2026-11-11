// Exports a dataset + the TS engine's outputs so scripts/parity.py can diff them
// against the original Python implementation from the Orallexa repo.
import { test, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { demoBars } from "../src/engine/csv";
import { computeIndicators } from "../src/engine/indicators";
import { STRATEGIES } from "../src/engine/strategies";
import { backtest } from "../src/engine/backtest";

test("export parity fixtures", () => {
  const out = process.env.PARITY_DIR ?? "parity-out";
  mkdirSync(out, { recursive: true });
  const result: Record<string, unknown> = {};
  for (const seed of [7, 42, 2026]) {
    const bars = demoBars(600, seed);
    writeFileSync(`${out}/bars_${seed}.csv`, "Date,Open,High,Low,Close,Volume\n" +
      bars.map(b => [b.date, b.open, b.high, b.low, b.close, b.volume].join(",")).join("\n"));
    const ind = computeIndicators(bars);
    const strat: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(STRATEGIES)) {
      const sig = s.fn(ind, s.params);
      const bt = backtest(ind.close, sig);
      strat[k] = { signal: sig, total_return: bt.metrics.totalReturn, sharpe: bt.metrics.sharpe, max_drawdown: bt.metrics.maxDrawdown };
    }
    const pick = ["RSI", "MACD", "MACD_Signal", "ADX", "BB_Upper", "BB_Squeeze", "ATR", "VWAP", "OBV", "ROC"] as const;
    result[seed] = { indicators: Object.fromEntries(pick.map(k => [k, ind[k]])), strategies: strat };
  }
  writeFileSync(`${out}/ts_results.json`, JSON.stringify(result));
  expect(Object.keys(result)).toHaveLength(3);
});

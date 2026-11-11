import { test, expect } from "vitest";
import { sizeRisk, analyze } from "../src/engine/decision";
import { parseCsv, demoBars } from "../src/engine/csv";

test("risk sizing matches skills/risk_management.py", () => {
  const r = sizeRisk("BUY", "MEDIUM", 10000, 0.01, 100, 2);
  expect(r.approved).toBe(true);
  expect(r.stopLoss).toBeCloseTo(97);            // entry - 1.5 * ATR
  expect(r.positionValue).toBeCloseTo(2000);     // capped at 20% of account
  expect(r.positionSize).toBeCloseTo(20);
  expect(r.takeProfit).toBeCloseTo(105);
  expect(r.riskReward).toBeCloseTo(5 / 3);
  expect(sizeRisk("WAIT", "LOW", 10000, 0.01, 100).approved).toBe(false);
  expect(sizeRisk("BUY", "LOW", 10000, 0.01, 100, 5).reason).toMatch(/below minimum 1.5/);
});

test("CSV import handles Yahoo exports, quotes, unsorted rows", () => {
  const rows = demoBars(80).map(b => `"${b.date}",${b.open},${b.high},${b.low},${b.close},${b.close},"${b.volume}"`).reverse();
  const { bars, skipped } = parseCsv("Date,Open,High,Low,Close,Adj Close,Volume\n" + rows.join("\n") + "\nbad,row");
  expect(bars).toHaveLength(80);
  expect(skipped).toBe(1);
  expect(bars[0].date < bars[79].date).toBe(true);
  expect(() => parseCsv("Date,Close\n2024-01-01,1")).toThrow();
});

test("analysis produces a verdict and 10 backtests", () => {
  const a = analyze(demoBars());
  expect(["BUY", "SELL", "WAIT"]).toContain(a.verdict);
  expect(a.backtests).toHaveLength(10);
});

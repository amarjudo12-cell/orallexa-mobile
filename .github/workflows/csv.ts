// Parse OHLCV CSV files the user imports from their own storage (e.g. a Yahoo
// Finance / broker / TradingView export). Parsing happens entirely in memory.
import { Bar } from "./indicators";

const ALIASES: Record<keyof Bar, string[]> = {
  date: ["date", "datetime", "time", "timestamp"],
  open: ["open"],
  high: ["high"],
  low: ["low"],
  close: ["close", "adj close", "adj_close", "price", "last"],
  volume: ["volume", "vol"],
};

function splitLine(line: string, sep: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function parseCsv(text: string): { bars: Bar[]; skipped: number } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error("File has no data rows.");
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const header = splitLine(lines[0], sep).map(h => h.toLowerCase());
  const col = {} as Record<keyof Bar, number>;
  for (const k of Object.keys(ALIASES) as (keyof Bar)[]) {
    // Prefer exact "close" over "adj close" when both exist.
    col[k] = ALIASES[k].map(a => header.indexOf(a)).find(i => i >= 0) ?? -1;
  }
  if (col.date < 0 || col.close < 0) throw new Error("Need at least Date and Close columns.");
  const bars: Bar[] = []; let skipped = 0;
  for (const line of lines.slice(1)) {
    const c = splitLine(line, sep);
    const f = (k: keyof Bar) => (col[k] >= 0 && c[col[k]] !== undefined ? parseFloat(c[col[k]].replace(/[$,]/g, "")) : NaN);
    const close = f("close");
    if (!Number.isFinite(close) || !c[col.date]) { skipped++; continue; }
    const open = Number.isFinite(f("open")) ? f("open") : close;
    const high = Number.isFinite(f("high")) ? f("high") : Math.max(open, close);
    const low = Number.isFinite(f("low")) ? f("low") : Math.min(open, close);
    const volume = Number.isFinite(f("volume")) ? f("volume") : 1;
    bars.push({ date: c[col.date], open, high, low, close, volume });
  }
  bars.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  if (bars.length < 60) throw new Error(`Only ${bars.length} valid rows — need at least 60 bars for the indicators.`);
  return { bars, skipped };
}

/** Deterministic synthetic series so the app can be explored with zero imports. Clearly labelled DEMO in the UI. */
export function demoBars(n = 500, seed = 7): Bar[] {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const out: Bar[] = []; let price = 100;
  const start = Date.UTC(2024, 0, 2);
  for (let i = 0; i < n; i++) {
    const drift = 0.0004 + 0.0015 * Math.sin(i / 60);
    const vol = 0.012 + 0.01 * (Math.sin(i / 37) > 0.7 ? 1 : 0);
    const open = price;
    price = price * Math.exp(drift + vol * gauss());
    const high = Math.max(open, price) * (1 + Math.abs(gauss()) * vol * 0.5);
    const low = Math.min(open, price) * (1 - Math.abs(gauss()) * vol * 0.5);
    const d = new Date(start + i * 86400000 * 1.4);
    out.push({ date: d.toISOString().slice(0, 10), open, high, low, close: price, volume: Math.round(1e6 * (0.6 + rnd())) });
  }
  return out;
}

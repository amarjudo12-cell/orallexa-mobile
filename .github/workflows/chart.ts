// Minimal canvas line chart — drawn locally, no charting library or CDN.
export interface Line { values: number[]; color: string; width?: number; dash?: number[] }

export function drawChart(canvas: HTMLCanvasElement, lines: Line[], labels: string[] = []) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext("2d")!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  const all = lines.flatMap(l => l.values.filter(Number.isFinite));
  if (!all.length) return;
  let min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.06 || 1; min -= pad; max += pad;
  const n = Math.max(...lines.map(l => l.values.length));
  const L = 6, R = 46, T = 8, B = 18;
  const x = (i: number) => L + (i / Math.max(n - 1, 1)) * (w - L - R);
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * (h - T - B);

  g.font = "10px DMMono, monospace"; g.fillStyle = "#6B6E76"; g.strokeStyle = "rgba(212,175,55,0.08)"; g.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    const v = min + ((max - min) * k) / 3, yy = y(v);
    g.beginPath(); g.moveTo(L, yy); g.lineTo(w - R, yy); g.stroke();
    g.fillText(v >= 1000 ? v.toFixed(0) : v.toFixed(2), w - R + 4, yy + 3);
  }
  if (labels.length) {
    g.fillText(labels[0], L, h - 4);
    const last = labels[labels.length - 1];
    g.fillText(last, w - R - g.measureText(last).width, h - 4);
  }
  for (const l of lines) {
    g.strokeStyle = l.color; g.lineWidth = l.width ?? 1.5; g.setLineDash(l.dash ?? []);
    g.beginPath(); let started = false;
    l.values.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      if (!started) { g.moveTo(x(i), y(v)); started = true; } else g.lineTo(x(i), y(v));
    });
    g.stroke();
  }
  g.setLineDash([]);
}

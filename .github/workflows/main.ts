import "./style.css";
import { installEgressGuard, egressLog, onEgress, setOutboundEnabled, ALLOWED_HOSTS } from "./privacy/egress";
import { store, uid, Dataset } from "./store";
import { parseCsv, demoBars } from "./engine/csv";
import { analyze, sizeRisk, Analysis } from "./engine/decision";
import { drawChart } from "./ui/chart";
import { buildSnapshot, requestBody, runDebate } from "./llm/debate";

installEgressGuard();
setOutboundEnabled(store.settings().claudeEnabled);

type Tab = "analyze" | "backtest" | "journal" | "privacy" | "settings";
let tab: Tab = "analyze";
let current: Dataset | null = null;
let analysis: Analysis | null = null;
let btSelected = "regime_ensemble";
let debate: Record<string, string> = {};

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const pct = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const money = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 2 });

function toast(msg: string) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

function selectDataset(d: Dataset | null) {
  current = d; debate = {};
  analysis = d ? analyze(d.bars) : null;
  render();
}

function ensureData() {
  const ds = store.datasets();
  if (!ds.length) {
    const demo: Dataset = { id: "demo", name: "DEMO (synthetic)", importedAt: new Date().toISOString(), bars: demoBars(), demo: true };
    store.saveDataset(demo);
    return demo;
  }
  return ds[0];
}

async function importFile(file: File) {
  try {
    const { bars, skipped } = parseCsv(await file.text());
    const name = file.name.replace(/\.(csv|txt)$/i, "").toUpperCase().slice(0, 24);
    const d: Dataset = { id: uid(), name, importedAt: new Date().toISOString(), bars };
    store.saveDataset(d);
    selectDataset(d);
    toast(`Imported ${bars.length} bars${skipped ? ` (${skipped} rows skipped)` : ""} — stored on this phone only`);
  } catch (e) { toast((e as Error).message); }
}

// ── Views ──────────────────────────────────────────────────────────────────

function datasetBar() {
  const ds = store.datasets();
  return `<div class="dsbar">
    <select id="ds">${ds.map(d => `<option value="${esc(d.id)}" ${d.id === current?.id ? "selected" : ""}>${esc(d.name)} · ${d.bars.length} bars</option>`).join("")}</select>
    <label class="btn small">Import CSV<input id="file" type="file" accept=".csv,.txt,text/csv" hidden></label>
  </div>`;
}

function viewAnalyze() {
  if (!analysis || !current) return `<p class="muted">Import a price CSV to begin.</p>`;
  const a = analysis, n = a.bars.length - 1, s = store.settings();
  const risk = sizeRisk(a.verdict, a.riskLevel, s.account, s.riskPct, a.ind.close[n], a.ind.ATR[n]);
  const cls = a.verdict === "BUY" ? "bull" : a.verdict === "SELL" ? "bear" : "neutral";
  return `${datasetBar()}
  ${current.demo ? `<div class="note">Synthetic demo data — import your own OHLCV CSV for real analysis.</div>` : ""}
  <section class="card hero ${cls}">
    <div class="label">On-device verdict · ${esc(a.bars[n].date)}</div>
    <div class="verdict">${a.verdict}</div>
    <div class="row3">
      <div><span>Confidence</span><b>${Math.round(a.confidence * 100)}%</b></div>
      <div><span>Risk</span><b>${a.riskLevel}</b></div>
      <div><span>Regime</span><b>${a.regime}</b></div>
    </div>
  </section>
  <section class="card"><div class="label">Price · MA20 · MA50</div><canvas id="px" class="chart"></canvas></section>
  <section class="card"><div class="label">Why</div><ul class="reasons">${a.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul></section>
  <section class="card"><div class="label">Strategy votes (last bar)</div>
    <div class="votes">${a.votes.map(v => `<div class="vote ${v.signal > 0 ? "on" : v.signal < 0 ? "short" : ""}"><span>${esc(v.label)}</span><b>${v.signal > 0 ? "LONG" : v.signal < 0 ? "SHORT" : "FLAT"}</b></div>`).join("")}</div>
  </section>
  <section class="card"><div class="label">Risk plan · account ${money(s.account)} · risk ${(s.riskPct * 100).toFixed(1)}%</div>
    ${risk.approved ? `<div class="kv"><span>Size</span><b>${risk.positionSize.toFixed(2)} units (${money(risk.positionValue)})</b></div>
      <div class="kv"><span>Stop</span><b>${risk.stopLoss.toFixed(2)}</b></div>
      <div class="kv"><span>Target</span><b>${risk.takeProfit.toFixed(2)}</b></div>
      <div class="kv"><span>Risk / reward</span><b>${risk.riskReward.toFixed(2)} : 1</b></div>`
      : `<p class="muted">${esc(risk.reason)}</p>`}
    <textarea id="note" placeholder="Journal note (stays on this phone)"></textarea>
    <button class="btn" id="log">Log to journal</button>
  </section>
  ${viewDebate(a)}
  <p class="disclaimer">Educational research, not financial advice. Paper decisions only.</p>`;
}

function viewDebate(a: Analysis) {
  const s = store.settings();
  if (!s.claudeEnabled) return `<section class="card"><div class="label">Claude Bull / Bear / Judge debate</div>
    <p class="muted">Off. Nothing leaves this phone. Turn it on in Settings to send a market snapshot (never your journal or account) to ${ALLOWED_HOSTS[0]}.</p></section>`;
  const ticker = s.tickerAlias ? "ASSET-A" : current!.name;
  const body = requestBody(s.model, "bull", buildSnapshot(a, ticker));
  const parts = ["bull", "bear", "judge"].filter(k => debate[k]).map(k =>
    `<div class="deb ${k}"><div class="label">${k.toUpperCase()}</div><pre>${esc(debate[k])}</pre></div>`).join("");
  return `<section class="card"><div class="label">Claude Bull / Bear / Judge debate</div>
    <details><summary>Exactly what will leave this phone (3 requests to ${ALLOWED_HOSTS[0]})</summary>
      <pre class="preview">${esc(JSON.stringify(body, null, 1))}</pre>
      <p class="muted">The Bear request carries the same snapshot; the Judge request adds the Bull and Bear replies. Plus your API key in a header.</p>
    </details>
    <button class="btn" id="debate" ${s.apiKey ? "" : "disabled"}>${s.apiKey ? "Send snapshot & run debate" : "Add an API key in Settings"}</button>
    ${parts}</section>`;
}

function viewBacktest() {
  if (!analysis) return `<p class="muted">No data.</p>`;
  const rows = [...analysis.backtests].sort((a, b) => b.result.metrics.sharpe - a.result.metrics.sharpe);
  const sel = analysis.backtests.find(b => b.key === btSelected) ?? rows[0];
  const m = sel.result.metrics, mk = sel.result.marketMetrics;
  return `${datasetBar()}
  <section class="card"><div class="label">${esc(sel.label)} vs buy &amp; hold</div><canvas id="eq" class="chart"></canvas>
    <div class="row3">
      <div><span>Return</span><b>${pct(m.totalReturn)}</b></div><div><span>Sharpe</span><b>${m.sharpe.toFixed(2)}</b></div><div><span>Max DD</span><b>${pct(m.maxDrawdown)}</b></div>
    </div>
    <div class="row3">
      <div><span>Trades</span><b>${sel.result.trades}</b></div><div><span>Exposure</span><b>${Math.round(sel.result.exposure * 100)}%</b></div><div><span>B&amp;H</span><b>${pct(mk.totalReturn)}</b></div>
    </div>
  </section>
  <section class="card"><div class="label">All strategies · tap to chart · costs 0.1% + 0.1% slippage</div>
    <table class="bt"><tr><th>Strategy</th><th>Return</th><th>Sharpe</th><th>MaxDD</th></tr>
    ${rows.map(b => `<tr data-k="${b.key}" class="${b.key === sel.key ? "sel" : ""}"><td>${esc(b.label)}</td><td>${pct(b.result.metrics.totalReturn)}</td><td>${b.result.metrics.sharpe.toFixed(2)}</td><td>${pct(b.result.metrics.maxDrawdown)}</td></tr>`).join("")}
    </table></section>`;
}

function viewJournal() {
  const j = store.journal();
  return `<section class="card"><div class="label">Trade journal · ${j.length} entries · on this phone only</div>
    ${j.length ? j.map(e => `<div class="jr"><div><b class="${e.verdict === "BUY" ? "up" : e.verdict === "SELL" ? "down" : ""}">${esc(e.verdict)}</b> ${esc(e.ticker)} @ ${e.price.toFixed(2)}
      <div class="muted small">${esc(new Date(e.at).toLocaleString())}${e.size ? ` · ${e.size.toFixed(2)} units` : ""}</div>
      ${e.note ? `<div>${esc(e.note)}</div>` : ""}</div><button class="x" data-del="${esc(e.id)}" aria-label="Delete">×</button></div>`).join("")
    : `<p class="muted">Log decisions from the Analyze tab.</p>`}</section>`;
}

function viewPrivacy() {
  const s = store.settings(), log = egressLog();
  const bytes = Object.keys(localStorage).filter(k => k.startsWith("orallexa.")).reduce((a, k) => a + (localStorage.getItem(k)?.length ?? 0), 0);
  return `<section class="card hero ${s.claudeEnabled ? "neutral" : "bull"}">
    <div class="label">Outbound network</div>
    <div class="verdict small">${s.claudeEnabled ? "1 HOST" : "OFF"}</div>
    <p>${s.claudeEnabled ? `Only <b>${ALLOWED_HOSTS[0]}</b>, only when you tap “run debate”. Every other destination is refused.` : "No request can leave this phone. All analysis runs locally."}</p>
  </section>
  <section class="card"><div class="label">What stays on this phone</div>
    <ul class="reasons"><li>Imported price files (${store.datasets().length})</li><li>Trade journal (${store.journal().length} entries)</li>
    <li>Account size, risk settings, API key</li><li>All indicators, strategies, backtests, risk sizing</li></ul>
    <p class="muted small">${(bytes / 1024).toFixed(1)} KB in app-private storage. Excluded from cloud backup and device transfer.</p>
    <button class="btn danger" id="wipe">Erase all app data</button></section>
  <section class="card"><div class="label">Live network log · ${log.length} attempts this session</div>
    ${log.length ? log.map(e => `<div class="lg ${e.allowed ? "ok" : "no"}"><b>${e.allowed ? "SENT" : "BLOCKED"}</b> ${esc(e.api)} → ${esc(e.host)}<div class="muted small">${esc(e.at.slice(11, 19))} · ${esc(e.reason)}${e.bytesOut > 0 ? ` · ${e.bytesOut} B out` : ""}</div></div>`).join("")
    : `<p class="muted">Nothing has tried to leave the device.</p>`}</section>`;
}

function viewSettings() {
  const s = store.settings();
  return `<section class="card"><div class="label">Risk</div>
    <label class="f">Account size<input id="acct" type="number" inputmode="decimal" value="${s.account}"></label>
    <label class="f">Risk per trade (%)<input id="riskp" type="number" inputmode="decimal" step="0.1" value="${(s.riskPct * 100).toFixed(1)}"></label>
  </section>
  <section class="card"><div class="label">Claude debate (optional)</div>
    <label class="tog"><input id="cl" type="checkbox" ${s.claudeEnabled ? "checked" : ""}> Allow requests to ${ALLOWED_HOSTS[0]}</label>
    <label class="f">Anthropic API key<input id="key" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="sk-ant-…"></label>
    <label class="f">Model<input id="model" value="${esc(s.model)}"></label>
    <label class="tog"><input id="alias" type="checkbox" ${s.tickerAlias ? "checked" : ""}> Hide ticker name (send “ASSET-A”)</label>
    <p class="muted small">Your key is stored only on this phone and sent only to ${ALLOWED_HOSTS[0]}.</p>
  </section>
  <button class="btn" id="save">Save</button>`;
}

function render() {
  const views = { analyze: viewAnalyze, backtest: viewBacktest, journal: viewJournal, privacy: viewPrivacy, settings: viewSettings };
  $("#main").innerHTML = views[tab]();
  document.querySelectorAll<HTMLButtonElement>("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  $("#net").textContent = store.settings().claudeEnabled ? "1 host" : "offline";
  $("#net").className = store.settings().claudeEnabled ? "pill warn" : "pill";
  bind();
}

function bind() {
  $("#ds")?.addEventListener("change", e => selectDataset(store.datasets().find(d => d.id === (e.target as HTMLSelectElement).value) ?? null));
  $("#file")?.addEventListener("change", e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importFile(f); });
  if (analysis && $("#px")) {
    const i = analysis.ind, k = Math.max(0, i.close.length - 180);
    drawChart($("#px") as HTMLCanvasElement, [
      { values: i.close.slice(k), color: "#F5E6CA" },
      { values: i.MA20.slice(k), color: "#D4AF37", width: 1 },
      { values: i.MA50.slice(k), color: "#8B8E96", width: 1, dash: [4, 3] },
    ], [analysis.bars[k].date, analysis.bars[analysis.bars.length - 1].date]);
  }
  if (analysis && $("#eq")) {
    const sel = analysis.backtests.find(b => b.key === btSelected) ?? analysis.backtests[0];
    drawChart($("#eq") as HTMLCanvasElement, [
      { values: sel.result.market, color: "#8B8E96", width: 1, dash: [4, 3] },
      { values: sel.result.equity, color: "#D4AF37", width: 2 },
    ], [analysis.bars[0].date, analysis.bars[analysis.bars.length - 1].date]);
  }
  document.querySelectorAll<HTMLTableRowElement>("tr[data-k]").forEach(tr => tr.addEventListener("click", () => { btSelected = tr.dataset.k!; render(); }));
  $("#log")?.addEventListener("click", () => {
    if (!analysis || !current) return;
    const n = analysis.bars.length - 1, s = store.settings();
    const r = sizeRisk(analysis.verdict, analysis.riskLevel, s.account, s.riskPct, analysis.ind.close[n], analysis.ind.ATR[n]);
    store.addJournal({ id: uid(), at: new Date().toISOString(), ticker: current.name, verdict: analysis.verdict, price: analysis.ind.close[n], note: ($("#note") as HTMLTextAreaElement).value.trim(), size: r.approved ? r.positionSize : undefined });
    toast("Saved to journal on this phone");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-del]").forEach(b => b.addEventListener("click", () => { store.deleteJournal(b.dataset.del!); render(); }));
  $("#wipe")?.addEventListener("click", () => {
    if (!confirm("Erase all imported data, journal, settings and API key from this phone?")) return;
    store.wipe(); setOutboundEnabled(false); selectDataset(ensureData()); tab = "privacy"; render(); toast("All app data erased");
  });
  $("#save")?.addEventListener("click", () => {
    const v = (id: string) => ($(id) as HTMLInputElement);
    store.saveSettings({
      account: Math.max(0, parseFloat(v("#acct").value) || 0), riskPct: Math.max(0, parseFloat(v("#riskp").value) || 0) / 100,
      claudeEnabled: v("#cl").checked, apiKey: v("#key").value.trim(), model: v("#model").value.trim() || "claude-sonnet-5-5", tickerAlias: v("#alias").checked,
    });
    setOutboundEnabled(store.settings().claudeEnabled);
    debate = {}; render(); toast("Saved on this phone");
  });
  $("#debate")?.addEventListener("click", async () => {
    if (!analysis || !current) return;
    const s = store.settings(), btn = $("#debate") as HTMLButtonElement;
    btn.disabled = true; btn.textContent = "Debating…"; debate = {};
    try {
      await runDebate(s.apiKey, s.model, buildSnapshot(analysis, s.tickerAlias ? "ASSET-A" : current.name), (k, t) => { debate[k] = t; render(); });
    } catch (e) { toast(`Debate failed: ${(e as Error).message}`); render(); }
  });
}

document.querySelectorAll<HTMLButtonElement>("nav button").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab as Tab; render(); window.scrollTo(0, 0); }));
onEgress(() => { if (tab === "privacy") render(); });
selectDataset(ensureData());

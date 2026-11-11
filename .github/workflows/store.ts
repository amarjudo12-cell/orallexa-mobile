// All persistent state lives in the WebView's app-private storage on the phone.
// Android sandboxes it per app; android:allowBackup="false" plus the
// data-extraction rules stop it being copied to Google Drive or another device.
import type { Bar } from "./engine/indicators";

export interface Dataset { id: string; name: string; importedAt: string; bars: Bar[]; demo?: boolean }
export interface JournalEntry { id: string; at: string; ticker: string; verdict: string; price: number; note: string; size?: number }
export interface Settings {
  claudeEnabled: boolean; apiKey: string; model: string;
  account: number; riskPct: number; tickerAlias: boolean;
}

const KEY = "orallexa.v1.";
const DEFAULTS: Settings = { claudeEnabled: false, apiKey: "", model: "claude-sonnet-5-5", account: 10000, riskPct: 0.01, tickerAlias: false };

function get<T>(k: string, d: T): T {
  try { const v = localStorage.getItem(KEY + k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
}
function set(k: string, v: unknown) { localStorage.setItem(KEY + k, JSON.stringify(v)); }

export const store = {
  settings: (): Settings => ({ ...DEFAULTS, ...get<Partial<Settings>>("settings", {}) }),
  saveSettings: (s: Partial<Settings>) => set("settings", { ...store.settings(), ...s }),
  datasets: (): Dataset[] => get<Dataset[]>("datasets", []),
  saveDataset: (d: Dataset) => set("datasets", [d, ...store.datasets().filter(x => x.id !== d.id)].slice(0, 20)),
  deleteDataset: (id: string) => set("datasets", store.datasets().filter(x => x.id !== id)),
  journal: (): JournalEntry[] => get<JournalEntry[]>("journal", []),
  addJournal: (e: JournalEntry) => set("journal", [e, ...store.journal()]),
  deleteJournal: (id: string) => set("journal", store.journal().filter(x => x.id !== id)),
  wipe: () => Object.keys(localStorage).filter(k => k.startsWith(KEY)).forEach(k => localStorage.removeItem(k)),
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

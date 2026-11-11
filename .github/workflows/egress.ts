// Egress guard — the app's single network chokepoint.
//
// Layer 1 (this file): every JS networking API is wrapped. Only hosts in
//   ALLOWED_HOSTS may be contacted, and only while the user has switched the
//   Claude debate on. Every attempt — allowed or blocked — is logged and shown
//   on the Privacy screen, so the user can audit traffic on the phone itself.
// Layer 2 (index.html): a Content-Security-Policy whose connect-src lists the
//   same single host, so the WebView itself refuses anything else even if this
//   guard were bypassed.
// Layer 3 (Android manifest / network config): no cleartext, no backup to the
//   cloud, no analytics SDKs. See android/ and PRIVACY.md.

export const ALLOWED_HOSTS = ["api.anthropic.com"] as const;

export interface EgressEvent {
  at: string;
  api: string;
  url: string;
  host: string;
  allowed: boolean;
  bytesOut: number;
  reason: string;
}

const log: EgressEvent[] = [];
const listeners = new Set<() => void>();
let outboundEnabled = false;

export const egressLog = () => log.slice();
export const onEgress = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const setOutboundEnabled = (on: boolean) => { outboundEnabled = on; };

function record(e: Omit<EgressEvent, "at">) {
  log.unshift({ ...e, at: new Date().toISOString() });
  if (log.length > 200) log.pop();
  listeners.forEach(fn => fn());
}

function classify(raw: string): { url: URL | null; local: boolean } {
  try {
    const url = new URL(raw, location.href);
    // Bundled assets are served from the app's own origin (https://localhost on Android).
    const local = url.origin === location.origin || url.protocol === "data:" || url.protocol === "blob:";
    return { url, local };
  } catch { return { url: null, local: false }; }
}

export function checkEgress(raw: string, api: string, bytesOut = 0): void {
  const { url, local } = classify(raw);
  if (local) return;
  const host = url?.hostname ?? "(unparseable)";
  let reason = "";
  if (!url || url.protocol !== "https:") reason = "not https";
  else if (!(ALLOWED_HOSTS as readonly string[]).includes(host)) reason = "host not on allowlist";
  else if (!outboundEnabled) reason = "Claude debate is switched off";
  record({ api, url: url ? url.origin + url.pathname : raw, host, allowed: !reason, bytesOut, reason: reason || "allowlisted" });
  if (reason) throw new TypeError(`Blocked by Orallexa privacy guard: ${host} (${reason})`);
}

function bodySize(body: unknown): number {
  if (body == null) return 0;
  if (typeof body === "string") return new TextEncoder().encode(body).length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return -1;
}

export function installEgressGuard(w: Window & typeof globalThis = window): void {
  const realFetch = w.fetch.bind(w);
  w.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    try { checkEgress(url, "fetch", bodySize(init?.body)); } catch (e) { return Promise.reject(e); }
    return realFetch(input, init);
  };

  const RealXHR = w.XMLHttpRequest;
  w.XMLHttpRequest = class extends RealXHR {
    private _u = "";
    open(method: string, url: string | URL, ...rest: unknown[]) {
      this._u = String(url);
      // @ts-expect-error forwarding variadic args
      return super.open(method, url, ...rest);
    }
    send(body?: Document | XMLHttpRequestBodyInit | null) {
      checkEgress(this._u, "xhr", bodySize(body));
      return super.send(body);
    }
  } as typeof XMLHttpRequest;

  const block = (api: string) => function (url: string | URL) {
    const { url: u } = classify(String(url));
    record({ api, url: String(url), host: u?.hostname ?? "(unparseable)", allowed: false, bytesOut: 0, reason: `${api} is disabled in this app` });
    throw new TypeError(`${api} disabled by Orallexa privacy guard`);
  };
  // No feature of the app needs these; any attempt is logged and refused.
  Object.defineProperty(w, "WebSocket", { value: block("websocket"), writable: false, configurable: false });
  Object.defineProperty(w, "EventSource", { value: block("eventsource"), writable: false, configurable: false });
  if ("sendBeacon" in w.navigator) {
    Object.defineProperty(w.navigator, "sendBeacon", {
      value: (url: string) => { const { url: u } = classify(url); record({ api: "beacon", url, host: u?.hostname ?? "", allowed: false, bytesOut: 0, reason: "beacon is disabled in this app" }); return false; },
      configurable: false,
    });
  }
}

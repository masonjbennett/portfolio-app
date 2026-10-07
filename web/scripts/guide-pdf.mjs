// Exports the guide (the page at ?guide) to public/guide.pdf, the copy the guide links for sending. The PDF is never
// written apart from the page: this prints the page itself, with its own print stylesheet (src/guide/Guide.css).
//
//   npm run guide:pdf               export when the guide has changed since the PDF was made
//   npm run guide:pdf -- --force    export anyway (after a stylesheet-only change, which the edition does not see)
//
// It starts Vite's dev server on a free port, opens the guide in headless Edge (or Chrome) with a fresh profile, and
// prints it over the DevTools protocol with Node's own WebSocket, so it needs no package beyond the ones the page builds
// with. Before printing it points every link at the page's public address (src/content/about.tsx APP_URL) rather than
// the dev server's, opens the footing's Methodology, and writes the guide's edition into the document's title
// (./guide-edition.mjs). It checks the bytes BEFORE writing: a PDF, under MAX_BYTES, carrying this edition, every link
// on the public addresses, and no local address, path or user name in its readable parts. A failed check writes
// nothing and exits 1. test/t-guide.mjs runs the same checks on the committed file.
//
// The browser: GUIDE_BROWSER if set, else the first of the usual Edge and Chrome paths that exists.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { guideEdition, pdfEdition, pdfTitle } from "./guide-edition.mjs";
import { pdfProblems } from "./guide-pdf-check.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const OUT = join(root, "public", "guide.pdf");
const force = process.argv.includes("--force");
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
const WAIT_MS = 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error(`guide:pdf: ${msg}`);
  process.exitCode = 1;
};

async function until(what, fn, ms = WAIT_MS) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
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

async function main() {
  const edition = await guideEdition();
  if (!force && existsSync(OUT) && pdfEdition(readFileSync(OUT)) === edition) {
    console.log(`guide:pdf: public/guide.pdf is already edition ${edition}; nothing to do (--force to export anyway)`);
    return;
  }
  const browser = BROWSERS.find((p) => existsSync(p));
  if (!browser) return fail("no Edge or Chrome found; set GUIDE_BROWSER to one");

  const { APP_URL } = await import("../src/content/about.tsx");
  const { GUIDE_HREF } = await import("../src/guide/route.ts");
  const title = await pdfTitle(edition);

  const { createServer } = await import("vite");
  const server = await createServer({ root, logLevel: "error", server: { port: 0, strictPort: false, open: false } });
  const profile = mkdtempSync(join(tmpdir(), "guide-pdf-"));
  let proc = null;
  let s = null;
  try {
    await server.listen();
    const origin = (server.resolvedUrls?.local?.[0] ?? "").replace(/\/$/, "");
    if (!origin) throw new Error("the dev server did not say where it listens");

    proc = spawn(browser, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--hide-scrollbars", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank",
    ], { stdio: "ignore" });
    const port = await until("the browser's debugging port", () => {
      const f = join(profile, "DevToolsActivePort");
      return existsSync(f) ? Number(readFileSync(f, "utf8").split(/\r?\n/)[0]) || null : null;
    });
    const target = await until("a page in the browser", async () => {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json(), () => []);
      return list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    });
    s = session(target);
    await s.open;
    await s.send("Page.enable");
    await s.send("Runtime.enable");
    await s.send("Page.navigate", { url: `${origin}/${GUIDE_HREF}` });
    await until("the guide to load", () => s.seen.has("Page.loadEventFired"));
    await until("the guide to render", () => evaluate(s, `!!document.querySelector(".guide-body")`));
    await evaluate(s, "document.fonts.ready.then(() => true)");

    // Paper: links to the public page (in-page ones stay in-page), the methodology open, the edition in the title.
    const done = await evaluate(s, `(() => {
      const app = ${JSON.stringify(APP_URL)};
      for (const a of document.querySelectorAll("a[href]")) {
        const raw = a.getAttribute("href");
        if (raw.startsWith("#")) continue;
        const u = new URL(raw, location.href);
        if (u.origin === location.origin) a.setAttribute("href", new URL(u.pathname.replace(/^\\//, "") + u.search + u.hash, app).href);
      }
      for (const d of document.querySelectorAll("details")) d.open = true;
      document.title = ${JSON.stringify(title)};
      const at = document.querySelector(".guide-printed");
      if (at) at.append(" Edition " + ${JSON.stringify(edition)} + ".");
      return document.querySelectorAll("a[href^='http://']").length === 0;
    })()`);
    if (!done) throw new Error("a link still points at an http:// address after the rewrite");
    await sleep(300);

    const print = { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, transferMode: "ReturnAsBase64" };
    let pdf;
    try {
      pdf = await s.send("Page.printToPDF", { ...print, generateTaggedPDF: true, generateDocumentOutline: true });
    } catch {
      pdf = await s.send("Page.printToPDF", print); // an older browser without the tagged PDF and outline options
    }
    const buf = Buffer.from(pdf.data, "base64");
    const problems = pdfProblems(buf, edition);
    if (problems.length) throw new Error(`the PDF failed its checks, nothing written:\n  ${problems.join("\n  ")}`);
    writeFileSync(OUT, buf);
    console.log(`guide:pdf: wrote public/guide.pdf, edition ${edition}, ${(buf.length / 1024).toFixed(1)} kB`);
  } catch (err) {
    fail(err.message);
  } finally {
    try {
      await s?.send("Browser.close");
    } catch {
      // already gone
    }
    s?.close();
    proc?.kill();
    await server.close();
    for (let i = 0; i < 20; i++) {
      try {
        rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(250); // the browser still holds its profile for a moment after it exits
      }
    }
  }
}

await main();

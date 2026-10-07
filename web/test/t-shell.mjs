// The shell the page is built on: the baked first-screen data, the design tokens, the component
// test harness (test/_tsx.mjs, test/_dom.mjs), index.html, and the dev-only /api bridge in
// vite.config.ts. Each part below is held to something it could get wrong without anyone seeing.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { check, done } from "./_assert.mjs";
import { bakeText, OUT, PUBLIC_PATH, SOURCE, RUN } from "../scripts/bake-example.mjs";
import { tokens } from "../src/styles/tokens.ts";

const root = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

// ---- (a) the baked example ------------------------------------------------------------------
const baked = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
check(baked === bakeText(), "bake: public/example-cross.json is byte-for-byte a fresh bake (run `npm run bake`)");

// Held to the fixture directly, not through bake(): a bake that rounded would still equal itself.
const px = JSON.parse(readFileSync(SOURCE, "utf8"));
const ex = JSON.parse(baked || '{"prices":[]}');
check(JSON.stringify(Object.keys(ex)) ===
  '["set","tickers","benchmark","benchLabel","rf","start","end","pulledAt","missing","columns","dates","prices"]',
  "bake: inputs only, no oracle output", Object.keys(ex).join(","));
check(JSON.stringify(ex.dates) === JSON.stringify(px.rows.map((r) => r[0])), "bake: dates are the fixture's");
let diff = null;
for (let j = 0; j < px.columns.length && !diff; j++) {
  for (let i = 0; i < px.rows.length; i++) {
    if (!Object.is(ex.prices[j]?.[i], px.rows[i][j + 1])) {
      diff = `${px.columns[j]} ${px.rows[i][0]}: ${ex.prices[j]?.[i]} vs ${px.rows[i][j + 1]}`;
      break;
    }
  }
}
check(!diff && ex.prices?.length === px.columns.length, "bake: every price is the fixture's double, unrounded", diff ?? "");
check(JSON.stringify([ex.tickers, ex.benchmark, ex.columns, ex.missing]) ===
  JSON.stringify([px.tickers, px.benchmark, px.columns, px.missing]), "bake: tickers, benchmark, columns, missing");
// The rate the oracle was run with, read from the dump script's own constant.
const rf = Number(/^RF = ([0-9.]+)/m.exec(read("test/oracle/dump_oracle.py"))?.[1]);
const run = JSON.parse(readFileSync(RUN, "utf8"));
check(ex.rf === rf && ex.rf === run.rf, "bake: rf is the one the fixture's oracle ran with", `${ex.rf} vs ${rf}`);
check(ex.benchLabel === "S&P 500" && ex.benchLabel === run.benchLabel, "bake: benchmark label");

// ---- (b) tokens.css and tokens.ts agree ---------------------------------------------------------
const css = read("src/styles/tokens.css");
const cssVars = new Map([...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const tsVars = new Map();
for (const [group, entries] of Object.entries(tokens)) {
  for (const [k, v] of Object.entries(entries)) tsVars.set(`--${group}-${k}`, v);
}
const onlyCss = [...cssVars.keys()].filter((k) => !tsVars.has(k));
const onlyTs = [...tsVars.keys()].filter((k) => !cssVars.has(k));
check(!onlyCss.length && !onlyTs.length, "tokens: the same names in tokens.css and tokens.ts",
  `css only: ${onlyCss.join(" ")}; ts only: ${onlyTs.join(" ")}`);
const unequal = [...tsVars].filter(([k, v]) => cssVars.has(k) && cssVars.get(k) !== v).map(([k]) => k);
check(!unequal.length && cssVars.size > 20, "tokens: the same value for every name", unequal.join(" "));
check(JSON.stringify(tokens.color) === JSON.stringify({
  paper: "#faf3ea", ink: "#262421", ink2: "#33302c", teal: "#0d6d56", navy: "#1f5a9e", plum: "#6d549e",
  claret: "#990f3d", bronze: "#b0741e", red: "#b2342b", hairline: "#ddcfb8", hairline2: "#e9ddc9",
  up: "#0d6d56", down: "#b2342b",
}), "tokens: the brand palette, exactly");
const base = read("src/styles/base.css");
const undefinedVars = [...base.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]).filter((v) => !cssVars.has(v));
check(!undefinedVars.length, "base.css: every var() it reads is a token", undefinedVars.join(" "));
const main = read("src/main.tsx");
check(/import "\.\/styles\/tokens\.css";[\s\S]*import "\.\/styles\/base\.css";/.test(main),
  "main.tsx: loads tokens.css, then base.css");

// ---- (c) components render, on the server and in a DOM ------------------------------------------
check(globalThis.__tsxLoader === true, "loader: test/_tsx.mjs is registered for this suite (via test/run.mjs)");
const dom = await import("./_dom.mjs");
const win = globalThis.window;
const again = await import("./_dom.mjs?second");
check(globalThis.window === win && !!win.document.body, "dom: a second import reuses the same window");
const { createElement: h, Component } = await import("react");
const sample = document.createElement("div");
sample.innerHTML = "<p>  up \n to</p>\n<p>ten </p>";
check(dom.text(sample) === "up to ten", "dom: text() collapses whitespace as a reader sees it", dom.text(sample));
const { renderToStaticMarkup } = await import("react-dom/server");
let probe = null;
try {
  probe = await import("./fixtures/shell-probe.tsx");
} catch (err) {
  console.log(`  (probe import failed: ${err.message.split("\n")[0]})`);
}
check(!!probe, "loader: a .tsx with JSX, types, CSS, a font import and an extensionless import loads");
if (probe) {
  const html = renderToStaticMarkup(h(probe.Probe, { label: "Basket" }));
  check(html === '<p class="shell-probe">Basket: up to 10 tickers</p>', "server render: renderToStaticMarkup", html);

  const view = again.render(h(probe.Probe, { label: "Basket" }));
  check(dom.text(view.container) === "Basket: up to 10 tickers" && !!view.container.querySelector("p.shell-probe"),
    "client render: text and markup in the DOM", dom.text(view.container));
  view.rerender(h(probe.Probe, { label: "Other" }));
  check(dom.text(view.container) === "Other: up to 10 tickers", "client render: rerender", dom.text(view.container));
  view.unmount();
  check(!document.querySelector(".shell-probe"), "client render: unmount removes it");

  // A render that throws must reach the suite as an error, and a boundary must be able to catch it.
  const quiet = console.error;
  const quietWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  let thrown = null;
  try {
    dom.render(h(probe.Boom));
  } catch (err) {
    thrown = err;
  }
  class Catch extends Component {
    constructor(props) {
      super(props);
      this.state = { failed: null };
    }
    static getDerivedStateFromError(err) {
      return { failed: err.message };
    }
    render() {
      return this.state.failed ? h("p", null, `caught: ${this.state.failed}`) : this.props.children;
    }
  }
  let caught = null;
  try {
    caught = dom.render(h(Catch, null, h(probe.Boom)));
  } catch {
    // reported by the check below
  }
  console.error = quiet;
  console.warn = quietWarn;
  check(thrown?.message === "probe render failure", "client render: a throwing component throws out of render()",
    String(thrown));
  check(!!caught && dom.text(caught.container) === "caught: probe render failure", "client render: an error boundary catches it");
  check(!document.body.querySelector(".shell-probe") && document.body.children.length === 1,
    "client render: a failed render leaves nothing mounted", String(document.body.children.length));
  caught?.unmount();
}
const font = await import("@fontsource/jetbrains-mono/400.css").catch((err) => err);
check(!(font instanceof Error) && Object.keys(font).length === 0, "loader: an @fontsource stylesheet is an empty module");
let missingFont = false;
try {
  await import("@fontsource/space-grotesk/450.css");
} catch (err) {
  missingFont = err.code === "ERR_MODULE_NOT_FOUND";
}
check(missingFont, "loader: a font weight the package does not ship fails, as it would in Vite");
let missingCss = false;
try {
  await import("./fixtures/no-such-file.css");
} catch (err) {
  missingCss = err.code === "ERR_MODULE_NOT_FOUND";
}
check(missingCss, "loader: a .css import that does not exist fails, as it would in Vite");

// ---- (d) index.html -----------------------------------------------------------------------------
const index = read("index.html");
const links = [...index.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
const preload = links.find((l) => /rel="preload"/.test(l));
check(!!preload && preload.includes(`href="${PUBLIC_PATH}"`) && /as="fetch"/.test(preload) && /\bcrossorigin\b/.test(preload),
  "index.html: preloads the baked example as a CORS fetch", preload ?? "no preload");
check(fileURLToPath(OUT) === fileURLToPath(new URL(`public${PUBLIC_PATH}`, root)), "bake: writes the path index.html preloads");
check(/<html lang="en">/.test(index) && /<title>Portfolio Analytics · Mason Bennett<\/title>/.test(index) && /id="root"/.test(index),
  "index.html: lang, title, #root");

// The unfurl: what a pasted link turns into. Every tag once; og:description is the published card
// sentence word for word, read from both files, so a change to either goes red until the other follows.
{
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const metas = [...index.matchAll(/<meta\b([^>]*)>/g)].map((m) => {
    const attr = (k) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1])?.[1];
    return { key: attr("property") ?? attr("name"), content: attr("content") === undefined ? undefined : decode(attr("content")) };
  });
  const meta = (k) => metas.filter((m) => m.key === k);
  const one = (k) => (meta(k).length === 1 ? meta(k)[0].content : undefined);
  const title = decode(/<title>([^<]*)<\/title>/.exec(index)?.[1] ?? "");
  const { CARD_SENTENCE } = await import("../src/content/published.ts");
  check(one("og:description") === CARD_SENTENCE, "unfurl: og:description is the published card sentence, verbatim", one("og:description") ?? `${meta("og:description").length} tags`);
  check(one("og:title") === title && title === "Portfolio Analytics · Mason Bennett", "unfurl: og:title is the page title, with Mason's name", `${one("og:title")} / ${title}`);
  // Both sides of the departure: the app's own page_title (portfolio_app.py 14), and the port's title, which is
  // those words with the author's name after them.
  const appLines = readFileSync(new URL("../portfolio_app.py", root), "utf8").split(/\r?\n/);
  const appTitle = /st\.set_page_config\(page_title="([^"]+)"/.exec(appLines[13] ?? "")?.[1];
  check(appTitle === "Portfolio Analytics" && title === `${appTitle} · Mason Bennett` && title !== appTitle,
    "ledger:page-title the app's page title (line 14) is the port's first words, and the port adds the author's name", `${appTitle} / ${title}`);
  const want = {
    "og:type": "website",
    "og:url": "https://portfolio.masonjbennett.com/",
    "og:image": "https://portfolio.masonjbennett.com/og.png",
    "og:image:width": "1200",
    "og:image:height": "630",
    "twitter:card": "summary_large_image",
  };
  const wrong = Object.entries(want).filter(([k, v]) => one(k) !== v).map(([k]) => `${k}=${meta(k).map((m) => m.content).join("|") || "missing"}`);
  check(wrong.length === 0, "unfurl: type, url, image and its size, and the large-image card, each once", wrong.join("; "));
  const alt = one("og:image:alt") ?? "";
  check(alt.length >= 40 && alt.length <= 420 && /Sharpe/.test(alt), "unfurl: the image has alt text that says what it shows", alt);
  // Three of the nine rows are equal weight, which is fitted to nothing, so the alt text calls no figure fitted.
  check(!/\bfit/i.test(alt) && /whole window/.test(alt) && /held-out years/.test(alt), "unfurl: the alt text says scored on the whole window, never fitted", alt);
  const dupes = [...new Set(metas.map((m) => m.key).filter((k) => /^(og|twitter):/.test(k ?? "")))].filter((k) => meta(k).length !== 1);
  check(dupes.length === 0, "unfurl: no og or twitter tag is repeated (a crawler keeps one of two, and not always the same one)", dupes.join(" "));
  const img = new URL(one("og:image") ?? "about:blank");
  check(img.origin === new URL(one("og:url") ?? "about:blank").origin && img.pathname === "/og.png",
    "unfurl: the image is the site's own /og.png, served from public/", one("og:image"));
  // The file those tags point at: in public/, so the build copies it to the site's root; a PNG whose own header
  // says the size the tags say; small enough for a crawler to fetch; and nothing in it but pixels, so no text
  // chunk can carry a path or a name out of the machine that drew it.
  const file = new URL("public/og.png", root);
  const png = existsSync(file) ? readFileSync(file) : null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const types = [];
  if (png && sig.every((b, i) => png[i] === b)) {
    for (let at = 8; at + 8 <= png.length; at += 12 + png.readUInt32BE(at)) types.push(png.toString("latin1", at + 4, at + 8));
  }
  const size = png && types[0] === "IHDR" ? `${png.readUInt32BE(16)} x ${png.readUInt32BE(20)}` : "none";
  const textual = types.filter((t) => /^(tEXt|iTXt|zTXt|eXIf)$/.test(t));
  check(!!png && size === `${one("og:image:width")} x ${one("og:image:height")}` && png.length < 300 * 1024 && types.at(-1) === "IEND" && textual.length === 0,
    "unfurl: public/og.png is a PNG of the tagged size, under 300 kB, with no text chunk",
    png ? `${size}, ${png.length} bytes, chunks ${[...new Set(types)].join(" ")}` : "no public/og.png");
  // And it pictures the chart as the page now draws it: the record of what it was shot from still matches the
  // chart's figures, heading and marks, and the image itself (test/_og-inputs.mjs says how to record a new shot).
  const og = await import("./_og-inputs.mjs");
  const shot = og.record();
  check(!!shot && shot.inputs === og.inputsHash() && shot.image === og.imageHash(),
    "unfurl: public/og.png was shot from the chart's current figures, heading and marks (shoot it again, then record it)",
    JSON.stringify({ recorded: shot, now: { inputs: og.inputsHash(), image: og.imageHash() } }));
}
check(index.includes(`<meta name="theme-color" content="${tokens.color.paper}"`), "index.html: theme-color is paper");
const entry = /<script type="module" src="\/([^"]+)"/.exec(index)?.[1];
check(!!entry && existsSync(new URL(entry, root)), "index.html: its module entry exists", entry ?? "none");

// ---- (e) the dev /api bridge ---------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), "pa-devapi-"));
mkdirSync(join(tmp, "api"));
writeFileSync(join(tmp, "api", "echo.ts"), `
export async function GET(req: Request): Promise<Response> {
  const u = new URL(req.url);
  const headers = new Headers({ "x-out": "echoed", "content-type": "application/json" });
  headers.append("set-cookie", "a=1");
  headers.append("set-cookie", "b=2");
  return new Response(JSON.stringify({ method: req.method, search: u.search, probe: req.headers.get("x-probe") }),
    { status: 201, headers });
}
export async function POST(req: Request): Promise<Response> {
  return new Response(req.method + ":" + (await req.text()));
}
`);
writeFileSync(join(tmp, "api", "boom.ts"), `export async function GET(): Promise<Response> { throw new Error("kaboom"); }\n`);
const { devApi } = await import("../vite.config.ts");
const { createServer: vite } = await import("vite");
const server = await vite({
  configFile: false, root: tmp, logLevel: "silent", appType: "custom",
  server: { middlewareMode: true, ws: false, watch: null },
  plugins: [devApi(join(tmp, "api"))],
});
const http = createServer(server.middlewares);
await new Promise((ok) => http.listen(0, "127.0.0.1", ok));
const at = `http://127.0.0.1:${http.address().port}`;
try {
  let r = await fetch(`${at}/api/nope`);
  let body = await r.text();
  check(r.status === 404 && body.includes("api/nope.ts"), "dev api: an unknown handler is a clean 404", `${r.status} ${body}`);
  r = await fetch(`${at}/api/echo?a=1&b=two`, { headers: { "x-probe": "yes" } });
  body = await r.text();
  check(r.status === 201 && body === '{"method":"GET","search":"?a=1&b=two","probe":"yes"}',
    "dev api: method, query and headers reach the handler; its status comes back", `${r.status} ${body}`);
  check(r.headers.get("x-out") === "echoed" && JSON.stringify(r.headers.getSetCookie()) === '["a=1","b=2"]',
    "dev api: response headers come back, both Set-Cookies kept", JSON.stringify([...r.headers]));
  r = await fetch(`${at}/api/echo`, { method: "POST", body: "hello" });
  body = await r.text();
  check(r.status === 200 && body === "POST:hello", "dev api: a request body reaches the handler", `${r.status} ${body}`);
  r = await fetch(`${at}/api/echo`, { method: "DELETE" });
  check(r.status === 405 && r.headers.get("allow") === "GET, POST", "dev api: an unexported method is a 405 naming the others",
    `${r.status} ${r.headers.get("allow")}`);
  r = await fetch(`${at}/api/boom`);
  body = await r.text();
  check(r.status === 500 && body.includes("api/boom.ts") && body.includes("kaboom"),
    "dev api: a handler that throws is a 500 naming the handler", `${r.status} ${body}`);
} finally {
  await new Promise((ok) => http.close(ok));
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
}

// Drained, so a red run exits 1 like every other suite: the dev server above may still be closing a handle,
// and exiting on top of that aborts Node on Windows (see done()).
done("t-shell", { drain: true });

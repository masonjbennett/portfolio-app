// Who made the page, where its code lives, and how its figures are computed: the masthead's byline, the
// footer's methodology and its links (src/content/about.tsx, src/chrome/Masthead.tsx, src/chrome/Footer.tsx).
//
// (a) The byline, in the resume's words: "M.S. Finance", as masonjbennett.com says it. The app printed
//     "M.S. in Finance" until Sep 28 2026 (portfolio_app.py 802, 1108, 1177); it now says what the port does,
//     and this holds both to it, so neither can drift back alone.
// (b) The methodology states what the ENGINE does. Its numbers are the engine's constants, the two written
//     out (rolling windows, the net-exposure floor) are held here to the code that uses them, and its
//     solver is the port's: the app's expander names SLSQP (764-797), the port's names neither SLSQP nor scipy.
// (c) The links: the source link is this repository's own origin, and both links are plain, same-tab links.
// (d) The dek says what the page does, in place of the title the app's course assignment gave it, and the
//     methodology says in one line where the tool came from, without naming the course or counting anything.
import { readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { render, text } from "./_dom.mjs";

const { createElement: h } = await import("react");
const A = await import("../src/content/about.tsx");
const { default: Masthead } = await import("../src/chrome/Masthead.tsx");
const { default: Footer } = await import("../src/chrome/Footer.tsx");
const clean = await import("../src/lib/clean.ts");
const { TRADING_DAYS } = await import("../src/lib/stats.ts");
const { FRONTIER_POINTS, RF_FALLBACK } = await import("../src/state/defaults.ts");
const risk = await import("../src/tabs/risk/model.ts");
const corr = await import("../src/tabs/correlation/model.ts");
const { exampleAnalysis } = await import("./_analysis.mjs");

const web = new URL("../", import.meta.url);
const src = (rel) => readFileSync(new URL(rel, web), "utf8");
const APP = readFileSync(new URL("../../portfolio_app.py", import.meta.url), "utf8");
const EMOJI = /\p{Extended_Pictographic}/u;

// ---- (a) the byline ------------------------------------------------------------------------------------
{
  const r = render(h(Masthead, { analysis: { status: "ready", value: exampleAnalysis() }, fetching: false }));
  const by = r.container.querySelector(".masthead-byline");
  check(text(by ?? {}) === "Mason Bennett · M.S. Finance · University of Arkansas",
    "byline: the masthead reads \"Mason Bennett · M.S. Finance · University of Arkansas\", the resume's words", text(by ?? {}));
  const name = by?.querySelector("a");
  check(name?.getAttribute("href") === "https://masonjbennett.com" && text(name) === "Mason Bennett" && !name.hasAttribute("target"),
    "byline: the name links to masonjbennett.com, in the same tab", name?.outerHTML);
  check(!EMOJI.test(text(r.container)), "byline: no emoji in the masthead");
  r.unmount();

  const appLine = APP.split(/\r?\n/).find((l) => /^\s*Mason Bennett &nbsp;·&nbsp; /.test(l)) ?? "";
  check(appLine.trim().replaceAll("&nbsp;·&nbsp;", "·") === `${A.AUTHOR} · ${A.CREDENTIAL}`,
    "byline: the app's header line (1177) reads the port's byline word for word", appLine.trim());
  check(!/M\.S\. in Finance/.test(APP) && (APP.match(/M\.S\. Finance/g) ?? []).length === 3,
    "byline: all three of the app's bylines (802, 1108, 1177) say \"M.S. Finance\", none \"M.S. in Finance\"",
    (APP.match(/M\.S\.[^·<]*·/g) ?? []).join(" | "));
}

// ---- (b) the methodology ---------------------------------------------------------------------------------
{
  const r = render(h(Footer));
  const panel = r.container.querySelector("details.footer-method");
  check(!!panel && !panel.open && text(panel.querySelector("summary") ?? {}) === "Methodology",
    "method: the footer carries a Methodology panel, closed until asked for, as the app's expander is");
  const terms = [...(panel?.querySelectorAll("dt") ?? [])].map(text);
  check(terms.length === A.METHODS.length && A.METHODS.every((m) => terms.includes(m.term)) && panel.querySelectorAll("dd").length === terms.length,
    "method: every entry is rendered, a term and its definition", terms.join(", "));
  const body = text(panel ?? {});
  const pct = (x) => `${Math.round(x * 100)}%`;
  const wants = [
    [`× ${TRADING_DAYS}`, "the annualisation factor, TRADING_DAYS"],
    [`√${TRADING_DAYS}`, "the volatility scaling, √TRADING_DAYS"],
    [`more than ${pct(clean.MAX_MISSING)} of the trading days`, "the missing-data cut, MAX_MISSING"],
    [`at least ${clean.MIN_RANGE_DAYS / 365} years`, "the shortest range, MIN_RANGE_DAYS"],
    [`at least ${clean.MIN_TICKERS} tickers and ${clean.MIN_ROWS} days`, "MIN_TICKERS and MIN_ROWS"],
    [`${pct(RF_FALLBACK)} when FRED cannot be reached`, "the fallback rate, RF_FALLBACK"],
    [`at ${FRONTIER_POINTS} target returns`, "the frontier's points, FRONTIER_POINTS"],
    ["DGS3MO", "the FRED series the rate is read from"],
    ["30, 60, 90 or 120 trading days (60 to start)", "the rolling windows"],
    [`${pct(A.NET_FLOOR)} or less`, "the net-exposure floor"],
  ];
  const missing = wants.filter(([w]) => !body.includes(w)).map(([, why]) => why);
  check(missing.length === 0, "method: each number printed is the engine's own constant", missing.join("; "));

  // The two numbers written out in about.tsx, held to the code that uses them.
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  check(same([...A.ROLL_WINDOWS], [...risk.VOL_WINDOWS]) && same([...A.ROLL_WINDOWS], [...corr.WINDOWS]) &&
    A.ROLL_DEFAULT === risk.DEFAULT_WINDOW && A.ROLL_DEFAULT === corr.DEFAULT_WINDOW,
    "method: the rolling windows and their default are the Risk and Correlation tabs' own",
    `${A.ROLL_WINDOWS} / ${risk.VOL_WINDOWS} / ${corr.WINDOWS}; ${A.ROLL_DEFAULT} / ${risk.DEFAULT_WINDOW} / ${corr.DEFAULT_WINDOW}`);
  const floor = /if \(!\(total > ([\d.]+)\)\) return \{ ok: false, reason: "net-short"/.exec(src("src/lib/portfolio.ts"));
  check(!!floor && Number(floor[1]) === A.NET_FLOOR, "method: the net-exposure floor is normalizeCustom's own", floor?.[1]);
  check(/indicators\.adjclose/.test(src("src/data/prices.ts")) && body.includes("adjusted closes") && text(r.container).includes("adjusted closing prices"),
    "method: \"adjusted\" closes, because src/data/prices.ts reads Yahoo's adjclose, not close");

  // The solver, both sides.
  const start = APP.indexOf("About / Methodology");
  const appMethod = APP.slice(start, APP.indexOf('""")', start));
  check(start > 0 && /SLSQP/.test(appMethod) && /scipy/.test(appMethod),
    "method (ledger): the app's methodology describes its own solver, scipy's SLSQP (764-797)");
  check(!/SLSQP|scipy/i.test(body) && /quadratic programme/.test(body) && /quadprog/.test(body),
    "method (ledger): the port's describes the port's, exact quadratic programmes via quadprog, and never SLSQP");
  check(!EMOJI.test(text(r.container)), "method: no emoji in the footer (the app's expander is headed with one)");

  // ---- (c) the links -------------------------------------------------------------------------------------
  const links = [...r.container.querySelectorAll(".footer-links a")];
  const origin = /\[remote "origin"\][^[]*?url = (\S+)/.exec(readFileSync(new URL("../../.git/config", import.meta.url), "utf8"))?.[1] ?? "";
  const source = links.find((a) => text(a) === "Source code on GitHub");
  check(!!source && source.getAttribute("href") === A.SOURCE_URL && origin.replace(/\.git$/, "") === A.SOURCE_URL,
    "links: \"Source code on GitHub\" points at this repository's own origin", `${source?.getAttribute("href")} vs ${origin}`);
  const site = links.find((a) => text(a) === "masonjbennett.com");
  check(site?.getAttribute("href") === "https://masonjbennett.com", "links: the footer links masonjbennett.com");
  check(links.length === 2 && links.every((a) => !a.hasAttribute("target")), "links: two plain links, each opening in the same tab");
  r.unmount();
}

// ---- (d) the dek and the origin line ---------------------------------------------------------------------
{
  const r = render(h(Masthead, { analysis: { status: "loading" }, fetching: true }));
  const dek = text(r.container.querySelector(".masthead-dek") ?? {});
  const appDek = (APP.split(/\r?\n/).find((l) => /^\s*Mean-Variance Optimization/.test(l)) ?? "").trim().replaceAll("&amp;", "&");
  check(dek === A.DEK && appDek.length > 0 && dek !== appDek && !/Mean-Variance|Risk Analysis/.test(dek),
    "dek: the masthead says what the page does, not the app's assignment title", `${dek} | app: ${appDek}`);
  check(!/\d/.test(dek) && !/\b(best|optimal)\b/i.test(dek) && ["equal-weight", "minimum-variance", "maximum-Sharpe"].every((w) => dek.includes(w)),
    "dek: no counts and no \"best\", and it names the three portfolios the page builds", dek);
  r.unmount();

  const f = render(h(Footer));
  const panel = f.container.querySelector("details.footer-method");
  const rows = [...(panel?.querySelectorAll(".footer-method-row") ?? [])].map((row) => text(row.querySelector("dd") ?? {}));
  const origin = rows.filter((t) => /course/i.test(t));
  check(origin.length === 1 && origin[0] === A.ORIGIN && /^Began as a graduate course project and was improved afterwards\.$/.test(A.ORIGIN),
    "origin: the methodology says once that the tool began as a graduate course project and was improved afterwards", origin.join(" | "));
  const m = render(h(Masthead, { analysis: { status: "loading" }, fetching: false }));
  const page = text(f.container) + " " + text(m.container);
  m.unmount();
  check(!/\d/.test(A.ORIGIN) && !/Financial Data|Analytics II|FDA/i.test(page),
    "origin: the line counts nothing and no course is named on the page", A.ORIGIN);
  f.unmount();
}

done("t-about");

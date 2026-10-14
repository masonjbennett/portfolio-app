// The first chunk carries the page, not the charts. Recharts is most of the bundle and only the
// tabs draw with it, so App reaches each tab through a dynamic import (TAB_LOADERS) and the masthead,
// rail and band paint without it. Measured Sep 28 2026: one 717 KB chunk (219 KB gzip) before the
// split, and Vite warned on it; after it, a 202 KB entry (68 KB gzip).
//
// The oracle is the production build itself, run in memory through Vite's own API with the shipping
// vite.config.ts, so what this suite reads is what `vite build` writes to dist/. A static import of
// a tab, of a chart, or of recharts from anything the entry reaches puts it back in the first chunk,
// and this suite names the module.
//
// The build's own module graph rides along (a plugin that only reads it, `graph` below), so a check
// that finds a module in the first chunk can also name the first-chunk module that imports it.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { check, done } from "./_assert.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { build } = await import("vite");

const graph = new Map();
const readGraph = {
  name: "t-split:graph",
  generateBundle() {
    for (const id of this.getModuleIds()) graph.set(id, this.getModuleInfo(id));
  },
};

let out;
try {
  out = await build({ root, logLevel: "silent", build: { write: false }, plugins: [readGraph] });
} catch (err) {
  check(false, "split: the production build runs", err.message.split("\n")[0]);
  done("t-split");
}
const chunks = (Array.isArray(out) ? out.flatMap((o) => o.output) : out.output).filter((c) => c.type === "chunk");
const byName = new Map(chunks.map((c) => [c.fileName, c]));
const entry = chunks.find((c) => c.isEntry);
check(!!entry && chunks.filter((c) => c.isEntry).length === 1, "split: the build has one entry chunk", chunks.filter((c) => c.isEntry).map((c) => c.fileName).join());

// Everything the browser must load before first paint: the entry and what it imports statically.
const first = new Set();
const walk = (c) => {
  if (!c || first.has(c)) return;
  first.add(c);
  for (const f of c.imports) walk(byName.get(f));
};
walk(entry);
const rel = (id) => id.replace(/\\/g, "/").replace(/^.*?\/(node_modules|web\/src)\//, "$1/");
const firstIds = [...first].flatMap((c) => c.moduleIds.map(rel));

// Recharts pulls in d3's scales and shapes, victory-vendor and redux: none of them before a tab.
const CHART_LIBS = /^node_modules\/(recharts|victory-vendor|d3-[a-z-]+|@reduxjs|react-redux|immer)\//;
const heavy = firstIds.filter((id) => CHART_LIBS.test(id));
check(heavy.length === 0, "split: no chart library is in the first chunk", heavy.slice(0, 5).join(", "));
const tabsEarly = firstIds.filter((id) => /^web\/src\/(tabs|charts)\//.test(id));
check(tabsEarly.length === 0, "split: no tab and no chart module is in the first chunk", tabsEarly.slice(0, 5).join(", "));
check(firstIds.some((id) => id === "web/src/overview/Overview.tsx") && firstIds.some((id) => id === "web/src/App.tsx"),
  "split: the first chunk does carry the page (App and the Overview), so the checks above read the right chunk");

// The walk-forward tab and everything only it reads (the published test's stored weights, the engine that
// re-runs the test) stay out of the first chunk too, whichever directory they live in.
const WALK = /^web\/src\/(tabs\/WalkForward\.tsx|tabs\/walkforward\/|content\/walkforward\.ts|lib\/walkforward\.ts)/;
const walkEarly = firstIds.filter((id) => WALK.test(id));
check(walkEarly.length === 0, "split: nothing of the walk-forward tab, its data or its engine is in the first chunk", walkEarly.join(", "));
// Its words too: the tab's own tooltip texts (src/tabs/walkforward/tips.ts) are in the tab's chunk and in no chunk
// loaded before first paint. Read as text from the module's source, plain and finance levels (the formula level
// carries symbols the build may escape), and looked for by their first 40 characters.
{
  const src = readFileSync(new URL("../src/tabs/walkforward/tips.ts", import.meta.url), "utf8");
  const words = [...src.matchAll(/\b(?:plain|finance): "([^"]{40,})"/g)].map((m) => m[1].slice(0, 40));
  const firstCode = [...first].map((c) => c.code).join("\n");
  const tabChunk = chunks.find((c) => c.moduleIds.map(rel).includes("web/src/tabs/WalkForward.tsx"));
  // With the tab: in its chunk, or in a chunk it imports statically (the guide's glossary reads the same texts, so the
  // build may give them a chunk the two share), and never in one loaded before first paint.
  const withTab = new Set();
  const take = (c) => {
    if (!c || withTab.has(c) || first.has(c)) return;
    withTab.add(c);
    for (const f of c.imports) take(byName.get(f));
  };
  take(tabChunk);
  const tabCode = [...withTab].map((c) => c.code).join("\n");
  const early = words.filter((w) => firstCode.includes(w));
  check(words.length === 10 && early.length === 0 && !!tabChunk && words.every((w) => tabCode.includes(w)),
    "split: the walk-forward tab's tooltip texts load with the tab (its chunk or one it imports), none in the first chunk", early[0] ?? `${words.length} texts`);
}
// The share link names the scorecard's added constructions from their ids module, which imports no solver, not
// from the module that solves them.
{
  const url = readFileSync(new URL("../src/state/url.ts", import.meta.url), "utf8");
  check(/from "\.\.\/lib\/added\.ts"/.test(url) && !/lib\/constructions\.ts/.test(url) && firstIds.includes("web/src/lib/added.ts"),
    "split: the share link reads the added ids from lib/added.ts, never from lib/constructions.ts");
  // The tooltips quote the cap, its fewest assets and the last-year window from there too. Through the
  // re-export the build would follow either path to lib/added.ts; the import says where they live.
  const tips = readFileSync(new URL("../src/content/tooltips.ts", import.meta.url), "utf8");
  check(/import \{ CAP, CAP_MIN_ASSETS, YEAR_ROWS \} from "\.\.\/lib\/added\.ts"/.test(tips) && !/lib\/constructions\.ts/.test(tips),
    "split: the tooltips read the cap and the year from lib/added.ts, never from lib/constructions.ts");
}

// The solvers the first screen never runs stay out of the first chunk: the scorecard's added constructions
// (lib/constructions.ts), the what-if's and the redraws' engine (lib/robust.ts) and its random draws
// (lib/rng.ts), and the what-if panel that reaches them (chrome/WhatIf.tsx), which the band fetches when the
// reader opens it. Nor does any first-chunk module import one statically, even an import the build drops
// as unused today: the first use of it would bring the module in. A failure names the importer.
const firstSet = new Set(firstIds);
const infoOf = (id) => [...graph.values()].find((m) => rel(m.id) === id);
const pulledBy = (id) => (infoOf(id)?.importers ?? []).map(rel).filter((i) => firstSet.has(i));
{
  const SOLVERS = ["web/src/lib/constructions.ts", "web/src/lib/robust.ts", "web/src/lib/rng.ts", "web/src/chrome/WhatIf.tsx"];
  const early = SOLVERS.filter((id) => firstSet.has(id) || pulledBy(id).length > 0);
  check(graph.size > 0 && SOLVERS.every((id) => !!infoOf(id)) && early.length === 0,
    "split: no solver the first screen does not run is in the first chunk or imported by it (the added constructions, the what-if and its engine)",
    early.map((id) => `${id}${firstSet.has(id) ? "" : " (not bundled there yet)"}, imported by ${pulledBy(id).join(", ") || "the entry"}`).join("; ") ||
      `${graph.size} modules in the graph`);
  const home = chunks.filter((c) => c.moduleIds.map(rel).includes("web/src/chrome/WhatIf.tsx"));
  // Its row sits in Build a portfolio's More list, so the chunk that asks for it is whichever draws that chapter: the
  // first, or a chapter chunk of its own. Either way it asks on demand, and nothing imports the panel statically.
  const asker = chunks.find((c) => c.moduleIds.map(rel).includes("web/src/chrome/WhatIfRow.tsx"));
  const lazy = home.length === 1 && !!asker && home[0] !== asker && !first.has(home[0]) && asker.dynamicImports.includes(home[0].fileName) &&
    !chunks.some((c) => c.imports.includes(home[0].fileName));
  check(lazy, "split: the what-if panel is its own chunk, fetched on demand by its row's chunk, never imported statically",
    `${home.map((c) => c.fileName).join()} asked by ${asker?.fileName ?? "none"}`);
}
// The first screen does solve the minimum-variance and tangency mixes and the frontier (state/analyze.ts, the
// band's plates read them), so lib/optimize.ts, and quadprog under it, are first-chunk code; analyze.ts is
// the only first-chunk module that may import it.
{
  const by = pulledBy("web/src/lib/optimize.ts").filter((i) => i !== "web/src/state/analyze.ts");
  check(!!infoOf("web/src/lib/optimize.ts") && by.length === 0,
    "split: lib/optimize.ts is in the first chunk for the first screen's solve alone (state/analyze.ts)", by.join(", "));
}

// The guide (?guide) is its own chunk, which the entry fetches only when the address asks for it: the first chunk
// carries src/guide/route.ts (the address, and the title its links print) and nothing else of it, its words included.
{
  const GUIDE = /^web\/src\/(guide\/(?!route\.ts$)|content\/guide\.ts$)/;
  const early = firstIds.filter((id) => GUIDE.test(id));
  const home = chunks.filter((c) => c.moduleIds.map(rel).includes("web/src/guide/GuidePage.tsx"));
  const lazy = home.length === 1 && !first.has(home[0]) && [...first].some((c) => c.dynamicImports.includes(home[0].fileName));
  check(early.length === 0 && firstIds.includes("web/src/guide/route.ts") && lazy,
    "split: the guide is its own chunk, fetched on demand; the first chunk carries only its address", early.join(", ") || home.map((c) => c.fileName).join());
  const { GUIDE_DEK } = await import("../src/content/guide.ts");
  const firstCode = [...first].map((c) => c.code).join("\n");
  check(GUIDE_DEK.length > 40 && !firstCode.includes(GUIDE_DEK) && home.length === 1 && home[0].code.includes(GUIDE_DEK),
    "split: the guide's words load with the guide, none in the first chunk");
}

// Each tab is reached, and reached only, through the entry's dynamic imports.
for (const tab of ["Returns", "Risk", "Correlation", "Optimization", "Sensitivity", "WalkForward"]) {
  const home = chunks.filter((c) => c.moduleIds.map(rel).includes(`web/src/tabs/${tab}.tsx`));
  const lazy = home.length === 1 && !first.has(home[0]) && [...first].some((c) => c.dynamicImports.includes(home[0].fileName));
  check(lazy, `split: the ${tab} tab is its own chunk, loaded on demand`, home.map((c) => c.fileName).join());
}
// The app's Custom tab is the Your mix panel, drawn by the Optimization tab: it rides in that chunk, never the first.
{
  const homeOf = (path) => chunks.filter((c) => c.moduleIds.map(rel).includes(path));
  const mix = homeOf("web/src/tabs/custom/YourMix.tsx");
  const opt = homeOf("web/src/tabs/Optimization.tsx");
  check(mix.length === 1 && opt.length === 1 && mix[0] === opt[0] && !first.has(mix[0]) && homeOf("web/src/tabs/Custom.tsx").length === 0,
    "split: the Your mix panel loads with the Optimization tab, and there is no Custom tab chunk", mix.map((c) => c.fileName).join());
}

// Vite's own warning line (build.chunkSizeWarningLimit, 500 kB), so the warning cannot come back unseen.
const KB = 1000;
for (const c of chunks) check(c.code.length <= 500 * KB, `split: ${c.fileName} is under Vite's 500 kB warning`, `${(c.code.length / KB).toFixed(1)} kB`);
const firstBytes = [...first].reduce((n, c) => n + c.code.length, 0);
const firstGzip = [...first].reduce((n, c) => n + gzipSync(c.code).length, 0);
console.log(`  first chunk(s): ${(firstBytes / KB).toFixed(1)} kB, ${(firstGzip / KB).toFixed(1)} kB gzip; ${chunks.length} chunks in all`);

done("t-split");

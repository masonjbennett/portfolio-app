// The first chunk carries the page, not the charts. Recharts is most of the bundle and only the six
// tabs draw with it, so App reaches each tab through a dynamic import (TAB_LOADERS) and the masthead,
// rail and band paint without it. Measured Sep 28 2026: one 717 KB chunk (219 KB gzip) before the
// split, and Vite warned on it; after it, a 202 KB entry (68 KB gzip).
//
// The oracle is the production build itself, run in memory through Vite's own API with the shipping
// vite.config.ts, so what this suite reads is what `vite build` writes to dist/. A static import of
// a tab, of a chart, or of recharts from anything the entry reaches puts it back in the first chunk,
// and this suite names the module.
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { check, done } from "./_assert.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { build } = await import("vite");

let out;
try {
  out = await build({ root, logLevel: "silent", build: { write: false } });
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
check(firstIds.some((id) => id === "web/src/chrome/Band.tsx") && firstIds.some((id) => id === "web/src/App.tsx"),
  "split: the first chunk does carry the page (App and the band), so the checks above read the right chunk");

// Each tab is reached, and reached only, through the entry's dynamic imports.
for (const tab of ["Returns", "Risk", "Correlation", "Optimization", "Custom", "Sensitivity"]) {
  const home = chunks.filter((c) => c.moduleIds.map(rel).includes(`web/src/tabs/${tab}.tsx`));
  const lazy = home.length === 1 && !first.has(home[0]) && [...first].some((c) => c.dynamicImports.includes(home[0].fileName));
  check(lazy, `split: the ${tab} tab is its own chunk, loaded on demand`, home.map((c) => c.fileName).join());
}

// Vite's own warning line (build.chunkSizeWarningLimit, 500 kB), so the warning cannot come back unseen.
const KB = 1000;
for (const c of chunks) check(c.code.length <= 500 * KB, `split: ${c.fileName} is under Vite's 500 kB warning`, `${(c.code.length / KB).toFixed(1)} kB`);
const firstBytes = [...first].reduce((n, c) => n + c.code.length, 0);
const firstGzip = [...first].reduce((n, c) => n + gzipSync(c.code).length, 0);
console.log(`  first chunk(s): ${(firstBytes / KB).toFixed(1)} kB, ${(firstGzip / KB).toFixed(1)} kB gzip; ${chunks.length} chunks in all`);

done("t-split");

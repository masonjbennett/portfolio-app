// The guide ("How to read this page", ?guide) against the page it describes, and the PDF against the guide.
//
// The guide is written from the page's own names (src/content/guide.ts), so it can go stale two ways: it can name a
// tab, a section, a control or a figure the page no longer has, or the page can gain one the guide never mentions.
// This suite renders the page's parts the way a reader meets them (the band and the what-if panel, the rail in the
// states that show its buttons, every tab on the baked example, the scorecards with every row and column shown, the
// footing, the palette, the phone's settings row) and holds the guide to them BOTH ways:
//   (a) the tabs: the guide has an entry for each tab, in the page's order, and for each section heading each tab
//       renders, and no entry for a heading no tab renders;
//   (b) the rail: one entry per rail section, in the rail's order, under the heading the rail prints;
//   (c) every [[quoted name]] in an entry is on the part of the page that entry describes;
//   (d) the glossary's info marks are exactly the info marks the page renders, and each of the guide's own terms is a
//       word the page still uses;
//   (e) no figure is typed into the guide's own words: its source has no digit outside a [[quoted name]], and every
//       three-decimal figure it prints is one of the published ones (src/content/published.ts);
//   (f) the ways in: the address, the rail's link, the phone's link, the footing's link and the palette's entry;
//   (g) public/guide.pdf is the current edition of the guide (scripts/guide-edition.mjs), with nothing local in it.
//       When this fails after the guide changed, export it again: npm run guide:pdf.
import { existsSync, readFileSync } from "node:fs";
import { check, done } from "./_assert.mjs";
import { act, render, setMedia, text } from "./_dom.mjs";

const { createElement: h } = await import("react");
const G = await import("../src/content/guide.ts");
const { default: GuidePage, markGlossary, GUIDE_SECTIONS } = await import("../src/guide/GuidePage.tsx");
const { GUIDE_HREF, GUIDE_TITLE, isGuide } = await import("../src/guide/route.ts");
const { TAB_IDS, TAB_LABELS } = await import("../src/types.ts");
const { RAIL_IDS, RAIL_HEADINGS } = await import("../src/content/rail.ts");
const P = await import("../src/content/published.ts");
const A = await import("../src/content/about.tsx");
const { decodeShare } = await import("../src/state/url.ts");
const { default: Band } = await import("../src/chrome/Band.tsx");
const { default: WhatIf } = await import("../src/chrome/WhatIf.tsx");
const { default: Masthead } = await import("../src/chrome/Masthead.tsx");
const { default: Rail } = await import("../src/chrome/Rail.tsx");
const { default: Footer } = await import("../src/chrome/Footer.tsx");
const { default: CommandPalette } = await import("../src/chrome/CommandPalette.tsx");
const { default: SummaryChip } = await import("../src/chrome/SummaryChip.tsx");
const { AppView } = await import("../src/App.tsx");
const { TabContext } = await import("../src/state/useWorkbench.ts");
const { exampleAnalysis, examplePayload, settingsFor, tabProps } = await import("./_analysis.mjs");
const { guideEdition } = await import("../scripts/guide-edition.mjs");
const { pdfProblems } = await import("../scripts/guide-pdf-check.mjs");
const { ADDED_IDS } = await import("../src/lib/added.ts");

const TAB_FILES = {
  returns: "Returns", risk: "Risk", correlation: "Correlation", optimization: "Optimization", custom: "Custom",
  sensitivity: "Sensitivity", walkforward: "WalkForward",
};

const quietly = async (fn) => {
  const { error, warn } = console;
  console.error = console.warn = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { error, warn });
  }
};
const flush = () => act(async () => {
  for (let i = 0; i < 60; i += 1) await new Promise((r) => setTimeout(r, 0));
});
const click = (el) => act(() => el.click());
const key = (el, k, mods = {}) => act(() => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, ...mods })));
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const minus = (a, b) => [...a].filter((x) => !b.has(x));

// ---- the page, part by part ----------------------------------------------------------------------------------
//
// What a reader can find on a part: its text, and the names its controls carry (labels, titles, placeholders).
function corpus(root) {
  const names = [...root.querySelectorAll("[aria-label],[title],[placeholder],[alt]")].flatMap((el) =>
    ["aria-label", "title", "placeholder", "alt"].map((a) => el.getAttribute(a)).filter(Boolean));
  return [text(root), ...names].join(" \n ").replace(/\s+/g, " ");
}
const parts = {};
function take(name, root) {
  const p = (parts[name] ??= { text: "", marks: new Set(), slugs: new Set() });
  p.text += ` \n ${corpus(root)}`;
  for (const b of root.querySelectorAll("button.tip-mark")) p.marks.add((b.getAttribute("aria-label") ?? "").replace(/^About /, ""));
  for (const s of root.querySelectorAll(".slug-text")) p.slugs.add(text(s));
}

const EX = exampleAnalysis();
const ctx = (view) => ({ view, setTab() {}, rfHistory: { basis: "example", series: null, loading: false }, landing: 0, takeLanding: () => false });

// The band, at a desktop's width and a phone's (which folds the published sentence), the what-if panel it opens, the masthead.
for (const phone of [false, true]) {
  setMedia(() => phone);
  const r = await quietly(() => render(h(TabContext.Provider, { value: ctx("basket") },
    h(Band, { analysis: { status: "ready", value: EX }, level: "plain", fetching: false, failure: null, tickers: EX.tickers }))));
  take("band", r.container);
  r.unmount();
}
setMedia(() => false);
{
  const r = await quietly(() => render(h(WhatIf, { a: EX })));
  await quietly(flush);
  take("band", r.container);
  r.unmount();
  const m = render(h(Masthead, { analysis: { status: "ready", value: EX }, fetching: false }));
  take("band", m.container);
  m.unmount();
}

// The rail, in the two states that between them show every button it has: the rate over the window with today's
// beside it (which offers today's), and a typed rate with a set end date (which offer the window's and today).
const S0 = settingsFor(examplePayload());
const LIVE = { rate: 0.0412, date: "2026-09-25", source: "FRED DGS3MO" };
const VIEW = { ...LIVE, window: { rate: 0.0301, from: S0.start, to: "2026-09-25", days: 1900 }, basis: "window", inUse: 0.0301, loading: false };
let railOrder = [];
for (const settings of [{ ...S0, end: null, rf: null }, { ...S0, end: "2025-12-31", rf: 0.04 }]) {
  const r = render(h(Rail, { settings, setSettings() {}, level: "plain", setLevel() {}, rf: { status: "ready", value: VIEW }, fetching: false, failure: null }));
  take("rail", r.container);
  railOrder = [...r.container.querySelectorAll(".rail-heading")].map(text);
  const link = r.container.querySelector(".rail-guide a");
  check(link?.getAttribute("href") === GUIDE_HREF && text(link) === GUIDE_TITLE, "ways in: the rail opens on a link to the guide", link?.outerHTML ?? "none");
  r.unmount();
}
{
  const r = render(h(SummaryChip, { settings: S0, rf: { status: "ready", value: VIEW }, open: false, onToggle() {} }));
  take("chip", r.container);
  r.unmount();
}

// Every tab on the baked example, both walk-forward views, a custom mix set (which offers the reset), and every
// construction added to the scorecards (the columns a link's cols= opens with). Then every row shown, so the
// scorecards' info marks are all on the page.
for (const id of TAB_IDS) {
  const { default: Tab } = await import(`../src/tabs/${TAB_FILES[id]}.tsx`);
  for (const view of id === "walkforward" ? ["basket", "published"] : ["basket"]) {
    const base = tabProps(EX);
    const props = { ...base, settings: { ...base.settings, cols: [...ADDED_IDS] }, ...(id === "custom" ? { weights: { [EX.tickers[0]]: 0.5 } } : {}) };
    const r = await quietly(() => render(h(TabContext.Provider, { value: ctx(view) }, h(Tab, props))));
    await quietly(flush);
    take(`tab.${id}`, r.container);
    const more = [...r.container.querySelectorAll("button.sc-toggle[aria-pressed='false']")];
    for (const b of more) await quietly(() => click(b));
    await quietly(flush);
    take(`tab.${id}`, r.container);
    r.unmount();
  }
}

// The footing, the palette, and the whole page's chrome at both widths (the tab bar, the phone's settings row).
{
  const f = render(h(Footer));
  take("footer", f.container);
  const link = [...f.container.querySelectorAll(".footer-links a")].find((a) => a.getAttribute("href") === GUIDE_HREF);
  check(!!link && text(link) === GUIDE_TITLE, "ways in: the page's footing links the guide by its title", link?.outerHTML ?? "none");
  f.unmount();
  const g = render(h(Footer, { here: "guide" }));
  check(!g.container.querySelector(`a[href="${GUIDE_HREF}"]`) && !!g.container.querySelector("details.footer-method"),
    "ways in: the guide's footing keeps the methodology and does not link the guide to itself");
  g.unmount();

  let opened = 0;
  const p = render(h(CommandPalette, { level: "plain", setLevel() {}, tab: "returns", setTab() {}, openGuide: () => (opened += 1) }));
  key(document.body, "k", { ctrlKey: true });
  take("palette", p.container);
  const input = p.container.querySelector("input");
  const options = () => [...p.container.querySelectorAll("[role=option]")];
  if (input) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "guide");
    act(() => input.dispatchEvent(new window.Event("input", { bubbles: true })));
  }
  const listed = options().map(text);
  if (input) key(input, "Enter");
  check(listed.length === 1 && listed[0].includes(GUIDE_TITLE) && opened === 1,
    "ways in: typing \"guide\" in the palette lists the guide alone, and Enter opens it", `${listed.join(" | ")}; opened ${opened}`);
  p.unmount();
}
{
  const wb = {
    settings: S0, setSettings() {}, level: "plain", setLevel() {}, analysis: { status: "ready", value: EX }, fetching: false, failure: null,
    rf: { status: "ready", value: VIEW }, weights: {}, setWeights() {}, tab: "returns", setTab() {}, view: "basket",
    rfHistory: { basis: "example", series: null, loading: false },
  };
  const stub = Object.fromEntries(TAB_IDS.map((id) => [id, () => h("p", null, `tab body ${id}`)]));
  for (const phone of [false, true]) {
    setMedia(() => phone);
    const r = await quietly(() => render(h(AppView, { wb, tabs: stub })));
    take("app", r.container);
    const link = r.container.querySelector("a.app-guide");
    check(phone ? link?.getAttribute("href") === GUIDE_HREF && link.getAttribute("title") === GUIDE_TITLE : !link,
      `ways in: ${phone ? "a phone's settings row carries a link to the guide beside the chip" : "a desktop has no phone row link (the rail's is there)"}`,
      link?.outerHTML ?? "none");
    r.unmount();
  }
  setMedia(() => false);
}

const ALL = Object.values(parts).map((p) => p.text).join(" \n ");
const tabPart = (id) => parts[`tab.${id}`] ?? { text: "", marks: new Set(), slugs: new Set() };

// ---- (a) the tabs, both ways ------------------------------------------------------------------------------------
check(sameList(G.GUIDE_TAB_IDS, TAB_IDS) && Object.keys(G.GUIDE_TABS).every((id) => TAB_IDS.includes(id)),
  "tabs: the guide has one entry per tab, in the page's order, and none for a tab the page does not have",
  `guide ${Object.keys(G.GUIDE_TABS).join(",")} | page ${TAB_IDS.join(",")}`);
const flat = (heading) => (typeof heading === "string" ? [heading] : [...heading]);
for (const id of TAB_IDS) {
  const guide = new Set((G.GUIDE_TABS[id]?.sections ?? []).flatMap((s) => flat(s.heading)));
  const page = tabPart(id).slugs;
  const stale = minus(guide, page);
  const missing = minus(page, guide);
  check(page.size > 0 && stale.length === 0, `tabs: every section the guide names on ${TAB_LABELS[id]} is a heading the tab renders`, stale.join(" | "));
  check(page.size > 0 && missing.length === 0, `tabs: every section heading ${TAB_LABELS[id]} renders has its entry in the guide`, missing.join(" | "));
}

// ---- (b) the rail, both ways ------------------------------------------------------------------------------------
check(sameList(G.GUIDE_RAIL_IDS, RAIL_IDS) && Object.keys(G.GUIDE_RAIL).every((id) => RAIL_IDS.includes(id)),
  "rail: the guide has one entry per rail section, in the rail's order", `${Object.keys(G.GUIDE_RAIL).join(",")} | ${RAIL_IDS.join(",")}`);
check(sameList(railOrder, RAIL_IDS.map((id) => RAIL_HEADINGS[id])), "rail: the rail renders exactly the headings the guide's entries are filed under, in order",
  `${railOrder.join(" | ")}`);

// ---- (c) every quoted name is on the part of the page its entry describes -----------------------------------------
const marksOf = (s) => [...s.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1]);
const bodies = (part) => [...part.body];
const SCOPES = [
  ["the start", G.GUIDE_START, ALL],
  ["the one idea", G.GUIDE_IDEA.body, ALL],
  ["the first screen", G.GUIDE_FIRST_SCREEN.flatMap(bodies), parts.band.text],
  ["the settings", [...G.GUIDE_RAIL_INTRO, ...RAIL_IDS.flatMap((id) => G.GUIDE_RAIL[id] ?? [])], parts.rail.text],
  ["the phone's settings", [G.GUIDE_RAIL_PHONE], parts.chip.text],
  ["the tabs", G.GUIDE_TABS_INTRO, ALL],
  // A tab is read with the page around it (the tab bar, the band, the rail), which a reader on that tab also sees.
  ...TAB_IDS.map((id) => [TAB_LABELS[id], [...(G.GUIDE_TABS[id]?.opens ?? []), ...(G.GUIDE_TABS[id]?.sections ?? []).flatMap(bodies)], `${tabPart(id).text} ${parts.app.text}`]),
  ["every tab", G.GUIDE_EVERYWHERE.flatMap(bodies), ALL],
  ["the method", [G.GUIDE_METHOD], parts.footer.text],
];
let quoted = 0;
for (const [where, paras, page] of SCOPES) {
  const names = paras.flatMap(marksOf);
  quoted += names.length;
  const gone = names.filter((n) => !page.includes(n));
  check(gone.length === 0, `names: every name the guide quotes in ${where} is on that part of the page`, gone.join(" | "));
}
check(quoted >= 40, "names: the guide quotes the page's names, and this suite read them", `${quoted} quoted`);
const unclosed = [G.GUIDE_START, G.GUIDE_IDEA.body, ...G.GUIDE_FIRST_SCREEN.map((p) => p.body), ...Object.values(G.GUIDE_RAIL), [G.GUIDE_RAIL_PHONE],
  G.GUIDE_TABS_INTRO, ...Object.values(G.GUIDE_TABS).flatMap((t) => [t.opens, ...t.sections.map((s) => s.body)]), ...G.GUIDE_EVERYWHERE.map((p) => p.body), [G.GUIDE_METHOD]]
  .flat().filter((p) => p.replace(/\[\[(.+?)\]\]/g, "").includes("[[") || p.replace(/\[\[(.+?)\]\]/g, "").includes("]]"));
check(unclosed.length === 0, "names: every [[ in the guide is closed, so no quoted name escapes the check above", unclosed.join(" | "));

// ---- (d) the glossary ---------------------------------------------------------------------------------------------
const pageMarks = new Set(Object.values(parts).flatMap((p) => [...p.marks]));
const glossary = new Set(markGlossary().map((m) => m.name));
check(pageMarks.size > 0 && minus(pageMarks, glossary).length === 0, "glossary: every info mark the page renders is in the guide's glossary",
  minus(pageMarks, glossary).join(" | "));
check(minus(glossary, pageMarks).length === 0, "glossary: every info mark the glossary lists is one the page renders",
  minus(glossary, pageMarks).join(" | "));
const lower = ALL.toLowerCase();
const unused = G.GUIDE_TERMS.filter((t) => !lower.includes((t.find ?? t.term).toLowerCase()));
check(G.GUIDE_TERMS.length >= 20 && unused.length === 0, "glossary: each of the guide's own terms is a word the page still uses",
  unused.map((t) => t.term).join(" | "));
const terms = G.GUIDE_TERMS.map((t) => t.term);
check(sameList(terms, [...terms].sort((a, b) => a.localeCompare(b, "en"))) && new Set(terms.map((t) => t.toLowerCase())).size === terms.length,
  "glossary: the guide's own terms are in alphabetical order, each once", terms.join(", "));

// ---- (e) no typed figures ------------------------------------------------------------------------------------------
//
// The guide's source read as code: every piece of prose (a string, a template, a run of strings joined with +, JSX
// text, a prose attribute) folded into one string, its [[quoted names]] taken out, must hold no digit. A number may
// only arrive through an expression, from the constant that owns it. Strings that are not prose (an import path, a
// call's argument such as a format id, a class name or an id) are not read.
const { parseAst } = await import("vite");
const { transform } = await import("esbuild");
const PROSE_ATTRS = new Set(["title", "aria-label", "alt", "placeholder"]);
async function typedFigures(file) {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const { code } = await transform(src, { loader: file.endsWith(".tsx") ? "tsx" : "ts", jsx: "preserve", format: "esm" });
  const ast = parseAst(code, { jsx: true });
  const hits = [];
  const stringy = (n) => (n.type === "Literal" && typeof n.value === "string") || n.type === "TemplateLiteral" || (n.type === "BinaryExpression" && n.operator === "+" && (stringy(n.left) || stringy(n.right)));
  const fold = (n) => {
    if (n.type === "Literal" && typeof n.value === "string") return n.value;
    if (n.type === "TemplateLiteral") return n.quasis.map((q) => q.value.cooked).join("\u0000");
    if (n.type === "BinaryExpression" && n.operator === "+") return fold(n.left) + fold(n.right);
    return "\u0000";
  };
  const hit = (s, n) => {
    const bare = s.replace(/\[\[[\s\S]*?\]\]/g, "");
    if (/\d/.test(bare)) hits.push(`${code.slice(n.start, Math.min(n.end, n.start + 90)).replace(/\s+/g, " ")}`);
  };
  const walk = (n, parent, attr) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "ImportDeclaration" || n.type === "ExportAllDeclaration" || (n.type === "ExportNamedDeclaration" && n.source)) return;
    let inAttr = attr;
    if (n.type === "JSXAttribute") inAttr = typeof n.name?.name === "string" ? n.name.name : "?";
    const proseHere = inAttr === null || PROSE_ATTRS.has(inAttr);
    const callArg = parent?.type === "CallExpression" && parent.arguments.includes(n);
    const inChain = parent?.type === "BinaryExpression" && parent.operator === "+" && stringy(parent);
    if (stringy(n) && !inChain && !callArg && proseHere && !(parent?.type === "Property" && parent.key === n) && !(parent?.type === "MemberExpression" && parent.property === n)) hit(fold(n), n);
    if (n.type === "JSXText" && proseHere) hit(n.value, n);
    if (n.type === "Literal" && typeof n.value === "number" && (parent?.type === "TemplateLiteral" || inChain)) hits.push(`a number spliced into prose: ${n.raw}`);
    for (const [k, v] of Object.entries(n)) {
      if (k === "type" || k === "start" || k === "end") continue;
      if (Array.isArray(v)) v.forEach((c) => walk(c, n, inAttr));
      else if (v && typeof v === "object") walk(v, n, inAttr);
    }
  };
  walk(ast, null, null);
  return hits;
}
for (const file of ["../src/content/guide.ts", "../src/guide/GuidePage.tsx", "../src/guide/route.ts"]) {
  const hits = await typedFigures(file);
  check(hits.length === 0, `figures: no figure is typed into the guide's own words (${file.replace("../", "")})`, hits.join(" | "));
}
setMedia(() => false);
const guide = render(h(GuidePage));
const guideText = text(guide.container);
const published = new Set([P.MEGA_CAP_IN_SAMPLE, ...P.PUBLISHED_SETS.flatMap((s) => [s.ew, s.gmv, s.tangency])]);
const own = guideText.slice(0, guideText.indexOf("What the i marks say"));
const threes = [...own.matchAll(/[−-]?\d\.\d{3}\b/g)].map((m) => m[0]);
check(threes.length >= 5 && threes.every((x) => published.has(x)), "figures: every three-decimal figure in the guide's own words is a published one, quoted from published.ts",
  threes.join(" "));
const [mega, , cross] = P.PUBLISHED_SETS;
check([P.MEGA_CAP_IN_SAMPLE, mega.tangency, mega.ew, cross.tangency, cross.ew].every((x) => own.includes(x)),
  "figures: the one idea quotes the in-sample 1.107 against the out-of-sample figures it became, as published");

// ---- the page the guide renders ------------------------------------------------------------------------------------
const C = guide.container;
const h3s = [...C.querySelectorAll("#settings .guide-h3")].map(text);
check(sameList(h3s, RAIL_IDS.map((id) => RAIL_HEADINGS[id])), "page: the settings section is filed under the rail's headings, in order", h3s.join(" | "));
const tabsShown = [...C.querySelectorAll(".guide-tab > .guide-h3")].map(text);
check(sameList(tabsShown, TAB_IDS.map((id) => TAB_LABELS[id])), "page: one section per tab, under the tab's label, in order", tabsShown.join(" | "));
const opens = [...C.querySelectorAll(".guide-open a")].map((a) => a.getAttribute("href"));
check(opens.length === TAB_IDS.length && opens.every((href, i) => decodeShare(href.replace(/^\.\//, "")).tab === TAB_IDS[i]),
  "page: each tab's section links that tab, and the page reads the link as that tab", opens.join(" "));
const contents = [...C.querySelectorAll(".guide-contents a")].map((a) => a.getAttribute("href").slice(1));
check(sameList(contents, GUIDE_SECTIONS.map((s) => s.id)) && contents.every((id) => !!C.querySelector(`section#${id}`)),
  "page: the contents list every section, and each link finds its section", contents.join(" "));
const shownMarks = [...C.querySelectorAll("[data-glossary='marks'] .guide-term")].length;
check(shownMarks === glossary.size, "page: the glossary prints every info mark's words", `${shownMarks} of ${glossary.size}`);
check(text(C.querySelector(".guide-byline") ?? {}) === `${A.AUTHOR} · ${A.CREDENTIAL}`, "page: the byline is the resume's words, from about.tsx");
const foot = C.querySelector("footer.footer");
check(!!foot && !!foot.querySelector("details.footer-method") && !foot.querySelector(`a[href="${GUIDE_HREF}"]`),
  "page: the guide ends on the page's footing, methodology and all, without a link to itself");
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
check(!EMOJI.test(guideText), "page: no emoji");
const pdfLink = C.querySelector(`.guide-actions a[href="${G.GUIDE_PDF}"]`);
check(!!pdfLink && existsSync(new URL(`../public${G.GUIDE_PDF}`, import.meta.url)), "page: the guide links its PDF, and the PDF is in public/", pdfLink?.outerHTML ?? "none");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
check(/<meta property="og:url" content="([^"]+)"/.exec(index)?.[1] === A.APP_URL, "page: APP_URL is the address index.html gives the page", A.APP_URL);
guide.unmount();

// ---- (f) the address ---------------------------------------------------------------------------------------------
check(GUIDE_HREF === "?guide" && isGuide(GUIDE_HREF) && isGuide("?guide=1") && isGuide("?tab=risk&guide") && !isGuide("") && !isGuide("?guided") && !isGuide("?tab=guide"),
  "address: ?guide, with or without a value and beside other keys, is the guide; nothing else is");
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
check(/lazy\(\(\) => import\("\.\/guide\/GuidePage\.tsx"\)\)/.test(main) && !/from "\.\/guide\/GuidePage/.test(main) && /isGuide\(window\.location\.search\)/.test(main),
  "address: main.tsx renders the guide in the page's place when the address asks, fetched only then");

// ---- (g) the PDF -------------------------------------------------------------------------------------------------
const edition = await guideEdition();
check(/^[0-9a-f]{12}$/.test(edition) && edition === (await guideEdition()), "pdf: the guide's edition is a stable hash of its page", edition);
const file = new URL("../public/guide.pdf", import.meta.url);
const problems = existsSync(file) ? pdfProblems(readFileSync(file), edition) : ["public/guide.pdf is missing"];
check(problems.length === 0, "pdf: public/guide.pdf is the current edition of the guide, with nothing local in it (export it again: npm run guide:pdf)",
  problems.join(" | "));

done("t-guide");

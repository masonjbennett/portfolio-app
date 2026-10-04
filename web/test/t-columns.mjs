// The constructions a reader can add to the Optimization tab's scorecard: every cell of an added column is
// the engine's own figure for that construction's weights, the columns sit in one fixed order whatever the
// clicks, a construction the basket cannot have is a disabled button with its reason under the row (on both
// sides of each boundary), the weights table carries the same weights, the frontier is handed them, and no
// new word on the page ranks one construction over another.
import { check, done } from "./_assert.mjs";
import { act, render, text } from "./_dom.mjs";
import { examplePayload, exampleAnalysis, fixtureAnalysis, fixturePayload, ORACLE_RF, settingsFor, tabProps } from "./_analysis.mjs";

const { createElement: h, useState } = await import("react");
const { analyze } = await import("../src/state/analyze.ts");
const C = await import("../src/lib/constructions.ts");
const R = await import("../src/lib/robust.ts");
const { portfolioReturns, windowMoments, windows } = await import("../src/lib/portfolio.ts");
const { scorecardRow, TRADING_DAYS } = await import("../src/lib/stats.ts");
const { DEFAULT_SEED } = await import("../src/lib/rng.ts");
const SC = await import("../src/tabs/optimization/scorecard.ts");
const M = await import("../src/tabs/optimization/model.ts");
const { customWeights } = M;
const { FITTED } = await import("../src/tabs/caption.ts");
const { DASH, format, MINUS } = await import("../src/format.ts");
const { SCORE_TIPS, tipText } = await import("../src/content/tooltips.ts");
const { ADD_COLUMN } = await import("../src/components/AddColumns.tsx");
const Optimization = (await import("../src/tabs/Optimization.tsx")).default;

const READY = { status: "ready", value: null };
const ids = C.ADDED_IDS;
const same = (x, y) => (x === null && y === null) || x === y || (Number.isNaN(x) && Number.isNaN(y));
const join = (xs) => xs.join(",");

// The engine, called directly: a construction's own window, its weights, its lookback weights, its redraws.
function engine(a, id) {
  const own = C.ownWindow(id, a.returns);
  const sol = C.solveAdded(id, own.m, own.S, own.T, a.rf, a.allowShort);
  const looks = id === "tan.1y" || windows(a.dates.length).length < 2
    ? []
    : windows(a.dates.length).map(({ lb }) => {
        const { m, S } = windowMoments(a.returns, lb);
        return C.solveAdded(id, m, S, lb, a.rf, a.allowShort)?.w ?? null;
      });
  const strip = R.addedStrip(id, own.m, own.S, a.rf, a.allowShort, own.T, R.REDRAWS, DEFAULT_SEED);
  return { own, sol, looks, strip };
}

// ---- 1. every cell is the engine's ------------------------------------------------------------------------
const SETS = [
  ["example", (o) => exampleAnalysis(o)],
  ["megacap", (o) => fixtureAnalysis("megacap", o)],
];
for (const [name, make] of SETS) {
  for (const allowShort of [false, true]) {
    const tag = (s) => `${s} (${name}, shorting ${allowShort ? "on" : "off"})`;
    const a = make({ allowShort });
    const c = customWeights(a, {});
    const want = Object.fromEntries(ids.map((id) => [id, engine(a, id)]));
    const draws = Object.fromEntries(ids.map((id) => [id, { status: "ready", value: want[id].strip }]));
    const model = SC.scorecard(a, c, READY, ids, draws);
    const plain = SC.scorecard(a, c, READY);
    check(join(model.columns.map((x) => x.id)) === join(["ew", "gmv", "tangency", "custom", ...ids, "bench"]),
      tag("order: the four added columns sit between Custom and the benchmark, in the fixed order"), join(model.columns.map((x) => x.id)));
    check(join(SC.scoreColIds([...ids].reverse())) === join(["ew", "gmv", "tangency", "custom", ...ids, "bench"]) && join(M.shownAdded(a, ["rp", "tan.cap", "tan.bs", "tan.1y"])) === join(ids),
      tag("order: the column list and the shown list each put the constructions in the fixed order"));
    const reversed = SC.scorecard(a, c, READY, [...ids].reverse(), draws);
    check(join(reversed.columns.map((x) => x.id)) === join(model.columns.map((x) => x.id)), tag("order: added in the opposite order, the columns come out the same"));

    const off = [];
    for (const id of ids) {
      const k = model.columns.findIndex((x) => x.id === id);
      const col = model.columns[k];
      const e = want[id];
      if (!e.sol) {
        if (col.ok || col.weights !== null || col.label !== M.addedMissingLabel(id)) off.push(`${id}: the engine found no weights, the column says ${col.label}`);
        continue;
      }
      if (!(col.ok && col.weights.every((x, i) => x === e.sol.w[i]) && col.label === M.ADDED_LABEL[id])) off.push(`${id}: weights or head`);
      const row = scorecardRow(portfolioReturns(a.returns, e.sol.w), a.bench, a.dates, a.prices.dates[0], a.rf);
      const frag = R.fragility(id, { m: e.own.m, S: e.own.S, rf: a.rf, allowShort: a.allowShort, T: e.own.T, lookbacks: e.looks, redraws: null, strip: e.strip });
      for (const line of model.lines) {
        const cell = line.cells[k];
        const v = line.metric.value({ row, frag });
        if (!same(cell.value, v)) off.push(`${id}/${line.metric.id}: page ${cell.value}, engine ${v}`);
        if (line.metric.se && !same(cell.se, line.metric.se({ row, frag }))) off.push(`${id}/${line.metric.id} SE`);
      }
    }
    check(off.length === 0, tag("cells: every row of every added column equals the engine's figure on that construction's weights and own window"), off.slice(0, 4).join("; "));

    // Adding columns moves nothing in the default ones.
    const moved = plain.columns.filter((col, k) => {
      const j = model.columns.findIndex((x) => x.id === col.id);
      return plain.lines.some((l, r) => !same(l.cells[k].value, model.lines[r].cells[j].value));
    });
    check(moved.length === 0, tag("default columns: adding constructions leaves every default cell as it was"), moved.map((x) => x.id).join());

    // Sub-lines: the full-window ones carry the fitted wording, the last-year one its own, long only said while shorting is on.
    const sub = Object.fromEntries(model.columns.map((x) => [x.id, x.sub]));
    const subOk = want["tan.1y"].sol ? sub["tan.1y"] === M.LAST_YEAR : true;
    check(subOk && (!want["tan.bs"].sol || sub["tan.bs"] === FITTED) &&
      sub["tan.cap"] === (allowShort ? `${FITTED}, long only` : FITTED) && sub.rp === (allowShort ? `${FITTED}, long only` : FITTED),
      tag("heads: each added head carries how its weights were chosen, and long only on the capped and risk-parity heads while shorting is on"), JSON.stringify(sub));

    // The switches act as the engine says: the capped and risk-parity weights are long-only whatever the switch.
    const cap = model.columns.find((x) => x.id === "tan.cap").weights;
    const rp = model.columns.find((x) => x.id === "rp").weights;
    check(cap.every((x) => x >= -1e-12 && x <= C.CAP + 1e-12) && rp.every((x) => x > 0),
      tag("switches: the capped column holds 0% to 25% each and risk parity is long-only, whatever the shorting switch"));

    // The fixed window and the shrinkage, read from the engine, in the caption.
    const shrink = C.bayesStein(want["tan.bs"].own.m, want["tan.bs"].own.S, want["tan.bs"].own.T);
    const k1 = model.columns.findIndex((x) => x.id === "tan.1y");
    const lookback = model.lines.find((l) => l.metric.id === "lookback");
    check(model.conventions.includes(`${format(shrink.phi, "pct1")} of the way`) && model.conventions.includes(format(shrink.mu0 * TRADING_DAYS, "pct2")) &&
      model.conventions.includes("Bayes-Stein") && !plain.conventions.includes("Bayes-Stein"),
      tag("caption: with the shrunk-means column on, it gives the engine's intensity and target, and only then"), `${format(shrink.phi, "pct1")}`);
    check(lookback.cells[k1].value === null && model.conventions.includes(`last ${C.YEAR_ROWS} daily returns, from ${format(a.dates[a.dates.length - C.YEAR_ROWS], "date")}`) &&
      model.lines.find((l) => l.metric.id === "params").cells[k1].value === R.paramCount("tan.1y", a.tickers.length),
      tag("last year: its lookback row is a dash and the caption names its fixed window"));
    const kr = model.columns.findIndex((x) => x.id === "rp");
    check(model.lines.find((l) => l.metric.id === "cut").cells[kr].value === 0 && model.lines.find((l) => l.metric.id === "draws").cells[kr].value === 0,
      tag("risk parity: its cut and redraw rows are zero, as the caption says"));

    // Before their redraws land, the added draw rows are dashes and the note says why.
    const waiting = SC.scorecard(a, c, READY, ids, {});
    const kd = waiting.lines.findIndex((l) => l.metric.id === "draws");
    check(ids.every((id) => waiting.lines[kd].cells[waiting.columns.findIndex((x) => x.id === id)].value === null) && /fills in for/.test(waiting.addedDraws ?? "") && model.addedDraws === null,
      tag("pending: the added draw rows wait for their redraws, and say so"), waiting.addedDraws ?? "");

    // The weights table carries the same weights, one column each, in the same order.
    const wt = M.weightTable(a, [...ids].reverse());
    const wcols = wt.value.columns.map((x) => x.key);
    check(wt.status === "ready" && join(wcols) === join(["asset", "gmv", "tangency", "ew", ...ids]) &&
      ids.every((id) => a.tickers.every((_, i) => wt.value.rows[i][id] === model.columns.find((x) => x.id === id).weights?.[i] || (wt.value.rows[i][id] === null && !want[id].sol))),
      tag("weights table: a column per added construction, in the fixed order, holding the scorecard's weights"), join(wcols));
  }
}

// The rate reaches the three tangency columns as the engine says, and risk parity reads none of it.
{
  const lo = exampleAnalysis({ rf: 0 });
  const hi = exampleAnalysis();
  const w = (a, id) => M.addedFit(a, id).sol?.w ?? null;
  const tangOk = ["tan.1y", "tan.bs", "tan.cap"].every((id) => {
    const e = engine(lo, id).sol;
    return e && w(lo, id).every((x, i) => x === e.w[i]);
  });
  check(tangOk && w(lo, "rp").every((x, i) => x === w(hi, "rp")[i]), "rate: the tangency columns are solved at the analysis's rate; risk parity's weights do not depend on it");
}

// ---- 2. what a basket cannot have --------------------------------------------------------------------------
// A price fixture cut to fewer tickers or fewer days, analysed by the shipping analyze().
function cut(p, { tickers = p.tickers.length, closes = p.rows.length } = {}) {
  const keep = p.tickers.slice(0, tickers);
  const idx = [0, ...keep.map((t) => 1 + p.columns.indexOf(t)), 1 + p.columns.indexOf(p.benchmark)];
  const rows = p.rows.slice(p.rows.length - closes).map((r) => idx.map((i) => r[i]));
  return { ...p, tickers: keep, columns: [...keep, p.benchmark], rows };
}
function analysed(p) {
  const a = analyze(p, settingsFor(p), { rate: ORACLE_RF, source: "manual" });
  if (!a.ok) throw new Error(`analyze refused: ${a.message}`);
  return a;
}
const mega = fixturePayload("megacap");
const four = analysed(cut(mega, { tickers: 4 }));
const five = analysed(cut(mega, { tickers: 5 }));
const year = analysed(cut(mega, { closes: C.YEAR_ROWS + 1 }));
const yearAndADay = analysed(cut(mega, { closes: C.YEAR_ROWS + 2 }));
check(four.tickers.length === 4 && five.tickers.length === 5 && year.dates.length === C.YEAR_ROWS && yearAndADay.dates.length === C.YEAR_ROWS + 1,
  "boundaries: the cut baskets have four and five assets, and windows of one year and one day more", `${four.tickers.length} ${five.tickers.length} ${year.dates.length} ${yearAndADay.dates.length}`);
check(M.shownAdded(four, ids).join() === "tan.1y,tan.bs,rp" && M.shownAdded(five, ids).join() === ids.join(),
  "boundaries: four assets cannot have the 25% cap, five can");
check(M.shownAdded(year, ids).join() === "tan.bs,tan.cap,rp" && M.shownAdded(yearAndADay, ids).join() === ids.join(),
  "boundaries: a window of exactly one year cannot have the last-year column, one a day longer can");
check(SC.scorecard(four, customWeights(four, {}), READY, ids).columns.every((x) => x.id !== "tan.cap"),
  "boundaries: a construction the basket cannot have is ignored for that basket, not shown failed");
const reasons = { "window-is-one-year": year, "year-too-thin": five, "too-few-rows": five, "too-few-assets": four };
const words = Object.entries(reasons).map(([r, a]) => M.unavailableWords(r === "window-is-one-year" ? "tan.1y" : r === "too-few-assets" ? "tan.cap" : r === "too-few-rows" ? "tan.bs" : "tan.1y", r, a));
check(words.every((s) => s.length > 40 && /\.$/.test(s)) && M.unavailableNote(five) === null && M.unavailableNote(four) === words[3] && M.unavailableNote(year) === words[0],
  "reasons: each reason the engine gives has a plain sentence, and the note under the row holds exactly the ones that apply", words.join(" | "));
check(M.unavailableWords("tan.cap", "too-few-assets", analysed(cut(mega, { tickers: 3 }))).includes("no mix keeps every weight") && words[3].includes("equal weight"),
  "reasons: at four assets the cap leaves only equal weight; below that, no mix at all");

// ---- 3. on the page --------------------------------------------------------------------------------------
// A stateful stand-in for the workbench: the tab asks for a settings change and it lands.
let asked = [];
function Harness({ a }) {
  const base = tabProps(a);
  const [settings, setSettings] = useState(base.settings);
  return h(Optimization, { ...base, settings, requestSettings: (p) => { asked.push(p); setSettings((s) => ({ ...s, ...p })); } });
}
const flush = async (n = 8) => {
  for (let i = 0; i < n; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const fiberOf = (el) => el[Object.keys(el).find((k) => k.startsWith("__reactFiber$"))];
function frontierAdded(root) {
  let f = fiberOf(root.querySelector('[aria-labelledby="opt-frontier"]'));
  while (f && !(f.memoizedProps && "added" in f.memoizedProps && "custom" in f.memoizedProps)) f = f.return;
  return f?.memoizedProps.added;
}
{
  const a = exampleAnalysis();
  const r = render(h(Harness, { a }));
  await flush();
  const root = r.container;
  const group = root.querySelector('.addcol [role="group"]');
  const buttons = () => [...root.querySelectorAll(".addcol-btn")];
  const heads = () => [...root.querySelectorAll(".sc thead th[data-col]")].map((x) => x.getAttribute("data-col"));
  const labelId = group?.getAttribute("aria-labelledby");
  check(group && document.getElementById(labelId)?.textContent === ADD_COLUMN && group.closest('[aria-labelledby="opt-scorecard"]') &&
    group.compareDocumentPosition(root.querySelector(".sc table")) & Node.DOCUMENT_POSITION_FOLLOWING,
    "row: a group labelled Add a column sits in the scorecard section, above the table");
  check(join(buttons().map((b) => text(b))) === join(ids.map((id) => M.ADDED_LABEL[id])) && buttons().every((b) => b.getAttribute("aria-pressed") === "false" && !b.disabled && b.getAttribute("role") === null) &&
    root.querySelectorAll('.addcol [role="switch"]').length === 0,
    "row: four toggle buttons with aria-pressed, never a switch, all off and offered on the example", buttons().map((b) => text(b)).join(" | "));
  check(join(heads()) === join(SC.SCORE_COL_IDS) && root.querySelector(".addcol-note") === null && frontierAdded(root)?.length === 0,
    "default: the scorecard opens with its default columns, no reason line, and the frontier is handed no marks");
  // Offering the four buttons reads the basket's size only: nothing is solved for a column nobody added.
  check(M.addedSolvedOn(a).length === 0 && root.querySelectorAll('[data-note="added-missing"]').length === 0,
    "default: no construction is solved until its column is added", join(M.addedSolvedOn(a)));
  const marks0 = frontierAdded(root);

  // Clicked out of order, the columns land in the fixed order, and the link's ask is in that order too.
  await act(async () => buttons()[3].click());
  await act(async () => buttons()[0].click());
  await flush();
  check(join(asked.at(-1).cols) === "tan.1y,rp" && join(heads()) === join(["ew", "gmv", "tangency", "custom", "tan.1y", "rp", "bench"]) &&
    buttons()[0].getAttribute("aria-pressed") === "true" && buttons()[3].getAttribute("aria-pressed") === "true" && buttons()[1].getAttribute("aria-pressed") === "false",
    "click: risk parity then the last-year tangency land in the fixed order, pressed", `${join(asked.at(-1).cols)} | ${join(heads())}`);
  const marks = frontierAdded(root);
  check(marks !== marks0 && join(marks.map((m) => m.id)) === "tan.1y,rp" && marks.every((m) => m.label === M.ADDED_LABEL[m.id] && m.w === M.addedFit(a, m.id).sol.w),
    "frontier: it is handed each shown construction's id, head and weights", JSON.stringify(marks?.map((m) => m.id)));

  // The weights table has the same columns, its heads saying how the weights were chosen.
  const wtable = root.querySelector('[aria-labelledby="opt-weights"] table');
  const whead = [...wtable.querySelectorAll("thead th")].map((x) => text(x));
  const w1y = M.addedFit(a, "tan.1y").sol.w;
  const rowsText = [...wtable.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((x) => text(x)));
  check(whead.some((x) => x.startsWith(M.ADDED_LABEL["tan.1y"]) && x.includes(M.LAST_YEAR)) && whead.some((x) => x.startsWith(M.ADDED_LABEL.rp) && x.includes(FITTED)) &&
    rowsText.every((cells, i) => cells.includes(format(w1y[i], "pct2"))),
    "weights table: the added columns appear with their sub-lines and the page's weights", whead.join(" | "));

  // Their draw rows fill in once their redraws are solved; heads carry their own explanation.
  // The draw row is in the full view.
  await act(async () => root.querySelector(".sc-toggle").click());
  const drawRow = () => {
    const cells = [...root.querySelectorAll('.sc tr[data-metric="draws"] td')].map((x) => text(x));
    return heads().flatMap((id, k) => (C.isAddedId(id) ? [cells[k]] : []));
  };
  check(drawRow().length === 2 && drawRow().every((x) => typeof x === "string" && x !== DASH && x !== "") && root.querySelector('[data-note="added-draws"]') === null,
    "redraws: after paint the added draw rows are filled and the waiting note is gone", drawRow().join(" | "));
  check(root.querySelector('.sc th[data-col="rp"] .tip') !== null && root.querySelector('.sc th[data-col="tan.1y"] .tip') !== null &&
    text(root.querySelector('[data-col-def="col_parity"]')).includes(tipText("col_parity", "plain")),
    "explanations: each added head has an info mark, and its text is in the list that works on touch");

  // All four, then the words on the page that are new.
  await act(async () => buttons()[1].click());
  await act(async () => buttons()[2].click());
  await flush();
  check(join(heads()) === join(["ew", "gmv", "tangency", "custom", ...ids, "bench"]), "click: all four added, still in the fixed order");
  // The page's own model, read off the scorecard's props: its added draw rows are the engine's redraws on the
  // page's seed (the downloads' seed), to the last digit.
  let sf = fiberOf(root.querySelector(".sc"));
  while (sf && !(sf.memoizedProps && "model" in sf.memoizedProps && "redraws" in sf.memoizedProps)) sf = sf.return;
  const pageModel = sf?.memoizedProps.model;
  const seeded = SC.scorecard(a, customWeights(a, {}), READY, ids, Object.fromEntries(ids.map((id) => [id, { status: "ready", value: engine(a, id).strip }])));
  const drawsOf = (m) => m.lines.find((l) => l.metric.id === "draws").cells.filter((_, k) => C.isAddedId(m.columns[k].id)).map((x) => x.value);
  check(pageModel && drawsOf(pageModel).length === 4 && drawsOf(pageModel).every((x, i) => x === drawsOf(seeded)[i]) && new Set(drawsOf(seeded)).size > 2,
    "redraws: the page's added draw rows are the engine's redraws on the page's own seed, the one the downloads use", `${pageModel ? drawsOf(pageModel).join() : "no model"} vs ${drawsOf(seeded).join()}`);
  const caption = text(root.querySelector(".sc caption"));
  const phi = M.addedFit(a, "tan.bs").sol.shrink.phi;
  check(caption.includes(`${format(phi, "pct1")} of the way`), "caption: with the shrunk-means column shown, it states the intensity the engine returned", format(phi, "pct1"));
  const fresh = [
    text(root.querySelector(".addcol")),
    ...[...root.querySelectorAll(".sc thead th[data-col]")].filter((x) => C.isAddedId(x.getAttribute("data-col"))).map((x) => text(x)),
    SC.addedConventions(a, ids),
    SC.scorecard(a, customWeights(a, {}), READY, ids, {}).addedDraws,
    ...Object.entries(reasons).map(([rr, aa]) => M.unavailableWords("tan.cap", rr, aa)),
    ...["col_last_year", "col_shrunk", "col_capped", "col_parity"].flatMap((k) => Object.values(SCORE_TIPS[k])),
    M.addedSub("rp", true),
    M.LAST_YEAR,
    ADD_COLUMN,
  ].join("\n");
  const banned = /\b(race|contender\w*|winner\w*|wins?|beat\w*|outperform\w*|best|optimal\w*|rank\w*)\b/i;
  check(!banned.test(fresh) && fresh.length > 2000, "words: no new string on the page or in a tooltip ranks one construction over another", (fresh.match(banned) ?? [""])[0]);
  check(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(fresh), "words: no emoji");

  // Off again: the default table, the same empty marks object.
  for (const b of buttons()) if (b.getAttribute("aria-pressed") === "true") await act(async () => b.click());
  await flush();
  check(join(heads()) === join(SC.SCORE_COL_IDS) && asked.at(-1).cols.length === 0 && frontierAdded(root) === marks0,
    "off: with every column off the default table is back and the frontier gets the same empty array as before");
  r.unmount();
}

// The page on a basket that cannot have one: a disabled button, the reason under the row, no column.
{
  asked = [];
  const a = four;
  const r = render(h(Harness, { a }));
  await flush();
  const root = r.container;
  const cap = root.querySelector('.addcol-btn[data-col="tan.cap"]');
  const note = root.querySelector(".addcol-note");
  check(cap?.disabled && cap.getAttribute("aria-pressed") === "false" && note && text(note) === M.unavailableNote(a) &&
    root.querySelector('.addcol [role="group"]').getAttribute("aria-describedby") === note.id,
    "four assets: the capped button is disabled, and the line under the row says why", note ? text(note) : "");
  const r5 = render(h(Harness, { a: five }));
  await flush();
  check(!r5.container.querySelector('.addcol-btn[data-col="tan.cap"]').disabled && r5.container.querySelector(".addcol-note") === null,
    "five assets: the capped button is offered and no reason line shows");
  r5.unmount();
  r.unmount();
}

// A link naming a construction this basket cannot have: ignored here, kept in the settings for another basket.
{
  const a = four;
  const props = tabProps(a);
  const r = render(h(Optimization, { ...props, settings: { ...props.settings, cols: ["tan.cap", "rp"] } }));
  await flush();
  const heads = [...r.container.querySelectorAll(".sc thead th[data-col]")].map((x) => x.getAttribute("data-col"));
  check(join(heads) === join(["ew", "gmv", "tangency", "custom", "rp", "bench"]), "link: a construction the basket cannot have is ignored for that basket", join(heads));
  r.unmount();
}

// ---- 4. what the window does to an added column ----------------------------------------------------------
// At a 100% rate nothing earns more than the rate: the capped tangency finds no weights, and with shorting on
// neither do the last-year and shrunk-mean tangencies, while long-only those two hold one asset each. Each
// sentence is held to the engine's own answer on the same analysis.
{
  const long = exampleAnalysis({ rf: 1 });
  const short = exampleAnalysis({ rf: 1, allowShort: true });
  const empty = (a) => ids.filter((id) => !engine(a, id).sol);
  check(join(empty(long)) === "tan.cap" && join(empty(short)) === "tan.1y,tan.bs,tan.cap",
    "no weights: at a rate no mix reaches, the engine finds none for the capped tangency, and with shorting on for the other two tangencies too",
    `${join(empty(long))} | ${join(empty(short))}`);
  for (const [tag, a] of [["long-only", long], ["shorting", short]]) {
    const m = SC.scorecard(a, customWeights(a, {}), READY, ids);
    const gone = empty(a);
    const rate = format(a.rf, "pct2");
    const lineOk = m.addedMissing.length === gone.length && gone.every((id, k) => {
      const s = m.addedMissing[k];
      const col = m.columns.find((x) => x.id === id);
      return s === M.addedMissingWords(a, id) && s.startsWith(`${M.ADDED_LABEL[id]} has no weights: no `) && s.includes(`${rate} risk-free rate`) &&
        col.label === M.addedMissingLabel(id) && !col.label.includes("failed");
    });
    check(lineOk, `no weights (${tag}): each column with none says so in its head, and one line names the bound and the rate that left it empty`, m.addedMissing.join(" | "));
    const cap = m.addedMissing.find((s) => s.startsWith(M.ADDED_LABEL["tan.cap"])) ?? "";
    const tans = m.addedMissing.filter((s) => !s.startsWith(M.ADDED_LABEL["tan.cap"]));
    check(cap.includes("long-only") && cap.includes(`at most ${Math.round(C.CAP * 100)}% of each asset`) && !cap.includes(`${MINUS}100%`) &&
      tans.length === (a.allowShort ? 2 : 0) && tans.every((s) => s.includes(`between ${MINUS}100% and 100%`)),
      `no weights (${tag}): the capped line names the cap and never the shorting bounds; the others name the bounds the switch set`, m.addedMissing.join(" | "));
  }
  // On the page: one line per empty column under the scorecard, its button still offered and pressed so it can be taken off.
  const props = tabProps(short);
  const r = render(h(Optimization, { ...props, settings: { ...props.settings, cols: [...ids] } }));
  await flush();
  const lines = [...r.container.querySelectorAll('[aria-labelledby="opt-scorecard"] [data-note="added-missing"]')].map((x) => text(x));
  const want = SC.scorecard(short, customWeights(short, {}), READY, ids).addedMissing;
  const pressed = [...r.container.querySelectorAll(".addcol-btn")].filter((b) => b.getAttribute("aria-pressed") === "true" && !b.disabled).length;
  check(lines.length === 3 && join(lines) === join(want) && pressed === 4,
    "no weights (page): the scorecard prints each empty column's line, and its button stays offered and pressed", lines.join(" | "));
  r.unmount();

  // Long-only, a tangency that earned no more than the rate holds one asset; the caption names it, read from the engine's weights.
  const conv = SC.addedConventions(long, ids) ?? "";
  const lone = ["tan.1y", "tan.bs"].map((id) => {
    const w = engine(long, id).sol.w;
    const held = w.flatMap((x, i) => (x > 1e-9 ? [long.tickers[i]] : []));
    return { id, beats: engine(long, id).sol.beatsRf, held };
  });
  check(lone.every((x) => x.beats === false && x.held.length === 1 && conv.includes(`holds ${x.held[0]} alone`)) &&
    (conv.match(/least negative/g) ?? []).length === 2 && !/least negative/.test(SC.addedConventions(exampleAnalysis(), ids) ?? ""),
    "one asset: a long-only tangency that earned no more than the rate is said to hold its one asset, and only then",
    lone.map((x) => `${x.id} ${x.beats} ${x.held.join()}`).join("; "));
}

// The capped column's what-if rows follow its largest weight; when that weight sits at the cap the caption says
// they can read zero. On six rotations of one return series every mean and variance is the same, so the capped
// tangency spreads near 1/6 each and the cap does not bind: no sentence.
{
  const a = exampleAnalysis();
  const capW = engine(a, "tan.cap").sol.w;
  const atCap = (s) => (s ?? "").includes(`${M.ADDED_LABEL["tan.cap"]} holds its largest asset at the ${Math.round(C.CAP * 100)}% cap`);
  const base = a.returns[0];
  const T = base.length;
  const spread = { ...a, tickers: ["A", "B", "C", "D", "E", "F"], returns: [0, 1, 2, 3, 4, 5].map((k) => base.map((_, t) => base[(t + k * 97) % T])), rf: 0, allowShort: false };
  const spreadW = M.addedFit(spread, "tan.cap").sol?.w;
  check(Math.max(...capW) >= C.CAP - 1e-9 && atCap(SC.addedConventions(a, ["tan.cap"])) && !atCap(SC.addedConventions(a, ["rp"])) &&
    spreadW && Math.max(...spreadW) < C.CAP - 1e-6 && !atCap(SC.addedConventions(spread, ["tan.cap"])),
    "cap: the caption says the what-if rows follow a weight held at the cap when the engine's largest weight is at the cap, and not otherwise",
    `${Math.max(...capW)} ${spreadW ? Math.max(...spreadW) : "none"}`);
}

// The shrunk-mean column beside Tangency's: when every weight is within a point, the caption says why, with the
// one amount the shrinkage adds to every asset, phi times the target's excess over the rate, from the engine.
{
  const near = exampleAnalysis();
  const far = fixtureAnalysis("megacap");
  const within = (a) => {
    const w = engine(a, "tan.bs").sol.w;
    return a.tangency.w.every((x, i) => Math.abs(x - w[i]) < SC.CLOSE_WEIGHTS);
  };
  const said = (a) => (SC.addedConventions(a, ["tan.bs"]) ?? "").includes("percentage point of Tangency's");
  const sh = engine(near, "tan.bs").sol.shrink;
  const amount = format(sh.phi * (sh.mu0 * TRADING_DAYS - near.rf), "pct2");
  check(within(near) && said(near) && SC.addedConventions(near, ["tan.bs"]).includes(`here ${amount} a year`) && !within(far) && !said(far),
    "shrunk means: the caption says the column sits close to Tangency's, with the amount that moves it, exactly when the engine's weights do", amount);
}

// The scorecard is computed again each time one construction's redraws land: a column whose strip has not
// changed reads its fragility rows back, the same object, instead of solving them again, and they are the
// engine's own.
{
  const a = exampleAnalysis();
  const strip = engine(a, "tan.bs").strip;
  const once = SC.addedFragility(a, "tan.bs", strip);
  const own = M.addedFit(a, "tan.bs").own;
  const direct = R.fragility("tan.bs", { m: own.m, S: own.S, rf: a.rf, allowShort: a.allowShort, T: own.T, lookbacks: M.addedLookbacks(a, "tan.bs"), redraws: null, strip });
  check(once === SC.addedFragility(a, "tan.bs", strip) && JSON.stringify(once) === JSON.stringify(direct) && SC.addedFragility(a, "tan.bs", null) !== once,
    "solved once: an added column's fragility rows are read back while its strip is unchanged, and equal the engine's");
}

done("t-columns");

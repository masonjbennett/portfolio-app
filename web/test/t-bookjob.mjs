// The scorecard's workbook of formulas built off the page's thread: the message between the page and the worker
// (src/bookmsg.ts), the worker's answer (src/bookworker.ts), the page's side with its fallback (src/bookjob.ts),
// and the button that starts it (src/components/Scorecard.tsx).
//
// jsdom has no Worker and node cannot load SheetJS from its CDN, so src/bookjob.ts exposes `seams` and this suite
// fills them: a fake worker (some answer through the worker's own answer(), some fail on purpose), a stand-in
// SheetJS whose "file" is the sheets as JSON, a save that records instead of downloading, and frames that are
// counted. What it holds:
// 1. the request is plain data a worker can receive, and the model it replaces is not;
// 2. the worker's book is the page's book: the same sheets, cell for cell, on every set t-workbook builds, with
//    every added column, and with added columns that found no weights;
// 3. the protocol: what each side accepts and what it refuses, in words;
// 4. every way the worker can fail falls back to the page's own build, after a frame, with the console saying
//    why; and the fallback failing too rejects, so the button shows its failure line;
// 5. the button: busy (aria-busy, disabled, a status line) before the work starts, one build however many
//    clicks, and leaving the tab ends the worker and saves nothing.
import { act, render, text } from "./_dom.mjs";
import { check, done } from "./_assert.mjs";
import { exampleAnalysis, fixtureAnalysis } from "./_analysis.mjs";
import { buildSet, SETS } from "./oracle/excel_recalc.mjs";

const { createElement: h } = await import("react");
const J = await import("../src/bookjob.ts");
const MSG = await import("../src/bookmsg.ts");
const { answer } = await import("../src/bookworker.ts");
const W = await import("../src/workbook.ts");
const SC = await import("../src/tabs/optimization/scorecard.ts");
const { customWeights, addedMissingLabel } = await import("../src/tabs/optimization/model.ts");
const { ADDED_IDS } = await import("../src/lib/constructions.ts");
const { default: Scorecard, BOOK_LINK, BOOK_BUSY } = await import("../src/components/Scorecard.tsx");

// ---- helpers ----------------------------------------------------------------------------------------------

// Equal as data: same keys, same order of array items, numbers equal by Object.is (so -0 is not 0).
function same(x, y) {
  if (typeof x === "number" || typeof y === "number") return Object.is(x, y);
  if (x === null || y === null || typeof x !== "object" || typeof y !== "object") return x === y;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  return kx.length === ky.length && kx.every((k) => Object.hasOwn(y, k) && same(x[k], y[k]));
}

// Every function, and every object that is neither a plain object nor an array, anywhere under x, by path.
function notPlain(x, path = "request", out = []) {
  if (typeof x === "function") out.push(path);
  else if (x && typeof x === "object") {
    const proto = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) out.push(`${path} (${proto?.constructor?.name})`);
    for (const [k, v] of Object.entries(x)) notPlain(v, `${path}.${k}`, out);
  }
  return out;
}

// A stand-in SheetJS: its file is the sheets, in order, as JSON. Two books are the same file exactly when they
// are the same sheets, so it compares what scoreBook built, not how SheetJS zips it.
const STUB = {
  utils: {
    book_new: () => ({ sheets: [] }),
    book_append_sheet: (book, sheet, name) => void book.sheets.push([name, sheet]),
  },
  write: (book) => new TextEncoder().encode(JSON.stringify(book.sheets)).buffer,
};
const stubLoad = async () => STUB;
// Anything that is not an ArrayBuffer reads as a description of itself, so a check fails instead of throwing.
const decode = (bytes) => (bytes instanceof ArrayBuffer ? new TextDecoder().decode(bytes) : `not an ArrayBuffer: ${typeof bytes}`);

// A fake worker. `auto` answers each request through the worker's own answer(), from a clone, a task later, as a
// real worker would; otherwise the suite answers by hand.
class FakeWorker {
  constructor({ auto = false, onPost = null, throwOnPost = null } = {}) {
    Object.assign(this, { auto, onPost, throwOnPost, posted: [], terminated: false, onmessage: null, onerror: null, onmessageerror: null });
  }
  postMessage(msg) {
    if (this.throwOnPost) throw this.throwOnPost;
    const data = structuredClone(msg); // throws as a real postMessage would on anything a clone cannot carry
    this.posted.push(data);
    this.onPost?.(data);
    if (this.auto) setTimeout(() => void answer(data, stubLoad).then(({ reply }) => this.reply(reply)), 0);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data) {
    if (!this.terminated) this.onmessage?.({ data });
  }
  fail(message) {
    if (!this.terminated) this.onerror?.({ message, preventDefault() {} });
  }
  garble() {
    if (!this.terminated) this.onmessageerror?.({});
  }
}

// Fills the seams for one case and hands back what it saw. `worker` is a FakeWorker, or a function that throws.
const DEFAULT_SEAMS = { ...J.seams };
function seams({ worker, sheetjs = stubLoad, frame } = {}) {
  const seen = { made: 0, saves: [], frames: 0, loads: 0, order: [], warns: [], errors: [] };
  J.seams.worker = () => {
    seen.made += 1;
    seen.order.push("worker");
    if (typeof worker === "function") return worker();
    return worker;
  };
  J.seams.sheetjs = () => {
    seen.loads += 1;
    seen.order.push("sheetjs");
    return sheetjs();
  };
  J.seams.frame = () => {
    seen.frames += 1;
    seen.order.push("frame");
    return frame ? frame() : Promise.resolve();
  };
  J.seams.save = (name, bytes) => {
    seen.order.push("save");
    seen.saves.push({ name, bytes });
  };
  console.warn = (...a) => seen.warns.push(a.map(String).join(" "));
  console.error = (...a) => seen.errors.push(a.map(String).join(" "));
  return seen;
}
const { warn, error } = console;
const restore = () => {
  Object.assign(J.seams, DEFAULT_SEAMS);
  Object.assign(console, { warn, error });
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
// A run that never settles fails its check by name instead of hanging the suite.
const within = (p, ms = 3000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("still waiting"), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });

// ---- 1, 2: plain data, and the same book ------------------------------------------------------------------

const cases = [];
for (const set of SETS) {
  for (const added of [[], ADDED_IDS]) {
    const { a, c, model, sheets } = buildSet(set, added);
    cases.push({ tag: `${set.id}${added.length ? " +4" : ""}`, source: { analysis: a, amount: set.amount, refused: c.ok ? null : c.reason }, model, sheets });
  }
}
{
  // Added columns that found no weights: the capped tangency at a rate no mix reaches, and risk parity emptied by
  // hand. Their sub-lines and the Notes are worked out again in the worker, from the analysis alone.
  for (const allowShort of [false, true]) {
    const a = exampleAnalysis({ rf: 1, allowShort });
    const hi = SC.scorecard(a, customWeights(a, {}), { status: "ready", value: null }, ADDED_IDS);
    const model = { ...hi, columns: hi.columns.map((col) => (col.id === "rp" ? { ...col, label: addedMissingLabel("rp"), ok: false, weights: null } : col)) };
    const source = { analysis: a, amount: 10_000, refused: null };
    cases.push({ tag: `rate 100%${allowShort ? " short" : ""}, empty added`, source, model, sheets: W.scoreBook({ ...source, model }) });
  }
  const m = fixtureAnalysis("megacap");
  const model = SC.scorecard(m, customWeights(m, {}), { status: "ready", value: null }, ["tan.1y", "rp"]);
  const source = { analysis: m, amount: 2_500, refused: null };
  cases.push({ tag: "megacap, two added", source, model, sheets: W.scoreBook({ ...source, model }) });
}

let emptyAdded = 0;
for (const { tag, source, model, sheets } of cases) {
  const req = MSG.plainRequest(source, model);
  let modelClones = true;
  try {
    structuredClone(model);
  } catch {
    modelClones = false;
  }
  check(!modelClones, `plain: the scorecard model itself cannot be posted to a worker, so it is stripped (${tag})`);
  const odd = notPlain(req);
  check(odd.length === 0, `plain: the request holds only plain objects, arrays, numbers, strings, booleans and nulls (${tag})`, odd.slice(0, 3).join(", "));
  let cloned = null;
  try {
    cloned = structuredClone(req);
  } catch (err) {
    check(false, `plain: the request survives a structured clone unchanged (${tag})`, err.message);
    continue;
  }
  check(same(cloned, req), `plain: the request survives a structured clone unchanged (${tag})`);
  const back = MSG.readRequest(cloned);
  check(back.model.lines.length === model.lines.length && back.model.lines.every((l, i) => l.metric === model.lines[i].metric),
    `plain: the worker puts each row's own metric back, in the page's order (${tag})`);
  const worker = W.scoreBook(back);
  check(same(worker, sheets), `same book: the worker's sheets are the page's, cell for cell (${tag})`,
    worker.map((s) => s.name).join() + " vs " + sheets.map((s) => s.name).join());
  const { reply, transfer } = await answer(cloned, stubLoad);
  const expected = decode(STUB.write({ sheets: sheets.map((s) => [s.name, s.sheet]) }));
  check(reply.kind === "book" && reply.name === W.BOOK_FILENAME && decode(reply.bytes) === expected,
    `same book: the worker's file is the page's file, named ${W.BOOK_FILENAME} (${tag})`, reply.kind === "failed" ? reply.message : "");
  check(transfer.length === 1 && transfer[0] === reply.bytes && reply.bytes instanceof ArrayBuffer,
    `protocol: the worker transfers the file's ArrayBuffer rather than copying it (${tag})`);
  if (model.columns.some((c) => c.id !== "bench" && !c.ok)) emptyAdded += 1;
}
check(cases.length === 9 && emptyAdded >= 3, "same book: the cases include sets with an empty column (a refused mix, an added column with no weights)", `${cases.length} cases, ${emptyAdded} with an empty column`);

// ---- 3: the protocol --------------------------------------------------------------------------------------

{
  const { source, model } = cases[0];
  const good = MSG.plainRequest(source, model);
  const bad = [
    ["not an object", null, /not a request/],
    ["another kind", { ...good, kind: "save" }, /not a request/],
    ["no analysis", { ...good, analysis: undefined }, /no analysis/],
    ["an analysis that failed", { ...good, analysis: { ...good.analysis, ok: false } }, /no analysis/],
    ["no amount", { ...good, amount: Number.NaN }, /no amount/],
    ["a refusal the page never gives", { ...good, refused: "nope" }, /refusal/],
    ["no scorecard", { ...good, model: null }, /no scorecard/],
    ["a column with text for weights", { ...good, model: { ...good.model, columns: [{ ...good.model.columns[0], weights: "0.5" }, ...good.model.columns.slice(1)] } }, /column/],
    ["a row with a figure missing", { ...good, model: { ...good.model, lines: [{ ...good.model.lines[0], cells: good.model.lines[0].cells.slice(1) }, ...good.model.lines.slice(1)] } }, /one figure per column/],
    ["a row the page does not have", { ...good, model: { ...good.model, lines: [{ ...good.model.lines[0], id: "nonsense" }, ...good.model.lines.slice(1)] } }, /row this page does not have: nonsense/],
  ];
  for (const [what, data, why] of bad) {
    let threw = "";
    try {
      MSG.readRequest(data);
    } catch (err) {
      threw = err.message;
    }
    const { reply, transfer } = await answer(data, stubLoad);
    check(why.test(threw) && reply.kind === "failed" && why.test(reply.message) && transfer.length === 0,
      `protocol: the worker refuses ${what}, and answers with a failure saying so`, `${threw} | ${reply.kind} ${reply.message ?? ""}`);
  }
  const unloaded = await answer(good, async () => {
    throw new Error("SheetJS did not load");
  });
  check(unloaded.reply.kind === "failed" && unloaded.reply.message === "SheetJS did not load", "protocol: a SheetJS that will not load inside the worker is answered as a failure, in its words");

  const bytes = new TextEncoder().encode("x").buffer;
  const ok = MSG.readReply({ kind: "book", name: "scorecard_model", bytes });
  check(ok.ok && ok.name === "scorecard_model" && ok.bytes === bytes, "protocol: the page reads a book reply as its name and bytes");
  const refused = [
    ["nothing", null, /not a message/],
    ["text", "scorecard_model", /not a message/],
    ["another kind", { kind: "progress" }, /not a message/],
    ["no name", { kind: "book", bytes }, /names no file/],
    ["a name that is a path", { kind: "book", name: "../scorecard_model", bytes }, /names no file/],
    ["bytes as a typed array", { kind: "book", name: "scorecard_model", bytes: new Uint8Array(3) }, /carries no file/],
    ["no bytes at all", { kind: "book", name: "scorecard_model", bytes: new ArrayBuffer(0) }, /carries no file/],
    ["the worker's failure", { kind: "failed", message: "SheetJS did not load" }, /could not build it: SheetJS did not load/],
    ["a failure with no reason", { kind: "failed" }, /gave no reason/],
  ];
  for (const [what, data, why] of refused) {
    const r = MSG.readReply(data);
    check(!r.ok && why.test(r.why), `protocol: the page refuses a reply with ${what}, saying why`, r.ok ? "accepted" : r.why);
  }
}

// ---- 4: startBook, its paths and its failures --------------------------------------------------------------

const { source, model, sheets } = cases[0];
const pageFile = decode(STUB.write({ sheets: sheets.map((s) => [s.name, s.sheet]) }));
const savedPage = (seen) => seen.saves.length === 1 && seen.saves[0].name === W.BOOK_FILENAME && decode(seen.saves[0].bytes) === pageFile;

{
  const fake = new FakeWorker({ auto: true });
  const seen = seams({ worker: fake });
  const out = await within(J.startBook(source, model).done);
  restore();
  check(out === "saved" && savedPage(seen) && seen.made === 1 && fake.posted.length === 1, "worker: the worker's file is saved once, under the book's name", `${out}, ${seen.saves.length} saves`);
  check(fake.terminated && fake.onmessage === null, "worker: the worker is ended as soon as it answers");
  check(seen.frames === 0 && seen.loads === 0 && seen.warns.length === 0, "worker: the page neither waits a frame nor loads SheetJS itself when the worker answers", seen.order.join(">"));
}

// Each way the worker can fail, and what the console must say.
const failures = [
  ["cannot be created", () => () => {
    throw new Error("Worker is not defined");
  }, /could not be started \(Worker is not defined\)/],
  ["errors (its script or SheetJS did not load)", () => new FakeWorker({ onPost() {
    setTimeout(() => this.fail?.("Failed to fetch"), 0);
  } }), /the worker failed \(Failed to fetch\)/],
  ["errors with no message", () => new FakeWorker({ onPost() {
    setTimeout(() => this.fail?.(""), 0);
  } }), /the worker failed \(its script did not load\)/],
  ["sends a reply that cannot be deserialised", () => new FakeWorker(), /reply could not be read/, (f) => f.garble()],
  ["sends a message the page cannot read", () => new FakeWorker(), /carries no file/, (f) => f.reply({ kind: "book", name: "scorecard_model", bytes: "not bytes" })],
  ["reports that it could not build the book", () => new FakeWorker(), /could not build it: a cell without a value/, (f) => f.reply({ kind: "failed", message: "a cell without a value" })],
  ["cannot be handed the request", () => new FakeWorker({ throwOnPost: new Error("could not be cloned") }), /could not be handed to the worker \(could not be cloned\)/],
];
for (const [what, make, why, act2] of failures) {
  // onPost is called as the fake's own method, so `this` inside it is the fake and it can fail itself.
  const fake = make();
  const seen = seams({ worker: fake });
  const run = J.startBook(source, model);
  await tick();
  if (act2) act2(fake);
  const out = await within(run.done).catch((err) => `rejected: ${err.message}`);
  restore();
  check(out === "saved" && savedPage(seen), `fallback: a worker that ${what} falls back to the page's own build, which is saved`, `${out}, ${seen.saves.length} saves, ${seen.order.join(">")}`);
  check(seen.warns.length === 1 && why.test(seen.warns[0]) && /built on the page instead/.test(seen.warns[0]), `fallback: the console says why (${what})`, seen.warns.join(" | "));
  const f = seen.order.indexOf("frame");
  check(f >= 0 && f < seen.order.indexOf("sheetjs") && seen.frames === 1, `fallback: the page waits a frame, so the busy state paints, before building (${what})`, seen.order.join(">"));
  if (fake instanceof FakeWorker && !fake.throwOnPost) check(fake.terminated, `fallback: the failed worker is ended (${what})`);
}

{
  const seen = seams({ worker: () => {
    throw new Error("no Worker here");
  }, sheetjs: async () => {
    throw new Error("SheetJS did not load");
  } });
  let rejected = "";
  try {
    rejected = `settled as ${await within(J.startBook(source, model).done)}`;
  } catch (err) {
    rejected = err.message;
  }
  restore();
  check(rejected === "SheetJS did not load" && seen.saves.length === 0, "fallback: when the page's own build fails too, the run rejects with its reason and nothing is saved", rejected);
}

{
  // Cancelled while the worker builds: it is ended at once, a late answer is never read, nothing is saved.
  const fake = new FakeWorker();
  const seen = seams({ worker: fake });
  const run = J.startBook(source, model);
  await tick();
  const handler = fake.onmessage;
  run.cancel();
  check(fake.terminated && fake.onmessage === null, "cancel: cancelling ends the worker at once, before any reply");
  const out = await within(run.done);
  // A reply already on its way when the build was cancelled reaches the old handler, and changes nothing.
  const answered = await answer(fake.posted[0], stubLoad);
  handler?.({ data: answered.reply });
  await tick();
  restore();
  check(out === "cancelled" && fake.terminated && fake.onmessage === null && seen.saves.length === 0 && seen.warns.length === 0,
    "cancel: a build cancelled in the worker ends the worker, resolves as cancelled and never saves", `${out}, terminated ${fake.terminated}, ${seen.saves.length} saves`);
}

{
  // Cancelled while the fallback waits for its frame: the page's build never starts.
  let release;
  const seen = seams({ worker: () => {
    throw new Error("no Worker here");
  }, frame: () => new Promise((r) => (release = r)) });
  const run = J.startBook(source, model);
  await tick();
  run.cancel();
  release?.();
  const out = await within(run.done);
  restore();
  check(out === "cancelled" && seen.loads === 0 && seen.saves.length === 0, "cancel: a build cancelled before the page's own build starts never builds or saves", `${out}, ${seen.order.join(">")}`);
}

// ---- 5: the button ------------------------------------------------------------------------------------------

const a0 = cases[0].source.analysis;
const shown = SC.scorecard(a0, customWeights(a0, {}), { status: "ready", value: null });
const card = () =>
  h(Scorecard, { model: shown, redraws: { status: "ready", value: null }, level: "plain", allowShort: false, filename: "scorecard", book: { analysis: a0, amount: 10_000, refused: null } });
const button = (root) => [...root.container.querySelectorAll(".tbl-dl button")].find((b) => text(b) === BOOK_LINK);
const busyLine = (root) => [...root.container.querySelectorAll(".sc-busy")].find((s) => text(s) === BOOK_BUSY);
const settle = () => act(async () => void (await tick(5)));

{
  // Busy before the work starts, one build however many clicks, then saved and idle again.
  const state = [];
  const fake = new FakeWorker({ onPost: () => state.push({ busy: button(root)?.getAttribute("aria-busy"), disabled: button(root)?.disabled, line: !!busyLine(root) }) });
  const seen = seams({ worker: fake });
  const root = render(card());
  check(button(root)?.getAttribute("aria-busy") === "false" && !busyLine(root), "button: idle, it is not busy and shows no busy line");
  await act(async () => {
    button(root).click();
    button(root).click();
  });
  await settle();
  const b = button(root);
  const line = busyLine(root);
  check(b.getAttribute("aria-busy") === "true" && b.disabled && line && line.getAttribute("role") === "status",
    `button: while the book is built the button is aria-busy and disabled, and a status line reads "${BOOK_BUSY}"`, `${b.getAttribute("aria-busy")} ${b.disabled} ${line ? text(line) : "no line"}`);
  check(state.length === 1 && state[0].busy === "true" && state[0].disabled && state[0].line, "button: the busy state is on the page before the request reaches the worker", JSON.stringify(state));
  check(seen.made === 1 && fake.posted.length === 1, "button: two clicks in a row start one build", `${seen.made} workers`);
  await act(async () => {
    b.click();
  });
  check(seen.made === 1, "button: a click while the book is built does nothing");
  const { reply } = await answer(fake.posted[0], stubLoad);
  await act(async () => {
    fake.reply(reply);
    await tick(5);
  });
  restore();
  check(seen.saves.length === 1 && decode(seen.saves[0].bytes) === decode(STUB.write({ sheets: W.scoreBook({ analysis: a0, amount: 10_000, refused: null, model: shown }).map((s) => [s.name, s.sheet]) })),
    "button: the worker's book is saved once", `${seen.saves.length} saves`);
  check(button(root).getAttribute("aria-busy") === "false" && !button(root).disabled && !busyLine(root) && fake.terminated, "button: once saved, the button is idle again and the worker is ended");
  root.unmount();
}

{
  // Leaving the tab mid-build: the worker is ended, and its answer, had it come, is never saved.
  const fake = new FakeWorker();
  const seen = seams({ worker: fake });
  const root = render(card());
  await act(async () => {
    button(root).click();
  });
  await settle();
  check(fake.posted.length === 1 && !fake.terminated, "unmount: the build is under way before the tab is left");
  const handler = fake.onmessage;
  root.unmount();
  check(fake.terminated, "unmount: leaving the tab mid-build ends the worker at once");
  // A reply already on its way when the tab was left reaches the old handler, and saves nothing.
  const { reply } = await answer(fake.posted[0], stubLoad);
  handler?.({ data: reply });
  await tick(5);
  restore();
  check(typeof handler === "function" && seen.saves.length === 0 && seen.errors.length === 0, "unmount: nothing is saved after the tab is left, even from a reply already sent", `${seen.saves.length} saves`);
  check(fake.onmessage === null && fake.onerror === null && fake.onmessageerror === null, "unmount: the ended worker keeps no handler that could still act");
}

{
  // The fallback in the button: busy is on the page, and a frame has passed, before the page's own build starts.
  const state = [];
  const seen = seams({ worker: () => {
    throw new Error("no Worker here");
  }, sheetjs: async () => {
    state.push({ busy: button(root)?.getAttribute("aria-busy"), line: !!busyLine(root) });
    return STUB;
  } });
  const root = render(card());
  await act(async () => {
    button(root).click();
  });
  await settle();
  restore();
  check(seen.saves.length === 1 && state.length === 1 && state[0].busy === "true" && state[0].line && seen.order.indexOf("frame") >= 0 && seen.order.indexOf("frame") < seen.order.indexOf("sheetjs"),
    "button: on the fallback the busy state is on the page, and a frame has passed, before the page's own build starts", `${JSON.stringify(state)} ${seen.order.join(">")}`);
  root.unmount();
}

{
  // Leaving the tab while the fallback waits for its frame: the page's build never runs.
  let release;
  const seen = seams({ worker: () => {
    throw new Error("no Worker here");
  }, frame: () => new Promise((r) => (release = r)) });
  const root = render(card());
  await act(async () => {
    button(root).click();
  });
  await settle();
  root.unmount();
  release?.();
  await tick(5);
  restore();
  check(seen.frames === 1 && seen.loads === 0 && seen.saves.length === 0, "unmount: leaving the tab before the page's own build starts means it never starts", seen.order.join(">"));
}

{
  // Both paths fail: the button's own failure line, and the console names it.
  const seen = seams({ worker: () => {
    throw new Error("no Worker here");
  }, sheetjs: async () => {
    throw new Error("SheetJS did not load");
  } });
  const root = render(card());
  await act(async () => {
    button(root).click();
  });
  await settle();
  restore();
  const note = [...root.container.querySelectorAll(".tbl-note")].map(text).join(" ");
  check(note === "The workbook with formulas could not be built. Download Excel holds the same figures as values." && !busyLine(root) && button(root).getAttribute("aria-busy") === "false",
    "failure: when no path can build the book, the button keeps its failure line and is idle again", note);
  check(seen.errors.some((e) => /could not be built/.test(e) && /SheetJS did not load/.test(e)) && seen.warns.some((w) => /no Worker here/.test(w)),
    "failure: the console names both the worker's failure and the page's", [...seen.warns, ...seen.errors].join(" | "));
  root.unmount();
}

done("bookjob");

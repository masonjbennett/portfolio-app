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
// 3. the protocol: what each side accepts and what it refuses, in words, and the worker's own wiring (install(),
//    driven with a scope that records what it posts): the book's bytes go in the transfer list;
// 4. every way the worker can fail falls back to the page's own build, after a frame, with the console saying
//    why; and the fallback failing too rejects, so the button shows its failure line. The worker is kept after
//    a book and reused, and ended on a failure, a cancel or its deadline; the page's own load has a deadline too;
// 5. the button: busy (aria-busy, disabled, a status line in a live region that is on the page before the
//    click) before the work starts, one build however many clicks, and leaving the tab ends a build under way
//    and saves nothing.
import { act, render, text } from "./_dom.mjs";
import { check, done } from "./_assert.mjs";
import { exampleAnalysis, fixtureAnalysis } from "./_analysis.mjs";
import { buildSet, SETS } from "./oracle/excel_recalc.mjs";

const { createElement: h } = await import("react");
const J = await import("../src/bookjob.ts");
const MSG = await import("../src/bookmsg.ts");
const { answer, install } = await import("../src/bookworker.ts");
const W = await import("../src/workbook.ts");
const SC = await import("../src/tabs/optimization/scorecard.ts");
const { customWeights, addedMissingLabel } = await import("../src/tabs/optimization/model.ts");
const { ADDED_IDS } = await import("../src/lib/constructions.ts");
const { default: Scorecard, BOOK_LINK, BOOK_BUSY, BOOK_FAILED } = await import("../src/components/Scorecard.tsx");

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
// A worker kept by the case before is ended first, so each case starts as a page that has built no book.
const DEFAULT_SEAMS = { ...J.seams };
function seams({ worker, sheetjs = stubLoad, frame } = {}) {
  J.endKeptWorker();
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
  // Every field COPIED lists reaches the request: the model's, each column's, and each cell's, se wherever the
  // page's cell has one (the Sharpe row's always do).
  const keysOf = (o) => Object.keys(o).sort().join();
  const want = (k) => Object.keys(MSG.COPIED[k]).sort().join();
  const cellsOk = req.model.lines.every((l, i) => l.cells.every((cell, j) => keysOf(cell) === (model.lines[i].cells[j].se === undefined ? "value" : want("cell"))));
  const withSe = model.lines.some((l) => l.cells.some((cell) => cell.se !== undefined));
  check(keysOf(req.model) === want("model") && req.model.columns.every((col) => keysOf(col) === want("column")) && cellsOk && withSe,
    `plain: the request carries every field of the model, its columns and its cells, optional ones included (${tag})`,
    `${keysOf(req.model)} | ${req.model.columns.map(keysOf)[0]} | cells ${cellsOk}, se ${withSe}`);
  const { reply, transfer } = await answer(cloned, stubLoad);
  const expected = decode(STUB.write({ sheets: sheets.map((s) => [s.name, s.sheet]) }));
  check(reply.kind === "book" && reply.name === W.BOOK_FILENAME && decode(reply.bytes) === expected,
    `same book: the worker's file is the page's file, named ${W.BOOK_FILENAME} (${tag})`, reply.kind === "failed" ? reply.message : "");
  check(transfer.length === 1 && transfer[0] === reply.bytes && reply.bytes instanceof ArrayBuffer,
    `protocol: answer() lists the file's ArrayBuffer to be transferred with the reply (${tag})`);
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

// The worker's own wiring, through install() with a scope that records each postMessage and its transfer list (a
// real worker runs the same function on its own global scope).
{
  const { source, model } = cases[0];
  const scope = ({ failFirst = false } = {}) => {
    const s = {
      onmessage: null,
      onmessageerror: null,
      posts: [],
      postMessage(message, transfer) {
        if (failFirst && !s.failed) {
          s.failed = true;
          throw new Error("DataCloneError");
        }
        s.posts.push({ message, transfer });
      },
    };
    return s;
  };
  const request = () => structuredClone(MSG.plainRequest(source, model));
  const s1 = scope();
  install(s1, stubLoad);
  s1.onmessage({ data: request() });
  await tick(5);
  const p = s1.posts[0];
  check(s1.posts.length === 1 && p.message.kind === "book" && Array.isArray(p.transfer) && p.transfer.length === 1 && p.transfer[0] === p.message.bytes && p.message.bytes instanceof ArrayBuffer,
    "worker: the book is posted back with its ArrayBuffer in the transfer list, so the bytes move rather than copy",
    p ? `${p.message.kind}, transfer ${p.transfer?.length}` : "nothing posted");
  const s2 = scope({ failFirst: true });
  install(s2, stubLoad);
  s2.onmessage({ data: request() });
  await tick(5);
  const q = s2.posts[0];
  check(s2.posts.length === 1 && q.message.kind === "failed" && /could not be posted back \(DataCloneError\)/.test(q.message.message) && q.transfer.length === 0,
    "worker: a book that cannot be posted back is replaced by a failure in words, so the page is never left waiting",
    q ? `${q.message.kind} ${q.message.message ?? ""}` : "nothing posted");
  const s3 = scope();
  install(s3, stubLoad);
  s3.onmessageerror();
  check(s3.posts.length === 1 && s3.posts[0].message.kind === "failed" && s3.posts[0].message.message === "the request could not be read" && s3.posts[0].transfer.length === 0,
    "worker: a request that cannot be read is answered as a failure", JSON.stringify(s3.posts.map((x) => x.message)));
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
  check(!fake.terminated && fake.onmessage === null && fake.onerror === null && fake.onmessageerror === null,
    "worker: once it has answered with a book, the worker is kept for the next click, with no handler left on it");
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

{
  // Cancelled while the page's own load hangs: the run ends as cancelled at the load's deadline, not as a failure.
  const seen = seams({ worker: () => {
    throw new Error("no Worker here");
  }, sheetjs: () => new Promise(() => {}) });
  J.seams.sheetjsMs = 40;
  const run = J.startBook(source, model);
  await tick(5);
  run.cancel();
  const out = await within(run.done).catch((err) => `rejected: ${err.message}`);
  restore();
  check(out === "cancelled" && seen.saves.length === 0, "cancel: a build cancelled while the page's own load hangs ends as cancelled, never as a failure", out);
}

// ---- 4b: the worker kept between clicks, and the deadlines ------------------------------------------------

{
  // The second build goes to the worker the first one kept, which already holds SheetJS; no worker is started.
  const fake = new FakeWorker({ auto: true });
  const seen = seams({ worker: fake });
  const one = await within(J.startBook(source, model).done);
  const two = await within(J.startBook(source, model).done);
  restore();
  check(one === "saved" && two === "saved" && seen.saves.length === 2 && seen.made === 1 && fake.posted.length === 2 && !fake.terminated,
    "kept: the next build goes to the kept worker, and no second worker is started", `${one}, ${two}, ${seen.made} workers, ${fake.posted.length} requests`);
}

{
  // A worker that answered with a failure is ended, never kept: the next build starts another.
  const bad = new FakeWorker({ onPost() {
    setTimeout(() => this.reply({ kind: "failed", message: "a cell without a value" }), 0);
  } });
  const good = new FakeWorker({ auto: true });
  const queue = [bad, good];
  const seen = seams({ worker: () => queue.shift() });
  const one = await within(J.startBook(source, model).done);
  const two = await within(J.startBook(source, model).done);
  restore();
  check(one === "saved" && two === "saved" && bad.terminated && bad.posted.length === 1 && seen.made === 2 && good.posted.length === 1,
    "kept: a worker that failed is ended, never kept, and the next build starts a new one", `${one}, ${two}, ${seen.made} workers`);
}

{
  // A build cancelled on the kept worker ends it; the next build starts a new one.
  const first = new FakeWorker({ auto: true });
  const second = new FakeWorker({ auto: true });
  const queue = [first, second];
  const seen = seams({ worker: () => queue.shift() });
  await within(J.startBook(source, model).done);
  first.auto = false;
  const run = J.startBook(source, model);
  await tick();
  run.cancel();
  const out = await within(run.done);
  const three = await within(J.startBook(source, model).done);
  restore();
  check(out === "cancelled" && first.terminated && first.posted.length === 2 && seen.made === 2 && second.posted.length === 1 && three === "saved",
    "kept: cancelling a build on the kept worker ends it, and the next build starts a new one", `${out}, ${three}, ${seen.made} workers`);
}

{
  // Two builds at once use two workers; once both have answered only one is kept, and the third build uses it.
  const w1 = new FakeWorker({ auto: true });
  const w2 = new FakeWorker({ auto: true });
  const queue = [w1, w2];
  const seen = seams({ worker: () => queue.shift() });
  const both = await within(Promise.all([J.startBook(source, model).done, J.startBook(source, model).done]));
  const ended = [w1, w2].filter((w) => w.terminated).length;
  const three = await within(J.startBook(source, model).done);
  restore();
  check(String(both) === "saved,saved" && ended === 1 && three === "saved" && seen.made === 2 && w1.posted.length + w2.posted.length === 3,
    "kept: two builds at once use two workers, and only one is kept afterwards", `${both}, ${ended} ended, ${seen.made} workers`);
}

{
  // A worker that never answers: at its deadline it is ended and the page builds the book, saying why.
  const fake = new FakeWorker();
  const seen = seams({ worker: fake });
  J.seams.workerMs = 40;
  const run = J.startBook(source, model);
  await tick(10);
  const early = { saves: seen.saves.length, ended: fake.terminated };
  const out = await within(run.done).catch((err) => `rejected: ${err.message}`);
  restore();
  check(early.saves === 0 && !early.ended && out === "saved" && savedPage(seen) && fake.terminated && fake.onmessage === null,
    "deadline: a worker that has not answered by its deadline is ended, and the page's own build is saved", `${out}, early ${JSON.stringify(early)}, ${seen.order.join(">")}`);
  check(seen.warns.length === 1 && /the worker did not answer within 0\.04 s/.test(seen.warns[0]) && /built on the page instead/.test(seen.warns[0]),
    "deadline: the console says the worker did not answer in time", seen.warns.join(" | "));
}

{
  // The page's own load never finishes: the run rejects at its deadline, saying so, and nothing is saved.
  const seen = seams({ worker: () => {
    throw new Error("no Worker here");
  }, sheetjs: () => new Promise(() => {}) });
  J.seams.sheetjsMs = 40;
  const out = await within(J.startBook(source, model).done).then((v) => `settled as ${v}`, (err) => err.message);
  restore();
  check(out === "SheetJS or the book's code did not load within 0.04 s" && seen.saves.length === 0,
    "deadline: a page load of SheetJS that never finishes rejects at its deadline, saying so, and saves nothing", out);
}

// ---- 5: the button ------------------------------------------------------------------------------------------

const a0 = cases[0].source.analysis;
const shown = SC.scorecard(a0, customWeights(a0, {}), { status: "ready", value: null });
const card = () =>
  h(Scorecard, { model: shown, redraws: { status: "ready", value: null }, level: "plain", allowShort: false, filename: "scorecard", book: { analysis: a0, amount: 10_000, refused: null } });
const button = (root) => [...root.container.querySelectorAll(".tbl-dl button")].find((b) => text(b) === BOOK_LINK);
const busyLine = (root) => [...root.container.querySelectorAll(".sc-busy")].find((s) => text(s) === BOOK_BUSY);
const region = (root) => root.container.querySelector('[data-note="book"]');
const settle = () => act(async () => void (await tick(5)));

{
  // Busy before the work starts, one build however many clicks, then saved and idle again.
  const state = [];
  const fake = new FakeWorker({ onPost: () => state.push({ busy: button(root)?.getAttribute("aria-busy"), disabled: button(root)?.disabled, line: !!busyLine(root) }) });
  const seen = seams({ worker: fake });
  const root = render(card());
  check(button(root)?.getAttribute("aria-busy") === "false" && !busyLine(root), "button: idle, it is not busy and shows no busy line");
  const idle = region(root);
  const idleText = idle ? text(idle) : "no region";
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
  check(idle && idle.getAttribute("role") === "status" && idleText === "" && region(root) === idle && line === idle && text(idle) === BOOK_BUSY,
    "button: the busy line is written into a live region that was on the page, empty, before the click", `idle "${idleText}", same node ${region(root) === idle}, busy line in it ${line === idle}`);
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
  check(button(root).getAttribute("aria-busy") === "false" && !button(root).disabled && !busyLine(root) && idle !== null && region(root) === idle && text(idle) === "" && !fake.terminated && fake.onmessage === null,
    "button: once saved, the button is idle again, its live region is empty, and the worker is kept idle for the next click");
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
  const before = region(root);
  await act(async () => {
    button(root).click();
  });
  await settle();
  restore();
  const note = [...root.container.querySelectorAll(".tbl-note")].map(text).join(" ");
  check(note === BOOK_FAILED && note === "The workbook with formulas could not be built. Download Excel holds the same figures as values." && !busyLine(root) && button(root).getAttribute("aria-busy") === "false",
    "failure: when no path can build the book, the button keeps its failure line and is idle again", note);
  check(before !== null && region(root) === before && text(before) === BOOK_FAILED && before.getAttribute("role") === "status",
    "failure: the failure line is written into the live region that was on the page before the click", before ? text(before) : "no region before the click");
  check(seen.errors.some((e) => /could not be built/.test(e) && /SheetJS did not load/.test(e)) && seen.warns.some((w) => /no Worker here/.test(w)),
    "failure: the console names both the worker's failure and the page's", [...seen.warns, ...seen.errors].join(" | "));
  root.unmount();
}

{
  // Leaving the tab with no build under way keeps the idle worker: coming back and clicking starts no worker.
  const fake = new FakeWorker({ auto: true });
  const seen = seams({ worker: fake });
  const root = render(card());
  await act(async () => {
    button(root).click();
  });
  await act(async () => void (await tick(20)));
  root.unmount();
  const again = render(card());
  await act(async () => {
    button(again).click();
  });
  await act(async () => void (await tick(20)));
  restore();
  check(seen.saves.length === 2 && seen.made === 1 && fake.posted.length === 2 && !fake.terminated,
    "unmount: leaving the tab with no build under way keeps the idle worker, so the next click after coming back starts none", `${seen.saves.length} saves, ${seen.made} workers`);
  again.unmount();
}

{
  // A worker that never answers and a page load that never finishes: the click ends in the failure line, the
  // button idle again, never a button left busy.
  const fake = new FakeWorker();
  const seen = seams({ worker: fake, sheetjs: () => new Promise(() => {}) });
  J.seams.workerMs = 30;
  J.seams.sheetjsMs = 30;
  const root = render(card());
  await act(async () => {
    button(root).click();
  });
  await act(async () => void (await tick(200)));
  restore();
  const b = button(root);
  check(text(region(root)) === BOOK_FAILED && !busyLine(root) && b.getAttribute("aria-busy") === "false" && !b.disabled && fake.terminated && seen.saves.length === 0,
    "deadline: a stalled worker and a stalled page load end the click in the failure line, the button idle again",
    `"${text(region(root))}", busy ${b.getAttribute("aria-busy")}, ended ${fake.terminated}`);
  check(seen.errors.some((e) => /did not load within 0\.03 s/.test(e)) && seen.warns.some((w) => /did not answer within 0\.03 s/.test(w)),
    "deadline: the console names both deadlines", [...seen.warns, ...seen.errors].join(" | "));
  root.unmount();
}

done("bookjob");

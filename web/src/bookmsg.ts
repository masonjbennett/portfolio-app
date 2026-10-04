// What passes between the page and the worker that builds the scorecard's workbook of formulas
// (src/bookjob.ts sends, src/bookworker.ts answers), and the check each side runs on what it receives.
//
// A worker receives a structured clone of its message, and a clone cannot carry a function. The scorecard
// model does carry functions: each row's metric holds the getters that computed its figures. So the request
// names each row by its id and carries its figures alone, and the worker puts the page's own metric back by
// that id (SCORE_METRICS). The book reads a row's id and its figures, never a getter, so the worker's book
// is the page's book cell for cell; test/t-bookjob.mjs holds the two equal.
//
// Each field of the model is copied BY NAME, never spread, so a field added to the model later does not
// ride along unseen: it fails to type-check here until it is copied, and a function that slipped in would
// fail the suite's check that the request is plain data. The analysis is plain data already (arrays of
// numbers and strings) and goes as it is.
import type { Analysis } from "./types.ts";
import { SCORE_METRICS, type ScoreCell, type ScoreColumn, type ScoreModel } from "./tabs/optimization/scorecard.ts";

/** Why a typed mix was refused, as the scorecard's download row receives it. */
export type Refusal = "zero" | "net-short" | "leverage";
const REFUSALS: readonly string[] = ["zero", "net-short", "leverage"];

/** What the book is built from, besides the scorecard itself. */
export interface BookSource {
  analysis: Analysis;
  amount: number;
  refused: Refusal | null;
}

/** A scorecard row as data: its metric's id and one cell per column. */
export interface PlainLine {
  id: string;
  cells: ScoreCell[];
}

/** The scorecard model with every function left behind. */
export type PlainModel = Omit<ScoreModel, "lines"> & { lines: PlainLine[] };

/** The page to the worker: build this book. */
export interface BookRequest extends BookSource {
  kind: "build";
  model: PlainModel;
}

/** The worker to the page: the file's name (no extension) and its bytes, or why there are none. */
export type BookReply = { kind: "book"; name: string; bytes: ArrayBuffer } | { kind: "failed"; message: string };

/** What scoreBook (src/workbook.ts) takes, rebuilt from a request. */
export interface BookBuild extends BookSource {
  model: ScoreModel;
}

const cellOf = (c: ScoreCell): ScoreCell => (c.se === undefined ? { value: c.value } : { value: c.value, se: c.se });
const columnOf = (c: ScoreColumn): ScoreColumn => ({ id: c.id, label: c.label, sub: c.sub, ok: c.ok, weights: c.weights ? [...c.weights] : null });

/** The request for the scorecard on screen: plain data a worker can receive. */
export function plainRequest(source: BookSource, model: ScoreModel): BookRequest {
  return {
    kind: "build",
    analysis: source.analysis,
    amount: source.amount,
    refused: source.refused,
    model: {
      columns: model.columns.map(columnOf),
      lines: model.lines.map((l) => ({ id: l.metric.id, cells: l.cells.map(cellOf) })),
      title: model.title,
      span: model.span,
      conventions: model.conventions,
      days: model.days,
      seed: model.seed,
      cut: model.cut,
      addedDraws: model.addedDraws,
      addedMissing: [...model.addedMissing],
    },
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number";
const isNumOrNull = (x: unknown) => x === null || isNum(x);

/** The scorecard model again, each row's metric put back by its id. Throws naming a row it does not know. */
export function fromPlain(m: PlainModel): ScoreModel {
  return {
    ...m,
    lines: m.lines.map((l) => {
      const metric = SCORE_METRICS.find((x) => x.id === l.id);
      if (!metric) throw new Error(`the request names a scorecard row this page does not have: ${String(l.id)}`);
      return { metric, cells: l.cells };
    }),
  };
}

/**
 * The worker's side: the build a request asks for. Throws, saying what is wrong, on anything that is not a
 * request this page sends, so the worker answers with a failure instead of a book built from half a message.
 */
export function readRequest(data: unknown): BookBuild {
  if (!isObj(data) || data.kind !== "build") throw new Error("the message is not a request for the book");
  const { analysis: a, model: m, amount, refused } = data;
  if (!isObj(a) || a.ok !== true || !Array.isArray(a.tickers) || !Array.isArray(a.returns) || !Array.isArray(a.dates) || !isObj(a.prices)) {
    throw new Error("the request carries no analysis");
  }
  if (!isNum(amount) || !Number.isFinite(amount)) throw new Error("the request carries no amount invested");
  if (refused !== null && !(typeof refused === "string" && REFUSALS.includes(refused))) throw new Error("the request's refusal is not one the page gives");
  if (!isObj(m) || !Array.isArray(m.columns) || !Array.isArray(m.lines) || typeof m.span !== "string" || typeof m.conventions !== "string") {
    throw new Error("the request carries no scorecard");
  }
  const width = m.columns.length;
  const columnsOk = m.columns.every(
    (c) => isObj(c) && typeof c.id === "string" && typeof c.label === "string" && typeof c.ok === "boolean" && (c.weights === null || (Array.isArray(c.weights) && c.weights.every(isNum))),
  );
  if (!columnsOk) throw new Error("a scorecard column in the request is not a column");
  const linesOk = m.lines.every(
    (l) => isObj(l) && typeof l.id === "string" && Array.isArray(l.cells) && l.cells.length === width && l.cells.every((c) => isObj(c) && isNumOrNull(c.value) && (c.se === undefined || isNumOrNull(c.se))),
  );
  if (!linesOk) throw new Error("a scorecard row in the request does not have one figure per column");
  return { analysis: a as unknown as Analysis, amount, refused: refused as Refusal | null, model: fromPlain(m as unknown as PlainModel) };
}

/** The page's side: a reply it can save, or why it cannot. Never throws. */
export function readReply(data: unknown): { ok: true; name: string; bytes: ArrayBuffer } | { ok: false; why: string } {
  if (!isObj(data)) return { ok: false, why: "the worker's reply is not a message the page knows" };
  if (data.kind === "failed") return { ok: false, why: `the worker could not build it: ${typeof data.message === "string" && data.message ? data.message : "it gave no reason"}` };
  if (data.kind !== "book") return { ok: false, why: "the worker's reply is not a message the page knows" };
  if (typeof data.name !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(data.name)) return { ok: false, why: "the worker's reply names no file" };
  if (!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength === 0) return { ok: false, why: "the worker's reply carries no file" };
  return { ok: true, name: data.name, bytes: data.bytes };
}

// The seeded redraws a tab shows, solved after the tab has painted. redraw() (src/lib/robust.ts) re-solves
// both optimised portfolios on each of 200 drawn mean vectors, which takes a noticeable moment at ten
// assets, so it never runs during a render: the effect below waits for the page to paint, then solves,
// and the tab shows "pending" until then. The first draw set uses DEFAULT_SEED, the seed the downloads
// use, so the page and a file saved from it agree; each Redraw moves to the next seed.
//
// A column the reader adds to the scorecard has redraws of its own (addedStrip on its own window), on the
// same seed as the page's. They are solved the same way, after paint, one construction per macrotask so
// a reader adding all four is never kept waiting for every solve at once.
import { useEffect, useMemo, useState } from "react";
import type { AddedId } from "../../lib/constructions.ts";
import { DEFAULT_SEED } from "../../lib/rng.ts";
import { addedStrip, redraw, REDRAWS } from "../../lib/robust.ts";
import type { Analysis } from "../../types.ts";
import { addedFit } from "./model.ts";
import type { AddedDraws, RedrawState, StripState } from "./scorecard.ts";

// One object, so a memo keyed on the state does not recompute while the draws are pending.
const PENDING: RedrawState = { status: "pending" };
const PENDING_STRIP: StripState = { status: "pending" };
const NONE: AddedDraws = {};

/** The seed of draw set k (k = 0 is the first, the one the downloads share). */
export const seedOf = (k: number): number => DEFAULT_SEED + k;

/** redraw() on the analysis's own window, or the error it threw, as a state. */
export function solveRedraws(a: Analysis, seed: number): RedrawState {
  try {
    return { status: "ready", value: redraw(a.m, a.S, a.rf, a.allowShort, a.dates.length, REDRAWS, seed) };
  } catch (err) {
    console.error("[redraws] the redraws could not be solved", err);
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** The redraws for an analysis and a seed, solved once the page has painted; pending until then. */
export function useRedraws(a: Analysis, seed: number): RedrawState {
  const [held, setHeld] = useState<{ a: Analysis; seed: number; state: RedrawState } | null>(null);
  useEffect(() => {
    let live = true;
    // A macrotask, so the browser paints the tab (and the band) before the solves start.
    const id = setTimeout(() => {
      const state = solveRedraws(a, seed);
      if (live) setHeld({ a, seed, state });
    }, 0);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [a, seed]);
  return held && held.a === a && held.seed === seed ? held.state : PENDING;
}

/** One added construction's redraws on the analysis's own window for it, or the error they threw, as a state. */
export function solveAddedStrip(a: Analysis, id: AddedId, seed: number): StripState {
  const own = addedFit(a, id).own;
  if (!own) return { status: "ready", value: null };
  try {
    return { status: "ready", value: addedStrip(id, own.m, own.S, a.rf, a.allowShort, own.T, REDRAWS, seed) };
  } catch (err) {
    console.error(`[redraws] the redraws of ${id} could not be solved`, err);
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The redraws of each added construction in `ids` on seed `seed`, solved once the page has painted, one
 * construction per macrotask; each is pending until its own lands. A construction solved once for an
 * analysis and seed is kept, so toggling a column off and on again does not solve it again. The returned
 * object is the same while nothing in it changes, so a memo keyed on it holds.
 */
export function useAddedStrips(a: Analysis, ids: readonly AddedId[], seed: number): AddedDraws {
  const [held, setHeld] = useState<{ a: Analysis; seed: number; got: AddedDraws }>({ a, seed, got: NONE });
  const got = held.a === a && held.seed === seed ? held.got : NONE;
  const next = ids.find((id) => got[id] === undefined) ?? null;
  useEffect(() => {
    if (next === null) return undefined;
    let live = true;
    const t = setTimeout(() => {
      const state = solveAddedStrip(a, next, seed);
      if (!live) return;
      setHeld((prev) => ({ a, seed, got: { ...(prev.a === a && prev.seed === seed ? prev.got : NONE), [next]: state } }));
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [a, seed, next]);
  return useMemo(() => {
    if (!ids.length) return NONE;
    const out: Partial<Record<AddedId, StripState>> = {};
    for (const id of ids) out[id] = got[id] ?? PENDING_STRIP;
    return out;
  }, [ids, got]);
}

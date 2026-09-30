// The seeded redraws a tab shows, solved after the tab has painted. redraw() (src/lib/robust.ts) re-solves
// both optimised portfolios on each of 200 drawn mean vectors, which takes a noticeable moment at ten
// assets, so it never runs during a render: the effect below waits for the page to paint, then solves,
// and the tab shows "pending" until then. The first draw set uses DEFAULT_SEED, the seed the downloads
// use, so the page and a file saved from it agree; each Redraw moves to the next seed.
import { useEffect, useState } from "react";
import { DEFAULT_SEED } from "../../lib/rng.ts";
import { redraw, REDRAWS } from "../../lib/robust.ts";
import type { Analysis } from "../../types.ts";
import type { RedrawState } from "./scorecard.ts";

// One object, so a memo keyed on the state does not recompute while the draws are pending.
const PENDING: RedrawState = { status: "pending" };

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

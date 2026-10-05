// The walk-forward on the reader's basket, solved after the segment has painted. A run refits every
// construction before every hold, which takes a noticeable moment on a large basket with short holds, so it
// never runs during a render: the effect below waits for the page to paint (a macrotask, as the Optimization
// tab's redraws do), then works through the run's steps (./live.ts walkSteps, one refit each), as many as fit
// in STEP_MS, and hands the rest to the next macrotask, so no one task holds the page for longer than about a
// step past that. The segment says it is solving until the run lands. Each result is kept per analysis and
// options (./live.ts), so an explanation level, or an option already seen, repaints without solving again.
//
// A solve that throws is handed back to the render, which throws it, so the segment's own Boundary names the
// failure in the segment's place, as every card on the page fails: never a blank and never a stand-in.
import { useEffect, useState } from "react";
import { schedule, type WalkOptions } from "../../lib/walkforward.ts";
import type { Analysis } from "../../types.ts";
import { keepWalk, peekWalk, walkSteps, type LiveWalk, type RatePlan } from "./live.ts";

/** How long one macrotask may keep stepping before it yields to the page, in milliseconds. */
export const STEP_MS = 12;

export type WalkState = { status: "pending" } | { status: "ready"; value: LiveWalk };

const PENDING: WalkState = { status: "pending" };

/** The run for these inputs: ready at once when the window is too short or the run was solved before, else pending until it lands. */
export function useLiveWalk(a: Analysis, plan: RatePlan, opts: WalkOptions, added: boolean): WalkState {
  const plan0 = schedule(a.dates.length, opts);
  const hit = plan0.ok ? peekWalk(a, plan, opts, added) : plan0;
  const [failure, setFailure] = useState<{ a: Analysis; plan: RatePlan; opts: WalkOptions; added: boolean; error: unknown } | null>(null);
  const [, landed] = useState(0);
  const missing = hit === undefined;
  useEffect(() => {
    if (!missing) return undefined;
    let live = true;
    const steps = walkSteps(a, plan, opts, added);
    let t: ReturnType<typeof setTimeout>;
    const work = () => {
      if (!live) return;
      const t0 = performance.now();
      try {
        let r = steps.next();
        while (!r.done && performance.now() - t0 < STEP_MS) r = steps.next();
        if (!r.done) {
          t = setTimeout(work, 0);
          return;
        }
        keepWalk(a, plan, opts, added, r.value);
      } catch (error) {
        console.error("[walk-forward] the test could not be solved", error);
        setFailure({ a, plan, opts, added, error });
        return;
      }
      landed((n) => n + 1);
    };
    t = setTimeout(work, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [a, plan, opts, added, missing]);
  if (failure && failure.a === a && failure.plan === plan && failure.opts === opts && failure.added === added) {
    throw failure.error instanceof Error ? failure.error : new Error(String(failure.error));
  }
  return hit === undefined ? PENDING : { status: "ready", value: hit };
}

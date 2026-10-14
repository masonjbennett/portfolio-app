// The what-if panel (./WhatIf.tsx) as the last row of Build a portfolio's More list: one expected return moved by
// hand and the weights solved again on these prices. It sat under the front-page band's plates until the Overview
// replaced the band, then closed the chapter as a fold of its own until the chapter's More list took it.
//
// The panel's code, and the solvers it runs (src/lib/robust.ts and what that imports), are not in the page's first
// chunk. They are fetched when the reader points at, focuses or presses the row (`loadWhatIf`, the row's `before`),
// and the More list holds a click that lands before they arrive, so the row opens on the finished panel in one step.
// Once here, the module stays for the visit. A row opened from elsewhere before the code is in (a jump) asks for it
// itself and says it is loading; a fetch that fails says so inside the row.
import { useEffect, useSyncExternalStore } from "react";
import type { Analysis } from "../types.ts";
import type WhatIf from "./WhatIf.tsx";
import "./WhatIfRow.css";

type Panel = typeof WhatIf;

// What a test replaces: how the panel's code is fetched (a test holds it in flight, or makes it fail).
export const seams = { whatIf: () => import("./WhatIf.tsx") };

let panel: Panel | null = null;
let failed = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};

/** Asks for the panel's code: null when it is here, else a promise that settles when it arrives or fails. */
export function loadWhatIf(): Promise<void> | null {
  if (panel) return null;
  if (!inflight) {
    inflight = seams.whatIf().then(
      (m) => {
        panel = m.default;
        failed = false;
        inflight = null;
        emit();
      },
      () => {
        failed = true;
        inflight = null;
        emit();
      },
    );
  }
  return inflight;
}

/** Forgets the fetched code, as a reload does (tests only). */
export function forgetWhatIf() {
  panel = null;
  failed = false;
  inflight = null;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getVersion = () => version;

export default function WhatIfRow({ a }: { a: Analysis }) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  useEffect(() => {
    if (!panel) void loadWhatIf();
  }, []);
  if (panel) {
    const P = panel;
    return <P a={a} />;
  }
  if (failed) {
    return (
      <p className="whatif-failed" role="alert">
        The what-if could not be loaded. Reload the page to try again.
      </p>
    );
  }
  return (
    <p className="whatif-loading" role="status">
      Loading the what-if.
    </p>
  );
}

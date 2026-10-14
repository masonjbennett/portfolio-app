// The what-if panel (./WhatIf.tsx), folded shut at every width: one expected return moved by hand and the
// weights solved again on these prices. It sat under the front-page band's plates until the Overview
// replaced the band; it now closes the Build a portfolio chapter, until that chapter's More list takes it.
//
// The panel's code, and the solvers it runs (src/lib/robust.ts and what that imports), are not in the
// page's first chunk. They are fetched when the reader points at, focuses or presses the line, and a
// click that lands before they arrive is held until they have, so the fold opens on the finished panel
// in one step, never on an empty box that fills a moment later. Once here, the panel stays mounted, shut
// or open. The browser keeps the fetched module, so a fold mounted again later gets it back within a
// microtask of asking. A fetch that fails says so inside the fold.
import { useState } from "react";
import type { MouseEvent } from "react";
import type { Analysis } from "../types.ts";
import type WhatIf from "./WhatIf.tsx";
import "./WhatIfFold.css";

type Panel = typeof WhatIf;

// What a test replaces: how the panel's code is fetched (a test holds it in flight, or makes it fail).
export const seams = { whatIf: () => import("./WhatIf.tsx") };

const fetchPanel = (): Promise<Panel> => seams.whatIf().then((m) => m.default);

export default function WhatIfFold({ a, settling = false }: { a: Analysis; settling?: boolean }) {
  const [Loaded, setLoaded] = useState<Panel | null>(null);
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [failed, setFailed] = useState(false);
  const warm = () => {
    if (!Loaded) fetchPanel().then((P) => setLoaded(() => P), () => {});
  };
  const onClick = (e: MouseEvent<HTMLElement>) => {
    // With the panel here, or the failure line showing, the browser opens or shuts the fold itself.
    if (Loaded || open) return;
    e.preventDefault();
    setHeld(true);
    fetchPanel().then(
      (P) => {
        setLoaded(() => P);
        setFailed(false);
        setHeld(false);
        setOpen(true);
      },
      () => {
        setFailed(true);
        setHeld(false);
        setOpen(true);
      },
    );
  };
  return (
    <details
      className={settling ? "whatif-fold whatif-fold--settling" : "whatif-fold"}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      aria-busy={held || undefined}
    >
      <summary onPointerEnter={warm} onPointerDown={warm} onFocus={warm} onClick={onClick}>
        What if one expected return were different?
      </summary>
      {Loaded ? (
        <Loaded a={a} />
      ) : failed ? (
        <p className="whatif-failed" role="alert">
          The what-if could not be loaded. Reload the page to try again.
        </p>
      ) : null}
    </details>
  );
}

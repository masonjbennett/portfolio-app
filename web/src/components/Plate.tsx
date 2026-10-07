// A stat plate: a label over one large number, the Snapshot's st.metric (1203-1208). A missing or
// non-finite value prints the dash and says "not available" in words: never NaN, never a stand-in.
import { DASH, format } from "../format.ts";
import type { ScoreTipKey } from "../content/tooltips.ts";
import type { PlateProps, TipKey } from "../types.ts";
import Tip from "./Tip.tsx";
import "./Plate.css";

// allowShort: passed through to the Tip, whose text follows the shorting toggle.
// se: printed small beside the figure, outside the figure's own element, so the figure reads alone. When the
// plate is too narrow for both on one line, the error goes on a line ABOVE the figure (wrap-reverse), so the
// figure stays level with its neighbours'. Printed only beside a figure that is itself printed.
// tip: one of the app's tooltips, or one of the port's own (the band's equal-weight, minimum-variance and
// benchmark Sharpe plates carry the port's), as the Tip itself accepts.
export default function Plate({ label, value, format: id, tip, level, allowShort = false, se = null }: Omit<PlateProps, "tip"> & { tip?: TipKey | ScoreTipKey }) {
  const ok = value !== null && Number.isFinite(value);
  const err = ok && se !== null && Number.isFinite(se) ? se : null;
  return (
    <div className="plate">
      <div className="plate-label">
        <span>{label}</span>
        {tip ? <Tip tip={tip} level={level} allowShort={allowShort} /> : null}
      </div>
      {ok && err !== null ? (
        <div className="plate-figure">
          <div className="plate-value num">{format(value, id)}</div>{" "}
          <span className="plate-se num">± {format(err, id)} SE</span>
        </div>
      ) : ok ? (
        <div className="plate-value num">{format(value, id)}</div>
      ) : (
        <>
          <div className="plate-value num" aria-hidden="true">
            {DASH}
          </div>
          <div className="plate-na">not available</div>
        </>
      )}
    </div>
  );
}

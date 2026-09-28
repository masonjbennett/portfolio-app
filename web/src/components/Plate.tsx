// A stat plate: a label over one large number, the Snapshot's st.metric (1203-1208). A missing or
// non-finite value prints the dash and says "not available" in words: never NaN, never a stand-in.
import { DASH, format } from "../format.ts";
import type { PlateProps } from "../types.ts";
import Tip from "./Tip.tsx";
import "./Plate.css";

// allowShort: passed through to the Tip, whose text follows the shorting toggle.
export default function Plate({ label, value, format: id, tip, level, allowShort = false }: PlateProps) {
  const ok = value !== null && Number.isFinite(value);
  return (
    <div className="plate">
      <div className="plate-label">
        <span>{label}</span>
        {tip ? <Tip tip={tip} level={level} allowShort={allowShort} /> : null}
      </div>
      {ok ? (
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

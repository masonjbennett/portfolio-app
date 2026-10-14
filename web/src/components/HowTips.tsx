// What a card's info marks used to say, under its "How it is calculated" fold: each term's three texts,
// in plain words, in finance terms and as the formula, the same texts the marks carried (content/tooltips.ts,
// whose parity with the app's TOOLTIPS is held by test/t-tooltips.mjs), so nothing is reworded and a
// reader sees every level at once instead of choosing one.
import { tipName, tipText } from "../content/tooltips.ts";
import { LEVELS, type Level, type TipKey } from "../types.ts";
import "./HowTips.css";

export const LEVEL_HEADS: Readonly<Record<Level, string>> = {
  plain: "In plain words",
  finance: "In finance terms",
  formula: "The formula",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function HowTips({ keys, allowShort = false }: { keys: readonly TipKey[]; allowShort?: boolean }) {
  return (
    <dl className="how-tips">
      {keys.map((k) => (
        <div key={k} className="how-tip" data-tip={k}>
          <dt>{cap(tipName(k))}</dt>
          {LEVELS.map((l) => {
            const t = tipText(k, l.id, allowShort);
            return t ? (
              <dd key={l.id} data-level={l.id}>
                <span className="how-tip-level">{LEVEL_HEADS[l.id]}:</span> {t}
              </dd>
            ) : null;
          })}
        </div>
      ))}
    </dl>
  );
}

// The starting amount, edited on the chart it scales: "Growth of $[10000]" in the chart's head. Every
// growth and wealth chart shows the same field bound to the same setting, so a change on one moves
// them all. The amount stays out of the share link, as it always has: the setting it writes is the one
// the workbench keeps in this browser only.
//
// The draft is what the reader typed; the setting changes only when the draft is a number at or above
// the floor, so a half-typed "1" never redraws every chart at $1. Below the floor the field says
// why, and the charts keep the last good amount.
import { useEffect, useId, useState } from "react";
import { AMOUNT_STEP, MIN_AMOUNT } from "../state/defaults.ts";
import "./AmountField.css";

export interface AmountFieldProps {
  /** The current starting amount (Settings.amount). */
  amount: number;
  /** Ask for a new amount; called only with a valid one. */
  onAmount: (next: number) => void;
}

/** Why a typed amount is refused, or null when it may become the setting. */
export function amountProblem(v: string): string | null {
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n) || n < MIN_AMOUNT) {
    return `The starting amount must be at least $${MIN_AMOUNT.toLocaleString("en-US")}.`;
  }
  return null;
}

export default function AmountField({ amount, onAmount }: AmountFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(String(amount));
  const [problem, setProblem] = useState<string | null>(null);
  // Another chart's field, or a restored preference, moved the amount: show it unless the draft already says it.
  useEffect(() => {
    setDraft((d) => (Number(d) === amount ? d : String(amount)));
    setProblem(null);
  }, [amount]);

  function change(v: string) {
    setDraft(v);
    const p = amountProblem(v);
    setProblem(p);
    if (p === null && Number(v) !== amount) onAmount(Number(v));
  }

  return (
    <div className="amount-field">
      <label htmlFor={id}>Growth of $</label>
      <input
        id={id}
        name="amount"
        type="number"
        inputMode="numeric"
        min={MIN_AMOUNT}
        step={AMOUNT_STEP}
        value={draft}
        aria-invalid={problem !== null}
        aria-describedby={`${id}-note`}
        onChange={(e) => change(e.target.value)}
      />
      <p id={`${id}-note`} className={problem ? "amount-error" : "amount-note"} role={problem ? "alert" : undefined}>
        {problem ?? "The starting amount for every growth chart. Kept in this browser, never in a shared link."}
      </p>
    </div>
  );
}

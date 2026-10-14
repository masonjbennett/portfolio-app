// The formula line: the formula behind a finding's figure, with the tab's own numbers in it
// (src/tabs/formula.ts builds it), in a fold of its own directly under the finding, closed until a reader opens it.
// Until Oct 2026 the line showed only at the page's Formula explanation level; the level is gone, and a fold keeps
// the line one tap away without adding its words to every opening. A builder that returns null (the finding has no
// figure) draws neither the fold nor the line.
//
// A screen reader meets the symbols as bare characters, so the line is read from its spoken form instead
// (spoken in ../tabs/formula.ts): the symbols are hidden from it and the words are hidden from the eye.
import { useId, useState } from "react";
import { spoken } from "../tabs/formula.ts";
import "./Card.css";
import "./FormulaLine.css";

export interface FormulaLineProps {
  /** The line, or null when the finding carries no figure. */
  build: () => string | null;
}

/** The fold's button: the same face as a card's two folds (components/Card). */
export const FORMULA_FOLD = "The formula";

export default function FormulaLine({ build }: FormulaLineProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const line = build();
  if (!line) return null;
  return (
    <div className="formula-fold">
      <button type="button" className="card-fold-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {FORMULA_FOLD}
      </button>
      <p className="formula-line" id={id} hidden={!open}>
        <span className="formula-line-symbols" aria-hidden="true">
          {line}
        </span>
        <span className="formula-line-words">{spoken(line)}</span>
      </p>
    </div>
  );
}

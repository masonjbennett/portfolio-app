// The formula line: one line under a tab's finding, at the Formula explanation level only, giving the
// formula behind the finding's figure with the tab's own numbers in it (src/tabs/formula.ts builds it).
// At Plain and Finance it renders nothing and `build` is never called, so those levels keep the page as
// it is. A builder that returns null (the finding has no figure) draws nothing at any level.
//
// A screen reader meets the symbols as bare characters, so the line is read from its spoken form instead
// (spoken in ../tabs/formula.ts): the symbols are hidden from it and the words are hidden from the eye.
import { spoken } from "../tabs/formula.ts";
import type { Level } from "../types.ts";
import "./FormulaLine.css";

export interface FormulaLineProps {
  level: Level;
  /** The line, or null when the finding carries no figure; called only at the Formula level. */
  build: () => string | null;
}

export default function FormulaLine({ level, build }: FormulaLineProps) {
  if (level !== "formula") return null;
  const line = build();
  if (!line) return null;
  return (
    <p className="formula-line">
      <span className="formula-line-symbols" aria-hidden="true">
        {line}
      </span>
      <span className="formula-line-words">{spoken(line)}</span>
    </p>
  );
}

// The formula line: one line under a tab's finding, at the Formula explanation level only, giving the
// formula behind the finding's figure with the tab's own numbers in it (src/tabs/formula.ts builds it).
// At Plain and Finance it renders nothing and `build` is never called, so those levels keep the page as
// it is. A builder that returns null (the finding has no figure) draws nothing at any level.
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
  return <p className="formula-line">{line}</p>;
}

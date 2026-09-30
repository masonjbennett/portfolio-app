// The scorecard: one ruled table, a figure per row and a portfolio per column, the benchmark last behind
// a heavier rule. Every number arrives computed (src/tabs/optimization/scorecard.ts); this file lays it
// out, as Table does, and saves it through Table's own download buttons.
//
// Two views. The short one keeps the rows set in bold, about a dozen, so the table reads at a glance;
// "Show every row" opens the rest in place, with the bold rows still bold. The view is not remembered:
// every load starts short.
//
// It shares Table's ledger styles (.tbl), so it scrolls sideways inside its own box on a phone with the
// figure column frozen at the left, and its caption carries the same title and span lines, plus a third
// with the conventions every row follows. The title line is clipped from the screen, as Table does for a
// `headed` table: the section's heading right above says the same word, and the caption keeps it for a
// screen reader.
//
// Each row's label carries its explanation: an info mark where the tooltip component takes the key, and
// every visible row's text at the chosen level under "What each row means", which works on touch too.
import { useMemo, useState } from "react";
import { tipText } from "../content/tooltips.ts";
import {
  cellText,
  drawRowNote,
  SCORE_GROUPS,
  scoreSheet,
  visibleLines,
  type RedrawState,
  type ScoreColId,
  type ScoreModel,
} from "../tabs/optimization/scorecard.ts";
import type { Level } from "../types.ts";
import { Downloads } from "./Table.tsx";
import Tip from "./Tip.tsx";
import "./Table.css";
import "./Scorecard.css";

export interface ScorecardProps {
  model: ScoreModel;
  /** The redraws behind the fragility group's draw row, for the note that says why it may be empty. */
  redraws: RedrawState;
  level: Level;
  allowShort: boolean;
  /** Download file name without extension. */
  filename: string;
  /** A column to set in bold (the Custom tab marks its own mix). */
  focus?: ScoreColId;
}

export default function Scorecard({ model, redraws, level, allowShort, filename, focus }: ScorecardProps) {
  const [full, setFull] = useState(false);
  const lines = visibleLines(model, full);
  const sheet = useMemo(() => scoreSheet(model), [model]);
  const width = model.columns.length + 1;
  const pending = drawRowNote(redraws);
  const colClass = (id: ScoreColId) => ["num", id === "bench" ? "sc-bench" : "", focus === id ? "sc-focus" : ""].filter(Boolean).join(" ");

  return (
    <div className="tbl sc" data-view={full ? "full" : "short"}>
      <div className="tbl-scroll" role="region" aria-label={model.title} tabIndex={0}>
        <table>
          <caption>
            <span className="tbl-title tbl-title-clip">{model.title}</span>
            <span className="tbl-span">{model.span}</span>
            <span className="tbl-span sc-conv">{model.conventions}</span>
          </caption>
          <thead>
            <tr>
              <th scope="col" className="txt first">
                Figure
              </th>
              {model.columns.map((c) => (
                <th key={c.id} scope="col" className={colClass(c.id)} data-col={c.id}>
                  {c.label}
                  {c.sub ? <span className="tbl-sub">{c.sub}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          {SCORE_GROUPS.map((g) => {
            const rows = lines.filter((l) => l.metric.group === g.id);
            if (!rows.length) return null;
            return (
              <tbody key={g.id} data-group={g.id}>
                <tr className="sc-group">
                  <th scope="rowgroup" colSpan={width} className="txt first">
                    {g.label}
                  </th>
                </tr>
                {rows.map((l) => (
                  <tr key={l.metric.id} data-metric={l.metric.id} className={l.metric.short ? "sc-short" : undefined}>
                    <th scope="row" className="txt first">
                      {l.metric.label}
                      <Tip tip={l.metric.tip} level={level} allowShort={allowShort} />
                    </th>
                    {l.cells.map((cell, k) => (
                      <td key={model.columns[k].id} className={colClass(model.columns[k].id)}>
                        {cellText(cell, l.metric.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      <div className="sc-controls">
        <button type="button" className="sc-toggle" aria-pressed={full} onClick={() => setFull(!full)}>
          {full ? "Show the short view" : "Show every row"}
        </button>
      </div>
      <p className="sc-note">
        The fragility rows are in-sample what-ifs on these prices, not a forecast. Equal weight and a typed mix hold the same weights
        whatever the window or the draw, so their first three fragility rows are zero. The parameters row counts the estimates each set
        of weights rests on, all from {model.days.toLocaleString("en-US")} daily returns.
        {model.seed !== null ? ` The redraw row uses seed ${model.seed}.` : ""}
      </p>
      {model.cut ? <p className="sc-note sc-cut">{model.cut}</p> : null}
      {pending ? (
        <p className="sc-note" role="status">
          {pending}
        </p>
      ) : null}
      <details className="sc-defs">
        <summary>What each row means</summary>
        <dl>
          {lines.map((l) => (
            <div key={l.metric.id}>
              <dt>{l.metric.label}</dt>
              <dd>{tipText(l.metric.tip, level, allowShort)}</dd>
            </div>
          ))}
        </dl>
      </details>
      <Downloads title={model.title} columns={sheet.columns} rows={sheet.rows} filename={filename} rowFormats={sheet.rowFormats} />
    </div>
  );
}

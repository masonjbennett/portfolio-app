// A dense table of raw numbers, formatted at render, with its own CSV and Excel downloads.
//
// Rows hold NUMBERS; format() prints them, right-aligned in tabular figures, and the downloads write
// the same numbers unformatted (src/download.ts). The app offers downloads for five tables and not the
// rest (portfolio_app.py 1250-1252, 1364-1366, 1548-1550, 1700-1702, 1930-1932): none for CAPM (1393),
// the covariance matrix (1462), the normalised custom weights (1737, 1977) or the window metrics
// (1911-2005), and CSV only on the sensitivity tab. Here every table carries both, and there is
// deliberately no prop that turns them off.
//
// On a phone the table keeps its rows and columns: the label column stays put (position: sticky) and
// the figures scroll sideways inside the table's own box. It never collapses into stacked cards,
// which would break the column comparison a table exists for.
//
// The caption carries two lines: the title, and the span under it, which says which dates the figures
// come from and how often the returns behind them were sampled. A figure without its window cannot be
// compared with anything, so `span` is a required prop; a table of weights as someone typed them, which
// comes from no dates at all, passes null and says so at its call site.
//
// A table whose section heading sits right above it with the same words (`headed`) keeps its title in
// the caption, where it names the table for a screen reader and titles the Excel sheet, but clips it
// from the screen (Table.css), so the page does not print the same words twice in a row.
//
// A head (a column's label, or a row's label) can carry a sub-line under it, keyed by the head's own
// text in `subs`. The sub-line is the page's alone: the downloads keep the plain heads the app's own
// downloads use ("GMV", "Tangency"), so a sheet built on one keeps working.
//
// A column marked `pageHidden` is left out of the page's head and rows but stays in both downloads, for
// a figure the page need not print twice in two units while a spreadsheet may want the second one.
import { useState } from "react";
import { downloadCsv, downloadXlsx } from "../download.ts";
import { format, isText } from "../format.ts";
import type { CellFormat, Column, TableProps } from "../types.ts";
import "./Table.css";

export interface Props extends TableProps {
  /** The dates and the return frequency behind the figures, e.g. "Daily returns, 2019-01-03 to 2026-09-28". */
  span: string | null;
  /** A sub-line under any head whose text is a key: a column label, or a label-column cell. */
  subs?: Readonly<Record<string, string>>;
  /** The section's heading right above already prints this title, with nothing drawn between them. */
  headed?: boolean;
}

function Sub({ subs, head }: { subs?: Readonly<Record<string, string>>; head: string }) {
  return subs && Object.hasOwn(subs, head) ? <span className="tbl-sub">{subs[head]}</span> : null;
}

// The label column: the one flagged `first`, else the leftmost.
function labelKey(columns: Column[]): string | undefined {
  return (columns.find((c) => c.first) ?? columns[0])?.key;
}

/**
 * The two download buttons, on their own so a table laid out elsewhere (the scorecard, whose rows each
 * carry their own format) saves through exactly the same path. `rowFormats` is download.ts's: one format
 * per row, for a sheet whose rows measure different things.
 */
export function Downloads({ title, columns, rows, filename, rowFormats }: TableProps & { rowFormats?: readonly CellFormat[] }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function excel() {
    setBusy(true);
    setFailed(false);
    try {
      await downloadXlsx(filename, title, columns, rows, rowFormats);
    } catch (err) {
      console.error(`[table] ${title}: the Excel file could not be built`, err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tbl-dl">
      <button type="button" onClick={() => downloadCsv(filename, columns, rows)} aria-label={`Download CSV of ${title}`}>
        Download CSV
      </button>
      <button type="button" onClick={excel} disabled={busy} aria-busy={busy} aria-label={`Download Excel of ${title}`}>
        Download Excel
      </button>
      {failed && (
        <span className="tbl-note" role="status">
          The Excel file could not be built. The CSV holds the same numbers.
        </span>
      )}
    </div>
  );
}

export default function Table({ title, columns, rows, filename, span, subs, headed = false }: Props) {
  const shown = columns.filter((c) => !c.pageHidden);
  const label = labelKey(shown);

  return (
    <div className="tbl">
      <div className="tbl-scroll" role="region" aria-label={title} tabIndex={0}>
        <table>
          <caption>
            <span className={headed ? "tbl-title tbl-title-clip" : "tbl-title"}>{title}</span>
            {span ? <span className="tbl-span">{span}</span> : null}
          </caption>
          <thead>
            <tr>
              {shown.map((c) => (
                <th key={c.key} scope="col" className={cellClass(c, label)}>
                  {c.label}
                  <Sub subs={subs} head={c.label} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {shown.map((c) => {
                  const text = format(row[c.key] ?? null, c.format);
                  return c.key === label ? (
                    <th key={c.key} scope="row" className={cellClass(c, label)}>
                      {text}
                      <Sub subs={subs} head={text} />
                    </th>
                  ) : (
                    <td key={c.key} className={cellClass(c, label)}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Downloads title={title} columns={columns} rows={rows} filename={filename} />
    </div>
  );
}

function cellClass(c: Column, label: string | undefined): string {
  const parts = [isText(c.format) ? "txt" : "num"];
  if (c.key === label) parts.push("first");
  return parts.join(" ");
}

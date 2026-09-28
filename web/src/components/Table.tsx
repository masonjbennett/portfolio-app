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
import { useState } from "react";
import { downloadCsv, downloadXlsx } from "../download.ts";
import { format, isText } from "../format.ts";
import type { Column, TableProps } from "../types.ts";
import "./Table.css";

// The label column: the one flagged `first`, else the leftmost.
function labelKey(columns: Column[]): string | undefined {
  return (columns.find((c) => c.first) ?? columns[0])?.key;
}

export default function Table({ title, columns, rows, filename }: TableProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = labelKey(columns);

  async function excel() {
    setBusy(true);
    setFailed(false);
    try {
      await downloadXlsx(filename, title, columns, rows);
    } catch (err) {
      console.error(`[table] ${title}: the Excel file could not be built`, err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tbl">
      <div className="tbl-scroll" role="region" aria-label={title} tabIndex={0}>
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cellClass(c, label)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => {
                  const text = format(row[c.key] ?? null, c.format);
                  return c.key === label ? (
                    <th key={c.key} scope="row" className={cellClass(c, label)}>
                      {text}
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
    </div>
  );
}

function cellClass(c: Column, label: string | undefined): string {
  const parts = [isText(c.format) ? "txt" : "num"];
  if (c.key === label) parts.push("first");
  return parts.join(" ");
}

// The masthead: the app's title (portfolio_app.py 1177), the byline (1177, in the resume's words, see
// src/content/about.tsx), its title chip (1172-1187) and one line saying what day the prices run to,
// whether the baked example is showing, and whether new prices are on their way.
import { AUTHOR, CREDENTIAL, DEK, SITE_URL } from "../content/about.tsx";
import { format } from "../format.ts";
import type { Analysis, LoadState } from "../types.ts";
import { monthYear } from "./when.ts";
import "./Masthead.css";

export interface MastheadProps {
  /** The analysis on screen. */
  analysis: LoadState<Analysis>;
  /** A price request is in flight. */
  fetching: boolean;
}

// The app's chip (1182): "{n} assets · {bench} · {start:%b %Y} – {end:%b %Y}". It prints the
// REQUESTED dates (st.session_state.start / end, 1087), not the span the prices cover, which a
// late listing or a truncated overlap can shorten.
export function titleChip(a: Analysis): string {
  return `${a.tickers.length} assets · ${a.benchLabel} · ${monthYear(a.requested.start)} – ${monthYear(a.requested.end)}`;
}

export default function Masthead({ analysis, fetching }: MastheadProps) {
  const a = analysis.status === "ready" ? analysis.value : null;
  return (
    <header className="masthead">
      <div>
        <h1 className="masthead-title">Portfolio Analytics</h1>
        {/* The app's welcome-state dek (1097-1153) is replaced by one that says what the page does (DEK, src/content/about.tsx). */}
        <p className="masthead-dek">{DEK}</p>
        <p className="masthead-byline">
          <a href={SITE_URL}>{AUTHOR}</a> · {CREDENTIAL}
        </p>
      </div>
      <div className="masthead-meta">
        {a ? <p className="masthead-chip">{titleChip(a)}</p> : null}
        <p className="masthead-asof" aria-live="polite">
          {a ? <span>Prices as of {format(a.asOf, "date")}</span> : fetching ? <span>Fetching prices</span> : null}
          {a && a.source === "example" ? <span className="masthead-tag masthead-tag-example">{"· "}example</span> : null}
          {a && fetching ? <span className="masthead-tag masthead-tag-updating">{"· "}updating</span> : null}
        </p>
      </div>
    </header>
  );
}

// The masthead: the app's title (portfolio_app.py 1177), the byline (1177, in the resume's words, see
// src/content/about.tsx) and the way into the guide, on one row; the dek under it. The app's title chip
// (1172-1187) and the prices' day now sit in the basket bar (./BasketBar.tsx), which says what is
// being analysed.
import { AUTHOR, CREDENTIAL, DEK, SITE_URL } from "../content/about.tsx";
import { GUIDE_HREF, GUIDE_TITLE } from "../guide/route.ts";
import "./Masthead.css";

export default function Masthead() {
  return (
    <header className="masthead">
      <div className="masthead-row">
        <h1 className="masthead-title">Portfolio Analytics</h1>
        <p className="masthead-byline">
          <a href={SITE_URL}>{AUTHOR}</a> · {CREDENTIAL}
        </p>
        <nav className="masthead-links" aria-label="About this page">
          <a href={GUIDE_HREF} title={GUIDE_TITLE}>
            Guide
          </a>
        </nav>
      </div>
      {/* The app's welcome-state dek (1097-1153) is replaced by one that says what the page does (DEK, src/content/about.tsx). */}
      <p className="masthead-dek">{DEK}</p>
    </header>
  );
}

// The masthead: the app's title (portfolio_app.py 1177), the byline (1177, in the resume's words, see
// src/content/about.tsx) and the way into the guide, on one row. The title is the site's name, not the page's
// heading: the page's one h1 is the Overview's question. The dek left the page for the meta description
// (index.html, DEK in src/content/about.tsx), so the question is the first sentence a reader meets. The app's title chip
// (1172-1187) and the prices' day now sit in the basket bar (./BasketBar.tsx), which says what is
// being analysed.
import { AUTHOR, CREDENTIAL, SITE_URL } from "../content/about.tsx";
import { GUIDE_HREF, GUIDE_TITLE } from "../guide/route.ts";
import "./Masthead.css";

export default function Masthead() {
  return (
    <header className="masthead">
      <div className="masthead-row">
        <p className="masthead-title">Portfolio Analytics</p>
        <p className="masthead-byline">
          <a href={SITE_URL}>{AUTHOR}</a> · {CREDENTIAL}
        </p>
        <nav className="masthead-links" aria-label="About this page">
          <a href={GUIDE_HREF} title={GUIDE_TITLE}>
            Guide
          </a>
        </nav>
      </div>
    </header>
  );
}

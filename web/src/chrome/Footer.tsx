// The page's footing: how every figure is computed (the app's "About / Methodology", 763-797, rewritten for
// what src/lib does; the entries live in src/content/about.tsx), the one-line summary of it, and where the
// code and its author are. On the page it also links the guide (src/guide/route.ts); the guide reuses this footing,
// without that link, so its readers find the same methodology at its foot.
import { METHODS, SITE_URL, SOURCE_URL } from "../content/about.tsx";
import { GUIDE_HREF, GUIDE_TITLE } from "../guide/route.ts";
import { TRADING_DAYS } from "../lib/stats.ts";
import "./Footer.css";

export default function Footer({ here = "page" }: { here?: "page" | "guide" }) {
  return (
    <footer className="footer">
      <details className="footer-method">
        <summary>Methodology</summary>
        <dl>
          {METHODS.map((m) => (
            <div key={m.term} className="footer-method-row">
              <dt>{m.term}</dt>
              <dd>{m.text}</dd>
            </div>
          ))}
        </dl>
      </details>
      <p>
        Returns are daily simple returns from adjusted closing prices, annualised over {TRADING_DAYS} trading days. Portfolio
        weights sum to 100%; each lies between 0% and 100%, or between −100% and 100% with short positions allowed. Every
        figure describes the period shown and is not a forecast: the range of outcomes only reshuffles that period&rsquo;s
        own months.
      </p>
      <p className="footer-links">
        {here === "page" ? (
          <>
            <a href={GUIDE_HREF}>{GUIDE_TITLE}</a>
            <span aria-hidden="true"> · </span>
          </>
        ) : null}
        <a href={SOURCE_URL}>Source code on GitHub</a>
        <span aria-hidden="true"> · </span>
        <a href={SITE_URL}>masonjbennett.com</a>
      </p>
    </footer>
  );
}

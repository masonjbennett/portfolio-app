// The page's footing: how every figure is computed (the app's "About / Methodology", 763-797, rewritten for
// what src/lib does; the entries live in src/content/about.tsx), the one-line summary of it, and where the
// code and its author are.
import { METHODS, SITE_URL, SOURCE_URL } from "../content/about.tsx";
import { TRADING_DAYS } from "../lib/stats.ts";
import "./Footer.css";

export default function Footer() {
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
        figure describes the period shown and is not a forecast.
      </p>
      <p className="footer-links">
        <a href={SOURCE_URL}>Source code on GitHub</a>
        <span aria-hidden="true"> · </span>
        <a href={SITE_URL}>masonjbennett.com</a>
      </p>
    </footer>
  );
}

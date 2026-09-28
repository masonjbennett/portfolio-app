// The page's footing: how the figures are computed, in plain words. Each clause is what src/lib
// does (daily simple returns, 252-day annualisation, the bounds of 780-782), nothing more.
import { TRADING_DAYS } from "../lib/stats.ts";
import "./Footer.css";

export default function Footer() {
  return (
    <footer className="footer">
      <p>
        Returns are daily simple returns from closing prices, annualised over {TRADING_DAYS} trading days. Portfolio weights
        sum to 100%; each lies between 0% and 100%, or between −100% and 100% with short positions allowed. Every figure
        describes the period shown and is not a forecast.
      </p>
    </footer>
  );
}

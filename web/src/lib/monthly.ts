// Calendar months out of daily returns. A month's return is its trading days compounded,
// (1 + r1)(1 + r2)...(1 + rk) - 1, and it is labelled by the year and month of the return dates in it.
//
// The window rarely starts on a month's first trading day or ends on its last, and the dates alone
// cannot say whether it does (a holiday can make the 2nd the first session). So the FIRST and the
// LAST month are always flagged partial, and every monthly statistic below is taken over the
// complete months only: a three-day stub is not a calendar month and should not be scored as one.
import { mean, type Vec } from "./num.ts";

export interface Month {
  /** "YYYY-MM". */
  ym: string;
  /** The month's compounded return, decimal (0.012 = 1.2%). */
  ret: number;
  /** Trading days of the month that fall inside the window. */
  days: number;
  /** True for the window's first and last month, which may not be whole. */
  partial: boolean;
}

// Assumes ascending ISO dates (yyyy-mm-dd), one per return, as the cleaned frame carries them.
export function monthlyReturns(r: Vec, dates: readonly string[]): Month[] {
  if (r.length !== dates.length) throw new Error(`monthlyReturns: ${r.length} returns but ${dates.length} dates`);
  const out: Month[] = [];
  let ym = "";
  let growth = 1;
  let days = 0;
  for (let i = 0; i < r.length; i++) {
    const key = dates[i].slice(0, 7);
    if (key !== ym) {
      if (days) out.push({ ym, ret: growth - 1, days, partial: false });
      ym = key;
      growth = 1;
      days = 0;
    }
    growth *= 1 + r[i];
    days += 1;
  }
  if (days) out.push({ ym, ret: growth - 1, days, partial: false });
  if (out.length) {
    out[0].partial = true;
    out[out.length - 1].partial = true;
  }
  return out;
}

export interface MonthStats {
  /** Best and worst complete month, decimal; NaN when there is no complete month. */
  best: number;
  worst: number;
  /** Share of complete months with a return above zero, 0..1; NaN when there is none. */
  positive: number;
  /** How many complete months the three figures rest on. */
  months: number;
}

export function monthStats(months: readonly Month[]): MonthStats {
  const done = months.filter((m) => !m.partial);
  if (!done.length) return { best: NaN, worst: NaN, positive: NaN, months: 0 };
  let best = -Infinity;
  let worst = Infinity;
  for (const m of done) {
    if (m.ret > best) best = m.ret;
    if (m.ret < worst) worst = m.ret;
  }
  const up = done.filter((m) => m.ret > 0).length;
  return { best, worst, positive: up / done.length, months: done.length };
}

export interface Capture {
  /** Up capture as a ratio (1 = 100%); NaN when the benchmark had no complete up month. */
  up: number;
  /** Down capture as a ratio (1 = 100%); NaN when the benchmark had no complete down month. */
  down: number;
  upMonths: number;
  downMonths: number;
}

// Up and down capture on MONTHLY returns. The convention, stated because vendors differ: the
// ARITHMETIC mean of the portfolio's monthly returns divided by the arithmetic mean of the
// benchmark's, taken over the complete months in which the benchmark rose (up) or fell (down). A
// month the benchmark ended exactly flat counts as neither. Some vendors compound the months first
// (a geometric ratio); this one does not. `r` and `b` are daily returns on the same `dates`.
export function captureRatios(r: Vec, b: Vec, dates: readonly string[]): Capture {
  const pm = monthlyReturns(r, dates);
  const bm = monthlyReturns(b, dates);
  const pUp: number[] = [];
  const bUp: number[] = [];
  const pDn: number[] = [];
  const bDn: number[] = [];
  for (let i = 0; i < bm.length; i++) {
    if (bm[i].partial) continue;
    if (bm[i].ret > 0) {
      pUp.push(pm[i].ret);
      bUp.push(bm[i].ret);
    } else if (bm[i].ret < 0) {
      pDn.push(pm[i].ret);
      bDn.push(bm[i].ret);
    }
  }
  return {
    up: bUp.length ? mean(pUp) / mean(bUp) : NaN,
    down: bDn.length ? mean(pDn) / mean(bDn) : NaN,
    upMonths: bUp.length,
    downMonths: bDn.length,
  };
}

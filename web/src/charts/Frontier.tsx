// The efficient frontier: the lowest volatility reachable at each return, with the assets, the
// benchmark and the marked portfolios (Equal-Weight, GMV, Tangency, Custom) placed on it and NAMED ON
// THE CHART. Shared by the Optimization tab (portfolio_app.py 1592-1656) and the Custom tab
// (1753-1819), which differ only in what they pass.
//
// Where it departs from the app, on purpose:
// - Hover names the ONE point under the pointer. Both frontiers ask for hovermode "closest" (1653,
//   1816), and style_chart (983-995), applied after, overrides it with "x unified", so a hover listed
//   every series at that volatility. Recharts 3.10 gives a ScatterChart only the closest-point ("item")
//   tooltip, which is why this is a ScatterChart with a <Scatter line> and not a ComposedChart.
// - No legend. Every point carries its name beside it, clear of every other name and every marker
//   (Custom sits exactly on Equal-Weight until the weights are changed, 1631-1634).
// - With shorting on, the caption states the bounds: each weight in [-1, 1] (780-782). The toggle's
//   help calls that frontier "unconstrained" (750); it is not.
// - A failed tangency solve draws no tangency point and no capital allocation line, and the caption
//   says so. (The app always had a tangency to plot: an equal-weight stand-in when SLSQP failed.)
// - The capital allocation line runs as the app's does, from (0, rf) to 1.15 times the frontier's
//   highest volatility (1607-1609), but the plot is scaled to the points and the line is clipped at
//   its edge; the app's autorange stretched the whole plot to hold the line's far end.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Symbols,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisDomain,
  useYAxisScale,
} from "recharts";
import { usePhone } from "../chrome/usePhone.ts";
import ChartFrame from "../components/ChartFrame.tsx";
import { format, MINUS } from "../format.ts";
import type { Vec } from "../lib/num.ts";
import type { FrontierPoint } from "../lib/optimize.ts";
import { portfolioPerformance } from "../lib/portfolio.ts";
import { annualizedStats } from "../lib/stats.ts";
import { tokens } from "../styles/tokens.ts";
import type { Analysis, LoadState } from "../types.ts";
import { labelFill } from "./contrast.ts";
import { textWidth } from "./labels.ts";
import { axisProps, chartTheme, DASH, gridProps, ROLE, tooltipProps, type Hover } from "./theme.ts";

const c = tokens.color;

// ---- props ---------------------------------------------------------------------------------------

/** The four portfolios a frontier can mark. */
export type MarkRole = "ew" | "gmv" | "tangency" | "custom";

/** One asset: its annualized mean return and volatility (1636-1637). */
export interface FrontierAsset {
  ticker: string;
  mu: number;
  sigma: number;
}

/** A marked portfolio. One the caller leaves out of `marks` is not drawn (a failed GMV, say). */
export interface FrontierMark {
  /** The name drawn beside the point, e.g. "GMV". */
  label: string;
  /** Which portfolio: sets the colour and the marker. */
  role: MarkRole;
  /** Annualized return. */
  mu: number;
  /** Annualized volatility. */
  sigma: number;
}

/** The capital allocation line: from the risk-free rate through the tangency portfolio (1607-1609). */
export interface FrontierCal {
  /** The annual risk-free rate the line starts from, at zero volatility. */
  rf: number;
  /** The tangency portfolio's annualized return and volatility. */
  tangency: { mu: number; sigma: number };
}

/** The benchmark's point, drawn with its name as the app does (1641-1645). */
export interface FrontierBench {
  label: string;
  mu: number;
  sigma: number;
}

/** Everything one frontier draws. */
export interface FrontierData {
  /** The engine's frontier; infeasible points are dropped by the chart and the rest joined in order. */
  points: readonly FrontierPoint[];
  /** The assets, in ticker order (their colours follow that order). */
  assets: readonly FrontierAsset[];
  /** The marked portfolios, drawn in this order (a later one sits on top). */
  marks: readonly FrontierMark[];
  /** null when the tangency solve failed: then no tangency point and no line are drawn, and the caption says why. */
  cal: FrontierCal | null;
  /** The benchmark's point, or null to leave it off. */
  bench: FrontierBench | null;
}

export interface FrontierProps {
  /** One sentence stating the finding. */
  title: string;
  /** The frontier's data state; only "ready" draws. */
  state: LoadState<FrontierData>;
  /** The shorting toggle the frontier was solved under: the caption states the bounds when it is on. */
  allowShort: boolean;
  /** The annual risk-free rate, for the caption. */
  rf: number;
  /** Height in px; 480 on a desktop and 380 on a phone when left out. */
  height?: number;
}

// ---- pure helpers --------------------------------------------------------------------------------

/** The frontier's hover: the closest point, never a shared x (the app's was "x unified" by accident). */
export const FRONTIER_HOVER: Hover = "closest";

/** The tooltip props every frontier spreads onto its <Tooltip>. */
export const frontierTooltip = tooltipProps(FRONTIER_HOVER);

/** The line from the risk-free rate through the tangency portfolio, as the app draws it (1607-1609). */
export interface CalSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The tangency portfolio's Sharpe ratio; 0 when its volatility is not positive, as in the app. */
  slope: number;
}

export function calSegment(cal: FrontierCal, frontierMaxSigma: number): CalSegment {
  const slope = cal.tangency.sigma > 0 ? (cal.tangency.mu - cal.rf) / cal.tangency.sigma : 0;
  const x1 = frontierMaxSigma * 1.15;
  return { x0: 0, y0: cal.rf, x1, y1: cal.rf + slope * x1, slope };
}

/** The caption under the frontier's title: what is drawn, and the bounds only when shorting is on. */
export function frontierCaption(allowShort: boolean, rf: number, cal: FrontierCal | null | undefined): string {
  const parts = ["Annualized return against annualized volatility; the solid line is the lowest volatility reachable at each return."];
  if (cal === null) {
    parts.push("Tangency failed: the maximum-Sharpe solve returned no portfolio, so no tangency point and no capital allocation line are drawn.");
  } else if (cal) {
    parts.push(`The dashed line is the capital allocation line, from the ${format(rf, "pct2")} risk-free rate through the tangency portfolio.`);
  }
  if (allowShort) parts.push(`Shorting is on: each asset's weight is bounded to [${MINUS}1, 1].`);
  return parts.join(" ");
}

/**
 * The frontier data for one analysis: its frontier (or `points`, the Custom tab's own), each asset at
 * mean x 252 and sample std x sqrt(252) (1636-1637), the marks through portfolio_performance
 * (1760-1762) in the app's drawing order GMV, Tangency, Equal-Weight, Custom (1614-1634), the line
 * when there is a tangency, and the benchmark. `custom` is the normalised custom weights, or null.
 */
export function frontierData(a: Analysis, custom: Vec | null = null, points: readonly FrontierPoint[] = a.frontier): FrontierData {
  const perf = (w: Vec) => portfolioPerformance(w, a.m, a.S, a.rf);
  const marks: FrontierMark[] = [];
  if (a.gmv) marks.push({ label: "GMV", role: "gmv", mu: a.gmv.mu, sigma: a.gmv.sigma });
  if (a.tangency) marks.push({ label: "Tangency", role: "tangency", mu: a.tangency.mu, sigma: a.tangency.sigma });
  const ew = perf(a.ew);
  marks.push({ label: "Equal-Weight", role: "ew", mu: ew.mu, sigma: ew.sigma });
  if (custom) {
    const p = perf(custom);
    marks.push({ label: "Custom", role: "custom", mu: p.mu, sigma: p.sigma });
  }
  return {
    points,
    assets: a.tickers.map((ticker, i) => {
      const s = annualizedStats(a.returns[i], a.rf);
      return { ticker, mu: s.mu, sigma: s.sigma };
    }),
    marks,
    cal: a.tangency ? { rf: a.rf, tangency: { mu: a.tangency.mu, sigma: a.tangency.sigma } } : null,
    bench: { label: a.benchLabel, mu: a.benchStats.mu, sigma: a.benchStats.sigma },
  };
}

// ---- sizing and direct labels (shared with the wealth chart) ------------------------------------

/** Space Grotesk at 12px averages about 7px a character; labels are placed on this estimate. */
export const CHAR_PX = 7;
const LABEL_FONT = { fontFamily: tokens.font.sans, fontSize: 12 } as const;
const LABEL_GAP = 14; // px between two labels' centres: a 12px line and a hair of air
const LABEL_HALF = LABEL_GAP / 2; // a name's box, centred on its line
const CLEAR = 3; // px of paper kept between a name and any marker
const LABEL_OFFSET = CLEAR + 1; // px from the edge of a point's own marker to its name
const SLIDE_LEADER = 6; // px of sideways slide past which a name is drawn with a hairline to its point
const MAX_SLIDE = 18; // px a name may slide sideways past something in its way before that side is given up
const MAX_DY = 60; // px a name may move up or down from its point, with a hairline back to it

/**
 * The width a chart has to draw in, measured from its own box. Recharts' `responsive` never draws
 * until the box reports a size, which jsdom never does (test/_dom.mjs), so this starts at
 * `fallback` and takes the real width as soon as the box has one.
 */
export function useBoxWidth(fallback: number): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const take = (w: number) => {
      if (w > 0) setWidth(Math.round(w));
    };
    take(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => take(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far a marker reaches from its centre, in px. */
export interface Extent {
  left: number;
  right: number;
  up: number;
  down: number;
}
const NO_EXTENT: Extent = { left: 0, right: 0, up: 0, down: 0 };

/** A marker drawn on the plot: its centre and its reach. Names are kept off every one. */
export interface Obstacle {
  x: number;
  y: number;
  extent: Extent;
}

/** A label where it is drawn: `x`, `y` the text's anchor, `px`, `py` the point it names. */
export interface PlacedLabel {
  key: string;
  text: string;
  color: string;
  x: number;
  y: number;
  px: number;
  py: number;
  anchor: "start" | "end";
  width: number;
  /** Drawn with a hairline back to its point; when absent, a name more than half a line off its point gets one. */
  leader?: boolean;
}

// d3's symbols, which Recharts' <Symbols> draws, sized by AREA in px squared: how far each reaches from
// its centre (d3-shape's own geometry), plus half the paper outline every marker here is drawn with.
export function symbolExtent(type: SymbolKind, size: number, stroke = 1.5): Extent {
  const s = stroke / 2;
  const all = (r: number): Extent => ({ left: r + s, right: r + s, up: r + s, down: r + s });
  switch (type) {
    case "circle":
      return all(Math.sqrt(size / Math.PI));
    case "cross":
      return all(1.5 * Math.sqrt(size / 5));
    case "square":
      return all(Math.sqrt(size) / 2);
    case "diamond": {
      const y = Math.sqrt(size / (2 * Math.tan(Math.PI / 6)));
      const x = y * Math.tan(Math.PI / 6);
      return { left: x + s, right: x + s, up: y + s, down: y + s };
    }
    case "star": {
      const r = Math.sqrt(size * 0.8908130915292852);
      const x = r * Math.sin((2 * Math.PI) / 5);
      return { left: x + s, right: x + s, up: r + s, down: r * Math.cos(Math.PI / 5) + s };
    }
    case "triangle": {
      const y = Math.sqrt(size / (Math.sqrt(3) * 3));
      return { left: Math.sqrt(3) * y + s, right: Math.sqrt(3) * y + s, up: 2 * y + s, down: y + s };
    }
  }
}

interface Rect {
  lo: number;
  hi: number;
  top: number;
  bot: number;
}
interface Spot {
  /** What the spot costs in all (see placeLabels), and the part of that which is moving the name. */
  cost: number;
  move: number;
  /** False for a spot taken only because none was clear: it overlaps something. */
  clear: boolean;
  anchor: "start" | "end";
  box: Rect;
  /** The point the name sits beside: its own, or for a line one further along it. */
  pt: { px: number; py: number };
  /** The hairline back to the point, when the name sits off its level. */
  leader: [Pt, Pt] | null;
}
const hits = (a: Rect, b: Rect) => a.lo < b.hi && b.lo < a.hi && a.top < b.bot && b.top < a.bot;
const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)) * Math.max(0, Math.min(a.bot, b.bot) - Math.max(a.top, b.top));

interface Pt {
  x: number;
  y: number;
}
/** How far a point is from a box: 0 inside it. */
const rectDist = (r: Rect, x: number, y: number) => Math.hypot(Math.max(r.lo - x, 0, x - r.hi), Math.max(r.top - y, 0, y - r.bot));
/** Whether the segment a-b passes through the box (Liang-Barsky clipping). */
function segHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [pp, q] of [[-dx, a.x - r.lo], [dx, r.hi - a.x], [-dy, a.y - r.top], [dy, r.bot - a.y]]) {
    if (pp === 0) {
      if (q < 0) return false;
    } else {
      const t = q / pp;
      if (pp < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}
/** How far point p is from the segment a-b. */
function ptSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Whether segments a-b and c-d cross (touching at an end does not count). */
function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, o: Pt) => Math.sign((q.x - p.x) * (o.y - p.y) - (q.y - p.y) * (o.x - p.x));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
const STRANGER_LED = 30; // the same for a name with a hairline, which says whose it is, if less plainly
const STRANGER_COST = 100; // a name level with its point but nearer some other marker reads as that marker's
const CROSS_COST = 200; // a hairline that crosses, or comes within NEAR px of, another name's hairline
const NEAR = 3;
const THROUGH_COST = 15; // a hairline drawn through another marker
const LINE_COST = 25; // a name set across one of the plot's lines
const BLOCKED = 1e6; // a spot that overlaps something, taken only when no spot is clear
const REPAIR_ROUNDS = 4;
const PAIR_TRIES = 16;

// Where a name may go, nearest first: level with its point, then 3px steps up and down.
const DY: number[] = [0];
for (let d = 3; d <= MAX_DY; d += 3) DY.push(-d, d);

/**
 * Puts each name beside its point, clear of every marker and of every name already placed, and inside
 * the plot. For each name, in the order given (so pass the names that matter most first), it tries
 * the right side and then the left, level with its point and then a step at a time up or down; at each
 * height it starts just past its own marker and slides outward past whatever is in the way, up to
 * MAX_SLIDE. Of the spots that fit, it takes the one that moves the name least: height counts in full,
 * a sideways slide nearly so, the left side as a little under one step's worth of slide, and a spot far
 * enough off its point to need a hairline back to it as a few px more. A LINE's name may sit beside
 * any of the points in `along` (its own point first), at a fifth of a px per px it moves down the line.
 * Three things cost more, without being ruled out: a spot nearer some other marker than its own point
 * (it would read as that marker's name; less so with a hairline, which says whose it is), a hairline
 * crossing or all but touching another name's hairline or passing through a marker, and a name set
 * across one of `lines` (the frontier, the capital allocation line).
 * A name no spot fits takes the spot inside the plot that overlaps least; an overlap is visible, where a
 * dropped name would not be. Placed one at a time, an early name cannot see the hairlines of the names
 * after it, so a repair pass then re-places each name with every other one known, and keeps the new
 * spot only if it costs less, until a pass changes nothing (REPAIR_ROUNDS at most).
 */
export function placeLabels(
  items: readonly { key: string; text: string; color: string; px: number; py: number; own?: Extent; along?: readonly { px: number; py: number }[] }[],
  plot: Box,
  markers: readonly Obstacle[] = [],
  lines: readonly (readonly Pt[])[] = [],
): PlacedLabel[] {
  const left = plot.x;
  const right = plot.x + plot.width;
  const walls: Rect[] = markers.map((m) => ({
    lo: m.x - m.extent.left - CLEAR,
    hi: m.x + m.extent.right + CLEAR,
    top: m.y - m.extent.up - CLEAR,
    bot: m.y + m.extent.down + CLEAR,
  }));
  const inPlot = (r: Rect) => r.lo >= left && r.hi <= right;
  // What a spot costs beyond moving the name, given the other names' spots: see the doc comment.
  const extra = (spot: Omit<Spot, "cost">, others: readonly Spot[]): number => {
    const { box, pt, leader } = spot;
    if (!spot.clear) return BLOCKED + [...walls, ...others.map((o) => o.box)].reduce((n, q) => n + overlapArea(q, box), 0);
    // Level with its point, nearness is all that ties a name to it; off it, the hairline does.
    const mine = rectDist(box, pt.px, pt.py);
    const strangers = markers.filter((m) => Math.hypot(m.x - pt.px, m.y - pt.py) > 0.5);
    let cost = strangers.some((m) => rectDist(box, m.x, m.y) < mine) ? (leader ? STRANGER_LED : STRANGER_COST) : 0;
    cost += LINE_COST * lines.filter((ln) => ln.some((q, k) => k > 0 && segHitsRect(ln[k - 1], q, box))).length;
    if (leader) {
      const [a, b] = leader;
      // Two hairlines from one spot (Custom on Equal-Weight) share a start: only a true crossing counts.
      const tangle = (c: Pt, d: Pt) =>
        segsCross(a, b, c, d) || (Math.hypot(a.x - c.x, a.y - c.y) > 0.5 && Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b)) < NEAR);
      if (others.some((o) => o.leader && tangle(o.leader[0], o.leader[1]))) cost += CROSS_COST;
      if (walls.some((w, k) => Math.hypot(markers[k].x - pt.px, markers[k].y - pt.py) > 0.5 && segHitsRect(leader[0], leader[1], w))) cost += THROUGH_COST;
    }
    return cost;
  };
  const score = (spot: Spot, others: readonly Spot[]) => spot.move + extra(spot, others);

  // Every spot for one name, cheapest first, the other names' spots fixed.
  const candidates = (it: (typeof items)[number], others: readonly Spot[]): Spot[] => {
    const width = textWidth(it.text);
    const own = it.own ?? NO_EXTENT;
    const found: Spot[] = [];
    const consider = (spot: Omit<Spot, "cost">) => found.push({ ...spot, cost: spot.move + extra(spot, others) });
    const points = it.along?.length ? it.along : [{ px: it.px, py: it.py }];
    for (const pt of points) {
      const along = Math.hypot(pt.px - points[0].px, pt.py - points[0].py) / 5;
      for (const anchor of ["start", "end"] as const) {
        const start = (anchor === "start" ? own.right : own.left) + LABEL_OFFSET;
        for (const dy of DY) {
          const top = pt.py + dy - LABEL_HALF;
          const bot = pt.py + dy + LABEL_HALF;
          if (top < plot.y || bot > plot.y + plot.height) continue;
          const at = (gap: number): Rect => {
            const lo = anchor === "start" ? pt.px + gap : pt.px - gap - width;
            return { lo, hi: lo + width, top, bot };
          };
          const first = at(start);
          if (!inPlot(first)) continue;
          let gap = start;
          let box = first;
          let clear = false;
          while (inPlot(box) && gap - start <= MAX_SLIDE) {
            const hit = walls.find((w) => hits(w, box)) ?? others.find((o) => hits(o.box, box))?.box;
            if (!hit) {
              clear = true;
              break;
            }
            // A hair past the edge: (hi - px) + px can round back inside it, and the slide would never end.
            gap = (anchor === "start" ? hit.hi - pt.px : pt.px - hit.lo) + 0.01;
            box = at(gap);
          }
          if (!clear) {
            consider({ anchor, box: first, pt, leader: null, clear: false, move: (Math.abs(dy) + along) / 1000 });
            continue;
          }
          // Off its level, or slid sideways past a neighbour, a name takes a hairline back to its point.
          const leader: [Pt, Pt] | null = Math.abs(dy) > LABEL_HALF || gap - start > SLIDE_LEADER
            ? [{ x: pt.px, y: pt.py }, { x: anchor === "start" ? box.lo - 2 : box.hi + 2, y: pt.py + dy }]
            : null;
          const move = Math.abs(dy) + 0.8 * (gap - start) + (anchor === "end" ? 8 : 0) + (leader ? 6 : 0) + along;
          consider({ anchor, box, pt, leader, clear: true, move });
        }
      }
    }
    return found.sort((x, y) => x.cost - y.cost);
  };
  const search = (it: (typeof items)[number], others: readonly Spot[]): Spot => {
    const own = it.own ?? NO_EXTENT;
    const width = textWidth(it.text);
    return candidates(it, others)[0] ?? {
      cost: Infinity,
      move: Infinity,
      clear: false,
      anchor: "start",
      box: { lo: it.px + own.right + LABEL_OFFSET, hi: it.px + own.right + LABEL_OFFSET + width, top: it.py - LABEL_HALF, bot: it.py + LABEL_HALF },
      pt: { px: it.px, py: it.py },
      leader: null,
    };
  };

  let spots: Spot[] = [];
  for (const it of items) spots.push(search(it, spots));
  const total = (all: readonly Spot[]) => all.reduce((n, sp, i) => n + score(sp, all.filter((_, j) => j !== i)), 0);
  for (let round = 0; round < REPAIR_ROUNDS; round++) {
    let changed = false;
    items.forEach((it, i) => {
      const others = spots.filter((_, j) => j !== i);
      const now = score(spots[i], others);
      const next = search(it, others);
      if (next.cost < now - 1e-6) {
        spots[i] = next;
        changed = true;
      }
    });
    // Two hairlines that cross need both names moved at once: for each of the first name's PAIR_TRIES
    // cheapest spots, the second's best around it, in either order; the pair's best layout, if it is better.
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const li = spots[i].leader;
        const lj = spots[j].leader;
        if (!li || !lj || !segsCross(li[0], li[1], lj[0], lj[1])) continue;
        const rest = spots.filter((_, k) => k !== i && k !== j);
        let bestTotal = total(spots) - 1e-6;
        let bestTrial: Spot[] | null = null;
        for (const [first, second] of [[i, j], [j, i]]) {
          for (const a of candidates(items[first], rest).slice(0, PAIR_TRIES)) {
            const b = search(items[second], [...rest, a]);
            const trial = spots.map((sp, k) => (k === first ? a : k === second ? b : sp));
            const t = total(trial);
            if (t < bestTotal) {
              bestTotal = t;
              bestTrial = trial;
            }
          }
        }
        if (bestTrial) {
          spots = bestTrial;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return items.map((it, i) => {
    const got = spots[i];
    const x = got.anchor === "start" ? got.box.lo : got.box.hi;
    return {
      key: it.key, text: it.text, color: it.color, x, y: (got.box.top + got.box.bot) / 2, px: got.pt.px, py: got.pt.py,
      anchor: got.anchor, width: textWidth(it.text), leader: got.leader !== null,
    };
  });
}

/** One placed name, with a hairline back to its point when it had to move; bronze names are set in ink2 (./contrast.ts). */
export function LabelText({ l }: { l: PlacedLabel }) {
  const moved = l.leader ?? Math.abs(l.y - l.py) > LABEL_GAP / 2;
  return (
    <g className="direct-label" data-label={l.text}>
      {moved ? (
        <line x1={l.px} y1={l.py} x2={l.anchor === "start" ? l.x - 2 : l.x + 2} y2={l.y} stroke={c.hairline} strokeWidth={1} />
      ) : null}
      <text x={l.x} y={l.y} textAnchor={l.anchor} dominantBaseline="central" fill={labelFill(l.color)} {...LABEL_FONT}>
        {l.text}
      </text>
    </g>
  );
}

// ---- the chart -------------------------------------------------------------------------------------

interface Datum {
  sigma: number;
  mu: number;
  name: string;
}

interface Plot {
  line: Datum[];
  assets: FrontierAsset[];
  marks: FrontierMark[];
  bench: FrontierBench | null;
  cal: CalSegment | null;
}

const finite = (x: number) => Number.isFinite(x);

// The ready value, checked: infeasible frontier points dropped (the app drops its failed targets,
// 958-970), a tangency mark dropped when there is no line, and anything that is not a finite number
// refused by name, so NaN never reaches an axis or a label.
function checked(state: LoadState<FrontierData>): LoadState<Plot> {
  if (state.status !== "ready") return state;
  const d = state.value;
  const line = d.points.filter((p) => p.feasible && finite(p.sigma) && finite(p.target)).map((p) => ({ sigma: p.sigma, mu: p.target, name: "Efficient frontier" }));
  if (!line.length) return { status: "empty", reason: "No point on the frontier could be solved, so there is no frontier to draw." };
  const named: [string, number, number][] = [
    ...d.assets.map((a): [string, number, number] => [a.ticker, a.mu, a.sigma]),
    ...d.marks.map((m): [string, number, number] => [m.label, m.mu, m.sigma]),
    ...(d.bench ? [[d.bench.label, d.bench.mu, d.bench.sigma] as [string, number, number]] : []),
    ...(d.cal ? [["capital allocation line", d.cal.tangency.mu, d.cal.tangency.sigma] as [string, number, number], ["risk-free rate", d.cal.rf, 0] as [string, number, number]] : []),
  ];
  const bad = named.find(([, mu, sigma]) => !finite(mu) || !finite(sigma));
  if (bad) return { status: "error", name: `the ${bad[0]} point`, message: "Its return or volatility is not a finite number." };
  const sigMax = Math.max(...line.map((p) => p.sigma));
  return {
    status: "ready",
    value: {
      line,
      assets: [...d.assets],
      marks: d.marks.filter((m) => d.cal || m.role !== "tangency"),
      bench: d.bench,
      cal: d.cal ? calSegment(d.cal, sigMax) : null,
    },
  };
}

// Markers after the app's (1614-1645): GMV diamond, Tangency star, Equal-Weight square, Custom a
// triangle (Recharts has no hexagon), the benchmark a cross, assets small and translucent. Sizes are
// areas in px squared; the paper outline stands in for the app's white one.
type SymbolKind = "circle" | "cross" | "diamond" | "square" | "star" | "triangle";
const MARKER: Record<MarkRole, { type: SymbolKind; size: number }> = {
  gmv: { type: "diamond", size: 170 },
  tangency: { type: "star", size: 240 },
  ew: { type: "square", size: 110 },
  custom: { type: "triangle", size: 150 },
};
const ASSET_MARKER = { type: "circle", size: 56 } as const;
const BENCH_MARKER = { type: "cross", size: 110 } as const;

function marker(type: SymbolKind, size: number, color: string, opacity = 1) {
  return (p: { cx?: number; cy?: number }): ReactNode => (
    <Symbols cx={p.cx} cy={p.cy} type={type} size={size} fill={color} fillOpacity={opacity} stroke={c.paper} strokeWidth={1.5} />
  );
}

// The frontier line's points take hover without being seen.
function hitTarget(p: { cx?: number; cy?: number }): ReactNode {
  return <circle cx={p.cx} cy={p.cy} r={5} fill={c.paper} fillOpacity={0} />;
}

const pctTick = (v: number) => format(v, "pct1");

// Round-number ticks covering [lo, hi], about `count` steps of 1, 2, 2.5 or 5 times a power of ten.
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const raw = (hi - lo) / count || Math.abs(hi) / count || 0.01;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw * (1 - 1e-12)) ?? 10 * mag;
  const first = Math.floor(lo / step);
  const last = Math.ceil(hi / step);
  const out: number[] = [];
  // Each tick is an integer times the step, so no rounding error accumulates along the axis.
  for (let k = first; k <= last; k++) out.push(Number((k * step).toPrecision(12)));
  return out;
}

function PointTip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const p = active ? (payload?.[0]?.payload as Datum | undefined) : undefined;
  if (!p) return null;
  return (
    <div className="chart-tip" style={frontierTooltip.contentStyle}>
      <div className="chart-tip-name" style={frontierTooltip.labelStyle}>{p.name}</div>
      <div>Volatility {format(p.sigma, "pct2")}</div>
      <div>Return {format(p.mu, "pct2")}</div>
    </div>
  );
}

interface LabelItem {
  key: string;
  text: string;
  color: string;
  sigma: number;
  mu: number;
  /** The marker drawn at the point, if any: the name starts past it. */
  own?: Extent;
  /** For a line: further points along it, in data units, where its name may sit instead. */
  along?: { sigma: number; mu: number }[];
}

// Runs inside the chart, where the axes' scales are known, so names are placed in pixels.
function FrontierLabels({ items, cal, line }: { items: LabelItem[]; cal: CalSegment | null; line: readonly Datum[] }) {
  const xs = useXAxisScale();
  const ys = useYAxisScale();
  const yDomain = useYAxisDomain();
  const plot = usePlotArea();
  if (!xs || !ys || !plot) return null;
  const all = [...items];
  if (cal) {
    // Name the line where it leaves the plot: its far end, or the top edge if it is clipped there.
    const top = Array.isArray(yDomain) && typeof yDomain[1] === "number" ? yDomain[1] : cal.y1;
    const x = cal.y1 > top && cal.slope > 0 ? (top - cal.y0) / cal.slope : cal.x1;
    // Its name may sit anywhere along what is drawn of it, from where it leaves the plot back to rf.
    const along = Array.from({ length: 25 }, (_, k) => {
      const sigma = x * (1 - k / 24);
      return { sigma, mu: cal.y0 + cal.slope * sigma };
    });
    all.push({ key: "cal", text: "Capital allocation line", color: ROLE.cal, sigma: x, mu: cal.y0 + cal.slope * x, along });
  }
  const at = all
    .map(({ along, ...it }) => ({
      ...it,
      px: xs(it.sigma) ?? NaN,
      py: ys(it.mu) ?? NaN,
      along: along?.map((q) => ({ px: xs(q.sigma) ?? NaN, py: ys(q.mu) ?? NaN })).filter((q) => finite(q.px) && finite(q.py)),
    }))
    .filter((it) => finite(it.px) && finite(it.py));
  // Every drawn marker is an obstacle, the name's own included: the frontier line's points are not drawn.
  const markers: Obstacle[] = at.flatMap((it) => (it.own ? [{ x: it.px, y: it.py, extent: it.own }] : []));
  const px = (sigma: number, mu: number) => ({ x: xs(sigma) ?? NaN, y: ys(mu) ?? NaN });
  const drawn: Pt[][] = [line.map((d) => px(d.sigma, d.mu))];
  const calEnd = all.find((it) => it.key === "cal");
  if (cal && calEnd) drawn.push([px(cal.x0, cal.y0), px(calEnd.sigma, calEnd.mu)]);
  const lines = drawn.map((ln) => ln.filter((q) => finite(q.x) && finite(q.y))).filter((ln) => ln.length > 1);
  return (
    <g className="frontier-labels">
      {placeLabels(at, plot, markers, lines).map((l) => (
        <LabelText key={l.key} l={l} />
      ))}
    </g>
  );
}

const MARGIN = { top: 12, right: 16, bottom: 30, left: 4 };
const FALLBACK_WIDTH = 720;

// Every asset is one neutral point, named beside it. The app colours assets by palette position (1639,
// 1802), so its fifth and ninth wear Equal-Weight's and Custom's colours; with five chromatic tokens every
// asset here would share a colour with a portfolio mark or the frontier line. The chromatic tokens are kept
// for those; the benchmark (an ink cross) and the CAL (a dashed ink2 line) share the neutral family, not the shape.
const ASSET = tokens.color.ink2;

function FrontierPlot({ plot, height }: { plot: Plot; height: number }) {
  const [ref, width] = useBoxWidth(FALLBACK_WIDTH);
  const { line, assets, marks, bench, cal } = plot;

  // Scaled to the points and the line's start at rf; the line is clipped where it leaves the plot.
  const sig = [...line.map((p) => p.sigma), ...assets.map((a) => a.sigma), ...marks.map((m) => m.sigma), ...(bench ? [bench.sigma] : [])];
  const mu = [...line.map((p) => p.mu), ...assets.map((a) => a.mu), ...marks.map((m) => m.mu), ...(bench ? [bench.mu] : []), ...(cal ? [cal.y0] : [])];
  const xTicks = niceTicks(0, Math.max(...sig, cal ? cal.x1 : 0));
  const yLo = Math.min(...mu);
  const yHi = Math.max(...mu);
  const pad = (yHi - yLo) * 0.04;
  const yTicks = niceTicks(yLo - pad, yHi + pad);

  // Placed in this order, so the marked portfolios get first choice of spot, then the benchmark, the
  // assets and the line's own name; the capital allocation line's name comes last (FrontierLabels).
  const labels: LabelItem[] = [
    ...marks.map((m) => ({
      key: `mark-${m.role}`, text: m.label, color: ROLE[m.role], sigma: m.sigma, mu: m.mu,
      own: symbolExtent(MARKER[m.role].type, MARKER[m.role].size),
    })),
    ...(bench ? [{ key: "bench", text: bench.label, color: ROLE.bench, sigma: bench.sigma, mu: bench.mu, own: symbolExtent(BENCH_MARKER.type, BENCH_MARKER.size) }] : []),
    ...assets.map((a) => ({ key: `asset-${a.ticker}`, text: a.ticker, color: ASSET, sigma: a.sigma, mu: a.mu, own: symbolExtent(ASSET_MARKER.type, ASSET_MARKER.size) })),
    {
      key: "frontier", text: "Efficient frontier", color: ROLE.frontier, sigma: line[line.length - 1].sigma, mu: line[line.length - 1].mu,
      // Its name may sit anywhere along the upper half of the line, from its end back.
      along: line.slice(Math.floor(line.length / 2)).reverse().map((d) => ({ sigma: d.sigma, mu: d.mu })),
    },
  ];
  const axisTitle = { fill: chartTheme.axis.fill, fontFamily: tokens.font.sans, fontSize: 12 };

  return (
    <div ref={ref} className="frontier-chart" style={{ width: "100%", height }}>
      <ScatterChart width={width} height={height} margin={MARGIN}>
        <CartesianGrid {...gridProps} />
        <XAxis
          type="number"
          dataKey="sigma"
          name="Volatility"
          domain={[xTicks[0], xTicks[xTicks.length - 1]]}
          ticks={xTicks}
          tickFormatter={pctTick}
          {...axisProps}
          label={{ value: "Annualized volatility", position: "insideBottom", offset: -18, ...axisTitle }}
        />
        <YAxis
          type="number"
          dataKey="mu"
          name="Return"
          domain={[yTicks[0], yTicks[yTicks.length - 1]]}
          ticks={yTicks}
          tickFormatter={pctTick}
          width={60}
          {...axisProps}
          label={{ value: "Annualized return", angle: -90, position: "insideLeft", offset: 12, ...axisTitle }}
        />
        <Tooltip {...frontierTooltip} content={PointTip} />
        {cal ? (
          <ReferenceLine
            className="frontier-cal"
            segment={[{ x: cal.x0, y: cal.y0 }, { x: cal.x1, y: cal.y1 }]}
            stroke={ROLE.cal}
            strokeDasharray={DASH.cal}
            strokeWidth={1.5}
            ifOverflow="hidden"
          />
        ) : null}
        <Scatter
          className="frontier-line"
          name="Efficient frontier"
          data={line}
          line={{ stroke: ROLE.frontier, strokeWidth: 3 }}
          lineJointType="linear"
          shape={hitTarget}
          isAnimationActive={false}
        />
        {assets.map((a) => (
          <Scatter
            key={a.ticker}
            className="frontier-asset"
            name={a.ticker}
            data={[{ sigma: a.sigma, mu: a.mu, name: a.ticker }]}
            shape={marker(ASSET_MARKER.type, ASSET_MARKER.size, ASSET, 0.8)}
            isAnimationActive={false}
          />
        ))}
        {bench ? (
          <Scatter
            className="frontier-bench"
            name={bench.label}
            data={[{ sigma: bench.sigma, mu: bench.mu, name: bench.label }]}
            shape={marker(BENCH_MARKER.type, BENCH_MARKER.size, ROLE.bench)}
            isAnimationActive={false}
          />
        ) : null}
        {marks.map((m) => (
          <Scatter
            key={m.role}
            className={`frontier-mark frontier-mark--${m.role}`}
            name={m.label}
            data={[{ sigma: m.sigma, mu: m.mu, name: m.label }]}
            shape={marker(MARKER[m.role].type, MARKER[m.role].size, ROLE[m.role])}
            isAnimationActive={false}
          />
        ))}
        <FrontierLabels items={labels} cal={cal} line={line} />
      </ScatterChart>
    </div>
  );
}

export default function Frontier({ title, state, allowShort, rf, height }: FrontierProps) {
  const phone = usePhone();
  const h = height ?? (phone ? 380 : 480);
  const plot = useMemo(() => checked(state), [state]);
  const cal = state.status === "ready" ? state.value.cal : undefined;
  return (
    <ChartFrame title={title} subtitle={frontierCaption(allowShort, rf, cal)} state={plot} height={h}>
      {(value) => <FrontierPlot plot={value} height={h} />}
    </ChartFrame>
  );
}

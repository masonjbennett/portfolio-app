// The Overview: the recruiter's whole visit on one screen. The page's question in the one serif headline,
// the answer under it (live with hindsight, published without), what the starting amount became in each mix,
// the card that sets hindsight against Mason's published test, three facts on why, a row of the three
// published baskets to try, and who built it. Every sentence and figure comes from ./model.ts.
//
// It replaced the front-page band, and kept every figure the band printed: the finding sentence, the four
// Sharpe plates (the tangency's with its standard error) and the published figures line sit in the hindsight
// card's "Show the numbers", with the site's sentence quoted word for word and the method note linked once.
//
// The growth chart draws with Recharts, which the page's first chunk does not carry (test/t-split.mjs): it is
// its own chunk, fetched when the Overview mounts, with a quiet line the chart's height in its place until it
// arrives. Everything else here is text and one small SVG, so the question and the answer paint at once.
import { lazy, Suspense, useContext, useMemo, type ReactElement } from "react";
import Card from "../components/Card.tsx";
import { ChartNote } from "../components/ChartFrame.tsx";
import Plate from "../components/Plate.tsx";
import Table from "../components/Table.tsx";
import Term from "../components/Term.tsx";
import { usePhone } from "../chrome/usePhone.ts";
import { monthYear } from "../chrome/when.ts";
import { AUTHOR, CREDENTIAL, SOURCE_URL } from "../content/about.tsx";
import { CARD_SENTENCE, PUBLISHED_URL, PUBLISHED_WHEN } from "../content/published.ts";
import { format } from "../format.ts";
import { GUIDE_HREF } from "../guide/route.ts";
import { parseTickers } from "../lib/clean.ts";
import { PUBLISHED_PRESETS } from "../state/defaults.ts";
import { TabContext } from "../state/useWorkbench.ts";
import { tokens } from "../styles/tokens.ts";
import type { Analysis, Column, Level } from "../types.ts";
import { figuresLine, finding, hindsight, lede, MIX, mixRows, QUESTION, snapshotPlates, whyFacts, type Bar, type BarGroup, type Hindsight, type MixKey } from "./model.ts";
import "./Overview.css";

// The growth chart's chunk. A dynamic import is the only reference: a static one would pull Recharts into the
// first chunk.
export const loadWealth = () => import("./OverviewWealth.tsx");
const OverviewWealth = lazy(loadWealth);

/** The title control's words, and where it goes: the published test, replayed, in Does it hold up?. */
export const OPEN_PUBLISHED_TITLE = "Open the published test, replayed, in Does it hold up?";

const COLOR: Record<MixKey, string> = { tangency: tokens.color.bronze, ew: tokens.color.plum, gmv: tokens.color.teal };
// A label in its mix's colour, except bronze, which is too light for text on paper and labels in ink2 (as
// src/charts/contrast.ts's labelFill decides for the charts; that module is a chart's, kept out of this chunk).
const TEXT = (k: MixKey) => (k === "tangency" ? tokens.color.ink2 : COLOR[k]);

/** The question alone, for the Overview while no analysis is on screen yet. */
export function Question() {
  return (
    <header className="ov-hero">
      <p className="ov-eyebrow">The question</p>
      <h1 className="ov-question">{QUESTION}</h1>
    </header>
  );
}

// ---- the hindsight chart: horizontal bars from a zero line, hollow with hindsight, solid without ------

const ROW = 18;
const GAP = 4;
const HEAD = 20;
const AFTER = 10;

// A bar's label says what its group does not: in a group of one mix, with or without hindsight; in a group of
// one basket, the mix (and, where the group holds both, which side of hindsight).
function barLabel(b: Bar, by: BarGroup["by"]): string {
  if (by === "mix") return b.hindsight ? "with hindsight" : "without";
  return by === "hindsight" ? MIX[b.mix].short : `${MIX[b.mix].short}, ${b.hindsight ? "with" : "without"}`;
}

function HindsightBars({ h, narrow }: { h: Hindsight; narrow: boolean }) {
  const W = narrow ? 340 : 440;
  const L = narrow ? 128 : 140;
  const R = 48;
  const all = h.groups.flatMap((g) => g.bars.map((b) => b.value));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const span = hi - lo || 1;
  const x = (v: number) => L + ((v - lo) / span) * (W - L - R);
  let y = 2;
  const parts: ReactElement[] = [];
  h.groups.forEach((g, gi) => {
    parts.push(
      <text key={`g${gi}`} x={0} y={y + 13} className="ov-bars-group">
        {g.label}
      </text>,
    );
    y += HEAD;
    g.bars.forEach((b, bi) => {
      const x0 = x(Math.min(0, b.value));
      const x1 = x(Math.max(0, b.value));
      const label = barLabel(b, g.by);
      parts.push(
        <g key={`b${gi}-${bi}`} data-bar={`${b.mix}-${b.hindsight ? "with" : "without"}`}>
          <text x={L - 6} y={y + ROW - 5} textAnchor="end" className="ov-bars-label" style={{ fill: TEXT(b.mix) }}>
            {label}
          </text>
          <rect
            x={x0}
            y={y + 1}
            width={Math.max(1, x1 - x0)}
            height={ROW - 2}
            style={{ fill: b.hindsight ? tokens.color.card : COLOR[b.mix], stroke: COLOR[b.mix], strokeWidth: b.hindsight ? 1.5 : 0 }}
          />
          <text x={Math.max(x1, x(0)) + 4} y={y + ROW - 5} className="ov-bars-value">
            {b.text}
          </text>
        </g>,
      );
      y += ROW + GAP;
    });
    y += AFTER;
  });
  const H = y;
  return (
    <svg className="ov-bars" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sharpe ratio with and without hindsight">
      <line x1={x(0)} x2={x(0)} y1={0} y2={H - AFTER} className="ov-bars-zero" />
      {parts}
    </svg>
  );
}

// ---- the cards -----------------------------------------------------------------------------------------

function HindsightCard({ a, level }: { a: Analysis; level: Level }) {
  const phone = usePhone();
  const page = useContext(TabContext);
  const h = useMemo(() => hindsight(a), [a]);
  const test = page ? (
    <button type="button" className="text-button ov-open-published" title={OPEN_PUBLISHED_TITLE} onClick={() => page.setTab("walkforward", "published", true)}>
      Walk-forward test
    </button>
  ) : (
    "Walk-forward test"
  );
  const numbers = (
    <div className="ov-numbers">
      <p className="ov-finding">{finding(a)}</p>
      <div className="ov-plates">
        {snapshotPlates(a).map((p) => (
          <Plate key={p.tip} label={p.label} value={p.value} format={p.format} tip={p.tip} level={level} allowShort={a.allowShort} se={p.se} />
        ))}
      </div>
      <figure className="ov-published" aria-label="Published result">
        <blockquote className="ov-published-quote" cite={PUBLISHED_URL}>
          <p>{CARD_SENTENCE}</p>
        </blockquote>
        <p className="ov-published-figures" data-set={h.set ? h.set.name : undefined}>
          {figuresLine(h.set)}
        </p>
        <figcaption className="ov-published-source">
          {test}, published {PUBLISHED_WHEN} · <a href={PUBLISHED_URL}>Method note on masonjbennett.com</a>
        </figcaption>
      </figure>
    </div>
  );
  const how = (
    <p>
      With hindsight, each mix is chosen and scored on the same window, so it already knows what happened. Mason's walk-forward test
      chooses each mix on all earlier years only, holds it through one year it has not seen, then rolls forward. The bars marked
      without hindsight are that test's published figures, quoted as published and never recomputed here.
    </p>
  );
  return (
    <Card id="overview-hindsight" title={h.title} sub={h.sub} numbers={numbers} how={how}>
      <HindsightBars h={h} narrow={phone} />
    </Card>
  );
}

// The figures behind the growth chart: each mix and the benchmark, by plain name with the finance name beside
// it, with the CSV and Excel downloads every table on the page carries.
function WealthTable({ a, amount }: { a: Analysis; amount: number }) {
  const columns: Column[] = [
    { key: "mix", label: "Mix", format: "text", first: true },
    { key: "end", label: `${format(amount, "usd0")} became`, format: "usd0" },
    { key: "mu", label: "Return a year", format: "pct2" },
    { key: "sigma", label: "Volatility", format: "pct2" },
    { key: "sharpe", label: "Sharpe", format: "num3" },
  ];
  const rows = mixRows(a, amount).map((r) => ({ mix: r.technical ? `${r.name} (${r.technical})` : r.name, end: r.end, mu: r.mu, sigma: r.sigma, sharpe: r.sharpe }));
  return <Table title="What each mix became" columns={columns} rows={rows} filename="overview_growth" span={`Daily returns, ${format(a.dates[0], "date")} to ${format(a.asOf, "date")}`} />;
}

function WealthCard({ a, amount }: { a: Analysis; amount: number }) {
  const phone = usePhone();
  // 168 on a phone keeps the whole chart on a 375 x 812 first screen under the longest lede, the one a
  // basket outside the published sets gets with its run button (192 ended 21 px below the fold).
  const height = phone ? 168 : 280;
  const span = `${monthYear(a.prices.dates[0])} to ${monthYear(a.asOf)}`;
  const how = (
    <p>
      Each mix is held at its weights, rebalanced back to them every trading day, and its daily returns are compounded from{" "}
      {format(amount, "usd0")} on the first price day. The best-tradeoff and lowest-risk mixes were chosen knowing the whole
      window's prices, so their lines are hypothetical: nobody could have held them from the start.
    </p>
  );
  return (
    <Card
      id="overview-wealth"
      title={`What ${format(amount, "usd0")} became`}
      sub={`${span}. Two of the mixes were chosen with hindsight.`}
      numbers={<WealthTable a={a} amount={amount} />}
      how={how}
    >
      <Suspense fallback={<ChartNote kind="loading" height={height}>Loading the chart</ChartNote>}>
        <OverviewWealth a={a} amount={amount} height={height} />
      </Suspense>
    </Card>
  );
}

// A sentence that opens on a glossary term: the term, and the punctuation after it kept on the term's line.
// A sentence that does not open on those words is printed as it is.
function Lead({ k, words, sentence }: { k: "hindsight" | "without"; words: string; sentence: string }) {
  if (!sentence.startsWith(words)) return <>{sentence}</>;
  const rest = sentence.slice(words.length);
  const stick = /^[,:;]/.test(rest) ? rest[0] : "";
  return (
    <>
      <span className="ov-nowrap">
        <Term k={k}>{words}</Term>
        {stick}
      </span>
      {rest.slice(stick.length)}
    </>
  );
}

// ---- the page ------------------------------------------------------------------------------------------

export interface OverviewProps {
  analysis: Analysis;
  /** The starting amount (Settings.amount). */
  amount: number;
  level: Level;
  /** Load another basket, as the basket bar would. */
  setTickers: (tickers: string[]) => void;
  /** The figures are the previous settings' while new ones are worked in. */
  settling?: boolean;
}

export default function Overview({ analysis: a, amount, level, setTickers, settling = false }: OverviewProps) {
  const page = useContext(TabContext);
  const l = useMemo(() => lede(a, amount), [a, amount]);
  const facts = useMemo(() => whyFacts(a), [a]);
  const current = l.set?.name ?? null;
  return (
    <div className={settling ? "ov ov--settling" : "ov"} data-overview="">
      <header className="ov-hero">
        <p className="ov-eyebrow">The question</p>
        <h1 className="ov-question">{QUESTION}</h1>
        <p className="ov-lede">
          <Lead k="hindsight" words="With hindsight" sentence={l.hindsight} /> <Lead k="without" words="Without hindsight" sentence={l.without} />
          {l.run && page ? (
            <>
              {" "}
              <button type="button" className="text-button ov-run" onClick={() => page.setTab("walkforward", "basket", true)}>
                Run the same test on this basket
              </button>
            </>
          ) : null}
        </p>
      </header>
      <div className="ov-grid">
        <WealthCard a={a} amount={amount} />
        <HindsightCard a={a} level={level} />
      </div>
      <ul className="ov-why" aria-label="Why">
        {facts.map((f) => (
          <li key={f.big}>
            <b>{f.big}</b>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
      <div className="ov-try" role="group" aria-label="Try another basket">
        <span className="ov-try-label">Try another basket:</span>
        {PUBLISHED_PRESETS.map((p) => (
          <button key={p.name} type="button" className="ov-try-button" aria-pressed={current === p.name} onClick={() => setTickers(parseTickers(p.tickers))}>
            {p.name}
          </button>
        ))}
        <span className="ov-try-or">or type your own tickers above</span>
      </div>
      <p className="ov-built">
        <span>
          Built by {AUTHOR} · {CREDENTIAL}
        </span>
        <a href={SOURCE_URL}>Source code on GitHub</a>
        <a href={PUBLISHED_URL}>Method note</a>
        <a href={GUIDE_HREF}>Guide (optional)</a>
      </p>
    </div>
  );
}

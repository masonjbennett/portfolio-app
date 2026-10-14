// "How to read this page": the guide, as its own page at ?guide (./route.ts), and the source the PDF is exported from
// (scripts/guide-pdf.mjs). Its words are src/content/guide.ts; this file only lays them out.
//
// It renders the same whatever the prices, the settings or the screen: nothing here reads the workbench, the network,
// the browser's storage or the width. That is what lets the PDF's edition (scripts/guide-edition.mjs) be computed from
// this component alone, and lets a printed copy be compared with the page.
//
// The glossary's second half is the page's own info marks, in their Plain words, read from the modules the marks read,
// so the glossary cannot disagree with the mark beside a figure. test/t-guide.mjs holds that list to the marks the page
// renders, both ways.
import { useEffect, type ReactNode } from "react";
import Footer from "../chrome/Footer.tsx";
import Slug from "../components/Slug.tsx";
import { APP_URL, AUTHOR, CREDENTIAL, SITE_URL } from "../content/about.tsx";
import {
  GUIDE_DEK, GUIDE_EVERYWHERE, GUIDE_FIRST_SCREEN, GUIDE_IDEA, GUIDE_MARKS_INTRO, GUIDE_METHOD, GUIDE_PDF, GUIDE_INPUT, GUIDE_INPUT_IDS,
  GUIDE_INPUT_INTRO, GUIDE_INPUT_PHONE, GUIDE_START, GUIDE_TAB_IDS, GUIDE_TABS, GUIDE_TABS_INTRO, GUIDE_TERMS, GUIDE_TITLE, type GuidePart,
} from "../content/guide.ts";
import { INPUT_HEADINGS } from "../content/inputs.ts";
import { SCORE_TIP_NAMES, TIP_NAMES, tipText, type ScoreTipKey } from "../content/tooltips.ts";
import { WALK_TIPS } from "../tabs/walkforward/tips.ts";
import { TAB_LABELS, type TabId, type TipKey } from "../types.ts";
import { GUIDE_HREF } from "./route.ts";
import "./Guide.css";

/** One info mark as the glossary lists it: its key, its name as the mark's label says it, its Plain words. */
export interface MarkEntry {
  key: string;
  name: string;
  text: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The app's texts for three figures this page does not print (its Snapshot showed them; the band's plates are Sharpe
// ratios instead). They stay in tooltips.json, which is a dump of the app, and stay out of the glossary. test/t-guide.mjs
// holds the glossary to the marks the page renders both ways, so a page that starts printing one fails until it is listed.
const NOT_ON_THE_PAGE: readonly TipKey[] = ["tangency_return", "bench_return", "bench_vol"];

/** Every info mark the page can show, in its Plain words, sorted by name: the app's, the scorecard's, the Walk-forward tab's. */
export function markGlossary(): MarkEntry[] {
  const app = (Object.keys(TIP_NAMES) as TipKey[]).filter((k) => !NOT_ON_THE_PAGE.includes(k)).map((k) => ({ key: k, name: TIP_NAMES[k], text: tipText(k, "plain") }));
  const score = (Object.keys(SCORE_TIP_NAMES) as ScoreTipKey[]).map((k) => ({ key: k, name: SCORE_TIP_NAMES[k], text: tipText(k, "plain") }));
  const walk = Object.entries(WALK_TIPS).map(([k, t]) => ({ key: `walk.${k}`, name: t.name, text: t.texts.plain }));
  return [...app, ...score, ...walk].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/** A paragraph of the guide's words, each [[quoted name]] set in bold as the name the page prints. */
export function Marked({ text }: { text: string }): ReactNode {
  return text.split(/\[\[(.+?)\]\]/).map((piece, i) => (i % 2 ? <b key={i} className="guide-ui">{piece}</b> : piece));
}

const Paras = ({ body }: { body: readonly string[] }) => (
  <>
    {body.map((p, i) => (
      <p key={i}>
        <Marked text={p} />
      </p>
    ))}
  </>
);

const headingOf = (h: GuidePart["heading"]) => (typeof h === "string" ? h : h.join(" · "));

// The link that opens a tab of the page, with the reader's own settings. The walk-forward tab opens on its first view.
const tabHref = (id: TabId) => `./?tab=${id}`;

/** The guide's sections, in order, for the contents and for the suite. */
export const GUIDE_SECTIONS: readonly { id: string; title: string }[] = [
  { id: "start", title: "Start here" },
  { id: "idea", title: typeof GUIDE_IDEA.heading === "string" ? GUIDE_IDEA.heading : headingOf(GUIDE_IDEA.heading) },
  { id: "first-screen", title: "The first screen" },
  { id: "settings", title: "The settings" },
  { id: "tabs", title: "The tabs" },
  { id: "everywhere", title: "On every tab" },
  { id: "glossary", title: "Glossary" },
  { id: "method", title: "How the figures are computed" },
];
const title = (id: string) => GUIDE_SECTIONS.find((s) => s.id === id)?.title ?? id;

export default function GuidePage() {
  useEffect(() => {
    const was = document.title;
    document.title = `${GUIDE_TITLE} · Portfolio Analytics`;
    return () => {
      document.title = was;
    };
  }, []);
  const marks = markGlossary();
  return (
    <div className="guide">
      <header className="guide-head">
        <p className="guide-kicker">
          <a href="./">Portfolio Analytics</a>
        </p>
        <h1 className="guide-title">{GUIDE_TITLE}</h1>
        <p className="guide-dek">{GUIDE_DEK}</p>
        <p className="guide-byline">
          <a href={SITE_URL}>{AUTHOR}</a> · {CREDENTIAL}
        </p>
        <p className="guide-actions">
          <a href="./">Back to the page</a>
          <span aria-hidden="true"> · </span>
          <a href={GUIDE_PDF} type="application/pdf">
            This guide as a PDF
          </a>
        </p>
        <p className="guide-printed">
          Printed from <a href={`${APP_URL}${GUIDE_HREF}`}>{`${APP_URL.replace(/^https:\/\//, "")}${GUIDE_HREF}`}</a>, where the page itself is.
        </p>
      </header>

      <nav className="guide-contents" aria-label="Contents">
        <ol>
          {GUIDE_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <main className="guide-body">
        <section id="start" aria-labelledby="start-h">
          <Slug id="start-h">{title("start")}</Slug>
          <Paras body={GUIDE_START} />
        </section>

        <section id="idea" aria-labelledby="idea-h">
          <Slug id="idea-h">{title("idea")}</Slug>
          <Paras body={GUIDE_IDEA.body} />
        </section>

        <section id="first-screen" aria-labelledby="first-screen-h">
          <Slug id="first-screen-h">{title("first-screen")}</Slug>
          {GUIDE_FIRST_SCREEN.map((part) => (
            <div key={headingOf(part.heading)} className="guide-part">
              <h3 className="guide-h3">{headingOf(part.heading)}</h3>
              <Paras body={part.body} />
            </div>
          ))}
        </section>

        <section id="settings" aria-labelledby="settings-h">
          <Slug id="settings-h">{title("settings")}</Slug>
          <Paras body={GUIDE_INPUT_INTRO} />
          <p>
            <Marked text={GUIDE_INPUT_PHONE} />
          </p>
          {GUIDE_INPUT_IDS.map((id) => (
            <div key={id} className="guide-part" data-input={id}>
              <h3 className="guide-h3">{INPUT_HEADINGS[id]}</h3>
              <Paras body={GUIDE_INPUT[id]} />
            </div>
          ))}
        </section>

        <section id="tabs" aria-labelledby="tabs-h">
          <Slug id="tabs-h">{title("tabs")}</Slug>
          <Paras body={GUIDE_TABS_INTRO} />
          {GUIDE_TAB_IDS.map((id) => {
            const tab = GUIDE_TABS[id];
            return (
              <section key={id} id={`tab-${id}`} className="guide-tab" data-tab={id} aria-labelledby={`tab-${id}-h`}>
                <h3 className="guide-h3" id={`tab-${id}-h`}>
                  {TAB_LABELS[id]}
                </h3>
                <p className="guide-question">{tab.question}</p>
                <Paras body={tab.opens} />
                {tab.sections.map((s) => (
                  <div key={headingOf(s.heading)} className="guide-section" data-heading={headingOf(s.heading)}>
                    <h4 className="guide-h4">{headingOf(s.heading)}</h4>
                    <Paras body={s.body} />
                  </div>
                ))}
                <p className="guide-open">
                  <a href={tabHref(id)}>Open {TAB_LABELS[id]}</a>
                </p>
              </section>
            );
          })}
        </section>

        <section id="everywhere" aria-labelledby="everywhere-h">
          <Slug id="everywhere-h">{title("everywhere")}</Slug>
          {GUIDE_EVERYWHERE.map((part) => (
            <div key={headingOf(part.heading)} className="guide-part">
              <h3 className="guide-h3">{headingOf(part.heading)}</h3>
              <Paras body={part.body} />
            </div>
          ))}
        </section>

        <section id="glossary" aria-labelledby="glossary-h">
          <Slug id="glossary-h">{title("glossary")}</Slug>
          <h3 className="guide-h3">Words the page uses</h3>
          <dl className="guide-terms">
            {GUIDE_TERMS.map((t) => (
              <div key={t.term} className="guide-term">
                <dt>{t.term}</dt>
                <dd>{t.text}</dd>
              </div>
            ))}
          </dl>
          <h3 className="guide-h3">What the i marks say</h3>
          <Paras body={GUIDE_MARKS_INTRO} />
          <dl className="guide-terms" data-glossary="marks">
            {marks.map((m) => (
              <div key={m.key} className="guide-term" data-key={m.key}>
                <dt>{cap(m.name)}</dt>
                <dd>{m.text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="method" aria-labelledby="method-h">
          <Slug id="method-h">{title("method")}</Slug>
          <p>
            <Marked text={GUIDE_METHOD} />
          </p>
        </section>
      </main>

      <Footer here="guide" />
    </div>
  );
}

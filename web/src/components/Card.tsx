// A card: one analysis on flat paper inside a hairline. A title that states the finding, an optional
// sub-line, the chart, then two folds, "Show the numbers" and "How it is calculated", and a row of
// downloads. Paragraphs live in the folds, so at rest a card shows a title, one line and a picture.
//
// A fold's contents are drawn the first time it opens and kept after it closes, so a table inside one
// costs nothing until someone asks for it and keeps its scroll and sort when closed and reopened.
import { useId, useState, type ReactNode } from "react";
import "./Card.css";

export interface CardProps {
  /** The finding, as a title (at most fourteen words). */
  title: string;
  /** One line under the title (at most twenty-five words). */
  sub?: ReactNode;
  /** Anchor id, if the card is linkable. */
  id?: string;
  /** The chart, or whatever the card leads with. */
  children?: ReactNode;
  /** The figures behind the chart: the "Show the numbers" fold. Left out, no fold. */
  numbers?: ReactNode;
  /** The method: the "How it is calculated" fold. Left out, no fold. */
  how?: ReactNode;
  /** Download links, under the folds. */
  downloads?: ReactNode;
}

export const FOLD_LABELS = { numbers: "Show the numbers", how: "How it is calculated" } as const;

type FoldKey = keyof typeof FOLD_LABELS;

// One fold's state: open, and whether it has ever been opened (its contents stay drawn after that).
function useFold() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const toggle = () => {
    setOpen(!open);
    setDrawn(true);
  };
  return { id, open, drawn, toggle };
}

export default function Card({ title, sub, id, children, numbers, how, downloads }: CardProps) {
  const headId = useId();
  const numbersFold = useFold();
  const howFold = useFold();
  const folds: [FoldKey, ReturnType<typeof useFold>][] = [];
  if (numbers) folds.push(["numbers", numbersFold]);
  if (how) folds.push(["how", howFold]);
  return (
    <section className="card" id={id} aria-labelledby={headId}>
      <header className="card-head">
        <h3 className="card-title" id={headId}>
          {title}
        </h3>
        {sub ? <p className="card-sub">{sub}</p> : null}
      </header>
      {children ? <div className="card-body">{children}</div> : null}
      {folds.length ? (
        <>
          <div className="card-folds">
            {folds.map(([key, f]) => (
              <button
                key={key}
                type="button"
                className="card-fold-button"
                aria-expanded={f.open}
                aria-controls={f.id}
                onClick={f.toggle}
              >
                {FOLD_LABELS[key]}
              </button>
            ))}
          </div>
          {folds.map(([key, f]) => (
            <div key={key} id={f.id} className="card-fold-body" data-fold={key} hidden={!f.open}>
              {f.drawn ? (key === "numbers" ? numbers : how) : null}
            </div>
          ))}
        </>
      ) : null}
      {downloads ? <div className="card-downloads">{downloads}</div> : null}
    </section>
  );
}

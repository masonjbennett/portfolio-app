// A chapter's More list: one row per further analysis, each a title and its one-line finding, opening
// in place to the full card. Nothing inside a row is drawn until the row first opens, so a chapter
// costs only its lead until someone asks for more.
//
// Which rows are open is remembered for the visit only: it lives in this module, not in storage, so it
// survives a chapter being left and come back to, and a reload starts every list closed, the way every
// load starts on the recruiter's first screen. openMore() opens a row from outside (a palette jump).
import { useId, useSyncExternalStore, type ReactNode } from "react";
import "./MoreList.css";

export interface MoreRow {
  /** Stable key, unique in its list; also the row's anchor, `${list id}-${key}`. */
  key: string;
  /** The row's title (the card's name). */
  title: string;
  /** Its finding, one line (at most twenty words). */
  finding: ReactNode;
  /** The full card, drawn when the row first opens. */
  children: ReactNode;
  /** A line under the row's button, shown open or closed (the formula behind the finding, in its own fold). */
  note?: ReactNode;
  /**
   * For a row whose card is fetched on demand: asks for its code. Called when the reader points at, presses or
   * focuses the row, and on the click that opens it. Null when the code is already here; otherwise a promise that
   * settles once it has arrived or failed, and the row stays shut, marked busy, until then, so it opens on the
   * finished card in one step, never on an empty box that fills a moment later.
   */
  before?: () => Promise<void> | null;
}

export interface MoreListProps {
  /** The list's id, unique on the page: the key its open rows are remembered under. */
  id: string;
  /** The rows, in order. */
  rows: readonly MoreRow[];
  /** The small heading over the rows. */
  heading?: string;
}

// ---- the visit's memory -------------------------------------------------------------------------
// "<list id>/<row key>" -> open. A row in the map was opened at least once, so its card stays drawn.
const opened = new Map<string, boolean>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getVersion = () => version;

/** Opens one row of one list, now or the next time that list is drawn. */
export function openMore(list: string, key: string) {
  opened.set(`${list}/${key}`, true);
  emit();
}

/** Whether a row is open. */
export function isMoreOpen(list: string, key: string): boolean {
  return opened.get(`${list}/${key}`) === true;
}

/** Forgets every row, as a reload does. */
export function forgetMore() {
  opened.clear();
  emit();
}

function toggle(list: string, key: string) {
  opened.set(`${list}/${key}`, !isMoreOpen(list, key));
  emit();
}

// "<list id>/<row key>" of each row whose opening click waits on its code.
const held = new Set<string>();

function press(list: string, row: MoreRow) {
  const k = `${list}/${row.key}`;
  if (held.has(k)) return;
  const wait = !isMoreOpen(list, row.key) && row.before ? row.before() : null;
  if (!wait) return toggle(list, row.key);
  held.add(k);
  emit();
  void wait.then(() => {
    held.delete(k);
    opened.set(k, true);
    emit();
  });
}

export default function MoreList({ id, rows, heading = "More" }: MoreListProps) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const uid = useId();
  const headId = `${uid}-head`;
  return (
    <section className="more" aria-labelledby={headId}>
      <h3 className="more-head" id={headId}>
        {heading}
      </h3>
      {rows.map((row) => {
        const open = isMoreOpen(id, row.key);
        const drawn = opened.has(`${id}/${row.key}`);
        const bodyId = `${uid}-${row.key}`;
        const warm = row.before ? () => void row.before?.() : undefined;
        return (
          <div className="more-row" id={`${id}-${row.key}`} key={row.key} data-open={open ? "" : undefined} aria-busy={held.has(`${id}/${row.key}`) || undefined}>
            <button
              type="button"
              className="more-button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => press(id, row)}
              onPointerEnter={warm}
              onPointerDown={warm}
              onFocus={warm}
            >
              <span className="more-title">{row.title}</span>
              <span className="more-finding">{row.finding}</span>
              <span className="more-chev" aria-hidden="true">
                {open ? "−" : "+"}
              </span>
            </button>
            {row.note ?? null}
            <div className="more-body" id={bodyId} hidden={!open}>
              {drawn ? row.children : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}

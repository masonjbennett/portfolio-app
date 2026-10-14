// A glossary term inside a sentence: the words keep their place in the line, underlined with dots, and
// a tap, a click or Enter opens the plain definition from content/glossary.ts beneath them. It closes on
// a second tap, a tap elsewhere, or Escape; focus stays on the term throughout. A term is a button, so
// Tab reaches it and a screen reader announces it as one that opens something.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { GLOSSARY, type GlossaryEntry, type TermKey } from "../content/glossary.ts";
import "./Term.css";

export interface TermProps {
  /** Which glossary entry. */
  k: TermKey;
  /** The words in the sentence; the entry's own name when left out. */
  children?: ReactNode;
}

export default function Term({ k, children }: TermProps) {
  const entry: GlossaryEntry = GLOSSARY[k];
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    setOpen(false);
  };

  return (
    <span className="term" ref={root} data-open={open ? "" : undefined} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="term-mark"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {children ?? entry.name}
      </button>
      <span id={id} className="term-text" role="note" hidden={!open}>
        <b className="term-name">
          {entry.name}
          {entry.technical ? <span className="term-tech"> ({entry.technical})</span> : null}
        </b>
        {entry.text}
      </span>
    </span>
  );
}

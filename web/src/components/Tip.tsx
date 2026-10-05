// An info mark beside a label that shows one of the app's tooltips at the chosen level: the app's
// `help=tip(key)` (584-587). No text, no mark, as in the app. It opens on hover (a mouse), on focus
// from the keyboard, and on a tap or click, which pins it open until a second tap, a tap elsewhere
// or Escape. Escape also hides a hover or focus showing, until the pointer or focus leaves.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { tipName, tipText } from "../content/tooltips.ts";
import type { TipProps } from "../types.ts";
import "./Tip.css";

// allowShort: the shorting toggle, which changes two Advanced texts (see content/tooltips.ts).
// own: a tab's own tooltip, given whole, which takes the place of `tip`.
export default function Tip({ tip, own, level, allowShort = false }: TipProps) {
  const text = own ? own.texts[level] : tip ? tipText(tip, level, allowShort) : "";
  const name = own ? own.name : tip ? tipName(tip) : "";
  const id = useId();
  const [open, setOpen] = useState(false);
  const [hushed, setHushed] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  if (!text) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    setOpen(false);
    setHushed(true);
  };

  return (
    <span
      className="tip"
      ref={root}
      data-open={open ? "" : undefined}
      data-hushed={hushed ? "" : undefined}
      onKeyDown={onKeyDown}
      onMouseLeave={() => setHushed(false)}
      onBlur={() => setHushed(false)}
    >
      <button
        type="button"
        className="tip-mark"
        aria-label={`About ${name}`}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={id}
        onClick={() => {
          setOpen(!open);
          setHushed(false);
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      <span role="tooltip" id={id} className="tip-text">
        {text}
      </span>
    </span>
  );
}

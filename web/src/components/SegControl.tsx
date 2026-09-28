// A segmented pill row: the six-tab switch and the three-way reading level. It is one row that NEVER
// wraps: on a phone the row scrolls sideways inside its own box, and the selected pill is scrolled
// into view whenever the selection changes, so a six-tab row never grows to two lines and never
// hides the tab the reader is on.
//
// Keyboard: the row is one tab stop (roving tabindex). Left and Right move to the neighbouring
// option, wrapping at the ends, and Home and End jump to the first and last; moving selects, as the
// app's st.tabs and st.radio (1213-1220, 650-656) switch on the first click.
//
// With an idPrefix the row switches panels, so it is a tablist: each pill names the panel it controls
// (tabPanelId) and the page gives the panel it shows that id. Only the selected tab's panel is mounted;
// an unselected tab's aria-controls points at a panel that is not in the page until it is chosen, which
// the tab pattern allows. Without one the row is a choice that controls no panel (the reading level, a
// chart's asset or window), so it is a radio group: the same keys and single tab stop, the choice
// aria-checked. A tablist there would announce "tab 3 of 9" with no panel behind it.
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { SegControlProps } from "../types.ts";
import "./SegControl.css";

// The scrollLeft that brings an item fully into a scrolling row's view, keeping `pad` pixels of the
// neighbour visible; the current scrollLeft when it is already in view. Positions are relative to the
// row's content box (offsetLeft with the row as offsetParent).
export function revealLeft(itemLeft: number, itemWidth: number, scrollLeft: number, viewWidth: number, pad = 24): number {
  if (itemLeft - pad < scrollLeft) return Math.max(0, itemLeft - pad);
  if (itemLeft + itemWidth + pad > scrollLeft + viewWidth) return itemLeft + itemWidth + pad - viewWidth;
  return scrollLeft;
}

// The option a key moves to from index i of n, or null for a key the row does not handle.
export function stepIndex(key: string, i: number, n: number): number | null {
  if (key === "ArrowRight") return (i + 1) % n;
  if (key === "ArrowLeft") return (i - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

// The ids a switching row and its panels share.
export const tabId = (prefix: string, value: string): string => `${prefix}-tab-${value}`;
export const tabPanelId = (prefix: string, value: string): string => `${prefix}-panel-${value}`;

export default function SegControl<T extends string>({ options, value, onChange, ariaLabel, idPrefix }: SegControlProps<T>) {
  const row = useRef<HTMLDivElement>(null);
  const pills = useRef<(HTMLButtonElement | null)[]>([]);
  const active = options.findIndex((o) => o.value === value);
  const tabs = idPrefix !== undefined;

  // Scroll the ROW, never the page: scrollIntoView would also move the window to reach a row that is
  // below the fold when the page loads.
  useEffect(() => {
    const box = row.current;
    const pill = pills.current[active];
    if (!box || !pill) return;
    const next = revealLeft(pill.offsetLeft, pill.offsetWidth, box.scrollLeft, box.clientWidth);
    if (next !== box.scrollLeft) box.scrollLeft = next;
  }, [active]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const from = pills.current.findIndex((p) => p === document.activeElement);
    const to = stepIndex(e.key, from < 0 ? Math.max(active, 0) : from, options.length);
    if (to === null) return;
    e.preventDefault();
    pills.current[to]?.focus();
    if (options[to].value !== value) onChange(options[to].value);
  }

  return (
    <div className="seg" role={tabs ? "tablist" : "radiogroup"} aria-label={ariaLabel} aria-orientation="horizontal" ref={row} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = i === active;
        return (
          <button
            key={o.value}
            ref={(el) => {
              pills.current[i] = el;
            }}
            type="button"
            role={tabs ? "tab" : "radio"}
            id={idPrefix ? tabId(idPrefix, o.value) : undefined}
            aria-controls={idPrefix ? tabPanelId(idPrefix, o.value) : undefined}
            className={on ? "seg-pill is-on" : "seg-pill"}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            // One tab stop: the selected pill, or the first when nothing matches the value.
            tabIndex={on || (active < 0 && i === 0) ? 0 : -1}
            onClick={() => {
              if (o.value !== value) onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

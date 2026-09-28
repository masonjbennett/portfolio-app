// Ctrl+K (Cmd+K on a Mac): a small palette that sets the explanation level or jumps to a tab.
// Type to filter, arrows to move, Enter to pick, Escape to close.
import { useEffect, useId, useState } from "react";
import { LEVELS, TAB_IDS, TAB_LABELS, type Level, type TabId } from "../types.ts";
import "./CommandPalette.css";

export interface CommandPaletteProps {
  level: Level;
  setLevel: (level: Level) => void;
  tab: TabId;
  setTab: (tab: TabId) => void;
}

interface Command {
  key: string;
  group: string;
  label: string;
  current: boolean;
  run: () => void;
}

export default function CommandPalette({ level, setLevel, tab, setTab }: CommandPaletteProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setIndex(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  const commands: Command[] = [
    ...LEVELS.map((l) => ({
      key: `level-${l.id}`,
      group: "Explanation level",
      label: l.label,
      current: l.id === level,
      run: () => setLevel(l.id),
    })),
    ...TAB_IDS.map((t) => ({ key: `tab-${t}`, group: "Tab", label: TAB_LABELS[t], current: t === tab, run: () => setTab(t) })),
  ];
  const q = query.trim().toLowerCase();
  const shown = q ? commands.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(q)) : commands;
  const at = Math.min(index, Math.max(shown.length - 1, 0));

  const pick = (c: Command | undefined) => {
    if (!c) return;
    c.run();
    setOpen(false);
  };

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={shown[at] ? `${id}-${shown[at].key}` : undefined}
          aria-label="Set the explanation level or go to a tab"
          placeholder="Level or tab"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex(Math.min(at + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex(Math.max(at - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(shown[at]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <ul className="palette-list" id={`${id}-list`} role="listbox" aria-label="Commands">
          {shown.length === 0 ? <li className="palette-empty">Nothing matches "{query}".</li> : null}
          {shown.map((c, i) => (
            <li
              key={c.key}
              id={`${id}-${c.key}`}
              role="option"
              aria-selected={i === at}
              className="palette-option"
              onMouseEnter={() => setIndex(i)}
              onClick={() => pick(c)}
            >
              <span className="palette-group">{c.group}</span>
              <span className="palette-label">{c.label}</span>
              {c.current ? <span className="palette-current">current</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

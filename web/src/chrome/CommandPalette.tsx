// Ctrl+K (Cmd+K on a Mac): a small palette that opens a chapter, jumps to a part of one
// (each of the old tabs, inside the chapter that holds it) or opens the guide.
// Type to filter, arrows to move, Enter to pick, Escape to close.
import { useEffect, useId, useState } from "react";
import { GUIDE_HREF, GUIDE_TITLE } from "../guide/route.ts";
import { CHAPTER_IDS, CHAPTER_LABELS, PART_IDS, PART_LABELS, chapterOf, type ChapterId, type PartId } from "../types.ts";
import "./CommandPalette.css";

export interface CommandPaletteProps {
  chapter: ChapterId;
  setChapter: (chapter: ChapterId) => void;
  /** Opens the chapter holding a tab and lands the reader on that tab's part of it. */
  jump: (part: PartId) => void;
  /** Opens the guide; the page goes to its address (a suite passes its own). */
  openGuide?: () => void;
}

interface Command {
  key: string;
  group: string;
  label: string;
  current: boolean;
  run: () => void;
}

const goToGuide = () => window.location.assign(GUIDE_HREF);

export default function CommandPalette({ chapter, setChapter, jump, openGuide = goToGuide }: CommandPaletteProps) {
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
    ...CHAPTER_IDS.map((c) => ({ key: `chapter-${c}`, group: "Chapter", label: CHAPTER_LABELS[c], current: c === chapter, run: () => setChapter(c) })),
    ...PART_IDS.map((t) => ({ key: `tab-${t}`, group: CHAPTER_LABELS[chapterOf(t)], label: PART_LABELS[t], current: false, run: () => jump(t) })),
    { key: "guide", group: "Guide", label: GUIDE_TITLE, current: false, run: openGuide },
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
          aria-label="Go to a chapter or a part of one, or open the guide"
          placeholder="Chapter, part or guide"
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

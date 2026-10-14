// The Overview chapter, for now: the other four chapters, each with the one line that says what it answers and
// a button that opens it. The figures stay in the band above it until the Overview gets its own first screen.
import { CHAPTER_IDS, CHAPTER_LABELS, type ChapterId } from "../types.ts";
import "./ChapterContents.css";

/** What each chapter answers, in one line (the chapter row's label is the button). */
export const CHAPTER_LINES: Readonly<Record<Exclude<ChapterId, "overview">, string>> = {
  performance: "How each fund and each mix grew, and how far they fell on the way.",
  diversification: "Which of the funds moved together, and which did not.",
  build: "The least volatile mix, the best tradeoff and your own, on one chart.",
  holdup: "Whether the mixes chosen on past prices did as well on prices they had not seen.",
};

export interface ChapterContentsProps {
  onOpen: (chapter: ChapterId) => void;
}

export default function ChapterContents({ onOpen }: ChapterContentsProps) {
  return (
    <div className="chapter-contents">
      <h2 className="chapter-contents-h">Four chapters behind the figures above</h2>
      <ol className="chapter-contents-list">
        {CHAPTER_IDS.filter((id): id is Exclude<ChapterId, "overview"> => id !== "overview").map((id) => (
          <li key={id}>
            <button type="button" className="chapter-contents-open" onClick={() => onOpen(id)}>
              {CHAPTER_LABELS[id]}
            </button>
            <span className="chapter-contents-line">{CHAPTER_LINES[id]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

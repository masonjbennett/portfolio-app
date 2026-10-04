// The scorecard's "Add a column" row: one toggle button per construction the reader can set beside the
// default columns. A button is pressed while its column is on the table; a construction this basket or
// window cannot have is a disabled button, and one line under the row says why in plain words.
//
// They are plain buttons with aria-pressed, never role="switch": the shorting switch is the page's one
// switch, and its timing is measured on the first [role=switch] the page has.
import { useId } from "react";
import type { AddedId } from "../lib/constructions.ts";
import "./AddColumns.css";

export interface AddColumnOption {
  id: AddedId;
  /** The words on the button, which are also the column's head. */
  label: string;
  /** True while the column is on the table. */
  on: boolean;
  /** False when this basket or window cannot have the construction (the button is disabled). */
  offered: boolean;
}

export interface AddColumnsProps {
  options: readonly AddColumnOption[];
  onToggle: (id: AddedId) => void;
  /** Why the disabled buttons are disabled, in one short line; null when none is. */
  note: string | null;
}

/** The label the row carries, on the screen and for a screen reader. */
export const ADD_COLUMN = "Add a column";

export default function AddColumns({ options, onToggle, note }: AddColumnsProps) {
  const label = useId();
  const why = useId();
  return (
    <div className="addcol">
      <div className="addcol-row" role="group" aria-labelledby={label} aria-describedby={note ? why : undefined}>
        <span id={label} className="addcol-label">
          {ADD_COLUMN}
        </span>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="addcol-btn"
            data-col={o.id}
            aria-pressed={o.offered && o.on}
            disabled={!o.offered}
            onClick={() => onToggle(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {note ? (
        <p id={why} className="addcol-note">
          {note}
        </p>
      ) : null}
    </div>
  );
}

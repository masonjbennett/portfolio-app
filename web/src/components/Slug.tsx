// A section header: a short teal bar sitting on a full-width hairline, the heading in Instrument
// Serif beneath it. Headers are never boxed; boxes are for stat plates.
import type { SlugProps } from "../types.ts";
import "./Slug.css";

export default function Slug({ children, id }: SlugProps) {
  return (
    <div className="slug">
      <h2 className="slug-text" id={id}>
        {children}
      </h2>
    </div>
  );
}

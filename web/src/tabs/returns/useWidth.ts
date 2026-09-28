// The pixel width of a chart's column, so a chart draws at its real size: text stays legible on a
// phone instead of shrinking with a scaled viewBox. Until the element has been measured (and in a
// surface with no layout, such as a test's jsdom) it answers `fallback`.
import { useEffect, useRef, useState, type RefObject } from "react";

export function useWidth<T extends HTMLElement>(fallback = 720): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

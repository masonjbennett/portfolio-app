// Where the guide lives: this page's own address with ?guide. A query parameter, not a path: web/vercel.json has no
// rewrites, so a /guide path would 404 in production only, while `npm run dev` serves index.html for any path and would
// never show it. src/main.tsx reads it before anything renders, and the guide replaces the page whole, so the page's own
// share link (src/state/useWorkbench.ts), which rewrites the address bar, never runs beside it.
//
// This module is all the page's first chunk carries of the guide; the guide itself is fetched only when it is opened.

/** The guide's title, as its links, its page and the PDF print it. */
export const GUIDE_TITLE = "How to read this page";

/** The link to the guide, relative to the page: the page's address with only ?guide. */
export const GUIDE_HREF = "?guide";

/** True when an address' query asks for the guide: ?guide, with or without a value, beside any other key. */
export function isGuide(search: string): boolean {
  try {
    return new URLSearchParams(search).has("guide");
  } catch {
    return false;
  }
}

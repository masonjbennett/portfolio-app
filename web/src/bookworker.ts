// The Web Worker that builds the scorecard's workbook of formulas, started by src/bookjob.ts on the first click
// and kept for the clicks after it, so SheetJS loads once per page. On its first request it loads SheetJS from
// the same pinned URL the page uses (src/download.ts); on each it rebuilds the scorecard from the plain request
// (src/bookmsg.ts), builds the sheets with the page's own scoreBook, writes the .xlsx, and posts the bytes back
// as a transferable ArrayBuffer, so they move to the page without a copy.
//
// It answers each request once: a book, or a failure in words, never silence. The page builds the book itself
// on a failure, so a worker that cannot reach SheetJS costs the reader a pause, not the file.
import { readRequest, type BookReply } from "./bookmsg.ts";
import { loadSheetJS, writeBook, type BookWriter } from "./download.ts";
import { BOOK_FILENAME, scoreBook } from "./workbook.ts";

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The answer to one message, and what to transfer with it. Never rejects. */
export async function answer(data: unknown, load: () => Promise<BookWriter>): Promise<{ reply: BookReply; transfer: ArrayBuffer[] }> {
  try {
    const input = readRequest(data);
    const XLSX = await load();
    const bytes = writeBook(XLSX, scoreBook(input));
    if (!(bytes instanceof ArrayBuffer)) throw new Error("SheetJS wrote no ArrayBuffer");
    return { reply: { kind: "book", name: BOOK_FILENAME, bytes }, transfer: [bytes] };
  } catch (err) {
    return { reply: { kind: "failed", message: why(err) }, transfer: [] };
  }
}

// The slice of a worker's global scope used here. The page's TypeScript reads the DOM's types, not a
// worker's, so it is spelled out.
export interface Scope {
  onmessage: ((e: MessageEvent) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(message: BookReply, transfer: Transferable[]): void;
}
declare const WorkerGlobalScope: (abstract new () => unknown) | undefined;

/**
 * Wires a worker's scope: each request is answered once through answer(), the book's bytes transferred with
 * it; a reply that cannot be posted is replaced by a failure in words, and a request that cannot be read is
 * answered as a failure. The suite drives it with a scope of its own.
 */
export function install(scope: Scope, load: () => Promise<BookWriter>): void {
  const post = ({ reply, transfer }: { reply: BookReply; transfer: ArrayBuffer[] }) => {
    try {
      scope.postMessage(reply, transfer);
    } catch (err) {
      scope.postMessage({ kind: "failed", message: `the book could not be posted back (${why(err)})` }, []);
    }
  };
  scope.onmessage = (e) => void answer(e.data, load).then(post);
  scope.onmessageerror = () => post({ reply: { kind: "failed", message: "the request could not be read" }, transfer: [] });
}

// Installed only inside a worker, so a suite can import answer() and install() without one.
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) install(self as unknown as Scope, loadSheetJS);

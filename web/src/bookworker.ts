// The Web Worker that builds the scorecard's workbook of formulas, started by src/bookjob.ts on each click. It
// loads SheetJS from the same pinned URL the page uses (src/download.ts), rebuilds the scorecard from the
// plain request (src/bookmsg.ts), builds the sheets with the page's own scoreBook, writes the .xlsx, and posts
// the bytes back as a transferable ArrayBuffer, so they move to the page without a copy.
//
// It always answers once: a book, or a failure in words, never silence. The page builds the book itself on a
// failure, so a worker that cannot reach SheetJS costs the reader a pause, not the file.
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
interface Scope {
  onmessage: ((e: MessageEvent) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(message: BookReply, transfer: Transferable[]): void;
}
declare const WorkerGlobalScope: (abstract new () => unknown) | undefined;

// Installed only inside a worker, so a suite can import answer() without one.
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  const scope = self as unknown as Scope;
  const post = ({ reply, transfer }: { reply: BookReply; transfer: ArrayBuffer[] }) => {
    try {
      scope.postMessage(reply, transfer);
    } catch (err) {
      scope.postMessage({ kind: "failed", message: `the book could not be posted back (${why(err)})` }, []);
    }
  };
  scope.onmessage = (e) => void answer(e.data, loadSheetJS).then(post);
  scope.onmessageerror = () => post({ reply: { kind: "failed", message: "the request could not be read" }, transfer: [] });
}

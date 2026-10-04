// The click on "Download Excel, with formulas" (src/components/Scorecard.tsx), from the request to the saved
// file. The book is tens of thousands of formula cells, and writing it is SheetJS zipping megabytes of XML: on
// the page's own thread that held the page still for over half a second on the five mega-caps and over a
// second at ten tickers with every added column (headless Edge, two long tasks per click). So the book is
// built in a Web Worker (src/bookworker.ts) and the page only saves the bytes it posts back.
//
// The worker is a module worker, which current Chrome, Edge, Safari (15 and later) and Firefox (114 and later)
// all run, and it imports SheetJS from inside itself. Where any of that fails, the page builds the book itself,
// as it did before the worker: a worker that cannot be created, one that errors (its script or SheetJS did not
// load, or the build threw), a reply that cannot be read, or a request that cannot be handed over. Before that
// fallback holds the thread it waits for a frame, so the busy state is on screen first, and the console says
// which of those happened.
//
// One worker per click, ended as soon as it answers. Cancelling (the scorecard unmounts when the reader leaves
// the tab) ends the worker at once and saves nothing, whichever path the build is on.
//
// `seams` are the four things a test replaces: jsdom has no Worker, node cannot load SheetJS from its CDN, a
// test has no frames to wait for, and it must see the file without a browser saving it.
import { loadSheetJS, saveXlsx, writeBook, type BookWriter } from "./download.ts";
import { plainRequest, readReply, type BookSource } from "./bookmsg.ts";
import type { ScoreModel } from "./tabs/optimization/scorecard.ts";

/** How a build ended: the file was handed to the browser, or it was cancelled first. Failures reject. */
export type BookOutcome = "saved" | "cancelled";

export interface BookRun {
  done: Promise<BookOutcome>;
  cancel(): void;
}

// Resolves once the page has had the chance to paint: after the next animation frame and the task behind it.
// A hidden page runs no frames, so a timer stands in after 100 ms.
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 100);
  });
}

export const seams = {
  worker: (): Worker => new Worker(new URL("./bookworker.ts", import.meta.url), { type: "module" }),
  frame: nextFrame,
  sheetjs: loadSheetJS as () => Promise<BookWriter>,
  save: saveXlsx,
};

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Built {
  name: string;
  bytes: ArrayBuffer;
}

/** Builds and saves the book for the scorecard on screen. */
export function startBook(source: BookSource, model: ScoreModel): BookRun {
  let live = true;
  let worker: Worker | null = null;
  // Settles the wait on the worker when the build is cancelled, so `done` resolves instead of hanging.
  let drop: (() => void) | null = null;

  const stop = () => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  };

  // The worker's book, or null when cancelled. Rejects, saying why, on every way the worker can fail.
  const inWorker = () =>
    new Promise<Built | null>((resolve, reject) => {
      drop = () => resolve(null);
      let w: Worker;
      try {
        w = seams.worker();
      } catch (err) {
        reject(new Error(`the worker could not be started (${why(err)})`));
        return;
      }
      worker = w;
      const end = (settle: () => void) => {
        stop();
        drop = null;
        settle();
      };
      w.onmessage = (e: MessageEvent) => {
        const r = readReply(e.data);
        end(() => (r.ok ? resolve({ name: r.name, bytes: r.bytes }) : reject(new Error(r.why))));
      };
      w.onerror = (e: ErrorEvent) => {
        e.preventDefault?.();
        end(() => reject(new Error(`the worker failed (${e.message || "its script did not load"})`)));
      };
      w.onmessageerror = () => end(() => reject(new Error("the worker's reply could not be read")));
      try {
        w.postMessage(plainRequest(source, model));
      } catch (err) {
        end(() => reject(new Error(`the scorecard could not be handed to the worker (${why(err)})`)));
      }
    });

  // The page's own build, as it was before the worker: the same scoreBook and writeBook, on this thread.
  const onPage = async (): Promise<Built | null> => {
    await seams.frame();
    if (!live) return null;
    const [{ scoreBook, BOOK_FILENAME }, XLSX] = await Promise.all([import("./workbook.ts"), seams.sheetjs()]);
    if (!live) return null;
    return { name: BOOK_FILENAME, bytes: writeBook(XLSX, scoreBook({ ...source, model })) };
  };

  const done = (async (): Promise<BookOutcome> => {
    let built: Built | null = null;
    let fellBack = false;
    try {
      built = await inWorker();
    } catch (err) {
      fellBack = true;
      if (live) console.warn(`[scorecard] the workbook with formulas is being built on the page instead, which holds it still for a moment: ${why(err)}`);
    }
    if (!live) return "cancelled";
    if (fellBack) built = await onPage();
    if (!built || !live) return "cancelled";
    seams.save(built.name, built.bytes);
    return "saved";
  })();

  return {
    done,
    cancel() {
      live = false;
      stop();
      drop?.();
      drop = null;
    },
  };
}

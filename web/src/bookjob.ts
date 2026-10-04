// The click on "Download Excel, with formulas" (src/components/Scorecard.tsx), from the request to the saved
// file. The book is tens of thousands of formula cells, and writing it is SheetJS zipping megabytes of XML: on
// the page's own thread that held the page still for about 0.3 s on the five mega-caps and 0.5 to 0.6 s at
// ten tickers with every added column (the production build in headless Edge, two long tasks per click; about
// twice that on the development server). So the book is built in a Web Worker (src/bookworker.ts) and the page
// only saves the bytes it posts back.
//
// The worker is a module worker, which current Chrome, Edge, Safari (15 and later) and Firefox (114 and later)
// all run, and it imports SheetJS from inside itself. Where any of that fails, the page builds the book itself,
// as it did before the worker: a worker that cannot be created, one that errors (its script or SheetJS did not
// load, or the build threw), a reply that cannot be read, or a request that cannot be handed over. Before that
// fallback holds the thread it waits for a frame, so the busy state is on screen first, and the console says
// which of those happened.
//
// One worker per page: started on the first click and kept, idle, once it has answered with a book, so SheetJS
// is fetched and evaluated once per page, as it was when the page built the book itself. Its CDN sends it with
// max-age=0, so a new worker on every click asked the CDN again every time: a CDN that stalled hung the click,
// and a reader gone offline after the first file lost every later one. A worker that fails, misses its deadline
// or is cancelled mid-build is ended, never kept, and the next click starts another. Cancelling (the scorecard
// unmounts when the reader leaves the tab) ends the worker at once and saves nothing, whichever path the build
// is on. A worker with no build under way stays across a tab switch: it holds SheetJS as the page used to, and
// an idle worker takes no time.
//
// Every click ends in a file or the failure line. The worker has `workerMs` (20 s) from the request to its
// answer: SheetJS is about 250 KB as its CDN sends it, and in headless Edge a click took under a second from
// request to file even at ten tickers with every added column, so the margin is for a slow connection or a
// slow phone. Past it the worker is ended and the page builds the book itself. The page's own load of SheetJS and of the
// book's code has `sheetjsMs` (15 s), past which the run rejects and the button shows its failure line.
//
// `seams` are the things a test replaces: jsdom has no Worker, node cannot load SheetJS from its CDN, a test
// has no frames to wait for and cannot wait out a real deadline, and it must see the file without a browser
// saving it.
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
  /** How long the worker has to answer, from the request to its reply. */
  workerMs: 20_000,
  /** How long the page's own build has to load SheetJS and the book's code, on the fallback. */
  sheetjsMs: 15_000,
};

const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
const secs = (ms: number) => `${Math.round(ms / 10) / 100} s`;

// `p`, or a rejection saying `what` did not load, once `ms` have passed with `p` still unsettled. A dynamic
// import cannot be aborted, so a late one is simply never waited for.
function inTime<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not load within ${secs(ms)}`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// The worker kept between builds: idle, with no handler, from its first book until a build takes it again.
// Null before the first click, while a build holds it, and once one has failed or been cancelled.
let kept: Worker | null = null;

/** Ends the idle worker, if one is kept. The page never needs to; the suite does it between cases. */
export function endKeptWorker(): void {
  kept?.terminate();
  kept = null;
}

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

  // Lets go of the worker: its handlers are cleared, and it is kept for the next build when `keep` says it
  // answered with a book and no other worker is kept already; otherwise it is ended.
  const stop = (keep = false) => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    if (keep && !kept) kept = worker;
    else worker.terminate();
    worker = null;
  };

  // The worker's book, or null when cancelled. Rejects, saying why, on every way the worker can fail, and when
  // it has not answered within its deadline.
  const inWorker = () =>
    new Promise<Built | null>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      drop = () => {
        clearTimeout(timer);
        resolve(null);
      };
      let w: Worker;
      if (kept) {
        w = kept;
        kept = null;
      } else {
        try {
          w = seams.worker();
        } catch (err) {
          reject(new Error(`the worker could not be started (${why(err)})`));
          return;
        }
      }
      worker = w;
      const end = (settle: () => void, keep = false) => {
        clearTimeout(timer);
        stop(keep);
        drop = null;
        settle();
      };
      w.onmessage = (e: MessageEvent) => {
        const r = readReply(e.data);
        end(() => (r.ok ? resolve({ name: r.name, bytes: r.bytes }) : reject(new Error(r.why))), r.ok);
      };
      w.onerror = (e: ErrorEvent) => {
        e.preventDefault?.();
        end(() => reject(new Error(`the worker failed (${e.message || "its script did not load"})`)));
      };
      w.onmessageerror = () => end(() => reject(new Error("the worker's reply could not be read")));
      timer = setTimeout(() => end(() => reject(new Error(`the worker did not answer within ${secs(seams.workerMs)}`))), seams.workerMs);
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
    const [{ scoreBook, BOOK_FILENAME }, XLSX] = await inTime(Promise.all([import("./workbook.ts"), seams.sheetjs()]), seams.sheetjsMs, "SheetJS or the book's code");
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
    if (fellBack) {
      try {
        built = await onPage();
      } catch (err) {
        // A load that failed or ran out of time after the tab was left is not a failure anyone will see.
        if (!live) return "cancelled";
        throw err;
      }
    }
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

// A jsdom window as this process's globals, and a client render through react-dom inside act.
//
// ORDER MATTERS: react-dom decides whether it has a DOM once, when it is first evaluated. Import
// this file before anything that loads react-dom (a component, recharts), and load components with
// `await import(...)` after it. This file itself loads react-dom/client only after the window exists.
//
// Safe to import more than once per process: the window is kept on globalThis and reused.
import { JSDOM, VirtualConsole } from "jsdom";

const KEY = Symbol.for("portfolio-web.jsdom");

function define(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// matchMedia answers false to every query unless a suite says otherwise with setMedia.
let mediaAnswer = () => false;
export function setMedia(fn) {
  mediaAnswer = fn;
}

// Uncaught errors jsdom reports: the ones a suite planted (inside expectUncaught) and the rest.
const UNCAUGHT = Symbol.for("portfolio-web.jsdom-uncaught");
const uncaught = (globalThis[UNCAUGHT] ??= { open: 0, stray: [] });

// Runs fn (sync or async) as a planted throw: an uncaught error jsdom reports while it runs is the
// suite's own. React's development build replays every render error through a DOM event, so a card
// a suite breaks on purpose is reported here even though its Boundary catches it. Keep the window
// to the render that breaks: anything it covers is no longer checked.
export function expectUncaught(fn) {
  uncaught.open += 1;
  let async = false;
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      async = true;
      return out.finally(() => (uncaught.open -= 1));
    }
    return out;
  } finally {
    if (!async) uncaught.open -= 1;
  }
}

if (!globalThis[KEY]) {
  // Any other uncaught error fails the suite, with its stack: an event handler or a timer that
  // throws is reported only here, and nothing else in a run would see it.
  const vc = new VirtualConsole();
  vc.forwardTo(console, { jsdomErrors: "none" });
  vc.on("jsdomError", (e) => {
    if (e.type !== "unhandled-exception") return console.warn(`jsdom: ${e.message.split("\n")[0]}`);
    if (!uncaught.open) uncaught.stray.push(e.cause instanceof Error && e.cause.stack ? e.cause.stack : e.message);
  });
  process.on("exit", () => {
    if (!uncaught.stray.length) return;
    for (const s of uncaught.stray) console.log(`  FAIL  uncaught error in the page: ${s.split("\n").slice(0, 4).join("\n        ")}`);
    process.exitCode = 1;
  });
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const win = dom.window;
  define("window", win);
  define("document", win.document);
  define("navigator", win.navigator);
  for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) define(k, win[k]);
  define("HTMLElement", win.HTMLElement);

  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const matchMedia = (media) => ({
    get matches() {
      return !!mediaAnswer(media);
    },
    media,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
  win.ResizeObserver = ResizeObserver;
  win.matchMedia = matchMedia;
  define("ResizeObserver", ResizeObserver);
  define("matchMedia", matchMedia);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis[KEY] = dom;
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

// Mounts `element` into a fresh <div> in document.body and flushes effects. A component that
// throws while rendering makes this throw (the root is unmounted and the div removed first).
export function render(element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(element));
  } catch (err) {
    try {
      act(() => root.unmount());
    } catch {
      // the root may already be torn down
    }
    container.remove();
    throw err;
  }
  return {
    container,
    rerender(next) {
      act(() => root.render(next));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// What a reader sees: the text content with runs of whitespace collapsed to one space.
export function text(node) {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

export { act };

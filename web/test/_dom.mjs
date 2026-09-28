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

if (!globalThis[KEY]) {
  // jsdom's own "uncaught error" reports repeat, as a wall of text, an error React is about to
  // throw anyway (its development build replays render errors through a DOM event). One line each.
  const vc = new VirtualConsole();
  vc.forwardTo(console, { jsdomErrors: "none" });
  vc.on("jsdomError", (e) => console.warn(`jsdom: ${e.message.split("\n")[0]}`));
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

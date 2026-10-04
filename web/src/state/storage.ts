// What this browser remembers: the explanation level and the dollar amount (Prefs), and the last
// settings, in localStorage, never in a URL. The app remembers nothing between visits (its session
// state dies with the tab); the level and the amount are what a returning visitor should not retype.
//
// Every access is in try/catch, the accessor included: private browsing, a full quota and a
// browser with site data blocked all throw, some on merely reading `localStorage`. The page works
// without storage. Every read is shape-checked field by field, so a value of the wrong shape (an
// older build's, or one edited by hand) is treated as absent rather than handed to the page.
import { DEFAULT_AMOUNT, DEFAULT_LEVEL, MIN_AMOUNT } from "./defaults.ts";
import { decodeShare, encodeShare } from "./url.ts";
import { LEVELS } from "../types.ts";
import type { Level, Prefs, ShareSettings } from "../types.ts";

export const PREFS_KEY = "portfolio-web.prefs";
export const SETTINGS_KEY = "portfolio-web.settings";

// Far above any real starting amount, and small enough that every figure scaled by it stays exact.
const MAX_AMOUNT = 1e12;

// Called only inside read() and write(), whose try/catch also covers an accessor that throws.
function store(): Storage | null {
  return globalThis.localStorage ?? null;
}

function read(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    // quota, private browsing, blocked storage: the page carries on without remembering
  }
}

const isLevel = (x: unknown): x is Level => LEVELS.some((l) => l.id === x);
// min_value=100 (724); the app has no maximum.
const isAmount = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= MIN_AMOUNT && x <= MAX_AMOUNT;

// The remembered prefs, or the defaults when storage is empty, blocked or holds a bad shape. Each
// field falls back on its own, so a bad amount does not also forget the level.
export function loadPrefs(): Prefs {
  let v: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(read(PREFS_KEY) ?? "null");
    if (parsed && typeof parsed === "object") v = parsed as Record<string, unknown>;
  } catch {
    // not JSON: absent
  }
  return {
    level: isLevel(v.level) ? v.level : DEFAULT_LEVEL,
    amount: isAmount(v.amount) ? v.amount : DEFAULT_AMOUNT,
  };
}

// Remembers the prefs; a storage failure is swallowed (the page works without it).
export function savePrefs(prefs: Prefs): void {
  write(PREFS_KEY, JSON.stringify({ level: prefs.level, amount: prefs.amount }));
}

// The last settings, stored as a share query string so a stored value passes the same defensive
// decoder a pasted link does. Never the amount (that is Prefs), never a tab, and never the scorecard's
// added columns: the custom weights are not remembered here, and the columns travel with them, in a link.
export function loadSettings(): Partial<ShareSettings> {
  const raw = read(SETTINGS_KEY);
  if (typeof raw !== "string") return {};
  const { cols: _cols, ...settings } = decodeShare(raw).settings;
  return settings;
}

export function saveSettings(settings: ShareSettings): void {
  const { tickers, start, end, rf, benchmark, allowShort } = settings;
  write(SETTINGS_KEY, encodeShare({ settings: { tickers, start, end, rf, benchmark, allowShort }, weights: null, tab: null }));
}

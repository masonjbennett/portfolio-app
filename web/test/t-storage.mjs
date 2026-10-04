// What this browser remembers (src/state/storage.ts): the level and the amount, and the last
// settings. Driven through stub storages: one that works, one whose every call throws, one whose
// accessor itself throws, none at all, and one holding garbage.
import { check, done } from "./_assert.mjs";
import { loadPrefs, loadSettings, PREFS_KEY, savePrefs, saveSettings, SETTINGS_KEY } from "../src/state/storage.ts";
import { DEFAULT_AMOUNT, DEFAULT_LEVEL } from "../src/state/defaults.ts";

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const DEFAULTS = { level: DEFAULT_LEVEL, amount: DEFAULT_AMOUNT };

function memory() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}
function use(get) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get });
}
const full = { tickers: ["VTI", "AGG", "GLD"], start: "2020-01-01", end: "2026-01-02", rf: 0.045, benchmark: "^NDX", allowShort: true };

// ---- a working store ------------------------------------------------------------------------------
const mem = memory();
use(() => mem);
check(eq(loadPrefs(), DEFAULTS), "empty: the defaults", JSON.stringify(loadPrefs()));
savePrefs({ level: "formula", amount: 25000 });
check(eq(loadPrefs(), { level: "formula", amount: 25000 }), "round trip: level and amount");
saveSettings(full);
check(eq(loadSettings(), full), "round trip: the last settings", JSON.stringify(loadSettings()));
saveSettings({ ...full, end: null, rf: null });
const noEnd = loadSettings();
check(!Object.hasOwn(noEnd, "end") && !Object.hasOwn(noEnd, "rf") && noEnd.tickers?.length === 3,
  "round trip: today and the live rate are remembered as themselves, not frozen", JSON.stringify(noEnd));
saveSettings({ ...full, amount: 123457 });
check(!/123457|amount/.test(mem.getItem(SETTINGS_KEY)), "settings: the stored settings never carry the amount", mem.getItem(SETTINGS_KEY));
// The scorecard's added columns travel with the custom weights, in a link, and neither is remembered here.
saveSettings({ ...full, cols: ["tan.1y", "rp"] });
check(!/cols/.test(mem.getItem(SETTINGS_KEY)) && !Object.hasOwn(loadSettings(), "cols"), "settings: the added columns are never written to this browser", mem.getItem(SETTINGS_KEY));
mem.m.set(SETTINGS_KEY, "?tickers=VTI,AGG,GLD&cols=tan.bs,rp");
check(!Object.hasOwn(loadSettings(), "cols") && loadSettings().tickers?.length === 3, "settings: added columns found in storage (an edited value) are not read", JSON.stringify(loadSettings()));
saveSettings(full);
savePrefs({ level: "finance", amount: 30000, extra: "x" });
check(eq(Object.keys(JSON.parse(mem.getItem(PREFS_KEY))).sort(), ["amount", "level"]), "prefs: only the level and the amount are written");

// ---- garbage in the store: treated as absent, field by field -----------------------------------------
const garbage = [
  ["not JSON", "{level: plain", DEFAULTS],
  ["a JSON array", "[1,2]", DEFAULTS],
  ["JSON null", "null", DEFAULTS],
  ["wrong types", '{"level":"expert","amount":"lots"}', DEFAULTS],
  ["a bad amount beside a good level", '{"level":"finance","amount":-5}', { level: "finance", amount: DEFAULT_AMOUNT }],
  ["an amount under the $100 minimum (724)", '{"level":"plain","amount":50}', DEFAULTS],
  ["an absurd amount", '{"level":"formula","amount":1e13}', { level: "formula", amount: DEFAULT_AMOUNT }],
  ["an extra key", '{"level":"finance","amount":25000,"weights":{"A":1}}', { level: "finance", amount: 25000 }],
];
for (const [label, raw, want] of garbage) {
  mem.m.set(PREFS_KEY, raw);
  const got = loadPrefs();
  check(eq(got, want), `garbage: ${label} gives ${JSON.stringify(want)}`, JSON.stringify(got));
}
for (const raw of ['{"tickers":["A","B","C"]}', "?tickers=<b>&rf=abc&bench=EVIL", "\u0000￿"]) {
  mem.m.set(SETTINGS_KEY, raw);
  check(eq(loadSettings(), {}), `garbage: stored settings ${JSON.stringify(raw).slice(0, 30)} are absent`, JSON.stringify(loadSettings()));
}

// ---- a store that fails -------------------------------------------------------------------------------
const boom = () => {
  throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
};
const failing = { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 };
const stores = [
  ["every call throws", () => failing],
  ["the accessor throws (site data blocked)", () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }],
  ["no storage at all", () => undefined],
];
for (const [label, get] of stores) {
  use(get);
  let threw = null;
  let prefs = null;
  let settings = null;
  try {
    savePrefs({ level: "formula", amount: 5000 });
    saveSettings(full);
    prefs = loadPrefs();
    settings = loadSettings();
  } catch (err) {
    threw = err;
  }
  check(threw === null && eq(prefs, DEFAULTS) && eq(settings, {}), `failing store, ${label}: nothing throws and the defaults load`,
    threw ? threw.message : `${JSON.stringify(prefs)} ${JSON.stringify(settings)}`);
}

done("t-storage");

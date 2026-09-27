// Shared assertion helpers. Files prefixed `_` are helpers, not suites.
import { readFileSync } from "node:fs";

let checks = 0;
const failures = [];

export function check(cond, label, detail = "") {
  checks += 1;
  if (!cond) {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

// |a - b| <= rel * |b| + abs. NaN only matches NaN (the app prints `nan` for an undefined ratio).
export function close(a, b, rel, abs = 0) {
  if (b === null || b === undefined) return Number.isNaN(a) || a === null;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  return Math.abs(a - b) <= rel * Math.abs(b) + abs;
}

export function near(label, a, b, rel, abs = 0) {
  check(close(a, b, rel, abs), label, `port ${a} oracle ${b} diff ${Math.abs(a - b).toExponential(2)}`);
}

export function nearAll(label, as, bs, rel, abs = 0) {
  check(as.length === bs.length, `${label}: length`, `${as.length} vs ${bs.length}`);
  let worst = -1;
  let at = -1;
  for (let i = 0; i < bs.length; i++) {
    if (!close(as[i], bs[i], rel, abs)) {
      const d = Math.abs(as[i] - bs[i]);
      if (!(d <= worst)) {
        worst = d;
        at = i;
      }
    }
  }
  check(at < 0, label, at < 0 ? "" : `worst at ${at}: port ${as[at]} oracle ${bs[at]}`);
}

export function maxAbsDiff(a, b) {
  return Math.max(...a.map((x, i) => Math.abs(x - b[i])));
}

export function json(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

export function done(name) {
  console.log(`${name}: ${checks - failures.length}/${checks} passed`);
  if (failures.length) process.exit(1);
}

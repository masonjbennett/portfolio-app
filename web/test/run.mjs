// Runs every test/t-*.mjs, each in its own process. Suites are DISCOVERED, never listed: a suite
// nobody runs looks exactly like a suite that passes.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const suites = readdirSync(dir).filter((f) => /^t-.*\.mjs$/.test(f)).sort();
if (!suites.length) {
  console.log("no suites found");
  process.exit(1);
}
let failed = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [dir + s], { stdio: "inherit" });
  if (r.status !== 0) failed += 1;
}
console.log(`${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);

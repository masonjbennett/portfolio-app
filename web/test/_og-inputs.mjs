// The link-preview image, public/og.png, is a picture of the As published chart: its nine pairs, its heading
// and the words beside its two marks. test/fixtures/og-shot.json records a hash of those inputs and a hash of
// the image shot from them, and t-shell goes red when either no longer matches, so a change to the chart's
// figures or words cannot leave a pasted link showing the old picture. After re-shooting the image, record it:
//
//   node --import ./test/_tsx.mjs test/_og-inputs.mjs --write
//
// It refuses when the inputs moved and the image did not, since then the image was not shot again. The chart's
// drawing (Dumbbell.tsx and its stylesheets) is not hashed: a change there is checked by looking at a new shot.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAIR_MARKS, publishedPairs } from "../src/tabs/walkforward/Published.tsx";
import { PAIR_HEADING } from "../src/tabs/walkforward/terms.ts";

export const RECORD = new URL("./fixtures/og-shot.json", import.meta.url);
export const IMAGE = new URL("../public/og.png", import.meta.url);

const sha = (x) => createHash("sha256").update(x).digest("hex");
export const inputsHash = () => sha(JSON.stringify([publishedPairs(), PAIR_HEADING, PAIR_MARKS]));
export const imageHash = () => (existsSync(IMAGE) ? sha(readFileSync(IMAGE)) : null);
export const record = () => (existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : null);

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url) && process.argv.includes("--write")) {
  const old = record();
  const now = { inputs: inputsHash(), image: imageHash() };
  if (!now.image) {
    console.error("_og-inputs: there is no public/og.png to record");
    process.exit(1);
  }
  if (old && old.inputs !== now.inputs && old.image === now.image) {
    console.error("_og-inputs: the chart's inputs moved and public/og.png did not; shoot the image again first");
    process.exit(1);
  }
  const what = "sha256 of the As published chart's inputs (its pairs, heading and marks) and of public/og.png, shot from them";
  writeFileSync(RECORD, `${JSON.stringify({ what, ...now }, null, 1)}\n`);
  console.log(`_og-inputs: recorded ${now.inputs.slice(0, 12)} / ${now.image.slice(0, 12)}`);
}

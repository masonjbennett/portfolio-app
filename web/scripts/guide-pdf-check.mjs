// What a guide PDF must be before it is written (scripts/guide-pdf.mjs) and while it is committed (test/t-guide.mjs):
// a PDF, small enough to send, exported from the given edition of the guide, its links on the public addresses only,
// and nothing in its readable parts (the title, the producer, the link targets) that names the machine it was made on.
// The page text inside is compressed and is checked where it is made: the guide renders nothing machine-specific.
import { APP_URL, SITE_URL, SOURCE_URL } from "../src/content/about.tsx";
import { pdfEdition, pdfLinks, pdfTitleOf } from "./guide-edition.mjs";

/** Larger than any guide so far by a wide margin; a PDF past it has picked up something it should not have. */
export const MAX_BYTES = 1536 * 1024;

// The addresses a link in the guide may point at: the page itself, the site, the code.
const ALLOWED = [APP_URL, SITE_URL, SOURCE_URL];

// A local address, or a path into a user's home on Windows, macOS or Linux.
const LOCAL = [/localhost/i, /127\.0\.0\.1/, /\[::1\]/, /[A-Za-z]:[\\/]+(Users|Documents and Settings)[\\/]/i, /\/(Users|home)\/[^/\s)]+\//, /AppData/i, /\\Temp\\/i];

/** Every way the PDF falls short, as sentences; empty when it passes. */
export function pdfProblems(buf, edition) {
  const out = [];
  const raw = Buffer.from(buf).toString("latin1");
  if (!raw.startsWith("%PDF-")) out.push("not a PDF (no %PDF- header)");
  if (buf.length > MAX_BYTES) out.push(`${buf.length} bytes, over the ${MAX_BYTES} allowed`);
  const ed = pdfEdition(buf);
  if (ed !== edition) out.push(`its title says edition ${ed ?? "none"} (${JSON.stringify(pdfTitleOf(buf))}), the guide is edition ${edition}`);
  const links = pdfLinks(buf);
  const stray = links.filter((u) => !ALLOWED.some((a) => u === a || u.startsWith(a.endsWith("/") ? a : `${a}/`)));
  if (stray.length) out.push(`links off the public addresses: ${stray.join(", ")}`);
  if (!links.some((u) => u.startsWith(ALLOWED[0]))) out.push("no link back to the page itself");
  for (const re of LOCAL) {
    const m = re.exec(raw);
    if (m) out.push(`a local address or path in its readable parts: ${JSON.stringify(raw.slice(Math.max(0, m.index - 20), m.index + 40))}`);
  }
  return out;
}

// The guide's edition, and how a PDF says which edition it was exported from.
//
// The edition is a hash of the guide page's markup as React renders it (src/guide/GuidePage.tsx, with every word it
// reads: src/content/guide.ts, the tab and rail names, the info marks' texts, the published figures, the footing's
// methodology). Any change to what the guide says, or to where its links go, is a new edition. A change to its
// stylesheet alone is not: re-export by hand after one (npm run guide:pdf -- --force).
//
// scripts/guide-pdf.mjs writes the edition into the PDF's title when it exports, and test/t-guide.mjs reads it back out
// of public/guide.pdf and compares it with this one, so a guide that changed while the PDF did not goes red.
//
// Needs the .tsx loader: node --import ./test/_tsx.mjs (npm test and npm run guide:pdf both pass it).
import { createHash } from "node:crypto";

/** The current guide's edition: twelve hex digits. */
export async function guideEdition() {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: GuidePage } = await import("../src/guide/GuidePage.tsx");
  const html = renderToStaticMarkup(createElement(GuidePage));
  return createHash("sha256").update(html, "utf8").digest("hex").slice(0, 12);
}

/** The title the PDF carries: the guide's own, and its edition. ASCII, so a PDF writes it as a plain string. */
export async function pdfTitle(edition) {
  const { GUIDE_TITLE } = await import("../src/guide/route.ts");
  return `${GUIDE_TITLE}: Portfolio Analytics (edition ${edition})`;
}

// A PDF string object's bytes as text: a literal "(...)" with its escapes, or "<hex>"; UTF-16 when it opens with FE FF.
function pdfString(token) {
  let bytes = [];
  if (token.startsWith("<")) {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  } else {
    const s = token.slice(1, -1);
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c !== "\\") {
        bytes.push(c.charCodeAt(0) & 0xff);
        continue;
      }
      const n = s[++i];
      const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 }[n];
      if (esc !== undefined) bytes.push(esc);
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? "")) oct += s[++i];
        bytes.push(parseInt(oct, 8) & 0xff);
      } else if (n === "\r" || n === "\n") {
        if (n === "\r" && s[i + 1] === "\n") i++;
      } else bytes.push(n.charCodeAt(0) & 0xff);
    }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  return String.fromCharCode(...bytes);
}

/** The PDF's document title (its Info dictionary's /Title), or null when it has none. */
export function pdfTitleOf(buf) {
  const raw = Buffer.from(buf).toString("latin1");
  const m = /\/Title\s*(\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/.exec(raw);
  return m ? pdfString(m[1]) : null;
}

/** The edition a PDF was exported from, read from its title, or null. */
export function pdfEdition(buf) {
  return /\(edition ([0-9a-f]{12})\)/.exec(pdfTitleOf(buf) ?? "")?.[1] ?? null;
}

/** Every link a PDF's annotations point at (their /URI strings). */
export function pdfLinks(buf) {
  const raw = Buffer.from(buf).toString("latin1");
  return [...raw.matchAll(/\/URI\s*(\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/g)].map((m) => pdfString(m[1]));
}

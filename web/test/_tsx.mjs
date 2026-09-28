// Lets a suite import components the way Vite does. test/run.mjs passes this file to every suite
// with --import, so it is registered before the suite's own imports resolve. It installs loader
// hooks (module.register) that
//   - compile .tsx and .jsx through esbuild (automatic JSX runtime, ESM, inline source map);
//   - answer every .css import with an empty module, because a stylesheet has no meaning to Node.
//     That covers @fontsource/* too: its entry points are .css files, so they load empty. The file
//     must still EXIST, so a mistyped path or a font weight the package does not ship fails here as
//     it would fail `vite build`;
//   - try Vite's extension list on a relative import written without one (`./Chart`), since Vite
//     resolves those and Node does not.
// Plain .ts still goes through Node's own type stripping, as it does for the engine suites.
import { register } from "node:module";
import { isMainThread } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// This same file is the hooks module; only the suite's thread registers it, or the loader thread
// that evaluates it would register it again.
if (isMainThread) {
  register(import.meta.url);
  globalThis.__tsxLoader = true;
}

// Vite's default resolve.extensions, in its order (JSON left out: nothing here imports JSON bare).
const PROBE = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx"];
const HAS_EXT = /\.(m?[jt]sx?|css|json)$/;

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND" || !/^\.{1,2}\//.test(specifier) || HAS_EXT.test(specifier)) throw err;
    for (const ext of PROBE) {
      try {
        return await next(specifier + ext, context);
      } catch {
        // try the next extension
      }
    }
    throw err;
  }
}

export async function load(url, context, next) {
  const path = url.split(/[?#]/)[0];
  if (path.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
  if (path.startsWith("file:") && (path.endsWith(".tsx") || path.endsWith(".jsx"))) {
    const { transform } = await import("esbuild");
    const file = fileURLToPath(path);
    const out = await transform(await readFile(file, "utf8"), {
      loader: path.endsWith(".tsx") ? "tsx" : "jsx",
      jsx: "automatic",
      format: "esm",
      sourcemap: "inline",
      sourcefile: file,
      target: "es2022",
    });
    return { format: "module", source: out.code, shortCircuit: true };
  }
  return next(url, context);
}

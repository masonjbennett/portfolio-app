// A component for test/t-shell.mjs: JSX, a type annotation, a stylesheet, a font package, a hook,
// and an extensionless import of the engine, i.e. what a real component in src/ will do.
import { useState } from "react";
import "@fontsource/jetbrains-mono/400.css";
import "./shell-probe.css";
import { MAX_TICKERS } from "../../src/lib/clean";

export function Probe({ label }: { label: string }) {
  const [n] = useState<number>(MAX_TICKERS);
  return <p className="shell-probe">{label}: up to {n} tickers</p>;
}

export function Boom(): never {
  throw new Error("probe render failure");
}

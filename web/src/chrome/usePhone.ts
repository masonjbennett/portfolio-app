// Whether the page is at phone width (760px and under), live: the rail turns into a summary chip
// and a sheet there. One Rail instance at a time, so its drafts and ids are never doubled, which
// hiding a second copy with CSS would do. Server rendering (t-contract) always answers desktop.
import { useSyncExternalStore } from "react";
import { PHONE_QUERY } from "../styles/tokens.ts";

function query(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const mq = query();
  mq?.addEventListener?.("change", onChange);
  return () => mq?.removeEventListener?.("change", onChange);
}

export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  );
}

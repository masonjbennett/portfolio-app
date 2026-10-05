// The ids of the four constructions the scorecard can add (./constructions.ts says what each one is).
//
// They sit in a module of their own, with nothing imported, so code that only needs to name a
// construction (the share link reading a column list, say) can do so without importing the solvers.
// ./constructions.ts re-exports all three, so an import from there keeps working.
export type AddedId = "tan.1y" | "tan.bs" | "tan.cap" | "rp";

/** The added constructions, in the order the scorecard offers them. */
export const ADDED_IDS: readonly AddedId[] = ["tan.1y", "tan.bs", "tan.cap", "rp"];

export function isAddedId(x: string): x is AddedId {
  return (ADDED_IDS as readonly string[]).includes(x);
}

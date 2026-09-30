// A small seeded random number generator, so a redraw on the page and the same redraw in a download
// come out identical. Math.random cannot be seeded, and two calls to it never agree.
//
// The uniform generator is mulberry32: 32 bits of state, one multiply-xorshift round per number,
// period 2^32. That is plenty for a few thousand normals per redraw and is not meant for anything
// cryptographic. Normals come from the Box-Muller transform, two per pair of uniforms.

/** The seed the page and its downloads use unless a caller passes another. Any 32-bit integer works. */
export const DEFAULT_SEED = 2718;

/** Uniform numbers in [0, 1), a fixed sequence for each seed. The seed is taken modulo 2^32. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal numbers (mean 0, variance 1) from a uniform source, by Box-Muller. */
export function normals(uniform: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const z = spare;
      spare = null;
      return z;
    }
    // 1 - u lies in (0, 1], so the logarithm is finite: a uniform of exactly 0 would give -Infinity.
    const r = Math.sqrt(-2 * Math.log(1 - uniform()));
    const theta = 2 * Math.PI * uniform();
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

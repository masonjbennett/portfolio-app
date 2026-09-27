// quadprog ships JavaScript only. Arrays are 1-based (a Fortran port): index 0 is unused.
declare module "quadprog" {
  export function solveQP(
    Dmat: number[][],
    dvec: number[],
    Amat: number[][],
    bvec?: number[],
    meq?: number,
    factorized?: number[],
  ): {
    solution?: number[];
    value?: number[];
    Lagrangian?: number[];
    iterations?: number[];
    iact?: number[];
    message: string;
  };
}

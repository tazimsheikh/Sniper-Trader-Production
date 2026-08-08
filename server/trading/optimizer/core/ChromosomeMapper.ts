export class ChromosomeMapper {
  private grids: any[][];

  constructor(grids: any[][]) {
    this.grids = grids;
  }

  /**
   * Generates a random chromosome (array of indices) matching the grid dimensions.
   */
  randomChromosome(): number[] {
    return this.grids.map((grid) => Math.floor(Math.random() * grid.length));
  }

  /**
   * Maps a chromosome (array of indices) back to a concrete parameter object/tuple.
   */
  mapToParams(chromosome: number[]): any[] {
    return chromosome.map((index, i) => {
      const grid = this.grids[i];
      const boundedIndex = Math.min(Math.max(0, index), grid.length - 1);
      return grid[boundedIndex];
    });
  }

  /**
   * Clamps a chromosome to ensure all genes (indices) are valid for their respective grids.
   */
  clamp(chromosome: number[]): number[] {
    return chromosome.map((gene, i) => {
      return Math.min(Math.max(0, Math.floor(gene)), this.grids[i].length - 1);
    });
  }

  /**
   * Mutates a chromosome by randomly shifting indices up or down, or picking a completely new index.
   */
  mutate(chromosome: number[], mutationRate: number): number[] {
    return chromosome.map((gene, i) => {
      if (Math.random() < mutationRate) {
        const gridLen = this.grids[i].length;
        if (gridLen <= 1) return gene;

        // Either shift by +/- 1/2 or pick a completely new index
        if (Math.random() < 0.5) {
          const shift = Math.random() < 0.5 ? -1 : 1;
          return Math.min(Math.max(0, gene + shift), gridLen - 1);
        } else {
          return Math.floor(Math.random() * gridLen);
        }
      }
      return gene;
    });
  }

  /**
   * Uniform crossover between two chromosomes.
   */
  crossover(parentA: number[], parentB: number[]): [number[], number[]] {
    const childA: number[] = [];
    const childB: number[] = [];

    for (let i = 0; i < parentA.length; i++) {
      if (Math.random() < 0.5) {
        childA.push(parentA[i]);
        childB.push(parentB[i]);
      } else {
        childA.push(parentB[i]);
        childB.push(parentA[i]);
      }
    }

    return [childA, childB];
  }

  /**
   * Gets the total search space size.
   */
  getSearchSpaceSize(): number {
    return this.grids.reduce((acc, grid) => acc * grid.length, 1);
  }
}

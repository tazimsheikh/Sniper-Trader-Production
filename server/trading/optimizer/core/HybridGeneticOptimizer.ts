import { ChromosomeMapper } from "./ChromosomeMapper.js";

export interface FitnessResult {
  totalNetR: number;
  trades: number;
  maxDrawdown: number;
  rawResult: any;
}

export interface GeneticOptimizerOptions {
  populationSize?: number;
  generations?: number;
  mutationRate?: number;
  elitismRatio?: number;
  tournamentSize?: number;
  fitnessFnBatch?: (paramsBatch: any[][]) => Promise<FitnessResult[]>;
  fitnessMode?: 'calmar' | 'blended';
  seedChromosomes?: number[][];
  /** Consecutive generations with <0.01% best-fitness improvement before early exit. Default: 15 */
  stagnationLimit?: number;
}

export class HybridGeneticOptimizer {
  private mapper: ChromosomeMapper;
  private fitnessFn: (params: any[]) => FitnessResult;
  private fitnessFnBatch?: (paramsBatch: any[][]) => Promise<FitnessResult[]>;
  private popSize: number;
  private generations: number;
  private mutationRate: number;
  private elitismRatio: number;
  private tournamentSize: number;
  private fitnessMode: 'calmar' | 'blended';
  private seedChromosomes: number[][];
  private stagnationLimit: number;

  constructor(
    mapper: ChromosomeMapper,
    fitnessFn: (params: any[]) => FitnessResult,
    options: GeneticOptimizerOptions = {}
  ) {
    this.mapper = mapper;
    this.fitnessFn = fitnessFn;
    this.fitnessFnBatch = options.fitnessFnBatch;
    this.popSize = options.populationSize ?? 100;
    this.generations = options.generations ?? 40;
    this.mutationRate = options.mutationRate ?? 0.15;
    this.elitismRatio = options.elitismRatio ?? 0.1;
    this.tournamentSize = options.tournamentSize ?? 2; // Reduced from 4 to 2 to preserve genetic diversity
    this.fitnessMode = options.fitnessMode ?? 'calmar';
    this.seedChromosomes = options.seedChromosomes ?? [];
    this.stagnationLimit = options.stagnationLimit ?? 15;
  }

  /**
   * Calculates the fitness score.
   * Multi-objective optimization combining Calmar Ratio, Trade Count Significance, and Win Rate Floor.
   */
  calculateFitness(res: FitnessResult): number {
    // 1. Base Failure Conditions (Strict Anti-Overfitting Hard Floor)
    if (res.trades < 10 || res.totalNetR <= 0) return 0;
    
    const dd = Math.max(0.1, res.maxDrawdown);
    let baseFitness = 0;
    
    if (this.fitnessMode === 'calmar') {
      baseFitness = res.totalNetR / dd;
    } else {
      const ratio = res.totalNetR / dd;
      baseFitness = res.totalNetR * Math.pow(ratio, 0.3);
    }

    // 2. Statistical Significance Factor (Sqrt scale for smooth scaling above 50 trades)
    let tradePenalty = Math.min(1.5, Math.sqrt(res.trades / 50.0));
    if (res.trades < 50) {
      tradePenalty = res.trades / 50.0;
    }

    // 3. Win Rate Floor Penalty (Target >= 40% Win Rate for prop firm robustness)
    let winRatePenalty = 1.0;
    if (res.rawResult?.winsCount !== undefined && res.trades > 0) {
      const winRate = (res.rawResult.winsCount / res.trades) * 100;
      if (winRate < 40.0) {
        winRatePenalty = Math.pow(winRate / 40.0, 2);
      }
    }

    // 4. Monthly Consistency Factor (if monthly returns available)
    let consistencyFactor = 1.0;
    if (res.rawResult?.monthlyReturns && Array.isArray(res.rawResult.monthlyReturns) && res.rawResult.monthlyReturns.length > 1) {
      const monthly: number[] = res.rawResult.monthlyReturns;
      const mean = monthly.reduce((a, b) => a + b, 0) / monthly.length;
      const variance = monthly.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / monthly.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0 && mean > 0) {
        // Coefficient of variation penalty: lower CV = higher consistency
        const cv = stdDev / mean;
        consistencyFactor = 1 / (1 + Math.min(2.0, cv));
      }
    }
    
    return baseFitness * tradePenalty * winRatePenalty * consistencyFactor;
  }

  /**
   * Runs the Hybrid Genetic Algorithm + Local Grid Search.
   */
  async optimize(numericParamIndices: number[]): Promise<{ params: any[]; result: FitnessResult; fitness: number }[]> {
    let population: number[][] = [];

    // 1. Initialize population (incorporating Smart Seeding)
    // Seeds fill ~12% of Gen 0, each archetype/champion replicated with small perturbations for diversity.
    const seedSlots = Math.max(this.seedChromosomes.length, Math.ceil(this.popSize * 0.12));

    for (let i = 0; i < this.popSize; i++) {
      if (this.seedChromosomes.length > 0 && i < seedSlots) {
        // Rotate through archetypes, lightly perturb copies for diversity
        const archetypeIdx = i % this.seedChromosomes.length;
        const base = [...this.seedChromosomes[archetypeIdx]];
        if (i < this.seedChromosomes.length) {
          // First N slots: exact archetypes, no mutation
          population.push(this.mapper.clamp(base));
        } else {
          // Subsequent slots: apply a mild single-gene perturbation for diversity
          const mutated = this.mapper.mutate(base, 0.10);
          population.push(this.mapper.clamp(mutated));
        }
      } else {
        population.push(this.mapper.randomChromosome());
      }
    }

    let bestCandidates: { chromosome: number[]; fitness: number; result: FitnessResult }[] = [];
    let currentMutationRate = this.mutationRate;

    // 2. GA Generations Loop (with early convergence termination)
    let stagnationCount = 0;
    let prevBestFitness = -Infinity;
    for (let gen = 0; gen < this.generations; gen++) {
      if (gen > 0 && gen % 10 === 0) {
        console.log(`    -> Generation ${gen}/${this.generations} complete (Best Fitness: ${prevBestFitness.toFixed(2)})`);
      }
      
      let evaluated: { chromosome: number[]; fitness: number; result: FitnessResult }[] = [];

      if (this.fitnessFnBatch) {
        const allParams = population.map((chrom) => this.mapper.mapToParams(chrom));
        const results = await this.fitnessFnBatch(allParams);
        evaluated = population.map((chrom, idx) => {
          const res = results[idx];
          const fit = this.calculateFitness(res);
          return { chromosome: chrom, fitness: fit, result: res };
        });
      } else {
        evaluated = population.map((chrom) => {
          const params = this.mapper.mapToParams(chrom);
          const res = this.fitnessFn(params);
          const fit = this.calculateFitness(res);
          return { chromosome: chrom, fitness: fit, result: res };
        });
      }

      // Sort by fitness descending
      evaluated.sort((a, b) => b.fitness - a.fitness);

      // --- ADAPTIVE HYPER-MUTATION ---
      // If the top 3 elites have effectively equal fitness, the population is stagnating.
      // Use epsilon comparison (not ===) since floating-point exact equality is near-impossible.
      if (evaluated.length >= 3 && evaluated[0].fitness > 0 && 
          Math.abs(evaluated[0].fitness - evaluated[1].fitness) < 0.001 && 
          Math.abs(evaluated[1].fitness - evaluated[2].fitness) < 0.001) {
        currentMutationRate = 0.50; // Hyper-mutation!
      } else {
        currentMutationRate = this.mutationRate; // Reset to normal
      }
      // -------------------------------

      // --- EARLY CONVERGENCE TERMINATION ---
      // If the best fitness hasn't improved by >0.01% for stagnationLimit consecutive generations
      // the population has converged — no point running more generations.
      const currentBest = evaluated[0].fitness;
      if (currentBest > 0 && prevBestFitness > 0) {
        const improvement = (currentBest - prevBestFitness) / prevBestFitness;
        if (improvement < 0.0001) {
          stagnationCount++;
          if (stagnationCount >= this.stagnationLimit) {
            bestCandidates = evaluated.slice(0, 10);
            break; // Population has converged — exit early
          }
        } else {
          stagnationCount = 0; // Reset on meaningful improvement
        }
      } else {
        stagnationCount = 0;
      }
      if (currentBest > prevBestFitness) prevBestFitness = currentBest;
      // -----------------------------------------

      // Record best candidates in the population
      bestCandidates = evaluated.slice(0, 10);

      // Elitism: retain top performers directly
      const nextGen: number[][] = [];
      const eliteCount = Math.max(1, Math.floor(this.popSize * this.elitismRatio));
      for (let i = 0; i < eliteCount; i++) {
        nextGen.push(evaluated[i].chromosome);
      }

      // Selection & Reproduction
      while (nextGen.length < this.popSize) {
        const parentA = this.tournamentSelect(evaluated);
        const parentB = this.tournamentSelect(evaluated);

        let [childA, childB] = this.mapper.crossover(parentA, parentB);

        childA = this.mapper.mutate(childA, currentMutationRate);
        childB = this.mapper.mutate(childB, currentMutationRate);

        nextGen.push(this.mapper.clamp(childA));
        if (nextGen.length < this.popSize) {
          nextGen.push(this.mapper.clamp(childB));
        }
      }

      population = nextGen;
    }

    // 3. Exhaustive Local Search around top unique solutions
    const uniqueSolutionsMap = new Map<string, { chromosome: number[]; fitness: number; result: FitnessResult }>();
    for (const cand of bestCandidates) {
      if (cand.fitness <= 0) continue;
      const key = cand.chromosome.join(",");
      if (!uniqueSolutionsMap.has(key)) {
        uniqueSolutionsMap.set(key, cand);
      }
    }

    const uniqueCandidates = Array.from(uniqueSolutionsMap.values()).slice(0, 3); // Refine top 3 pockets
    const refinedResults: { params: any[]; result: FitnessResult; fitness: number }[] = [];

    for (const cand of uniqueCandidates) {
      const refined = await this.localExhaustiveSearch(cand.chromosome, numericParamIndices);
      refinedResults.push(refined);
    }

    // Sort final results by fitness descending
    refinedResults.sort((a, b) => b.fitness - a.fitness);
    return refinedResults;
  }

  private tournamentSelect(evaluated: { chromosome: number[]; fitness: number }[]): number[] {
    let best = evaluated[Math.floor(Math.random() * evaluated.length)];
    for (let i = 1; i < this.tournamentSize; i++) {
      const challenger = evaluated[Math.floor(Math.random() * evaluated.length)];
      if (challenger.fitness > best.fitness) {
        best = challenger;
      }
    }
    return best.chromosome;
  }

  /**
   * Explores the neighborhood of numeric parameter indices.
   */
  private async localExhaustiveSearch(
    centerChrom: number[],
    numericParamIndices: number[]
  ): Promise<{ params: any[]; result: FitnessResult; fitness: number }> {
    let bestChrom = [...centerChrom];
    const bestParams = this.mapper.mapToParams(bestChrom);
    let bestRes = this.fitnessFn(bestParams);
    let bestFit = this.calculateFitness(bestRes);

    const perturbations = numericParamIndices.map(() => [-1, 0, 1]);
    const cartesian = (a: number[][]): number[][] => {
      return a.reduce((b, c) => b.flatMap((d) => c.map((e) => [d, e].flat())), [[]] as number[][]);
    };

    const combinations = cartesian(perturbations);
    const candidateChromosomes = combinations.map((combo) => {
      const candidateChrom = [...centerChrom];
      for (let i = 0; i < numericParamIndices.length; i++) {
        const paramIdx = numericParamIndices[i];
        candidateChrom[paramIdx] = centerChrom[paramIdx] + combo[i];
      }
      return this.mapper.clamp(candidateChrom);
    });

    // Evaluate local grid search
    let results: FitnessResult[] = [];
    if (this.fitnessFnBatch) {
      const paramsBatch = candidateChromosomes.map((chrom) => this.mapper.mapToParams(chrom));
      results = await this.fitnessFnBatch(paramsBatch);
    } else {
      results = candidateChromosomes.map((chrom) => this.fitnessFn(this.mapper.mapToParams(chrom)));
    }

    for (let i = 0; i < candidateChromosomes.length; i++) {
      const res = results[i];
      const fit = this.calculateFitness(res);
      if (fit > bestFit) {
        bestFit = fit;
        bestChrom = candidateChromosomes[i];
        bestRes = res;
      }
    }

    return {
      params: this.mapper.mapToParams(bestChrom),
      result: bestRes,
      fitness: bestFit,
    };
  }
}

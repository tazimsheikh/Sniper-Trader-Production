import { IndependentSynthesisComponent } from "./GrandmasterMetrics.js";

export interface PLWFOWindow {
  index: number;
  isStart: number;
  isEnd: number;
  oosStart: number;
  oosEnd: number;
}

export interface PLWFOResult {
  category: string;
  selectedComponentSetups: string[];
  oosTotalR: number;
  oosMaxDrawdown: number;
  oosSharpe: number;
  compositeOosEquity: number[];
  windowResults: {
    windowIndex: number;
    oosR: number;
    oosDD: number;
    components: string[];
  }[];
}

export function generateRollingWindows(
  totalDays: number,
  numWindows: number = 6,
  isSize: number = 560,
  oosSize: number = 140,
  gap: number = 5
): PLWFOWindow[] {
  const windows: PLWFOWindow[] = [];
  
  if (totalDays < isSize + oosSize + gap) {
    const scale = totalDays / (isSize + oosSize + gap);
    isSize = Math.floor(isSize * scale * 0.9);
    oosSize = Math.floor(oosSize * scale * 0.9);
  }

  const maxSlideArea = totalDays - isSize - gap - oosSize;
  const slideSize = numWindows > 1 ? Math.floor(maxSlideArea / (numWindows - 1)) : 0;

  for (let i = 0; i < numWindows; i++) {
    const isStart = i * slideSize;
    const isEnd = isStart + isSize - 1;
    const oosStart = isEnd + gap;
    const oosEnd = Math.min(totalDays - 1, oosStart + oosSize - 1);
    
    windows.push({
      index: i,
      isStart,
      isEnd,
      oosStart,
      oosEnd
    });
  }

  return windows;
}

function calculatePortfolioMetrics(
  components: IndependentSynthesisComponent[],
  globalDates: string[],
  startIdx: number,
  endIdx: number
) {
  let totalR = 0;
  let peakR = 0;
  let maxDD = 0;
  const numDays = endIdx - startIdx + 1;
  const compositeCurve = new Float64Array(numDays);
  
  let winDays = 0;
  let lossDays = 0;

  for (let d = startIdx; d <= endIdx; d++) {
    let dailyR = 0;
    const dateStr = globalDates[d];
    for (const c of components) {
      dailyR += (c.dailyReturns[dateStr] || 0) * (c.riskPct || 1.0);
    }
    
    totalR += dailyR;
    compositeCurve[d - startIdx] = totalR;
    
    if (totalR > peakR) peakR = totalR;
    const dd = peakR - totalR;
    if (dd > maxDD) maxDD = dd;
    
    if (dailyR > 0) winDays++;
    if (dailyR < 0) lossDays++;
  }
  
  const mean = numDays > 0 ? totalR / numDays : 0;
  let varSum = 0;
  for (let i = 0; i < numDays; i++) {
    const r = i === 0 ? compositeCurve[0] : compositeCurve[i] - compositeCurve[i-1];
    varSum += (r - mean) * (r - mean);
  }
  const stdDev = Math.sqrt(varSum / numDays);
  const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
  
  return { totalR, maxDD, sharpe, compositeCurve };
}

function calculateCorrelationPenalty(
  components: IndependentSynthesisComponent[],
  globalDates: string[],
  startIdx: number,
  endIdx: number
): number {
  if (components.length <= 1) return 1.0;
  const n = components.length;
  let totalCorr = 0;
  let pairs = 0;
  const numDays = endIdx - startIdx + 1;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let sumI = 0, sumJ = 0, sumI2 = 0, sumJ2 = 0, pSum = 0;
      for (let d = startIdx; d <= endIdx; d++) {
        const dateStr = globalDates[d];
        const rI = (components[i].dailyReturns[dateStr] || 0) * (components[i].riskPct || 1.0);
        const rJ = (components[j].dailyReturns[dateStr] || 0) * (components[j].riskPct || 1.0);
        
        sumI += rI;
        sumJ += rJ;
        sumI2 += rI * rI;
        sumJ2 += rJ * rJ;
        pSum += rI * rJ;
      }
      
      const num = pSum - (sumI * sumJ) / numDays;
      const den = Math.sqrt(Math.max(0, sumI2 - (sumI * sumI) / numDays) * Math.max(0, sumJ2 - (sumJ * sumJ) / numDays));
      const corr = den > 0 ? num / den : 0;
      
      totalCorr += Math.abs(corr);
      pairs++;
    }
  }
  
  const avgCorr = pairs > 0 ? totalCorr / pairs : 0;
  return Math.max(0.1, 1.0 - avgCorr);
}

function scorePortfolioIS(
  components: IndependentSynthesisComponent[],
  globalDates: string[],
  window: PLWFOWindow,
  category: string
): number {
  const metrics = calculatePortfolioMetrics(components, globalDates, window.isStart, window.isEnd);
  const corrPenalty = calculateCorrelationPenalty(components, globalDates, window.isStart, window.isEnd);
  
  const returnToDD = metrics.maxDD > 0 ? metrics.totalR / metrics.maxDD : metrics.totalR * 10;
  const pf = 1.5; 
  
  let score = 0;
  if (category.includes("Lowest Max Drawdown")) score = -metrics.maxDD * corrPenalty;
  else if (category.includes("Highest Net Profit")) score = metrics.totalR * corrPenalty;
  else if (category.includes("Most Consistent")) score = metrics.sharpe * corrPenalty;
  else if (category.includes("Highest Win Rate")) score = returnToDD * corrPenalty;
  else if (category.includes("Highest Profit Factor")) score = returnToDD * corrPenalty;
  else if (category.includes("Most Balanced")) score = (returnToDD + metrics.sharpe * 10) * corrPenalty;
  else if (category.includes("Best Risk-Adjusted Return")) score = metrics.sharpe * returnToDD * corrPenalty;
  else if (category.includes("The Ultimate Trifecta")) score = metrics.sharpe * returnToDD * corrPenalty;
  else if (category.includes("The Holy Grail")) score = metrics.sharpe * returnToDD * pf * corrPenalty;
  else score = returnToDD * corrPenalty;
  
  return score;
}

export function runPLWFO(
  grandmasters: IndependentSynthesisComponent[],
  globalDates: string[],
  category: string
): PLWFOResult {
  const totalDays = globalDates.length;
  const windows = generateRollingWindows(totalDays);
  
  const windowResults = [];
  const compositeOosEquity = new Float64Array(totalDays);
  let globalOosR = 0;
  let globalPeakR = 0;
  let globalMaxDD = 0;

  const POPULATION_SIZE = 200;
  const GENERATIONS = 80;
  const MUTATION_RATE = 0.15;
  const MIN_PORTFOLIO_SIZE = 8;
  const MAX_PORTFOLIO_SIZE = 15;

  // Helper to check valid chromosome (unique symbols, valid size)
  const isValidChromosome = (chromo: number[]) => {
    if (chromo.length < MIN_PORTFOLIO_SIZE || chromo.length > MAX_PORTFOLIO_SIZE) return false;
    const symbols = new Set(chromo.map(idx => grandmasters[idx].symbol));
    return symbols.size === chromo.length;
  };

  // Helper to generate a valid random chromosome
  const generateRandomChromosome = () => {
    let chromo: number[] = [];
    const size = Math.floor(Math.random() * (MAX_PORTFOLIO_SIZE - MIN_PORTFOLIO_SIZE + 1)) + MIN_PORTFOLIO_SIZE;
    const available = Array.from({ length: grandmasters.length }, (_, i) => i);
    
    // Shuffle available indices
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }

    for (const idx of available) {
      if (chromo.length >= size) break;
      const testChromo = [...chromo, idx];
      if (new Set(testChromo.map(i => grandmasters[i].symbol)).size === testChromo.length) {
        chromo = testChromo;
      }
    }
    return chromo;
  };

  for (const win of windows) {
    // 1. Initialize population
    let population: { chromo: number[], score: number }[] = [];
    for (let i = 0; i < POPULATION_SIZE; i++) {
      const chromo = generateRandomChromosome();
      population.push({ chromo, score: -Infinity });
    }

    const evalPopulation = () => {
      for (const p of population) {
        if (p.score !== -Infinity) continue;
        const portfolio = p.chromo.map(idx => grandmasters[idx]);
        const metrics = calculatePortfolioMetrics(portfolio, globalDates, win.isStart, win.isEnd);
        if (metrics.totalR <= 0) {
          p.score = -Infinity;
        } else {
          p.score = scorePortfolioIS(portfolio, globalDates, win, category);
        }
      }
    };

    evalPopulation();

    let bestScoreThisWindow = -Infinity;
    let bestPortfolioThisWindow: number[] = [];

    // 2. Evolution Loop
    for (let gen = 1; gen <= GENERATIONS; gen++) {
      // Sort by score
      population.sort((a, b) => b.score - a.score);
      
      if (population[0].score > bestScoreThisWindow) {
        bestScoreThisWindow = population[0].score;
        bestPortfolioThisWindow = [...population[0].chromo];
      }

      if (gen % 20 === 0) {
        console.log(`  🧬 GA Window ${win.index + 1}/6 — Gen ${gen}/${GENERATIONS}: Best IS Score: ${bestScoreThisWindow.toFixed(2)} | Portfolio size: ${bestPortfolioThisWindow.length}`);
      }

      const newPopulation: { chromo: number[], score: number }[] = [];
      
      // Elitism: keep top 10%
      const eliteCount = Math.floor(POPULATION_SIZE * 0.1);
      for (let i = 0; i < eliteCount; i++) {
        newPopulation.push(population[i]);
      }

      // Fill rest with tournament selection, crossover & mutation
      while (newPopulation.length < POPULATION_SIZE) {
        // Tournament selection (size 5)
        const selectParent = () => {
          let best = population[Math.floor(Math.random() * population.length)];
          for (let k = 0; k < 4; k++) {
            const candidate = population[Math.floor(Math.random() * population.length)];
            if (candidate.score > best.score) best = candidate;
          }
          return best;
        };

        const p1 = selectParent().chromo;
        const p2 = selectParent().chromo;

        // Crossover
        let child: number[] = [];
        const pool = Array.from(new Set([...p1, ...p2]));
        for (let i = pool.length - 1; i > 0; i--) {
           const j = Math.floor(Math.random() * (i + 1));
           [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        for (const idx of pool) {
          if (child.length >= MAX_PORTFOLIO_SIZE) break;
          const testChromo = [...child, idx];
          if (new Set(testChromo.map(i => grandmasters[i].symbol)).size === testChromo.length) {
            child = testChromo;
          }
        }
        
        // Pad child if needed due to unique symbol restriction
        while(child.length < MIN_PORTFOLIO_SIZE) {
           const extra = generateRandomChromosome();
           for(const idx of extra) {
               if(child.length >= MIN_PORTFOLIO_SIZE) break;
               const testChromo = [...child, idx];
               if(new Set(testChromo.map(i => grandmasters[i].symbol)).size === testChromo.length) {
                   child = testChromo;
               }
           }
        }

        // Mutation
        if (Math.random() < MUTATION_RATE) {
           const dropIdx = Math.floor(Math.random() * child.length);
           const childCopy = [...child];
           childCopy.splice(dropIdx, 1);
           
           const newGeneIdx = Math.floor(Math.random() * grandmasters.length);
           if (!childCopy.includes(newGeneIdx)) {
              const testChromo = [...childCopy, newGeneIdx];
              if (new Set(testChromo.map(i => grandmasters[i].symbol)).size === testChromo.length) {
                 child = testChromo;
              } else {
                 child = childCopy; // keep deletion if insertion fails
              }
           } else {
              child = childCopy;
           }
           // Re-ensure min size
           while(child.length < MIN_PORTFOLIO_SIZE) {
               const extra = generateRandomChromosome();
               for(const idx of extra) {
                   if(child.length >= MIN_PORTFOLIO_SIZE) break;
                   const testChromo = [...child, idx];
                   if(new Set(testChromo.map(i => grandmasters[i].symbol)).size === testChromo.length) {
                       child = testChromo;
                   }
               }
           }
        }

        newPopulation.push({ chromo: child, score: -Infinity });
      }

      population = newPopulation;
      evalPopulation();
    }
    
    // Fallback if no valid portfolio found (highly unlikely)
    if (bestPortfolioThisWindow.length === 0) {
      bestPortfolioThisWindow = generateRandomChromosome();
    }

    const currentPortfolio = bestPortfolioThisWindow.map(idx => grandmasters[idx]);
    const oosMetrics = calculatePortfolioMetrics(currentPortfolio, globalDates, win.oosStart, win.oosEnd);
    
    for (let d = win.oosStart; d <= win.oosEnd; d++) {
      const idx = d - win.oosStart;
      const dailyRet = idx === 0 ? oosMetrics.compositeCurve[0] : oosMetrics.compositeCurve[idx] - oosMetrics.compositeCurve[idx-1];
      globalOosR += dailyRet;
      compositeOosEquity[d] = globalOosR;
      
      if (globalOosR > globalPeakR) globalPeakR = globalOosR;
      const dd = globalPeakR - globalOosR;
      if (dd > globalMaxDD) globalMaxDD = dd;
    }
    
    windowResults.push({
      windowIndex: win.index,
      oosR: oosMetrics.totalR,
      oosDD: oosMetrics.maxDD,
      components: currentPortfolio.map(p => p.setup)
    });
  }
  
  return {
    category,
    selectedComponentSetups: windowResults[windowResults.length - 1].components,
    oosTotalR: globalOosR,
    oosMaxDrawdown: globalMaxDD,
    oosSharpe: 0,
    compositeOosEquity: Array.from(compositeOosEquity),
    windowResults
  };
}

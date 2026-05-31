import { TradingBot, BotConfig, BotContext, BotSignal, BotTradeState, TradeAction } from './BotInterface.js';
import { PatternHunterCore, RefinedConfig, CoreState } from './PatternHunterCore.js';
import * as path from 'path';
import * as fs from 'fs';

let fleetConfigsCache: any = null;

function loadFleetConfigs() {
    if (fleetConfigsCache) return fleetConfigsCache;
    try {
        const p = path.join(process.cwd(), 'server/config/fleet_configs.json');
        const raw = fs.readFileSync(p, 'utf-8');
        fleetConfigsCache = JSON.parse(raw);
    } catch (e) {
        console.error(`[RefinedSniperBot] Failed to load fleet configs!`);
        fleetConfigsCache = {};
    }
    return fleetConfigsCache;
}

export class RefinedSniperBot extends TradingBot {
  config: RefinedConfig;
  private states: CoreState[] = [];
  private pairConfigs: any[] = [];
  private isFleetMode: boolean = false;

  constructor(baseConfig: BotConfig) {
    super();
    this.config = {
      ...baseConfig,
      optimalParams: baseConfig.config as any
    };

    const allFleets = loadFleetConfigs();
    const symbol = this.config.symbols[0];

    // Find if we have fleet configs for this symbol
    let basePair = symbol;
    for (const p of Object.keys(allFleets)) {
        if (symbol && symbol.includes(p)) {
            basePair = p;
            break;
        }
    }

    if (allFleets[basePair] && Array.isArray(allFleets[basePair])) {
        this.pairConfigs = allFleets[basePair];
        this.isFleetMode = true;
        for (let i = 0; i < this.pairConfigs.length; i++) {
            this.states.push(PatternHunterCore.initializeState());
        }
    } else {
        // Fallback to legacy single state if no fleet config exists
        this.states.push(PatternHunterCore.initializeState());
    }
  }

  clone(): TradingBot {
    return new RefinedSniperBot(this.config);
  }

  async generateSignal(context: BotContext): Promise<BotSignal> {
    if (!this.isFleetMode) {
        // Legacy execution
        const signal = PatternHunterCore.evaluateSignal(context, this.config, this.states[0]);
        if (!signal) return { shouldTrade: false };
        return signal;
    }

    // FLEET MODE: Evaluate all 9 kept configurations simultaneously for this pair
    let buyVotes = 0;
    let sellVotes = 0;
    let totalVotes = 0;
    let validSignals: BotSignal[] = [];

    for (let i = 0; i < this.pairConfigs.length; i++) {
        const cfg = this.pairConfigs[i];
        const state = this.states[i];

        const tempConfig: RefinedConfig = { ...this.config, optimalParams: cfg };
        const signal = PatternHunterCore.evaluateSignal(context, tempConfig, state);
        
        if (signal && signal.shouldTrade) {
            totalVotes++;
            if (signal.direction === 'BUY') buyVotes++;
            if (signal.direction === 'SELL') sellVotes++;
            validSignals.push(signal);
        }
    }

    if (totalVotes === 0) return { shouldTrade: false };

    // CONVICTION ENGINE LOGIC
    if (totalVotes >= 5) {
        console.log(`[${this.config.id}] Anomaly Trapped! ${totalVotes} configs aligned. ABORTING trade to prevent DD.`);
        return { shouldTrade: false }; 
    }

    if (buyVotes === sellVotes) return { shouldTrade: false };

    const finalDirection = buyVotes > sellVotes ? 'BUY' : 'SELL';
    
    let avgSlPips = 0;
    let avgTpPips = 0;
    let dirVotes = 0;
    for (const sig of validSignals) {
        if (sig.direction === finalDirection) {
            dirVotes++;
            avgSlPips += (sig.suggestedSlPips || 0);
            avgTpPips += (sig.suggestedTpPips || 0);
        }
    }
    avgSlPips = dirVotes > 0 ? avgSlPips / dirVotes : 0;
    avgTpPips = dirVotes > 0 ? avgTpPips / dirVotes : 0;

    let convictionMultiplier = 1.0;
    if (Math.abs(buyVotes - sellVotes) >= 3) {
        convictionMultiplier = 1.5; // High conviction, 1.5x risk
    }

    return {
        shouldTrade: true,
        direction: finalDirection,
        reason: `Conviction: ${totalVotes}/9 [RISKx${convictionMultiplier}]`,
        suggestedSlPips: avgSlPips,
        suggestedTpPips: avgTpPips
    };
  }

  async manageTrade(trade: BotTradeState, context: BotContext): Promise<TradeAction> {
    if (!this.isFleetMode) {
        return PatternHunterCore.manageTrade(trade, context, this.config);
    }

    // We use the most conservative (Rank 1 / index 0) config's management rules
    const primaryCfg = this.pairConfigs[0];
    const tempConfig: RefinedConfig = { ...this.config, optimalParams: primaryCfg };
    return PatternHunterCore.manageTrade(trade, context, tempConfig);
  }
}

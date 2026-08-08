import fs from 'fs';
import path from 'path';

const MAGE_DUMP_DIR = path.join(process.cwd(), 'server', 'trading', 'optimizer', 'mage', 'mage_optimizer_dump');
const SAGE_DUMP_DIR = path.join(process.cwd(), 'server', 'trading', 'optimizer', 'sage', 'sage_optimizer_dump');

const PAIRS = [
  'AUDJPY', 'AUDUSD', 'BTCUSD.Daily', 'CADJPY', 'CHFJPY', 'ETHUSD.Daily',
  'EURAUD', 'EURCAD', 'EURJPY', 'EURNZD', 'EURUSD', 'GBPAUD',
  'GBPCAD', 'GBPJPY', 'GBPNZD', 'GBPUSD', 'GER40.Daily', 'JPN225.Daily', 
  'NAS100.Daily', 'NZDUSD', 'SPX500.Daily', 'US30.Daily', 'USDCAD', 
  'USDCHF', 'USDJPY', 'XAUUSD', 'XTIUSD'
];
const SESSIONS = ['london', 'ny', 'asia'];
const BOTS = ['MAGE', 'SAGE'];

function getJsonFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getJsonFiles(filePath));
    } else if (file.endsWith('.json')) {
      results.push(filePath);
    }
  });
  return results;
}

function parseSignature(sig: string): any {
  const config: any = { orbEnabled: true };
  const parts = sig.split('_');

  config.session = parts[0] === 'NY' ? 'ny' : parts[0];

  for (const p of parts) {
    if (p.endsWith('%')) {
      const val = parseFloat(p.replace('%', ''));
      config.orbPullbackPct = val / 100;
      config.entryPenetrationPct = val / 100;
    }
    if (p.startsWith('MinSL')) config.minSlDist = parseFloat(p.replace('MinSL', ''));
    if (p.startsWith('MaxSL')) config.maxSlDist = parseFloat(p.replace('MaxSL', ''));
    if (p.startsWith('Body')) config.minBodyPips = parseFloat(p.replace('Body', ''));
    if (p.startsWith('Sweep')) config.sweepPips = parseFloat(p.replace('Sweep', ''));
    if (p.startsWith('MaxSwp')) config.maxSweepMultiplier = parseFloat(p.replace('MaxSwp', ''));
    if (p.startsWith('ReqCls')) config.requireCloseInside = (p.replace('ReqCls', '') === 'true');
    if (p.startsWith('Exit')) config.exitMode = p.replace('Exit', '');
    if (p.startsWith('Trig')) config.trailingSlTrigger = parseFloat(p.replace('Trig', ''));
    if (p.startsWith('Step')) config.trailingSlStep = parseFloat(p.replace('Step', ''));
    if (p.startsWith('FC')) config.forceCloseHours = parseFloat(p.replace('FC', ''));
    if (p.startsWith('StartH')) config.orbStartHour = parseFloat(p.replace('StartH', ''));
    if (p.startsWith('StartM')) config.orbStartMin = parseFloat(p.replace('StartM', ''));
    if (p.startsWith('OrbMins')) config.orbMinutes = parseFloat(p.replace('OrbMins', ''));
    if (p.startsWith('ActMins')) config.actionMinutes = parseFloat(p.replace('ActMins', ''));
  }
  return config;
}

const allConfigs: any[] = [];

// 1. Parse all configs
for (const bot of BOTS) {
  const dir = bot === 'MAGE' ? MAGE_DUMP_DIR : SAGE_DUMP_DIR;
  const files = getJsonFiles(dir);
  
  for (const file of files) {
    let data: any;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      continue;
    }

    let items: any[] = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (typeof data === 'object') {
      if (Array.isArray(data.validAlphas)) items = data.validAlphas;
      else if (Array.isArray(data.alphas)) items = data.alphas;
      else if (data.setup && data.dailyNetR) items = [data];
    }

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (!item.setup && !item.params && !item.signature) continue;
      
      const setup = item.setup || item.params || item.signature;
      let trades = item.trades || 0;
      let netR = item.totalNetR || item.netR || 0;
      
      if (item.outOfSample && item.inSample) {
         trades = (item.inSample.trades || 0) + (item.outOfSample.trades || 0);
         netR = (item.inSample.netR || 0) + (item.outOfSample.netR || 0);
      }
      
      if (trades < 20 || netR <= 0) continue; 
      
      let configObj = parseSignature(setup);
      configObj.signature = setup;

      if (!configObj.session) {
        if (setup.includes('london')) configObj.session = 'london';
        else if (setup.includes('ny')) configObj.session = 'ny';
        else if (setup.includes('asia')) configObj.session = 'asia';
      }

      const symbolMatch = file.match(/wfa_(.*?)\.json/) || file.match(/state_(.*?)\.json/);
      const symbol = symbolMatch ? symbolMatch[1] : (configObj.symbol || 'UNKNOWN');

      allConfigs.push({
        bot,
        symbol: symbol.replace('.Daily', ''), // normalize
        session: configObj.session || 'london',
        netR,
        trades,
        config: configObj,
        setupStr: setup
      });
    }
  }
}

// 2. Select best config for each matrix slot
const shadowMageConfig: Record<string, any[]> = {};
const shadowSageConfig: Record<string, any[]> = {};

for (const p of PAIRS) {
  const baseSymbol = p.replace('.Daily', '');
  shadowMageConfig[baseSymbol] = [];
  shadowSageConfig[baseSymbol] = [];

  for (const bot of BOTS) {
    for (const session of SESSIONS) {
      const candidates = allConfigs.filter(c => c.bot === bot && c.symbol === baseSymbol && c.session === session);
      candidates.sort((a, b) => b.netR - a.netR);

      let bestCfg: any;
      if (candidates.length > 0) {
        bestCfg = { ...candidates[0].config };
      } else {
        // Fallback dummy config with 0 risk
        bestCfg = {
          session: session,
          orbEnabled: false,
          riskPct: 0,
          dummy: true,
          comment: `No profitable ${bot} ${session} config found`
        };
      }
      
      delete bestCfg.symbol;
      delete bestCfg.bot;
      delete bestCfg.netR;
      delete bestCfg.trades;
      delete bestCfg.dailyNetR;
      delete bestCfg.setup;
      delete bestCfg.params;
      delete bestCfg.signature;
      delete bestCfg.maxDrawdown;

      // Make sure orbStartHour is present even on dummy (TypeScript compliance)
      if (bestCfg.orbStartHour === undefined) {
         bestCfg.orbStartHour = session === 'london' ? 3 : (session === 'ny' ? 9 : 19);
         bestCfg.orbStartMin = session === 'ny' ? 30 : 0;
      }

      bestCfg.signature = `${bot}_SHADOW_${baseSymbol}_${session}`;

      if (bot === 'MAGE') {
        shadowMageConfig[baseSymbol].push(bestCfg);
      } else {
        shadowSageConfig[baseSymbol].push(bestCfg);
      }
    }
  }
}

// 3. Write ShadowPortfolioConfig.ts
let tsOut = `// ============================================================
// EXHAUSTIVE SHADOW PORTFOLIO CONFIGURATION (162 Setups)
// Auto-generated by extract_shadow_portfolio.ts
// ============================================================
import type { PairConfig } from "./types.js";

export const SHADOW_MAGE_CONFIG: Record<string, PairConfig[]> = ${JSON.stringify(shadowMageConfig, null, 2)};

export const SHADOW_SAGE_CONFIG: Record<string, PairConfig[]> = ${JSON.stringify(shadowSageConfig, null, 2)};
`;

const outPath = path.join(process.cwd(), 'server', 'trading', 'config', 'ShadowPortfolioConfig.ts');
fs.writeFileSync(outPath, tsOut);

console.log(`Generated ShadowPortfolioConfig.ts with ${PAIRS.length} pairs (MAGE/SAGE * 3 sessions).`);

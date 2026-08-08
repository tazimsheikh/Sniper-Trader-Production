import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { loadCsv, getLatestDate } from "../backtester/loadCsv.js";
import { aggregateCandles } from "../market/CandleAggregator.js";
import { OPTIMIZER_CONFIG } from "../config/OptimizerPairConfig.js";
import { PairConfig, M1TypedArrays } from "../config/types.js";
import { isNewsForceClose } from "../market/historicalNews.js";
import { isEODSession } from "../market/MathFilters.js";
import { preComputeTriggers as magePreCompute, evaluateExits as mageEval } from "../backtester/math_core/MageMathCore.js";
import { preComputeTriggers as sagePreCompute, evaluateExits as sageEval } from "../backtester/math_core/SageMathCore.js";

const currentFile = typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url);
const OPTIMIZER_DIR = path.join(process.cwd(), "server", "trading", "optimizer");
const CSV_DIR = path.join(process.cwd(), "data", "csv");
const MAGE_DNA_DIR = path.join(OPTIMIZER_DIR, "mage", "dna_bank");
const SAGE_DNA_DIR = path.join(OPTIMIZER_DIR, "sage", "dna_bank");

const LOOKBACK_MONTHS = 6;
const MIN_TRADES = 5;
const MAX_DRAWDOWN = 20.0;

function parseMageConfig(setupStr: string): { session: string; config: PairConfig } | null {
  const m = setupStr.match(/^(\w+)_([\d.]+)%_MinSL([\d.]+)_MaxSL([\d.]+)_Body([\d.]+)_Trig([\d.]+)_Step([\d.]+)_FC(\d+)_StartH(\d+)_StartM(\d+)_OrbMins(\d+)_ActMins(\d+)_Exit(\w+)$/);
  if (!m) return null;
  const [, sSession, sPb, sMinSL, sMaxSL, sBody, sTrig, sStep, sFC, sH, sM, sOrb, sAct, sExit] = m;
  return {
    session: sSession === "NY_Forex" ? "ny" : sSession,
    config: {
      orbEnabled: true,
      orbPullbackPct: parseFloat(sPb) / 100,
      minSlDist: parseFloat(sMinSL),
      maxSlDist: parseFloat(sMaxSL),
      minBodyPips: parseFloat(sBody),
      trailingSlTrigger: parseFloat(sTrig),
      trailingSlStep: parseFloat(sStep),
      forceCloseHours: parseInt(sFC),
      orbStartHour: parseInt(sH),
      orbStartMin: parseInt(sM),
      orbMinutes: parseInt(sOrb),
      actionMinutes: parseInt(sAct),
      exitMode: sExit as any,
    } as PairConfig
  };
}

function parseSageConfig(setupStr: string): { session: string; config: PairConfig } | null {
  const m = setupStr.match(/^(\w+)_([\d.]+)%_MinSL([\d.]+)_MaxSL([\d.]+)_Sweep([\d.]+)_MaxSwp([\d.]+)_ReqCls(true|false)_Exit(\w+)_Trig([\d.]+)_Step([\d.]+)_FC(\d+)_StartH(\d+)_StartM(\d+)_OrbMins(\d+)_ActMins(\d+)(?:_MaxBody([\d.]+))?$/);
  if (!m) return null;
  const [, sSession, sPen, sMinSL, sMaxSL, sSweep, sMaxSwp, sReqCls, sExit, sTrig, sStep, sFC, sH, sM, sOrb, sAct, sMaxBody] = m;
  return {
    session: sSession,
    config: {
      sageEnabled: true,
      entryPenetrationPct: parseFloat(sPen),
      minSlDist: parseFloat(sMinSL),
      maxSlDist: parseFloat(sMaxSL),
      sweepPips: parseFloat(sSweep),
      maxSweepMultiplier: parseFloat(sMaxSwp),
      requireCloseInside: sReqCls === 'true',
      exitMode: sExit as any,
      trailingSlTrigger: parseFloat(sTrig),
      trailingSlStep: parseFloat(sStep),
      forceCloseHours: parseInt(sFC),
      orbStartHour: parseInt(sH),
      orbStartMin: parseInt(sM),
      orbMinutes: parseInt(sOrb),
      actionMinutes: parseInt(sAct),
      maxBodyPips: sMaxBody ? parseFloat(sMaxBody) : 999,
    } as PairConfig
  };
}

if (isMainThread && process.argv[1] === currentFile) {
  const runMaster = async () => {
    console.log(`\n================================================================`);
    console.log(`🧬 DNA Bank Culler (Sanitizing stale Alphas)`);
    console.log(`================================================================`);
    console.log(`Criteria: ${LOOKBACK_MONTHS}-Month Lookback | Min Trades: ${MIN_TRADES} | Max DD: ${MAX_DRAWDOWN}R | Net R > 0`);

    const symbols = new Set<string>();
    if (fs.existsSync(MAGE_DNA_DIR)) {
      fs.readdirSync(MAGE_DNA_DIR).filter(f => f.endsWith('.json')).forEach(f => {
        const m = f.match(/mage_dna_(.+)\.json/);
        if (m) symbols.add(m[1]);
      });
    }
    if (fs.existsSync(SAGE_DNA_DIR)) {
      fs.readdirSync(SAGE_DNA_DIR).filter(f => f.endsWith('.json')).forEach(f => {
        const m = f.match(/sage_dna_(.+)\.json/);
        if (m) symbols.add(m[1]);
      });
    }

    const allPairs = Array.from(symbols).sort();
    let activeWorkers = 0;
    let index = 0;
    let totalPurgedMage = 0;
    let totalPurgedSage = 0;

    return new Promise<void>((resolve) => {
      function spawnNext() {
        if (index >= allPairs.length && activeWorkers === 0) {
          console.log(`\n🎉 DNA Culling Complete!`);
          console.log(`Purged ${totalPurgedMage} Mage setups and ${totalPurgedSage} Sage setups.`);
          resolve();
          return;
        }
        while (activeWorkers < 8 && index < allPairs.length) {
          const symbol = allPairs[index++];
          activeWorkers++;
          const worker = new Worker(currentFile, {
            workerData: { symbol },
            execArgv: process.execArgv,
          });

          worker.on("message", (msg) => {
            if (msg.type === "log") console.log(msg.data);
            if (msg.type === "result") {
              totalPurgedMage += msg.magePurged;
              totalPurgedSage += msg.sagePurged;
            }
          });
          worker.on("error", (err) => {
            console.error(`[CULL WORKER ERROR] on ${symbol}:`, err);
          });
          worker.on("exit", () => {
            activeWorkers--;
            spawnNext();
          });
        }
      }
      spawnNext();
    });
  }
  runMaster().catch(console.error);
} else if (!isMainThread) {
  const runWorker = async () => {
    const { symbol } = workerData;
    const basePair = OPTIMIZER_CONFIG[symbol] ? symbol : (OPTIMIZER_CONFIG[symbol.replace(".Daily", "")] ? symbol.replace(".Daily", "") : symbol + ".Daily");
    const configTemplate = OPTIMIZER_CONFIG[basePair];

    if (!configTemplate) {
      parentPort?.postMessage({ type: "log", data: `[WARN] Skipping ${symbol} - No OPTIMIZER_CONFIG found.` });
      return;
    }

    const csvFiles = fs.readdirSync(CSV_DIR).filter(f => f.startsWith(symbol) && f.endsWith(".csv"));
    if (!csvFiles.length) {
      parentPort?.postMessage({ type: "result", magePurged: 0, sagePurged: 0 });
      return;
    }

    const csvFilePath = path.join(CSV_DIR, csvFiles[0]);
    const endDate = getLatestDate(csvFilePath);
    const startDate = new Date(endDate.getTime());
    startDate.setMonth(startDate.getMonth() - LOOKBACK_MONTHS);

    const m1Rows = await loadCsv(csvFilePath, configTemplate.spread, startDate, endDate);
    const m5Candles = aggregateCandles(m1Rows, 5);

    const m1Length = m1Rows.length;
    const m1Typed = {
      open: new Float64Array(m1Length),
      high: new Float64Array(m1Length),
      low: new Float64Array(m1Length),
      close: new Float64Array(m1Length),
      timestamp: new Float64Array(m1Length),
      estHour: new Int32Array(m1Length),
      minute: new Int32Array(m1Length),
      isEOD_standard: new Uint8Array(m1Length),
      isSessionReset: new Uint8Array(m1Length),
      isMidnightExpiry: new Uint8Array(m1Length),
      isNewsForceClose: new Uint8Array(m1Length),
      length: m1Length,
    } as M1TypedArrays;

    for (let i = 0; i < m1Length; i++) {
      const r = m1Rows[i];
      m1Typed.open[i] = r.open;
      m1Typed.high[i] = r.high;
      m1Typed.low[i] = r.low;
      m1Typed.close[i] = r.close;
      m1Typed.timestamp[i] = r.timestamp;
      
      const h = r.estHour;
      const m = r.minute;
      m1Typed.estHour[i] = h;
      m1Typed.minute[i] = m;
      
      m1Typed.isEOD_standard[i] = isEODSession(h, m) ? 1 : 0;
      if (i > 0) {
        const prevH = m1Rows[i-1].estHour;
        m1Typed.isSessionReset[i] = ((prevH < 17 && h >= 17) || (prevH > h && h >= 17)) ? 1 : 0;
        m1Typed.isMidnightExpiry[i] = (prevH > h && h < 17) ? 1 : 0;
      }
      
      const dateStr = new Date(r.timestamp).toISOString().split('T')[0];
      m1Typed.isNewsForceClose[i] = isNewsForceClose(dateStr, h, m) ? 1 : 0;
    }

    // eslint-disable-next-line
    const isForex = !symbol.includes("US30") && !symbol.includes("NAS") && !symbol.includes("SPX") && !symbol.includes("GER") && !symbol.includes("JPN") && !symbol.includes("XAU") && !symbol.includes("XTI") && !symbol.includes("BTC") && !symbol.includes("ETH");

    let magePurged = 0;
    let sagePurged = 0;

    // Evaluate Mage
    const mageDnaFile = path.join(MAGE_DNA_DIR, `mage_dna_${symbol}.json`);
    if (fs.existsSync(mageDnaFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(mageDnaFile, "utf8"));
        const survivors = [];
        for (const item of raw) {
          const parsed = parseMageConfig(item.setup);
          if (!parsed) continue;
          const { session, config } = parsed;
          const triggers = magePreCompute(
            m5Candles,
            m1Rows,
            symbol,
            configTemplate.spread * configTemplate.pipSize,
            session,
            isForex,
            configTemplate.pipSize,
            config.orbStartHour!,
            config.orbStartMin!,
            config.orbMinutes!,
            config.actionMinutes!,
            config.minBodyPips!
          );
          const res = mageEval(m1Typed, m5Candles, triggers, symbol, config, session, isForex);
          
          let peak = 0, runningR = 0, maxDD = 0;
          for (const date of Object.keys(res.dailyNetR)) {
            runningR += res.dailyNetR[date];
            if (runningR > peak) peak = runningR;
            const dd = peak - runningR;
            if (dd > maxDD) maxDD = dd;
          }

          if (res.totalNetR > 0 && res.trades >= MIN_TRADES && maxDD <= MAX_DRAWDOWN) {
            survivors.push(item);
          }
        }
        magePurged = raw.length - survivors.length;
        if (magePurged > 0) {
          fs.writeFileSync(mageDnaFile, JSON.stringify(survivors, null, 2), "utf8");
          parentPort?.postMessage({ type: "log", data: `[MAGE] ${symbol} purged ${magePurged}/${raw.length} stale setups.` });
        }
      } catch (e: any) {
        parentPort?.postMessage({ type: "log", data: `[MAGE ERROR] ${symbol}: ${e.message}` });
      }
    }

    // Evaluate Sage
    const sageDnaFile = path.join(SAGE_DNA_DIR, `sage_dna_${symbol}.json`);
    if (fs.existsSync(sageDnaFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(sageDnaFile, "utf8"));
        const survivors = [];
        for (const item of raw) {
          const parsed = parseSageConfig(item.setup);
          if (!parsed) continue;
          const { session, config } = parsed;
          const triggers = sagePreCompute(
            m5Candles,
            m1Rows,
            symbol,
            configTemplate.spread * configTemplate.pipSize,
            session,
            isForex,
            configTemplate.pipSize,
            config.orbStartHour!,
            config.orbStartMin!,
            config.orbMinutes!,
            config.sweepPips!,
            config.actionMinutes!,
            config.maxSweepMultiplier!,
            config.requireCloseInside!
          );
          const res = sageEval(m1Typed, m5Candles, triggers, symbol, config, session, isForex);
          
          let peak = 0, runningR = 0, maxDD = 0;
          for (const date of Object.keys(res.dailyNetR)) {
            runningR += res.dailyNetR[date];
            if (runningR > peak) peak = runningR;
            const dd = peak - runningR;
            if (dd > maxDD) maxDD = dd;
          }

          if (res.totalNetR > 0 && res.trades >= MIN_TRADES && maxDD <= MAX_DRAWDOWN) {
            survivors.push(item);
          }
        }
        sagePurged = raw.length - survivors.length;
        if (sagePurged > 0) {
          fs.writeFileSync(sageDnaFile, JSON.stringify(survivors, null, 2), "utf8");
          parentPort?.postMessage({ type: "log", data: `[SAGE] ${symbol} purged ${sagePurged}/${raw.length} stale setups.` });
        }
      } catch (e: any) {
        parentPort?.postMessage({ type: "log", data: `[SAGE ERROR] ${symbol}: ${e.message}` });
      }
    }

    parentPort?.postMessage({ type: "result", magePurged, sagePurged });
  };
  runWorker().catch(e => {
    parentPort?.postMessage({ type: "log", data: `[WORKER ERROR] ${workerData.symbol}: ${e.message}` });
  });
}

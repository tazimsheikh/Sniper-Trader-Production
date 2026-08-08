import { PairConfigManager } from "../config/PairConfig.js";
import { _runMageBotForConfig, evaluateMageTrailingOnTick } from "./MageEngine.js";
import { _runSageBotForConfig, evaluateSageTrailingOnTick } from "./SageEngine.js";

export async function evaluateBlackSwanTrailingOnTick(
  orch: any,
  sessionPair: string,
  state: any,
  tick: any
) {
  // Pass "blackswan" as the targetBotId so Mage and Sage trailing logic only processes Black Swan trades.
  await evaluateMageTrailingOnTick(orch, sessionPair, state, tick, "blackswan");
  await evaluateSageTrailingOnTick(orch, sessionPair, state, tick, "blackswan");
}

export async function runBlackSwanSageBot(orch: any, symbol: string, state: any, m1Tick: any) {
  const bsConfigs = PairConfigManager.getBlackSwanConfigs(symbol);
  if (!bsConfigs || bsConfigs.length === 0) return;

  let cfgIdx = 0;
  for (const config of bsConfigs) {
    const sig = config.signature || `default_${cfgIdx}`;
    const isSageSetup = config.signature?.toUpperCase().includes("SAGE") || config.reversalEnabled === true;

    if (isSageSetup) {
      await _runSageBotForConfig(orch, symbol, state, m1Tick, sig, config, "blackswan");
    }
    cfgIdx++;
  }
}

export async function runBlackSwanMageBot(orch: any, symbol: string, state: any, c: any) {
  const bsConfigs = PairConfigManager.getBlackSwanConfigs(symbol);
  if (!bsConfigs || bsConfigs.length === 0) return;

  let cfgIdx = 0;
  for (const config of bsConfigs) {
    const sig = config.signature || `default_${cfgIdx}`;
    const isSageSetup = config.signature?.toUpperCase().includes("SAGE") || config.reversalEnabled === true;

    if (!isSageSetup) {
      await _runMageBotForConfig(orch, symbol, state, c, sig, config, "blackswan");
    }
    cfgIdx++;
  }
}

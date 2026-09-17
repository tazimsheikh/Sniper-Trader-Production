import { OPTIMIZER_CONFIG } from "../../../config/OptimizerPairConfig.js";
import { PairConfig } from "../../../config/PairConfig.js";
export default function paramsToConfig(setupStr: string, pair: string): PairConfig {
  const base = pair.replace(/\.daily$/i, "").toUpperCase();
  const optConfig = OPTIMIZER_CONFIG[pair] || OPTIMIZER_CONFIG[base] || { spread: 2.0, pipSize: 0.0001, tickSize: 0.00001 };

  // Modern Format: {session}_Body{minBody}_Wick{wickRatio}_MinSL{minSl}_MaxSL{maxSl}_Trig{trailTrig}_Step{trailStep}_FC{fcHours}_Exit{exitMode}(_VetoH1{true|false})?
  const modernMatch = setupStr.match(/^(\w+)_Body([\d.]+)_Wick([\d.]+)_MinSL([\d.]+)_MaxSL([\d.]+)_Trig([\d.]+)_Step([\d.]+)_FC(\d+)_Exit(\w+)(?:_VetoH1(true|false))?$/);
  if (modernMatch) {
    const [, sSession, sBody, sWick, sMinSL, sMaxSL, sTrig, sStep, sFC, sExit, sVetoH1] = modernMatch;
    const trigVal = parseFloat(sTrig);
    const stepVal = parseFloat(sStep);
    const session = (sSession === "NY_Forex" ? "ny" : sSession) as any;

    return {
      session,
      minBodyPips: parseFloat(sBody),
      pinBarWickBodyRatio: parseFloat(sWick),
      minSlDist: parseFloat(sMinSL),
      maxSlDist: parseFloat(sMaxSL),
      trailingSlTrigger: trigVal > 0 ? trigVal : undefined,
      trailingSlStep: stepVal > 0 ? stepVal : undefined,
      forceCloseHours: parseInt(sFC, 10),
      exitMode: sExit as any,
      vetoCounterH1Structure: sVetoH1 !== undefined ? sVetoH1 === "true" : undefined,
      spread: optConfig.spread,
      pipSize: optConfig.pipSize,
      tickSize: optConfig.tickSize,
    };
  }

  // Key-Value Legacy Format:
  const getNum = (label: string, alias?: string) => {
    let match = setupStr.match(new RegExp(`${label}=([\\d\\.]+)`));
    if (!match && alias) match = setupStr.match(new RegExp(`${alias}([\\d\\.]+)`));
    return match ? parseFloat(match[1]) : 0;
  };

  const getStr = (label: string) => {
    const match = setupStr.match(new RegExp(`${label}=([^=]+)(?:_|$)`));
    if (match) {
      if (label === 'session') {
        const sessMatch = setupStr.match(/session=(london|NY_Forex|asia|ny)/);
        return sessMatch ? sessMatch[1] : match[1];
      }
      return match[1].split("_")[0];
    }
    return "london";
  };

  const minBodyPips = getNum("minBodyPips", "Body");
  const pinBarWickBodyRatio = getNum("wickRatio", "Wick");
  const minSlDist = getNum("minSlDist", "MinSL");
  const maxSlDist = getNum("maxSlDist", "MaxSL");
  const trailingSlTrigger = getNum("trailingTrig", "Trig");
  const trailingSlStep = getNum("trailingStep", "Step");
  const forceCloseHours = getNum("forceClose", "FC");
  const session = getStr("session") as any;

  return {
    session,
    sessions: [session],
    minBodyPips: minBodyPips > 0 ? minBodyPips : 4,
    pinBarWickBodyRatio: pinBarWickBodyRatio > 0 ? pinBarWickBodyRatio : 1.5,
    minSlDist: minSlDist > 0 ? minSlDist : 15,
    maxSlDist: maxSlDist > 0 ? maxSlDist : 50,
    trailingSlTrigger: trailingSlTrigger > 0 ? trailingSlTrigger : undefined,
    trailingSlStep: trailingSlStep > 0 ? trailingSlStep : undefined,
    forceCloseHours: forceCloseHours > 0 ? forceCloseHours : 24,
    exitMode: setupStr.includes("ExitFIXED_R") ? "FIXED_R" : "TRAILING",
    spread: optConfig.spread,
    pipSize: optConfig.pipSize,
    tickSize: optConfig.tickSize,
  };
}

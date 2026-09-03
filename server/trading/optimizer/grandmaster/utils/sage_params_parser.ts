import { OPTIMIZER_CONFIG } from "../../../config/OptimizerPairConfig.js";

export default function parseSageConfig(setupStr: string, pair: string) {
    const m = setupStr.match(
        /^(\w+)_([\d.]+)%_MinSL([\d.]+)_MaxSL([\d.]+)_Sweep([\d.]+)_MaxSwp([\d.]+)_ReqCls(true|false)_Exit(\w+)_Trig([\d.]+)_Step([\d.]+)_FC(\d+)_StartH(\d+)_StartM(\d+)_OrbMins(\d+)_ActMins(\d+)(?:_MaxBody([\d.]+))?$/
    );
    if (!m) return null;

    const [, session, pen, minSl, maxSl, sweep, maxSwp, reqCls, exit, trig, step, fc, sh, sm, orb, act, maxBody] = m;
    const optConfig = OPTIMIZER_CONFIG[pair.replace(".Daily", "")] || { spread: 2.0, pipSize: 0.001 };
    
    return {
        session,
        orbEnabled: true,
        orbStartHour: parseInt(sh),
        orbStartMin: parseInt(sm),
        orbMinutes: parseInt(orb),
        actionMinutes: parseInt(act),
        minSlDist: parseFloat(minSl),
        maxSlDist: parseFloat(maxSl),
        sweepPips: parseFloat(sweep),
        maxSweepMultiplier: parseFloat(maxSwp),
        requireCloseInside: reqCls === "true",
        maxBodyPips: maxBody ? parseFloat(maxBody) : undefined,
        entryPenetrationPct: parseFloat(pen) / 100,
        exitMode: exit,
        trailingSlTrigger: parseFloat(trig),
        trailingSlStep: parseFloat(step),
        forceCloseHours: parseInt(fc),
        spread: optConfig.spread,
        pipSize: optConfig.pipSize
    };
}

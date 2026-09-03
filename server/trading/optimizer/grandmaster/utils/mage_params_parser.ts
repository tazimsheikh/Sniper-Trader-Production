import { OPTIMIZER_CONFIG } from "../../../config/OptimizerPairConfig.js";

export default function parseMageConfig(setupStr: string, pair: string) {
    const m = setupStr.match(
        /^(\w+)_([\d.]+)%_MinSL([\d.]+)_MaxSL([\d.]+)_Body([\d.]+)_Trig([\d.]+)_Step([\d.]+)_FC(\d+)_StartH(\d+)_StartM(\d+)_OrbMins(\d+)_ActMins(\d+)_Exit(\w+)$/
    );
    if (!m) return null;

    const [, session, pb, minSl, maxSl, body, trig, step, fc, sh, sm, orb, act, exit] = m;
    
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
        minBodyPips: parseFloat(body),
        orbPullbackPct: parseFloat(pb) / 100,
        exitMode: exit,
        trailingSlTrigger: parseFloat(trig),
        trailingSlStep: parseFloat(step),
        forceCloseHours: parseInt(fc),
        spread: optConfig.spread,
        pipSize: optConfig.pipSize
    };
}

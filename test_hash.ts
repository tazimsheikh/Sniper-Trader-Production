import { PairConfigManager } from './server/trading/config/PairConfig.js';
import { getShortHash } from './server/core/crypto.js';

const configs = PairConfigManager.getMageConfigs('NAS100');
configs.forEach(c => {
    console.log(getShortHash(c.signature), "->", "orbStartHour:", c.orbStartHour, "orbMinutes:", c.orbMinutes);
});

import { PairConfigManager } from './server/trading/config/PairConfig.js';
const configs = PairConfigManager.getMageConfigs('NAS100');
console.log(JSON.stringify(configs, null, 2));

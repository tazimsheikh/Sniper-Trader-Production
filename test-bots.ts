import { BOT_REGISTRY, ALL_BOT_CONFIGS } from './server/botManager.js'; 
console.log('Registry Keys:', Object.keys(BOT_REGISTRY)); 
console.log('Contains undefined?', Object.values(BOT_REGISTRY).includes(undefined)); 
console.log('Configs length:', ALL_BOT_CONFIGS.length);

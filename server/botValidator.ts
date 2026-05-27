import { BOT_REGISTRY } from './botManager.js';
import { BotContext } from './bots/BotInterface.js';

export async function validateAllBots(): Promise<void> {
  const bots = Object.values(BOT_REGISTRY);
  console.log(`[Validator] Auditing ${bots.length} trading bots...`);
  
  let errors = 0;

  for (const bot of bots) {
    const config = bot.config;
    const name = config.name;
    const symbol = config.symbols[0]; // Assuming 1 symbol per bot
    
    // 1. Symbol Isolation Check
    const badContext: BotContext = {
      currentPrice: 100,
      bid: 100,
      ask: 100,
      spread: 0,
      recentDailyCandles: [],
      brokerSymbol: 'INVALID_SYMBOL',
      now: new Date()
    };
    const badSignal = await bot.generateSignal(badContext);
    if (badSignal.shouldTrade) {
      console.error(`❌ [${name}] FAILED: Traded on invalid symbol.`);
      errors++;
    }

    // Determine the expected trigger time from the config description
    // Most bots say "precisely at 15:15 UTC" or similar.
    const timeMatch = config.description.match(/at (\d{1,2}):(\d{2}) UTC/);
    if (timeMatch) {
      const expectedHour = parseInt(timeMatch[1], 10);
      const expectedMin = parseInt(timeMatch[2], 10);
      
      // 2. Temporal Constraint Check (Test a random wrong time)
      const wrongTime = new Date();
      wrongTime.setUTCHours((expectedHour + 1) % 24);
      wrongTime.setUTCMinutes(expectedMin);
      
      const wrongTimeContext: BotContext = {
        currentPrice: 100,
        bid: 100,
        ask: 100,
        spread: 0,
        recentDailyCandles: [],
        brokerSymbol: symbol,
        now: wrongTime
      };
      
      const wrongTimeSignal = await bot.generateSignal(wrongTimeContext);
      if (wrongTimeSignal.shouldTrade) {
        console.error(`❌ [${name}] FAILED: Traded at wrong time (${wrongTime.toISOString()}).`);
        errors++;
      }
      
      // 3. Right Time / Direction / SL / TP Check
      const rightTime = new Date();
      rightTime.setUTCHours(expectedHour);
      rightTime.setUTCMinutes(expectedMin - 10); // All bots fire 10 mins early for latency!

      // Force EMA calculation by generating a fake signal first
      await bot.generateSignal({ currentPrice: 100, bid: 100, ask: 100, spread: 0, recentDailyCandles: [], brokerSymbol: symbol, now: wrongTime });
      // EMA is now ~100
      
      // Test SELL (Price > EMA)
      const sellContext: BotContext = {
        currentPrice: 999999, // Guarantee > EMA
        bid: 999999,
        ask: 150,
        spread: 0,
        recentDailyCandles: [],
        brokerSymbol: symbol,
        now: rightTime
      };
      const sellSignal = await bot.generateSignal(sellContext);
      if (!sellSignal.shouldTrade || sellSignal.direction !== 'SELL') {
        console.error(`❌ [${name}] FAILED: Did not return SELL when price > EMA.`);
        errors++;
      }

      // Test BUY (Price < EMA)
      const buyContext: BotContext = {
        currentPrice: 0.00001, // Guarantee < EMA
        bid: 0.00001,
        ask: 50,
        spread: 0,
        recentDailyCandles: [],
        brokerSymbol: symbol,
        now: rightTime
      };
      const buySignal = await bot.generateSignal(buyContext);
      if (!buySignal.shouldTrade || buySignal.direction !== 'BUY') {
        console.error(`❌ [${name}] FAILED: Did not return BUY when price < EMA.`);
        errors++;
      }

      // 4. SL / TP Constraint Check
      // Extract expected SL/TP from description
      const slMatch = config.description.match(/(\d+) pip SL/);
      const tpMatch = config.description.match(/(\d+) pip TP/);
      
      if (slMatch && tpMatch) {
        const expectedSl = parseInt(slMatch[1], 10);
        const expectedTp = parseInt(tpMatch[1], 10);
        
        if (buySignal.suggestedSlPips !== expectedSl || buySignal.suggestedTpPips !== expectedTp) {
          console.error(`❌ [${name}] FAILED: Wrong SL/TP. Expected ${expectedSl}/${expectedTp}, got ${buySignal.suggestedSlPips}/${buySignal.suggestedTpPips}`);
          errors++;
        }
      }
    } else if (config.id !== 'old-is-gold') {
      // Old Is Gold has a different description format, skip time parse for it
      console.warn(`⚠️ [${name}] WARNING: Could not parse trigger time from description.`);
    }
  }

  if (errors > 0) {
    console.error(`[Validator] ❌ Validation failed with ${errors} error(s). Server boot aborted.`);
    process.exit(1); // Crash the server
  } else {
    console.log(`[Validator] ✅ All ${bots.length} bots passed strict invariant checks.`);
  }
}

// If run directly via CLI
if (process.argv[1] && process.argv[1].endsWith('botValidator.ts')) {
  validateAllBots().catch(console.error);
}

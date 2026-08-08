import { AggregatedCandle, StacyDailyCandle } from "../config/types.js";

/**
 * Tracks the "Stacy Burke Daily Context" by grouping M5 candles into Daily candles
 * that strictly roll over at 5 PM EST (17:00 EST).
 */
export class DailyContextTracker {
  public dailyCandles: StacyDailyCandle[] = [];
  private currentDaily: StacyDailyCandle | null = null;
  private currentTradingDate: string | null = null;
  public retainAllHistory: boolean = false;

  public currentWeeklyHigh: number = -Infinity;
  public currentWeeklyLow: number = Infinity;

  constructor(retainAllHistory: boolean = false) {
    this.retainAllHistory = retainAllHistory;
  }

  private static dateCache = new Map<number, string>();
  private static nyDateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  private getTradingDateStr(tsMs: number): string {
    let cached = DailyContextTracker.dateCache.get(tsMs);
    if (cached !== undefined) return cached;

    // Add 7 hours to the UTC timestamp. When projected into NY time,
    // 17:00 NY time + 7 hours = 00:00 NY time (next day).
    // This perfectly rolls over the daily context at 5:00 PM NY time, respecting DST.
    const formatted = DailyContextTracker.nyDateFormatter.format(
      tsMs + 7 * 60 * 60 * 1000,
    );
    DailyContextTracker.dateCache.set(tsMs, formatted);
    return formatted;
  }

  public getCurrentDaily(): StacyDailyCandle | null {
    return this.currentDaily;
  }

  public processCandle(c: AggregatedCandle) {
    const tradingDate = this.getTradingDateStr(c.timestamp);
    const isNewDay =
      this.currentTradingDate !== null &&
      tradingDate !== this.currentTradingDate;

    // Initialize the very first day
    if (!this.currentDaily) {
      this.currentDaily = this.createNewDaily(c);
      this.currentTradingDate = tradingDate;
      return;
    }

    if (isNewDay) {
      // 1. Finalize the current day and calculate context
      this.finalizeContext(this.currentDaily);
      this.dailyCandles.push(this.currentDaily);

      // Check for New Week (weekend gap > 47 hours or Fri->Sun calendar shift)
      const cDay = new Date(c.timestamp).getUTCDay();
      const prevDay = new Date(this.currentDaily.startTime).getUTCDay();
      if (
        c.timestamp - this.currentDaily.startTime >= 47 * 60 * 60 * 1000 ||
        (prevDay === 5 && (cDay === 0 || cDay === 1))
      ) {
        this.currentWeeklyHigh = c.high;
        this.currentWeeklyLow = c.low;
      }

      // Keep only the last 10 days for memory efficiency (unless backtesting)
      if (!this.retainAllHistory && this.dailyCandles.length > 10) {
        this.dailyCandles.shift();
      }

      // 2. Start new day
      this.currentDaily = this.createNewDaily(c);
    } else {
      // Update current day
      if (c.high > this.currentDaily.high) this.currentDaily.high = c.high;
      if (c.low < this.currentDaily.low) this.currentDaily.low = c.low;
      this.currentDaily.close = c.close;
      this.currentDaily.volume += c.volume;
    }

    // Update Asian Range (17:00 EST to 01:59 EST)
    if (this.currentDaily && c.estHour !== undefined) {
      if (c.estHour >= 17 || c.estHour < 2) {
        if (c.high > this.currentDaily.asianHigh)
          this.currentDaily.asianHigh = c.high;
        if (c.low < this.currentDaily.asianLow)
          this.currentDaily.asianLow = c.low;
      }
    }

    // Update Weekly Extremes
    if (c.high > this.currentWeeklyHigh) this.currentWeeklyHigh = c.high;
    if (c.low < this.currentWeeklyLow) this.currentWeeklyLow = c.low;

    if (this.currentDaily) {
      this.currentDaily.weeklyHigh = this.currentWeeklyHigh;
      this.currentDaily.weeklyLow = this.currentWeeklyLow;
    }

    this.currentTradingDate = tradingDate;
  }

  private createNewDaily(c: AggregatedCandle): StacyDailyCandle {
    return {
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      startTime: c.timestamp,
      dateStr: c.dateStr,
      isFirstRedDay: false,
      isFirstGreenDay: false,
      isInsideDay: false,
      isPumpDay: false,
      isDumpDay: false,
      isDay2BreakoutLongs: false,
      isDay2BreakoutShorts: false,
      isDay3BreakoutLongs: false,
      isDay3BreakoutShorts: false,
      isTrendingLong: false,
      isTrendingShort: false,
      dayCount: 1,
      weeklyHigh: this.currentWeeklyHigh,
      weeklyLow: this.currentWeeklyLow,
      asianHigh: -Infinity,
      asianLow: Infinity,
    };
  }

  private finalizeContext(day: StacyDailyCandle) {
    if (this.dailyCandles.length === 0) {
      day.dayCount = 1;
      return;
    }

    const prevDay = this.dailyCandles[this.dailyCandles.length - 1];

    // Day Count Logic (1, 2, 3 cycle)
    day.dayCount =
      prevDay.dayCount === 3 ? 1 : ((prevDay.dayCount + 1) as 1 | 2 | 3);

    // Inside Day
    day.isInsideDay = day.high <= prevDay.high && day.low >= prevDay.low;

    // Pump / Dump (Strong directional body)
    const range = day.high - day.low;
    const body = Math.abs(day.close - day.open);
    const isStrongBody = body > range * 0.5; // Body is at least 50% of the entire range

    if (day.close > day.open && isStrongBody) {
      day.isPumpDay = true;
    } else if (day.close < day.open && isStrongBody) {
      day.isDumpDay = true;
    }

    // First Red Day (FRD): Pump Day followed by a day that closes below its open
    if (prevDay.isPumpDay && day.close < day.open) {
      day.isFirstRedDay = true;
    }

    // First Green Day (FGD): Dump Day followed by a day that closes above its open
    if (prevDay.isDumpDay && day.close > day.open) {
      day.isFirstGreenDay = true;
    }

    // Day 2 Breakout Logic
    if (this.dailyCandles.length >= 2) {
      const prevPrevDay = this.dailyCandles[this.dailyCandles.length - 2];

      // Day 1: Market broke out of previous day's high. Day 2: Market broke out of Day 1's high.
      if (prevDay.high > prevPrevDay.high && day.high > prevDay.high) {
        day.isDay2BreakoutLongs = true;
      }

      // Day 1: Market broke below previous day's low. Day 2: Market broke below Day 1's low.
      if (prevDay.low < prevPrevDay.low && day.low < prevDay.low) {
        day.isDay2BreakoutShorts = true;
      }
    }

    // Day 3 Breakout Logic
    if (this.dailyCandles.length >= 3) {
      const prevPrevPrevDay = this.dailyCandles[this.dailyCandles.length - 3];
      const prevPrevDay = this.dailyCandles[this.dailyCandles.length - 2];

      if (
        prevPrevDay.high > prevPrevPrevDay.high &&
        prevDay.high > prevPrevDay.high &&
        day.high > prevDay.high
      ) {
        day.isDay3BreakoutLongs = true;
      }

      if (
        prevPrevDay.low < prevPrevPrevDay.low &&
        prevDay.low < prevPrevDay.low &&
        day.low < prevDay.low
      ) {
        day.isDay3BreakoutShorts = true;
      }
    }

    // Trending logic for Low Hanging Fruit (LHF)
    // A trending day is a strong directional day that broke out of the previous day's extreme
    if (
      day.isPumpDay &&
      day.high > prevDay.high &&
      day.close > day.high - range * 0.25
    ) {
      day.isTrendingLong = true;
    }
    if (
      day.isDumpDay &&
      day.low < prevDay.low &&
      day.close < day.low + range * 0.25
    ) {
      day.isTrendingShort = true;
    }
  }

  /**
   * Return the context of the PREVIOUS day (which determines setups for the current trading day)
 (which determines setups for the current trading day)
   */
  public getPreviousDayContext(): StacyDailyCandle | null {
    if (this.dailyCandles.length === 0) return null;
    return this.dailyCandles[this.dailyCandles.length - 1];
  }

  /**
   * Returns the Day N context
   */
  public getDay(nDaysAgo: number): StacyDailyCandle | null {
    const idx = this.dailyCandles.length - nDaysAgo;
    if (idx < 0) return null;
    return this.dailyCandles[idx];
  }

  /**
   * Builds a map matching each M5 candle index to the completed Daily candle that preceded it.
   */
  public static buildDailyIndexMap(
    m5Candles: AggregatedCandle[],
  ): DailyContextTracker {
    const tracker = new DailyContextTracker(true);
    for (const c of m5Candles) {
      tracker.processCandle(c);
    }
    // Note: the last day is still in tracker.currentDaily and not pushed yet.
    return tracker;
  }
}

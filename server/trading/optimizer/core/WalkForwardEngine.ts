import { M1TypedArrays } from "../../config/types.js";
import { logger } from "../../../utils/logger.js";

export interface WfaWindow {
  windowIndex: number;
  inSampleStart: Date;
  inSampleEnd: Date;
  outOfSampleStart: Date;
  outOfSampleEnd: Date;
  
  // Indices inside M1TypedArrays
  inSampleStartIndex: number;
  inSampleEndIndex: number;
  outOfSampleStartIndex: number;
  outOfSampleEndIndex: number;
}

export class WalkForwardEngine {
  /**
   * Generates rolling 6-month In-Sample and 2-month Out-Of-Sample windows.
   * Steps forward by 2 months.
   */
  static generateWindows(m1Typed: M1TypedArrays): WfaWindow[] {
    if (m1Typed.length === 0) return [];

    const firstTime = m1Typed.timestamp[0];
    const lastTime = m1Typed.timestamp[m1Typed.length - 1];

    const windows: WfaWindow[] = [];
    let currentISStart = new Date(firstTime);
    let windowIndex = 0;

    while (true) {
      // IS end is 6 months after IS start
      const currentISEnd = new Date(currentISStart);
      currentISEnd.setUTCMonth(currentISEnd.getUTCMonth() + 6);

      // OOS end is 2 months after IS end
      const currentOOSEnd = new Date(currentISEnd);
      currentOOSEnd.setUTCMonth(currentOOSEnd.getUTCMonth() + 2);

      let isFinalPartialWindow = false;

      // If OOS end exceeds the last available data timestamp, clamp it to create a partial window
      if (currentOOSEnd.getTime() > lastTime) {
        // Only clamp if we at least have enough data to form the In-Sample slice completely
        if (currentISEnd.getTime() >= lastTime) {
          // If we don't even have enough data for a single IS slice (i.e. < 6 months total data)
          if (windows.length === 0) {
            const halfOffset = firstTime + (lastTime - firstTime) * 0.75;
            const isEndDummy = new Date(halfOffset);
            const isStartIdx = 0;
            const isEndIdx = this.findIndex(m1Typed.timestamp, isEndDummy.getTime());
            const oosEndIdx = m1Typed.length - 1;
            
            windows.push({
              windowIndex: 0,
              inSampleStart: new Date(firstTime),
              inSampleEnd: isEndDummy,
              outOfSampleStart: isEndDummy,
              outOfSampleEnd: new Date(lastTime),
              inSampleStartIndex: isStartIdx,
              inSampleEndIndex: isEndIdx,
              outOfSampleStartIndex: Math.min(isEndIdx + 1, m1Typed.length - 1),
              outOfSampleEndIndex: oosEndIdx,
            });
          }
          break;
        } else {
          // We have a full IS slice, but partial OOS slice. 
          // CUTOFF RULE: Drop the partial window if it has less than 14 days of data
          const partialDuration = lastTime - currentISEnd.getTime();
          const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
          
          if (partialDuration < FOURTEEN_DAYS_MS) {
            logger.info(`[WFA] Dropping final partial OOS window (only ${Math.round(partialDuration/86400000)} days, < 14 days required)`);
            break;
          }
          
          // Clamp OOS to the end of data.
          currentOOSEnd.setTime(lastTime);
          isFinalPartialWindow = true;
        }
      }

      const inSampleStartIndex = this.findIndex(m1Typed.timestamp, currentISStart.getTime());
      const inSampleEndIndex = this.findIndex(m1Typed.timestamp, currentISEnd.getTime());
      const outOfSampleStartIndex = Math.min(inSampleEndIndex + 1, m1Typed.length - 1);
      const outOfSampleEndIndex = this.findIndex(m1Typed.timestamp, currentOOSEnd.getTime());

      // Only push if there's actual data in both slices
      if (inSampleEndIndex > inSampleStartIndex && outOfSampleEndIndex > outOfSampleStartIndex) {
        windows.push({
          windowIndex,
          inSampleStart: new Date(currentISStart),
          inSampleEnd: currentISEnd,
          outOfSampleStart: new Date(currentISEnd),
          outOfSampleEnd: new Date(currentOOSEnd),
          inSampleStartIndex,
          inSampleEndIndex,
          outOfSampleStartIndex,
          outOfSampleEndIndex,
        });
        windowIndex++;
      }

      if (isFinalPartialWindow) {
        break;
      }

      // Step forward by 2 months (the OOS size)
      currentISStart.setUTCMonth(currentISStart.getUTCMonth() + 2);
    }

    return windows;
  }

  /**
   * Helper to binary search the closest index for a target timestamp.
   */
  private static findIndex(arr: Float64Array, targetMs: number): number {
    let low = 0;
    let high = arr.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const val = arr[mid];
      if (val === targetMs) {
        return mid;
      } else if (val < targetMs) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.min(Math.max(low, 0), arr.length - 1);
  }

  /**
   * Creates a subarray view (no copy) of the M1TypedArrays for a specific window range.
   */
  static sliceTypedArrays(m1Typed: M1TypedArrays, startIdx: number, endIdx: number): M1TypedArrays {
    const len = endIdx - startIdx + 1;
    return {
      open: m1Typed.open.subarray(startIdx, endIdx + 1),
      high: m1Typed.high.subarray(startIdx, endIdx + 1),
      low: m1Typed.low.subarray(startIdx, endIdx + 1),
      close: m1Typed.close.subarray(startIdx, endIdx + 1),
      timestamp: m1Typed.timestamp.subarray(startIdx, endIdx + 1),
      estHour: m1Typed.estHour.subarray(startIdx, endIdx + 1),
      minute: m1Typed.minute.subarray(startIdx, endIdx + 1),
      isEOD_standard: m1Typed.isEOD_standard.subarray(startIdx, endIdx + 1),
      isSessionReset: m1Typed.isSessionReset.subarray(startIdx, endIdx + 1),
      isMidnightExpiry: m1Typed.isMidnightExpiry.subarray(startIdx, endIdx + 1),
      isNewsForceClose: m1Typed.isNewsForceClose.subarray(startIdx, endIdx + 1),
      length: len,
    };
  }
}

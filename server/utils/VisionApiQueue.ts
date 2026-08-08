// ============================================================
// GLOBAL VISION API QUEUE — Centralized Gemini Rate Limiter
// ============================================================
// This singleton module is the ONLY entry point for all Gemini
// API calls across the entire system (6 Algo heads + 4 Discretionary heads).
//
// Features:
//   1. Concurrency Limiting — max 3 simultaneous in-flight requests.
//      When 10 bots trigger at once, 3 fire immediately; the other
//      7 queue up and are processed as slots free up.
//
//   2. Hard Timeout — each task must complete within TIMEOUT_MS (15s).
//      If the API stalls, AbortController kills the connection and
//      throws a TimeoutError so the retry logic can handle it cleanly.
//
//   3. Exponential Backoff w/ Jitter — on any failure (429, 503, timeout),
//      the task waits (2^attempt * 1000ms) + random jitter before retrying,
//      up to MAX_RETRIES attempts. This spreads retries out and avoids a
//      "thundering herd" of simultaneous retries slamming the API again.
// ============================================================

const CONCURRENCY = 3; // Max simultaneous Gemini requests in-flight
const TIMEOUT_MS = 45_000; // Kill any request that takes longer than 45 seconds
const MAX_RETRIES = 10; // 10 retries = exponential backoff can wait several minutes to guarantee the API call succeeds during massive backtests

let activeCount = 0;
const waitQueue: Array<() => void> = [];

/** Acquire a concurrency slot. Callers block here until a slot is free. */
async function acquireSlot(): Promise<void> {
  if (activeCount < CONCURRENCY) {
    activeCount++;
    return;
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      activeCount++;
      resolve();
    });
  });
}

/** Release a concurrency slot and wake the next waiting caller. */
function releaseSlot(): void {
  activeCount--;
  const next = waitQueue.shift();
  if (next) next();
}

/**
 * Wraps any async function with a hard AbortController deadline.
 * Throws a TimeoutError if `fn` does not resolve within `ms` milliseconds.
 */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`VisionApiQueue: Request timed out after ${ms}ms`),
      ),
    ms,
  );
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enqueues an async task for Gemini API execution with full resilience:
 *   - Concurrency limiting (global turnstile)
 *   - Hard per-request timeout
 *   - Exponential backoff on failure
 *
 * @param task  An async function that accepts an AbortSignal and makes the API call.
 *              Pass the signal to your `fetch()` call: `fetch(url, { signal })`.
 *              If using the @google/genai SDK, wrap the call here manually.
 * @returns     The resolved value of `task`.
 */
export async function enqueueVisionRequest<T>(
  task: (signal: AbortSignal) => Promise<T>,
  callerTag: string = "Unknown",
): Promise<T> {
  let attempt = 0;

  while (true) {
    await acquireSlot();
    const slotAcquiredAt = Date.now();
    console.log(
      `[VisionQueue] [${callerTag}] Slot acquired (active: ${activeCount}/${CONCURRENCY})`,
    );

    try {
      const result = await withTimeout(task, TIMEOUT_MS);
      const elapsed = Date.now() - slotAcquiredAt;
      console.log(`[VisionQueue] [${callerTag}] Success in ${elapsed}ms`);
      releaseSlot();
      return result;
    } catch (err: any) {
      releaseSlot();
      attempt++;

      const isRetryable =
        err?.message?.includes("timed out") ||
        err?.message?.includes("429") ||
        err?.message?.includes("503") ||
        err?.message?.includes("500") ||
        err?.message?.includes("ECONNRESET") ||
        err?.message?.includes("fetch failed") ||
        err?.message?.toLowerCase().includes("abort");

      if (attempt > MAX_RETRIES || !isRetryable) {
        console.error(
          `[VisionQueue] [${callerTag}] Giving up after ${attempt} attempt(s): ${err.message}`,
        );
        throw err;
      }

      // Exponential backoff + jitter: base wait doubles each retry, plus a
      // random 0-500ms jitter to stagger simultaneous retries from multiple bots.
      const baseWait = Math.pow(2, attempt) * 1000;
      const jitter = Math.random() * 500;
      const waitMs = Math.min(60000, Math.round(baseWait + jitter));

      console.warn(
        `[VisionQueue] [${callerTag}] Attempt ${attempt}/${MAX_RETRIES} failed: "${err.message}". ` +
          `Retrying in ${(waitMs / 1000).toFixed(1)}s...`,
      );

      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

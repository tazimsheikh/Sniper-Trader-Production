import {
  clearAllSharedConnections,
  clearSharedConnectionForProfile,
} from "../trading/broker/metaApiHandler.js";

// ============================================================
// PER-PROFILE METAAPI QUEUE — Isolated Execution Rate Limiter
// ============================================================
// Each trading profile gets its own concurrency slot and jitter
// timer. This prevents Profile A's trades from throttling
// Profile B or from contaminating temporal jitter state.
// ============================================================

const CONCURRENCY = 2;
const MAX_RETRIES = 3;

interface ProfileQueueState {
  activeCount: number;
  waitQueue: Array<() => void>;
  lastExecutionJitterTime: number;
}

const profileQueues = new Map<string, ProfileQueueState>();

function getProfileState(profileId: string): ProfileQueueState {
  if (!profileQueues.has(profileId)) {
    profileQueues.set(profileId, {
      activeCount: 0,
      waitQueue: [],
      lastExecutionJitterTime: 0,
    });
  }
  return profileQueues.get(profileId)!;
}

async function acquireSlot(profileId: string): Promise<void> {
  const state = getProfileState(profileId);
  if (state.activeCount < CONCURRENCY) {
    state.activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    state.waitQueue.push(() => {
      state.activeCount++;
      resolve();
    });
  });
}

function releaseSlot(profileId: string): void {
  const state = getProfileState(profileId);
  state.activeCount--;
  const next = state.waitQueue.shift();
  if (next) {
    next();
  }
}

/**
 * Enqueues an async task for MetaAPI execution with full resilience.
 * - Concurrent limiting (max 2 active per profile)
 * - Exponential backoff retries (up to 3 times)
 * - Per-profile humanization jitter (isolated from other profiles)
 *
 * @param task The async function containing the MetaAPI request.
 * @param callerTag A string tag for logging (e.g. 'MAGE:EURUSD:LimitBuy')
 * @param maxRetries Override default max retries
 * @param rebootHandler Optional handler called before retry on dead RPC
 * @param profileId The trading profile ID. Defaults to "global" for backward compat.
 */
export async function enqueueMetaApiRequest<T>(
  task: (signal: AbortSignal) => Promise<T>,
  callerTag: string = "MetaApi",
  maxRetries: number = MAX_RETRIES,
  rebootHandler?: () => Promise<void>,
  profileId: string = "global",
): Promise<T> {
  if ((global as any).isSimulator) return task(new AbortController().signal);
  await acquireSlot(profileId);
  const startTime = Date.now();

  try {
    let attempt = 1;
    while (true) {
      try {
        const ac = new AbortController();
        const timeoutId = setTimeout(
          () => ac.abort(new Error("MetaApi Timeout (15s)")),
          15000,
        );

        // --- HUMANIZATION JITTER FOR TRADE EXECUTIONS (per profile) ---
        const isExecution =
          callerTag &&
          (callerTag.toLowerCase().includes("limit") ||
            callerTag.toLowerCase().includes("market") ||
            callerTag.toLowerCase().includes("close") ||
            callerTag.toLowerCase().includes("trail") ||
            callerTag.toLowerCase().includes("entry"));

        if (isExecution && !(global as any).isSimulator) {
          const pState = getProfileState(profileId);
          const now = Date.now();

          // Proactive Connection Watchdog — force fresh connection if idle > 10 minutes
          if (now - pState.lastExecutionJitterTime > 10 * 60 * 1000 && pState.lastExecutionJitterTime !== 0) {
            console.warn(`[MetaApiQueue] 🛡️ Watchdog [Profile:${profileId}]: Idle > 10 min. (clearAllSharedConnections disabled to protect other profiles).`);
          }

          const minDelay = 1500;
          const randomJitter = Math.floor(Math.random() * 1000);
          const targetTime = pState.lastExecutionJitterTime + minDelay + randomJitter;

          if (now < targetTime) {
            const waitTime = targetTime - now;
            console.log(`[MetaApiQueue] ⏳ [Profile:${profileId}] Humanizing ${callerTag}... ${waitTime}ms delay.`);
            await new Promise((r) => setTimeout(r, waitTime));
          }
          pState.lastExecutionJitterTime = Date.now();
        }
        // ------------------------------------------------

        try {
          const result = await Promise.race([
            task(ac.signal),
            new Promise<T>((_, reject) => {
              if (ac.signal.aborted) reject(ac.signal.reason);
              ac.signal.addEventListener("abort", () =>
                reject(ac.signal.reason),
              );
            }),
          ]);
          const elapsed = Date.now() - startTime;
          console.log(`[MetaApiQueue] [Profile:${profileId}] [${callerTag}] ✅ Success in ${elapsed}ms`);
          return result;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (err: any) {
        const errMsg = err.message || "";
        const isStopsError =
          errMsg.includes("Invalid Stops") ||
          errMsg.includes("Invalid stops") ||
          errMsg.includes("INVALID_STOPS");
        const isInvalidPrice =
          errMsg.includes("Invalid Price") ||
          errMsg.includes("Invalid price") ||
          errMsg.includes("INVALID_PRICE") ||
          errMsg.includes("invalid price") ||
          errMsg.includes("10015");
        const isNotEnoughMoney =
          errMsg.includes("Not enough money") ||
          errMsg.includes("NOT_ENOUGH_MONEY");
        const isTradeDisabled =
          errMsg.includes("Trade is disabled") ||
          errMsg.includes("TRADE_DISABLED");
        const isNotFound =
          errMsg.includes("Position not found") ||
          errMsg.includes("Order not found") ||
          errMsg.includes("POSITION_NOT_FOUND");

        if (errMsg.includes("split") || errMsg.includes("timeout")) {
          console.warn(`[MetaApiQueue] Detected dead RPC instance for Profile ${profileId}. Clearing profile MetaAPI connection before retry.`);
          if (profileId && profileId !== "global") {
            await clearSharedConnectionForProfile(profileId).catch((e) =>
              console.error(`[MetaApiQueue] Profile ${profileId} connection clear failed:`, e),
            );
          } else {
            clearAllSharedConnections();
          }
          if (rebootHandler) {
            await rebootHandler().catch((e) =>
              console.error("Reboot handler failed:", e),
            );
          }
        }

        const isHardReject = isStopsError || isInvalidPrice || isNotEnoughMoney || isTradeDisabled || isNotFound;

        if (attempt > maxRetries || isHardReject) {
          console.error(
            `[MetaApiQueue] [Profile:${profileId}] [${callerTag}] Giving up after ${attempt} attempt(s). Hard Reject: ${isHardReject} | Error: ${errMsg}`,
          );
          throw err;
        }

        const baseWaitMs = Math.pow(2, attempt) * 500;
        const jitterMs = Math.floor(Math.random() * 250);
        const waitMs = Math.min(10000, baseWaitMs + jitterMs);

        console.warn(
          `[MetaApiQueue] [Profile:${profileId}] [${callerTag}] Attempt ${attempt}/${maxRetries} failed: "${errMsg}". ` +
            `Retrying in ${(waitMs / 1000).toFixed(1)}s...`,
        );

        releaseSlot(profileId);
        await new Promise((r) => setTimeout(r, waitMs));
        await acquireSlot(profileId);
        attempt++;
      }
    }
  } finally {
    releaseSlot(profileId);
  }
}

// ============================================================
// ENSURE METAAPI HIGH RELIABILITY
// ============================================================
// Runs once at server startup. For every trading profile that
// has a valid MetaAPI token + account ID, this module calls
// the MetaAPI "increase-reliability" endpoint to migrate the
// account onto G2 high-availability infrastructure.
//
// This is the fix for "Connected (no redundancy)" showing in
// the MetaAPI dashboard on paid plans.
//
// Safety:
//   - The endpoint is idempotent — calling it on an account
//     that is already on high-reliability infrastructure is a
//     safe no-op (MetaAPI returns 200 with no changes made).
//   - Failures are caught and logged — they never crash the
//     server or block startup.
//   - Each account is only upgraded once per server session.
//     We track upgraded accounts in a Set to skip duplicates.
// ============================================================

import db from "../core/db.js";
import { decrypt, isEncrypted } from "../core/crypto.js";

const PROVISIONING_BASE =
  "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";

// Track which accounts we have already attempted this session
const upgradedAccounts = new Set<string>();

/**
 * Calls POST /users/current/accounts/:accountId/increase-reliability
 * for a single account. Returns true if successful.
 */
async function upgradeAccountReliability(
  token: string,
  accountId: string,
): Promise<boolean> {
  const url = `${PROVISIONING_BASE}/users/current/accounts/${accountId}/increase-reliability`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "auth-token": token,
        "Content-Type": "application/json",
      },
    });

    if (res.ok) {
      console.log(
        `[MetaAPI Reliability] ✅ Account ${accountId} — high-reliability confirmed/enabled.`,
      );
      return true;
    }

    // 409 Conflict = already on high-reliability, treat as success
    if (res.status === 409) {
      console.log(
        `[MetaAPI Reliability] ✅ Account ${accountId} — already on high-reliability infrastructure.`,
      );
      return true;
    }

    const body = await res.text().catch(() => "(no body)");
    console.warn(
      `[MetaAPI Reliability] ⚠️ Account ${accountId} — upgrade responded ${res.status}: ${body}`,
    );
    return false;
  } catch (err: any) {
    console.warn(
      `[MetaAPI Reliability] ⚠️ Account ${accountId} — network error: ${err.message}`,
    );
    return false;
  }
}

/**
 * Reads all active trading profiles from the DB and ensures
 * each MetaAPI account is on high-reliability infrastructure.
 *
 * Designed to be fire-and-forget at server startup:
 *   ensureMetaApiReliability().catch(() => {});
 */
export async function ensureMetaApiReliability(): Promise<void> {
  let profiles: any[];
  try {
    profiles = (await db
      .prepare(
        `
      SELECT tp.id, u.metaapi_token, tp.metaapi_account_id
      FROM trading_profiles tp
      JOIN users u ON u.id = tp.user_id
      WHERE u.metaapi_token IS NOT NULL
        AND tp.metaapi_account_id IS NOT NULL
        AND u.metaapi_token != 'dummy_token'
        AND tp.metaapi_account_id != 'dummy_acc'
    `,
      )
      .all()) as any[];
  } catch (err: any) {
    console.warn(
      `[MetaAPI Reliability] DB read failed — skipping upgrade: ${err.message}`,
    );
    return;
  }

  if (profiles.length === 0) {
    console.log(
      "[MetaAPI Reliability] No active profiles found — nothing to upgrade.",
    );
    return;
  }

  for (const profile of profiles) {
    let rawToken: string;
    let rawAccountId: string;

    try {
      rawToken = isEncrypted(profile.metaapi_token)
        ? decrypt(profile.metaapi_token)
        : profile.metaapi_token;
      rawAccountId = isEncrypted(profile.metaapi_account_id)
        ? decrypt(profile.metaapi_account_id)
        : profile.metaapi_account_id;
    } catch (e: any) {
      console.warn(
        `[MetaAPI Reliability] Profile ${profile.id} — token decrypt failed: ${e.message}`,
      );
      continue;
    }

    // Skip dummy/test profiles and duplicates
    if (
      !rawToken ||
      !rawAccountId ||
      rawToken === "dummy_token" ||
      rawAccountId === "dummy_acc" ||
      upgradedAccounts.has(rawAccountId)
    )
      continue;

    upgradedAccounts.add(rawAccountId);
    await upgradeAccountReliability(rawToken, rawAccountId);

    // Small delay between accounts to avoid hammering the provisioning API
    await new Promise((r) => setTimeout(r, 1500));
  }
}

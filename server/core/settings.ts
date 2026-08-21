import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "./auth.js";
import db from "./db.js";
import { encrypt, decrypt, isEncrypted } from "./crypto.js";
import {
  verifyMetaApiAccount,
  clearApiCacheForToken,
  clearAllSharedConnections,
} from "../trading/broker/metaApiHandler.js";
import { safetyStatusMap } from "../manager/tradeUtils.js";

export const settingsRouter = Router();

// GET /api/settings/keys
settingsRouter.get(
  "/keys",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = (await db
        .prepare(
          "SELECT metaapi_token, metaapi_account_id, gemini_api_key FROM users WHERE id = ?",
        )
        .get(req.user.id)) as any;
      if (!user)
        return res
          .status(404)
          .json({ success: false, error: "User not found" });

      let metaapi_token = "";
      let metaapi_account_id = "";
      let gemini_api_key = "";

      if (user.metaapi_token) {
        metaapi_token = isEncrypted(user.metaapi_token)
          ? decrypt(user.metaapi_token)
          : user.metaapi_token;
      } else if (process.env.METAAPI_TOKEN) {
        metaapi_token = process.env.METAAPI_TOKEN;
        await db
          .prepare("UPDATE users SET metaapi_token = ? WHERE id = ?")
          .run(encrypt(metaapi_token), req.user.id);
      }

      if (user.metaapi_account_id) {
        metaapi_account_id = isEncrypted(user.metaapi_account_id)
          ? decrypt(user.metaapi_account_id)
          : user.metaapi_account_id;
      }

      if (user.gemini_api_key) {
        gemini_api_key = isEncrypted(user.gemini_api_key)
          ? decrypt(user.gemini_api_key)
          : user.gemini_api_key;
      } else if (process.env.GEMINI_API_KEY) {
        gemini_api_key = process.env.GEMINI_API_KEY;
        await db
          .prepare("UPDATE users SET gemini_api_key = ? WHERE id = ?")
          .run(encrypt(gemini_api_key), req.user.id);
      }

      res.json({
        success: true,
        keys: {
          hasMetaApiToken: !!metaapi_token,
          metaapiAccountId: metaapi_account_id,
          hasGeminiApiKey: !!gemini_api_key,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// POST /api/settings/keys
settingsRouter.post(
  "/keys",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { metaapiToken, metaapiAccountId, geminiApiKey } = req.body;

      const user = (await db
        .prepare(
          "SELECT metaapi_token, metaapi_account_id, gemini_api_key FROM users WHERE id = ?",
        )
        .get(req.user.id)) as any;
      if (!user)
        return res
          .status(404)
          .json({ success: false, error: "User not found" });

      let finalMetaToken = isEncrypted(user.metaapi_token)
        ? decrypt(user.metaapi_token)
        : user.metaapi_token;
      let finalMetaAccount = isEncrypted(user.metaapi_account_id)
        ? decrypt(user.metaapi_account_id)
        : user.metaapi_account_id;
      let finalGeminiKey = user.gemini_api_key
        ? isEncrypted(user.gemini_api_key)
          ? decrypt(user.gemini_api_key)
          : user.gemini_api_key
        : null;

      if (metaapiToken && !metaapiToken.startsWith("••••"))
        finalMetaToken = metaapiToken;
      if (metaapiAccountId)
        finalMetaAccount =
          typeof metaapiAccountId === "string"
            ? metaapiAccountId.trim().replace(/[^a-zA-Z0-9\-]/g, "")
            : metaapiAccountId;
      if (geminiApiKey && !geminiApiKey.startsWith("••••"))
        finalGeminiKey = geminiApiKey;

      await db
        .prepare(
          `
      UPDATE users 
      SET metaapi_token = ?, metaapi_account_id = ?, gemini_api_key = ? 
      WHERE id = ?
    `,
        )
        .run(
          finalMetaToken ? encrypt(finalMetaToken.trim()) : null,
          finalMetaAccount ? encrypt(finalMetaAccount.trim()) : null,
          finalGeminiKey ? encrypt(finalGeminiKey.trim()) : null,
          req.user.id,
        );

      if (
        metaapiToken &&
        !metaapiToken.startsWith("••••") &&
        user.metaapi_token
      ) {
        const oldToken = isEncrypted(user.metaapi_token)
          ? decrypt(user.metaapi_token)
          : user.metaapi_token;
        clearApiCacheForToken(oldToken);
        const { clearSharedConnection } = await import("../trading/broker/metaApiHandler.js");
        const profiles = (await db
          .prepare(
            "SELECT metaapi_account_id FROM trading_profiles WHERE user_id = ?",
          )
          .all(req.user.id)) as any[];
        for (const p of profiles) {
          if (p.metaapi_account_id) {
            const accId = isEncrypted(p.metaapi_account_id)
              ? decrypt(p.metaapi_account_id)
              : p.metaapi_account_id;
            clearSharedConnection(oldToken, accId);
          }
        }
      }

      res.json({ success: true, message: "Settings updated successfully." });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// GET /api/settings/timezone
settingsRouter.get(
  "/timezone",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = (await db
        .prepare("SELECT timezone FROM users WHERE id = ?")
        .get(req.user.id)) as any;
      res.json({ success: true, timezone: user?.timezone || "IST" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// POST /api/settings/timezone
settingsRouter.post(
  "/timezone",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { timezone } = req.body;
      const VALID_TZ = ["UTC", "IST", "EST", "GMT", "JST", "AEDT"];
      if (!VALID_TZ.includes(timezone)) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid timezone value." });
      }
      await db
        .prepare("UPDATE users SET timezone = ? WHERE id = ?")
        .run(timezone, req.user.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// GET /api/settings/status
settingsRouter.get(
  "/status",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = (await db
        .prepare(
          "SELECT metaapi_token, metaapi_account_id, gemini_api_key FROM users WHERE id = ?",
        )
        .get(req.user.id)) as any;

      const status: any = {
        metaapi: "offline",
        gemini: "offline",
      };
      
      let accountData: any = null;

      const profileId = req.query.profileId;
      let targetAccountId = user.metaapi_account_id;
      if (profileId) {
        const profile = await db.prepare("SELECT metaapi_account_id FROM trading_profiles WHERE id = ? AND user_id = ?").get(profileId, req.user.id) as any;
        if (profile && profile.metaapi_account_id) {
          targetAccountId = profile.metaapi_account_id;
        }
      }

      // Test MetaAPI
      try {
        if (user.metaapi_token && targetAccountId) {
          const token = isEncrypted(user.metaapi_token)
            ? decrypt(user.metaapi_token)
            : user.metaapi_token;
          const accountId = isEncrypted(targetAccountId)
            ? decrypt(targetAccountId)
            : targetAccountId;
            
          const { getSharedConnection } = await import("../trading/broker/metaApiHandler.js");
          const connection = await getSharedConnection(token, accountId, false);
          if (connection) {
            status.metaapi = "connected";
            const info = await connection.getAccountInformation();
            if (info && info.balance) {
              accountData = { balance: info.balance };
            }
          }
        }
      } catch (e) {}

      // Test Google Gemini
      try {
        let gemKey = user.gemini_api_key || process.env.GEMINI_API_KEY;
        if (gemKey && isEncrypted(gemKey)) gemKey = decrypt(gemKey);
        if (gemKey) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${gemKey}`,
            {
              signal: controller.signal,
            },
          );
          clearTimeout(timeout);
          console.log("[DEBUG] Gemini Test Response Status:", gRes.status);
          if (gRes.ok) status.gemini = "connected";
        } else {
          console.log("[DEBUG] Gemini Test skipped: No key found");
        }
      } catch (e) {
        console.error("[DEBUG] Gemini Test Error:", e);
      }

      res.json({ success: true, status, account: accountData });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// DELETE /api/settings/account
settingsRouter.delete(
  "/account",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user.id;
      const user = (await db
        .prepare("SELECT metaapi_token FROM users WHERE id = ?")
        .get(userId)) as any;
      if (user && user.metaapi_token) {
        try {
          const profiles = (await db
            .prepare(
              "SELECT metaapi_account_id FROM trading_profiles WHERE user_id = ?",
            )
            .all(userId)) as any[];
          const { clearSharedConnection } = await import("../trading/broker/metaApiHandler.js");
          const token = isEncrypted(user.metaapi_token)
            ? decrypt(user.metaapi_token)
            : user.metaapi_token;

          for (const profile of profiles) {
            if (profile.metaapi_account_id) {
              const accId = isEncrypted(profile.metaapi_account_id)
                ? decrypt(profile.metaapi_account_id)
                : profile.metaapi_account_id;
              clearSharedConnection(token, accId);
            }
          }
        } catch (e) {}
      }
      // Explicitly delete non-cascading profile children
      await db
        .prepare(
          "DELETE FROM bot_logs WHERE profile_id IN (SELECT id FROM trading_profiles WHERE user_id = ?)",
        )
        .run(userId);
      await db
        .prepare(
          "DELETE FROM ai_decisions WHERE profile_id IN (SELECT id FROM trading_profiles WHERE user_id = ?)",
        )
        .run(userId);

      // Delete user (cascade will delete profiles, pending signals etc)
      await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
      res.clearCookie("auth_token", {
        httpOnly: true,
        secure:
          process.env.NODE_ENV === "production" &&
          process.env.USE_HTTPS === "true",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      res.json({ success: true, message: "Account deleted successfully." });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// GET /api/settings/safety
settingsRouter.get(
  "/safety",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const profileId = req.query.profileId;
      if (!profileId) {
        return res
          .status(400)
          .json({ success: false, error: "profileId is required" });
      }

      const profile = (await db
        .prepare(
          "SELECT safety_settings FROM trading_profiles WHERE id = ? AND user_id = ?",
        )
        .get(profileId, req.user.id)) as any;
      if (!profile) {
        return res
          .status(404)
          .json({ success: false, error: "Profile not found" });
      }

      let settings = {};
      if (profile.safety_settings) {
        try {
          settings = JSON.parse(profile.safety_settings);
        } catch (e) {}
      }

      // Default values
      const defaultSettings = {
        dailyLossLimit: 4,
        maxDrawdownLimit: 20,
        unprofitablePairLookback: 10,
        unprofitablePairMinTrades: 5,
        unprofitablePairMinWinRate: 40,
        unprofitablePairMinProfitPips: 0,
      };

      res.json({
        success: true,
        settings: { ...defaultSettings, ...settings },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// GET /api/settings/safety/status
settingsRouter.get(
  "/safety/status",
  requireAuth,
  (req: AuthRequest, res: Response) => {
    try {
      const profileId = req.query.profileId;
      if (!profileId) {
        return res
          .status(400)
          .json({ success: false, error: "profileId is required" });
      }

      const status = safetyStatusMap.get(Number(profileId)) || {
        circuitBreakerActive: false,
        circuitBreakerReason: "",
        drawdownPct: 0,
        dailyProfitPct: 0,
        blockedPairs: {},
      };

      res.json({ success: true, status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// POST /api/settings/safety
settingsRouter.post(
  "/safety",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { profileId, settings } = req.body;
      if (!profileId) {
        return res
          .status(400)
          .json({ success: false, error: "profileId is required" });
      }
      if (!settings || typeof settings !== "object") {
        return res
          .status(400)
          .json({ success: false, error: "settings object is required" });
      }

      if (settings.maxDrawdownLimit !== undefined) {
        const maxDD = Number(settings.maxDrawdownLimit);
        if (isNaN(maxDD) || maxDD < 0 || maxDD > 100) {
          return res
            .status(400)
            .json({
              success: false,
              error: "maxDrawdownLimit must be between 0 and 100",
            });
        }
        settings.maxDrawdownLimit = maxDD;
      }

      if (settings.dailyLossLimit !== undefined) {
        const dailyLoss = Number(settings.dailyLossLimit);
        if (isNaN(dailyLoss) || dailyLoss <= 0) {
          return res
            .status(400)
            .json({
              success: false,
              error: "dailyLossLimit must be greater than 0",
            });
        }
        settings.dailyLossLimit = dailyLoss;
      }

      const profile = await db
        .prepare("SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?")
        .get(profileId, req.user.id);
      if (!profile) {
        return res
          .status(404)
          .json({ success: false, error: "Profile not found" });
      }

      await db
        .prepare("UPDATE trading_profiles SET safety_settings = ? WHERE id = ?")
        .run(JSON.stringify(settings), profileId);

      res.json({
        success: true,
        message: "Safety settings updated successfully.",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// POST /api/settings/safety/reset-peak
settingsRouter.post(
  "/safety/reset-peak",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { profileId } = req.body;
      if (!profileId) {
        return res
          .status(400)
          .json({ success: false, error: "profileId is required" });
      }

      const profile = await db
        .prepare("SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?")
        .get(profileId, req.user.id);
      if (!profile) {
        return res
          .status(404)
          .json({ success: false, error: "Profile not found" });
      }

      // Set peak_balance to 0 so the next bot tick instantly overwrites it with the current live balance
      await db
        .prepare("UPDATE trading_profiles SET peak_balance = 0 WHERE id = ?")
        .run(profileId);

      res.json({
        success: true,
        message: "Peak balance watermark has been successfully reset.",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// POST /api/settings/unlock-pair
settingsRouter.post(
  "/unlock-pair",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { profileId, symbol } = req.body;
      if (!profileId || !symbol) {
        return res
          .status(400)
          .json({ success: false, error: "profileId and symbol are required" });
      }

      const profile = (await db
        .prepare(
          "SELECT locked_pairs FROM trading_profiles WHERE id = ? AND user_id = ?",
        )
        .get(profileId, req.user.id)) as any;
      if (!profile)
        return res
          .status(404)
          .json({ success: false, error: "Profile not found" });

      let lockedPairs: string[] = [];
      try {
        lockedPairs = JSON.parse(profile.locked_pairs || "[]");
      } catch (e) {}

      lockedPairs = lockedPairs.filter((s) => s !== symbol);

      await db
        .prepare("UPDATE trading_profiles SET locked_pairs = ? WHERE id = ?")
        .run(JSON.stringify(lockedPairs), profileId);

      // Also clear from memory if present
      const status = safetyStatusMap.get(Number(profileId));
      if (status && status.blockedPairs && status.blockedPairs[symbol]) {
        delete status.blockedPairs[symbol];
      }

      res.json({
        success: true,
        message: `${symbol} unlocked successfully.`,
        locked_pairs: lockedPairs,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// GET /api/settings/logs
settingsRouter.get(
  "/logs",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const profileId = req.query.profileId;
      if (!profileId) {
        return res
          .status(400)
          .json({ success: false, error: "profileId is required" });
      }

      const logs = await db
        .prepare(
          `
      SELECT bot_id, symbol, action, details, created_at
      FROM bot_logs
      WHERE profile_id = ?
      ORDER BY created_at DESC
      LIMIT 200
    `,
        )
        .all(profileId);

      res.json({ success: true, logs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// DELETE /api/settings/logs
settingsRouter.delete(
  "/logs",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const profileId = req.query.profileId;
      if (!profileId) {
        return res
          .status(400)
          .json({ success: false, error: "profileId is required" });
      }

      await db
        .prepare("DELETE FROM bot_logs WHERE profile_id = ?")
        .run(profileId);
      res.json({ success: true, message: "Logs cleared successfully" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);
// GET /api/settings/ai-decisions
settingsRouter.get(
  "/ai-decisions",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const profileId = req.query.profileId;
      if (!profileId) {
        return res
          .status(400)
          .json({ success: false, error: "profileId is required" });
      }

      const decisions = await db
        .prepare(
          `
      SELECT id, symbol, direction, verdict, reasoning, setup_json, created_at
      FROM ai_decisions
      WHERE profile_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `,
        )
        .all(profileId);

      res.json({ success: true, decisions });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// --- DWCB Settings ---

// GET /api/settings/dwcb
settingsRouter.get("/dwcb", requireAuth, async (req: any, res: any) => {
  try {
    const profileId = req.query.profileId;
    if (!profileId)
      return res
        .status(400)
        .json({ success: false, error: "profileId is required" });

    const profile = (await db
      .prepare(
        "SELECT dwcb_enabled, dwcb_peak_balance FROM trading_profiles WHERE id = ? AND user_id = ?",
      )
      .get(profileId, req.user.id)) as any;
    if (!profile)
      return res
        .status(404)
        .json({ success: false, error: "Profile not found" });

    res.json({
      success: true,
      dwcb: {
        enabled: profile.dwcb_enabled === 1,
        peakBalance: profile.dwcb_peak_balance,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/settings/dwcb/reset-peak
settingsRouter.post(
  "/dwcb/reset-peak",
  requireAuth,
  async (req: any, res: any) => {
    try {
      const { profileId, balance } = req.body;
      if (!profileId)
        return res
          .status(400)
          .json({ success: false, error: "profileId is required" });

      const profile = await db
        .prepare("SELECT id FROM trading_profiles WHERE id = ? AND user_id = ?")
        .get(profileId, req.user.id);
      if (!profile)
        return res
          .status(404)
          .json({ success: false, error: "Profile not found" });

      // Set peak_balance to the provided balance or null
      await db
        .prepare(
          "UPDATE trading_profiles SET dwcb_peak_balance = ? WHERE id = ?",
        )
        .run(balance !== undefined ? balance : null, profileId);
      res.json({
        success: true,
        message: "DWCB peak balance reset successfully.",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ── POST /api/settings/bot-risk ─────────────────────────────────────────────
// Reliable HTTP fallback for persisting bot-level risk to DB.
// The socket handler also does this, but this endpoint guarantees
// the value is written even if the socket event is dropped.
settingsRouter.post("/bot-risk", requireAuth, async (req: any, res: any) => {
  try {
    const { profileId, botId, riskPct } = req.body;
    if (!profileId || !botId || riskPct === undefined) {
      return res
        .status(400)
        .json({
          success: false,
          error: "profileId, botId, riskPct are required",
        });
    }

    // Security: verify the user owns this profile
    const profile = (await db
      .prepare(
        "SELECT bot_risks FROM trading_profiles WHERE id = ? AND user_id = ?",
      )
      .get(profileId, req.user.id)) as any;
    if (!profile)
      return res.status(403).json({ success: false, error: "Unauthorized" });

    const existing = (() => {
      try {
        return JSON.parse(profile.bot_risks || "{}");
      } catch {
        return {};
      }
    })();
    existing[botId] = Number(riskPct);
    await db
      .prepare("UPDATE trading_profiles SET bot_risks = ? WHERE id = ?")
      .run(JSON.stringify(existing), profileId);

    // Also update the live orchestrator in-memory if it's running
    try {
      const { LiveOrchestrator } =
        await import("../trading/index.js");
      const orch = LiveOrchestrator.getInstance(Number(profileId));
      if (orch) {
        orch.setBotRisk(botId, Number(riskPct));
        orch.refreshProfileCache().catch(() => {});
      }
    } catch (e) {
      /* orchestrator may not be loaded */
    }

    console.log(
      `[Settings] ✅ Bot risk saved: profile=${profileId} bot=${botId} risk=${riskPct}%`,
    );
    res.json({ success: true, botId, riskPct: Number(riskPct) });
  } catch (err: any) {
    console.error("[Settings] bot-risk save error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


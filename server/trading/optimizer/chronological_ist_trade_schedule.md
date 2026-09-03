# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **27 active setups** in `server/trading/config/PairConfig.ts`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **03:46 AM IST** | `asia` | `NAS100.DAILY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 350 pips | **3.7%** | None | Sunday, Thursday | None |
| **04:31 AM IST** | `asia` | `CADJPY` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 30 – 80 pips | **2.3%** | None | None | None |
| **05:30 AM IST** | `asia` | `XTIUSD` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 20 – 40 pips | **3.1%** | None | Tuesday | None |
| **05:46 AM IST** | `asia` | `SPX500.DAILY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 5 – 40 pips | **1.2%** | None | None | None |
| **06:01 AM IST** | `asia` | `EURUSD` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 20 – 60 pips | **2.2%** | None | None | None |
| **06:31 AM IST** | `asia` | `XAUUSD` | Mage | ORB Breakout | 10 Mins | 120 Mins | 30 – 200 pips | **1.5%** | None | None | None |
| **06:31 AM IST** | `asia` | `GER40.DAILY` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 70 – 150 pips | **4.3%** | None | None | None |
| **07:01 AM IST** | `asia` | `USDJPY` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 30 – 50 pips | **1.2%** | None | None | None |
| **07:16 AM IST** | `asia` | `NAS100.DAILY` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 120 – 200 pips | **1.4%** | None | None | None |
| **07:16 AM IST** | `asia` | `US30.DAILY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 120 – 150 pips | **1.4%** | None | None | None |
| **07:31 AM IST** | `asia` | `EURAUD` | Sage | Liquidity Sweep | 30 Mins | 5 Mins | 60 – 300 pips | **1.2%** | None | None | None |
| **08:31 AM IST** | `asia` | `USDJPY` | Sage | Liquidity Sweep | 120 Mins | 60 Mins | 30 – 50 pips | **2.5%** | None | None | None |
| **12:01 PM IST** | `london` | `AUDJPY` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 20 – 60 pips | **1.3%** | None | Thursday | None |
| **12:46 PM IST** | `london` | `NAS100.DAILY` | Sage | Liquidity Sweep | 15 Mins | 5 Mins | 70 – 300 pips | **1.2%** | None | None | None |
| **12:46 PM IST** | `london` | `CHFJPY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 40 – 60 pips | **2.3%** | None | None | None |
| **01:16 PM IST** | `london` | `NZDUSD` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 10 – 80 pips | **2.8%** | None | None | None |
| **01:46 PM IST** | `london` | `GER40.DAILY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 50 – 140 pips | **1.2%** | None | None | None |
| **01:46 PM IST** | `london` | `GER40.DAILY` | Sage | Liquidity Sweep | 60 Mins | 5 Mins | 10 – 200 pips | **2.9%** | None | None | None |
| **03:01 PM IST** | `london` | `EURNZD` | Sage | Liquidity Sweep | 120 Mins | 60 Mins | 70 – 100 pips | **4.3%** | None | None | None |
| **05:30 PM IST** | `ny` | `GER40` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 50 – 60 pips | **4.3%** | 08:30 PM IST | Wednesday | None |
| **06:46 PM IST** | `NY_Forex` | `USDCHF` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 25 – 80 pips | **1.2%** | None | None | None |
| **07:01 PM IST** | `NY_Forex` | `USDCAD` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 20 – 35 pips | **2.4%** | None | None | None |
| **07:31 PM IST** | `NY_Forex` | `EURCAD` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 40 – 100 pips | **2.3%** | None | None | None |
| **07:46 PM IST** | `NY_Forex` | `GBPJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 25 – 50 pips | **2.0%** | None | Wednesday | None |
| **07:46 PM IST** | `NY_Forex` | `SPX500.DAILY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 7 – 80 pips | **2.4%** | None | None | None |
| **07:46 PM IST** | `NY_Indices` | `SPX500.DAILY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 30 – 40 pips | **3.5%** | None | None | None |
| **08:01 PM IST** | `NY_Forex` | `XAUUSD` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 30 – 80 pips | **2.6%** | None | None | None |

---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - NAS100.DAILY (Mage) - 03:46 AM IST, CADJPY (Sage) - 04:31 AM IST, XTIUSD (Seer) - 05:30 AM IST, SPX500.DAILY (Mage) - 05:46 AM IST, EURUSD (Sage) - 06:01 AM IST, XAUUSD (Mage) - 06:31 AM IST, GER40.DAILY (Sage) - 06:31 AM IST, USDJPY (Sage) - 07:01 AM IST, NAS100.DAILY (Sage) - 07:16 AM IST, US30.DAILY (Sage) - 07:16 AM IST, EURAUD (Sage) - 07:31 AM IST, USDJPY (Sage) - 08:31 AM IST

2. **London Open Trade Cluster**
   - AUDJPY (Sage) - 12:01 PM IST, NAS100.DAILY (Sage) - 12:46 PM IST, CHFJPY (Sage) - 12:46 PM IST, NZDUSD (Sage) - 01:16 PM IST, GER40.DAILY (Mage) - 01:46 PM IST, GER40.DAILY (Sage) - 01:46 PM IST, EURNZD (Sage) - 03:01 PM IST

3. **New York Pre-Market & Open Trade Cluster**
   - GER40 (Seer) - 05:30 PM IST, USDCHF (Sage) - 06:46 PM IST, USDCAD (Sage) - 07:01 PM IST, EURCAD (Sage) - 07:31 PM IST, GBPJPY (Mage) - 07:46 PM IST, SPX500.DAILY (Mage) - 07:46 PM IST, SPX500.DAILY (Sage) - 07:46 PM IST, XAUUSD (Sage) - 08:01 PM IST

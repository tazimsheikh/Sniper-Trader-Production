# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **50 active setups** in `server/trading/config/PairConfig.ts`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **02:46 AM IST** | `asia` | `EURCAD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 25 – 50 pips | **2.5%** | None | Sunday | None |
| **03:46 AM IST** | `asia` | `NAS100.DAILY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 15 – 80 pips | **2.5%** | None | Sunday, Thursday | None |
| **04:31 AM IST** | `asia` | `CADJPY` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 40 – 60 pips | **2.5%** | None | None | None |
| **04:31 AM IST** | `asia` | `CADJPY` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 30 – 80 pips | **2.5%** | None | None | None |
| **05:30 AM IST** | `asia` | `US30.DAILY` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 100 – 200 pips | **2.5%** | None | None | None |
| **05:30 AM IST** | `asia` | `GBPAUD` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 40 – 100 pips | **0.8%** | 05:30 AM IST | Tuesday | None |
| **06:01 AM IST** | `asia` | `EURUSD` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 20 – 60 pips | **2.5%** | None | None | None |
| **06:31 AM IST** | `asia` | `XAUUSD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 30 – 80 pips | **2.5%** | None | None | None |
| **06:31 AM IST** | `asia` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 30 – 30 pips | **1.6%** | 08:30 AM IST | None | None |
| **06:31 AM IST** | `asia` | `GER40.DAILY` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 70 – 150 pips | **2.5%** | None | None | None |
| **07:16 AM IST** | `asia` | `US30.DAILY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 120 – 150 pips | **2.2%** | None | None | None |
| **07:16 AM IST** | `asia` | `US30.DAILY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 120 – 150 pips | **2.4%** | None | None | None |
| **07:16 AM IST** | `asia` | `NAS100.DAILY` | Sage | Liquidity Sweep | 60 Mins | 5 Mins | 120 – 150 pips | **2.5%** | None | None | None |
| **07:31 AM IST** | `asia` | `EURAUD` | Sage | Liquidity Sweep | 30 Mins | 5 Mins | 60 – 300 pips | **1.4%** | None | None | None |
| **08:01 AM IST** | `asia` | `EURUSD` | Sage | Liquidity Sweep | 60 Mins | 15 Mins | 10 – 40 pips | **2.5%** | None | None | None |
| **08:31 AM IST** | `asia` | `GBPAUD` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 30 – 100 pips | **1.0%** | None | None | None |
| **08:31 AM IST** | `asia` | `USDJPY` | Sage | Liquidity Sweep | 120 Mins | 60 Mins | 30 – 50 pips | **2.5%** | None | None | None |
| **11:46 AM IST** | `london` | `CHFJPY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 40 – 100 pips | **0.8%** | None | None | None |
| **11:51 AM IST** | `london` | `NAS100.DAILY` | Mage | ORB Breakout | 15 Mins | 120 Mins | 50 – 180 pips | **1.8%** | None | None | None |
| **12:31 PM IST** | `london` | `GER40.DAILY` | Sage | Liquidity Sweep | 60 Mins | 15 Mins | 40 – 150 pips | **2.5%** | None | None | None |
| **12:46 PM IST** | `london` | `EURUSD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 12.5 – 30 pips | **2.5%** | None | Monday | None |
| **12:46 PM IST** | `london` | `NAS100.DAILY` | Sage | Liquidity Sweep | 15 Mins | 5 Mins | 70 – 300 pips | **1.4%** | None | None | None |
| **01:16 PM IST** | `london` | `USDCAD` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 25 – 30 pips | **2.0%** | None | None | None |
| **01:46 PM IST** | `london` | `USDCHF` | Mage | ORB Breakout | 10 Mins | 60 Mins | 15 – 20 pips | **1.0%** | None | None | None |
| **01:46 PM IST** | `london` | `GER40.DAILY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 30 – 100 pips | **1.9%** | None | None | None |
| **01:46 PM IST** | `london` | `XAUUSD` | Sage | Liquidity Sweep | 60 Mins | 10 Mins | 30 – 120 pips | **0.8%** | None | None | None |
| **01:51 PM IST** | `london` | `GBPAUD` | Mage | ORB Breakout | 15 Mins | 60 Mins | 15 – 70 pips | **1.9%** | None | Monday, Thursday | None |
| **02:01 PM IST** | `london` | `XAUUSD` | Sage | Liquidity Sweep | 60 Mins | 15 Mins | 40 – 120 pips | **2.5%** | None | None | None |
| **02:31 PM IST** | `london` | `GER40.DAILY` | Sage | Liquidity Sweep | 60 Mins | 15 Mins | 120 – 200 pips | **2.5%** | None | None | None |
| **02:31 PM IST** | `london` | `USDJPY` | Sage | Liquidity Sweep | 60 Mins | 15 Mins | 25 – 35 pips | **2.1%** | None | None | None |
| **02:31 PM IST** | `london` | `NZDUSD` | Sage | Liquidity Sweep | 120 Mins | 15 Mins | 15 – 30 pips | **0.8%** | None | None | None |
| **03:01 PM IST** | `london` | `GBPUSD` | Sage | Liquidity Sweep | 120 Mins | 15 Mins | 20 – 30 pips | **1.5%** | 06:30 PM IST | None | None |
| **03:01 PM IST** | `london` | `EURAUD` | Sage | Liquidity Sweep | 120 Mins | 5 Mins | 60 – 200 pips | **1.3%** | None | None | None |
| **05:30 PM IST** | `ny` | `GER40.DAILY` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 50 – 60 pips | **2.5%** | 08:30 PM IST | Wednesday | None |
| **06:01 PM IST** | `NY_Indices` | `GER40.DAILY` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 70 – 150 pips | **2.5%** | None | None | None |
| **06:01 PM IST** | `NY_Indices` | `GER40.DAILY` | Sage | Liquidity Sweep | 30 Mins | 5 Mins | 70 – 200 pips | **2.5%** | None | None | None |
| **06:21 PM IST** | `NY_Forex` | `GBPAUD` | Mage | ORB Breakout | 15 Mins | 120 Mins | 25 – 80 pips | **2.0%** | None | None | None |
| **06:21 PM IST** | `NY_Forex` | `AUDJPY` | Mage | ORB Breakout | 15 Mins | 180 Mins | 25 – 40 pips | **1.7%** | None | None | None |
| **06:31 PM IST** | `NY_Forex` | `EURCAD` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 20 – 100 pips | **1.0%** | None | Thursday | None |
| **06:46 PM IST** | `NY_Forex` | `USDCHF` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 25 – 50 pips | **0.8%** | None | None | None |
| **07:01 PM IST** | `NY_Indices` | `US30.DAILY` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 20 – 200 pips | **1.5%** | 10:30 PM IST | None | None |
| **07:21 PM IST** | `NY_Forex` | `EURUSD` | Mage | ORB Breakout | 15 Mins | 60 Mins | 10 – 40 pips | **1.8%** | None | None | None |
| **07:21 PM IST** | `NY_Forex` | `GBPUSD` | Mage | ORB Breakout | 15 Mins | 60 Mins | 7.5 – 80 pips | **1.8%** | None | Monday | None |
| **07:31 PM IST** | `NY_Indices` | `US30.DAILY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 40 – 300 pips | **2.5%** | None | None | None |
| **07:31 PM IST** | `NY_Indices` | `US30.DAILY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 120 – 150 pips | **1.8%** | None | None | None |
| **07:31 PM IST** | `NY_Forex` | `CHFJPY` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 20 – 60 pips | **0.8%** | None | None | None |
| **07:36 PM IST** | `NY_Forex` | `USDCHF` | Mage | ORB Breakout | 15 Mins | 60 Mins | 10 – 50 pips | **2.4%** | None | None | None |
| **08:01 PM IST** | `NY_Forex` | `USDJPY` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 25 – 35 pips | **1.1%** | None | None | None |
| **08:01 PM IST** | `NY_Forex` | `AUDJPY` | Sage | Liquidity Sweep | 120 Mins | 15 Mins | 60 – 80 pips | **2.5%** | None | None | None |
| **08:31 PM IST** | `NY_Indices` | `NAS100.DAILY` | Sage | Liquidity Sweep | 60 Mins | 15 Mins | 20 – 150 pips | **1.0%** | None | None | None |

---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - EURCAD (Mage) - 02:46 AM IST, NAS100.DAILY (Mage) - 03:46 AM IST, CADJPY (Sage) - 04:31 AM IST, CADJPY (Sage) - 04:31 AM IST, US30.DAILY (Seer) - 05:30 AM IST, GBPAUD (Seer) - 05:30 AM IST, EURUSD (Sage) - 06:01 AM IST, XAUUSD (Mage) - 06:31 AM IST, USDJPY (Mage) - 06:31 AM IST, GER40.DAILY (Sage) - 06:31 AM IST, US30.DAILY (Sage) - 07:16 AM IST, US30.DAILY (Sage) - 07:16 AM IST, NAS100.DAILY (Sage) - 07:16 AM IST, EURAUD (Sage) - 07:31 AM IST, EURUSD (Sage) - 08:01 AM IST, GBPAUD (Sage) - 08:31 AM IST, USDJPY (Sage) - 08:31 AM IST

2. **London Open Trade Cluster**
   - CHFJPY (Sage) - 11:46 AM IST, NAS100.DAILY (Mage) - 11:51 AM IST, GER40.DAILY (Sage) - 12:31 PM IST, EURUSD (Mage) - 12:46 PM IST, NAS100.DAILY (Sage) - 12:46 PM IST, USDCAD (Sage) - 01:16 PM IST, USDCHF (Mage) - 01:46 PM IST, GER40.DAILY (Mage) - 01:46 PM IST, XAUUSD (Sage) - 01:46 PM IST, GBPAUD (Mage) - 01:51 PM IST, XAUUSD (Sage) - 02:01 PM IST, GER40.DAILY (Sage) - 02:31 PM IST, USDJPY (Sage) - 02:31 PM IST, NZDUSD (Sage) - 02:31 PM IST, GBPUSD (Sage) - 03:01 PM IST, EURAUD (Sage) - 03:01 PM IST

3. **New York Pre-Market & Open Trade Cluster**
   - GER40.DAILY (Seer) - 05:30 PM IST, GER40.DAILY (Sage) - 06:01 PM IST, GER40.DAILY (Sage) - 06:01 PM IST, GBPAUD (Mage) - 06:21 PM IST, AUDJPY (Mage) - 06:21 PM IST, EURCAD (Sage) - 06:31 PM IST, USDCHF (Sage) - 06:46 PM IST, US30.DAILY (Sage) - 07:01 PM IST, EURUSD (Mage) - 07:21 PM IST, GBPUSD (Mage) - 07:21 PM IST, US30.DAILY (Sage) - 07:31 PM IST, US30.DAILY (Sage) - 07:31 PM IST, CHFJPY (Sage) - 07:31 PM IST, USDCHF (Mage) - 07:36 PM IST, USDJPY (Sage) - 08:01 PM IST, AUDJPY (Sage) - 08:01 PM IST, NAS100.DAILY (Sage) - 08:31 PM IST

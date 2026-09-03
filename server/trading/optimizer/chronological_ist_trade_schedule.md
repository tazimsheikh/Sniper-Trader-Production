# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **28 active setups** in `server/trading/config/PairConfig.ts`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **05:30 AM IST** | `asia` | `XTIUSD` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 20 – 40 pips | **3.7%** | None | Tuesday | None |
| **05:31 AM IST** | `asia` | `EURJPY` | Sage | Liquidity Sweep | 120 Mins | 15 Mins | 60 – 80 pips | **1.6%** | 07:30 AM IST | Monday | None |
| **06:01 AM IST** | `asia` | `EURUSD` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 20 – 60 pips | **2.3%** | None | None | None |
| **06:31 AM IST** | `asia` | `XAUUSD` | Mage | ORB Breakout | 10 Mins | 120 Mins | 30 – 80 pips | **4.6%** | None | None | None |
| **06:31 AM IST** | `asia` | `XAUUSD` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 40 – 120 pips | **1.6%** | None | None | None |
| **07:01 AM IST** | `asia` | `EURCAD` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 50 – 80 pips | **1.6%** | None | None | None |
| **07:31 AM IST** | `asia` | `USDCAD` | Sage | Liquidity Sweep | 120 Mins | 30 Mins | 25 – 50 pips | **1.6%** | None | Friday | None |
| **10:21 AM IST** | `asia` | `USDCHF` | Mage | ORB Breakout | 45 Mins | 180 Mins | 10 – 120 pips | **5.9%** | None | Wednesday, Friday | None |
| **12:01 PM IST** | `london` | `AUDJPY` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 20 – 60 pips | **1.6%** | None | Thursday | None |
| **12:01 PM IST** | `london` | `CHFJPY` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 30 – 60 pips | **2.1%** | None | None | None |
| **12:46 PM IST** | `london` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 60 Mins | 25 – 30 pips | **5.2%** | 02:30 PM IST | None | None |
| **12:46 PM IST** | `london` | `EURUSD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 12.5 – 30 pips | **5.9%** | 12:30 PM IST | Monday | None |
| **01:01 PM IST** | `london` | `USDCHF` | Mage | ORB Breakout | 10 Mins | 60 Mins | 8 – 70 pips | **3.9%** | None | Tuesday, Friday | None |
| **01:16 PM IST** | `london` | `AUDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 150 pips | **5.9%** | 02:30 PM IST, 04:30 PM IST, 05:30 PM IST, 06:30 PM IST | Monday, Friday | None |
| **01:16 PM IST** | `london` | `CADJPY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 30 – 60 pips | **3.1%** | None | Monday | None |
| **01:16 PM IST** | `london` | `AUDUSD` | Mage | ORB Breakout | 10 Mins | 180 Mins | 8 – 20 pips | **1.8%** | 12:30 PM IST, 03:30 PM IST | Friday | None |
| **01:31 PM IST** | `london` | `GBPAUD` | Sage | Liquidity Sweep | 120 Mins | 30 Mins | 50 – 100 pips | **1.6%** | None | None | None |
| **01:46 PM IST** | `london` | `GBPUSD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 12.5 – 20 pips | **5.9%** | 02:30 PM IST, 04:30 PM IST | Thursday | None |
| **01:46 PM IST** | `london` | `EURUSD` | Sage | Liquidity Sweep | 60 Mins | 10 Mins | 20 – 30 pips | **1.6%** | None | None | None |
| **03:01 PM IST** | `london` | `EURCAD` | Sage | Liquidity Sweep | 120 Mins | 30 Mins | 60 – 100 pips | **1.6%** | 06:30 PM IST | None | None |
| **05:30 PM IST** | `ny` | `GER40` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 50 – 60 pips | **5.9%** | 08:30 PM IST | Wednesday | None |
| **06:21 PM IST** | `NY_Forex` | `AUDJPY` | Mage | ORB Breakout | 15 Mins | 180 Mins | 20 – 40 pips | **5.9%** | None | None | None |
| **06:46 PM IST** | `NY_Forex` | `USDCHF` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 25 – 80 pips | **1.6%** | None | None | None |
| **07:01 PM IST** | `NY_Forex` | `USDCAD` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 20 – 35 pips | **3.0%** | None | None | None |
| **07:16 PM IST** | `NY_Forex` | `GBPUSD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 5 – 30 pips | **4.3%** | 06:30 PM IST | Monday, Tuesday | None |
| **07:16 PM IST** | `NY_Forex` | `NZDUSD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 8 – 30 pips | **1.8%** | None | None | None |
| **07:46 PM IST** | `NY_Forex` | `EURJPY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 30 – 100 pips | **2.5%** | 09:30 PM IST | Tuesday, Wednesday | None |
| **08:01 PM IST** | `NY_Forex` | `AUDJPY` | Sage | Liquidity Sweep | 60 Mins | 15 Mins | 50 – 80 pips | **2.5%** | None | None | None |

---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - XTIUSD (Seer) - 05:30 AM IST, EURJPY (Sage) - 05:31 AM IST, EURUSD (Sage) - 06:01 AM IST, XAUUSD (Mage) - 06:31 AM IST, XAUUSD (Sage) - 06:31 AM IST, EURCAD (Sage) - 07:01 AM IST, USDCAD (Sage) - 07:31 AM IST, USDCHF (Mage) - 10:21 AM IST

2. **London Open Trade Cluster**
   - AUDJPY (Sage) - 12:01 PM IST, CHFJPY (Sage) - 12:01 PM IST, USDJPY (Mage) - 12:46 PM IST, EURUSD (Mage) - 12:46 PM IST, USDCHF (Mage) - 01:01 PM IST, AUDJPY (Mage) - 01:16 PM IST, CADJPY (Mage) - 01:16 PM IST, AUDUSD (Mage) - 01:16 PM IST, GBPAUD (Sage) - 01:31 PM IST, GBPUSD (Mage) - 01:46 PM IST, EURUSD (Sage) - 01:46 PM IST, EURCAD (Sage) - 03:01 PM IST

3. **New York Pre-Market & Open Trade Cluster**
   - GER40 (Seer) - 05:30 PM IST, AUDJPY (Mage) - 06:21 PM IST, USDCHF (Sage) - 06:46 PM IST, USDCAD (Sage) - 07:01 PM IST, GBPUSD (Mage) - 07:16 PM IST, NZDUSD (Mage) - 07:16 PM IST, EURJPY (Mage) - 07:46 PM IST, AUDJPY (Sage) - 08:01 PM IST

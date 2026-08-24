# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **27 active setups** in `server/trading/config/PairConfig.ts`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **06:01 AM IST** | `asia` | `USDCHF` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 30 – 50 pips | **1.8%** | 11:30 AM IST | Friday | None |
| **06:01 AM IST** | `asia` | `USDCHF` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 30 – 35 pips | **1.8%** | 11:30 AM IST | Friday | None |
| **06:16 AM IST** | `asia` | `CHFJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 20 – 150 pips | **1.6%** | None | None | None |
| **06:16 AM IST** | `asia` | `CHFJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 20 – 70 pips | **1.6%** | None | None | None |
| **07:01 AM IST** | `asia` | `EURCAD` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 50 – 80 pips | **2.5%** | None | None | None |
| **07:31 AM IST** | `asia` | `EURNZD` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 50 – 100 pips | **2.0%** | None | None | None |
| **10:21 AM IST** | `asia` | `USDCHF` | Mage | ORB Breakout | 45 Mins | 180 Mins | 8 – 100 pips | **3.1%** | 11:30 AM IST | Friday | None |
| **10:21 AM IST** | `asia` | `USDCHF` | Mage | ORB Breakout | 45 Mins | 180 Mins | 8 – 120 pips | **3.1%** | 11:30 AM IST | Friday | None |
| **11:46 AM IST** | `london` | `CHFJPY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 40 – 60 pips | **1.7%** | None | None | None |
| **11:46 AM IST** | `london` | `CHFJPY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 40 – 100 pips | **1.7%** | None | None | None |
| **12:46 PM IST** | `london` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 60 Mins | 25 – 30 pips | **1.8%** | 02:30 PM IST | Tuesday | None |
| **01:16 PM IST** | `london` | `XAUUSD` | Mage | ORB Breakout | 10 Mins | 180 Mins | 40 – 200 pips | **1.7%** | 04:30 PM IST, 06:30 PM IST | None | None |
| **01:16 PM IST** | `london` | `AUDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 60 pips | **2.2%** | 02:30 PM IST, 04:30 PM IST, 05:30 PM IST, 06:30 PM IST, 08:30 PM IST | Monday, Wednesday, Friday | None |
| **01:16 PM IST** | `london` | `CADJPY` | Mage | ORB Breakout | 10 Mins | 60 Mins | 20 – 80 pips | **2.5%** | 01:30 PM IST | Monday | None |
| **01:16 PM IST** | `london` | `USDCAD` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 25 – 50 pips | **1.6%** | None | Thursday | None |
| **01:46 PM IST** | `london` | `EURUSD` | Sage | Liquidity Sweep | 60 Mins | 10 Mins | 15 – 80 pips | **1.6%** | 05:30 PM IST, 11:30 PM IST | None | None |
| **01:46 PM IST** | `london` | `EURUSD` | Sage | Liquidity Sweep | 60 Mins | 10 Mins | 15 – 80 pips | **1.6%** | 05:30 PM IST, 11:30 PM IST | None | None |
| **02:46 PM IST** | `london` | `GBPNZD` | Mage | ORB Breakout | 10 Mins | 180 Mins | 40 – 60 pips | **1.2%** | None | None | None |
| **06:01 PM IST** | `NY_Indices` | `GER40` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 70 – 150 pips | **3.4%** | None | None | None |
| **06:01 PM IST** | `NY_Indices` | `GER40` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 70 – 80 pips | **3.4%** | None | None | None |
| **06:16 PM IST** | `NY_Forex` | `GER40` | Mage | ORB Breakout | 10 Mins | 60 Mins | 120 – 250 pips | **1.9%** | None | None | None |
| **06:16 PM IST** | `NY_Forex` | `GER40` | Mage | ORB Breakout | 10 Mins | 60 Mins | 120 – 200 pips | **1.8%** | None | None | None |
| **06:46 PM IST** | `NY_Forex` | `SPX500` | Mage | ORB Breakout | 10 Mins | 120 Mins | 40 – 40 pips | **2.4%** | None | None | None |
| **07:21 PM IST** | `NY_Forex` | `GBPUSD` | Mage | ORB Breakout | 15 Mins | 60 Mins | 7.5 – 80 pips | **2.1%** | None | Monday, Tuesday | None |
| **07:31 PM IST** | `NY_Forex` | `EURUSD` | Mage | ORB Breakout | 10 Mins | 180 Mins | 5 – 50 pips | **1.8%** | 05:30 PM IST, 11:30 PM IST | None | None |
| **07:31 PM IST** | `NY_Forex` | `EURUSD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 5 – 30 pips | **1.8%** | 05:30 PM IST, 11:30 PM IST | None | None |
| **07:31 PM IST** | `NY_Indices` | `US30` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 40 – 300 pips | **2.5%** | None | None | None |

---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - USDCHF (Sage) - 06:01 AM IST, USDCHF (Sage) - 06:01 AM IST, CHFJPY (Mage) - 06:16 AM IST, CHFJPY (Mage) - 06:16 AM IST, EURCAD (Sage) - 07:01 AM IST, EURNZD (Sage) - 07:31 AM IST, USDCHF (Mage) - 10:21 AM IST, USDCHF (Mage) - 10:21 AM IST

2. **London Open Trade Cluster**
   - CHFJPY (Sage) - 11:46 AM IST, CHFJPY (Sage) - 11:46 AM IST, USDJPY (Mage) - 12:46 PM IST, XAUUSD (Mage) - 01:16 PM IST, AUDJPY (Mage) - 01:16 PM IST, CADJPY (Mage) - 01:16 PM IST, USDCAD (Sage) - 01:16 PM IST, EURUSD (Sage) - 01:46 PM IST, EURUSD (Sage) - 01:46 PM IST, GBPNZD (Mage) - 02:46 PM IST

3. **New York Pre-Market & Open Trade Cluster**
   - GER40 (Sage) - 06:01 PM IST, GER40 (Sage) - 06:01 PM IST, GER40 (Mage) - 06:16 PM IST, GER40 (Mage) - 06:16 PM IST, SPX500 (Mage) - 06:46 PM IST, GBPUSD (Mage) - 07:21 PM IST, EURUSD (Mage) - 07:31 PM IST, EURUSD (Mage) - 07:31 PM IST, US30 (Sage) - 07:31 PM IST

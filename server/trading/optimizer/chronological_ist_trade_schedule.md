# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **21 active setups** in `server/trading/config/PairConfig.ts`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **04:00 AM IST** | `asia` | `NZDUSD` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 15 – 50 pips | **4.5%** | 06:30 AM IST | None | None |
| **05:30 AM IST** | `asia` | `GBPJPY` | Sage | Liquidity Sweep | 120 Mins | 30 Mins | 20 – 80 pips | **3.2%** | 02:30 PM IST, 03:30 PM IST, 07:30 AM IST, 08:30 AM IST | None | None |
| **06:25 AM IST** | `asia` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 30 pips | **1.9%** | 11:30 AM IST, 04:30 PM IST | None | None |
| **07:30 AM IST** | `asia` | `NAS100` | Sage | Liquidity Sweep | 60 Mins | 10 Mins | 120 – 200 pips | **2.5%** | 04:30 PM IST | None | None |
| **09:40 AM IST** | `asia` | `GBPAUD` | Mage | ORB Breakout | 10 Mins | 120 Mins | 30 – 40 pips | **2.3%** | 09:30 PM IST | None | None |
| **10:30 AM IST** | `asia` | `NAS100` | Mage | ORB Breakout | 60 Mins | 180 Mins | 30 – 60 pips | **1.9%** | 04:30 PM IST | None | None |
| **12:00 PM IST** | `london` | `CHFJPY` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 30 – 80 pips | **5.8%** | None | None | None |
| **12:40 PM IST** | `london` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 25 – 70 pips | **2.2%** | 11:30 AM IST, 04:30 PM IST | None | None |
| **12:55 PM IST** | `london` | `GER40` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 350 pips | **4.6%** | None | None | None |
| **01:00 PM IST** | `london` | `AUDUSD` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 10 – 30 pips | **5.9%** | None | None | None |
| **01:10 PM IST** | `london` | `NAS100` | Mage | ORB Breakout | 10 Mins | 120 Mins | 30 – 250 pips | **4.9%** | 04:30 PM IST | None | None |
| **01:40 PM IST** | `london` | `GBPJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 20 – 50 pips | **5.8%** | 02:30 PM IST, 03:30 PM IST, 07:30 AM IST, 08:30 AM IST | None | None |
| **01:40 PM IST** | `london` | `US30` | Mage | ORB Breakout | 10 Mins | 60 Mins | 30 – 100 pips | **3.3%** | None | None | None |
| **01:45 PM IST** | `london` | `EURUSD` | Sage | Liquidity Sweep | 60 Mins | 10 Mins | 15 – 50 pips | **1.6%** | None | None | None |
| **05:45 PM IST** | `NY_Forex` | `US30` | Mage | ORB Breakout | 15 Mins | 120 Mins | 20 – 100 pips | **0.8%** | None | None | None |
| **06:15 PM IST** | `NY_Forex` | `GBPAUD` | Mage | ORB Breakout | 15 Mins | 180 Mins | 20 – 40 pips | **4.2%** | 09:30 PM IST | None | None |
| **06:15 PM IST** | `NY_Forex` | `NAS100` | Mage | ORB Breakout | 45 Mins | 180 Mins | 20 – 180 pips | **0.6%** | 04:30 PM IST | None | None |
| **06:30 PM IST** | `NY_Forex` | `USDCAD` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 15 – 35 pips | **9.0%** | None | None | None |
| **06:45 PM IST** | `NY_Indices` | `NAS100` | Sage | Liquidity Sweep | 15 Mins | 10 Mins | 70 – 150 pips | **9.3%** | 04:30 PM IST | None | None |
| **07:40 PM IST** | `NY_Forex` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 15 – 40 pips | **5.5%** | 11:30 AM IST, 04:30 PM IST | None | None |
| **09:00 PM IST** | `NY_Indices` | `BTCUSD` | Sage | Liquidity Sweep | 120 Mins | 10 Mins | 100 – 500 pips | **5.6%** | None | None | None |

---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - NZDUSD (Sage) - 04:00 AM IST, GBPJPY (Sage) - 05:30 AM IST, USDJPY (Mage) - 06:25 AM IST, NAS100 (Sage) - 07:30 AM IST, GBPAUD (Mage) - 09:40 AM IST, NAS100 (Mage) - 10:30 AM IST

2. **London Open Trade Cluster**
   - CHFJPY (Sage) - 12:00 PM IST, USDJPY (Mage) - 12:40 PM IST, GER40 (Mage) - 12:55 PM IST, AUDUSD (Sage) - 01:00 PM IST, NAS100 (Mage) - 01:10 PM IST, GBPJPY (Mage) - 01:40 PM IST, US30 (Mage) - 01:40 PM IST, EURUSD (Sage) - 01:45 PM IST

3. **New York Pre-Market & Open Trade Cluster**
   - US30 (Mage) - 05:45 PM IST, GBPAUD (Mage) - 06:15 PM IST, NAS100 (Mage) - 06:15 PM IST, USDCAD (Sage) - 06:30 PM IST, NAS100 (Sage) - 06:45 PM IST, USDJPY (Mage) - 07:40 PM IST, BTCUSD (Sage) - 09:00 PM IST

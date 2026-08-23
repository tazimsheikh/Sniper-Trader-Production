# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **15 active setups** in `server/trading/config/PairConfig.ts`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **04:31 AM IST** | `asia` | `CADJPY` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 40 – 60 pips | **8.5%** | None | None | None |
| **06:31 AM IST** | `asia` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 150 pips | **2.6%** | 07:30 AM IST | Tuesday | None |
| **06:31 AM IST** | `asia` | `GBPJPY` | Mage | ORB Breakout | 10 Mins | 60 Mins | 15 – 50 pips | **2.0%** | None | None | None |
| **06:31 AM IST** | `asia` | `GER40` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 70 – 150 pips | **15.1%** | 03:30 PM IST, 09:30 PM IST | None | None |
| **10:21 AM IST** | `asia` | `USDCHF` | Mage | ORB Breakout | 45 Mins | 180 Mins | 10 – 70 pips | **14.5%** | None | Wednesday | None |
| **01:01 PM IST** | `london` | `US30` | Mage | ORB Breakout | 10 Mins | 120 Mins | 50 – 350 pips | **2.0%** | 02:30 PM IST | Tuesday | None |
| **01:16 PM IST** | `london` | `XAUUSD` | Mage | ORB Breakout | 10 Mins | 120 Mins | 30 – 80 pips | **3.1%** | None | None | None |
| **01:16 PM IST** | `london` | `GBPJPY` | Mage | ORB Breakout | 10 Mins | 60 Mins | 40 – 100 pips | **5.9%** | None | None | None |
| **02:51 PM IST** | `london` | `GER40` | Mage | ORB Breakout | 15 Mins | 60 Mins | 50 – 350 pips | **2.9%** | 03:30 PM IST, 09:30 PM IST | None | None |
| **02:51 PM IST** | `london` | `JPN225` | Mage | ORB Breakout | 15 Mins | 60 Mins | 60 – 160 pips | **3.0%** | None | Thursday | None |
| **06:01 PM IST** | `NY_Indices` | `GER40` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 70 – 150 pips | **15.1%** | 03:30 PM IST, 09:30 PM IST | None | None |
| **06:46 PM IST** | `NY_Forex` | `XAUUSD` | Mage | ORB Breakout | 10 Mins | 180 Mins | 30 – 200 pips | **2.8%** | None | None | None |
| **07:16 PM IST** | `NY_Forex` | `AUDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 20 – 100 pips | **2.1%** | None | Friday | None |
| **07:31 PM IST** | `NY_Forex` | `GER40` | Mage | ORB Breakout | 10 Mins | 120 Mins | 50 – 350 pips | **5.1%** | 03:30 PM IST, 09:30 PM IST | None | None |
| **07:31 PM IST** | `NY_Forex` | `EURUSD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 5 – 40 pips | **15.1%** | None | Tuesday | None |

---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - CADJPY (Sage) - 04:31 AM IST, USDJPY (Mage) - 06:31 AM IST, GBPJPY (Mage) - 06:31 AM IST, GER40 (Sage) - 06:31 AM IST, USDCHF (Mage) - 10:21 AM IST

2. **London Open Trade Cluster**
   - US30 (Mage) - 01:01 PM IST, XAUUSD (Mage) - 01:16 PM IST, GBPJPY (Mage) - 01:16 PM IST, GER40 (Mage) - 02:51 PM IST, JPN225 (Mage) - 02:51 PM IST

3. **New York Pre-Market & Open Trade Cluster**
   - GER40 (Sage) - 06:01 PM IST, XAUUSD (Mage) - 06:46 PM IST, AUDJPY (Mage) - 07:16 PM IST, GER40 (Mage) - 07:31 PM IST, EURUSD (Mage) - 07:31 PM IST

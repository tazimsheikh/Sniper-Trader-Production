# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **11 active setups** in `server/trading/config/PairConfig.ts`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **04:00 AM IST** | `asia` | `NZDUSD` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 15 – 80 pips | **8.0%** | None | None | None |
| **05:45 AM IST** | `asia` | `USDCHF` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 20 – 35 pips | **5.9%** | None | Monday | None |
| **06:25 AM IST** | `asia` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 30 pips | **2.7%** | None | Tuesday | None |
| **07:30 AM IST** | `asia` | `NAS100` | Sage | Liquidity Sweep | 60 Mins | 10 Mins | 120 – 150 pips | **3.7%** | None | None | None |
| **12:40 PM IST** | `london` | `CHFJPY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 20 – 80 pips | **6.3%** | 07:30 PM IST | Monday, Friday | None |
| **01:10 PM IST** | `london` | `NAS100` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 180 pips | **3.6%** | None | None | None |
| **01:15 PM IST** | `london` | `US30` | Mage | ORB Breakout | 15 Mins | 180 Mins | 50 – 140 pips | **2.8%** | None | None | None |
| **01:40 PM IST** | `london` | `GBPJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 40 pips | **3.4%** | 02:30 PM IST | None | None |
| **02:45 PM IST** | `london` | `GER40` | Mage | ORB Breakout | 15 Mins | 60 Mins | 50 – 250 pips | **2.6%** | 03:30 PM IST | Wednesday | None |
| **06:15 PM IST** | `NY_Forex` | `GBPNZD` | Mage | ORB Breakout | 15 Mins | 180 Mins | 25 – 30 pips | **5.9%** | None | None | None |
| **07:25 PM IST** | `NY_Forex` | `EURJPY` | Mage | ORB Breakout | 10 Mins | 60 Mins | 15 – 30 pips | **2.6%** | None | None | None |

---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - NZDUSD (Sage) - 04:00 AM IST, USDCHF (Sage) - 05:45 AM IST, USDJPY (Mage) - 06:25 AM IST, NAS100 (Sage) - 07:30 AM IST

2. **London Open Trade Cluster**
   - CHFJPY (Mage) - 12:40 PM IST, NAS100 (Mage) - 01:10 PM IST, US30 (Mage) - 01:15 PM IST, GBPJPY (Mage) - 01:40 PM IST, GER40 (Mage) - 02:45 PM IST

3. **New York Pre-Market & Open Trade Cluster**
   - GBPNZD (Mage) - 06:15 PM IST, EURJPY (Mage) - 07:25 PM IST

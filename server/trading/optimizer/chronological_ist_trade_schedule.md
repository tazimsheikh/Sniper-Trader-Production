# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **11 active setups** in `server/trading/config/PairConfig.ts`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **04:01 AM IST** | `asia` | `NZDUSD` | Sage | Liquidity Sweep | 30 Mins | 30 Mins | 15 – 80 pips | **8.2%** | None | None | None |
| **05:46 AM IST** | `asia` | `USDCHF` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 20 – 35 pips | **6.0%** | None | Monday | None |
| **06:31 AM IST** | `asia` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 30 pips | **2.8%** | None | Tuesday | None |
| **07:31 AM IST** | `asia` | `NAS100` | Sage | Liquidity Sweep | 60 Mins | 10 Mins | 120 – 150 pips | **3.8%** | None | None | None |
| **12:46 PM IST** | `london` | `CHFJPY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 20 – 80 pips | **6.4%** | 07:30 PM IST | Friday | None |
| **01:16 PM IST** | `london` | `NAS100` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 180 pips | **3.7%** | None | None | None |
| **01:21 PM IST** | `london` | `US30` | Mage | ORB Breakout | 15 Mins | 180 Mins | 50 – 140 pips | **2.9%** | 02:30 PM IST, 03:30 PM IST | Tuesday | None |
| **01:46 PM IST** | `london` | `GBPJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 40 pips | **3.5%** | 02:30 PM IST, 03:30 PM IST | None | None |
| **02:51 PM IST** | `london` | `GER40` | Mage | ORB Breakout | 15 Mins | 60 Mins | 50 – 250 pips | **2.7%** | 03:30 PM IST | None | None |
| **06:21 PM IST** | `NY_Forex` | `GBPNZD` | Mage | ORB Breakout | 15 Mins | 180 Mins | 25 – 30 pips | **6.1%** | None | Thursday | None |
| **07:31 PM IST** | `NY_Forex` | `EURJPY` | Mage | ORB Breakout | 10 Mins | 60 Mins | 15 – 30 pips | **2.7%** | None | Wednesday | None |

---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - NZDUSD (Sage) - 04:01 AM IST, USDCHF (Sage) - 05:46 AM IST, USDJPY (Mage) - 06:31 AM IST, NAS100 (Sage) - 07:31 AM IST

2. **London Open Trade Cluster**
   - CHFJPY (Mage) - 12:46 PM IST, NAS100 (Mage) - 01:16 PM IST, US30 (Mage) - 01:21 PM IST, GBPJPY (Mage) - 01:46 PM IST, GER40 (Mage) - 02:51 PM IST

3. **New York Pre-Market & Open Trade Cluster**
   - GBPNZD (Mage) - 06:21 PM IST, EURJPY (Mage) - 07:31 PM IST

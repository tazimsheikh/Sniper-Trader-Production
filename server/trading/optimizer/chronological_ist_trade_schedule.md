# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **32 active setups** in `server/trading/config/PairConfig.ts`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **05:30 AM IST** | `asia` | `XTIUSD` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 20 – 40 pips | **3.4%** | None | Tuesday | None |
| **06:01 AM IST** | `asia` | `EURUSD` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 20 – 60 pips | **2.1%** | None | None | None |
| **06:31 AM IST** | `asia` | `XAUUSD` | Mage | ORB Breakout | 10 Mins | 120 Mins | 30 – 80 pips | **4.1%** | None | None | None |
| **06:31 AM IST** | `asia` | `AUDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 100 pips | **1.1%** | None | None | None |
| **08:01 AM IST** | `asia` | `EURUSD` | Sage | Liquidity Sweep | 60 Mins | 15 Mins | 10 – 40 pips | **2.0%** | None | Monday | None |
| **09:01 AM IST** | `asia` | `USDCHF` | Sage | Liquidity Sweep | 120 Mins | 10 Mins | 30 – 35 pips | **1.1%** | None | None | None |
| **10:21 AM IST** | `asia` | `USDCHF` | Mage | ORB Breakout | 45 Mins | 180 Mins | 10 – 120 pips | **4.1%** | None | Wednesday, Friday | None |
| **11:30 AM IST** | `london` | `EURJPY` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 40 – 60 pips | **1.1%** | 01:30 PM IST | Wednesday | None |
| **11:30 AM IST** | `london` | `XAUUSD` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 15 – 120 pips | **1.1%** | 11:30 AM IST | Tuesday | None |
| **11:46 AM IST** | `london` | `CHFJPY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 40 – 100 pips | **1.1%** | None | None | None |
| **12:01 PM IST** | `london` | `AUDJPY` | Sage | Liquidity Sweep | 30 Mins | 15 Mins | 20 – 60 pips | **1.4%** | None | Thursday | None |
| **12:46 PM IST** | `london` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 30 pips | **1.8%** | 02:30 PM IST | Tuesday, Thursday | None |
| **12:46 PM IST** | `london` | `EURUSD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 12.5 – 30 pips | **4.1%** | 12:30 PM IST | Monday | None |
| **01:01 PM IST** | `london` | `USDCHF` | Mage | ORB Breakout | 10 Mins | 60 Mins | 8 – 70 pips | **3.5%** | None | Tuesday, Friday | None |
| **01:01 PM IST** | `london` | `EURJPY` | Sage | Liquidity Sweep | 15 Mins | 15 Mins | 30 – 100 pips | **1.1%** | 02:30 PM IST, 03:30 PM IST | None | None |
| **01:16 PM IST** | `london` | `CADJPY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 20 – 50 pips | **3.7%** | 01:30 PM IST | Monday | None |
| **01:16 PM IST** | `london` | `AUDJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 15 – 150 pips | **4.1%** | 02:30 PM IST, 04:30 PM IST, 05:30 PM IST, 06:30 PM IST | Monday, Friday | None |
| **01:31 PM IST** | `london` | `GBPAUD` | Sage | Liquidity Sweep | 120 Mins | 30 Mins | 50 – 100 pips | **1.1%** | None | None | None |
| **01:46 PM IST** | `london` | `GBPUSD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 12.5 – 60 pips | **4.1%** | 04:30 PM IST | Thursday | None |
| **01:46 PM IST** | `london` | `EURUSD` | Sage | Liquidity Sweep | 60 Mins | 10 Mins | 15 – 30 pips | **1.1%** | 03:30 PM IST | None | None |
| **02:31 PM IST** | `london` | `EURNZD` | Sage | Liquidity Sweep | 120 Mins | 15 Mins | 50 – 100 pips | **3.5%** | None | None | None |
| **03:31 PM IST** | `london` | `EURNZD` | Sage | Liquidity Sweep | 120 Mins | 30 Mins | 40 – 60 pips | **1.8%** | 04:30 PM IST | None | None |
| **05:30 PM IST** | `ny` | `GER40` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 50 – 100 pips | **4.1%** | 08:30 PM IST | Wednesday | None |
| **05:30 PM IST** | `ny` | `NAS100` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 100 – 140 pips | **1.1%** | None | None | None |
| **05:30 PM IST** | `ny` | `NAS100` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 100 – 180 pips | **1.1%** | None | None | None |
| **05:30 PM IST** | `ny` | `NAS100` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 100 – 200 pips | **1.1%** | None | None | None |
| **05:30 PM IST** | `ny` | `NAS100` | Seer | Liquidity Hunt (Pin Bar) | 0 Mins | 240 Mins | 100 – 180 pips | **1.1%** | None | None | None |
| **06:21 PM IST** | `NY_Forex` | `GBPAUD` | Mage | ORB Breakout | 15 Mins | 120 Mins | 25 – 80 pips | **1.1%** | None | None | None |
| **07:01 PM IST** | `NY_Forex` | `USDCAD` | Sage | Liquidity Sweep | 60 Mins | 30 Mins | 20 – 35 pips | **2.8%** | None | None | None |
| **07:36 PM IST** | `NY_Forex` | `USDCHF` | Mage | ORB Breakout | 15 Mins | 60 Mins | 8 – 30 pips | **1.1%** | None | None | None |
| **07:46 PM IST** | `NY_Forex` | `EURJPY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 20 – 100 pips | **3.4%** | 09:30 PM IST, 12:30 AM IST | Wednesday | None |
| **09:31 PM IST** | `NY_Forex` | `XAUUSD` | Sage | Liquidity Sweep | 120 Mins | 10 Mins | 40 – 160 pips | **1.1%** | 11:30 PM IST | Tuesday | None |

---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - XTIUSD (Seer) - 05:30 AM IST, EURUSD (Sage) - 06:01 AM IST, XAUUSD (Mage) - 06:31 AM IST, AUDJPY (Mage) - 06:31 AM IST, EURUSD (Sage) - 08:01 AM IST, USDCHF (Sage) - 09:01 AM IST, USDCHF (Mage) - 10:21 AM IST

2. **London Open Trade Cluster**
   - EURJPY (Seer) - 11:30 AM IST, XAUUSD (Seer) - 11:30 AM IST, CHFJPY (Sage) - 11:46 AM IST, AUDJPY (Sage) - 12:01 PM IST, USDJPY (Mage) - 12:46 PM IST, EURUSD (Mage) - 12:46 PM IST, USDCHF (Mage) - 01:01 PM IST, EURJPY (Sage) - 01:01 PM IST, CADJPY (Mage) - 01:16 PM IST, AUDJPY (Mage) - 01:16 PM IST, GBPAUD (Sage) - 01:31 PM IST, GBPUSD (Mage) - 01:46 PM IST, EURUSD (Sage) - 01:46 PM IST, EURNZD (Sage) - 02:31 PM IST, EURNZD (Sage) - 03:31 PM IST

3. **New York Pre-Market & Open Trade Cluster**
   - GER40 (Seer) - 05:30 PM IST, NAS100 (Seer) - 05:30 PM IST, NAS100 (Seer) - 05:30 PM IST, NAS100 (Seer) - 05:30 PM IST, NAS100 (Seer) - 05:30 PM IST, GBPAUD (Mage) - 06:21 PM IST, USDCAD (Sage) - 07:01 PM IST, USDCHF (Mage) - 07:36 PM IST, EURJPY (Mage) - 07:46 PM IST, XAUUSD (Sage) - 09:31 PM IST

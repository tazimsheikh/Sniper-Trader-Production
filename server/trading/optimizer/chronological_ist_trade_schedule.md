# ⏰ CHRONOLOGICAL IST TRADE SCHEDULE

**Timezone Mapping:** Indian Standard Time (IST = UTC+5:30)

This document serves as the canonical chronological trade schedule for all **18 active setups** in `server/trading/config/PairConfig.ts`. Timestamps represent **ORB Range Completion** (when trade scanning & execution active window begins).

---

## 📅 Daily Chronological Trade Schedule (24-Hour Timeline)

| IST Trade Start (ORB Complete) | Session | Symbol | Bot | Strategy Type | ORB Duration | Action Window | Stop Loss Bounds | Risk Sizing | Toxic Hours (Blocked) | Toxic Days (Blocked) | Toxic Months (Blocked) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **04:30 AM IST** | `asia` | `EURNZD` | Sage | Liquidity Sweep | 60 Mins | 15 Mins | 40 – 100 pips | **10.0%** | 05:30 AM IST | None | None |
| **05:40 AM IST** | `asia` | `NAS100` | Mage | ORB Breakout | 10 Mins | 60 Mins | 50 – 350 pips | **2.5%** | None | None | None |
| **06:10 AM IST** | `asia` | `AUDUSD` | Mage | ORB Breakout | 10 Mins | 180 Mins | 10 – 25 pips | **3.2%** | 06:30 AM IST | None | None |
| **08:00 AM IST** | `asia` | `BTCUSD` | Sage | Liquidity Sweep | 120 Mins | 10 Mins | 100 – 300 pips | **10.0%** | None | None | None |
| **11:40 AM IST** | `london` | `GER40` | Mage | ORB Breakout | 10 Mins | 180 Mins | 20 – 80 pips | **1.1%** | None | None | None |
| **12:30 PM IST** | `london` | `GER40` | Sage | Liquidity Sweep | 60 Mins | 15 Mins | 10 – 80 pips | **2.1%** | None | None | None |
| **12:40 PM IST** | `london` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 25 – 30 pips | **3.7%** | 01:30 PM IST, 08:30 PM IST | None | None |
| **12:55 PM IST** | `london` | `US30` | Mage | ORB Breakout | 10 Mins | 180 Mins | 50 – 80 pips | **1.9%** | 02:30 PM IST, 03:30 PM IST | None | None |
| **01:10 PM IST** | `london` | `NAS100` | Mage | ORB Breakout | 10 Mins | 120 Mins | 30 – 80 pips | **4.0%** | None | None | None |
| **01:30 PM IST** | `london` | `AUDUSD` | Sage | Liquidity Sweep | 120 Mins | 10 Mins | 15 – 100 pips | **9.8%** | 06:30 AM IST | None | None |
| **01:40 PM IST** | `london` | `GBPJPY` | Mage | ORB Breakout | 10 Mins | 180 Mins | 20 – 80 pips | **3.4%** | 03:30 PM IST | None | None |
| **02:45 PM IST** | `london` | `XAUUSD` | Sage | Liquidity Sweep | 120 Mins | 5 Mins | 40 – 250 pips | **4.3%** | 06:30 PM IST | None | None |
| **06:40 PM IST** | `NY_Forex` | `GER40` | Mage | ORB Breakout | 10 Mins | 180 Mins | 30 – 250 pips | **4.7%** | None | None | None |
| **07:15 PM IST** | `NY_Forex` | `GBPUSD` | Mage | ORB Breakout | 15 Mins | 120 Mins | 7.5 – 60 pips | **0.8%** | 08:30 PM IST, 09:30 PM IST | None | None |
| **07:25 PM IST** | `NY_Forex` | `EURUSD` | Mage | ORB Breakout | 10 Mins | 180 Mins | 5 – 50 pips | **3.2%** | None | None | None |
| **07:25 PM IST** | `NY_Forex` | `USDCAD` | Mage | ORB Breakout | 10 Mins | 60 Mins | 8 – 25 pips | **3.9%** | None | None | None |
| **07:30 PM IST** | `NY_Forex` | `GBPUSD` | Sage | Liquidity Sweep | 30 Mins | 10 Mins | 20 – 40 pips | **3.0%** | 08:30 PM IST, 09:30 PM IST | None | None |
| **07:40 PM IST** | `NY_Forex` | `USDJPY` | Mage | ORB Breakout | 10 Mins | 120 Mins | 15 – 40 pips | **3.4%** | 01:30 PM IST, 08:30 PM IST | None | None |

---

## ⚡ IST Active Trade Start Clusters

1. **Asia Session Trade Cluster**
   - EURNZD (Sage) - 04:30 AM IST, NAS100 (Mage) - 05:40 AM IST, AUDUSD (Mage) - 06:10 AM IST, BTCUSD (Sage) - 08:00 AM IST

2. **London Open Trade Cluster**
   - GER40 (Mage) - 11:40 AM IST, GER40 (Sage) - 12:30 PM IST, USDJPY (Mage) - 12:40 PM IST, US30 (Mage) - 12:55 PM IST, NAS100 (Mage) - 01:10 PM IST, AUDUSD (Sage) - 01:30 PM IST, GBPJPY (Mage) - 01:40 PM IST, XAUUSD (Sage) - 02:45 PM IST

3. **New York Pre-Market & Open Trade Cluster**
   - GER40 (Mage) - 06:40 PM IST, GBPUSD (Mage) - 07:15 PM IST, EURUSD (Mage) - 07:25 PM IST, USDCAD (Mage) - 07:25 PM IST, GBPUSD (Sage) - 07:30 PM IST, USDJPY (Mage) - 07:40 PM IST

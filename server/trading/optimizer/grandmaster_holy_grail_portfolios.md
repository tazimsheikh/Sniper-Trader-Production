# 🏆 Tri-Bot Grandmaster Holy Grail Portfolio (MAGE + SAGE + SEER)

## 🏆 The Holy Grail (Maximum Optimization)

**Total Components:** 50
**Mage Components:** 14
**Sage Components:** 33
**Seer Components:** 3
**Hedging Units:** 24
**Active Symbols:** 16
**Total Historical Trades:** 9361
**Master MC DD 99%:** 0.74 R
**Average Trade Risk:** 1.89%
**Global Risk Multiplier:** 2.000x
**CPCV Path Pass Rate:** 14/15 (93.3%)
**CPCV Min Sharpe:** -0.46

### Component Setups

| Symbol | Bot | Setup | 3-Year Net R | Win Rate | Risk % | Unit ID | Unit Type |
|:---|:---|:---|:---:|:---:|:---:|:---|:---|
| **NAS100.DAILY** | Mage | `asia_0%_MinSL15_MaxSL80_Body10_Trig3_Step2_FC24_StartH18_StartM0_OrbMins10_ActMins120_ExitTRAILING` | +168.2R | 23.6% | 2.50% | EQUITY_INDICES_CROSS_TRI_HEDGE | CROSS_TRI |
| **GER40.DAILY** | Sage | `asia_20%_MinSL70_MaxSL150_Sweep5_MaxSwp3_ReqClstrue_ExitTRAILING_Trig0.25_Step2_FC16_StartH20_StartM30_OrbMins30_ActMins30` | +21.1R | 25.9% | 2.50% | EQUITY_INDICES_CROSS_TRI_HEDGE | CROSS_TRI |
| **US30.DAILY** | Seer | `asia_Body20_Wick1.2_MinSL100_MaxSL200_Trig0.5_Step0.5_FC16_ExitTRAILING` | +4.7R | 72.7% | 2.50% | EQUITY_INDICES_CROSS_TRI_HEDGE | CROSS_TRI |
| **USDCHF** | Mage | `NY_Forex_30%_MinSL10_MaxSL50_Body4_Trig2_Step2_FC16_StartH9_StartM45_OrbMins15_ActMins60_ExitTRAILING` | +48.4R | 35.6% | 2.42% | EUROPE_USD_FX_CROSS_TRI_HEDGE | CROSS_TRI |
| **USDCAD** | Sage | `london_0%_MinSL25_MaxSL30_Sweep10_MaxSwp1.5_ReqClsfalse_ExitTRAILING_Trig0.5_Step1_FC8_StartH3_StartM15_OrbMins30_ActMins30` | +58.9R | 49.1% | 1.99% | EUROPE_USD_FX_CROSS_TRI_HEDGE | CROSS_TRI |
| **GBPAUD** | Seer | `asia_Body7.5_Wick1.2_MinSL40_MaxSL100_Trig0.5_Step0.5_FC12_ExitTRAILING` | +14.8R | 40.7% | 0.80% | EUROPE_USD_FX_CROSS_TRI_HEDGE | CROSS_TRI |
| **GER40.DAILY** | Mage | `london_0%_MinSL30_MaxSL100_Body20_Trig0.5_Step2_FC12_StartH4_StartM0_OrbMins10_ActMins120_ExitTRAILING` | +37.6R | 18.1% | 1.87% | GER40.DAILY_TRI_HEDGE | TRI_PAIR |
| **GER40.DAILY** | Sage | `NY_Indices_0%_MinSL70_MaxSL150_Sweep20_MaxSwp3_ReqClstrue_ExitOPPOSITE_BOUNDARY_Trig1.5_Step1_FC8_StartH8_StartM0_OrbMins30_ActMins10` | +21.7R | 73.3% | 2.50% | GER40.DAILY_TRI_HEDGE | TRI_PAIR |
| **GER40.DAILY** | Seer | `ny_Body20_Wick2_MinSL50_MaxSL60_Trig0.5_Step0.5_FC16_ExitTRAILING` | +14.7R | 63.0% | 2.50% | GER40.DAILY_TRI_HEDGE | TRI_PAIR |
| **EURUSD** | Mage | `london_15%_MinSL12.5_MaxSL30_Body5_Trig1_Step2_FC8_StartH3_StartM0_OrbMins10_ActMins60_ExitTRAILING` | +31.8R | 28.9% | 2.50% | EURUSD_MAGE_SAGE_SELF_HEDGE_london15M_asia20Min | SELF_PAIR |
| **EURUSD** | Sage | `asia_20%_MinSL20_MaxSL60_Sweep3_MaxSwp3_ReqClstrue_ExitMIDPOINT_Trig1_Step1_FC8_StartH20_StartM0_OrbMins30_ActMins10` | +9.9R | 90.4% | 2.50% | EURUSD_MAGE_SAGE_SELF_HEDGE_london15M_asia20Min | SELF_PAIR |
| **XAUUSD** | Mage | `asia_0%_MinSL30_MaxSL80_Body24_Trig1.5_Step1.5_FC8_StartH20_StartM45_OrbMins10_ActMins60_ExitTRAILING` | +103.0R | 31.4% | 2.50% | XAUUSD_MAGE_SAGE_SELF_HEDGE_asia0MinS_london0Mi | SELF_PAIR |
| **XAUUSD** | Sage | `london_0%_MinSL40_MaxSL120_Sweep5_MaxSwp1.5_ReqClsfalse_ExitTRAILING_Trig0.5_Step2_FC16_StartH3_StartM30_OrbMins60_ActMins15` | +40.3R | 24.2% | 2.46% | XAUUSD_MAGE_SAGE_SELF_HEDGE_asia0MinS_london0Mi | SELF_PAIR |
| **GBPUSD** | Mage | `NY_Forex_0%_MinSL7.5_MaxSL80_Body5_Trig1_Step0.5_FC16_StartH9_StartM30_OrbMins15_ActMins60_ExitTRAILING` | +31.0R | 42.8% | 1.78% | GBPUSD_MAGE_SAGE_SELF_HEDGE_NYForex0_london20M | SELF_PAIR |
| **GBPUSD** | Sage | `london_20%_MinSL20_MaxSL30_Sweep2_MaxSwp2_ReqClstrue_ExitTRAILING_Trig1_Step1_FC8_StartH3_StartM30_OrbMins120_ActMins15` | +37.8R | 37.3% | 1.52% | GBPUSD_MAGE_SAGE_SELF_HEDGE_NYForex0_london20M | SELF_PAIR |
| **EURUSD** | Mage | `NY_Forex_0%_MinSL10_MaxSL40_Body5_Trig2_Step2_FC16_StartH9_StartM30_OrbMins15_ActMins60_ExitADTEL_MODERATE` | +23.0R | 71.3% | 1.77% | EURUSD_MAGE_SAGE_SELF_HEDGE_NYForex0_asia0MinS | SELF_PAIR |
| **EURUSD** | Sage | `asia_0%_MinSL10_MaxSL40_Sweep3_MaxSwp1.5_ReqClstrue_ExitTRAILING_Trig0.5_Step1_FC8_StartH21_StartM30_OrbMins60_ActMins15` | +30.8R | 34.0% | 2.50% | EURUSD_MAGE_SAGE_SELF_HEDGE_NYForex0_asia0MinS | SELF_PAIR |
| **GBPAUD** | Mage | `NY_Forex_30%_MinSL25_MaxSL80_Body4_Trig2_Step1_FC24_StartH8_StartM30_OrbMins15_ActMins120_ExitTRAILING` | +46.0R | 35.0% | 1.99% | GBPAUD_MAGE_SAGE_SELF_HEDGE_NYForex30_asia20Min | SELF_PAIR |
| **GBPAUD** | Sage | `asia_20%_MinSL30_MaxSL100_Sweep5_MaxSwp1.5_ReqClsfalse_ExitTRAILING_Trig0.5_Step2_FC12_StartH22_StartM0_OrbMins60_ActMins30` | +35.6R | 19.7% | 1.00% | GBPAUD_MAGE_SAGE_SELF_HEDGE_NYForex30_asia20Min | SELF_PAIR |
| **EURCAD** | Mage | `asia_0%_MinSL25_MaxSL50_Body5_Trig2_Step2_FC12_StartH17_StartM0_OrbMins10_ActMins60_ExitTRAILING` | +42.5R | 56.6% | 2.50% | EURCAD_MAGE_SAGE_SELF_HEDGE_asia0MinS_NYForex0 | SELF_PAIR |
| **EURCAD** | Sage | `NY_Forex_0%_MinSL20_MaxSL100_Sweep3_MaxSwp2_ReqClsfalse_ExitTRAILING_Trig2_Step0.5_FC12_StartH8_StartM30_OrbMins30_ActMins15` | +38.8R | 50.0% | 1.05% | EURCAD_MAGE_SAGE_SELF_HEDGE_asia0MinS_NYForex0 | SELF_PAIR |
| **USDJPY** | Mage | `asia_0%_MinSL30_MaxSL30_Body4_Trig1.5_Step1.5_FC16_StartH20_StartM45_OrbMins10_ActMins180_ExitTRAILING` | +63.2R | 36.4% | 1.65% | USDJPY_MAGE_SAGE_SELF_HEDGE_asia0MinS_asia20Min | SELF_PAIR |
| **USDJPY** | Sage | `asia_20%_MinSL30_MaxSL50_Sweep2_MaxSwp1.5_ReqClstrue_ExitTRAILING_Trig0.5_Step2_FC16_StartH21_StartM0_OrbMins120_ActMins60` | +22.5R | 23.5% | 2.50% | USDJPY_MAGE_SAGE_SELF_HEDGE_asia0MinS_asia20Min | SELF_PAIR |
| **AUDJPY** | Mage | `NY_Forex_0%_MinSL25_MaxSL40_Body4_Trig3_Step1_FC24_StartH8_StartM30_OrbMins15_ActMins180_ExitTRAILING` | +50.5R | 37.8% | 1.73% | AUDJPY_MAGE_SAGE_SELF_HEDGE_NYForex0_NYForex0 | SELF_PAIR |
| **AUDJPY** | Sage | `NY_Forex_0%_MinSL60_MaxSL80_Sweep30_MaxSwp2_ReqClsfalse_ExitMIDPOINT_Trig1_Step1_FC8_StartH8_StartM30_OrbMins120_ActMins15` | +13.0R | 58.6% | 2.50% | AUDJPY_MAGE_SAGE_SELF_HEDGE_NYForex0_NYForex0 | SELF_PAIR |
| **US30.DAILY** | Sage | `NY_Indices_20%_MinSL40_MaxSL300_Sweep30_MaxSwp3_ReqClstrue_ExitTRAILING_Trig0.5_Step2_FC8_StartH9_StartM45_OrbMins15_ActMins15` | +73.5R | 23.0% | 2.50% | US30.DAILY_Sage_NAS100.DAILY_Mage_CROSS_NYIndices_london15 | CROSS_PAIR |
| **NAS100.DAILY** | Mage | `london_15%_MinSL50_MaxSL180_Body10_Trig1.5_Step1_FC24_StartH2_StartM0_OrbMins15_ActMins120_ExitTRAILING` | +63.8R | 27.9% | 1.85% | US30.DAILY_Sage_NAS100.DAILY_Mage_CROSS_NYIndices_london15 | CROSS_PAIR |
| **EURAUD** | Sage | `london_0%_MinSL60_MaxSL200_Sweep20_MaxSwp1.5_ReqClsfalse_ExitTRAILING_Trig1.5_Step0.5_FC12_StartH3_StartM30_OrbMins120_ActMins5` | +25.1R | 52.3% | 1.30% | EURAUD_Sage_USDCHF_Mage_CROSS_london0_london0 | CROSS_PAIR |
| **USDCHF** | Mage | `london_0%_MinSL15_MaxSL20_Body4_Trig0.5_Step1.5_FC12_StartH4_StartM0_OrbMins10_ActMins60_ExitTRAILING` | +18.9R | 21.6% | 0.95% | EURAUD_Sage_USDCHF_Mage_CROSS_london0_london0 | CROSS_PAIR |
| **USDJPY** | Sage | `london_0%_MinSL25_MaxSL35_Sweep2_MaxSwp1.5_ReqClstrue_ExitTRAILING_Trig2_Step1_FC8_StartH4_StartM0_OrbMins60_ActMins15` | +35.8R | 49.4% | 2.14% | USDJPY_Sage_CHFJPY_Sage_CROSS_london0_NYForex0 | CROSS_PAIR |
| **CHFJPY** | Sage | `NY_Forex_0%_MinSL20_MaxSL60_Sweep5_MaxSwp2_ReqClsfalse_ExitOPPOSITE_BOUNDARY_Trig1.5_Step0.5_FC8_StartH9_StartM0_OrbMins60_ActMins30` | +28.1R | 55.8% | 0.80% | USDJPY_Sage_CHFJPY_Sage_CROSS_london0_NYForex0 | CROSS_PAIR |
| **US30.DAILY** | Sage | `NY_Indices_20%_MinSL20_MaxSL200_Sweep50_MaxSwp3_ReqClstrue_ExitMIDPOINT_Trig2_Step0.5_FC12_StartH9_StartM0_OrbMins30_ActMins30` | +33.1R | 81.3% | 1.51% | US30.DAILY_Sage_NAS100.DAILY_Sage_CROSS_NYIndices_london20 | CROSS_PAIR |
| **NAS100.DAILY** | Sage | `london_20%_MinSL70_MaxSL300_Sweep5_MaxSwp2_ReqClstrue_ExitMIDPOINT_Trig2_Step0.5_FC16_StartH3_StartM0_OrbMins15_ActMins5` | +12.9R | 87.4% | 1.38% | US30.DAILY_Sage_NAS100.DAILY_Sage_CROSS_NYIndices_london20 | CROSS_PAIR |
| **GBPAUD** | Mage | `london_0%_MinSL15_MaxSL70_Body5_Trig2_Step1.5_FC8_StartH4_StartM0_OrbMins15_ActMins60_ExitTRAILING` | +47.3R | 30.4% | 1.91% | GBPAUD_Mage_NZDUSD_Sage_CROSS_london0_london0 | CROSS_PAIR |
| **NZDUSD** | Sage | `london_0%_MinSL15_MaxSL30_Sweep2_MaxSwp3_ReqClsfalse_ExitMIDPOINT_Trig0.5_Step2_FC12_StartH3_StartM0_OrbMins120_ActMins15` | +19.8R | 59.7% | 0.80% | GBPAUD_Mage_NZDUSD_Sage_CROSS_london0_london0 | CROSS_PAIR |
| **CADJPY** | Sage | `asia_0%_MinSL40_MaxSL60_Sweep10_MaxSwp2_ReqClstrue_ExitTRAILING_Trig0.5_Step0.5_FC16_StartH18_StartM0_OrbMins60_ActMins30` | +24.3R | 50.6% | 2.50% | CADJPY_Sage_CHFJPY_Sage_CROSS_asia0Mi_london0 | CROSS_PAIR |
| **CHFJPY** | Sage | `london_0%_MinSL40_MaxSL100_Sweep5_MaxSwp2_ReqClstrue_ExitTRAILING_Trig0.5_Step2_FC8_StartH2_StartM0_OrbMins15_ActMins15` | +20.9R | 31.2% | 0.80% | CADJPY_Sage_CHFJPY_Sage_CROSS_asia0Mi_london0 | CROSS_PAIR |
| **US30.DAILY** | Sage | `asia_0%_MinSL120_MaxSL150_Sweep10_MaxSwp1.5_ReqClstrue_ExitOPPOSITE_BOUNDARY_Trig1.5_Step1_FC16_StartH21_StartM30_OrbMins15_ActMins15` | +13.6R | 89.3% | 2.18% | US30.DAILY_Sage_NAS100.DAILY_Sage_CROSS_asia0Mi_asia20M | CROSS_PAIR |
| **NAS100.DAILY** | Sage | `asia_20%_MinSL120_MaxSL150_Sweep5_MaxSwp1.5_ReqClstrue_ExitTRAILING_Trig0.25_Step2_FC16_StartH20_StartM45_OrbMins60_ActMins5` | +19.7R | 18.9% | 2.50% | US30.DAILY_Sage_NAS100.DAILY_Sage_CROSS_asia0Mi_asia20M | CROSS_PAIR |
| **GER40.DAILY** | Sage | `NY_Indices_0%_MinSL70_MaxSL200_Sweep20_MaxSwp3_ReqClstrue_ExitTRAILING_Trig0.5_Step0.5_FC12_StartH8_StartM0_OrbMins30_ActMins5` | +13.7R | 54.1% | 2.50% | GER40.DAILY_Sage_NAS100.DAILY_Sage_CROSS_NYIndices_NYIndices | CROSS_PAIR |
| **NAS100.DAILY** | Sage | `NY_Indices_0%_MinSL20_MaxSL150_Sweep5_MaxSwp1.5_ReqClstrue_ExitOPPOSITE_BOUNDARY_Trig0.25_Step2_FC8_StartH10_StartM0_OrbMins60_ActMins15` | +17.4R | 21.1% | 1.02% | GER40.DAILY_Sage_NAS100.DAILY_Sage_CROSS_NYIndices_NYIndices | CROSS_PAIR |
| **CADJPY** | Sage | `asia_20%_MinSL30_MaxSL80_Sweep10_MaxSwp3_ReqClstrue_ExitOPPOSITE_BOUNDARY_Trig2_Step2_FC16_StartH18_StartM0_OrbMins60_ActMins30` | +17.5R | 77.4% | 2.50% | CADJPY_Sage_USDJPY_Sage_CROSS_asia20M_NYForex0 | CROSS_PAIR |
| **USDJPY** | Sage | `NY_Forex_0%_MinSL25_MaxSL35_Sweep2_MaxSwp1.5_ReqClstrue_ExitMIDPOINT_Trig1_Step0.5_FC8_StartH10_StartM0_OrbMins30_ActMins10` | +11.4R | 74.1% | 1.12% | CADJPY_Sage_USDJPY_Sage_CROSS_asia20M_NYForex0 | CROSS_PAIR |
| **US30.DAILY** | Sage | `asia_20%_MinSL120_MaxSL150_Sweep10_MaxSwp3_ReqClstrue_ExitMIDPOINT_Trig0.25_Step0.5_FC12_StartH21_StartM30_OrbMins15_ActMins15` | +11.1R | 86.2% | 2.38% | US30.DAILY_Sage_GER40.DAILY_Sage_CROSS_asia20M_london20 | CROSS_PAIR |
| **GER40.DAILY** | Sage | `london_20%_MinSL120_MaxSL200_Sweep20_MaxSwp3_ReqClstrue_ExitMIDPOINT_Trig1.5_Step0.5_FC12_StartH4_StartM0_OrbMins60_ActMins15` | +12.1R | 79.6% | 2.50% | US30.DAILY_Sage_GER40.DAILY_Sage_CROSS_asia20M_london20 | CROSS_PAIR |
| **EURAUD** | Sage | `asia_0%_MinSL60_MaxSL300_Sweep3_MaxSwp3_ReqClstrue_ExitOPPOSITE_BOUNDARY_Trig1.5_Step2_FC12_StartH21_StartM30_OrbMins30_ActMins5` | +10.9R | 82.4% | 1.42% | EURAUD_Sage_USDCHF_Sage_CROSS_asia0Mi_NYForex2 | CROSS_PAIR |
| **USDCHF** | Sage | `NY_Forex_20%_MinSL25_MaxSL50_Sweep3_MaxSwp1.5_ReqClsfalse_ExitTRAILING_Trig0.5_Step2_FC8_StartH9_StartM0_OrbMins15_ActMins15` | +9.1R | 44.7% | 0.80% | EURAUD_Sage_USDCHF_Sage_CROSS_asia0Mi_NYForex2 | CROSS_PAIR |
| **US30.DAILY** | Sage | `NY_Indices_0%_MinSL120_MaxSL150_Sweep30_MaxSwp2_ReqClstrue_ExitOPPOSITE_BOUNDARY_Trig0.25_Step1_FC8_StartH9_StartM45_OrbMins15_ActMins15` | +21.2R | 46.3% | 1.81% | US30.DAILY_Sage_GER40.DAILY_Sage_CROSS_NYIndices_london0 | CROSS_PAIR |
| **GER40.DAILY** | Sage | `london_0%_MinSL40_MaxSL150_Sweep30_MaxSwp3_ReqClstrue_ExitTRAILING_Trig0.25_Step2_FC12_StartH2_StartM0_OrbMins60_ActMins15` | +17.6R | 16.0% | 2.50% | US30.DAILY_Sage_GER40.DAILY_Sage_CROSS_NYIndices_london0 | CROSS_PAIR |
| **XAUUSD** | Sage | `london_0%_MinSL30_MaxSL120_Sweep7_MaxSwp1.5_ReqClsfalse_ExitMIDPOINT_Trig0.5_Step2_FC8_StartH3_StartM15_OrbMins60_ActMins10` | +10.2R | 50.0% | 0.80% | XAUUSD_Sage_SINGLE | SINGLETON |

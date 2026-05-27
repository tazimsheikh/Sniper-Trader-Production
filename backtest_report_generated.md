# Realistic Trading Bot Backtest Report

This report evaluates the realistic performance of the deployed trading bots over the last 1 week, 1 month, 3 months, 6 months, and 1 year. It incorporates strict market realism variables to ensure output mirrors live execution conditions:
- **Starting Balance:** $100 per pair ($100 for Combined Portfolio)
- **Risk per Trade:** 5%
- **Maximum Lot Cap:** 0.1 Lots
- **Safety Mechanisms:** Dynamic Trade Rejection (skips trade if min 0.01 lot > 5% risk) & Breakeven Trailing Stops (at 50% TP)
- **Slippage & Spread penalty:** 1 pip broker spread + 1 pip slippage (-1 pip slippage)
- **Commission:** $7 round-trip per standard lot

## Performance: Last 1 Week

| Pair | Total Profit | Max Drawdown | Trades | Win Rate |
|------|-------------:|-------------:|-------:|---------:|
| AUDJPY | $68.40 | 10.95% | 5 | 80.0% |
| AUDUSD | $163.80 | 0.42% | 5 | 80.0% |
| CHFJPY | $-43.50 | 43.50% | 5 | 0.0% |
| EURAUD | $156.20 | 0.00% | 5 | 100.0% |
| EURCAD | $155.10 | 0.00% | 5 | 100.0% |
| EURCHF | $68.80 | 1.48% | 5 | 60.0% |
| EURJPY | $41.20 | 0.98% | 5 | 60.0% |
| GBPAUD | $-29.10 | 46.69% | 5 | 20.0% |
| GBPCAD | $96.30 | 1.40% | 5 | 60.0% |
| GBPCHF | $87.50 | 1.00% | 5 | 80.0% |
| GBPJPY | $86.50 | 0.75% | 5 | 40.0% |
| GBPUSD | $189.30 | 18.10% | 5 | 80.0% |
| NZDUSD | $197.40 | 0.00% | 5 | 100.0% |
| USDCAD | $92.20 | 0.49% | 5 | 80.0% |
| USDCHF | $108.80 | 0.00% | 5 | 100.0% |
| USDJPY | $65.70 | 20.67% | 5 | 60.0% |
| XAUUSD | $76.50 | 81.40% | 5 | 40.0% |
| **COMBINED PORTFOLIO** | **$1581.10** | **14.33%** | **85** | **-** |

## Performance: Last 1 Month

| Pair | Total Profit | Max Drawdown | Trades | Win Rate |
|------|-------------:|-------------:|-------:|---------:|
| AUDJPY | $401.40 | 5.56% | 22 | 68.2% |
| AUDUSD | $356.50 | 29.32% | 22 | 54.5% |
| CHFJPY | $257.50 | 21.40% | 22 | 40.9% |
| EURAUD | $562.50 | 11.13% | 22 | 77.3% |
| EURCAD | $403.60 | 20.70% | 22 | 72.7% |
| EURCHF | $249.80 | 13.64% | 22 | 72.7% |
| EURJPY | $348.50 | 0.70% | 22 | 81.8% |
| GBPAUD | $155.50 | 26.14% | 22 | 40.9% |
| GBPCAD | $398.50 | 11.85% | 22 | 59.1% |
| GBPCHF | $190.60 | 29.47% | 22 | 63.6% |
| GBPJPY | $413.00 | 14.35% | 22 | 59.1% |
| GBPUSD | $641.30 | 9.73% | 22 | 72.7% |
| NZDUSD | $448.30 | 27.62% | 22 | 77.3% |
| USDCAD | $305.40 | 12.35% | 22 | 72.7% |
| USDCHF | $403.20 | 27.45% | 22 | 77.3% |
| USDJPY | $279.50 | 30.70% | 22 | 63.6% |
| XAUUSD | $-34.70 | 178.54% | 21 | 23.8% |
| **COMBINED PORTFOLIO** | **$5780.40** | **52.10%** | **373** | **-** |

## Performance: Last 3 Months

| Pair | Total Profit | Max Drawdown | Trades | Win Rate |
|------|-------------:|-------------:|-------:|---------:|
| AUDJPY | $857.30 | 20.70% | 65 | 53.8% |
| AUDUSD | $763.30 | 18.63% | 65 | 44.6% |
| CHFJPY | $725.70 | 38.95% | 65 | 40.0% |
| EURAUD | $781.90 | 49.00% | 65 | 47.7% |
| EURCAD | $725.40 | 24.20% | 65 | 58.5% |
| EURCHF | $912.80 | 3.52% | 65 | 75.4% |
| EURJPY | $774.90 | 20.70% | 65 | 61.5% |
| GBPAUD | $570.30 | 42.56% | 65 | 40.0% |
| GBPCAD | $747.20 | 62.10% | 65 | 44.6% |
| GBPCHF | $772.70 | 15.21% | 65 | 61.5% |
| GBPJPY | $843.90 | 42.10% | 65 | 49.2% |
| GBPUSD | $1817.60 | 34.69% | 65 | 61.5% |
| NZDUSD | $994.30 | 20.28% | 65 | 63.1% |
| USDCAD | $382.00 | 53.18% | 65 | 52.3% |
| USDCHF | $1123.80 | 8.76% | 65 | 69.2% |
| USDJPY | $1537.20 | 16.76% | 65 | 56.9% |
| XAUUSD | $295.20 | 117.91% | 64 | 26.6% |
| **COMBINED PORTFOLIO** | **$14625.50** | **53.19%** | **1104** | **-** |

## Performance: Last 6 Months

| Pair | Total Profit | Max Drawdown | Trades | Win Rate |
|------|-------------:|-------------:|-------:|---------:|
| AUDJPY | $1595.70 | 19.11% | 128 | 57.0% |
| AUDUSD | $1647.70 | 18.51% | 128 | 59.4% |
| CHFJPY | $1643.10 | 23.76% | 128 | 46.1% |
| EURAUD | $1649.10 | 22.71% | 128 | 51.6% |
| EURCAD | $1591.80 | 6.93% | 128 | 58.6% |
| EURCHF | $1572.60 | 8.54% | 128 | 77.3% |
| EURJPY | $1528.60 | 32.91% | 128 | 62.5% |
| GBPAUD | $1337.10 | 26.90% | 128 | 43.8% |
| GBPCAD | $1423.90 | 43.93% | 128 | 46.1% |
| GBPCHF | $1509.90 | 10.34% | 128 | 62.5% |
| GBPJPY | $1670.10 | 16.03% | 128 | 48.4% |
| GBPUSD | $3323.30 | 12.85% | 128 | 67.2% |
| NZDUSD | $1800.00 | 6.12% | 128 | 70.3% |
| USDCAD | $1158.20 | 13.87% | 128 | 57.0% |
| USDCHF | $2095.00 | 11.47% | 128 | 71.1% |
| USDJPY | $3038.30 | 32.80% | 128 | 56.3% |
| XAUUSD | $691.10 | 81.40% | 127 | 27.6% |
| **COMBINED PORTFOLIO** | **$29275.50** | **28.27%** | **2175** | **-** |

## Performance: Last 1 Year

| Pair | Total Profit | Max Drawdown | Trades | Win Rate |
|------|-------------:|-------------:|-------:|---------:|
| AUDJPY | $3659.70 | 13.86% | 259 | 66.8% |
| AUDUSD | $3091.70 | 43.12% | 259 | 60.6% |
| CHFJPY | $3174.90 | 32.19% | 259 | 45.2% |
| EURAUD | $3745.50 | 14.33% | 259 | 52.9% |
| EURCAD | $2694.50 | 43.50% | 259 | 51.7% |
| EURCHF | $2982.40 | 9.23% | 259 | 77.6% |
| EURJPY | $3353.60 | 21.27% | 259 | 59.8% |
| GBPAUD | $2365.20 | 44.90% | 259 | 41.3% |
| GBPCAD | $2837.90 | 38.06% | 259 | 47.1% |
| GBPCHF | $3583.30 | 23.36% | 259 | 62.9% |
| GBPJPY | $2451.00 | 24.76% | 259 | 43.2% |
| GBPUSD | $6614.20 | 30.70% | 259 | 67.6% |
| NZDUSD | $3291.50 | 26.28% | 259 | 67.2% |
| USDCAD | $2697.90 | 25.55% | 259 | 61.8% |
| USDCHF | $3987.10 | 49.38% | 259 | 68.3% |
| USDJPY | $6329.90 | 34.38% | 259 | 51.7% |
| XAUUSD | $3598.90 | 144.90% | 258 | 33.3% |
| **COMBINED PORTFOLIO** | **$60459.20** | **66.07%** | **4402** | **-** |


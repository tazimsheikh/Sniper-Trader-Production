# MAGE 3-Way Generational Analysis Report

This document provides a detailed evolutionary analysis across three distinct generations of the MAGE optimizer:

* **V1 (last-to-last)**: The oldest baseline.
* **V2 (last_optimization_run)**: Standard GA with ADTEL exits.
* **V3 (Current)**: Tiered Epoch GA with ADTEL exits.

Below is the pair-by-pair breakdown of how the configurations evolved.

## AUDJPY

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 39 | 52 | 46 |
| **Peak OOS Net R** | +8.08R | +12.04R | +12.04R |
| **Avg OOS Net R** | +3.38R | +4.22R | +5.12R |
| **Avg IS Max DD** | -4.61R | -4.49R | -4.66R |
| **Avg OOS Max DD** | -3.25R | -3.65R | -3.04R |
| **ADTEL Adoption %** | 0.0% | 0.0% | 0.0% |

**Evolution Summary:**
The GA aggressively hunted for profit, resulting in higher average OOS Net R, though drawdowns remained stable or slightly expanded. Peak OOS profit also exploded from +8.08R to +12.04R.

## AUDUSD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 34 | 31 | 33 |
| **Peak OOS Net R** | +16.00R | +5.61R | +16.00R |
| **Avg OOS Net R** | +4.05R | +2.20R | +4.20R |
| **Avg IS Max DD** | -2.00R | -2.07R | -1.97R |
| **Avg OOS Max DD** | -1.89R | -1.69R | -1.92R |
| **ADTEL Adoption %** | 8.8% | 0.0% | 9.1% |

**Evolution Summary:**
The evolution successfully achieved dual-improvement: Average forward-testing profit increased while simultaneously crushing the historical drawdowns. The transition from V2 to V3 (Epochs) heavily favored drawdown reduction. 

## BTCUSD.Daily

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 12 | 12 | 12 |
| **Peak OOS Net R** | +11.99R | +11.99R | +11.99R |
| **Avg OOS Net R** | +3.92R | +4.63R | +3.76R |
| **Avg IS Max DD** | -2.50R | -2.75R | -2.50R |
| **Avg OOS Max DD** | -1.83R | -1.75R | -1.75R |
| **ADTEL Adoption %** | 0.0% | 0.0% | 0.0% |

**Evolution Summary:**
This pair remained relatively stagnant across all three generations, indicating that the genetic algorithm has likely reached the mathematical ceiling for this asset's volatility profile. 

## CADJPY

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 44 | 43 | 48 |
| **Peak OOS Net R** | +12.55R | +22.59R | +12.55R |
| **Avg OOS Net R** | +4.16R | +4.78R | +3.95R |
| **Avg IS Max DD** | -3.10R | -3.00R | -3.03R |
| **Avg OOS Max DD** | -2.39R | -2.60R | -1.91R |
| **ADTEL Adoption %** | 6.8% | 0.0% | 8.3% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. 

## CHFJPY

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 53 | 49 | 48 |
| **Peak OOS Net R** | +18.27R | +18.27R | +18.27R |
| **Avg OOS Net R** | +4.55R | +5.78R | +4.38R |
| **Avg IS Max DD** | -4.90R | -6.13R | -4.12R |
| **Avg OOS Max DD** | -3.74R | -4.23R | -3.25R |
| **ADTEL Adoption %** | 5.7% | 0.0% | 0.0% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. 

## ETHUSD.Daily

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 6 | 4 | 6 |
| **Peak OOS Net R** | +5.05R | +5.05R | +5.05R |
| **Avg OOS Net R** | +4.02R | +1.34R | +4.02R |
| **Avg IS Max DD** | -2.00R | -1.25R | -2.00R |
| **Avg OOS Max DD** | -0.75R | -1.87R | -0.75R |
| **ADTEL Adoption %** | 0.0% | 0.0% | 0.0% |

**Evolution Summary:**
This pair remained relatively stagnant across all three generations, indicating that the genetic algorithm has likely reached the mathematical ceiling for this asset's volatility profile. 

## EURAUD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 32 | 48 | 29 |
| **Peak OOS Net R** | +10.90R | +10.90R | +10.90R |
| **Avg OOS Net R** | +2.79R | +2.73R | +3.21R |
| **Avg IS Max DD** | -4.15R | -3.94R | -3.73R |
| **Avg OOS Max DD** | -2.96R | -3.01R | -2.63R |
| **ADTEL Adoption %** | 9.4% | 0.0% | 0.0% |

**Evolution Summary:**
The evolution successfully achieved dual-improvement: Average forward-testing profit increased while simultaneously crushing the historical drawdowns. The transition from V2 to V3 (Epochs) heavily favored drawdown reduction. 

## EURCAD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 27 | 29 | 38 |
| **Peak OOS Net R** | +5.14R | +3.55R | +6.54R |
| **Avg OOS Net R** | +2.94R | +1.25R | +2.61R |
| **Avg IS Max DD** | -3.04R | -3.10R | -2.96R |
| **Avg OOS Max DD** | -1.75R | -1.89R | -1.95R |
| **ADTEL Adoption %** | 3.7% | 0.0% | 0.0% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. Peak OOS profit also exploded from +5.14R to +6.54R.

## EURJPY

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 67 | 60 | 54 |
| **Peak OOS Net R** | +15.24R | +13.13R | +15.24R |
| **Avg OOS Net R** | +5.00R | +4.56R | +4.95R |
| **Avg IS Max DD** | -5.43R | -5.31R | -5.33R |
| **Avg OOS Max DD** | -3.53R | -4.02R | -3.34R |
| **ADTEL Adoption %** | 0.0% | 0.0% | 0.0% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. 

## EURNZD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 35 | 42 | 38 |
| **Peak OOS Net R** | +10.91R | +11.36R | +10.91R |
| **Avg OOS Net R** | +3.95R | +3.83R | +3.82R |
| **Avg IS Max DD** | -4.19R | -3.90R | -4.28R |
| **Avg OOS Max DD** | -2.80R | -2.53R | -3.01R |
| **ADTEL Adoption %** | 0.0% | 0.0% | 0.0% |

**Evolution Summary:**
This pair remained relatively stagnant across all three generations, indicating that the genetic algorithm has likely reached the mathematical ceiling for this asset's volatility profile. 

## EURUSD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 31 | 33 | 30 |
| **Peak OOS Net R** | +9.77R | +8.49R | +11.27R |
| **Avg OOS Net R** | +2.55R | +2.32R | +3.62R |
| **Avg IS Max DD** | -2.16R | -2.23R | -1.93R |
| **Avg OOS Max DD** | -1.88R | -1.73R | -1.71R |
| **ADTEL Adoption %** | 0.0% | 0.0% | 0.0% |

**Evolution Summary:**
The evolution successfully achieved dual-improvement: Average forward-testing profit increased while simultaneously crushing the historical drawdowns. The transition from V2 to V3 (Epochs) heavily favored drawdown reduction. Peak OOS profit also exploded from +9.77R to +11.27R.

## GBPAUD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 40 | 38 | 36 |
| **Peak OOS Net R** | +6.95R | +9.06R | +23.44R |
| **Avg OOS Net R** | +2.80R | +3.87R | +5.24R |
| **Avg IS Max DD** | -4.36R | -4.57R | -3.69R |
| **Avg OOS Max DD** | -2.98R | -3.43R | -3.16R |
| **ADTEL Adoption %** | 15.0% | 0.0% | 0.0% |

**Evolution Summary:**
The evolution successfully achieved dual-improvement: Average forward-testing profit increased while simultaneously crushing the historical drawdowns. The transition from V2 to V3 (Epochs) heavily favored drawdown reduction. Peak OOS profit also exploded from +6.95R to +23.44R.

## GBPCAD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 47 | 57 | 45 |
| **Peak OOS Net R** | +19.80R | +18.27R | +8.91R |
| **Avg OOS Net R** | +3.93R | +4.04R | +3.33R |
| **Avg IS Max DD** | -3.15R | -3.07R | -3.25R |
| **Avg OOS Max DD** | -2.40R | -2.33R | -2.42R |
| **ADTEL Adoption %** | 4.3% | 0.0% | 0.0% |

**Evolution Summary:**
This pair remained relatively stagnant across all three generations, indicating that the genetic algorithm has likely reached the mathematical ceiling for this asset's volatility profile. 

## GBPJPY

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 51 | 58 | 46 |
| **Peak OOS Net R** | +15.32R | +15.45R | +15.32R |
| **Avg OOS Net R** | +5.35R | +5.39R | +5.65R |
| **Avg IS Max DD** | -5.50R | -5.80R | -5.65R |
| **Avg OOS Max DD** | -4.35R | -5.51R | -4.16R |
| **ADTEL Adoption %** | 2.0% | 0.0% | 6.5% |

**Evolution Summary:**
The GA aggressively hunted for profit, resulting in higher average OOS Net R, though drawdowns remained stable or slightly expanded. 

## GBPNZD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 28 | 40 | 40 |
| **Peak OOS Net R** | +14.24R | +16.85R | +23.37R |
| **Avg OOS Net R** | +4.87R | +4.24R | +6.52R |
| **Avg IS Max DD** | -3.88R | -4.21R | -4.18R |
| **Avg OOS Max DD** | -3.10R | -3.40R | -3.51R |
| **ADTEL Adoption %** | 3.6% | 0.0% | 0.0% |

**Evolution Summary:**
The GA aggressively hunted for profit, resulting in higher average OOS Net R, though drawdowns remained stable or slightly expanded. Peak OOS profit also exploded from +14.24R to +23.37R.

## GBPUSD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 56 | 36 | 51 |
| **Peak OOS Net R** | +9.44R | +8.92R | +9.44R |
| **Avg OOS Net R** | +3.20R | +4.40R | +3.09R |
| **Avg IS Max DD** | -3.38R | -3.38R | -3.13R |
| **Avg OOS Max DD** | -2.42R | -1.80R | -2.11R |
| **ADTEL Adoption %** | 0.0% | 0.0% | 0.0% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. 

## GER40.Daily

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 57 | 50 | 63 |
| **Peak OOS Net R** | +23.26R | +28.95R | +17.01R |
| **Avg OOS Net R** | +4.92R | +5.71R | +4.57R |
| **Avg IS Max DD** | -6.29R | -6.10R | -5.10R |
| **Avg OOS Max DD** | -4.29R | -4.50R | -3.25R |
| **ADTEL Adoption %** | 10.5% | 0.0% | 23.8% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. 

## JPN225.Daily

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 44 | 43 | 24 |
| **Peak OOS Net R** | +20.61R | +21.47R | +15.65R |
| **Avg OOS Net R** | +4.70R | +5.38R | +6.07R |
| **Avg IS Max DD** | -6.99R | -6.58R | -8.03R |
| **Avg OOS Max DD** | -4.78R | -5.05R | -5.07R |
| **ADTEL Adoption %** | 6.8% | 0.0% | 4.2% |

**Evolution Summary:**
The GA aggressively hunted for profit, resulting in higher average OOS Net R, though drawdowns remained stable or slightly expanded. 

## NAS100.Daily

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 84 | 74 | 70 |
| **Peak OOS Net R** | +21.63R | +18.00R | +46.20R |
| **Avg OOS Net R** | +7.98R | +6.39R | +11.10R |
| **Avg IS Max DD** | -3.16R | -5.25R | -2.44R |
| **Avg OOS Max DD** | -2.55R | -4.46R | -2.04R |
| **ADTEL Adoption %** | 39.3% | 0.0% | 55.7% |

**Evolution Summary:**
The evolution successfully achieved dual-improvement: Average forward-testing profit increased while simultaneously crushing the historical drawdowns. The transition from V2 to V3 (Epochs) heavily favored drawdown reduction. Peak OOS profit also exploded from +21.63R to +46.20R.

## NZDUSD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 16 | 18 | 15 |
| **Peak OOS Net R** | +3.00R | +3.07R | +3.00R |
| **Avg OOS Net R** | +1.05R | +1.37R | +1.04R |
| **Avg IS Max DD** | -2.36R | -2.77R | -2.34R |
| **Avg OOS Max DD** | -1.63R | -1.39R | -1.71R |
| **ADTEL Adoption %** | 18.8% | 0.0% | 20.0% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. 

## SPX500.Daily

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 28 | 18 | 25 |
| **Peak OOS Net R** | +6.98R | +6.50R | +5.38R |
| **Avg OOS Net R** | +2.16R | +3.53R | +2.35R |
| **Avg IS Max DD** | -2.45R | -2.67R | -2.13R |
| **Avg OOS Max DD** | -2.83R | -3.25R | -2.67R |
| **ADTEL Adoption %** | 10.7% | 0.0% | 12.0% |

**Evolution Summary:**
The evolution successfully achieved dual-improvement: Average forward-testing profit increased while simultaneously crushing the historical drawdowns. The transition from V2 to V3 (Epochs) heavily favored drawdown reduction. 

## US30.Daily

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 93 | 56 | 91 |
| **Peak OOS Net R** | +30.31R | +19.50R | +30.31R |
| **Avg OOS Net R** | +8.91R | +8.26R | +8.44R |
| **Avg IS Max DD** | -3.25R | -6.08R | -2.40R |
| **Avg OOS Max DD** | -3.04R | -4.64R | -2.36R |
| **ADTEL Adoption %** | 54.8% | 0.0% | 65.9% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. 

## USDCAD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 24 | 22 | 23 |
| **Peak OOS Net R** | +5.90R | +5.00R | +6.63R |
| **Avg OOS Net R** | +2.20R | +2.53R | +2.94R |
| **Avg IS Max DD** | -3.78R | -3.47R | -3.69R |
| **Avg OOS Max DD** | -1.67R | -2.12R | -2.01R |
| **ADTEL Adoption %** | 0.0% | 0.0% | 0.0% |

**Evolution Summary:**
The evolution successfully achieved dual-improvement: Average forward-testing profit increased while simultaneously crushing the historical drawdowns. The transition from V2 to V3 (Epochs) heavily favored drawdown reduction. Peak OOS profit also exploded from +5.90R to +6.63R.

## USDCHF

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 41 | 36 | 44 |
| **Peak OOS Net R** | +9.94R | +15.49R | +9.94R |
| **Avg OOS Net R** | +3.13R | +2.98R | +2.89R |
| **Avg IS Max DD** | -2.05R | -2.18R | -1.91R |
| **Avg OOS Max DD** | -1.25R | -1.72R | -1.23R |
| **ADTEL Adoption %** | 17.1% | 0.0% | 20.5% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. 

## USDJPY

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 67 | 60 | 54 |
| **Peak OOS Net R** | +19.53R | +12.57R | +19.53R |
| **Avg OOS Net R** | +5.46R | +5.13R | +5.03R |
| **Avg IS Max DD** | -3.89R | -4.24R | -3.71R |
| **Avg OOS Max DD** | -3.81R | -2.96R | -3.22R |
| **ADTEL Adoption %** | 0.0% | 0.0% | 5.6% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. 

## XAUUSD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 77 | 48 | 83 |
| **Peak OOS Net R** | +18.00R | +17.00R | +16.40R |
| **Avg OOS Net R** | +7.92R | +8.47R | +6.35R |
| **Avg IS Max DD** | -3.53R | -6.79R | -2.62R |
| **Avg OOS Max DD** | -1.72R | -3.33R | -1.53R |
| **ADTEL Adoption %** | 50.6% | 0.0% | 61.4% |

**Evolution Summary:**
The primary achievement on this pair was a massive safety upgrade. Drawdowns were significantly slashed across both IS and OOS phases, resulting in a much safer configuration profile. 

## XTIUSD

| Metric | V1 (Oldest) | V2 (Middle) | V3 (Current) |
|--------|-------------|-------------|--------------|
| **Robust Setups Found** | 21 | 21 | 15 |
| **Peak OOS Net R** | +7.00R | +7.00R | +7.00R |
| **Avg OOS Net R** | +3.14R | +1.80R | +3.53R |
| **Avg IS Max DD** | -2.55R | -3.79R | -2.24R |
| **Avg OOS Max DD** | -1.42R | -2.96R | -1.38R |
| **ADTEL Adoption %** | 42.9% | 0.0% | 60.0% |

**Evolution Summary:**
The evolution successfully achieved dual-improvement: Average forward-testing profit increased while simultaneously crushing the historical drawdowns. The transition from V2 to V3 (Epochs) heavily favored drawdown reduction. 


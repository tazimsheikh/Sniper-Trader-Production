# ⚖️ Tier 1 Math Simulator: Normal PairConfig Risk vs. Flat 1.0% Risk

**Evaluation Period**: 2025-09-02 → 2026-09-02 (1 Year Historical)
**Total Trades**: 1011 across 21 Grandmaster Components

## 1. Executive Summary & Findings

* **Why Normal (PairConfig) Risk Exists**: In `PairConfig.ts`, the Grandmaster optimizer dynamically weights each setup based on its Kelly ratio, win rate, and historical drawdown (e.g., high-expectancy setups like `GER40` Sage NY or `NAS100` get higher allocation, while high-drawdown setups like `XAUUSD` or `AUDJPY` get smaller allocation).
* **What Flat 1.0% Risk Does**: Treats every single trade with identical 1.0% flat risk weight, ignoring individual setup volatility or historical expectancy.

## 2. Max Safe Risk Scanner Comparison (Module 4)

| Account Preset | Daily Cap / DD Limit | Normal Max Safe Risk | Flat 1% Max Safe Risk | Normal Return | Flat 1% Return | Normal Max Peak DD | Flat 1% Max Peak DD |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Account A (Conservative)** | `Cap: 2.5% / DD: 5.5%` | **17.5%** | **60.0%** | **+100.1%** ($200.14) | **+130.8%** ($230.80) | 5.38% | 5.03% |
| **Account B (Balanced / Moderate)** | `Cap: 3.0% / DD: 9.5%` | **32.5%** | **60.0%** | **+238.3%** ($338.27) | **+220.4%** ($320.38) | 9.46% | 6.92% |
| **Account C (High Equity Prop)** | `Cap: 20.0% / DD: 50.0%` | **60.0%** | **60.0%** | **+2548.5%** ($2648.53) | **+271.6%** ($371.60) | 27.74% | 7.88% |
| **Account D (Aggressive / High Risk)** | `Cap: 10.0% / DD: 40.0%` | **60.0%** | **60.0%** | **+2478.0%** ($2578.03) | **+271.6%** ($371.60) | 26.54% | 7.88% |
| **Account E (Optimal Growth / 100% Unconstrained)** | `Cap: 100.0% / DD: 100.0%` | **60.0%** | **60.0%** | **+2687.7%** ($2787.66) | **+271.6%** ($371.60) | 29.53% | 7.88% |

## 3. Continuous Dynamic Compounding (Mode A)

| Base Risk | Normal Return | Flat 1% Return | Normal Balance | Flat 1% Balance | Normal Max DD | Flat 1% Max DD | Normal Calmar | Flat 1% Calmar |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **3.0%** | **+20.9%** | **+7.0%** | $120.89 | $107.05 | 1.69% | 0.40% | 12.35 | 17.46 |
| **5.0%** | **+37.0%** | **+12.0%** | $136.99 | $112.00 | 2.81% | 0.67% | 13.18 | 17.85 |
| **7.5%** | **+59.9%** | **+18.5%** | $159.90 | $118.50 | 4.18% | 1.01% | 14.32 | 18.37 |
| **10.0%** | **+86.3%** | **+25.4%** | $186.30 | $125.35 | 5.54% | 1.34% | 15.56 | 18.90 |
| **12.5%** | **+116.7%** | **+32.6%** | $216.68 | $132.58 | 6.89% | 1.68% | 16.94 | 19.44 |
| **15.0%** | **+151.6%** | **+40.2%** | $251.56 | $140.19 | 8.22% | 2.01% | 18.44 | 20.01 |
| **20.0%** | **+237.3%** | **+56.7%** | $337.32 | $156.68 | 10.83% | 2.67% | 21.92 | 21.21 |
| **25.0%** | **+349.2%** | **+75.0%** | $449.25 | $174.97 | 13.37% | 3.33% | 26.11 | 22.49 |
| **30.0%** | **+494.3%** | **+95.3%** | $594.31 | $195.26 | 15.86% | 3.99% | 31.17 | 23.86 |

## 4. Month-by-Month Performance Comparison

| Month | Trades | Win Rate | Raw Net R | Normal Weighted Net R | Flat 1% Weighted Net R | Normal Cum Weighted R | Flat 1% Cum Weighted R |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **2025-09** | 67 | 38.8% | +29.15R | **+0.90R** | **+0.29R** | +0.90R | +0.29R |
| **2025-10** | 78 | 30.8% | +2.30R | **-0.08R** | **+0.02R** | +0.82R | +0.31R |
| **2025-11** | 73 | 35.6% | +12.31R | **+0.23R** | **+0.12R** | +1.04R | +0.44R |
| **2025-12** | 73 | 27.4% | +9.92R | **+0.20R** | **+0.10R** | +1.25R | +0.54R |
| **2026-01** | 83 | 32.5% | +15.33R | **+0.32R** | **+0.15R** | +1.56R | +0.69R |
| **2026-02** | 88 | 33.0% | +8.30R | **+0.11R** | **+0.08R** | +1.68R | +0.77R |
| **2026-03** | 112 | 39.3% | +23.04R | **+0.59R** | **+0.23R** | +2.27R | +1.00R |
| **2026-04** | 82 | 43.9% | +49.80R | **+1.37R** | **+0.50R** | +3.64R | +1.50R |
| **2026-05** | 71 | 31.0% | -4.42R | **-0.29R** | **-0.04R** | +3.36R | +1.46R |
| **2026-06** | 93 | 35.5% | +36.76R | **+1.56R** | **+0.37R** | +4.91R | +1.82R |
| **2026-07** | 103 | 41.7% | +39.62R | **+1.30R** | **+0.40R** | +6.21R | +2.22R |
| **2026-08** | 88 | 31.8% | +5.33R | **+0.16R** | **+0.05R** | +6.37R | +2.27R |

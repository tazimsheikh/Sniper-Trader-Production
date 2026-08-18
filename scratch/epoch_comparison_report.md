# MAGE Epoch Strategy vs Standard Strategy

This report compares the **Standard ADTEL GA** (no epochs) versus the **Tiered Epoch GA** (locking foundation first) for all currently finished pairs.

## AUDJPY

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 38 (30.4%) | 43 (35.5%) | ✅ Improved |
| **Curve-Fitting Mistakes** (Failed OOS) | 17 (13.6%) | 13 (10.7%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +49.0 R (8 trades) | +49.0 R (8 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +8.1 R (11 trades) | +12.0 R (17 trades) | 📈 Higher Real Profit |

---

## AUDUSD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 25 (31.3%) | 26 (33.8%) | ✅ Improved |
| **Curve-Fitting Mistakes** (Failed OOS) | 3 (3.8%) | 3 (3.9%) | ➖ Stable |
| **Peak In-Sample Net R** | +40.9 R (4 trades) | +37.3 R (8 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +16.0 R (7 trades) | +16.0 R (7 trades) | 📉 Lower Real Profit |

---

## BTCUSD.Daily

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 9 (20.9%) | 9 (20.0%) | ➖ Stable |
| **Curve-Fitting Mistakes** (Failed OOS) | 0 (0.0%) | 0 (0.0%) | ➖ Stable |
| **Peak In-Sample Net R** | +33.8 R (4 trades) | +32.4 R (4 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +12.0 R (14 trades) | +12.0 R (14 trades) | 📉 Lower Real Profit |

---

## CADJPY

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 39 (32.8%) | 42 (35.6%) | ✅ Improved |
| **Curve-Fitting Mistakes** (Failed OOS) | 12 (10.1%) | 12 (10.2%) | ➖ Stable |
| **Peak In-Sample Net R** | +41.4 R (10 trades) | +41.4 R (10 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +12.6 R (12 trades) | +12.6 R (12 trades) | 📉 Lower Real Profit |

---

## CHFJPY

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 47 (35.1%) | 43 (36.4%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 35 (26.1%) | 21 (17.8%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +50.4 R (14 trades) | +50.4 R (14 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +18.3 R (13 trades) | +18.3 R (13 trades) | 📉 Lower Real Profit |

---

## ETHUSD.Daily

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 0 (0.0%) | 0 (0.0%) | ➖ Stable |
| **Curve-Fitting Mistakes** (Failed OOS) | 6 (9.1%) | 3 (4.2%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +16.4 R (1 trades) | +16.4 R (1 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +5.0 R (3 trades) | +5.0 R (3 trades) | 📉 Lower Real Profit |

---

## EURAUD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 29 (22.7%) | 26 (20.2%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 32 (25.0%) | 27 (20.9%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +41.6 R (15 trades) | +41.6 R (15 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +10.9 R (6 trades) | +10.9 R (6 trades) | 📉 Lower Real Profit |

---

## EURCAD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 21 (21.0%) | 29 (28.7%) | ✅ Improved |
| **Curve-Fitting Mistakes** (Failed OOS) | 9 (9.0%) | 7 (6.9%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +34.3 R (8 trades) | +34.3 R (8 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +5.1 R (12 trades) | +6.5 R (11 trades) | 📈 Higher Real Profit |

---

## EURJPY

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 67 (51.9%) | 51 (43.2%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 16 (12.4%) | 17 (14.4%) | ⚠️ Worse (More CF) |
| **Peak In-Sample Net R** | +57.3 R (15 trades) | +57.3 R (15 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +15.2 R (12 trades) | +15.2 R (12 trades) | 📉 Lower Real Profit |

---

## EURNZD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 35 (27.1%) | 38 (30.9%) | ✅ Improved |
| **Curve-Fitting Mistakes** (Failed OOS) | 38 (29.5%) | 31 (25.2%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +41.6 R (15 trades) | +41.6 R (15 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +10.9 R (6 trades) | +10.9 R (6 trades) | 📉 Lower Real Profit |

---

## EURUSD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 25 (39.1%) | 24 (37.5%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 9 (14.1%) | 6 (9.4%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +34.8 R (3 trades) | +27.3 R (7 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +9.8 R (7 trades) | +11.3 R (8 trades) | 📈 Higher Real Profit |

---

## GBPAUD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 38 (28.8%) | 36 (28.8%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 33 (25.0%) | 32 (25.6%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +47.6 R (19 trades) | +47.6 R (19 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +6.9 R (7 trades) | +23.4 R (7 trades) | 📈 Higher Real Profit |

---

## GBPCAD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 44 (37.0%) | 42 (35.6%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 18 (15.1%) | 16 (13.6%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +46.9 R (13 trades) | +40.6 R (12 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +19.8 R (14 trades) | +8.9 R (9 trades) | 📉 Lower Real Profit |

---

## GBPJPY

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 51 (37.8%) | 46 (37.1%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 22 (16.3%) | 27 (21.8%) | ⚠️ Worse (More CF) |
| **Peak In-Sample Net R** | +64.8 R (24 trades) | +64.8 R (24 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +15.3 R (17 trades) | +15.3 R (17 trades) | 📉 Lower Real Profit |

---

## GBPNZD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 28 (21.2%) | 40 (31.5%) | ✅ Improved |
| **Curve-Fitting Mistakes** (Failed OOS) | 38 (28.8%) | 26 (20.5%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +40.3 R (18 trades) | +40.3 R (18 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +14.2 R (13 trades) | +23.4 R (7 trades) | 📈 Higher Real Profit |

---

## GBPUSD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 41 (38.0%) | 38 (34.5%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 14 (13.0%) | 12 (10.9%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +39.9 R (6 trades) | +39.9 R (6 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +9.4 R (10 trades) | +9.4 R (10 trades) | 📉 Lower Real Profit |

---

## GER40.Daily

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 54 (56.3%) | 58 (61.1%) | ✅ Improved |
| **Curve-Fitting Mistakes** (Failed OOS) | 9 (9.4%) | 8 (8.4%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +56.6 R (8 trades) | +55.0 R (8 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +23.3 R (7 trades) | +17.0 R (13 trades) | 📉 Lower Real Profit |

---

## JPN225.Daily

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 44 (33.1%) | 24 (23.3%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 60 (45.1%) | 54 (52.4%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +53.9 R (17 trades) | +62.4 R (27 trades) | 📈 Higher Peak |
| **Peak Out-Of-Sample Net R** | +20.6 R (19 trades) | +15.6 R (18 trades) | 📉 Lower Real Profit |

---

## NAS100.Daily

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 75 (55.6%) | 67 (52.3%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 17 (12.6%) | 19 (14.8%) | ⚠️ Worse (More CF) |
| **Peak In-Sample Net R** | +63.3 R (15 trades) | +63.3 R (15 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +21.6 R (21 trades) | +46.2 R (26 trades) | 📈 Higher Real Profit |

---

## NZDUSD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 6 (10.2%) | 5 (8.8%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 0 (0.0%) | 0 (0.0%) | ➖ Stable |
| **Peak In-Sample Net R** | +16.9 R (4 trades) | +16.9 R (4 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +3.0 R (8 trades) | +3.0 R (8 trades) | 📉 Lower Real Profit |

---

## SPX500.Daily

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 22 (32.4%) | 19 (28.4%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 6 (8.8%) | 3 (4.5%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +25.3 R (11 trades) | +25.3 R (11 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +7.0 R (15 trades) | +5.4 R (10 trades) | 📉 Lower Real Profit |

---

## US30.Daily

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 93 (68.9%) | 91 (68.4%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 23 (17.0%) | 22 (16.5%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +82.9 R (25 trades) | +82.9 R (26 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +30.3 R (29 trades) | +30.3 R (29 trades) | 📉 Lower Real Profit |

---

## USDCAD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 19 (26.0%) | 18 (25.4%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 1 (1.4%) | 3 (4.2%) | ⚠️ Worse (More CF) |
| **Peak In-Sample Net R** | +26.1 R (5 trades) | +26.1 R (5 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +5.9 R (3 trades) | +6.6 R (7 trades) | 📈 Higher Real Profit |

---

## USDCHF

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 28 (30.4%) | 26 (30.2%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 3 (3.3%) | 3 (3.5%) | ➖ Stable |
| **Peak In-Sample Net R** | +26.4 R (4 trades) | +26.4 R (4 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +9.9 R (6 trades) | +9.9 R (6 trades) | 📉 Lower Real Profit |

---

## USDJPY

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 64 (48.5%) | 53 (43.8%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 18 (13.6%) | 25 (20.7%) | ⚠️ Worse (More CF) |
| **Peak In-Sample Net R** | +58.3 R (13 trades) | +58.2 R (13 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +19.5 R (20 trades) | +19.5 R (20 trades) | 📉 Lower Real Profit |

---

## XAUUSD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 72 (54.5%) | 77 (60.2%) | ✅ Improved |
| **Curve-Fitting Mistakes** (Failed OOS) | 20 (15.2%) | 13 (10.2%) | ✅ Safer (Less CF) |
| **Peak In-Sample Net R** | +65.2 R (16 trades) | +62.2 R (21 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +18.0 R (10 trades) | +16.4 R (22 trades) | 📉 Lower Real Profit |

---

## XTIUSD

| Metric | Standard GA (80 Gen, No Epochs) | Tiered Epoch GA (30/30/20) | Change/Progress |
|--------|--------------------------------|----------------------------|-----------------|
| **Robust Setups Found** (High IS, Pos OOS) | 14 (15.1%) | 9 (9.9%) | 📉 Decreased |
| **Curve-Fitting Mistakes** (Failed OOS) | 9 (9.7%) | 12 (13.2%) | ⚠️ Worse (More CF) |
| **Peak In-Sample Net R** | +40.5 R (10 trades) | +40.5 R (10 trades) | 📉 Lower Peak |
| **Peak Out-Of-Sample Net R** | +7.0 R (3 trades) | +7.0 R (3 trades) | 📉 Lower Real Profit |

---


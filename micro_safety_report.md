# Dynamic Trade Rejection Simulation ($100 Account)

This simulation tests starting a fresh $100 account at the beginning of each month over the last 1 year. It uses the proposed **Dynamic Trade Rejection** logic: if the minimum broker lot size (0.01) mathematically risks more than 3% ($3), the trade is rejected.

| Month | Starting Balance | Ending Balance | Max Drawdown | Trades Taken | Trades Rejected | Net Profit | Time to $300 |
|-------|-----------------:|---------------:|-------------:|-------------:|----------------:|-----------:|-------------:|
| 2025-05 | $100.00 | $24686.91 | 18.99% | 250 | 2 | $24586.91 | 7 days (55 trades) |
| 2025-06 | $100.00 | $6163.85 | 29.23% | 201 | 0 | $6063.85 | 5 days (28 trades) |
| 2025-07 | $100.00 | $13504.75 | 20.00% | 195 | 0 | $13404.75 | 3 days (30 trades) |
| 2025-08 | $100.00 | $1438.75 | 24.73% | 159 | 0 | $1338.75 | 14 days (86 trades) |
| 2025-09 | $100.00 | $1280.32 | 35.69% | 139 | 1 | $1180.32 | 9 days (43 trades) |
| 2025-10 | $100.00 | $211181.58 | 21.81% | 180 | 5 | $211081.58 | 9 days (54 trades) |
| 2025-11 | $100.00 | $7959.00 | 30.82% | 167 | 0 | $7859.00 | 6 days (24 trades) |
| 2025-12 | $100.00 | $1136.25 | 22.22% | 126 | 0 | $1036.25 | 9 days (35 trades) |
| 2026-01 | $100.00 | $2785.20 | 22.33% | 173 | 0 | $2685.20 | 15 days (58 trades) |
| 2026-02 | $100.00 | $4319.67 | 39.96% | 189 | 2 | $4219.67 | 6 days (48 trades) |
| 2026-03 | $100.00 | $3659683.02 | 24.69% | 253 | 11 | $3659583.02 | 11 days (96 trades) |
| 2026-04 | $100.00 | $6101.20 | 16.91% | 147 | 0 | $6001.20 | 9 days (49 trades) |

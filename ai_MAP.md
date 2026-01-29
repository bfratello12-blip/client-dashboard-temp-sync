# AI_MAP.md — ScaleAble Client Dashboard

## High-level overview
ScaleAble is a Next.js + Supabase dashboard that ties ad spend to profit. Raw platform data lands in Supabase, then server-side cron routes compute daily profit and derived KPIs. The UI reads from derived tables and visualizes profitability; trend lines use the same formulas as KPI cards.

Key idea: profit is computed server-side in `app/api/cron/rolling-30/route.ts` and stored in `daily_profit_summary`.

## Architecture (code + data flow)
- UI: `app/page.tsx` (dashboard), `app/settings/page.tsx` (cost inputs)
- API routes: `app/api/**` (platform sync + cron builders)
- Data store: Supabase (Postgres)
- Profit calculation: `computeDailyProfitSummary()` in `app/api/cron/rolling-30/route.ts`

Flow:
1) Shopify/Google/Meta sync routes pull raw data into Supabase.
2) `/api/cron/rolling-30` reads raw tables + cost settings, writes `daily_profit_summary` and refreshes `monthly_rollup` for months in the window.
3) UI reads `daily_profit_summary`, `daily_metrics`, `daily_sales_summary`, and `monthly_rollup`.

## Daily sync pipeline
### `/api/cron/daily-sync`
- Orchestrates a daily run:
  - Shopify sync (`/api/shopify/sync`)
  - Shopify daily line items sync (`/api/shopify/daily-line-items-sync`)
  - Google Ads sync (`/api/googleads/sync`)
  - Meta sync (`/api/meta/sync`)
  - Profit rebuild (`/api/cron/rolling-30`)
- Uses a rolling last-30-days window so late conversions or edits are corrected.

### `/api/cron/rolling-30`
- Rebuilds profitability for a date window.
- Reads:
  - `daily_metrics` (Shopify revenue + ad spend)
  - `daily_sales_summary` (Shopify units/ASP)
  - `client_cost_settings` (cost assumptions)
  - `shopify_daily_line_items` + `shopify_variant_unit_costs` (unit-cost coverage)
- Writes:
  - `daily_profit_summary` (authoritative derived profit table)
  - `monthly_rollup` (month aggregates for the window)

### `/api/shopify/unit-cost-backfill`
- Manual backfill for historical ranges.
- Runs line-item sync (including unit costs) and then `rolling-30` for the same window.

## Shopify line items & unit cost handling
- `shopify_daily_line_items` stores daily inventory-item-level units and revenue (also keeps variant_id when available).
- `shopify_variant_unit_costs` stores unit cost keyed by `inventory_item_id` (and variant_id when available).
- Unit costs are pulled from Shopify InventoryItem.unitCost and upserted by `(client_id, inventory_item_id)`.
- In `/api/cron/rolling-30`, per-day coverage is aggregated as:
  - `revenue_with_cogs += line_revenue` when unit cost exists
  - `product_cogs_known += units * unit_cost_amount`
- Coverage percent is computed as `revenue_with_cogs / total_revenue` for the day.

## Profit computation logic
Location: `computeDailyProfitSummary()` in `app/api/cron/rolling-30/route.ts`.

Inputs:
- Revenue, orders, units (Shopify)
- Paid spend (Meta/Google)
- Cost settings from `client_cost_settings`
- Unit-cost coverage aggregates (product cogs known + revenue with cogs)

Key outputs written to `daily_profit_summary`:
- `revenue`, `orders`, `units`, `paid_spend`
- `est_cogs`, `est_processing_fees`, `est_fulfillment_costs`
- `est_other_variable_costs`, `est_other_fixed_costs`
- `contribution_profit` (profit after costs and paid spend)
- `profit_mer` (contribution_profit ÷ paid_spend)
- Coverage fields: `product_cogs_known`, `revenue_with_cogs`, `cogs_coverage_pct`

Fallback rules:
- For missing unit costs, COGS are estimated using `default_gross_margin_pct` on the uncovered revenue portion.
- Coverage does not come from fallback usage; it comes from unit-cost coverage only.

## Cost settings and profit impact
Table: `client_cost_settings`
- `default_gross_margin_pct` (fallback margin)
- `avg_cogs_per_unit`
- `processing_fee_pct`, `processing_fee_fixed`
- `pick_pack_per_order`, `shipping_subsidy_per_order`, `materials_per_order`
- `other_variable_pct_revenue`, `other_fixed_per_day`
- `margin_after_costs_pct` (optional override for UI fallback only)

These settings feed into `computeDailyProfitSummary()` to estimate COGS and fees when unit costs are missing.

## Key Supabase tables
Raw inputs:
- `daily_metrics` (ad spend + channel revenue)
- `daily_sales_summary` (Shopify units, AOV, ASP)
- `shopify_daily_line_items` (variant-level revenue/units)
- `shopify_variant_unit_costs` (unit cost per inventory item / variant)

Derived outputs:
- `daily_profit_summary` (profit + coverage per day)
- `monthly_rollup` (view; monthly aggregates, including contribution_profit and cost sums)

Operational/system:
- `events`
- `client_integrations`
- `shopify_app_installs`
- `shopify_oauth_states`

## KPI definitions (UI)
Source: `app/page.tsx`
- Profit: uses `daily_profit_summary.contribution_profit` (or fallback margin override if configured)
- Profit MER: `contribution_profit ÷ paid_spend` (from `daily_profit_summary`)
- COGS coverage: `revenue_with_cogs ÷ revenue` per day in `daily_profit_summary`
- Profit Return (KPI card): `revenue ÷ total_costs`, where
  - total_costs = paid_spend + est_cogs + est_processing_fees + est_fulfillment_costs + est_other_variable_costs + est_other_fixed_costs

## Dashboard data sources
- KPI cards: `daily_profit_summary`, `daily_metrics`, `daily_sales_summary`
- Trend charts: `daily_metrics` + derived series from `daily_profit_summary`
- COGS coverage indicator: `daily_profit_summary` (revenue-weighted over last 7 days)
- Monthly table: `monthly_rollup`

## Known assumptions & constraints
- Dates are daily buckets; recent days can be recalculated.
- Older history is expected to remain stable.
- Profit is computed server-side; the UI uses derived totals and trends from `daily_profit_summary`.
- Unit-cost coverage depends on `shopify_variant_unit_costs` freshness.
- `margin_after_costs_pct` is a UI fallback, not a data source override.

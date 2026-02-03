# AI_MAP.md — ScaleAble Dashboard System Map

This document is the authoritative, implementation-accurate system map for the ScaleAble Dashboard.
It is written for AI agents and engineers who need precise, non-speculative guidance.

---

## 1) High-level purpose

### What ScaleAble Dashboard is
- A profit-first analytics dashboard for Shopify merchants running paid media.
- An embedded Shopify Admin app with a shared data layer (Supabase).

### Problems it solves
- Ad platforms report attributed revenue, not business-truth revenue.
- Merchants need profit and efficiency metrics derived from Shopify sales plus paid spend and costs.

### Profit-first analytics positioning
- Shopify revenue (total_sales) is the ground truth.
- Paid spend is included once.
- Profit is computed after costs, not after attribution.

---

## 2) Architecture overview

- Single VS Code repo for all logic (UI + API).
- Multiple client apps exist as separate Shopify apps and separate Vercel deployments.
- Supabase is the shared data layer.
- Client isolation is enforced by client_id across all tables and API routes.

---

## 3) Core data model (tables + responsibility)

### clients
- Purpose: tenant root + per-client configuration.
- Writes: internal admin processes, migrations.
- Reads: Shopify sync, POS exclusions, UI.

### client_integrations
- Purpose: OAuth configuration for Google Ads / Meta.
- Writes: OAuth connect flows.
- Reads: sync endpoints to fetch spend.

### client_cost_settings
- Purpose: cost assumptions for recompute.
- Writes: Settings UI.
- Reads: /api/shopify/recompute.

### daily_metrics
- Purpose: daily rollups by source (shopify, google, meta).
- Writes: /api/shopify/sync, /api/googleads/sync, /api/meta/sync.
- Reads: /api/shopify/recompute, UI charts, rolling summaries.

### shopify_daily_line_items
- Purpose: per-day line item aggregation by inventory_item_id.
- Writes: /api/shopify/daily-line-items-sync.
- Reads: /api/shopify/recompute (for COGS coverage).

### shopify_variant_unit_costs
- Purpose: unit costs by inventory item / variant.
- Writes: /api/shopify/daily-line-items-sync (inventory cost fetch).
- Reads: /api/shopify/recompute.

### daily_shopify_cogs_coverage
- Purpose: coverage of known COGS for Shopify revenue.
- Writes: /api/shopify/recompute (after line item aggregation).
- Reads: /api/shopify/recompute for profit summary.

### daily_profit_summary
- Purpose: profit truth table used by dashboard and rolling summaries.
- Writes: /api/shopify/recompute.
- Reads: UI, rolling summaries.

---

## 4) Shopify ingestion flow (IMPORTANT)

### ShopifyQL revenue sync
- Revenue is pulled via ShopifyQL: FROM sales SHOW total_sales TIMESERIES day.
- POS exclusion is applied when enabled:
	WHERE sales_channel NOT IN ('Point of Sale', ...)
- The resulting total_sales is stored as daily_metrics.revenue (source=shopify).

### Revenue vs line item revenue
- Revenue (ShopifyQL total_sales) includes taxes and shipping, minus discounts as per ShopifyQL definition.
- Line item revenue is derived from lineItems.discountedTotalSet (line-level net of discounts).
- These differ by taxes, shipping, and discounts.

---

## 5) Line-item + unit cost flow

### /api/shopify/daily-line-items-sync
- Pulls orders + lineItems via Shopify Admin GraphQL.
- Day bucketing is based on processedAt converted to shop timezone (YYYY-MM-DD).
- Aggregates by day + inventory_item_id.
- line_revenue uses discountedTotalSet (line-level net of discounts).

### Unit costs
- Inventory item unit costs are fetched via Shopify GraphQL.
- Stored in shopify_variant_unit_costs.

---

## 6) COGS coverage logic (CRITICAL)

### Definitions
- productCogsKnown: sum(units * unit_cost) for line items with unit cost.
- units_with_cogs: units that have known unit cost.
- revenue_with_cogs_raw: sum(line_revenue) for items with known unit cost.

### Why raw coverage can exceed 1.0
- line_revenue excludes taxes/shipping and can exceed ShopifyQL total_sales in some edge cases.
- This inflates revenue_with_cogs_raw relative to daily revenue.

### Clamp and scaling
- revenue_with_cogs is clamped to daily Shopify revenue:
	revenue_with_cogs = min(revenue_with_cogs_raw, revenue)
- productCogsKnown is scaled proportionally when clamping occurs:
	scale = revenue_with_cogs_clamped / revenue_with_cogs_raw
	productCogsKnown = productCogsKnownRaw * scale

### Raw vs effective coverage
- Raw coverage: revenue_with_cogs_raw / revenue
- Effective coverage: revenue_with_cogs_clamped / revenue (must be <= 1)
- Effective coverage can be 100% even if unit coverage < 100% because revenue_with_cogs_raw can exceed revenue.

---

## 7) Fallback COGS behavior

### When fallback is used
- Any uncovered revenue uses default_gross_margin_pct.

### How fallback is applied
- fallbackCogsPct = 1 - default_gross_margin_pct
- fallbackCogs = uncoveredRevenue * fallbackCogsPct

### Priority
- Unit costs always take precedence.
- Fallback applies only to uncovered revenue.

---

## 8) Profit recompute logic

### Inputs
- daily_metrics (shopify revenue/orders/units + paid spend)
- shopify_daily_line_items
- shopify_variant_unit_costs
- client_cost_settings

### Order of operations
1) Build daily coverage from line items + unit costs.
2) Clamp revenue_with_cogs and scale productCogsKnown when needed.
3) Compute est_cogs and costs.
4) Write daily_profit_summary and daily_shopify_cogs_coverage.

### Cost formulas
- est_processing_fees = revenue * processing_fee_pct + orders * processing_fee_fixed
- est_fulfillment_costs = orders * pick_pack_per_order
- est_other_variable_costs = orders * shipping_subsidy_per_order + orders * materials_per_order + revenue * other_variable_pct_revenue
- est_other_fixed_costs = other_fixed_per_day

### Contribution profit formula
contribution_profit =
	revenue - (
		est_cogs +
		est_processing_fees +
		est_fulfillment_costs +
		est_other_variable_costs +
		est_other_fixed_costs +
		paid_spend
	)

---

## 9) Backfill strategy

- Month-by-month historical backfill to avoid API limits.
- Idempotent upserts for daily tables.
- Full historical backfill uses ShopifyQL + line items + recompute.
- Rolling-30 maintenance updates recent 30 days daily.

---

## 10) Cron strategy (INTENT)

### Daily cron should do
1) ShopifyQL revenue sync
2) Google Ads sync
3) Meta Ads sync
4) Line-items sync
5) Recompute
6) Rolling-30 refresh

### Why recompute is required
- Line items and unit costs arrive asynchronously.
- Recompute aligns profit with current COGS coverage.

### Per-client isolation
- All writes and reads are scoped by client_id.
- Errors for one client must not block others.

---

## 11) Known gotchas & invariants

- ShopifyQL revenue (POS excluded when configured) is the authoritative revenue.
- revenue_with_cogs must never exceed revenue in stored data.
- Recompute must run after line-item sync to ensure accurate COGS coverage.
- Failures for one client must not stop others in multi-client sync.

## 13) Current Clients on Dashboard

- Clients Name: FlyFishSD
- client_id: 6a3a4187-b224-4942-b658-0fa23cb79eac
- Vercel Domain: client-dashboard-temp-customapp.vercel.app
- Bearer: Laughing_Lab_1011

- Clients Name: Wild Water Fly Fishing
- client_id: f298424f-d14c-4946-8a3a-4ce8ccabdadf
- Vercel Domain: scaleable-dashboard-wildwater.vercel.app
- Bearer: Laughing_Lab_1011

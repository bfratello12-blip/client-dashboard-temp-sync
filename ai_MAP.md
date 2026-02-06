# AI_MAP.md — ScaleAble Dashboard System Map

This document is the authoritative, implementation-accurate system map for the ScaleAble Dashboard.
It is written for AI agents and engineers who need precise, non-speculative guidance.

---

## 1) High-Level Architecture

### What ScaleAble is
- A profit-first analytics dashboard for Shopify merchants running paid media.
- An embedded Shopify Admin app backed by Supabase (data storage + security).
- A Next.js App Router app with server routes under app/api.

### Multi-client architecture
- Single repo with shared UI + API logic.
- Multiple Shopify apps (per client) and multiple Vercel deployments.
- All data is scoped by client_id; multi-tenant isolation is enforced at query level.

### Relationship between Shopify embedded app, Supabase, and cron jobs
- Shopify embedded app handles OAuth and writes shop install metadata into Supabase.
- Supabase stores all daily rollups, line items, unit costs, and profit summaries.
- Vercel cron routes trigger daily sync and rolling recomputation.

---

## 2) Core Data Flow (End-to-End)

### Shopify OAuth → token storage (shopify_app_installs)
- Shopify OAuth completes in /api/shopify/oauth.
- Resulting access token and shop_domain are stored in shopify_app_installs.
- shopify_app_installs maps shop_domain → client_id.

### Shopify sync → daily sales + line items
- /api/shopify/sync (ShopifyQL) writes daily_metrics (shopify revenue/orders/units).
- /api/shopify/daily-line-items-sync writes shopify_daily_line_items and shopify_variant_unit_costs.

### Ad platform syncs (Google Ads, Meta)
- /api/googleads/sync writes daily_metrics for Google spend.
- /api/meta/sync writes daily_metrics for Meta spend.

### Convergence into daily_profit_summary
- /api/shopify/recompute combines daily_metrics + shopify_daily_line_items + unit costs + client_cost_settings.
- Outputs daily_profit_summary (source of truth for profitability metrics).

---

## 3) Shopify Data Model (Critical)

### shopify_daily_line_items
- Purpose: per-day aggregation of Shopify line items by inventory_item_id.
- Columns (key): client_id, date, inventory_item_id, variant_id, units, line_revenue.
- Usage: Source of truth for unit-cost coverage and COGS composition.
- Why: line items are the only reliable place to determine which units truly have a Shopify unit cost.

### shopify_variant_unit_costs
- Purpose: cache of Shopify unit costs per inventory item/variant.
- Columns (key): client_id, inventory_item_id, variant_id, unit_cost_amount, updated_at.
- Usage: joined with shopify_daily_line_items to compute COGS coverage.

### shopify_unit_costs
- Purpose: legacy/auxiliary table for unit costs (if present in environment).
- Usage: generally superseded by shopify_variant_unit_costs.

### daily_sales_summary
- Purpose: aggregate daily sales metrics (if present in environment).
- Usage: legacy; daily_metrics is the primary source for daily totals.

### daily_profit_summary
- Purpose: profit truth table for UI + rolling summaries.
- Columns (key): client_id, date, revenue, paid_spend, est_cogs, contribution_profit, units_with_cogs, etc.

### inventory_item_id vs variant_id
- inventory_item_id is the authoritative key for Shopify unit costs.
- variant_id is useful for UI linking but unit costs are attached to inventory items.
- Always use inventory_item_id when checking unit cost existence.

### Why line items are the source of truth for unit coverage
- Only line items can confirm whether a sold unit had a real Shopify unit cost.
- Revenue totals can be derived elsewhere, but coverage must use line items.

---

## 4) COGS Logic (MOST IMPORTANT SECTION)

### A. Unit Cost Coverage
- Meaning: share of units with a real Shopify unit cost.
- Calculation (7-day weighted): sum(units_with_unit_cost) / sum(units_total).
- Source of truth: unit_cost_coverage_daily (VIEW).
- Only counts real Shopify unit costs.
- Fallback costs are NOT included.

### B. Effective COGS Coverage
- Meaning: revenue-weighted effective coverage used to stabilize profit.
- Includes fallback costs.
- Used internally for profit stability only.
- Not shown in Settings anymore.

---

## 5) Fallback COGS System

### When fallback is used
- When a line item does not have a Shopify unit cost.

### How GM fallback rate works
- default_gross_margin_pct is stored in client_cost_settings.
- fallback_cogs_pct = 1 - default_gross_margin_pct.
- fallback_cogs = uncovered_revenue * fallback_cogs_pct.

### Why fallback prevents profit cliffs
- Without fallback, missing unit costs would create unrealistically high profit.
- Fallback keeps profit stable while coverage improves.

### How fallback affects revenue but not unit coverage
- Revenue is always ShopifyQL total_sales.
- Fallback impacts est_cogs but NOT unit cost coverage.

---

## 6) Profit Calculation Pipeline

### Inputs to computeDailyProfitSummary
- daily_metrics (shopify revenue/orders/units + paid spend).
- shopify_daily_line_items (units + line_revenue by inventory item).
- shopify_variant_unit_costs (unit_cost_amount).
- client_cost_settings (fallback + cost assumptions).

### Meaning of key fields
- product_cogs_known: sum(units * unit_cost) for items with a real unit cost.
- estimated_cogs_missing: fallback COGS for uncovered revenue.
- revenue_with_cogs: revenue covered by real unit costs (clamped to revenue).
- est_cogs: product_cogs_known + estimated_cogs_missing.

### Why clamping is used
- line item revenue can exceed ShopifyQL total_sales.
- Clamp revenue_with_cogs to revenue and scale product_cogs_known accordingly.

---

## 7) Cron Jobs (VERY DETAILED)

### /api/cron/daily-sync
- Purpose: daily sync of Shopify + ad platforms, then recompute.
- Steps (per client):
	- ShopifyQL revenue sync → daily_metrics.
	- Google Ads sync → daily_metrics.
	- Meta sync → daily_metrics.
	- Shopify line-items sync → shopify_daily_line_items + shopify_variant_unit_costs.
	- Recompute profit → daily_profit_summary.
- Failure handling:
	- Each step logs errors; a failed client should not stop other clients.
	- Recompute must run after line-item sync for accurate coverage.

### /api/cron/rolling-30
- Purpose: refresh last 30 days profitability using current unit costs.
- Steps (per client):
	- For each client_id, recompute profit for the last 30 days.
	- Handles retries/backoff for transient errors.
- Writes:
	- daily_profit_summary (upserts for last 30 days).
	- daily_shopify_cogs_coverage.
- Important:
	- Avoid writing to views like monthly_rollup or unit_cost_coverage_daily.

### Why views cannot be written to
- Supabase views are read-only unless explicitly defined as writable.
- Attempted inserts into views fail and surface as schema cache errors.

---

## 8) Views vs Tables (Important Gotcha)

### Known views
- unit_cost_coverage_daily (VIEW): read-only precomputed coverage.
- monthly_rollup (VIEW): monthly aggregates for UI.

### Why inserting into views causes failures
- Postgres blocks inserts/updates on read-only views.
- Supabase returns schema cache errors when attempting to write.

### How schema cache errors surface
- API responses will show Postgres errors like “cannot insert into view”.
- Rolling-30 can fail if it attempts to write to a view.

---

## 9) Settings Page Logic

### Where Settings pulls data from
- Unit Cost Coverage (7d) is computed from unit_cost_coverage_daily (VIEW).
- Effective COGS Coverage is no longer displayed in Settings.

### How Unit Cost Coverage (7d) is computed
- Query: unit_cost_coverage_daily (client_id) ordered by date desc limit 7.
- Weighted average: sum(units_with_unit_cost) / sum(units_total).
- If rows exist but sum(units_total) = 0 → display 0%.

### Why this query is read-only
- unit_cost_coverage_daily is a view; do not write to it.

### Conditions that cause “—” to display
- No rows for the last 7 days (coverageRows.length === 0).
- cogsCoveragePct is null.

---

## 10) Common Debug Playbook

### Validate profit for a single day
- SQL:
	- daily_profit_summary for client_id + date.
	- compare to daily_metrics for revenue/spend.

### Validate unit cost coverage
- SQL:
	- unit_cost_coverage_daily for last 7 days.
	- verify units_with_unit_cost and units_total sums.

### Safely re-run rolling-30 without resyncing
- Call /api/cron/rolling-30 with skipSyncs=1 (if supported in current code).
- Ensure it only recomputes profitability for last 30 days.

### Confirm data freshness
- Check latest date rows in daily_metrics and daily_profit_summary.
- Verify line item sync timestamp in shopify_daily_line_items.

### Warnings (easy mistakes)
- Do not write to views (unit_cost_coverage_daily, monthly_rollup).
- Do not treat effective COGS coverage as unit coverage.
- Always clamp revenue_with_cogs to ShopifyQL total_sales.

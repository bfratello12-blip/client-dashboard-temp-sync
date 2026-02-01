# AI_MAP.md — ScaleAble Platform Map

This document is a technical system map for the ScaleAble platform. It is written for senior engineers joining mid-build and is intended to be a self-contained reference for architecture, data flow, and operations.

---

## 1) System Purpose

### What ScaleAble is
ScaleAble is a profit-first analytics platform for Shopify merchants running paid media. It is both:
- An embedded Shopify Admin app
- A multi-client SaaS dashboard

### Business problem solved
Ad platforms report attributed revenue, which diverges from real business revenue and profit. ScaleAble reconciles Shopify revenue with paid spend and COGS to produce business-truth metrics that inform spend allocation and profitability.

### Why profit-first metrics matter
ScaleAble prioritizes metrics that reflect actual business health:
- COGS coverage: validates how much product-level cost data is known.
- Contribution profit: revenue minus paid spend and variable costs.
- MER: revenue ÷ paid spend (business-level efficiency, not just ad attribution).
- Rolling-30: stabilizes volatility and removes daily noise for decision-making.

---

## 2) High-Level Architecture

### Next.js App Router structure
- App Router is used for both UI and API.
- API routes live under app/api/...
- UI routes live under app/.../page.tsx

### Client vs server separation
- Server code: API routes (data sync, auth, recompute).
- Client code: dashboard UI and charts.

### Why page.tsx delegates to page.client.tsx
- app/page.tsx is a server component that resolves the `client_id`.
- It passes the resolved client context to app/page.client.tsx (client component) which handles all client-side rendering, hooks, and charts.

---

## 3) Data Model (Supabase)

### Core tables

#### clients
- Canonical tenant table.
- Each Shopify store maps to a single `client_id`.

#### client_integrations
- Stores non-Shopify integrations (Google Ads, Meta).
- Contains access tokens, ad account IDs, and metadata.

#### shopify_app_installs
- Source of truth for Shopify store → client mapping.
- Stores shop domain, access token, scopes, and install metadata.

#### daily_metrics
- Unified daily rollups across sources.
- Key fields: date, client_id, source (shopify/google/meta), spend, revenue, units, orders, clicks, impressions, conversions.
- Shopify rows are the source of truth for revenue/units/orders.

#### shopify_daily_line_items
- Per-day line-item totals by variant/product.
- Used for COGS and coverage calculations.
- Includes refunds where applicable.

#### shopify_variant_unit_costs
- Unit cost per Shopify inventory item / variant.
- Used to compute actual COGS coverage.

#### daily_profit_summary
- Derived daily profit metrics.
- Stores revenue, paid_spend, estimated costs, contribution_profit, mer, profit_mer.

#### daily_shopify_cogs_coverage
- Coverage summary for unit cost availability on daily Shopify revenue.
- Tracks how much revenue is backed by real unit costs.

### Relationships
- `clients` is the tenant root.
- `shopify_app_installs.client_id` maps Shopify store → tenant.
- `daily_metrics.client_id` aggregates all sources per tenant/day.
- `shopify_daily_line_items` and `shopify_variant_unit_costs` feed COGS coverage and profit recompute.
- `daily_profit_summary` is derived from `daily_metrics` + cost settings + COGS coverage.

---

## 4) Shopify Integration

### OAuth / token strategy
- OAuth begins at /api/shopify/oauth/start.
- OAuth callback stores access tokens in Supabase (`shopify_app_installs`).
- Tokens are not stored in env vars to support multi-tenant installs and rotation.

### Why tokens live in Supabase
- Supports multiple stores across clients.
- Allows per-client revocation and reauthorization.
- Fits Shopify’s embedded app model where tokens are tenant-scoped.

### Daily orders vs line items vs unit costs
- Daily orders and revenue are sourced via ShopifyQL and stored in `daily_metrics` (source=shopify).
- Line items are pulled via Shopify Admin API and stored in `shopify_daily_line_items`.
- Unit costs are stored in `shopify_variant_unit_costs` and joined during recompute.

---

## 5) Cost & Profit Computation

### COGS coverage
- For each day, line items are joined with `shopify_variant_unit_costs`.
- Coverage = revenue_with_costs ÷ total_revenue.
- Missing costs are captured and reported in `daily_shopify_cogs_coverage`.

### Missing unit costs
- If unit cost is missing, estimated COGS is applied using client-level defaults.
- Defaults are stored in client cost settings.

### Contribution profit and profit MER
Computed during recompute and stored in `daily_profit_summary`:
- contribution_profit = revenue - (paid_spend + est_cogs + est_processing_fees + est_fulfillment_costs + est_other_variable_costs + est_other_fixed_costs)
- mer = revenue ÷ paid_spend
- profit_mer = contribution_profit ÷ paid_spend

Contribution profit is **fully net of all estimated costs** and must be treated as the canonical profit metric downstream.

---

## 6) Chart & KPI Logic

### Shopify-only vs all-source aggregations
- Shopify truth: revenue, orders, units are always derived from `daily_metrics` where source=shopify.
- All-source spend: `daily_metrics` where source in {google, meta}.

### Why charts use timestamps
- Recharts expects numeric time values for continuous scale.
- Each chart row includes a `ts` field derived from ISO date.

### Common chart pitfalls
- Missing `ts` results in blank charts or broken tooltips.
- ResponsiveContainer can render before the parent has size (Shopify iframe timing).
- Always guard chart render with non-zero size and fixed-height wrapper.

---

## 7) Cron & Automation Design

### /api/cron/daily-sync (step-by-step)
1) Shopify sync (daily_metrics revenue/orders/units)
2) Google Ads sync (daily_metrics spend + metrics)
3) Meta Ads sync (daily_metrics spend + metrics)
4) Shopify daily line items sync (line items + refunds)
5) Shopify recompute (profit + COGS coverage)
6) Rolling-30 recompute

### **Rolling-30 KPI Computation (Canonical)**

**Important: this supersedes any older rolling-30 logic.**

- Rolling-30 KPIs are **derived dynamically from daily tables**.
- **Profit source of truth:** `daily_profit_summary.contribution_profit`.
- **Spend source of truth:** `daily_metrics.spend` where source in (`google`, `meta`).
- Profit and spend are **aggregated independently** over the same 30-day window.
- **The UI must never recompute profit** from revenue or subtract cost fields.
- **No `est_*` cost columns are used in frontend calculations.**

**Rolling-30 formulas:**
- Rolling Profit = `sum(contribution_profit)`
- Rolling Spend = `sum(spend)`
- Profit Return / Profit MER = `Rolling Profit ÷ Rolling Spend`

This design prevents:
- Double-subtraction of processing fees
- Duplication of profit across multiple ad sources
- Drift between SQL truth and dashboard KPIs

Rolling-30 values are validated against SQL ground truth and must match exactly.

### Why each Vercel deployment has the same cron path
- Each deployment is self-contained; cron endpoints are identical across deploys.
- Orchestrators always target the current deployment origin.

---

## 8) Backfill Strategy

### Why month-by-month
- ShopifyQL can overwrite older historical data beyond 60 days.
- Month windows keep data stable and avoid API timeouts.

### What gen_backfill_cmds.js generates
- A month-by-month bash script:
  - Shopify sync
  - Google sync
  - Meta sync
  - Line items sync
  - Recompute
  - Rolling-30

### How to safely backfill multiple years
- Run one month first as a sanity check.
- Run sequential months to avoid API limits.
- Verify coverage and profit after each batch.

---

## 9) Canonical Curl Commands

Daily sync:
```
curl -i "https://YOUR_DOMAIN/api/cron/daily-sync?client_id=<CLIENT_ID>&token=<SYNC_TOKEN>"
```

Shopify sync:
```
curl -sS -X POST "https://YOUR_DOMAIN/api/shopify/sync?client_id=<CLIENT_ID>&start=YYYY-MM-DD&end=YYYY-MM-DD&force=1" \
  -H "Content-Type: application/json"
```

Google Ads sync:
```
curl -sS -X POST "https://YOUR_DOMAIN/api/googleads/sync?client_id=<CLIENT_ID>&start=YYYY-MM-DD&end=YYYY-MM-DD&fillZeros=1" \
  -H "Authorization: Bearer <SYNC_TOKEN>" \
  -H "Content-Type: application/json"
```

Meta Ads sync:
```
curl -sS -X POST "https://YOUR_DOMAIN/api/meta/sync?client_id=<CLIENT_ID>&start=YYYY-MM-DD&end=YYYY-MM-DD&fillZeros=1" \
  -H "Authorization: Bearer <SYNC_TOKEN>" \
  -H "Content-Type: application/json"
```

Line items + unit costs:
```
curl -sS -X POST "https://YOUR_DOMAIN/api/shopify/daily-line-items-sync?client_id=<CLIENT_ID>&start=YYYY-MM-DD&end=YYYY-MM-DD" \
  -H "Authorization: Bearer <SYNC_TOKEN>" \
  -H "Content-Type: application/json"
```

Recompute:
```
curl -sS -X POST "https://YOUR_DOMAIN/api/shopify/recompute?start=YYYY-MM-DD&end=YYYY-MM-DD&token=<SYNC_TOKEN>" \
  -H "Content-Type: application/json"
```

Rolling-30:
```
curl -sS -X POST "https://YOUR_DOMAIN/api/cron/rolling-30?client_id=<CLIENT_ID>&start=YYYY-MM-DD&end=YYYY-MM-DD&token=<SYNC_TOKEN>" \
  -H "Content-Type: application/json"
```

---

## 10) Operational Runbook

### Adding a new client
- Create `clients` row.
- Install Shopify app to generate `shopify_app_installs` entry.
- Add `client_integrations` rows for Google/Meta if needed.

### Installing Shopify app
- Start OAuth with /api/shopify/oauth/start?shop=... from embedded app.
- Ensure access token is stored in `shopify_app_installs`.

### Running initial backfill
- Generate month-by-month script with gen_backfill_cmds.js.
- Run one month first, then the rest.
- Finish with /api/cron/daily-sync for the last 30 days.

### Verifying data correctness
- Compare Shopify Analytics totals vs `daily_metrics` shopify rows.
- Confirm ad spend in `daily_metrics` matches Google/Meta.
- Check `daily_shopify_cogs_coverage` for coverage %.
- Review `daily_profit_summary` for contribution profit and MER.

### Ongoing maintenance
- Ensure daily cron runs are healthy.
- Monitor OAuth token freshness in `shopify_app_installs`.
- Validate integrations in `client_integrations` (token + account IDs).


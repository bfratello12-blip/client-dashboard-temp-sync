# AI_MAP.md — ScaleAble Platform Map

This document is the authoritative technical system map for the ScaleAble platform. It is written for engineers and AI agents who need to reason about the system without guessing.

---

## 1) High-Level Overview

### What ScaleAble is
ScaleAble is a profit-first analytics platform for small Shopify merchants running paid media. It is both:
- An embedded Shopify Admin app
- A multi-client SaaS dashboard

### Problem it solves
Ad platforms report attributed revenue that does not equal true business revenue or profit. ScaleAble reconciles:
- Shopify revenue (ground truth)
- Paid spend (Google Ads + Meta)
- COGS and variable costs

The output is a consistent, business-truth view of profit and efficiency over time.

---

## 2) Multi-Client Architecture

- Single codebase for all tenants
- Per-client Shopify apps via Shopify’s embedded app model
- `client_id` is the core identifier used across all tables, routes, and UI

Explicit behavior:
- Every API read/write is scoped to `client_id`
- All daily rollups use `client_id` + date as the primary key
- Each Shopify store maps to one `client_id` via Supabase

---

## 3) Data Model (Supabase)

### Core tables

#### clients
- Canonical tenant table
- One row per merchant

#### client_integrations
- Non-Shopify integrations
- Stores Google Ads and Meta account IDs and tokens

#### shopify_app_installs
- Source of truth for Shopify store → `client_id` mapping
- Stores shop domain, OAuth access token, scopes

#### daily_metrics
- Unified daily rollups across sources
- Key fields: date, client_id, source, spend, revenue, units, orders, clicks, impressions, conversions
- Shopify rows are the truth for revenue, orders, units

#### shopify_daily_line_items
- Per-day line item totals by variant/product
- Used for COGS and coverage calculations
- Includes refunds

#### shopify_variant_unit_costs
- Unit cost per Shopify inventory item / variant
- Used in COGS coverage and profit recompute

#### daily_profit_summary
- Derived daily profit metrics
- Stores revenue, paid_spend, estimated costs, contribution_profit, mer, profit_mer

#### daily_shopify_cogs_coverage
- Coverage summary for unit cost availability on daily Shopify revenue

---

## 4) Data Ingestion Flows

### Shopify (primary revenue source)
- ShopifyQL is the primary method
- Orders aggregation is the fallback if ShopifyQL fails
- Writes to daily_metrics with source=shopify

### Google Ads spend
- Reads client_integrations for tokens and account IDs
- Writes spend and performance metrics to daily_metrics with source in {google, google_ads, googleads}

### Meta Ads spend
- Reads client_integrations for tokens and account IDs
- Writes spend and performance metrics to daily_metrics with source=meta

---

## 5) Shopify Specifics

### Day bucketing
- Daily rollups are stored as ISO date strings (YYYY-MM-DD)
- All comparisons and joins use that date string as the day key

### Timezone handling
- Shopify reporting is aligned to the shop’s configured timezone
- Local day boundaries are converted to UTC before storage

### No POS exclusion
- POS sales are not filtered out
- Shopify revenue is treated as the canonical truth for all sales channels

### Tables written by Shopify flows
- daily_metrics (source=shopify)
- shopify_daily_line_items
- shopify_variant_unit_costs
- daily_shopify_cogs_coverage (via recompute)
- daily_profit_summary (via recompute)

---

## 6) Profit Calculation Logic

### Contribution profit (canonical)
Contribution profit is computed during recompute and stored in daily_profit_summary:

$$
	ext{contribution\_profit} = \text{revenue} - (\text{paid\_spend} + \text{est\_cogs} + \text{est\_processing\_fees} + \text{est\_fulfillment\_costs} + \text{est\_other\_variable\_costs} + \text{est\_other\_fixed\_costs})
$$

### MER (True ROAS)
$$
	ext{MER} = \frac{\text{revenue}}{\text{paid\_spend}}
$$

### Profit Return (Profit MER)
$$
	ext{Profit Return} = \frac{\text{contribution\_profit}}{\text{paid\_spend}}
$$

Explicit statement:
- Paid spend is counted once. It is not double-counted in any recompute or rolling window.

---

## 7) Recompute System

### What it reads
- daily_metrics (shopify revenue/orders/units + google/meta spend)
- shopify_daily_line_items
- shopify_variant_unit_costs
- client cost settings (default margins and variable cost assumptions)

### What it writes
- daily_profit_summary
- daily_shopify_cogs_coverage

### Why recompute exists
- ShopifyQL and line items arrive at different times
- Unit costs are updated asynchronously
- Recompute guarantees profit and coverage are consistent and idempotent

---

## 8) Cron System

### Daily rolling-30 strategy
Daily cron runs a deterministic sequence:
1) Shopify sync
2) Google Ads sync
3) Meta Ads sync
4) Shopify daily line items sync
5) Shopify recompute
6) Rolling-30 recompute

### Why rolling windows are used
- Shopify and ad APIs can be delayed or backfilled
- Rolling windows correct late-arriving data without full historical rebuilds

### Auth model
Cron-protected routes accept:
- Authorization: Bearer $CRON_SECRET
- OR ?token=$CRON_SECRET

---

## 9) Auth & Security

### CRON_SECRET
- Shared secret for all cron-protected endpoints
- Accepted via Authorization header or token query param
- If missing or invalid, the endpoint returns HTTP 401 with { ok: false, error: "Unauthorized" }

### OAuth token storage
- Shopify OAuth tokens are stored in shopify_app_installs
- Google and Meta tokens are stored in client_integrations
- Tokens are not stored in environment variables

---

## 10) Local Development Behavior

### LOCAL_CLIENT_ID
- When set, the server uses it as the default tenant in local/dev
- Allows local UI boot without passing client_id in every request

### DEV MODE rendering
- Client-side rendering is used for dashboard pages
- Server components resolve client context, then pass into client components

---

## 11) Dashboard Philosophy

### Target audience
- Small Shopify merchants with paid media spend

### Indexed ROAS vs MER chart rationale
- Indexed ROAS is presented to show trend direction without over-emphasizing absolute scale
- MER is the canonical business efficiency metric

### Charts intentionally removed
- Low-signal, high-noise charts were removed to reduce cognitive load
- Only charts that support daily decision-making remain

---

## 12) Known Constraints & Non-Goals

- Not a full attribution platform
- No multi-touch attribution modeling
- No cross-channel customer journey modeling
- Shopify revenue is treated as the ground truth
- POS sales are included, not excluded
- Rolling windows are used instead of real-time recomputation on every write

## 13) Current Clients on Dashboard

- Clients Name: FlyFishSD
- client_id: 6a3a4187-b224-4942-b658-0fa23cb79eac
- Vercel Domain: client-dashboard-temp-customapp.vercel.app
- Bearer: Laughing_Lab_1011

- Clients Name: Wild Water Fly Fishing
- client_id: f298424f-d14c-4946-8a3a-4ce8ccabdadf
- Vercel Domain: scaleable-dashboard-wildwater.vercel.app
- Bearer: Laughing_Lab_1011

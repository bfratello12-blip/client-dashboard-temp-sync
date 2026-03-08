# ScaleAble AI System Map

## 1) High‑level architecture
- Next.js 16 App Router app with server components by default; client components opt-in via "use client" (see [app/layout.tsx](app/layout.tsx), [app/page.tsx](app/page.tsx), [components/DashboardLayout.tsx](components/DashboardLayout.tsx), [app/product-performance/page.tsx](app/product-performance/page.tsx)).
- Embedded Shopify app: App Bridge CDN script must be the first `<script>` in `<head>`, and `meta[name="shopify-api-key"]` must be present (see [app/layout.tsx](app/layout.tsx)).
- API routes in [app/api](app/api) are the integration boundary: Shopify/Google Ads/Meta sync into Supabase; derived analytics are computed server-side and returned to the UI.
- Supabase is the primary data store; service-role access is used server-side through `supabaseAdmin()` and client-side through the `supabase` proxy (see [lib/supabaseAdmin.ts](lib/supabaseAdmin.ts), [lib/supabaseClient.ts](lib/supabaseClient.ts)).

## 2) Next.js app structure
- Layout & global assets: [app/layout.tsx](app/layout.tsx), [app/globals.css](app/globals.css).
- Entry point & Shopify install handling: [app/page.tsx](app/page.tsx) (server) + [app/page.client.tsx](app/page.client.tsx) (client UI).
- Core dashboard layout and navigation: [components/DashboardLayout.tsx](components/DashboardLayout.tsx), [components/Sidebar.tsx](components/Sidebar.tsx).
- Shared UI utilities: [app/components/DateRangePicker.tsx](app/components/DateRangePicker.tsx).

## 3) API routes (what each endpoint does)
### General / data
- /api/ping → health check (see [app/api/ping/route.ts](app/api/ping/route.ts)).
- /api/data/daily-metrics → returns `daily_metrics` rows for a client/date range (see [app/api/data/daily-metrics/route.ts](app/api/data/daily-metrics/route.ts)).
- /api/client-cost-settings → upserts `client_cost_settings` (cron-auth or sync token) (see [app/api/client-cost-settings/route.ts](app/api/client-cost-settings/route.ts)).
- /api/settings/coverage → unit cost coverage + effective COGS coverage over last 7 days using `unit_cost_coverage_daily` + `daily_profit_summary` (see [app/api/settings/coverage/route.ts](app/api/settings/coverage/route.ts)).
- /api/sales/summary → reads `daily_sales_summary` for a fixed `CLIENT_ID` (see [app/api/sales/summary/route.ts](app/api/sales/summary/route.ts)).
- /api/events → CRUD on `events` table (see [app/api/events/route.ts](app/api/events/route.ts)).
- /api/events/compare → compares pre/post window performance from `daily_profit_summary` (see [app/api/events/compare/route.ts](app/api/events/compare/route.ts)).
- /api/integrations/status → reports Shopify/Google/Meta connection status from `client_integrations` (see [app/api/integrations/status/route.ts](app/api/integrations/status/route.ts)).
- /api/product-performance → product performance RPC + Shopify metadata/inventory enrichment + filters (see [app/api/product-performance/route.ts](app/api/product-performance/route.ts)).
- /api/inventory/sync → pulls Shopify inventory levels for recent items and stores `shopify_variant_inventory` (see [app/api/inventory/sync/route.ts](app/api/inventory/sync/route.ts)).

### Sync orchestration
- /api/sync/manual-refresh → runs `runUnifiedSync()` for a client/date window (see [app/api/sync/manual-refresh/route.ts](app/api/sync/manual-refresh/route.ts), [lib/sync/unifiedSync.ts](lib/sync/unifiedSync.ts)).
- /api/sync-all → placeholder (see [app/api/sync-all/route.ts](app/api/sync-all/route.ts)).

### Cron
- /api/cron/daily-sync → `runUnifiedSync()` for one client (see [app/api/cron/daily-sync/route.ts](app/api/cron/daily-sync/route.ts)).
- /api/cron/rolling-30 → computes `daily_profit_summary` from `daily_metrics` + `client_cost_settings` + COGS coverage; includes retry logic (see [app/api/cron/rolling-30/route.ts](app/api/cron/rolling-30/route.ts)).

### Shopify
- /api/shopify/start → redirects to OAuth start (see [app/api/shopify/start/route.ts](app/api/shopify/start/route.ts)).
- /api/shopify/oauth/start → initiates Shopify OAuth state in `shopify_oauth_states` and redirects to Shopify (see [app/api/shopify/oauth/start/route.ts](app/api/shopify/oauth/start/route.ts)).
- /api/shopify/oauth/callback → verifies HMAC, exchanges token, writes `shopify_app_installs`, registers GDPR webhooks (see [app/api/shopify/oauth/callback/route.ts](app/api/shopify/oauth/callback/route.ts)).
- /api/shopify/reauthorize → OAuth reauth flow for existing `client_integrations` row (see [app/api/shopify/reauthorize/route.ts](app/api/shopify/reauthorize/route.ts)).
- /api/shopify/session-check → validates session token JWT (see [app/api/shopify/session-check/route.ts](app/api/shopify/session-check/route.ts)).
- /api/shopify/whoami → decodes session token and sets `sa_shop` cookie (see [app/api/shopify/whoami/route.ts](app/api/shopify/whoami/route.ts)).
- /api/shopify/sync → main Shopify daily sales sync (ShopifyQL first, GraphQL fallback) into `daily_metrics` (see [app/api/shopify/sync/route.ts](app/api/shopify/sync/route.ts)).
- /api/shopify/sync-orders → GraphQL orders → `daily_metrics` (source=shopify) (see [app/api/shopify/sync-orders/route.ts](app/api/shopify/sync-orders/route.ts)).
- /api/shopify/backfill → refunds-aware backfill to `daily_metrics` (see [app/api/shopify/backfill/route.ts](app/api/shopify/backfill/route.ts)).
- /api/shopify/daily-summary → one-day Shopify summary from `daily_metrics` (token-protected) (see [app/api/shopify/daily-summary/route.ts](app/api/shopify/daily-summary/route.ts)).
- /api/shopify/daily-line-items-sync → pulls line items, writes `shopify_daily_line_items`, fetches inventory item unit costs (see [app/api/shopify/daily-line-items-sync/route.ts](app/api/shopify/daily-line-items-sync/route.ts)).
- /api/shopify/unit-cost-sync → syncs inventory item unit costs into `shopify_unit_costs` (see [app/api/shopify/unit-cost-sync/route.ts](app/api/shopify/unit-cost-sync/route.ts)).
- /api/shopify/sync/unit-costs → scans products/variants and writes to `shopify_variant_unit_costs` (see [app/api/shopify/sync/unit-costs/route.ts](app/api/shopify/sync/unit-costs/route.ts)).
- /api/shopify/unit-cost-backfill → orchestration for line items + rolling-30 (see [app/api/shopify/unit-cost-backfill/route.ts](app/api/shopify/unit-cost-backfill/route.ts)).
- /api/shopify/debug/sales-channels → ShopifyQL sales by channel for diagnostics (see [app/api/shopify/debug/sales-channels/route.ts](app/api/shopify/debug/sales-channels/route.ts)).
- /api/shopify/debug/revenue-components → ShopifyQL revenue components diagnostics (see [app/api/shopify/debug/revenue-components/route.ts](app/api/shopify/debug/revenue-components/route.ts)).
- /api/shopify/webhooks → GDPR webhooks receiver (HMAC verified) (see [app/api/shopify/webhooks/route.ts](app/api/shopify/webhooks/route.ts)).
- /api/webhooks/shopify → additional HMAC-verified webhook endpoint (see [app/api/webhooks/shopify/route.ts](app/api/webhooks/shopify/route.ts)).

### Google Ads
- /api/googleads/connect → returns OAuth URL + signed state (see [app/api/googleads/connect/route.ts](app/api/googleads/connect/route.ts)).
- /api/googleads/callback → exchanges code, stores `google_refresh_token` in `client_integrations` (see [app/api/googleads/callback/route.ts](app/api/googleads/callback/route.ts)).
- /api/googleads/accessible-customers → lists accessible customers via OAuth or refresh token (see [app/api/googleads/accessible-customers/route.ts](app/api/googleads/accessible-customers/route.ts)).
- /api/googleads/accounts → lists account ids + names using refresh token from `client_integrations` (see [app/api/googleads/accounts/route.ts](app/api/googleads/accounts/route.ts)).
- /api/googleads/select-account → persists chosen `google_ads_customer_id` into `client_integrations` (see [app/api/googleads/select-account/route.ts](app/api/googleads/select-account/route.ts)).
- /api/googleads/sync → pulls daily spend/clicks/impressions/conversions into `daily_metrics` (cron-auth) (see [app/api/googleads/sync/route.ts](app/api/googleads/sync/route.ts)).
- /api/googleads/backfill → loops day-by-day hitting /api/googleads/sync (see [app/api/googleads/backfill/route.ts](app/api/googleads/backfill/route.ts)).
- /api/googleads/daily-summary → one-day summary from `daily_metrics` (see [app/api/googleads/daily-summary/route.ts](app/api/googleads/daily-summary/route.ts)).
- /api/googleads/disconnect → clears Google tokens/ids in `client_integrations` (see [app/api/googleads/disconnect/route.ts](app/api/googleads/disconnect/route.ts)).

### Meta Ads
- /api/meta/connect → redirects to Meta OAuth with signed state (see [app/api/meta/connect/route.ts](app/api/meta/connect/route.ts)).
- /api/meta/callback → exchanges token, persists `meta_access_token`, auto-selects ad account when possible (see [app/api/meta/callback/route.ts](app/api/meta/callback/route.ts)).
- /api/meta/adaccounts → lists ad accounts using stored access token (see [app/api/meta/adaccounts/route.ts](app/api/meta/adaccounts/route.ts)).
- /api/meta/select-adaccount → persists chosen ad account in `client_integrations` (see [app/api/meta/select-adaccount/route.ts](app/api/meta/select-adaccount/route.ts)).
- /api/meta/sync → pulls daily spend/clicks/purchases/revenue into `daily_metrics` (cron-auth) (see [app/api/meta/sync/route.ts](app/api/meta/sync/route.ts)).
- /api/meta/backfill → day-by-day Meta backfill into `daily_metrics` (see [app/api/meta/backfill/route.ts](app/api/meta/backfill/route.ts)).
- /api/meta/daily-summary → one-day summary from `daily_metrics` (see [app/api/meta/daily-summary/route.ts](app/api/meta/daily-summary/route.ts)).
- /api/meta/disconnect → clears Meta tokens/ids in `client_integrations` (see [app/api/meta/disconnect/route.ts](app/api/meta/disconnect/route.ts)).
- /api/meta/ping → health check (see [app/api/meta/ping/route.ts](app/api/meta/ping/route.ts)).

## 4) Supabase tables and relationships (from usage + migrations)
### Core identity
- `clients` — core client records; extended with Shopify exclusions (see [supabase/migrations/20260202_add_shopify_pos_exclusions.sql](supabase/migrations/20260202_add_shopify_pos_exclusions.sql)).
- `user_clients` — maps auth user → client (used by Supabase RLS and dashboard auth) (see [components/DashboardLayout.tsx](components/DashboardLayout.tsx), [lib/supabaseClient.ts](lib/supabaseClient.ts)).

### Integration auth
- `client_integrations` — per-client integration state for Shopify/Google/Meta (tokens, ad account ids, statuses) (used across [app/api/googleads](app/api/googleads), [app/api/meta](app/api/meta), [app/api/integrations/status/route.ts](app/api/integrations/status/route.ts), [app/api/shopify/sync/route.ts](app/api/shopify/sync/route.ts)).

### Shopify install & OAuth
- `shopify_app_installs` — authoritative Shopify token + shop_domain + client_id mapping (used in [app/api/shopify/oauth/callback/route.ts](app/api/shopify/oauth/callback/route.ts), [app/api/shopify/sync/route.ts](app/api/shopify/sync/route.ts), [app/api/product-performance/route.ts](app/api/product-performance/route.ts)).
- `shopify_oauth_states` — OAuth nonce/state for Shopify (see [app/api/shopify/oauth/start/route.ts](app/api/shopify/oauth/start/route.ts)).

### Fact tables
- `daily_metrics` — primary daily facts keyed by (client_id, source, date), populated by Shopify/Google/Meta sync routes (see [app/api/shopify/sync/route.ts](app/api/shopify/sync/route.ts), [app/api/googleads/sync/route.ts](app/api/googleads/sync/route.ts), [app/api/meta/sync/route.ts](app/api/meta/sync/route.ts)).
- `shopify_daily_line_items` — per‑day line item aggregates (variant/inventory item) (see [app/api/shopify/daily-line-items-sync/route.ts](app/api/shopify/daily-line-items-sync/route.ts)).
- `daily_profit_summary` — derived profitability per day and client (see [app/api/cron/rolling-30/route.ts](app/api/cron/rolling-30/route.ts), [app/api/shopify/recompute/route.ts](app/api/shopify/recompute/route.ts)).
- `daily_shopify_cogs_coverage` — per-day cogs coverage from line items (written in [app/api/shopify/recompute/route.ts](app/api/shopify/recompute/route.ts)).
- `shopify_variant_unit_costs` — unit cost by variant/inventory item; unique on (client_id, inventory_item_id) (see [supabase/migrations/20260128_add_unit_cost_inventory_item_unique.sql](supabase/migrations/20260128_add_unit_cost_inventory_item_unique.sql), [app/api/shopify/sync/unit-costs/route.ts](app/api/shopify/sync/unit-costs/route.ts)).
- `shopify_unit_costs` — unit cost sync target for inventory items (see [app/api/shopify/unit-cost-sync/route.ts](app/api/shopify/unit-cost-sync/route.ts)).
- `shopify_variant_inventory` — on‑hand inventory (used in product performance) (see [app/api/product-performance/route.ts](app/api/product-performance/route.ts), [app/api/inventory/sync/route.ts](app/api/inventory/sync/route.ts)).
- `events` — client events for annotations (see [app/api/events/route.ts](app/api/events/route.ts)).
- `daily_sales_summary` — sales summary per day (read in [app/api/sales/summary/route.ts](app/api/sales/summary/route.ts)).

### Coverage aggregation
- `unit_cost_coverage_daily` — daily unit-cost coverage, defined as table with RLS (see [supabase/migrations/20260203_create_unit_cost_coverage_daily.sql](supabase/migrations/20260203_create_unit_cost_coverage_daily.sql)); also exists as a view definition in older migration (see [supabase/migrations/20260203_add_unit_cost_coverage_view.sql](supabase/migrations/20260203_add_unit_cost_coverage_view.sql)).

## 5) RPC functions (Supabase)
- `get_product_performance(p_client_id, p_start, p_end, p_limit, p_offset)` — aggregates line items + unit costs to compute units, revenue, known COGS, uncovered revenue, estimated COGS, profit, and coverage (see [supabase/migrations/20260306_update_product_performance_pagination.sql](supabase/migrations/20260306_update_product_performance_pagination.sql)).
- `get_product_performance_count(p_client_id, p_start, p_end)` — count of variant+inventory pairs (see [supabase/migrations/20260306_update_product_performance_pagination.sql](supabase/migrations/20260306_update_product_performance_pagination.sql)).
- `get_product_performance_totals(p_client_id, p_start, p_end)` — total revenue/profit/units over the same aggregation (see [supabase/migrations/20260306_update_product_performance_pagination.sql](supabase/migrations/20260306_update_product_performance_pagination.sql)).

## 6) Cron jobs & sync processes
- Unified sync chain: `runUnifiedSync()` orchestrates Shopify → Google Ads → Meta Ads → Shopify daily line items → Shopify recompute → rolling-30 profitability (see [lib/sync/unifiedSync.ts](lib/sync/unifiedSync.ts)).
- Daily cron entrypoint: /api/cron/daily-sync invokes `runUnifiedSync()` (see [app/api/cron/daily-sync/route.ts](app/api/cron/daily-sync/route.ts)).
- Profitability rollup: /api/cron/rolling-30 computes `daily_profit_summary` and monthly rollups (see [app/api/cron/rolling-30/route.ts](app/api/cron/rolling-30/route.ts)).
- Recompute path (ad-hoc): /api/shopify/recompute recalculates profitability from raw data and COGS coverage (see [app/api/shopify/recompute/route.ts](app/api/shopify/recompute/route.ts)).
- Manual refresh: /api/sync/manual-refresh triggers `runUnifiedSync()` on demand (see [app/api/sync/manual-refresh/route.ts](app/api/sync/manual-refresh/route.ts)).

## 7) Data flow from Shopify / Google Ads / Meta Ads
### Shopify
- OAuth installs and token storage: /api/shopify/oauth/start → /api/shopify/oauth/callback writes `shopify_app_installs` (see [app/api/shopify/oauth/start/route.ts](app/api/shopify/oauth/start/route.ts), [app/api/shopify/oauth/callback/route.ts](app/api/shopify/oauth/callback/route.ts)).
- Daily revenue/orders/units: /api/shopify/sync uses ShopifyQL (primary) or GraphQL orders (fallback) to populate `daily_metrics` (see [app/api/shopify/sync/route.ts](app/api/shopify/sync/route.ts)).
- Line items and unit costs: /api/shopify/daily-line-items-sync stores `shopify_daily_line_items` and inventory item unit costs (see [app/api/shopify/daily-line-items-sync/route.ts](app/api/shopify/daily-line-items-sync/route.ts)).
- Inventory on hand: /api/inventory/sync queries inventory levels and stores `shopify_variant_inventory` (see [app/api/inventory/sync/route.ts](app/api/inventory/sync/route.ts)).

### Google Ads
- OAuth: /api/googleads/connect + /api/googleads/callback store refresh token (see [app/api/googleads/connect/route.ts](app/api/googleads/connect/route.ts), [app/api/googleads/callback/route.ts](app/api/googleads/callback/route.ts)).
- Account selection: /api/googleads/accounts + /api/googleads/select-account store `google_ads_customer_id` in `client_integrations` (see [app/api/googleads/accounts/route.ts](app/api/googleads/accounts/route.ts), [app/api/googleads/select-account/route.ts](app/api/googleads/select-account/route.ts)).
- Metrics ingestion: /api/googleads/sync writes spend/clicks/impressions/conversions into `daily_metrics` (source=google) (see [app/api/googleads/sync/route.ts](app/api/googleads/sync/route.ts)).

### Meta Ads
- OAuth: /api/meta/connect + /api/meta/callback store `meta_access_token` in `client_integrations` (see [app/api/meta/connect/route.ts](app/api/meta/connect/route.ts), [app/api/meta/callback/route.ts](app/api/meta/callback/route.ts)).
- Account selection: /api/meta/adaccounts + /api/meta/select-adaccount store `meta_ad_account_id` (see [app/api/meta/adaccounts/route.ts](app/api/meta/adaccounts/route.ts), [app/api/meta/select-adaccount/route.ts](app/api/meta/select-adaccount/route.ts)).
- Metrics ingestion: /api/meta/sync writes spend/clicks/purchases/revenue into `daily_metrics` (source=meta) (see [app/api/meta/sync/route.ts](app/api/meta/sync/route.ts)).

## 8) Product performance calculation
- Core aggregation is in Supabase RPC `get_product_performance`: sums units/revenue from `shopify_daily_line_items`, joins `shopify_variant_unit_costs` to compute known COGS and coverage; missing costs use fallback margin from `client_cost_settings` to compute estimated COGS and profit (see [supabase/migrations/20260306_update_product_performance_pagination.sql](supabase/migrations/20260306_update_product_performance_pagination.sql)).
- API route /api/product-performance:
  - Resolves Shopify shop from session token, maps to `shopify_app_installs` for client_id.
  - Fetches totals via `get_product_performance_totals` to compute revenue share and summary metrics.
  - Computes trend vs previous period by re‑running RPC for prior window and setting `trend_pct` (see [app/api/product-performance/route.ts](app/api/product-performance/route.ts)).
  - Enriches with inventory (`shopify_variant_inventory`) to compute `days_of_inventory` (see [app/api/product-performance/route.ts](app/api/product-performance/route.ts)).
  - Enriches product metadata (title/sku/image/admin URLs) from Shopify GraphQL when needed (see `shopifyGraphQL()` in [app/api/product-performance/route.ts](app/api/product-performance/route.ts)).

## 9) How daily_profit_summary is generated
Two code paths compute the same profitability model:

**A) Rolling 30‑day cron**
- /api/cron/rolling-30 reads:
  - `daily_metrics` (Shopify revenue/orders/units + paid spend from Google/Meta)
  - `client_cost_settings` (cost model)
  - `daily_shopify_cogs_coverage` (from line items)
- Then calls `computeDailyProfitSummary()` to generate per‑day rows and upserts to `daily_profit_summary` (see [app/api/cron/rolling-30/route.ts](app/api/cron/rolling-30/route.ts)).

**B) Shopify recompute**
- /api/shopify/recompute re-derives:
  - COGS coverage from `shopify_daily_line_items` + `shopify_variant_unit_costs`
  - Paid spend from `daily_metrics` ad sources
  - Costs from `client_cost_settings`
- Then runs `computeDailyProfitSummary()` and upserts `daily_profit_summary` (see [app/api/shopify/recompute/route.ts](app/api/shopify/recompute/route.ts)).

**Cost model (same in both)**
- `computeDailyProfitSummary()` calculates:
  - Known COGS + fallback COGS on uncovered revenue
  - Processing fees, fulfillment costs, variable and fixed costs
  - Contribution profit: $contribution\_profit = revenue - (est\_cogs + est\_processing\_fees + est\_fulfillment\_costs + est\_other\_variable\_costs + est\_other\_fixed\_costs + paid\_spend)$
  - See `computeDailyProfitSummary()` in [app/api/shopify/recompute/route.ts](app/api/shopify/recompute/route.ts) and [app/api/cron/rolling-30/route.ts](app/api/cron/rolling-30/route.ts).

## 10) Authentication and client_id resolution
- Embedded app client → API: front‑end uses `authenticatedFetch()` to attach Shopify session tokens to same‑origin /api/* requests (see [lib/shopify/authenticatedFetch.ts](lib/shopify/authenticatedFetch.ts)).
- Session token decoding: API routes like /api/product-performance and /api/inventory/sync decode or verify JWT to extract dest → shop domain → `shopify_app_installs` lookup for client_id (see [app/api/product-performance/route.ts](app/api/product-performance/route.ts), [app/api/inventory/sync/route.ts](app/api/inventory/sync/route.ts)).
- App entry resolution: [app/page.tsx](app/page.tsx) builds shopGuess from query params, headers, referer, and cookie; if missing install, redirects to OAuth start; in dev, can bypass with `LOCAL_CLIENT_ID`.
- Cron/ops auth: `requireCronAuth()` enforces `CRON_SECRET` via Authorization: Bearer or `?token=` (see [lib/cronAuth.ts](lib/cronAuth.ts), [app/api/cron/daily-sync/route.ts](app/api/cron/daily-sync/route.ts)).
- Supabase client auth: `DashboardLayout` checks Supabase auth session unless Shopify context exists (see [components/DashboardLayout.tsx](components/DashboardLayout.tsx), [lib/shopifyContext.ts](lib/shopifyContext.ts)).

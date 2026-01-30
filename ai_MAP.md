# AI_MAP.md — ScaleAble Dashboard Architecture

This document is the source-of-truth technical map for the ScaleAble Dashboard. It is intended for LLM ingestion to fully understand how the system works end-to-end.

---

## 1) Product Overview
ScaleAble is a profit-first analytics platform for Shopify + paid media. It is an embedded Shopify Admin app and also operates as a multi-client SaaS dashboard. The core goal is to compute true profit, MER, and ROAS using real revenue and COGS, not just ad-platform metrics.

Key principles:
- Revenue comes from Shopify (not ad platforms).
- Profit is computed server-side and persisted.
- COGS uses real Shopify unit costs when available.

---

## 2) Tech Stack
- Next.js App Router (v16)
- Embedded Shopify App (App Bridge)
- Supabase (Postgres)
- Vercel deployment
- Google Ads API
- Meta Marketing API

---

## 3) Tenancy Model (CRITICAL)
- Every Shopify store maps to exactly ONE `client_id`.
- `shopify_app_installs` is the source of truth for the Shopify store → `client_id` mapping.
- All reads/writes for profit metrics are keyed by `client_id`.
- No Shopify data path relies on Supabase auth-to-client mapping. (UI auth mapping exists for dashboard access, but Shopify store identity and data ownership are always resolved via `shopify_app_installs`.)

---

## 4) Shopify Auth Flow
1) Embedded app loads without `?shop` at first render.
2) App Bridge supplies a session token for the logged-in Shopify admin.
3) `/api/shopify/whoami` validates the token and sets an HttpOnly cookie (`sa_shop`) with the shop domain.
4) App reload is guarded by a `bootstrapped` URL flag to prevent loops.
5) OAuth starts only when no access token exists for the shop/client.
6) OAuth callback always upserts `client_id` and scopes in `shopify_app_installs`.

---

## 5) Shopify Revenue Model
Canonical revenue source is ShopifyQL:
- Query: `FROM sales SHOW total_sales TIMESERIES day`
- This must match Shopify Analytics exactly.

Bucketing:
- Orders are bucketed by `processedAt`, falling back to `createdAt` when missing.
- Current implementation buckets in UTC (timezone argument removed). If shop-timezone bucketing is reintroduced, it should use the shop’s IANA timezone.

Refund handling:
- Refunds are subtracted from daily revenue.
- Line item sync also tracks refunds where applicable.

---

## 6) Core Tables
Operational / identity:
- `shopify_app_installs`
- `client_integrations`

Raw inputs:
- `daily_metrics`
- `shopify_daily_line_items`

Derived outputs:
- `daily_profit_summary`
- `daily_shopify_cogs_coverage`

---

## 7) Backfill & Recompute Strategy
- ShopifyQL sync skips >60-day ranges to avoid overwriting older historical data.
- Historical profit is rebuilt using line items + recompute routes instead.
- This is intentional to prevent ShopifyQL returning changed historical totals and polluting stable periods.

---

## 8) API Endpoints
Shopify:
- /api/shopify/sync
- /api/shopify/daily-line-items-sync
- /api/shopify/recompute

Cron:
- /api/cron/rolling-30

Google OAuth:
- /api/googleads/connect (current OAuth start route)
- /api/googleads/callback
- /api/google/oauth/start (documented start route; add only if implemented)

Meta OAuth:
- /api/meta/oauth/start (documented start route; add only if implemented)

---

## 9) Curl Commands (IMPORTANT)
Correct order for historical rebuilds:
1) ShopifyQL sync (optional for recent windows)
2) Line items sync
3) Recompute profit

Example month-by-month backfill (repeat for each month window):

Sync optional (last 60 days only):
curl -X POST "https://scaleable-dashboard-wildwater.vercel.app/api/shopify/sync?client_id=<CLIENT_ID>&start=2026-01-01&end=2026-01-31&force=1" \
  -H "Authorization: Bearer <SYNC_TOKEN>"

Line items (required for historical COGS + refunds):
curl -X POST "https://scaleable-dashboard-wildwater.vercel.app/api/shopify/daily-line-items-sync?client_id=<CLIENT_ID>&start=2026-01-01&end=2026-01-31" \
  -H "Authorization: Bearer <SYNC_TOKEN>"

Recompute profit from existing tables:
curl -X POST "https://scaleable-dashboard-wildwater.vercel.app/api/shopify/recompute?client_id=<CLIENT_ID>&start=2026-01-01&end=2026-01-31" \
  -H "Authorization: Bearer <SYNC_TOKEN>"

---

## 10) Settings → Integrations Logic
Shopify:
- Query `shopify_app_installs` filtered by `client_id` (and `shop_domain` if provided).
- Connected = row exists AND `access_token` is truthy.

Google Ads:
- Query `client_integrations` for the client.
- Identify Google rows by provider/type/source/kind/name containing “google” OR by presence of customer/ad account ID fields.
- Connected ONLY if token field is present AND a customer/ad account ID field is present.
- This prevents false positives from incomplete rows.

Meta Ads:
- Query `client_integrations` for the client.
- Identify Meta rows by provider/type/source/kind/name containing “meta”, “facebook”, or “fb” OR by presence of account ID fields.
- Connected ONLY if `access_token` is present AND a Meta account ID field is present.

---

## 11) Common Failure Modes
- Missing or incorrect Google OAuth `redirect_uri` (must exactly match the callback endpoint).
- Shopify iframe OAuth issues (embedded apps require App Bridge session + bootstrapped reload guard).
- Over-permissive integration detection (marking connected without required tokens + account IDs).
- Timezone mismatches (UTC vs shop timezone causes day-bucketing drift).

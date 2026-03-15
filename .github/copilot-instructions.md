# Copilot instructions for this repo

## Big picture (read this first)
- Next.js 16 App Router app with server components by default; client-heavy dashboards are explicit (`"use client"`) in files like [app/page.client.tsx](../app/page.client.tsx), [app/product-performance/ProductPerformanceClient.tsx](../app/product-performance/ProductPerformanceClient.tsx), and [app/channel-performance/ChannelPerformanceClient.tsx](../app/channel-performance/ChannelPerformanceClient.tsx).
- This is an embedded Shopify analytics app backed by Supabase. The app entry in [app/page.tsx](../app/page.tsx) resolves Shopify context (`shop`, `host`, `id_token`, headers/cookies), verifies install state in `shopify_app_installs`, then hydrates dashboard UI with `client_id`.
- Keep API routes dynamic/node runtime for live data (`runtime = "nodejs"`, `dynamic = "force-dynamic"`), as seen across [app/api](../app/api).

## Auth + identity conventions
- Client → API calls that need Shopify auth should use `authenticatedFetch()` from [lib/shopify/authenticatedFetch.ts](../lib/shopify/authenticatedFetch.ts); it attaches session token to same-origin `/api/*` requests.
- Server auth helpers live in [lib/requestAuth.ts](../lib/requestAuth.ts): decode Shopify session JWT (`dest` → `shop_domain`), read Supabase auth tokens from cookies/bearer, and check `user_clients` membership.
- Most data routes resolve `client_id` from `shop_domain` via `resolveClientIdFromShopDomainParam()` (example: [app/api/data/channel-performance/route.ts](../app/api/data/channel-performance/route.ts)). Prefer this pattern for embedded requests.
- Cron/ops routes must enforce `CRON_SECRET` with `requireCronAuth()` from [lib/cronAuth.ts](../lib/cronAuth.ts).

## Data layer + service boundaries
- Supabase service-role access must go through `supabaseAdmin()`/`getSupabaseAdmin()` in [lib/supabaseAdmin.ts](../lib/supabaseAdmin.ts). Do not create service-role clients ad hoc.
- Heavy analytics logic is split between API code and Supabase SQL/RPC migrations in [supabase/migrations](../supabase/migrations) (for example product performance RPCs).
- Shopify Admin GraphQL is called server-side only; routes default `SHOPIFY_API_VERSION` to `2026-01` (see [app/api/shopify/sync/route.ts](../app/api/shopify/sync/route.ts), [app/api/inventory/sync/route.ts](../app/api/inventory/sync/route.ts)).
- `daily_metrics` is the central fact table for spend/revenue rollups; `daily_shopify_channel_metrics`, `shopify_daily_line_items`, and `shopify_variant_inventory` are key supporting tables.

## Sync orchestration patterns
- Unified sync flow is centralized in `runUnifiedSync()` at [lib/sync/unifiedSync.ts](../lib/sync/unifiedSync.ts), sequencing: Shopify sync → channel sync → Google sync → Meta sync → line items → recompute → rolling-30.
- [app/api/cron/daily-sync/route.ts](../app/api/cron/daily-sync/route.ts) currently iterates all installed shops from `shopify_app_installs` (it accepts `start`/`end`; no per-client filter logic there).
- [app/api/cron/rolling-30/route.ts](../app/api/cron/rolling-30/route.ts) is the profitability builder; it includes retry/backoff utilities and writes `daily_profit_summary`.

## Frontend patterns worth preserving
- `shop`/`shop_domain` query params are first-class in client pages; pages fail fast with clear UI if missing shop context.
- Shared chrome is [components/DashboardLayout.tsx](../components/DashboardLayout.tsx) + [components/Sidebar.tsx](../components/Sidebar.tsx).
- Date filtering is standardized via [app/components/DateRangePicker.tsx](../app/components/DateRangePicker.tsx) using ISO `YYYY-MM-DD` ranges and preset keys.
- There are API alias routes under `app/api/data/*` that re-export handlers (example: [app/api/data/product-performance/route.ts](../app/api/data/product-performance/route.ts)); keep aliases in sync when moving handlers.

## Developer workflows
- Commands: `npm run dev`, `npm run build`, `npm run start`, `npm run lint` (see [package.json](../package.json)).
- No formal test suite is configured in this repo right now; lint + endpoint verification are the practical checks.
- Vercel cron is configured in [vercel.json](../vercel.json) to hit `/api/cron/daily-sync` daily.
- Backfill tooling exists via [gen_backfill_cmds.js](../gen_backfill_cmds.js) and scripts under [scripts](../scripts) / repo root `backfill_*.sh` for month-by-month historical syncs.

## Environment variables used in core flows
- Shopify: `NEXT_PUBLIC_SHOPIFY_API_KEY`, `SHOPIFY_OAUTH_CLIENT_SECRET`, optional `SHOPIFY_API_VERSION`.
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Ops/dev: `CRON_SECRET`, `DEFAULT_CLIENT_ID`, `LOCAL_CLIENT_ID`, optional `NEXT_PUBLIC_DEBUG_AUTH`.

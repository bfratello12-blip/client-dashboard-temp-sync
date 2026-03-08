# Copilot instructions for this repo

## Architecture overview
- Next.js 16 App Router project (see [app/layout.tsx](app/layout.tsx) and [app/page.tsx](app/page.tsx)). Server components by default; client components explicitly add `"use client"` (examples: [components/DashboardLayout.tsx](components/DashboardLayout.tsx), [app/product-performance/page.tsx](app/product-performance/page.tsx)).
- Embedded Shopify app: App Bridge script **must be the first** `<script>` in `<head>` and `meta[name="shopify-api-key"]` must be present (see [app/layout.tsx](app/layout.tsx)).
- API routes live under [app/api](app/api) and run on `runtime = "nodejs"` with `dynamic = "force-dynamic"` for live data (examples: [app/api/product-performance/route.ts](app/api/product-performance/route.ts), [app/api/inventory/sync/route.ts](app/api/inventory/sync/route.ts)).

## Auth and data flow
- Client → API: use `authenticatedFetch()` to attach Shopify session tokens to same-origin `/api/*` requests (see [lib/shopify/authenticatedFetch.ts](lib/shopify/authenticatedFetch.ts)).
- API auth: routes decode/verify the session token to resolve `shop_domain`, then lookup `shopify_app_installs` in Supabase before querying Shopify/Supabase (see [app/api/product-performance/route.ts](app/api/product-performance/route.ts)).
- Supabase service role: **only** initialize via `supabaseAdmin()` at request time (no module-scope init) (see [lib/supabaseAdmin.ts](lib/supabaseAdmin.ts)). Client-side Supabase uses `lib/supabaseClient.ts`.
- Cron/ops endpoints require `CRON_SECRET` via `Authorization: Bearer` or `?token=` (see [lib/cronAuth.ts](lib/cronAuth.ts) and [app/api/cron/daily-sync/route.ts](app/api/cron/daily-sync/route.ts)).
- Sync orchestration is centralized in `runUnifiedSync()` (see [lib/sync/unifiedSync.ts](lib/sync/unifiedSync.ts)).

## Data + RPC conventions
- Heavy analytics are implemented as Supabase RPCs and SQL migrations (see [supabase/migrations/20260305_add_product_performance_rpc.sql](supabase/migrations/20260305_add_product_performance_rpc.sql) and [app/api/product-performance/route.ts](app/api/product-performance/route.ts)).
- Shopify GraphQL calls are made server-side inside API routes; expect `SHOPIFY_API_VERSION` to default to `2026-01` (examples: [app/api/inventory/sync/route.ts](app/api/inventory/sync/route.ts)).

## UI patterns
- Shared layout is `DashboardLayout` with `Sidebar` and Supabase auth guard (see [components/DashboardLayout.tsx](components/DashboardLayout.tsx)).
- Date range selection is centralized in `DateRangePicker` with preset keys and ISO date strings (see [app/components/DateRangePicker.tsx](app/components/DateRangePicker.tsx)).

## Local workflows
- Dev server: `npm run dev` (Next.js).
- Production build: `npm run build`, start with `npm run start` (see [package.json](package.json)).
- Lint: `npm run lint`.

## Environment variables used in core flows
- Shopify: `NEXT_PUBLIC_SHOPIFY_API_KEY`, `SHOPIFY_OAUTH_CLIENT_SECRET`, optional `SHOPIFY_API_VERSION`.
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Ops/dev: `CRON_SECRET`, `DEFAULT_CLIENT_ID`, `LOCAL_CLIENT_ID` (see [app/page.tsx](app/page.tsx)).

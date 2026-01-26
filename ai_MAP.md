# AI_MAP.md — ScaleAble Client Dashboard

## Purpose
ScaleAble helps clients understand **how advertising spend impacts profit**, not just revenue or ROAS.

Core question:
> “If we spend more on ads, do we actually make more money?”

---

## Tech Stack
- Next.js (App Router)
- Supabase (Postgres)
- Server-side API routes under `app/api/**`
- Cron-style recalculation for data correctness

---

## High-Level Architecture

UI (Dashboard Pages)
→ API Routes (Semantic Layer)
→ Supabase Tables (Source of Truth)
→ Cron Jobs (Data Correction)

Charts never calculate profit themselves.

---

## Core Tables (Source of Truth)

### `daily_metrics`
- Raw daily ad platform metrics
- Spend, clicks, conversions, revenue by channel
- No profit math

### `client_cost_settings`
- Client-defined assumptions (COGS, fees, shipping, etc.)
- Used only during profit calculation
- Not shown directly in charts

### `daily_profit_summary` **(AUTHORITATIVE)**
- Revenue
- Paid spend
- Contribution profit
- MER
- Profit MER

All profit charts ultimately depend on this table.

---

## Derived / Cached Tables
- `monthly_rollup` — aggregated view for fast reads
- `events` — system observability
- `client_integrations` — connection state

These are not profit truth.

---

## API Semantic Layer

### `/api/sales/summary`
Purpose:
- Read from `daily_profit_summary`
- Aggregate by date
- Apply **semantic naming** for UI

#### Metric naming rules
| Database Field | API Alias | UI Label |
|---------------|-----------|---------|
| `mer` | `mer` | MER |
| `profit_mer` | `profit_return_on_cost` | Profit Return on Cost |
| `contribution_profit` | `profit` | Profit |

Math never changes here — only names.

---

## Cron & Recalculation Logic

### `/api/cron/rolling-30`
Guarantees:
- Last ~30 days of data are always recalculated
- Handles:
  - late ad data
  - Shopify adjustments
  - updated cost assumptions

Behavior:
- Recent history is **mutable**
- Older history is **stable**

This prevents long-term charts from shifting unexpectedly.

---

## Time Rules
- Dates are bucketed daily
- Rolling window applies to **recent data only**
- Comparisons rely on frozen historical data

---

## Danger Zones (Do Not Change Without Confirmation)
- `app/api/shopify/**` (Shopify review sensitive)
- `app/settings/**` (cost assumptions)
- `daily_profit_summary` write logic
- Metric aliases in `/api/sales/summary`

---

## Rules for AI-Assisted Changes
- Never recompute profit in the UI
- Never rename metrics without updating this map
- Never extend historical recalculation beyond rolling window without approval
- Charts must respect full available date ranges from the API

---

## Mental Model for Contributors
- Profit is calculated once (server-side)
- Names may change, math must not
- Recent data can change; old data should not surprise users

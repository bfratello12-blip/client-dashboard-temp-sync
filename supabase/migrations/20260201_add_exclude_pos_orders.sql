-- Add per-client toggle to exclude Shopify POS orders
alter table if exists client_cost_settings
  add column if not exists exclude_pos_orders boolean not null default false;

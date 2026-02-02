alter table public.clients
  add column if not exists shopify_exclude_pos boolean not null default false,
  add column if not exists shopify_excluded_sales_channel_names text[] not null default '{}';

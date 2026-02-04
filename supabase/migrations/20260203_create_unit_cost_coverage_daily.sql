drop view if exists public.unit_cost_coverage_daily;

create table if not exists public.unit_cost_coverage_daily (
  client_id uuid not null,
  date date not null,
  units_total numeric not null default 0,
  units_with_unit_cost numeric not null default 0,
  unit_cost_coverage_ratio numeric null,
  updated_at timestamptz not null default now(),
  primary key (client_id, date)
);

alter table public.unit_cost_coverage_daily enable row level security;

create policy "select_unit_cost_coverage_daily"
  on public.unit_cost_coverage_daily
  for select
  using (
    client_id in (
      select client_id
      from public.user_clients
      where user_id = auth.uid()
    )
  );

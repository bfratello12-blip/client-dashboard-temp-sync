create index if not exists idx_shopify_daily_line_items_client_day
  on public.shopify_daily_line_items (client_id, day);

create or replace function public.get_product_performance(
  p_client_id uuid,
  p_start date,
  p_end date,
  p_limit int default 100
)
returns table(
  variant_id text,
  inventory_item_id text,
  units numeric,
  revenue numeric,
  known_cogs numeric,
  covered_revenue numeric,
  uncovered_revenue numeric,
  est_cogs numeric,
  profit numeric,
  cogs_coverage_pct numeric
)
language sql
stable
as $$
with cs as (
  select greatest(0, least(1, 1 - coalesce(default_gross_margin_pct, 0.5))) as fallback_cogs_pct
  from public.client_cost_settings
  where client_id = p_client_id
),
items as (
  select
    li.variant_id::text as variant_id,
    li.inventory_item_id::text as inventory_item_id,
    sum(coalesce(li.units, 0)) as units,
    sum(coalesce(li.line_revenue, 0)) as revenue,
    sum(
      case
        when uc.unit_cost_amount is not null and uc.unit_cost_amount > 0
          then coalesce(li.units, 0) * uc.unit_cost_amount
        else 0
      end
    ) as known_cogs,
    sum(
      case
        when uc.unit_cost_amount is not null and uc.unit_cost_amount > 0
          then coalesce(li.line_revenue, 0)
        else 0
      end
    ) as covered_revenue,
    sum(
      case
        when uc.unit_cost_amount is null or uc.unit_cost_amount <= 0
          then coalesce(li.line_revenue, 0)
        else 0
      end
    ) as uncovered_revenue
  from public.shopify_daily_line_items li
  left join public.shopify_variant_unit_costs uc
    on uc.client_id = li.client_id
   and uc.inventory_item_id = li.inventory_item_id
  where li.client_id = p_client_id
    and li.day >= p_start
    and li.day <= p_end
  group by li.variant_id, li.inventory_item_id
),
calc as (
  select
    i.*,
    (i.known_cogs + i.uncovered_revenue * coalesce((select fallback_cogs_pct from cs), 0.5)) as est_cogs,
    (i.revenue - (i.known_cogs + i.uncovered_revenue * coalesce((select fallback_cogs_pct from cs), 0.5))) as profit,
    case when i.revenue > 0 then i.covered_revenue / i.revenue else 0 end as cogs_coverage_pct
  from items i
)
select *
from calc
order by profit desc
limit coalesce(p_limit, 100);
$$;

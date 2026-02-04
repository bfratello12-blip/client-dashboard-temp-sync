create or replace view unit_cost_coverage_daily as
select
  li.client_id,
  li.day::date as date,
  sum(li.units) as units_total,
  sum(case when v.unit_cost_amount is not null and v.unit_cost_amount > 0 then li.units else 0 end) as units_with_unit_cost,
  case
    when sum(li.units) > 0 then
      sum(case when v.unit_cost_amount is not null and v.unit_cost_amount > 0 then li.units else 0 end) / sum(li.units)
    else null
  end as unit_cost_coverage_pct
from shopify_daily_line_items li
left join shopify_variant_unit_costs v
  on v.client_id = li.client_id
  and v.inventory_item_id = li.inventory_item_id
group by li.client_id, li.day;

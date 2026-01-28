-- Add unique index for inventory_item_id on shopify_variant_unit_costs
-- Required for upsert on (client_id, inventory_item_id)
create unique index if not exists shopify_variant_unit_costs_client_inventory_item_uidx
on public.shopify_variant_unit_costs (client_id, inventory_item_id);

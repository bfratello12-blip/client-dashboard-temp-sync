alter table if exists client_integrations
add column if not exists google_ads_customer_id text;

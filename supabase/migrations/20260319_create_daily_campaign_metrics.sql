-- Create daily_campaign_metrics table for campaign-level performance tracking
CREATE TABLE IF NOT EXISTS daily_campaign_metrics (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL,
  date DATE NOT NULL,
  source TEXT NOT NULL, -- 'google' or 'meta'
  campaign_id TEXT NOT NULL, -- Google campaign ID or Meta campaign ID
  campaign_name TEXT,
  spend NUMERIC(12, 2) DEFAULT 0,
  revenue NUMERIC(12, 2) DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  conversions NUMERIC(10, 2) DEFAULT 0,
  conversion_value NUMERIC(12, 2) DEFAULT 0,
  orders BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(client_id, date, source, campaign_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_daily_campaign_metrics_client_date 
  ON daily_campaign_metrics(client_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_campaign_metrics_client_source 
  ON daily_campaign_metrics(client_id, source);
CREATE INDEX IF NOT EXISTS idx_daily_campaign_metrics_campaign 
  ON daily_campaign_metrics(client_id, campaign_id);

-- Create a view for easy aggregation by campaign
CREATE OR REPLACE VIEW daily_campaign_metrics_summary AS
SELECT
  client_id,
  source,
  campaign_id,
  campaign_name,
  DATE_TRUNC('month', date)::DATE as month,
  COUNT(*) as days_active,
  SUM(spend) as total_spend,
  SUM(revenue) as total_revenue,
  SUM(clicks) as total_clicks,
  SUM(impressions) as total_impressions,
  SUM(conversions) as total_conversions,
  SUM(conversion_value) as total_conversion_value,
  CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE 0 END as roas,
  CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE 0 END as cpc,
  SUM(orders) as total_orders,
  MIN(date) as start_date,
  MAX(date) as end_date
FROM daily_campaign_metrics
GROUP BY client_id, source, campaign_id, campaign_name, DATE_TRUNC('month', date)::DATE;

-- ============================================================================
-- Wilson Auto-Configuration System
-- Stores pre-fetched data and configuration per store
-- ============================================================================

-- Store-specific configuration (env vars, settings, API keys)
CREATE TABLE IF NOT EXISTS store_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- Configuration (non-sensitive settings)
  config JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Pre-computed context for Wilson (products summary, common queries, etc.)
  wilson_context JSONB DEFAULT '{}'::jsonb,

  -- Feature flags
  features JSONB DEFAULT '{
    "wilson_enabled": true,
    "offline_mode": true,
    "auto_prefetch": true
  }'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pre-fetched data cache (per store)
CREATE TABLE IF NOT EXISTS store_prefetch_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,

  -- Type of cached data: 'products', 'inventory', 'sales_summary', 'common_queries'
  data_type TEXT NOT NULL,

  -- Actual cached data
  data JSONB NOT NULL,

  -- Metadata about the cache
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Cache expiry
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(store_id, data_type)
);

-- Wilson CLI sessions (for tracking and analytics)
CREATE TABLE IF NOT EXISTS wilson_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,

  -- Device/environment info
  device_info JSONB DEFAULT '{}'::jsonb,

  -- Session tracking
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  queries_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

ALTER TABLE store_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_prefetch_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE wilson_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only read their own store's config
CREATE POLICY "Users can read their store config"
  ON store_config FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM users
      WHERE auth_user_id = auth.uid()
    )
  );

-- Users can only read their own store's prefetch data
CREATE POLICY "Users can read their store prefetch data"
  ON store_prefetch_data FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM users
      WHERE auth_user_id = auth.uid()
    )
  );

-- Users can manage their own sessions
CREATE POLICY "Users can manage their sessions"
  ON wilson_sessions FOR ALL
  USING (user_id = auth.uid());

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

CREATE INDEX idx_store_config_store_id ON store_config(store_id);
CREATE INDEX idx_prefetch_store_type ON store_prefetch_data(store_id, data_type);
CREATE INDEX idx_prefetch_expires ON store_prefetch_data(expires_at);
CREATE INDEX idx_wilson_sessions_user ON wilson_sessions(user_id);
CREATE INDEX idx_wilson_sessions_store ON wilson_sessions(store_id);

-- ============================================================================
-- Functions for Auto-Configuration
-- ============================================================================

-- Function: Create default config when store is created
CREATE OR REPLACE FUNCTION create_default_store_config()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO store_config (store_id, config, wilson_context, features)
  VALUES (
    NEW.id,
    '{}'::jsonb,
    jsonb_build_object(
      'store_name', NEW.store_name,
      'created_at', NEW.created_at
    ),
    '{
      "wilson_enabled": true,
      "offline_mode": true,
      "auto_prefetch": true
    }'::jsonb
  )
  ON CONFLICT (store_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Auto-create config on store creation
DROP TRIGGER IF EXISTS trigger_create_store_config ON stores;
CREATE TRIGGER trigger_create_store_config
  AFTER INSERT ON stores
  FOR EACH ROW
  EXECUTE FUNCTION create_default_store_config();

-- Function: Refresh pre-fetched data for a store
CREATE OR REPLACE FUNCTION refresh_store_prefetch(p_store_id UUID)
RETURNS void AS $$
BEGIN
  -- Cache top products
  INSERT INTO store_prefetch_data (store_id, data_type, data, expires_at)
  SELECT
    p_store_id,
    'top_products',
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', p2.id,
        'name', p2.name,
        'price', p2.price,
        'inventory', p2.stock_quantity
      ))
      FROM (
        SELECT id, name, price, stock_quantity
        FROM products
        WHERE store_id = p_store_id
        ORDER BY stock_quantity DESC NULLS LAST
        LIMIT 50
      ) p2),
      '[]'::jsonb
    ),
    NOW() + INTERVAL '1 hour'
  ON CONFLICT (store_id, data_type)
  DO UPDATE SET
    data = EXCLUDED.data,
    updated_at = NOW(),
    expires_at = EXCLUDED.expires_at;

  -- Cache inventory summary
  INSERT INTO store_prefetch_data (store_id, data_type, data, expires_at)
  SELECT
    p_store_id,
    'inventory_summary',
    jsonb_build_object(
      'total_products', COUNT(*),
      'total_inventory', SUM(stock_quantity),
      'low_stock_count', COUNT(*) FILTER (WHERE stock_quantity < 10),
      'categories_count', COUNT(DISTINCT primary_category_id) FILTER (WHERE primary_category_id IS NOT NULL)
    ),
    NOW() + INTERVAL '30 minutes'
  FROM products
  WHERE store_id = p_store_id
  ON CONFLICT (store_id, data_type)
  DO UPDATE SET
    data = EXCLUDED.data,
    updated_at = NOW(),
    expires_at = EXCLUDED.expires_at;

  -- Cache sales summary (last 30 days)
  INSERT INTO store_prefetch_data (store_id, data_type, data, expires_at)
  SELECT
    p_store_id,
    'sales_summary',
    jsonb_build_object(
      'total_orders', COUNT(*),
      'total_revenue', COALESCE(SUM(final_price), 0),
      'avg_order_value', COALESCE(AVG(final_price), 0),
      'period', '30d'
    ),
    NOW() + INTERVAL '15 minutes'
  FROM orders
  WHERE store_id = p_store_id
    AND created_at > NOW() - INTERVAL '30 days'
  ON CONFLICT (store_id, data_type)
  DO UPDATE SET
    data = EXCLUDED.data,
    updated_at = NOW(),
    expires_at = EXCLUDED.expires_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Background Job: Auto-refresh prefetch data
-- ============================================================================

-- Function to refresh all stores' prefetch data
CREATE OR REPLACE FUNCTION refresh_all_stores_prefetch()
RETURNS void AS $$
DECLARE
  store_record RECORD;
BEGIN
  FOR store_record IN
    SELECT id FROM stores
    WHERE EXISTS (
      SELECT 1 FROM store_config
      WHERE store_id = stores.id
      AND features->>'auto_prefetch' = 'true'
    )
  LOOP
    PERFORM refresh_store_prefetch(store_record.id);
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: Set up pg_cron to run this every 15 minutes:
-- SELECT cron.schedule('refresh-wilson-prefetch', '*/15 * * * *', 'SELECT refresh_all_stores_prefetch()');

-- ============================================================================
-- Session Management Functions
-- ============================================================================

-- Function to increment query count for a Wilson session
CREATE OR REPLACE FUNCTION increment_wilson_queries(session_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE wilson_sessions
  SET queries_count = queries_count + 1,
      last_seen_at = NOW()
  WHERE id = session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Bootstrap existing stores
-- ============================================================================

-- Create config for existing stores
INSERT INTO store_config (store_id)
SELECT id FROM stores
ON CONFLICT (store_id) DO NOTHING;

-- Pre-fetch data for all existing stores
SELECT refresh_store_prefetch(id) FROM stores;

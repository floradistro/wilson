-- =============================================================================
-- Cart, Checkout & Authorize.net Integration Tables
-- Provides prefetch-enabled cart/checkout with PCI-compliant payment processing
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shopping Carts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email TEXT,
  session_id TEXT, -- For guest carts

  -- Totals (calculated on backend)
  subtotal DECIMAL(10,2) DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  shipping_amount DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,

  -- Promotions
  coupon_code TEXT,
  coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,

  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),

  -- Constraints
  CONSTRAINT valid_totals CHECK (subtotal >= 0 AND tax_amount >= 0 AND total >= 0)
);

-- Cart items
CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID REFERENCES carts(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,

  -- Denormalized product data (for performance & deleted products)
  product_name TEXT NOT NULL,
  sku TEXT,
  image_url TEXT,

  -- Pricing
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
  total_price DECIMAL(10,2) NOT NULL CHECK (total_price >= 0),

  -- Variants
  variant JSONB, -- {id, name, options: {size: 'L', color: 'Blue'}}
  custom_fields JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint for product + variant combination
  UNIQUE(cart_id, product_id, variant)
);

-- Indexes for cart queries
CREATE INDEX IF NOT EXISTS idx_carts_store_customer ON carts(store_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_carts_session ON carts(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carts_expires ON carts(expires_at);
CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_product ON cart_items(product_id);

-- -----------------------------------------------------------------------------
-- Shipping Methods & Tax Rates
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shipping_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  estimated_days TEXT, -- e.g., "3-5 business days"
  carrier TEXT, -- UPS, USPS, FedEx, etc.
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,

  -- Restrictions
  min_order_amount DECIMAL(10,2),
  max_weight DECIMAL(10,2),
  zones JSONB, -- Array of state/country codes

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  state TEXT NOT NULL, -- State/province code
  country TEXT DEFAULT 'US',
  rate DECIMAL(5,4) NOT NULL, -- e.g., 0.0825 for 8.25%
  name TEXT, -- e.g., "California Sales Tax"
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(store_id, state, country)
);

CREATE INDEX IF NOT EXISTS idx_shipping_methods_store ON shipping_methods(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tax_rates_lookup ON tax_rates(store_id, state, country);

-- -----------------------------------------------------------------------------
-- Authorize.net Configuration (per-store)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- Auth.net credentials (encrypted at rest via Supabase)
  api_login_id TEXT NOT NULL,
  transaction_key TEXT NOT NULL, -- Encrypted, never sent to client
  client_key TEXT NOT NULL, -- Accept.js public key

  -- Environment
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),

  -- Settings
  capture_mode TEXT DEFAULT 'authorize_capture' CHECK (capture_mode IN ('authorize', 'authorize_capture')),
  avs_enabled BOOLEAN DEFAULT true,
  cvv_required BOOLEAN DEFAULT true,

  -- Webhooks
  webhook_url TEXT,
  webhook_signature_key TEXT,

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  test_mode BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer saved payment profiles (tokenized, PCI compliant)
CREATE TABLE IF NOT EXISTS customer_payment_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,

  -- Auth.net profile IDs (CIM)
  customer_profile_id TEXT NOT NULL, -- Auth.net customer ID
  payment_profile_id TEXT NOT NULL, -- Auth.net payment profile ID

  -- Card info (non-sensitive, for display)
  last_four TEXT NOT NULL,
  card_type TEXT, -- Visa, Mastercard, Amex, Discover
  expiry_month INTEGER NOT NULL CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year INTEGER NOT NULL CHECK (expiry_year >= 2024),

  -- Address (optional billing)
  billing_address JSONB,

  -- Flags
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(store_id, customer_id, payment_profile_id)
);

-- Customer saved addresses
CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,

  -- Address type
  address_type TEXT DEFAULT 'shipping' CHECK (address_type IN ('shipping', 'billing', 'both')),

  -- Address fields
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  company TEXT,
  address1 TEXT NOT NULL,
  address2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  country TEXT DEFAULT 'US',
  phone TEXT,

  -- Flags
  is_default BOOLEAN DEFAULT false,
  is_validated BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_profiles_customer ON customer_payment_profiles(customer_id, is_active);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id, address_type);

-- -----------------------------------------------------------------------------
-- Checkout Sessions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  cart_id UUID REFERENCES carts(id) ON DELETE SET NULL,

  -- Customer
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  customer_first_name TEXT,
  customer_last_name TEXT,
  customer_phone TEXT,

  -- Addresses
  shipping_address JSONB NOT NULL,
  billing_address JSONB,

  -- Shipping
  shipping_method_id UUID REFERENCES shipping_methods(id) ON DELETE SET NULL,
  shipping_method_name TEXT,
  shipping_amount DECIMAL(10,2) DEFAULT 0,

  -- Totals
  subtotal DECIMAL(10,2) NOT NULL,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,

  -- Payment (no sensitive data)
  payment_method TEXT, -- 'credit_card', 'saved_card', 'ach'
  payment_profile_id UUID REFERENCES customer_payment_profiles(id) ON DELETE SET NULL,

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'payment_pending', 'payment_failed',
    'completed', 'cancelled', 'expired'
  )),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_store ON checkout_sessions(store_id, status);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_cart ON checkout_sessions(cart_id);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_customer ON checkout_sessions(customer_id);

-- -----------------------------------------------------------------------------
-- Payment Transactions (audit log)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  checkout_session_id UUID REFERENCES checkout_sessions(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,

  -- Auth.net response
  transaction_id TEXT NOT NULL,
  auth_code TEXT,
  response_code TEXT NOT NULL,
  message_code TEXT,
  description TEXT,

  -- Verification
  avs_result_code TEXT,
  cvv_result_code TEXT,
  cavv_result_code TEXT,

  -- Amount
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',

  -- Transaction type
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'authorize', 'capture', 'auth_capture', 'void', 'refund', 'prior_auth_capture'
  )),

  -- Status
  status TEXT NOT NULL CHECK (status IN (
    'approved', 'declined', 'error', 'held_for_review', 'voided', 'refunded'
  )),

  -- Full response (for debugging)
  raw_response JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_order ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_txn ON payment_transactions(transaction_id);

-- -----------------------------------------------------------------------------
-- Prefetch Function: Get auth/cart/checkout data
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_store_prefetch_data(p_store_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_customer_id UUID;
  v_cart JSONB;
  v_auth JSONB;
  v_checkout JSONB;
BEGIN
  -- Get customer ID if user is linked to a customer
  SELECT c.id INTO v_customer_id
  FROM customers c
  WHERE c.user_id = p_user_id AND c.store_id = p_store_id
  LIMIT 1;

  -- Auth prefetch data
  SELECT jsonb_build_object(
    'user', jsonb_build_object(
      'id', p_user_id,
      'email', (SELECT email FROM auth.users WHERE id = p_user_id)
    ),
    'permissions', COALESCE(
      (SELECT array_agg(permission) FROM user_permissions WHERE user_id = p_user_id),
      ARRAY[]::text[]
    ),
    'storeSettings', (
      SELECT jsonb_build_object(
        'name', s.name,
        'timezone', COALESCE(s.timezone, 'America/New_York'),
        'currency', COALESCE(s.currency, 'USD'),
        'taxRate', COALESCE(
          (SELECT rate FROM tax_rates WHERE store_id = p_store_id AND is_active LIMIT 1),
          0
        )
      )
      FROM stores s WHERE s.id = p_store_id
    ),
    'lastLogin', NOW()
  ) INTO v_auth;

  -- Cart prefetch data
  SELECT jsonb_build_object(
    'cart', (
      SELECT jsonb_build_object(
        'id', c.id,
        'storeId', c.store_id,
        'customerId', c.customer_id,
        'customerEmail', c.customer_email,
        'items', COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'id', ci.id,
            'productId', ci.product_id,
            'productName', ci.product_name,
            'sku', ci.sku,
            'quantity', ci.quantity,
            'unitPrice', ci.unit_price,
            'totalPrice', ci.total_price,
            'imageUrl', ci.image_url,
            'variant', ci.variant
          )) FROM cart_items ci WHERE ci.cart_id = c.id),
          '[]'::jsonb
        ),
        'subtotal', c.subtotal,
        'taxAmount', c.tax_amount,
        'discountAmount', c.discount_amount,
        'total', c.total,
        'itemCount', (SELECT COALESCE(SUM(quantity), 0) FROM cart_items WHERE cart_id = c.id),
        'couponCode', c.coupon_code,
        'notes', c.notes,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at,
        'expiresAt', c.expires_at
      )
      FROM carts c
      WHERE c.store_id = p_store_id
        AND (c.customer_id = v_customer_id OR c.customer_id IS NULL)
        AND c.expires_at > NOW()
      ORDER BY c.updated_at DESC
      LIMIT 1
    ),
    'recentCarts', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'customerId', c.customer_id,
        'itemCount', (SELECT COALESCE(SUM(quantity), 0) FROM cart_items WHERE cart_id = c.id),
        'total', c.total,
        'updatedAt', c.updated_at
      ))
      FROM carts c
      WHERE c.store_id = p_store_id AND c.customer_id = v_customer_id
      ORDER BY c.updated_at DESC LIMIT 5),
      '[]'::jsonb
    ),
    'abandonedCarts', (
      SELECT COUNT(*)
      FROM carts c
      WHERE c.store_id = p_store_id
        AND c.expires_at < NOW()
        AND EXISTS (SELECT 1 FROM cart_items WHERE cart_id = c.id)
    )
  ) INTO v_cart;

  -- Checkout prefetch data
  SELECT jsonb_build_object(
    'authNetConfig', (
      SELECT jsonb_build_object(
        'clientKey', pc.client_key,
        'apiLoginId', pc.api_login_id,
        'environment', pc.environment
      )
      FROM payment_config pc
      WHERE pc.store_id = p_store_id AND pc.is_active = true
      LIMIT 1
    ),
    'shippingMethods', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', sm.id,
        'name', sm.name,
        'description', sm.description,
        'price', sm.price,
        'estimatedDays', sm.estimated_days,
        'carrier', sm.carrier
      ))
      FROM shipping_methods sm
      WHERE sm.store_id = p_store_id AND sm.is_active = true
      ORDER BY sm.sort_order, sm.price),
      '[]'::jsonb
    ),
    'taxRates', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'state', tr.state,
        'rate', tr.rate
      ))
      FROM tax_rates tr
      WHERE tr.store_id = p_store_id AND tr.is_active = true),
      '[]'::jsonb
    ),
    'savedCards', CASE WHEN v_customer_id IS NOT NULL THEN
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
          'id', cpp.id,
          'lastFour', cpp.last_four,
          'cardType', cpp.card_type,
          'expiryMonth', cpp.expiry_month,
          'expiryYear', cpp.expiry_year,
          'isDefault', cpp.is_default
        ))
        FROM customer_payment_profiles cpp
        WHERE cpp.customer_id = v_customer_id AND cpp.is_active = true
        ORDER BY cpp.is_default DESC, cpp.created_at DESC),
        '[]'::jsonb
      )
    ELSE '[]'::jsonb END,
    'savedAddresses', CASE WHEN v_customer_id IS NOT NULL THEN
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
          'id', ca.id,
          'firstName', ca.first_name,
          'lastName', ca.last_name,
          'company', ca.company,
          'address1', ca.address1,
          'address2', ca.address2,
          'city', ca.city,
          'state', ca.state,
          'postalCode', ca.postal_code,
          'country', ca.country,
          'phone', ca.phone,
          'isDefault', ca.is_default
        ))
        FROM customer_addresses ca
        WHERE ca.customer_id = v_customer_id
        ORDER BY ca.is_default DESC, ca.created_at DESC),
        '[]'::jsonb
      )
    ELSE '[]'::jsonb END
  ) INTO v_checkout;

  -- Combine all prefetch data
  v_result := jsonb_build_object(
    'auth', v_auth,
    'cart', v_cart,
    'checkout', v_checkout
  );

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security Policies
-- -----------------------------------------------------------------------------

-- Enable RLS
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payment_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

-- Carts: Users can manage their own store's carts
CREATE POLICY carts_store_access ON carts
  FOR ALL
  USING (
    store_id IN (
      SELECT store_id FROM user_stores WHERE user_id = auth.uid()
    )
  );

CREATE POLICY cart_items_store_access ON cart_items
  FOR ALL
  USING (
    cart_id IN (
      SELECT id FROM carts WHERE store_id IN (
        SELECT store_id FROM user_stores WHERE user_id = auth.uid()
      )
    )
  );

-- Shipping/Tax: Read-only for authenticated users of the store
CREATE POLICY shipping_methods_read ON shipping_methods
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM user_stores WHERE user_id = auth.uid()
    )
  );

CREATE POLICY tax_rates_read ON tax_rates
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM user_stores WHERE user_id = auth.uid()
    )
  );

-- Payment config: Only admins can read (client key only via function)
CREATE POLICY payment_config_admin ON payment_config
  FOR ALL
  USING (
    store_id IN (
      SELECT store_id FROM user_stores
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Customer profiles: Users can manage their store's customer data
CREATE POLICY customer_profiles_store ON customer_payment_profiles
  FOR ALL
  USING (
    store_id IN (
      SELECT store_id FROM user_stores WHERE user_id = auth.uid()
    )
  );

CREATE POLICY customer_addresses_store ON customer_addresses
  FOR ALL
  USING (
    store_id IN (
      SELECT store_id FROM user_stores WHERE user_id = auth.uid()
    )
  );

-- Checkout sessions: Store access
CREATE POLICY checkout_sessions_store ON checkout_sessions
  FOR ALL
  USING (
    store_id IN (
      SELECT store_id FROM user_stores WHERE user_id = auth.uid()
    )
  );

-- Payment transactions: Read-only for store users
CREATE POLICY payment_transactions_read ON payment_transactions
  FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM user_stores WHERE user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- Updated_at Triggers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER carts_updated_at
  BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER cart_items_updated_at
  BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER shipping_methods_updated_at
  BEFORE UPDATE ON shipping_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tax_rates_updated_at
  BEFORE UPDATE ON tax_rates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER payment_config_updated_at
  BEFORE UPDATE ON payment_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER customer_payment_profiles_updated_at
  BEFORE UPDATE ON customer_payment_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER customer_addresses_updated_at
  BEFORE UPDATE ON customer_addresses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER checkout_sessions_updated_at
  BEFORE UPDATE ON checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- Cart Total Recalculation Trigger
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION recalculate_cart_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_cart_id UUID;
  v_subtotal DECIMAL(10,2);
BEGIN
  -- Get cart_id from the affected row
  v_cart_id := COALESCE(NEW.cart_id, OLD.cart_id);

  -- Calculate new subtotal
  SELECT COALESCE(SUM(total_price), 0) INTO v_subtotal
  FROM cart_items
  WHERE cart_id = v_cart_id;

  -- Update cart totals
  UPDATE carts
  SET
    subtotal = v_subtotal,
    total = v_subtotal + tax_amount - discount_amount,
    updated_at = NOW()
  WHERE id = v_cart_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cart_items_recalculate
  AFTER INSERT OR UPDATE OR DELETE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION recalculate_cart_totals();

-- -----------------------------------------------------------------------------
-- Cleanup expired carts job (run via pg_cron or external scheduler)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cleanup_expired_carts()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM carts
  WHERE expires_at < NOW() - INTERVAL '7 days';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

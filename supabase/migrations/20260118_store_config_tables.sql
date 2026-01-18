-- =============================================================================
-- Store Configuration Tables
-- Categories, Field Groups, and Pricing Templates
-- =============================================================================

-- Categories Table (if not exists)
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_categories_store ON categories(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(store_id, slug);

-- Field Groups (Custom Field Definitions)
CREATE TABLE IF NOT EXISTS field_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Fields is an array of field definitions:
  -- { key: string, label: string, type: 'text'|'number'|'select'|'multiselect'|'boolean'|'date'|'url',
  --   required: boolean, options: string[], default_value: any, validation: object }
  fields JSONB NOT NULL DEFAULT '[]',
  -- Which categories this field group applies to (empty = all)
  category_ids UUID[] DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_groups_store ON field_groups(store_id, is_active);

-- Pricing Templates (Discount/Markup Rules)
CREATE TABLE IF NOT EXISTS pricing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Type: 'discount', 'markup', 'tiered', 'bundle', 'bogo'
  type TEXT NOT NULL CHECK (type IN ('discount', 'markup', 'tiered', 'bundle', 'bogo')),
  -- Rules contain the pricing logic:
  -- { percentage: number, fixed_amount: number, min_quantity: number,
  --   tiers: [{min_qty, max_qty, percentage}],
  --   applies_to: { categories: [], products: [], all: boolean } }
  rules JSONB NOT NULL DEFAULT '{}',
  -- Higher priority rules are evaluated first
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  -- Optional date range for limited-time promotions
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_templates_store ON pricing_templates(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_pricing_templates_dates ON pricing_templates(starts_at, ends_at)
  WHERE starts_at IS NOT NULL OR ends_at IS NOT NULL;

-- Coupons Table (for checkout discounts)
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  description TEXT,
  -- Discount type: 'percentage', 'fixed', 'free_shipping'
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed', 'free_shipping')),
  discount_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- Limits
  min_order_amount DECIMAL(10,2),
  max_discount_amount DECIMAL(10,2),
  max_uses INTEGER,
  max_uses_per_customer INTEGER DEFAULT 1,
  current_uses INTEGER DEFAULT 0,
  -- Scope
  applies_to_categories UUID[],
  applies_to_products UUID[],
  excludes_sale_items BOOLEAN DEFAULT false,
  -- Validity
  is_active BOOLEAN DEFAULT true,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(store_id, code, is_active);
CREATE INDEX IF NOT EXISTS idx_coupons_dates ON coupons(starts_at, ends_at)
  WHERE starts_at IS NOT NULL OR ends_at IS NOT NULL;

-- Product Variants Table (for products with options like size/color)
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  -- Options stored as JSON: { size: 'L', color: 'Blue' }
  options JSONB NOT NULL DEFAULT '{}',
  regular_price DECIMAL(10,2),
  sale_price DECIMAL(10,2),
  stock_quantity INTEGER DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 5,
  weight DECIMAL(10,2),
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id, is_active);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku) WHERE sku IS NOT NULL;

-- Inventory Movements (for tracking stock changes)
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  -- Movement type: 'sale', 'return', 'adjustment', 'transfer', 'restock', 'damage', 'theft'
  movement_type TEXT NOT NULL,
  quantity INTEGER NOT NULL, -- negative for decreases
  previous_quantity INTEGER,
  new_quantity INTEGER,
  reference_type TEXT, -- 'order', 'adjustment', 'transfer'
  reference_id UUID,
  notes TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_location ON inventory_movements(location_id, created_at DESC);

-- =============================================================================
-- Triggers for updated_at
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all new tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['categories', 'field_groups', 'pricing_templates', 'coupons', 'product_variants'])
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS %I_updated_at ON %I;
      CREATE TRIGGER %I_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    ', t, t, t, t);
  END LOOP;
END;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can only access their store's data)
CREATE POLICY categories_store_access ON categories
  FOR ALL USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));

CREATE POLICY field_groups_store_access ON field_groups
  FOR ALL USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));

CREATE POLICY pricing_templates_store_access ON pricing_templates
  FOR ALL USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));

CREATE POLICY coupons_store_access ON coupons
  FOR ALL USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));

CREATE POLICY product_variants_access ON product_variants
  FOR ALL USING (product_id IN (
    SELECT id FROM products WHERE store_id IN (
      SELECT store_id FROM user_stores WHERE user_id = auth.uid()
    )
  ));

CREATE POLICY inventory_movements_store_access ON inventory_movements
  FOR ALL USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));

-- =============================================================================
-- Helper Functions
-- =============================================================================

-- Get active pricing rules for a product
CREATE OR REPLACE FUNCTION get_product_pricing_rules(p_product_id UUID, p_category_id UUID DEFAULT NULL)
RETURNS TABLE (
  template_id UUID,
  name TEXT,
  type TEXT,
  rules JSONB,
  priority INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pt.id,
    pt.name,
    pt.type,
    pt.rules,
    pt.priority
  FROM pricing_templates pt
  JOIN products p ON p.store_id = pt.store_id
  WHERE p.id = p_product_id
    AND pt.is_active = true
    AND (pt.starts_at IS NULL OR pt.starts_at <= NOW())
    AND (pt.ends_at IS NULL OR pt.ends_at > NOW())
    AND (
      (pt.rules->>'applies_to')::jsonb->>'all' = 'true'
      OR p_product_id::text = ANY(SELECT jsonb_array_elements_text((pt.rules->>'applies_to')::jsonb->'products'))
      OR p_category_id::text = ANY(SELECT jsonb_array_elements_text((pt.rules->>'applies_to')::jsonb->'categories'))
    )
  ORDER BY pt.priority DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Validate coupon code
CREATE OR REPLACE FUNCTION validate_coupon(
  p_store_id UUID,
  p_code TEXT,
  p_customer_id UUID DEFAULT NULL,
  p_order_total DECIMAL DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
  v_coupon coupons%ROWTYPE;
  v_customer_uses INTEGER;
BEGIN
  -- Find active coupon
  SELECT * INTO v_coupon
  FROM coupons
  WHERE store_id = p_store_id
    AND UPPER(code) = UPPER(p_code)
    AND is_active = true
    AND (starts_at IS NULL OR starts_at <= NOW())
    AND (ends_at IS NULL OR ends_at > NOW());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Coupon not found or expired');
  END IF;

  -- Check max uses
  IF v_coupon.max_uses IS NOT NULL AND v_coupon.current_uses >= v_coupon.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Coupon usage limit reached');
  END IF;

  -- Check per-customer limit
  IF p_customer_id IS NOT NULL AND v_coupon.max_uses_per_customer IS NOT NULL THEN
    SELECT COUNT(*) INTO v_customer_uses
    FROM orders
    WHERE customer_id = p_customer_id AND coupon_id = v_coupon.id;

    IF v_customer_uses >= v_coupon.max_uses_per_customer THEN
      RETURN jsonb_build_object('valid', false, 'error', 'You have already used this coupon');
    END IF;
  END IF;

  -- Check minimum order
  IF v_coupon.min_order_amount IS NOT NULL AND p_order_total < v_coupon.min_order_amount THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', format('Minimum order of $%s required', v_coupon.min_order_amount)
    );
  END IF;

  -- Return valid coupon details
  RETURN jsonb_build_object(
    'valid', true,
    'coupon_id', v_coupon.id,
    'discount_type', v_coupon.discount_type,
    'discount_value', v_coupon.discount_value,
    'max_discount', v_coupon.max_discount_amount,
    'description', v_coupon.description
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Track inventory movement
CREATE OR REPLACE FUNCTION track_inventory_movement(
  p_store_id UUID,
  p_product_id UUID,
  p_quantity INTEGER,
  p_movement_type TEXT,
  p_variant_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_previous_qty INTEGER;
  v_new_qty INTEGER;
  v_movement_id UUID;
BEGIN
  -- Get current quantity
  IF p_variant_id IS NOT NULL THEN
    SELECT stock_quantity INTO v_previous_qty FROM product_variants WHERE id = p_variant_id;
    v_new_qty := COALESCE(v_previous_qty, 0) + p_quantity;
    UPDATE product_variants SET stock_quantity = v_new_qty WHERE id = p_variant_id;
  ELSE
    SELECT stock_quantity INTO v_previous_qty FROM products WHERE id = p_product_id;
    v_new_qty := COALESCE(v_previous_qty, 0) + p_quantity;
    UPDATE products SET stock_quantity = v_new_qty WHERE id = p_product_id;
  END IF;

  -- Record movement
  INSERT INTO inventory_movements (
    store_id, product_id, variant_id, location_id,
    movement_type, quantity, previous_quantity, new_quantity,
    reference_type, reference_id, notes, user_id
  ) VALUES (
    p_store_id, p_product_id, p_variant_id, p_location_id,
    p_movement_type, p_quantity, v_previous_qty, v_new_qty,
    p_reference_type, p_reference_id, p_notes, auth.uid()
  ) RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Comments
-- =============================================================================

COMMENT ON TABLE categories IS 'Product categories with hierarchical support';
COMMENT ON TABLE field_groups IS 'Custom field definitions for products (like cannabis strain info)';
COMMENT ON TABLE pricing_templates IS 'Reusable pricing rules (discounts, markups, tiered pricing)';
COMMENT ON TABLE coupons IS 'Discount codes for checkout';
COMMENT ON TABLE product_variants IS 'Product variations (size, color, etc.)';
COMMENT ON TABLE inventory_movements IS 'Audit log of all stock changes';

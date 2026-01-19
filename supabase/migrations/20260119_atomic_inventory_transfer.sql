-- =====================================================================
-- Atomic Inventory Transfer System
-- Following Anthropic's best practices for consolidated operations
-- =====================================================================

-- Create inventory_transfers table
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number TEXT UNIQUE NOT NULL,
  store_id UUID NOT NULL,
  from_location_id UUID NOT NULL,
  to_location_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'completed', 'cancelled')),
  initiated_by UUID NOT NULL,
  completed_by UUID,
  reason TEXT NOT NULL CHECK (reason IN ('restock', 'store_opening', 'damage_replacement', 'audit_correction', 'customer_order')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Create transfer_items table
CREATE TABLE IF NOT EXISTS transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'g',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create inventory_movements table (audit trail)
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL,
  product_id UUID NOT NULL,
  location_id UUID NOT NULL,
  quantity NUMERIC NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('transfer_out', 'transfer_in', 'adjustment', 'sale', 'return', 'restock', 'damage', 'theft')),
  reference_id UUID,
  reference_type TEXT CHECK (reference_type IN ('transfer', 'order', 'adjustment')),
  initiated_by UUID NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transfers_store_id ON inventory_transfers(store_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from_location ON inventory_transfers(from_location_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_location ON inventory_transfers(to_location_id);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON inventory_transfers(status);
CREATE INDEX IF NOT EXISTS idx_transfers_created_at ON inventory_transfers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer_id ON transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_product ON transfer_items(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_product_location ON inventory_movements(product_id, location_id);
CREATE INDEX IF NOT EXISTS idx_movements_reference ON inventory_movements(reference_id, reference_type);
CREATE INDEX IF NOT EXISTS idx_movements_created_at ON inventory_movements(created_at DESC);

-- Generate sequential transfer numbers
CREATE SEQUENCE IF NOT EXISTS transfer_number_seq;

CREATE OR REPLACE FUNCTION generate_transfer_number()
RETURNS TEXT AS $$
DECLARE
  today TEXT;
  seq_num TEXT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYYMMDD');
  seq_num := LPAD(nextval('transfer_number_seq')::TEXT, 4, '0');
  RETURN 'TRF-' || today || '-' || seq_num;
END;
$$ LANGUAGE plpgsql;

-- Main atomic transfer function
CREATE OR REPLACE FUNCTION transfer_inventory_atomic(
  p_store_id UUID,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_items JSONB,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL,
  p_initiated_by UUID DEFAULT NULL,
  p_auto_complete BOOLEAN DEFAULT TRUE
)
RETURNS JSONB AS $$
DECLARE
  v_transfer_id UUID;
  v_transfer_number TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_quantity NUMERIC;
  v_unit TEXT;
  v_current_stock NUMERIC;
  v_product_name TEXT;
  v_items_count INTEGER;
  v_total_quantity NUMERIC := 0;
  v_user_id UUID;
BEGIN
  -- Validate inputs
  IF p_from_location_id = p_to_location_id THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Source and destination locations must be different'
    );
  END IF;

  -- Get user ID (from JWT or parameter)
  v_user_id := COALESCE(p_initiated_by, auth.uid());

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'User authentication required'
    );
  END IF;

  -- Generate unique transfer number
  v_transfer_number := generate_transfer_number();

  -- Create transfer record
  INSERT INTO inventory_transfers (
    id, transfer_number, store_id,
    from_location_id, to_location_id,
    status, initiated_by, reason, notes, created_at
  ) VALUES (
    gen_random_uuid(), v_transfer_number, p_store_id,
    p_from_location_id, p_to_location_id,
    CASE WHEN p_auto_complete THEN 'pending' ELSE 'draft' END,
    v_user_id, p_reason, p_notes, NOW()
  ) RETURNING id INTO v_transfer_id;

  -- Process each item
  v_items_count := jsonb_array_length(p_items);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::NUMERIC;
    v_unit := COALESCE(v_item->>'unit', 'g');

    -- Get product name for error messages
    SELECT name INTO v_product_name FROM products WHERE id = v_product_id;

    IF v_product_name IS NULL THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'error', 'Product not found: ' || v_product_id::TEXT
      );
    END IF;

    -- Validate source inventory
    SELECT
      COALESCE(SUM(stock_quantity), 0)
    INTO v_current_stock
    FROM product_inventory
    WHERE product_id = v_product_id
      AND location_id = p_from_location_id
      AND store_id = p_store_id;

    IF v_current_stock < v_quantity THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'error', format('Insufficient stock for "%s". Available: %s%s, Requested: %s%s',
          v_product_name, v_current_stock, v_unit, v_quantity, v_unit),
        'product_name', v_product_name,
        'available', v_current_stock,
        'requested', v_quantity
      );
    END IF;

    -- Create transfer item record
    INSERT INTO transfer_items (
      transfer_id, product_id, quantity, unit
    ) VALUES (
      v_transfer_id, v_product_id, v_quantity, v_unit
    );

    v_total_quantity := v_total_quantity + v_quantity;

    -- If auto-complete, execute inventory movements
    IF p_auto_complete THEN
      -- Decrement source location
      UPDATE product_inventory
      SET
        stock_quantity = stock_quantity - v_quantity,
        updated_at = NOW()
      WHERE product_id = v_product_id
        AND location_id = p_from_location_id
        AND store_id = p_store_id;

      -- Increment destination location (with UPSERT)
      INSERT INTO product_inventory (
        store_id, product_id, location_id, stock_quantity, updated_at
      ) VALUES (
        p_store_id, v_product_id, p_to_location_id, v_quantity, NOW()
      )
      ON CONFLICT (store_id, product_id, location_id)
      DO UPDATE SET
        stock_quantity = product_inventory.stock_quantity + v_quantity,
        updated_at = NOW();

      -- Log outbound movement (audit trail)
      INSERT INTO inventory_movements (
        store_id, product_id, location_id,
        quantity, movement_type,
        reference_id, reference_type,
        initiated_by, notes, created_at
      ) VALUES (
        p_store_id, v_product_id, p_from_location_id,
        -v_quantity, 'transfer_out',
        v_transfer_id, 'transfer',
        v_user_id, p_notes, NOW()
      );

      -- Log inbound movement (audit trail)
      INSERT INTO inventory_movements (
        store_id, product_id, location_id,
        quantity, movement_type,
        reference_id, reference_type,
        initiated_by, notes, created_at
      ) VALUES (
        p_store_id, v_product_id, p_to_location_id,
        v_quantity, 'transfer_in',
        v_transfer_id, 'transfer',
        v_user_id, p_notes, NOW()
      );
    END IF;
  END LOOP;

  -- Update transfer status to completed if auto-complete
  IF p_auto_complete THEN
    UPDATE inventory_transfers
    SET
      status = 'completed',
      completed_by = v_user_id,
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = v_transfer_id;
  END IF;

  -- Return transfer details
  RETURN jsonb_build_object(
    'success', TRUE,
    'transfer_id', v_transfer_id,
    'transfer_number', v_transfer_number,
    'status', CASE WHEN p_auto_complete THEN 'completed' ELSE 'draft' END,
    'items_count', v_items_count,
    'total_quantity', v_total_quantity,
    'from_location_id', p_from_location_id,
    'to_location_id', p_to_location_id
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Transaction automatically rolls back
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', SQLERRM,
      'error_code', SQLSTATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get transfer details with items
CREATE OR REPLACE FUNCTION get_transfer_details(p_transfer_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'transfer', row_to_json(t.*),
    'items', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'product_id', ti.product_id,
            'product_name', p.name,
            'quantity', ti.quantity,
            'unit', ti.unit
          )
        )
        FROM transfer_items ti
        JOIN products p ON p.id = ti.product_id
        WHERE ti.transfer_id = t.id
      ),
      '[]'::jsonb
    ),
    'from_location', jsonb_build_object('id', fl.id, 'name', fl.name),
    'to_location', jsonb_build_object('id', tl.id, 'name', tl.name)
  ) INTO v_result
  FROM inventory_transfers t
  JOIN locations fl ON fl.id = t.from_location_id
  JOIN locations tl ON tl.id = t.to_location_id
  WHERE t.id = p_transfer_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION transfer_inventory_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_inventory_atomic TO service_role;
GRANT EXECUTE ON FUNCTION get_transfer_details TO authenticated;
GRANT EXECUTE ON FUNCTION get_transfer_details TO service_role;

-- RLS policies for inventory_transfers
ALTER TABLE inventory_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transfers for their store" ON inventory_transfers
  FOR SELECT USING (
    store_id IN (
      SELECT store_id FROM staff WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create transfers for their store" ON inventory_transfers
  FOR INSERT WITH CHECK (
    store_id IN (
      SELECT store_id FROM staff WHERE user_id = auth.uid()
    )
  );

-- RLS policies for transfer_items
ALTER TABLE transfer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transfer items" ON transfer_items
  FOR SELECT USING (
    transfer_id IN (
      SELECT id FROM inventory_transfers
      WHERE store_id IN (
        SELECT store_id FROM staff WHERE user_id = auth.uid()
      )
    )
  );

-- RLS policies for inventory_movements (audit log)
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view movements for their store" ON inventory_movements
  FOR SELECT USING (
    store_id IN (
      SELECT store_id FROM staff WHERE user_id = auth.uid()
    )
  );

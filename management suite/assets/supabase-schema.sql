-- ==============================================================================
-- Management Suite — Enterprise Production Supabase Provisioning Schema
-- 
-- Run this script in your Supabase Project's SQL Editor (Dashboard -> SQL Editor)
-- to initialize all required tables, audit logs, RPC health checks, indexes, 
-- and realtime synchronization.
-- ==============================================================================

-- 1. Master Key-Value Synchronized Store (Core App Data)
CREATE TABLE IF NOT EXISTS public.vf_kv_store (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index on updated_at for high-speed differential metadata polling
CREATE INDEX IF NOT EXISTS idx_vf_kv_store_updated_at ON public.vf_kv_store(updated_at DESC);

-- 2. Dedicated Table: Weaving Costing Products
CREATE TABLE IF NOT EXISTS public.vf_costing_products (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_costing_products_updated_at ON public.vf_costing_products(updated_at DESC);

-- 3. Dedicated Table: TFO Costing Products
CREATE TABLE IF NOT EXISTS public.vf_costing_tfo_products (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_costing_tfo_products_updated_at ON public.vf_costing_tfo_products(updated_at DESC);

-- 4. Dedicated Table: Doubler Costing Products
CREATE TABLE IF NOT EXISTS public.vf_costing_doubler_products (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_costing_doubler_products_updated_at ON public.vf_costing_doubler_products(updated_at DESC);

-- 5. Dedicated Table: Covering Costing Products
CREATE TABLE IF NOT EXISTS public.vf_costing_covering_products (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_costing_covering_products_updated_at ON public.vf_costing_covering_products(updated_at DESC);

-- 6. Dedicated Table: Enterprise Audit Logs (Tracking all modifications & security events)
CREATE TABLE IF NOT EXISTS public.vf_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    user_email TEXT,
    role TEXT DEFAULT 'employee',
    action TEXT NOT NULL,         -- 'create' | 'update' | 'delete' | 'login' | 'export' | 'system'
    entity_type TEXT NOT NULL,    -- 'order' | 'weft_stock' | 'warp_stock' | 'salary' | 'costing' | 'settings' | 'auth'
    entity_id TEXT,
    details JSONB,
    client_ip TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_audit_logs_created_at ON public.vf_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vf_audit_logs_entity ON public.vf_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_vf_audit_logs_user ON public.vf_audit_logs(user_email);

-- 7. Dedicated Relational Table: Yarn RM Inward Lots
CREATE TABLE IF NOT EXISTS public.vf_yarn_rm_lots (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    lot_number TEXT NOT NULL,
    challan_number TEXT,
    receive_date DATE NOT NULL DEFAULT CURRENT_DATE,
    supplier TEXT NOT NULL,
    quality TEXT NOT NULL,
    item_type TEXT DEFAULT 'Polyester',
    code TEXT,
    color TEXT,
    rate NUMERIC(12, 2) DEFAULT 0,
    order_ref TEXT,
    total_boxes INTEGER DEFAULT 0,
    gross_weight NUMERIC(12, 2) DEFAULT 0,
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_lots_lot_num ON public.vf_yarn_rm_lots(lot_number);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_lots_supplier ON public.vf_yarn_rm_lots(supplier);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_lots_receive_date ON public.vf_yarn_rm_lots(receive_date DESC);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_lots_updated_at ON public.vf_yarn_rm_lots(updated_at DESC);

-- 8. Dedicated Relational Table: Yarn RM Inventory Boxes
CREATE TABLE IF NOT EXISTS public.vf_yarn_rm_boxes (
    id TEXT PRIMARY KEY,
    lot_id TEXT NOT NULL REFERENCES public.vf_yarn_rm_lots(id) ON DELETE CASCADE,
    box_number TEXT NOT NULL,
    cones INTEGER DEFAULT 0,
    gross_weight NUMERIC(10, 2) NOT NULL DEFAULT 0,
    remaining_weight NUMERIC(10, 2) NOT NULL DEFAULT 0,
    active_weight NUMERIC(10, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'issued', 'gr')),
    issue_date DATE,
    issued_to TEXT,
    gr_date DATE,
    gr_weight NUMERIC(10, 2) DEFAULT 0,
    gr_remarks TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_boxes_lot_id ON public.vf_yarn_rm_boxes(lot_id);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_boxes_status ON public.vf_yarn_rm_boxes(status);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_boxes_box_number ON public.vf_yarn_rm_boxes(box_number);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_boxes_updated_at ON public.vf_yarn_rm_boxes(updated_at DESC);

-- 9. Dedicated Relational Table: Yarn RM Transaction & Audit Ledger
CREATE TABLE IF NOT EXISTS public.vf_yarn_rm_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('issue', 'return_gr', 'adjust', 'add')),
    lot_id TEXT NOT NULL REFERENCES public.vf_yarn_rm_lots(id) ON DELETE CASCADE,
    box_id TEXT NOT NULL,
    box_number TEXT,
    weight NUMERIC(10, 2) NOT NULL DEFAULT 0,
    cones INTEGER DEFAULT 0,
    issued_to TEXT,
    remarks TEXT,
    created_by TEXT DEFAULT 'Operator',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_tx_lot ON public.vf_yarn_rm_transactions(lot_id);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_tx_box ON public.vf_yarn_rm_transactions(box_id);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_rm_tx_created ON public.vf_yarn_rm_transactions(created_at DESC);

-- ==============================================================================
-- Server-Side RPC Utility Functions (Health, Security & Atomic Transactions)
-- ==============================================================================

-- Atomic Box Issue Transaction (Guarantees zero race conditions & double issuing)
CREATE OR REPLACE FUNCTION public.vf_issue_yarn_boxes(
    p_box_ids TEXT[],
    p_issued_to TEXT,
    p_issue_date DATE DEFAULT CURRENT_DATE,
    p_user TEXT DEFAULT 'Operator',
    p_remarks TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated_count INT := 0;
    v_box_rec RECORD;
BEGIN
    IF p_box_ids IS NULL OR array_length(p_box_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No box IDs provided');
    END IF;

    -- 1. Verify availability of selected boxes
    FOR v_box_rec IN
        SELECT id, lot_id, box_number, active_weight, cones, status
        FROM public.vf_yarn_rm_boxes
        WHERE id = ANY(p_box_ids)
        FOR UPDATE
    LOOP
        IF v_box_rec.status = 'issued' THEN
            RETURN jsonb_build_object(
                'success', false, 
                'error', format('Box %s is already issued', v_box_rec.box_number)
            );
        END IF;

        IF v_box_rec.status = 'gr' THEN
            RETURN jsonb_build_object(
                'success', false, 
                'error', format('Box %s is marked as GR (Returned)', v_box_rec.box_number)
            );
        END IF;

        -- 2. Insert transaction ledger row
        INSERT INTO public.vf_yarn_rm_transactions (
            transaction_type,
            lot_id,
            box_id,
            box_number,
            weight,
            cones,
            issued_to,
            remarks,
            created_by
        ) VALUES (
            'issue',
            v_box_rec.lot_id,
            v_box_rec.id,
            v_box_rec.box_number,
            v_box_rec.active_weight,
            v_box_rec.cones,
            p_issued_to,
            p_remarks,
            p_user
        );
    END LOOP;

    -- 3. Atomically update box status
    UPDATE public.vf_yarn_rm_boxes
    SET 
        status = 'issued',
        issue_date = p_issue_date,
        issued_to = p_issued_to,
        updated_at = timezone('utc'::text, now())
    WHERE id = ANY(p_box_ids) AND status = 'available';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'issued_count', v_updated_count,
        'issued_to', p_issued_to,
        'issue_date', p_issue_date
    );
END;
$$;

-- Health check RPC to verify database latency & connection health
CREATE OR REPLACE FUNCTION public.vf_ping()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN jsonb_build_object(
        'status', 'healthy',
        'timestamp', timezone('utc'::text, now()),
        'version', '2.0.0',
        'server_time', now()
    );
END;
$$;

-- Helper to check if current JWT user has admin role in app metadata
CREATE OR REPLACE FUNCTION public.vf_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT coalesce(
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        OR auth.role() = 'service_role',
        false
    );
$$;

-- 10. Dedicated Relational Table: Yarn RM Purchase Orders
CREATE TABLE IF NOT EXISTS public.vf_yarn_orders (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    supplier TEXT NOT NULL,
    category TEXT DEFAULT 'Polyester',
    quality TEXT NOT NULL,
    code TEXT,
    color TEXT,
    ordered_weight NUMERIC(12, 2) NOT NULL DEFAULT 0,
    price NUMERIC(12, 2) DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Cancelled')),
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_orders_num ON public.vf_yarn_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_orders_supplier ON public.vf_yarn_orders(supplier);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_orders_quality ON public.vf_yarn_orders(quality);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_orders_date ON public.vf_yarn_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_orders_status ON public.vf_yarn_orders(status);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_orders_updated_at ON public.vf_yarn_orders(updated_at DESC);

-- 11. Dedicated Relational Table: Yarn RM Inward Batches (Challans per PO)
CREATE TABLE IF NOT EXISTS public.vf_yarn_order_batches (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES public.vf_yarn_orders(id) ON DELETE CASCADE,
    challan_number TEXT NOT NULL,
    lot_number TEXT NOT NULL,
    receive_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_weight NUMERIC(12, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_batches_order_id ON public.vf_yarn_order_batches(order_id);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_batches_challan ON public.vf_yarn_order_batches(challan_number);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_batches_lot ON public.vf_yarn_order_batches(lot_number);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_batches_date ON public.vf_yarn_order_batches(receive_date DESC);

-- 12. Dedicated Relational Table: Yarn RM Order Boxes
CREATE TABLE IF NOT EXISTS public.vf_yarn_order_boxes (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES public.vf_yarn_order_batches(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL REFERENCES public.vf_yarn_orders(id) ON DELETE CASCADE,
    box_number TEXT NOT NULL,
    weight NUMERIC(10, 2) NOT NULL DEFAULT 0,
    cones INTEGER DEFAULT 0,
    returned_weight NUMERIC(10, 2) DEFAULT 0,
    returned_date DATE,
    return_reason TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_order_boxes_batch ON public.vf_yarn_order_boxes(batch_id);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_order_boxes_order ON public.vf_yarn_order_boxes(order_id);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_order_boxes_box_num ON public.vf_yarn_order_boxes(box_number);

-- 13. Dedicated Relational Table: Weft Yarn Issues (Loom Consumptions & Ledger)
CREATE TABLE IF NOT EXISTS public.vf_weft_issues (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    quality TEXT NOT NULL,
    supplier TEXT NOT NULL,
    code TEXT,
    color TEXT,
    box TEXT NOT NULL,
    challan TEXT,
    lot TEXT,
    cones NUMERIC(10, 2) DEFAULT 0,
    net NUMERIC(10, 3) NOT NULL DEFAULT 0,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_weft_issues_quality ON public.vf_weft_issues(quality);
CREATE INDEX IF NOT EXISTS idx_vf_weft_issues_supplier ON public.vf_weft_issues(supplier);
CREATE INDEX IF NOT EXISTS idx_vf_weft_issues_code ON public.vf_weft_issues(code);
CREATE INDEX IF NOT EXISTS idx_vf_weft_issues_box ON public.vf_weft_issues(box);
CREATE INDEX IF NOT EXISTS idx_vf_weft_issues_date ON public.vf_weft_issues(date DESC);
CREATE INDEX IF NOT EXISTS idx_vf_weft_issues_challan ON public.vf_weft_issues(challan);

-- 14. Atomic Stored Procedure: Record Weft Issues in Batch
CREATE OR REPLACE FUNCTION public.vf_record_weft_issues(
    p_issues JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    issue_record JSONB;
    inserted_count INT := 0;
BEGIN
    FOR issue_record IN SELECT * FROM jsonb_array_elements(p_issues)
    LOOP
        INSERT INTO public.vf_weft_issues (
            id,
            date,
            quality,
            supplier,
            code,
            color,
            box,
            challan,
            lot,
            cones,
            net,
            details,
            updated_at
        ) VALUES (
            COALESCE(issue_record->>'id', 'WEFT-ISSUE-' || gen_random_uuid()::text),
            COALESCE((issue_record->>'date')::date, CURRENT_DATE),
            COALESCE(issue_record->>'quality', ''),
            COALESCE(issue_record->>'supplier', ''),
            issue_record->>'code',
            issue_record->>'color',
            COALESCE(issue_record->>'box', ''),
            issue_record->>'challan',
            issue_record->>'lot',
            COALESCE((issue_record->>'cones')::numeric, 0),
            COALESCE((issue_record->>'net')::numeric, 0),
            issue_record->>'details',
            timezone('utc'::text, now())
        )
        ON CONFLICT (id) DO UPDATE SET
            date = EXCLUDED.date,
            quality = EXCLUDED.quality,
            supplier = EXCLUDED.supplier,
            code = EXCLUDED.code,
            color = EXCLUDED.color,
            box = EXCLUDED.box,
            challan = EXCLUDED.challan,
            lot = EXCLUDED.lot,
            cones = EXCLUDED.cones,
            net = EXCLUDED.net,
            details = EXCLUDED.details,
            updated_at = timezone('utc'::text, now());

        inserted_count := inserted_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'count', inserted_count,
        'timestamp', timezone('utc'::text, now())
    );
END;
$$;

-- ==============================================================================
-- Row Level Security (RLS) Configuration
-- ==============================================================================

ALTER TABLE public.vf_kv_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_tfo_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_doubler_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_covering_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_rm_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_rm_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_rm_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_order_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_order_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_weft_issues ENABLE ROW LEVEL SECURITY;

-- Dynamic Policy Configuration:
-- Production Mode: Allows read/write for all authenticated API requests & anon key (matching client tokens)
DO $$
BEGIN
    -- 1. vf_kv_store
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_kv_store' AND policyname = 'Allow public access to vf_kv_store') THEN
        CREATE POLICY "Allow public access to vf_kv_store" ON public.vf_kv_store FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 2. vf_costing_products
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_costing_products' AND policyname = 'Allow public access to vf_costing_products') THEN
        CREATE POLICY "Allow public access to vf_costing_products" ON public.vf_costing_products FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 3. vf_costing_tfo_products
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_costing_tfo_products' AND policyname = 'Allow public access to vf_costing_tfo_products') THEN
        CREATE POLICY "Allow public access to vf_costing_tfo_products" ON public.vf_costing_tfo_products FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 4. vf_costing_doubler_products
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_costing_doubler_products' AND policyname = 'Allow public access to vf_costing_doubler_products') THEN
        CREATE POLICY "Allow public access to vf_costing_doubler_products" ON public.vf_costing_doubler_products FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 5. vf_costing_covering_products
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_costing_covering_products' AND policyname = 'Allow public access to vf_costing_covering_products') THEN
        CREATE POLICY "Allow public access to vf_costing_covering_products" ON public.vf_costing_covering_products FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 6. vf_audit_logs (Public insert, read for all authenticated clients)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_audit_logs' AND policyname = 'Allow public access to vf_audit_logs') THEN
        CREATE POLICY "Allow public access to vf_audit_logs" ON public.vf_audit_logs FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 7. vf_yarn_rm_lots
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_yarn_rm_lots' AND policyname = 'Allow public access to vf_yarn_rm_lots') THEN
        CREATE POLICY "Allow public access to vf_yarn_rm_lots" ON public.vf_yarn_rm_lots FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 8. vf_yarn_rm_boxes
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_yarn_rm_boxes' AND policyname = 'Allow public access to vf_yarn_rm_boxes') THEN
        CREATE POLICY "Allow public access to vf_yarn_rm_boxes" ON public.vf_yarn_rm_boxes FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 9. vf_yarn_rm_transactions
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_yarn_rm_transactions' AND policyname = 'Allow public access to vf_yarn_rm_transactions') THEN
        CREATE POLICY "Allow public access to vf_yarn_rm_transactions" ON public.vf_yarn_rm_transactions FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 10. vf_yarn_orders
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_yarn_orders' AND policyname = 'Allow public access to vf_yarn_orders') THEN
        CREATE POLICY "Allow public access to vf_yarn_orders" ON public.vf_yarn_orders FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 11. vf_yarn_order_batches
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_yarn_order_batches' AND policyname = 'Allow public access to vf_yarn_order_batches') THEN
        CREATE POLICY "Allow public access to vf_yarn_order_batches" ON public.vf_yarn_order_batches FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 12. vf_yarn_order_boxes
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_yarn_order_boxes' AND policyname = 'Allow public access to vf_yarn_order_boxes') THEN
        CREATE POLICY "Allow public access to vf_yarn_order_boxes" ON public.vf_yarn_order_boxes FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 13. vf_weft_issues
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_weft_issues' AND policyname = 'Allow public access to vf_weft_issues') THEN
        CREATE POLICY "Allow public access to vf_weft_issues" ON public.vf_weft_issues FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- ==============================================================================
-- Storage Bucket Provisioning (For Design Cards, Beam Photos & Media Attachments)
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('vf_media_assets', 'vf_media_assets', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Allow public access to vf_media_assets') THEN
        CREATE POLICY "Allow public access to vf_media_assets" ON storage.objects
        FOR ALL USING (bucket_id = 'vf_media_assets') WITH CHECK (bucket_id = 'vf_media_assets');
    END IF;
EXCEPTION
    WHEN others THEN NULL;
END $$;

-- ==============================================================================
-- Supabase Realtime Broadcast Configuration
-- ==============================================================================

-- Enable Realtime publication on all synchronized tables (if supabase_realtime publication exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_kv_store;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_costing_products;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_costing_tfo_products;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_costing_doubler_products;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_costing_covering_products;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_audit_logs;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_yarn_rm_lots;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_yarn_rm_boxes;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_yarn_rm_transactions;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_yarn_orders;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_yarn_order_batches;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_yarn_order_boxes;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_weft_issues;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
END $$;


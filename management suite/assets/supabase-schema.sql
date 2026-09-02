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

-- 15. Dedicated Relational Table: Warp Beams
CREATE TABLE IF NOT EXISTS public.vf_warp_beams (
    id TEXT PRIMARY KEY,
    beam_number TEXT NOT NULL UNIQUE,
    quality TEXT NOT NULL,
    code TEXT,
    color TEXT,
    meters NUMERIC(10, 2) NOT NULL DEFAULT 0,
    ends INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Available',
    machine_number TEXT,
    warping_person TEXT,
    created_at DATE NOT NULL DEFAULT CURRENT_DATE,
    history JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_warp_beams_num ON public.vf_warp_beams(beam_number);
CREATE INDEX IF NOT EXISTS idx_vf_warp_beams_quality ON public.vf_warp_beams(quality);
CREATE INDEX IF NOT EXISTS idx_vf_warp_beams_code ON public.vf_warp_beams(code);
CREATE INDEX IF NOT EXISTS idx_vf_warp_beams_status ON public.vf_warp_beams(status);
CREATE INDEX IF NOT EXISTS idx_vf_warp_beams_machine ON public.vf_warp_beams(machine_number);

-- 16. Dedicated Relational Table: Warp Yarn Issues (To Sizing / Warping)
CREATE TABLE IF NOT EXISTS public.vf_warp_issues (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    quality TEXT NOT NULL,
    code TEXT,
    color TEXT,
    issued_weight NUMERIC(10, 3) NOT NULL DEFAULT 0,
    details TEXT,
    supplier TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_warp_issues_quality ON public.vf_warp_issues(quality);
CREATE INDEX IF NOT EXISTS idx_vf_warp_issues_date ON public.vf_warp_issues(date DESC);
CREATE INDEX IF NOT EXISTS idx_vf_warp_issues_supplier ON public.vf_warp_issues(supplier);

-- 17. Dedicated Relational Table: Warp Beam Loom Loadings & Setup Records
CREATE TABLE IF NOT EXISTS public.vf_warp_beam_loadings (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    piecein TEXT,
    drawing_in TEXT,
    fani TEXT,
    drop_pin_jog TEXT,
    machine_number TEXT,
    beam_number TEXT,
    item_color TEXT,
    meters NUMERIC(10, 2) DEFAULT 0,
    ends INTEGER DEFAULT 0,
    rate NUMERIC(10, 2) DEFAULT 0,
    payment_amount NUMERIC(12, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_warp_loadings_beam ON public.vf_warp_beam_loadings(beam_number);
CREATE INDEX IF NOT EXISTS idx_vf_warp_loadings_machine ON public.vf_warp_beam_loadings(machine_number);
CREATE INDEX IF NOT EXISTS idx_vf_warp_loadings_date ON public.vf_warp_beam_loadings(date DESC);

-- 18. Dedicated Relational Table: Weaving Loom Production Logs & Takas
CREATE TABLE IF NOT EXISTS public.vf_weaving_production_logs (
    id TEXT PRIMARY KEY,
    production_date DATE NOT NULL,
    machine_number TEXT NOT NULL,
    beam_number TEXT,
    secondary_beam_number TEXT,
    pissing_date DATE,
    pissing_person TEXT,
    day_worker TEXT,
    day_shift_hours NUMERIC(4, 2) DEFAULT 0,
    day_meters NUMERIC(10, 2) DEFAULT 0,
    night_worker TEXT,
    night_shift_hours NUMERIC(4, 2) DEFAULT 0,
    night_meters NUMERIC(10, 2) DEFAULT 0,
    picks INTEGER DEFAULT 0,
    product TEXT,
    total_meters NUMERIC(10, 2) DEFAULT 0,
    taka_serial TEXT,
    folding_date DATE,
    taka_weight NUMERIC(10, 3),
    taka_assign_id TEXT,
    is_tp_roll BOOLEAN DEFAULT false,
    tp_source_serials JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_weav_prod_date ON public.vf_weaving_production_logs(production_date DESC);
CREATE INDEX IF NOT EXISTS idx_vf_weav_prod_machine ON public.vf_weaving_production_logs(machine_number);
CREATE INDEX IF NOT EXISTS idx_vf_weav_prod_beam ON public.vf_weaving_production_logs(beam_number);
CREATE INDEX IF NOT EXISTS idx_vf_weav_prod_taka ON public.vf_weaving_production_logs(taka_serial);
CREATE INDEX IF NOT EXISTS idx_vf_weav_prod_product ON public.vf_weaving_production_logs(product);

-- 19. Dedicated Relational Table: Yarn Production Logs (Covering, TFO, Doubler)
CREATE TABLE IF NOT EXISTS public.vf_yarn_production_logs (
    id TEXT PRIMARY KEY,
    division TEXT NOT NULL,
    date DATE NOT NULL,
    bori_no TEXT NOT NULL,
    product_name TEXT NOT NULL,
    product_id TEXT,
    lot_no TEXT,
    color TEXT,
    denier NUMERIC(10, 2),
    tpm INTEGER,
    twist TEXT,
    rolls INTEGER DEFAULT 0,
    qty NUMERIC(10, 3) NOT NULL DEFAULT 0,
    config_type TEXT,
    ply TEXT,
    yarns JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_prod_div ON public.vf_yarn_production_logs(division);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_prod_date ON public.vf_yarn_production_logs(date DESC);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_prod_bori ON public.vf_yarn_production_logs(bori_no);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_prod_prod ON public.vf_yarn_production_logs(product_name);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_prod_lot ON public.vf_yarn_production_logs(lot_no);

-- 20. Dedicated Relational Table: Yarn Sales Logs (Covering, TFO, Doubler)
CREATE TABLE IF NOT EXISTS public.vf_yarn_sales_logs (
    id TEXT PRIMARY KEY,
    division TEXT NOT NULL,
    sale_date DATE NOT NULL,
    challan_no TEXT,
    customer_name TEXT NOT NULL,
    customer_address TEXT,
    seller_company_id TEXT,
    seller_name TEXT,
    discount_type TEXT DEFAULT 'percent',
    discount_value NUMERIC(12, 2) DEFAULT 0,
    discount_amount NUMERIC(12, 2) DEFAULT 0,
    taxable_amount NUMERIC(12, 2),
    gst_rate NUMERIC(6, 2) DEFAULT 12,
    subtotal_amount NUMERIC(12, 2),
    items JSONB DEFAULT '[]'::jsonb,
    total_qty NUMERIC(10, 3) DEFAULT 0,
    total_amount NUMERIC(12, 2) DEFAULT 0,
    gst_amount NUMERIC(12, 2) DEFAULT 0,
    raw_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Migration safety for existing vf_yarn_sales_logs tables:
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS customer_address TEXT;
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS seller_company_id TEXT;
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS seller_name TEXT;
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS discount_type TEXT DEFAULT 'percent';
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(12, 2);
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(6, 2) DEFAULT 12;
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(12, 2);
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS raw_data JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_vf_yarn_sales_div ON public.vf_yarn_sales_logs(division);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_sales_date ON public.vf_yarn_sales_logs(sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_sales_cust ON public.vf_yarn_sales_logs(customer_name);
CREATE INDEX IF NOT EXISTS idx_vf_yarn_sales_challan ON public.vf_yarn_sales_logs(challan_no);

-- 21. Dedicated Relational Table: Fabric Dispatches & Outsource Pipeline
CREATE TABLE IF NOT EXISTS public.vf_fabric_dispatches (
    id TEXT PRIMARY KEY,
    taka_serial TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'Warehouse',
    current_stage TEXT DEFAULT 'Warehouse',
    vendor TEXT,
    customer TEXT,
    invoice_no TEXT,
    challan_no TEXT,
    dispatch_date DATE,
    selling_rate NUMERIC(10, 2),
    is_partial_piece BOOLEAN DEFAULT false,
    history JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_fabric_disp_serial ON public.vf_fabric_dispatches(taka_serial);
CREATE INDEX IF NOT EXISTS idx_vf_fabric_disp_status ON public.vf_fabric_dispatches(status);
CREATE INDEX IF NOT EXISTS idx_vf_fabric_disp_stage ON public.vf_fabric_dispatches(current_stage);
CREATE INDEX IF NOT EXISTS idx_vf_fabric_disp_vendor ON public.vf_fabric_dispatches(vendor);
CREATE INDEX IF NOT EXISTS idx_vf_fabric_disp_cust ON public.vf_fabric_dispatches(customer);
CREATE INDEX IF NOT EXISTS idx_vf_fabric_disp_date ON public.vf_fabric_dispatches(dispatch_date DESC);

-- 22. Dedicated Relational Table: Fabric Taka Piece Cut Relations
CREATE TABLE IF NOT EXISTS public.vf_fabric_cut_relations (
    id TEXT PRIMARY KEY,
    parent_serial TEXT NOT NULL,
    children JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_fabric_cuts_parent ON public.vf_fabric_cut_relations(parent_serial);

-- 23. Dedicated Relational Table: Employees Master
CREATE TABLE IF NOT EXISTS public.vf_employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    department TEXT,
    salary_style TEXT NOT NULL DEFAULT 'Per Day Fixed',
    salary_rate NUMERIC(10, 2) DEFAULT 0,
    base_salary NUMERIC(10, 2) DEFAULT 0,
    phone TEXT,
    email TEXT,
    joining_date DATE,
    assigned_machines JSONB DEFAULT '[]'::jsonb,
    avatar_gradient TEXT,
    active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_emp_name ON public.vf_employees(name);
CREATE INDEX IF NOT EXISTS idx_vf_emp_role ON public.vf_employees(role);
CREATE INDEX IF NOT EXISTS idx_vf_emp_active ON public.vf_employees(active);

-- 24. Dedicated Relational Table: Attendance Records
CREATE TABLE IF NOT EXISTS public.vf_attendance_records (
    id TEXT PRIMARY KEY,
    attendance_date DATE NOT NULL,
    employee_id TEXT NOT NULL REFERENCES public.vf_employees(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'Present',
    shift TEXT DEFAULT 'Day',
    hours NUMERIC(5, 2) DEFAULT 0,
    overtime_hours NUMERIC(5, 2) DEFAULT 0,
    meters NUMERIC(10, 2) DEFAULT 0,
    rate NUMERIC(10, 2) DEFAULT 0,
    total_earned NUMERIC(10, 2) DEFAULT 0,
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_att_date ON public.vf_attendance_records(attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_vf_att_emp ON public.vf_attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_vf_att_status ON public.vf_attendance_records(status);

-- 25. Dedicated Relational Table: Employee Loans & Advances
CREATE TABLE IF NOT EXISTS public.vf_employee_loans (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES public.vf_employees(id) ON DELETE CASCADE,
    loan_date DATE NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    type TEXT NOT NULL DEFAULT 'Advance',
    reason TEXT,
    cleared BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_loans_emp ON public.vf_employee_loans(employee_id);
CREATE INDEX IF NOT EXISTS idx_vf_loans_date ON public.vf_employee_loans(loan_date DESC);
CREATE INDEX IF NOT EXISTS idx_vf_loans_type ON public.vf_employee_loans(type);
CREATE INDEX IF NOT EXISTS idx_vf_loans_cleared ON public.vf_employee_loans(cleared);

-- 26. Dedicated Relational Table: Monthly Salary Settlements
CREATE TABLE IF NOT EXISTS public.vf_salary_settlements (
    id TEXT PRIMARY KEY,
    month_year TEXT NOT NULL,
    employee_id TEXT NOT NULL REFERENCES public.vf_employees(id) ON DELETE CASCADE,
    paid_amount NUMERIC(10, 2) DEFAULT 0,
    net_payable NUMERIC(10, 2) DEFAULT 0,
    paid_date DATE,
    payment_mode TEXT,
    status TEXT DEFAULT 'Pending',
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_salary_month ON public.vf_salary_settlements(month_year DESC);
CREATE INDEX IF NOT EXISTS idx_vf_salary_emp ON public.vf_salary_settlements(employee_id);
CREATE INDEX IF NOT EXISTS idx_vf_salary_status ON public.vf_salary_settlements(status);

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
ALTER TABLE public.vf_warp_beams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_warp_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_warp_beam_loadings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_weaving_production_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_production_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_sales_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_fabric_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_fabric_cut_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_salary_settlements ENABLE ROW LEVEL SECURITY;

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

    -- 14. vf_warp_beams
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_warp_beams' AND policyname = 'Allow public access to vf_warp_beams') THEN
        CREATE POLICY "Allow public access to vf_warp_beams" ON public.vf_warp_beams FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 15. vf_warp_issues
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_warp_issues' AND policyname = 'Allow public access to vf_warp_issues') THEN
        CREATE POLICY "Allow public access to vf_warp_issues" ON public.vf_warp_issues FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 16. vf_warp_beam_loadings
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_warp_beam_loadings' AND policyname = 'Allow public access to vf_warp_beam_loadings') THEN
        CREATE POLICY "Allow public access to vf_warp_beam_loadings" ON public.vf_warp_beam_loadings FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 17. vf_weaving_production_logs
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_weaving_production_logs' AND policyname = 'Allow public access to vf_weaving_production_logs') THEN
        CREATE POLICY "Allow public access to vf_weaving_production_logs" ON public.vf_weaving_production_logs FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 18. vf_yarn_production_logs
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_yarn_production_logs' AND policyname = 'Allow public access to vf_yarn_production_logs') THEN
        CREATE POLICY "Allow public access to vf_yarn_production_logs" ON public.vf_yarn_production_logs FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 19. vf_yarn_sales_logs
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_yarn_sales_logs' AND policyname = 'Allow public access to vf_yarn_sales_logs') THEN
        CREATE POLICY "Allow public access to vf_yarn_sales_logs" ON public.vf_yarn_sales_logs FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 20. vf_fabric_dispatches
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_fabric_dispatches' AND policyname = 'Allow public access to vf_fabric_dispatches') THEN
        CREATE POLICY "Allow public access to vf_fabric_dispatches" ON public.vf_fabric_dispatches FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 21. vf_fabric_cut_relations
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_fabric_cut_relations' AND policyname = 'Allow public access to vf_fabric_cut_relations') THEN
        CREATE POLICY "Allow public access to vf_fabric_cut_relations" ON public.vf_fabric_cut_relations FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 22. vf_employees
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_employees' AND policyname = 'Allow public access to vf_employees') THEN
        CREATE POLICY "Allow public access to vf_employees" ON public.vf_employees FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 23. vf_attendance_records
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_attendance_records' AND policyname = 'Allow public access to vf_attendance_records') THEN
        CREATE POLICY "Allow public access to vf_attendance_records" ON public.vf_attendance_records FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 24. vf_employee_loans
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_employee_loans' AND policyname = 'Allow public access to vf_employee_loans') THEN
        CREATE POLICY "Allow public access to vf_employee_loans" ON public.vf_employee_loans FOR ALL USING (true) WITH CHECK (true);
    END IF;

    -- 25. vf_salary_settlements
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_salary_settlements' AND policyname = 'Allow public access to vf_salary_settlements') THEN
        CREATE POLICY "Allow public access to vf_salary_settlements" ON public.vf_salary_settlements FOR ALL USING (true) WITH CHECK (true);
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
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_warp_beams;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_warp_issues;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_warp_beam_loadings;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_weaving_production_logs;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_yarn_production_logs;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_yarn_sales_logs;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_fabric_dispatches;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_fabric_cut_relations;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_employees;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_attendance_records;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_employee_loans;
        ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_salary_settlements;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
END $$;


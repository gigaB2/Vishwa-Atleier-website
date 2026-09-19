-- ==============================================================================
-- Management Suite — Complete Master Production Supabase Schema & Security Matrix
-- Project: Vishwa Atelier Management Suite
-- Version: 2.1.0 (Unified Master Schema)
--
-- Instructions:
-- Run this SINGLE script in your Supabase Dashboard (SQL Editor) to provision
-- or update the entire database: all 33 tables, indexes, role helpers, RPCs,
-- safe views, storage bucket, realtime publication, and hardened Row Level Security (RLS).
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- SECTION 1: RELATIONAL & KV DATA TABLES (ALL 33 APPLICATION TABLES)
-- ==============================================================================

-- 1. Master Key-Value Synchronized Store (Core App Data)
CREATE TABLE IF NOT EXISTS public.vf_kv_store (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
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

-- 6. Dedicated Table: Costing Dependency Links
CREATE TABLE IF NOT EXISTS public.vf_costing_links (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    link_type TEXT DEFAULT 'costing',
    data JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_costing_links_source ON public.vf_costing_links(source_id);
CREATE INDEX IF NOT EXISTS idx_vf_costing_links_target ON public.vf_costing_links(target_id);
CREATE INDEX IF NOT EXISTS idx_vf_costing_links_updated_at ON public.vf_costing_links(updated_at DESC);

-- 7. Dedicated Table: Enterprise Audit Logs (Tracking modifications & security events)
CREATE TABLE IF NOT EXISTS public.vf_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT,
    user_email TEXT,
    role TEXT DEFAULT 'employee',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details JSONB,
    client_ip TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_audit_logs_created_at ON public.vf_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vf_audit_logs_entity ON public.vf_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_vf_audit_logs_user ON public.vf_audit_logs(user_email);

-- 8. Dedicated Relational Table: Yarn RM Inward Lots
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

-- 9. Dedicated Relational Table: Yarn RM Inventory Boxes
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

-- 10. Dedicated Relational Table: Yarn RM Transaction & Audit Ledger
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

-- 11. Dedicated Relational Table: Yarn RM Purchase Orders
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

-- 12. Dedicated Relational Table: Yarn RM Inward Batches (Challans per PO)
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

-- 13. Dedicated Relational Table: Yarn RM Order Boxes
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

-- 14. Dedicated Relational Table: Weft Yarn Issues (Loom Consumptions & Ledger)
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
    gross_weight NUMERIC(10, 3) DEFAULT 0,
    tare_weight NUMERIC(10, 3) DEFAULT 0,
    qty NUMERIC(10, 3) NOT NULL DEFAULT 0,
    config_type TEXT,
    ply TEXT,
    yarns JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.vf_yarn_production_logs ADD COLUMN IF NOT EXISTS gross_weight NUMERIC(10, 3) DEFAULT 0;
ALTER TABLE public.vf_yarn_production_logs ADD COLUMN IF NOT EXISTS tare_weight NUMERIC(10, 3) DEFAULT 0;
ALTER TABLE public.vf_yarn_production_logs ADD COLUMN IF NOT EXISTS config_type TEXT;
ALTER TABLE public.vf_yarn_production_logs ADD COLUMN IF NOT EXISTS ply TEXT;
ALTER TABLE public.vf_yarn_production_logs ADD COLUMN IF NOT EXISTS yarns JSONB DEFAULT '[]'::jsonb;

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
    total_gross_weight NUMERIC(10, 3) DEFAULT 0,
    total_tare_weight NUMERIC(10, 3) DEFAULT 0,
    total_qty NUMERIC(10, 3) DEFAULT 0,
    total_amount NUMERIC(12, 2) DEFAULT 0,
    gst_amount NUMERIC(12, 2) DEFAULT 0,
    raw_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS total_gross_weight NUMERIC(10, 3) DEFAULT 0;
ALTER TABLE public.vf_yarn_sales_logs ADD COLUMN IF NOT EXISTS total_tare_weight NUMERIC(10, 3) DEFAULT 0;
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
    salary_amount NUMERIC(10, 2) DEFAULT 0,
    phone TEXT,
    email TEXT,
    joining_date DATE,
    join_date TIMESTAMPTZ,
    termination_date DATE,
    rejoin_date DATE,
    assigned_machines JSONB DEFAULT '[]'::jsonb,
    avatar_gradient TEXT,
    avatar_color TEXT,
    id_front TEXT,
    id_back TEXT,
    status TEXT DEFAULT 'Active',
    active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.vf_employees ADD COLUMN IF NOT EXISTS id_front TEXT;
ALTER TABLE public.vf_employees ADD COLUMN IF NOT EXISTS id_back TEXT;
ALTER TABLE public.vf_employees ADD COLUMN IF NOT EXISTS salary_amount NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.vf_employees ADD COLUMN IF NOT EXISTS join_date TIMESTAMPTZ;
ALTER TABLE public.vf_employees ADD COLUMN IF NOT EXISTS termination_date DATE;
ALTER TABLE public.vf_employees ADD COLUMN IF NOT EXISTS rejoin_date DATE;
ALTER TABLE public.vf_employees ADD COLUMN IF NOT EXISTS avatar_color TEXT;
ALTER TABLE public.vf_employees ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Active';

CREATE INDEX IF NOT EXISTS idx_vf_emp_name ON public.vf_employees(name);
CREATE INDEX IF NOT EXISTS idx_vf_emp_role ON public.vf_employees(role);
CREATE INDEX IF NOT EXISTS idx_vf_emp_status ON public.vf_employees(status);
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
ALTER TABLE public.vf_attendance_records ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Present';
ALTER TABLE public.vf_attendance_records ADD COLUMN IF NOT EXISTS shift TEXT DEFAULT 'Day';
ALTER TABLE public.vf_attendance_records ADD COLUMN IF NOT EXISTS hours NUMERIC(5, 2) DEFAULT 0;
ALTER TABLE public.vf_attendance_records ADD COLUMN IF NOT EXISTS overtime_hours NUMERIC(5, 2) DEFAULT 0;
ALTER TABLE public.vf_attendance_records ADD COLUMN IF NOT EXISTS meters NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.vf_attendance_records ADD COLUMN IF NOT EXISTS rate NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.vf_attendance_records ADD COLUMN IF NOT EXISTS total_earned NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.vf_attendance_records ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.vf_attendance_records ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

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

-- 27. Dedicated Relational Table: Raw Material Qualities (Catalogue)
CREATE TABLE IF NOT EXISTS public.vf_rm_qualities (
    id TEXT PRIMARY KEY,
    quality TEXT NOT NULL,
    code TEXT NOT NULL,
    color TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Polyester',
    supplier TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_rm_qualities_name ON public.vf_rm_qualities(quality);
CREATE INDEX IF NOT EXISTS idx_vf_rm_qualities_type ON public.vf_rm_qualities(type);
CREATE INDEX IF NOT EXISTS idx_vf_rm_qualities_supplier ON public.vf_rm_qualities(supplier);
CREATE INDEX IF NOT EXISTS idx_vf_rm_qualities_updated_at ON public.vf_rm_qualities(updated_at DESC);

-- 28. Dedicated Relational Table: Finished Product Qualities (Catalogue)
CREATE TABLE IF NOT EXISTS public.vf_fp_qualities (
    id TEXT PRIMARY KEY,
    division TEXT NOT NULL DEFAULT 'covering',
    name TEXT NOT NULL,
    composition TEXT,
    yarns JSONB DEFAULT '[]'::jsonb,
    denier NUMERIC(10, 2),
    tpm INTEGER,
    twist TEXT,
    color TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_fp_qualities_div ON public.vf_fp_qualities(division);
CREATE INDEX IF NOT EXISTS idx_vf_fp_qualities_name ON public.vf_fp_qualities(name);
CREATE INDEX IF NOT EXISTS idx_vf_fp_qualities_updated_at ON public.vf_fp_qualities(updated_at DESC);

-- 29. Dedicated Relational Table: Raw Material Suppliers (Catalogue)
CREATE TABLE IF NOT EXISTS public.vf_rm_suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    phone TEXT,
    email TEXT,
    address TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_rm_suppliers_name ON public.vf_rm_suppliers(name);
CREATE INDEX IF NOT EXISTS idx_vf_rm_suppliers_updated_at ON public.vf_rm_suppliers(updated_at DESC);

-- 30. Dedicated Relational Table: Fabric Jacquard Designs (Design Library)
CREATE TABLE IF NOT EXISTS public.vf_fabric_designs (
    id TEXT PRIMARY KEY,
    design_name TEXT NOT NULL,
    design_number TEXT,
    quality TEXT,
    image_url TEXT,
    ep_file_url TEXT,
    picks INTEGER DEFAULT 0,
    repeats INTEGER DEFAULT 1,
    total_hooks INTEGER DEFAULT 0,
    width NUMERIC(10, 2),
    avg_weight NUMERIC(10, 3),
    costing_id TEXT,
    deleted BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_designs_name ON public.vf_fabric_designs(design_name);
CREATE INDEX IF NOT EXISTS idx_vf_designs_quality ON public.vf_fabric_designs(quality);
CREATE INDEX IF NOT EXISTS idx_vf_designs_deleted ON public.vf_fabric_designs(deleted);
CREATE INDEX IF NOT EXISTS idx_vf_designs_updated_at ON public.vf_fabric_designs(updated_at DESC);

-- 31. Dedicated Relational Table: Machinery Assets (Looms, Jacquards, Fanis, Jalas)
CREATE TABLE IF NOT EXISTS public.vf_machinery_assets (
    id TEXT PRIMARY KEY,
    asset_type TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT,
    model TEXT,
    status TEXT DEFAULT 'Active',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_machinery_type ON public.vf_machinery_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_vf_machinery_name ON public.vf_machinery_assets(name);
CREATE INDEX IF NOT EXISTS idx_vf_machinery_status ON public.vf_machinery_assets(status);

-- 32. Dedicated Relational Table: Companies & Billing Entities
CREATE TABLE IF NOT EXISTS public.vf_companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gstin TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    bank_details JSONB DEFAULT '{}'::jsonb,
    is_default BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_companies_name ON public.vf_companies(name);

-- 33. Dedicated Relational Table: Admin & Employee Authentication Registry
CREATE TABLE IF NOT EXISTS public.vf_auth_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
    pass_hash TEXT,
    permissions JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vf_auth_users_email ON public.vf_auth_users(lower(email));
CREATE INDEX IF NOT EXISTS idx_vf_auth_users_role ON public.vf_auth_users(role);
CREATE INDEX IF NOT EXISTS idx_vf_auth_users_updated_at ON public.vf_auth_users(updated_at DESC);

-- ==============================================================================
-- SECTION 2: SAFE USER PROFILES VIEW (EXCLUDING PASSWORD HASHES)
-- ==============================================================================
CREATE OR REPLACE VIEW public.vf_auth_user_profiles
WITH (security_invoker = true) AS
SELECT 
    id,
    email,
    name,
    role,
    permissions,
    is_active,
    metadata,
    created_at,
    updated_at
FROM public.vf_auth_users;

-- ==============================================================================
-- SECTION 3: SERVER-SIDE ROLE RESOLUTION & SECURITY DEFINER HELPERS
-- ==============================================================================

-- Resolves the caller's role from JWT claims with non-recursive fallback to vf_auth_users
CREATE OR REPLACE FUNCTION public.vf_current_user_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_uid UUID;
BEGIN
    -- 1. Check Service Role (unrestricted administrative backend)
    IF auth.role() = 'service_role' THEN
        RETURN 'admin';
    END IF;

    -- 2. Extract from JWT app_metadata (tamper-proof server-signed claims)
    v_role := auth.jwt() -> 'app_metadata' ->> 'role';
    IF v_role IS NOT NULL AND v_role <> '' THEN
        RETURN lower(v_role);
    END IF;

    -- 3. Fallback lookup in public.vf_auth_users table
    v_uid := auth.uid();
    IF v_uid IS NOT NULL THEN
        SELECT role INTO v_role
        FROM public.vf_auth_users
        WHERE id = v_uid::text OR lower(email) = lower(auth.jwt() ->> 'email')
        LIMIT 1;

        IF v_role IS NOT NULL THEN
            RETURN lower(v_role);
        END IF;
    ELSIF auth.jwt() ->> 'email' IS NOT NULL THEN
        SELECT role INTO v_role
        FROM public.vf_auth_users
        WHERE lower(email) = lower(auth.jwt() ->> 'email')
        LIMIT 1;

        IF v_role IS NOT NULL THEN
            RETURN lower(v_role);
        END IF;
    END IF;

    -- Default fallback for any authenticated user without explicit role
    IF auth.role() = 'authenticated' THEN
        RETURN 'operator';
    END IF;

    RETURN 'anon';
END;
$$;

-- Boolean helper: Is caller Administrator?
CREATE OR REPLACE FUNCTION public.vf_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT (
        auth.role() = 'service_role'
        OR public.vf_current_user_role() = 'admin'
    );
$$;

-- Boolean helper: Is caller Operator or above?
CREATE OR REPLACE FUNCTION public.vf_is_operator_or_above()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT (
        auth.role() = 'service_role'
        OR public.vf_current_user_role() IN ('admin', 'operator', 'editor')
    );
$$;

-- Boolean helper: Is caller authorized for Payroll & Salary?
CREATE OR REPLACE FUNCTION public.vf_is_payroll_authorized()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT (
        auth.role() = 'service_role'
        OR public.vf_current_user_role() IN ('admin', 'payroll_admin', 'hr')
    );
$$;

-- ==============================================================================
-- SECTION 4: SERVER-SIDE ATOMIC RPC FUNCTIONS
-- ==============================================================================

-- 1. Atomic Box Issue Transaction
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
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_updated_count INT := 0;
    v_box_rec RECORD;
BEGIN
    -- Authorization guard
    IF NOT (auth.role() = 'service_role' OR public.vf_is_operator_or_above()) THEN
        RAISE EXCEPTION 'Unauthorized: Caller does not possess operator permissions';
    END IF;

    IF p_box_ids IS NULL OR array_length(p_box_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No box IDs provided');
    END IF;

    -- Verify availability of selected boxes
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

        -- Insert transaction ledger row
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

    -- Atomically update box status
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

-- 2. Atomic Weft Issues Recorder
CREATE OR REPLACE FUNCTION public.vf_record_weft_issues(
    p_issues JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    issue_record JSONB;
    inserted_count INT := 0;
BEGIN
    -- Authorization guard
    IF NOT (auth.role() = 'service_role' OR public.vf_is_operator_or_above()) THEN
        RAISE EXCEPTION 'Unauthorized: Caller does not possess operator permissions';
    END IF;

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

-- 3. Universal Batch Deletion RPC
CREATE OR REPLACE FUNCTION public.vf_bulk_delete_entities(
    p_table TEXT,
    p_ids TEXT[],
    p_id_column TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_deleted_count INT := 0;
    v_sql TEXT;
    v_col TEXT;
BEGIN
    -- Authorization guard: Admin only
    IF NOT (auth.role() = 'service_role' OR public.vf_is_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: vf_bulk_delete_entities requires administrator privileges';
    END IF;

    IF p_table IS NULL OR p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'deleted_count', 0, 'error', 'Invalid arguments');
    END IF;

    -- Whitelist valid table names for security
    IF p_table NOT IN (
        'vf_kv_store', 'vf_costing_products', 'vf_costing_tfo_products', 'vf_costing_doubler_products',
        'vf_costing_covering_products', 'vf_costing_links', 'vf_yarn_rm_lots', 'vf_yarn_rm_boxes', 'vf_yarn_orders',
        'vf_yarn_order_batches', 'vf_yarn_order_boxes', 'vf_weft_issues', 'vf_warp_beams',
        'vf_warp_issues', 'vf_warp_beam_loadings', 'vf_weaving_production_logs', 'vf_yarn_production_logs',
        'vf_yarn_sales_logs', 'vf_fabric_dispatches', 'vf_fabric_cut_relations', 'vf_employees',
        'vf_attendance_records', 'vf_employee_loans', 'vf_salary_settlements', 'vf_rm_qualities',
        'vf_fp_qualities', 'vf_rm_suppliers', 'vf_fabric_designs', 'vf_machinery_assets', 'vf_companies'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Table not permitted for bulk deletion');
    END IF;

    IF p_id_column IS NULL OR p_id_column = '' OR p_id_column = 'id' THEN
        IF p_table = 'vf_kv_store' THEN
            v_col := 'key';
        ELSIF p_table = 'vf_fabric_dispatches' THEN
            v_col := 'taka_serial';
        ELSE
            v_col := 'id';
        END IF;
    ELSE
        v_col := p_id_column;
    END IF;

    v_sql := format('DELETE FROM public.%I WHERE %I = ANY($1)', p_table, v_col);
    EXECUTE v_sql USING p_ids;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object('success', true, 'deleted_count', v_deleted_count);
END;
$$;

-- 4. Public Health Check RPC
CREATE OR REPLACE FUNCTION public.vf_ping()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN jsonb_build_object(
        'status', 'healthy',
        'timestamp', timezone('utc'::text, now()),
        'version', '2.1.0',
        'server_time', now()
    );
END;
$$;

-- ==============================================================================
-- SECTION 5: AUTOMATIC AUTH USER SYNC TRIGGER
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_auth_user_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_role TEXT;
    user_name TEXT;
    user_perms JSONB;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        DELETE FROM public.vf_auth_users WHERE email = LOWER(OLD.email) OR id = OLD.id::text;
        RETURN OLD;
    END IF;

    user_role := COALESCE(NEW.raw_user_meta_data->>'role', 'employee');
    IF user_role NOT IN ('admin', 'employee') THEN
        user_role := 'employee';
    END IF;

    user_name := COALESCE(
        NEW.raw_user_meta_data->>'name',
        NEW.raw_user_meta_data->>'full_name',
        split_part(NEW.email, '@', 1)
    );

    user_perms := COALESCE(
        NEW.raw_user_meta_data->'permissions',
        CASE WHEN user_role = 'admin' THEN '"*"'::jsonb ELSE '{}'::jsonb END
    );

    INSERT INTO public.vf_auth_users (
        id,
        email,
        name,
        role,
        pass_hash,
        permissions,
        is_active,
        metadata,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id::text,
        LOWER(NEW.email),
        user_name,
        user_role,
        NULL,
        user_perms,
        true,
        COALESCE(NEW.raw_user_meta_data, '{}'::jsonb),
        COALESCE(NEW.created_at, timezone('utc'::text, now())),
        timezone('utc'::text, now())
    )
    ON CONFLICT (email) DO UPDATE SET
        id = EXCLUDED.id,
        name = COALESCE(EXCLUDED.name, public.vf_auth_users.name),
        role = COALESCE(EXCLUDED.role, public.vf_auth_users.role),
        permissions = CASE 
            WHEN EXCLUDED.permissions IS NOT NULL AND EXCLUDED.permissions <> '{}'::jsonb 
            THEN EXCLUDED.permissions 
            ELSE public.vf_auth_users.permissions 
        END,
        is_active = true,
        metadata = COALESCE(EXCLUDED.metadata, public.vf_auth_users.metadata),
        updated_at = timezone('utc'::text, now());

    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
        DROP TRIGGER IF EXISTS on_auth_user_change ON auth.users;
        CREATE TRIGGER on_auth_user_change
            AFTER INSERT OR UPDATE OR DELETE ON auth.users
            FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_change();
    END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ==============================================================================
-- SECTION 6: STORAGE BUCKET PROVISIONING & POLICIES (vf_media_assets)
-- ==============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('vf_media_assets', 'vf_media_assets', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
        -- Drop legacy permissive policy
        DROP POLICY IF EXISTS "Allow public access to vf_media_assets" ON storage.objects;

        -- Drop existing hardened policies to allow clean idempotent re-creation
        DROP POLICY IF EXISTS "vf_media_assets_public_read" ON storage.objects;
        DROP POLICY IF EXISTS "vf_media_assets_auth_read" ON storage.objects;
        DROP POLICY IF EXISTS "vf_media_assets_operator_insert" ON storage.objects;
        DROP POLICY IF EXISTS "vf_media_assets_operator_update" ON storage.objects;
        DROP POLICY IF EXISTS "vf_media_assets_admin_delete" ON storage.objects;

        -- 1. Public read for thumbnails and public cards
        CREATE POLICY "vf_media_assets_public_read" ON storage.objects
        FOR SELECT TO anon
        USING (
            bucket_id = 'vf_media_assets'
            AND (name LIKE 'public/%' OR name LIKE 'thumbnails/%')
        );

        -- 2. Authenticated read for all assets
        CREATE POLICY "vf_media_assets_auth_read" ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'vf_media_assets');

        -- 3. Insert: Operator and above
        CREATE POLICY "vf_media_assets_operator_insert" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
            bucket_id = 'vf_media_assets'
            AND public.vf_is_operator_or_above()
        );

        -- 4. Update: Operator and above
        CREATE POLICY "vf_media_assets_operator_update" ON storage.objects
        FOR UPDATE TO authenticated
        USING (
            bucket_id = 'vf_media_assets'
            AND public.vf_is_operator_or_above()
        )
        WITH CHECK (
            bucket_id = 'vf_media_assets'
            AND public.vf_is_operator_or_above()
        );

        -- 5. Delete: Admin only
        CREATE POLICY "vf_media_assets_admin_delete" ON storage.objects
        FOR DELETE TO authenticated
        USING (
            bucket_id = 'vf_media_assets'
            AND public.vf_is_admin()
        );
    END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ==============================================================================
-- SECTION 7: REALTIME PUBLICATION CONFIGURATION
-- ==============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        -- Exclude heavy high-frequency log tables to prevent WAL bottlenecks
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_yarn_rm_boxes; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_yarn_order_boxes; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_yarn_rm_transactions; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_weaving_production_logs; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_yarn_production_logs; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_yarn_sales_logs; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_attendance_records; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_audit_logs; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_weft_issues; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_warp_issues; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_warp_beam_loadings; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_fabric_dispatches; EXCEPTION WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.vf_fabric_cut_relations; EXCEPTION WHEN others THEN NULL; END;

        -- Include low-frequency state and directory tables
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_kv_store; EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_fabric_designs; EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.vf_auth_users; EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
    END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ==============================================================================
-- SECTION 8: ROW LEVEL SECURITY HARDENING & POLICIES (ALL 33 TABLES)
-- ==============================================================================

-- Drop all legacy permissive policies explicitly
DROP POLICY IF EXISTS "Allow public access to vf_kv_store" ON public.vf_kv_store;
DROP POLICY IF EXISTS "Allow public access to vf_costing_products" ON public.vf_costing_products;
DROP POLICY IF EXISTS "Allow public access to vf_costing_tfo_products" ON public.vf_costing_tfo_products;
DROP POLICY IF EXISTS "Allow public access to vf_costing_doubler_products" ON public.vf_costing_doubler_products;
DROP POLICY IF EXISTS "Allow public access to vf_costing_covering_products" ON public.vf_costing_covering_products;
DROP POLICY IF EXISTS "Allow public access to vf_costing_links" ON public.vf_costing_links;
DROP POLICY IF EXISTS "Allow public access to vf_audit_logs" ON public.vf_audit_logs;
DROP POLICY IF EXISTS "Allow public access to vf_yarn_rm_lots" ON public.vf_yarn_rm_lots;
DROP POLICY IF EXISTS "Allow public access to vf_yarn_rm_boxes" ON public.vf_yarn_rm_boxes;
DROP POLICY IF EXISTS "Allow public access to vf_yarn_rm_transactions" ON public.vf_yarn_rm_transactions;
DROP POLICY IF EXISTS "Allow public access to vf_yarn_orders" ON public.vf_yarn_orders;
DROP POLICY IF EXISTS "Allow public access to vf_yarn_order_batches" ON public.vf_yarn_order_batches;
DROP POLICY IF EXISTS "Allow public access to vf_yarn_order_boxes" ON public.vf_yarn_order_boxes;
DROP POLICY IF EXISTS "Allow public access to vf_weft_issues" ON public.vf_weft_issues;
DROP POLICY IF EXISTS "Allow public access to vf_warp_beams" ON public.vf_warp_beams;
DROP POLICY IF EXISTS "Allow public access to vf_warp_issues" ON public.vf_warp_issues;
DROP POLICY IF EXISTS "Allow public access to vf_warp_beam_loadings" ON public.vf_warp_beam_loadings;
DROP POLICY IF EXISTS "Allow public access to vf_weaving_production_logs" ON public.vf_weaving_production_logs;
DROP POLICY IF EXISTS "Allow public access to vf_yarn_production_logs" ON public.vf_yarn_production_logs;
DROP POLICY IF EXISTS "Allow public access to vf_yarn_sales_logs" ON public.vf_yarn_sales_logs;
DROP POLICY IF EXISTS "Allow public access to vf_fabric_dispatches" ON public.vf_fabric_dispatches;
DROP POLICY IF EXISTS "Allow public access to vf_fabric_cut_relations" ON public.vf_fabric_cut_relations;
DROP POLICY IF EXISTS "Allow public access to vf_employees" ON public.vf_employees;
DROP POLICY IF EXISTS "Allow public access to vf_attendance_records" ON public.vf_attendance_records;
DROP POLICY IF EXISTS "Allow public access to vf_employee_loans" ON public.vf_employee_loans;
DROP POLICY IF EXISTS "Allow public access to vf_salary_settlements" ON public.vf_salary_settlements;
DROP POLICY IF EXISTS "Allow public access to vf_rm_qualities" ON public.vf_rm_qualities;
DROP POLICY IF EXISTS "Allow public access to vf_fp_qualities" ON public.vf_fp_qualities;
DROP POLICY IF EXISTS "Allow public access to vf_rm_suppliers" ON public.vf_rm_suppliers;
DROP POLICY IF EXISTS "Allow public access to vf_fabric_designs" ON public.vf_fabric_designs;
DROP POLICY IF EXISTS "Allow public access to vf_machinery_assets" ON public.vf_machinery_assets;
DROP POLICY IF EXISTS "Allow public access to vf_companies" ON public.vf_companies;
DROP POLICY IF EXISTS "Allow public access to vf_auth_users" ON public.vf_auth_users;

-- Enable & Force RLS across all 33 tables
ALTER TABLE public.vf_kv_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_kv_store FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_costing_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_products FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_costing_tfo_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_tfo_products FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_costing_doubler_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_doubler_products FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_costing_covering_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_covering_products FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_costing_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_links FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_audit_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_yarn_rm_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_rm_lots FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_yarn_rm_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_rm_boxes FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_yarn_rm_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_rm_transactions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_yarn_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_orders FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_yarn_order_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_order_batches FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_yarn_order_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_order_boxes FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_weft_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_weft_issues FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_warp_beams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_warp_beams FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_warp_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_warp_issues FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_warp_beam_loadings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_warp_beam_loadings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_weaving_production_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_weaving_production_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_yarn_production_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_production_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_yarn_sales_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_yarn_sales_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_fabric_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_fabric_dispatches FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_fabric_cut_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_fabric_cut_relations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_employees FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_attendance_records FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_employee_loans FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_salary_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_salary_settlements FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_rm_qualities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_rm_qualities FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_fp_qualities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_fp_qualities FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_rm_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_rm_suppliers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_fabric_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_fabric_designs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_machinery_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_machinery_assets FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_companies FORCE ROW LEVEL SECURITY;

ALTER TABLE public.vf_auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_auth_users FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- A. Operational Tables Policies (25 Tables)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
    operational_tables TEXT[] := ARRAY[
        'vf_costing_products',
        'vf_costing_tfo_products',
        'vf_costing_doubler_products',
        'vf_costing_covering_products',
        'vf_costing_links',
        'vf_yarn_rm_lots',
        'vf_yarn_rm_boxes',
        'vf_yarn_rm_transactions',
        'vf_yarn_orders',
        'vf_yarn_order_batches',
        'vf_yarn_order_boxes',
        'vf_weft_issues',
        'vf_warp_beams',
        'vf_warp_issues',
        'vf_warp_beam_loadings',
        'vf_weaving_production_logs',
        'vf_yarn_production_logs',
        'vf_yarn_sales_logs',
        'vf_fabric_dispatches',
        'vf_fabric_cut_relations',
        'vf_rm_qualities',
        'vf_fp_qualities',
        'vf_rm_suppliers',
        'vf_fabric_designs',
        'vf_machinery_assets'
    ];
BEGIN
    FOREACH t IN ARRAY operational_tables
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "%s_select_auth" ON public.%I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "%s_insert_operator" ON public.%I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "%s_update_operator" ON public.%I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "%s_delete_admin" ON public.%I;', t, t);

        EXECUTE format('
            CREATE POLICY "%s_select_auth" ON public.%I
            FOR SELECT TO authenticated
            USING (true);
        ', t, t);

        EXECUTE format('
            CREATE POLICY "%s_insert_operator" ON public.%I
            FOR INSERT TO authenticated
            WITH CHECK (public.vf_is_operator_or_above());
        ', t, t);

        EXECUTE format('
            CREATE POLICY "%s_update_operator" ON public.%I
            FOR UPDATE TO authenticated
            USING (public.vf_is_operator_or_above())
            WITH CHECK (public.vf_is_operator_or_above());
        ', t, t);

        EXECUTE format('
            CREATE POLICY "%s_delete_admin" ON public.%I
            FOR DELETE TO authenticated
            USING (public.vf_is_admin());
        ', t, t);
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- B. HR & Payroll Tables Policies (4 Tables)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
    hr_tables TEXT[] := ARRAY[
        'vf_employees',
        'vf_attendance_records',
        'vf_employee_loans',
        'vf_salary_settlements'
    ];
BEGIN
    FOREACH t IN ARRAY hr_tables
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "%s_select_payroll" ON public.%I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "%s_insert_payroll" ON public.%I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "%s_update_payroll" ON public.%I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "%s_delete_admin" ON public.%I;', t, t);

        EXECUTE format('
            CREATE POLICY "%s_select_payroll" ON public.%I
            FOR SELECT TO authenticated
            USING (public.vf_is_payroll_authorized());
        ', t, t);

        EXECUTE format('
            CREATE POLICY "%s_insert_payroll" ON public.%I
            FOR INSERT TO authenticated
            WITH CHECK (public.vf_is_payroll_authorized());
        ', t, t);

        EXECUTE format('
            CREATE POLICY "%s_update_payroll" ON public.%I
            FOR UPDATE TO authenticated
            USING (public.vf_is_payroll_authorized())
            WITH CHECK (public.vf_is_payroll_authorized());
        ', t, t);

        EXECUTE format('
            CREATE POLICY "%s_delete_admin" ON public.%I
            FOR DELETE TO authenticated
            USING (public.vf_is_admin());
        ', t, t);
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- C. Company Settings Table Policies (vf_companies)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "vf_companies_select_auth" ON public.vf_companies;
DROP POLICY IF EXISTS "vf_companies_insert_admin" ON public.vf_companies;
DROP POLICY IF EXISTS "vf_companies_update_admin" ON public.vf_companies;
DROP POLICY IF EXISTS "vf_companies_delete_admin" ON public.vf_companies;

CREATE POLICY "vf_companies_select_auth" ON public.vf_companies
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "vf_companies_insert_admin" ON public.vf_companies
FOR INSERT TO authenticated
WITH CHECK (public.vf_is_admin());

CREATE POLICY "vf_companies_update_admin" ON public.vf_companies
FOR UPDATE TO authenticated
USING (public.vf_is_admin())
WITH CHECK (public.vf_is_admin());

CREATE POLICY "vf_companies_delete_admin" ON public.vf_companies
FOR DELETE TO authenticated
USING (public.vf_is_admin());

-- ------------------------------------------------------------------------------
-- D. Key-Value Store Policies (vf_kv_store)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "vf_kv_store_select_auth" ON public.vf_kv_store;
DROP POLICY IF EXISTS "vf_kv_store_insert_operator" ON public.vf_kv_store;
DROP POLICY IF EXISTS "vf_kv_store_update_operator" ON public.vf_kv_store;
DROP POLICY IF EXISTS "vf_kv_store_delete_admin" ON public.vf_kv_store;

CREATE POLICY "vf_kv_store_select_auth" ON public.vf_kv_store
FOR SELECT TO authenticated
USING (
    CASE 
        WHEN key IN ('gemini_api_key', 'vf_master_credentials', 'vf_backup_manifest', 'vf_cloud_credentials')
        THEN public.vf_is_admin()
        ELSE true
    END
);

CREATE POLICY "vf_kv_store_insert_operator" ON public.vf_kv_store
FOR INSERT TO authenticated
WITH CHECK (
    CASE 
        WHEN key IN ('gemini_api_key', 'vf_master_credentials', 'vf_backup_manifest', 'vf_cloud_credentials')
        THEN public.vf_is_admin()
        ELSE public.vf_is_operator_or_above()
    END
);

CREATE POLICY "vf_kv_store_update_operator" ON public.vf_kv_store
FOR UPDATE TO authenticated
USING (
    CASE 
        WHEN key IN ('gemini_api_key', 'vf_master_credentials', 'vf_backup_manifest', 'vf_cloud_credentials')
        THEN public.vf_is_admin()
        ELSE public.vf_is_operator_or_above()
    END
)
WITH CHECK (
    CASE 
        WHEN key IN ('gemini_api_key', 'vf_master_credentials', 'vf_backup_manifest', 'vf_cloud_credentials')
        THEN public.vf_is_admin()
        ELSE public.vf_is_operator_or_above()
    END
);

CREATE POLICY "vf_kv_store_delete_admin" ON public.vf_kv_store
FOR DELETE TO authenticated
USING (public.vf_is_admin());

-- ------------------------------------------------------------------------------
-- E. Enterprise Audit Logs Policies (vf_audit_logs)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "vf_audit_logs_select_admin" ON public.vf_audit_logs;
DROP POLICY IF EXISTS "vf_audit_logs_insert_auth" ON public.vf_audit_logs;

CREATE POLICY "vf_audit_logs_select_admin" ON public.vf_audit_logs
FOR SELECT TO authenticated
USING (public.vf_is_admin());

CREATE POLICY "vf_audit_logs_insert_auth" ON public.vf_audit_logs
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- ------------------------------------------------------------------------------
-- F. Authentication Registry Policies (vf_auth_users — Non-Recursive Claims)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "vf_auth_users_select_self_or_admin" ON public.vf_auth_users;
DROP POLICY IF EXISTS "vf_auth_users_insert_admin" ON public.vf_auth_users;
DROP POLICY IF EXISTS "vf_auth_users_update_admin" ON public.vf_auth_users;
DROP POLICY IF EXISTS "vf_auth_users_delete_admin" ON public.vf_auth_users;

CREATE POLICY "vf_auth_users_select_self_or_admin" ON public.vf_auth_users
FOR SELECT TO authenticated
USING (
    auth.role() = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    OR auth.uid()::text = id
    OR lower(email) = lower(auth.jwt() ->> 'email')
);

CREATE POLICY "vf_auth_users_insert_admin" ON public.vf_auth_users
FOR INSERT TO authenticated
WITH CHECK (
    auth.role() = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

CREATE POLICY "vf_auth_users_update_admin" ON public.vf_auth_users
FOR UPDATE TO authenticated
USING (
    auth.role() = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
)
WITH CHECK (
    auth.role() = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

CREATE POLICY "vf_auth_users_delete_admin" ON public.vf_auth_users
FOR DELETE TO authenticated
USING (
    auth.role() = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

-- ==============================================================================
-- SECTION 9: ROLE PRIVILEGES & SECURITY GRANTS
-- ==============================================================================

-- Grant schema usage to API roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Grant table & sequence privileges to API roles (access is strictly governed by RLS)
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- Ensure future tables and functions inherit permissions automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- Explicitly allow public health check
GRANT EXECUTE ON FUNCTION public.vf_ping() TO anon, authenticated;

-- Allow authenticated execution of safe helpers and procedures
GRANT EXECUTE ON FUNCTION public.vf_current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vf_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vf_is_operator_or_above() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vf_is_payroll_authorized() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vf_issue_yarn_boxes(TEXT[], TEXT, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vf_record_weft_issues(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vf_bulk_delete_entities(TEXT, TEXT[], TEXT) TO authenticated;

-- Grant safe profile view access to authenticated users
GRANT SELECT ON public.vf_auth_user_profiles TO authenticated;

COMMIT;

-- ==============================================================================
-- Migration: 001_harden_rls_and_access_control.sql
-- Project: Vishwa Atelier Management Suite
-- Phase: Phase 4 — RLS, Grants, RPCs, and Storage Hardening
-- Date: 2026-09-19
-- 
-- IMPORTANT:
-- This migration hardens the database by:
-- 1. Dropping all 33 legacy permissive "Allow public access to vf_*" policies.
-- 2. Enabling and forcing Row Level Security (RLS) on all 33 application tables.
-- 3. Implementing authoritative server-side role resolution helper functions.
-- 4. Enforcing the approved 5-tier access control matrix (Anon, Viewer, Operator, Payroll Admin, Admin).
-- 5. Hardening RPC functions with search_path pinning and role validation.
-- 6. Creating a safe user profile view (vf_auth_user_profiles) hiding pass_hash.
-- 7. Securing storage bucket vf_media_assets.
-- 8. Revoking unnecessary privileges from 'anon'.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. DROP ALL LEGACY PERMISSIVE POLICIES
-- ==============================================================================
-- In PostgreSQL, multiple permissive policies combine with boolean OR.
-- Explicitly dropping legacy public policies ensures security cannot be bypassed.

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

-- Storage permissive policy
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
        DROP POLICY IF EXISTS "Allow public access to vf_media_assets" ON storage.objects;
    END IF;
END $$;

-- ==============================================================================
-- 2. ENABLE AND FORCE ROW LEVEL SECURITY ON ALL 33 TABLES
-- ==============================================================================

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

-- ==============================================================================
-- 3. SERVER-SIDE ROLE RESOLUTION HELPER FUNCTIONS
-- ==============================================================================

-- Resolves the authenticated user's role from JWT claims with fallback to vf_auth_users
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

    -- 3. Extract from JWT user_metadata
    v_role := auth.jwt() -> 'user_metadata' ->> 'role';
    IF v_role IS NOT NULL AND v_role <> '' THEN
        RETURN lower(v_role);
    END IF;

    -- 4. Fallback lookup in public.vf_auth_users table
    v_uid := auth.uid();
    IF v_uid IS NOT NULL THEN
        SELECT role INTO v_role
        FROM public.vf_auth_users
        WHERE id = v_uid::text OR lower(email) = lower(auth.jwt() ->> 'email')
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

-- Boolean helper: Is current caller an Administrator?
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

-- Boolean helper: Is current caller an Operator or above?
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

-- Boolean helper: Is current caller authorized for Payroll & Salary?
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
-- 4. OPERATIONAL TABLES POLICIES (25 Tables)
-- ==============================================================================
-- Rules:
-- SELECT: Authenticated users (Viewer, Operator, Payroll Admin, Admin). Anon denied.
-- INSERT, UPDATE: Operator, Editor, Admin. Viewer denied.
-- DELETE: Admin only.

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
        -- SELECT policy
        EXECUTE format('
            CREATE POLICY "%s_select_auth" ON public.%I
            FOR SELECT TO authenticated
            USING (true);
        ', t, t);

        -- INSERT policy
        EXECUTE format('
            CREATE POLICY "%s_insert_operator" ON public.%I
            FOR INSERT TO authenticated
            WITH CHECK (public.vf_is_operator_or_above());
        ', t, t);

        -- UPDATE policy
        EXECUTE format('
            CREATE POLICY "%s_update_operator" ON public.%I
            FOR UPDATE TO authenticated
            USING (public.vf_is_operator_or_above())
            WITH CHECK (public.vf_is_operator_or_above());
        ', t, t);

        -- DELETE policy
        EXECUTE format('
            CREATE POLICY "%s_delete_admin" ON public.%I
            FOR DELETE TO authenticated
            USING (public.vf_is_admin());
        ', t, t);
    END LOOP;
END $$;

-- ==============================================================================
-- 5. HR & PAYROLL TABLES POLICIES (4 Tables)
-- ==============================================================================
-- Tables: vf_employees, vf_attendance_records, vf_employee_loans, vf_salary_settlements
-- Rules:
-- SELECT: Payroll authorized only (Admin, Payroll Admin, HR). Operators/Viewers denied.
-- INSERT, UPDATE: Payroll authorized only.
-- DELETE: Admin only.

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

-- ==============================================================================
-- 6. COMPANY SETTINGS TABLE POLICIES (vf_companies)
-- ==============================================================================
-- Rules:
-- SELECT: Authenticated users can view company profile details.
-- INSERT, UPDATE, DELETE: Admin only.

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

-- ==============================================================================
-- 7. KEY-VALUE STORE POLICIES (vf_kv_store)
-- ==============================================================================
-- Rules:
-- Sensitive keys ('gemini_api_key', 'vf_master_credentials', 'vf_backup_manifest', 'vf_cloud_credentials'): Admin only.
-- Operational keys: Authenticated SELECT; Operator INSERT/UPDATE; Admin DELETE.

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

-- ==============================================================================
-- 8. ENTERPRISE AUDIT LOGS POLICIES (vf_audit_logs)
-- ==============================================================================
-- Rules:
-- SELECT: Admin only.
-- INSERT: Authenticated users can insert audit records for actions they perform.
-- UPDATE & DELETE: STRICTLY FORBIDDEN (Deny All). Audit trail is immutable.

CREATE POLICY "vf_audit_logs_select_admin" ON public.vf_audit_logs
FOR SELECT TO authenticated
USING (public.vf_is_admin());

CREATE POLICY "vf_audit_logs_insert_auth" ON public.vf_audit_logs
FOR INSERT TO authenticated
WITH CHECK (
    auth.uid() IS NOT NULL
);

-- Note: No UPDATE or DELETE policies are created, resulting in default Deny-All for mutations.

-- ==============================================================================
-- 9. USER ACCOUNTS TABLE & SAFE VIEW (vf_auth_users)
-- ==============================================================================

-- Create safe view excluding pass_hash
CREATE OR REPLACE VIEW public.vf_auth_user_profiles AS
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

-- vf_auth_users Table Policies:
-- SELECT: Users can view their own record; Admins can view all records.
CREATE POLICY "vf_auth_users_select_self_or_admin" ON public.vf_auth_users
FOR SELECT TO authenticated
USING (
    public.vf_is_admin()
    OR auth.uid()::text = id
    OR lower(email) = lower(auth.jwt() ->> 'email')
);

-- INSERT: Admin only.
CREATE POLICY "vf_auth_users_insert_admin" ON public.vf_auth_users
FOR INSERT TO authenticated
WITH CHECK (public.vf_is_admin());

-- UPDATE: Admin only (users cannot escalate their own role or permissions).
CREATE POLICY "vf_auth_users_update_admin" ON public.vf_auth_users
FOR UPDATE TO authenticated
USING (public.vf_is_admin())
WITH CHECK (public.vf_is_admin());

-- DELETE: Admin only.
CREATE POLICY "vf_auth_users_delete_admin" ON public.vf_auth_users
FOR DELETE TO authenticated
USING (public.vf_is_admin());

-- ==============================================================================
-- 10. RPC SECURITY DEFINER FUNCTION HARDENING
-- ==============================================================================

-- 1. vf_issue_yarn_boxes: Enforce authenticated caller & operator or above role
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

-- 2. vf_record_weft_issues: Enforce authenticated caller & operator or above role
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

-- 3. vf_bulk_delete_entities: Enforce Administrator verification & Table Whitelist
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
    IF NOT public.vf_is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: vf_bulk_delete_entities requires administrator privileges';
    END IF;

    IF p_table IS NULL OR p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'deleted_count', 0, 'error', 'Invalid arguments');
    END IF;

    -- Strict Whitelist of allowed tables for bulk deletion
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

    -- Automatically determine primary key column
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

-- ==============================================================================
-- 11. STORAGE BUCKET SECURITY POLICIES (vf_media_assets)
-- ==============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
        -- 1. Public Read: Only thumbnails and fabric catalog previews
        CREATE POLICY "vf_media_assets_public_read" ON storage.objects
        FOR SELECT TO public
        USING (
            bucket_id = 'vf_media_assets'
            AND (name LIKE 'public/%' OR name LIKE 'thumbnails/%')
        );

        -- 2. Authenticated Read: All media assets
        CREATE POLICY "vf_media_assets_auth_read" ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'vf_media_assets');

        -- 3. Authenticated Insert: Operators, Editors, Admins
        CREATE POLICY "vf_media_assets_operator_insert" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
            bucket_id = 'vf_media_assets'
            AND public.vf_is_operator_or_above()
        );

        -- 4. Authenticated Update: Operators, Editors, Admins
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
END $$;

-- ==============================================================================
-- 12. REVOKE UNNECESSARY PRIVILEGES FROM ANONYMOUS ROLE
-- ==============================================================================

-- Revoke all table, sequence, and function rights from anon
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;

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

-- Grant table privileges to authenticated users (subject to RLS)
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

COMMIT;

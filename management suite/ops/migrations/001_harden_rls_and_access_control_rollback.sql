-- ==============================================================================
-- Migration Rollback: 001_harden_rls_and_access_control_rollback.sql
-- Project: Vishwa Atelier Management Suite
-- Phase: Phase 4 — RLS, Grants, RPCs, and Storage Hardening (Rollback Script)
-- Date: 2026-09-19
-- 
-- IMPORTANT:
-- This rollback script reverts the 001_harden_rls_and_access_control migration:
-- 1. Drops the granular role-based policies.
-- 2. Restores the baseline "Allow public access to vf_*" policies.
-- 3. Restores table and sequence grants to 'anon'.
-- ==============================================================================

BEGIN;

-- 1. Drop granular operational policies
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
    END LOOP;
END $$;

-- 2. Drop HR policies
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
    END LOOP;
END $$;

-- 3. Drop specific table policies
DROP POLICY IF EXISTS "vf_companies_select_auth" ON public.vf_companies;
DROP POLICY IF EXISTS "vf_companies_insert_admin" ON public.vf_companies;
DROP POLICY IF EXISTS "vf_companies_update_admin" ON public.vf_companies;
DROP POLICY IF EXISTS "vf_companies_delete_admin" ON public.vf_companies;

DROP POLICY IF EXISTS "vf_kv_store_select_auth" ON public.vf_kv_store;
DROP POLICY IF EXISTS "vf_kv_store_insert_operator" ON public.vf_kv_store;
DROP POLICY IF EXISTS "vf_kv_store_update_operator" ON public.vf_kv_store;
DROP POLICY IF EXISTS "vf_kv_store_delete_admin" ON public.vf_kv_store;

DROP POLICY IF EXISTS "vf_audit_logs_select_admin" ON public.vf_audit_logs;
DROP POLICY IF EXISTS "vf_audit_logs_insert_auth" ON public.vf_audit_logs;

DROP POLICY IF EXISTS "vf_auth_users_select_self_or_admin" ON public.vf_auth_users;
DROP POLICY IF EXISTS "vf_auth_users_insert_admin" ON public.vf_auth_users;
DROP POLICY IF EXISTS "vf_auth_users_update_admin" ON public.vf_auth_users;
DROP POLICY IF EXISTS "vf_auth_users_delete_admin" ON public.vf_auth_users;

-- Drop storage policies
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
        DROP POLICY IF EXISTS "vf_media_assets_public_read" ON storage.objects;
        DROP POLICY IF EXISTS "vf_media_assets_auth_read" ON storage.objects;
        DROP POLICY IF EXISTS "vf_media_assets_operator_insert" ON storage.objects;
        DROP POLICY IF EXISTS "vf_media_assets_operator_update" ON storage.objects;
        DROP POLICY IF EXISTS "vf_media_assets_admin_delete" ON storage.objects;
    END IF;
END $$;

-- 4. Restore Baseline Permissive Policies
DO $$
DECLARE
    t TEXT;
    all_33_tables TEXT[] := ARRAY[
        'vf_kv_store',
        'vf_costing_products',
        'vf_costing_tfo_products',
        'vf_costing_doubler_products',
        'vf_costing_covering_products',
        'vf_costing_links',
        'vf_audit_logs',
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
        'vf_employees',
        'vf_attendance_records',
        'vf_employee_loans',
        'vf_salary_settlements',
        'vf_rm_qualities',
        'vf_fp_qualities',
        'vf_rm_suppliers',
        'vf_fabric_designs',
        'vf_machinery_assets',
        'vf_companies',
        'vf_auth_users'
    ];
BEGIN
    FOREACH t IN ARRAY all_33_tables
    LOOP
        EXECUTE format('
            CREATE POLICY "Allow public access to %s" ON public.%I
            FOR ALL USING (true) WITH CHECK (true);
        ', t, t);
    END LOOP;
END $$;

-- Restore storage permissive policy
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
        CREATE POLICY "Allow public access to vf_media_assets" ON storage.objects
        FOR ALL USING (bucket_id = 'vf_media_assets') WITH CHECK (bucket_id = 'vf_media_assets');
    END IF;
END $$;

-- 5. Restore table privileges to anon
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon;

COMMIT;

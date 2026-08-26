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

-- ==============================================================================
-- Server-Side RPC Utility Functions (Health & Security)
-- ==============================================================================

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

-- ==============================================================================
-- Row Level Security (RLS) Configuration
-- ==============================================================================

ALTER TABLE public.vf_kv_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_tfo_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_doubler_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_covering_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_audit_logs ENABLE ROW LEVEL SECURITY;

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
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
END $$;

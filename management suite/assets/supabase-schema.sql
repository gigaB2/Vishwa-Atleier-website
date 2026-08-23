-- ==============================================================================
-- Management Suite — Supabase Database Provisioning Schema
-- 
-- Run this script in your Supabase Project's SQL Editor (Dashboard -> SQL Editor)
-- to initialize all required tables, indexes, and realtime synchronization.
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

-- ==============================================================================
-- Row Level Security (RLS) Configuration
-- ==============================================================================

ALTER TABLE public.vf_kv_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_tfo_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_doubler_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vf_costing_covering_products ENABLE ROW LEVEL SECURITY;

-- Allow anon public read/write access (matching client REST token authentication)
-- (You can customize these policies if you enforce strict Supabase Auth JWTs)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_kv_store' AND policyname = 'Allow public access to vf_kv_store') THEN
        CREATE POLICY "Allow public access to vf_kv_store" ON public.vf_kv_store FOR ALL USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_costing_products' AND policyname = 'Allow public access to vf_costing_products') THEN
        CREATE POLICY "Allow public access to vf_costing_products" ON public.vf_costing_products FOR ALL USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_costing_tfo_products' AND policyname = 'Allow public access to vf_costing_tfo_products') THEN
        CREATE POLICY "Allow public access to vf_costing_tfo_products" ON public.vf_costing_tfo_products FOR ALL USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_costing_doubler_products' AND policyname = 'Allow public access to vf_costing_doubler_products') THEN
        CREATE POLICY "Allow public access to vf_costing_doubler_products" ON public.vf_costing_doubler_products FOR ALL USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vf_costing_covering_products' AND policyname = 'Allow public access to vf_costing_covering_products') THEN
        CREATE POLICY "Allow public access to vf_costing_covering_products" ON public.vf_costing_covering_products FOR ALL USING (true) WITH CHECK (true);
    END IF;
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
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
END $$;

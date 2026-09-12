# Supabase Management Suite Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate HTTP 500 query errors, fix client pagination bugs, clean redundant RLS policies, and harden PostgreSQL RPC security in the Supabase Management Suite database.

**Architecture:** 
1. Fix client query construction in `management suite/assets/supabase-client.js` to ensure clean URL param handling and resolve undeclared variable references (`separator`).
2. Clean duplicate/overlapping RLS policies on `vf_kv_store` and costing tables via idempotent SQL migrations.
3. Harden RPC functions (`vf_ping`, `vf_is_admin`, `vf_issue_yarn_boxes`, `vf_record_weft_issues`) with immutable `SET search_path = public` and explicit privilege grants.
4. Synchronize `management suite/assets/supabase-schema.sql` and `management suite/modules/settings.html` with the hardened DDL.

**Tech Stack:** JavaScript (ES6, Fetch API, WebSocket), PostgreSQL 17 / Supabase PostgREST, SQL DDL/RLS.

## Global Constraints
- Do not break existing CRUD endpoints or client data sync contracts.
- Strictly adhere to `search_path = public` on all `SECURITY DEFINER` functions.
- Keep RLS policies minimal, unambiguous, and non-overlapping.

---

### Task 1: Fix Pagination URL Construction in Supabase Client

**Files:**
- Modify: `management suite/assets/supabase-client.js:2650-2688`
- Test: `management suite/tests/vf-db-service.test.js`

**Interfaces:**
- Consumes: `fetchAllRowsPaginated(tableOrPath, select, extraParams)`
- Produces: Correct PostgREST URL with properly formed query parameters (no undefined variables or duplicate `&&`).

- [ ] **Step 1: Write/Update test for `fetchAllRowsPaginated` and `fetchTable` query strings**

Verify test cases covering `tableOrPath` with and without query strings, extra parameters with leading `&`, and ordering parameters.

- [ ] **Step 2: Fix `fetchAllRowsPaginated` in `management suite/assets/supabase-client.js`**

```javascript
  async function fetchAllRowsPaginated(tableOrPath, select = '*', extraParams = '') {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
    const pageSize = 1000;
    let offset = 0;
    let allRows = [];
    let hasMore = true;

    while (hasMore) {
      try {
        const cleanExtra = extraParams ? String(extraParams).replace(/^&+|&+$/g, '').trim() : '';
        const hasQuestionMark = String(tableOrPath).includes('?');
        const sep = hasQuestionMark ? '&' : '?';
        const queryParts = [`select=${encodeURIComponent(select).replace(/%2C/g, ',').replace(/%2A/g, '*')}`, `limit=${pageSize}`, `offset=${offset}`];
        if (cleanExtra) {
          queryParts.push(cleanExtra);
        }
        const url = `${SUPABASE_URL}/rest/v1/${tableOrPath}${sep}${queryParts.join('&')}`;
        const res = await fetch(url, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (!res.ok) break;
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        allRows = allRows.concat(rows);
        if (rows.length < pageSize) {
          hasMore = false;
        } else {
          offset += pageSize;
        }
      } catch (e) {
        console.warn('Pagination fetch notice:', e);
        break;
      }
    }
    return allRows;
  }
```

- [ ] **Step 3: Verify client requests in browser or Node test environment**
- [ ] **Step 4: Commit client fixes**

---

### Task 2: Deduplicate and Consolidate Database RLS Policies

**Files:**
- Supabase Live Database via `execute_sql` / `apply_migration`
- Update: `management suite/assets/supabase-schema.sql`
- Update: `management suite/modules/settings.html`

- [ ] **Step 1: Prepare SQL cleanup script for redundant RLS policies**

```sql
-- Clean redundant policies on vf_kv_store
DROP POLICY IF EXISTS "Enable read/write for all users" ON public.vf_kv_store;
DROP POLICY IF EXISTS "Allow public delete on vf_kv_store" ON public.vf_kv_store;
DROP POLICY IF EXISTS "Allow public update on vf_kv_store" ON public.vf_kv_store;
DROP POLICY IF EXISTS "Allow public insert on vf_kv_store" ON public.vf_kv_store;
DROP POLICY IF EXISTS "Allow public read on vf_kv_store" ON public.vf_kv_store;

-- Clean duplicate policies on costing tables
DROP POLICY IF EXISTS "Public costing_links" ON public.vf_costing_links;
DROP POLICY IF EXISTS "Public costing_products" ON public.vf_costing_products;
DROP POLICY IF EXISTS "Public costing_tfo_products" ON public.vf_costing_tfo_products;
DROP POLICY IF EXISTS "Public costing_doubler_products" ON public.vf_costing_doubler_products;
DROP POLICY IF EXISTS "Public costing_covering_products" ON public.vf_costing_covering_products;
```

- [ ] **Step 2: Apply the migration to Supabase live database**
- [ ] **Step 3: Query `pg_policies` to verify exactly one clean policy exists per table**

---

### Task 3: Harden PostgreSQL RPC Functions and Search Paths

**Files:**
- Supabase Live Database via `execute_sql` / `apply_migration`
- Update: `management suite/assets/supabase-schema.sql`

- [ ] **Step 1: Re-create functions with `SET search_path = public`**

```sql
-- 1. vf_ping
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
        'version', '2.0.0',
        'server_time', now()
    );
END;
$$;

-- 2. vf_is_admin
CREATE OR REPLACE FUNCTION public.vf_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT coalesce(
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
        OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        OR auth.role() = 'service_role',
        false
    );
$$;

-- 3. vf_issue_yarn_boxes
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
SET search_path = public
AS $$
DECLARE
    v_updated_count INT := 0;
    v_box_rec RECORD;
BEGIN
    IF p_box_ids IS NULL OR array_length(p_box_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No box IDs provided');
    END IF;

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

-- 4. vf_record_weft_issues
CREATE OR REPLACE FUNCTION public.vf_record_weft_issues(p_issues JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
```

- [ ] **Step 2: Apply updated function definitions to Supabase**
- [ ] **Step 3: Run `get_advisors` (security) to verify mutable search path warnings are resolved**

---

### Task 4: End-to-End Verification & Health Checks

**Files:**
- Execute health verification via RPC and PostgREST endpoints

- [ ] **Step 1: Test `vf_ping` RPC**
- [ ] **Step 2: Verify `GET /vf_fabric_designs` and `GET /vf_kv_store` pagination responses**
- [ ] **Step 3: Run security advisor check and confirm clean status**

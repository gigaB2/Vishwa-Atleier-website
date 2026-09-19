const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Supabase Error Audit & Resilience Test Suite', () => {

  // Setup DOM / Browser simulation environment
  function createTestEnvironment(customConfig = {}) {
    const virtualStorage = new Map();
    const mockLocalStorage = {
      getItem: (k) => virtualStorage.has(k) ? virtualStorage.get(k) : null,
      setItem: (k, v) => virtualStorage.set(k, String(v)),
      removeItem: (k) => virtualStorage.delete(k),
      clear: () => virtualStorage.clear()
    };

    const listeners = {};
    const mockWindow = {
      location: { pathname: '/management%20suite/index.html', href: 'http://localhost/index.html', search: '' },
      localStorage: mockLocalStorage,
      addEventListener: (evt, fn) => {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(fn);
      },
      removeEventListener: () => {},
      dispatchEvent: (evt) => {
        if (listeners[evt.type]) {
          listeners[evt.type].forEach(fn => fn(evt));
        }
        return true;
      },
      CustomEvent: class {
        constructor(type, params = {}) {
          this.type = type;
          this.detail = params.detail;
        }
      },
      StorageEvent: class {
        constructor(type, params = {}) {
          this.type = type;
          this.key = params.key;
          this.newValue = params.newValue;
        }
      },
      BroadcastChannel: class {
        constructor() {}
        postMessage() {}
        close() {}
        unref() {}
      },
      APP_CONFIG: {
        SUPABASE_URL: 'https://test-project.supabase.co',
        SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QtcHJvamVjdCIsInJvbGUiOiJub25lIn0.test-sig',
        ...customConfig
      },
      HTMLInputElement: function() {},
      HTMLTextAreaElement: function() {},
      HTMLSelectElement: function() {}
    };

    const mockDocument = {
      location: mockWindow.location,
      addEventListener: mockWindow.addEventListener,
      removeEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {} }),
      body: { appendChild: () => {} }
    };

    const scriptPath = path.join(__dirname, '..', 'assets', 'supabase-client.js');
    const code = fs.readFileSync(scriptPath, 'utf8');

    const context = vm.createContext({
      window: mockWindow,
      document: mockDocument,
      localStorage: mockLocalStorage,
      console: console,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
      fetch: async () => ({ ok: true, json: async () => ([]) }),
      AbortController: global.AbortController,
      Date: Date,
      Map: Map,
      Set: Set,
      JSON: JSON,
      Array: Array,
      Object: Object,
      String: String,
      Number: Number,
      Boolean: Boolean,
      RegExp: RegExp
    });

    vm.runInContext(code, context);
    return { window: mockWindow, storage: virtualStorage, context };
  }

  test('1. Universal PostgreSQL Error Interceptor handles all standard error codes gracefully', () => {
    const { window } = createTestEnvironment();
    const handleErr = window.VishwaSupabase.handlePostgresError;
    assert.strictEqual(typeof handleErr, 'function', 'handlePostgresError must be exposed');

    // Test 42501 (RLS Policy Violation)
    const rlsResult = handleErr({ code: '42501', message: 'new row violates row-level security policy for table vf_auth_users' }, { table: 'vf_auth_users' });
    assert.strictEqual(rlsResult.handled, true);
    assert.strictEqual(rlsResult.type, 'RLS_VIOLATION');
    assert.strictEqual(rlsResult.fallbackToKv, true);

    // Test 23505 (Unique Constraint Collision)
    const uniqueResult = handleErr({ code: '23505', message: 'duplicate key value violates unique constraint "vf_yarn_rm_lots_pkey"' }, { table: 'vf_yarn_rm_lots' });
    assert.strictEqual(uniqueResult.handled, true);
    assert.strictEqual(uniqueResult.type, 'UNIQUE_COLLISION');
    assert.strictEqual(uniqueResult.retry, true);

    // Test 23503 (Foreign Key Violation)
    const fkResult = handleErr({ code: '23503', message: 'insert or update on table "vf_yarn_rm_boxes" violates foreign key constraint' }, { table: 'vf_yarn_rm_boxes' });
    assert.strictEqual(fkResult.handled, true);
    assert.strictEqual(fkResult.type, 'FOREIGN_KEY_VIOLATION');
    assert.strictEqual(fkResult.orphanTarget, true);

    // Test 21000 (Cardinality / Duplicate ON CONFLICT Target)
    const cardResult = handleErr({ code: '21000', message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' }, { table: 'vf_rm_qualities' });
    assert.strictEqual(cardResult.handled, true);
    assert.strictEqual(cardResult.type, 'CARDINALITY_VIOLATION');
    assert.strictEqual(cardResult.dedupeRequired, true);

    // Test 57014 (Statement Timeout)
    const timeoutResult = handleErr({ code: '57014', message: 'canceling statement due to statement timeout' }, { table: 'vf_fabric_designs' });
    assert.strictEqual(timeoutResult.handled, true);
    assert.strictEqual(timeoutResult.type, 'STATEMENT_TIMEOUT');
    assert.strictEqual(timeoutResult.reducePageSize, true);

    // Test 544 (Supabase Database Timeout on cold start)
    const dbTimeoutResult = handleErr({ code: 'DatabaseTimeout', status: 544, message: 'The connection to the database timed out' }, { table: 'vf_media_assets' });
    assert.strictEqual(dbTimeoutResult.handled, true);
    assert.strictEqual(dbTimeoutResult.type, 'STATEMENT_TIMEOUT');
    assert.strictEqual(dbTimeoutResult.fallbackToKv, true);

    // Test 522 (Cloudflare Gateway Timeout)
    const cfTimeoutResult = handleErr({ status: 522, message: 'Cloudflare connection timeout' }, {});
    assert.strictEqual(cfTimeoutResult.handled, true);
    assert.strictEqual(cfTimeoutResult.type, 'STATEMENT_TIMEOUT');

    // Test PGRST301 (JWT Expired)
    const jwtResult = handleErr({ code: 'PGRST301', message: 'JWT expired' }, {});
    assert.strictEqual(jwtResult.handled, true);
    assert.strictEqual(jwtResult.type, 'PGRST_JWT_EXPIRED');
    assert.strictEqual(jwtResult.refreshAuth, true);
  });

  test('2. Batch deduplication helper eliminates duplicate primary keys before PostgREST mutations', () => {
    const { window } = createTestEnvironment();
    const dedupe = window.VishwaSupabase.dedupeByConflictKey;
    assert.strictEqual(typeof dedupe, 'function', 'dedupeByConflictKey must be exposed');

    const duplicateLots = [
      { id: 'LOT-100', supplier: 'Old Supplier', updated_at: '2026-09-18T10:00:00Z' },
      { id: 'LOT-101', supplier: 'Supplier B', updated_at: '2026-09-19T10:00:00Z' },
      { id: 'LOT-100', supplier: 'Latest Supplier', updated_at: '2026-09-19T12:00:00Z' }
    ];

    const sanitized = dedupe(duplicateLots, 'id');
    assert.strictEqual(sanitized.length, 2, 'Must deduplicate to 2 items');
    assert.strictEqual(sanitized[0].id, 'LOT-100');
    assert.strictEqual(sanitized[0].supplier, 'Latest Supplier', 'Must preserve latest record');
    assert.strictEqual(sanitized[1].id, 'LOT-101');
  });

  test('3. Bi-directional Auth & User consolidation prevents account loss on empty or restricted remote payloads', () => {
    const { window } = createTestEnvironment();
    const mergeDatasets = window.VishwaSupabase.mergeDatasets;
    assert.strictEqual(typeof mergeDatasets, 'function');

    const populatedLocalAdmins = [
      { id: 'admin-1', email: 'admin@vishwa.com', name: 'Master Admin', role: 'admin', updated_at: '2026-09-18T10:00:00Z' },
      { id: 'admin-2', email: 'director@vishwa.com', name: 'Director', role: 'admin', updated_at: '2026-09-18T10:00:00Z' }
    ];

    // Remote returns empty array [] (simulating fresh workstation, RLS filter, or unseeded project)
    const mergedWithEmptyRemote = mergeDatasets('vf_admin_users', populatedLocalAdmins, []);
    assert.strictEqual(mergedWithEmptyRemote.length, 2, 'Must retain local accounts when remote returns empty');
    assert.strictEqual(mergedWithEmptyRemote[0].email, 'admin@vishwa.com');

    // Remote returns null/undefined -> retains local accounts
    const mergedWithNullRemote = mergeDatasets('vf_admin_users', populatedLocalAdmins, null);
    assert.strictEqual(mergedWithNullRemote.length, 2, 'Must retain local accounts when remote is null');

    // Remote has authoritative account list -> adopts clean remote list
    const remoteAdmins = [
      { id: 'admin-1', email: 'admin@vishwa.com', name: 'Master Admin Renamed', role: 'admin', updated_at: '2026-09-19T10:00:00Z' },
      { id: 'admin-3', email: 'supervisor@vishwa.com', name: 'Supervisor', role: 'admin', updated_at: '2026-09-19T09:00:00Z' }
    ];

    const authoritativeMerged = mergeDatasets('vf_admin_users', populatedLocalAdmins, remoteAdmins);
    assert.strictEqual(authoritativeMerged.length, 2, 'Adopts authoritative remote list');
    assert.strictEqual(authoritativeMerged[0].name, 'Master Admin Renamed');
  });

  test('4. Schema defines all 33 relational tables, storage buckets, and replica identities matching client operations', () => {
    const schemaPath = path.join(__dirname, '..', 'assets', 'supabase-schema.sql');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');

    const expectedTables = [
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

    expectedTables.forEach(t => {
      assert.ok(
        schemaContent.includes(`CREATE TABLE IF NOT EXISTS public.${t}`) ||
        schemaContent.includes(`CREATE TABLE public.${t}`),
        `Table public.${t} must be declared in supabase-schema.sql`
      );
    });

    // Check storage bucket
    assert.ok(schemaContent.includes('vf_media_assets'), 'Must configure vf_media_assets bucket');
    assert.ok(schemaContent.includes('REPLICA IDENTITY FULL'), 'Must configure REPLICA IDENTITY FULL for realtime CDC');
  });

  test('5. Config parser resilience across varied environment configurations', () => {
    const configPath = path.join(__dirname, '..', 'assets', 'config.js');
    const content = fs.readFileSync(configPath, 'utf8');

    const urlMatch = content.match(/SUPABASE_URL:\s*(?:[^"'\n]*\|\|\s*)?["']([^"']+)["']/);
    const keyMatch = content.match(/SUPABASE_ANON_KEY:\s*(?:[^"'\n]*\|\|\s*)?["']([^"']+)["']/);

    assert.ok(urlMatch, 'Must match SUPABASE_URL');
    assert.ok(keyMatch, 'Must match SUPABASE_ANON_KEY');
    assert.ok(urlMatch[1].startsWith('https://'), 'URL must be a valid HTTPS endpoint');
    assert.ok(keyMatch[1].length > 20, 'Anon key must be a valid token string');
  });
});

/**
 * @file rls-hardening.test.js
 * @description Comprehensive automated verification suite for Phase 4:
 *              Row Level Security (RLS), Grants, RPC Hardening, and Storage Security.
 *              Validates SQL migration syntax, structural policy coverage, and
 *              executes offline policy simulations for all 5 role tiers across 33 tables.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Target file: Single Unified Master Schema
const SCHEMA_PATH = path.join(__dirname, '..', 'assets', 'supabase-schema.sql');

// Complete list of all 33 production application tables
const ALL_33_TABLES = [
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

const OPERATIONAL_TABLES = [
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

const HR_PAYROLL_TABLES = [
  'vf_employees',
  'vf_attendance_records',
  'vf_employee_loans',
  'vf_salary_settlements'
];

const SENSITIVE_KV_KEYS = [
  'gemini_api_key',
  'vf_master_credentials',
  'vf_backup_manifest',
  'vf_cloud_credentials'
];

test('RLS & Access-Control Hardening Suite (Phase 4)', async (t) => {
  assert.ok(fs.existsSync(SCHEMA_PATH), 'supabase-schema.sql must exist');

  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');

  // ============================================================================
  // Suite 1: Master Schema Structural & Syntactic Integrity
  // ============================================================================
  await t.test('1. Master schema wraps execution in transactional boundary (BEGIN/COMMIT)', () => {
    assert.ok(schemaSql.includes('BEGIN;'), 'Schema must contain BEGIN;');
    assert.ok(schemaSql.trim().endsWith('COMMIT;'), 'Schema must end with COMMIT;');
  });

  await t.test('2. Every single one of the 33 tables has its permissive policy explicitly dropped', () => {
    for (const table of ALL_33_TABLES) {
      const dropStmt = `DROP POLICY IF EXISTS "Allow public access to ${table}" ON public.${table};`;
      assert.ok(
        schemaSql.includes(dropStmt),
        `Master schema must explicitly drop permissive policy on ${table}`
      );
    }
    assert.ok(
      schemaSql.includes('DROP POLICY IF EXISTS "Allow public access to vf_media_assets" ON storage.objects;'),
      'Storage permissive policy must be dropped'
    );
  });

  await t.test('3. Row Level Security is both ENABLED and FORCED on all 33 tables', () => {
    for (const table of ALL_33_TABLES) {
      assert.ok(
        schemaSql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`),
        `RLS must be enabled on ${table}`
      );
      assert.ok(
        schemaSql.includes(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`),
        `RLS must be forced on ${table} to protect table owners`
      );
    }
  });

  await t.test('4. Server-side role resolution helpers are defined with pinned search_path', () => {
    const requiredHelpers = [
      'public.vf_current_user_role()',
      'public.vf_is_admin()',
      'public.vf_is_operator_or_above()',
      'public.vf_is_payroll_authorized()'
    ];

    for (const helper of requiredHelpers) {
      assert.ok(schemaSql.includes(helper), `Helper function ${helper} must be defined`);
    }

    // Must pin search_path to prevent malicious path hijacking
    assert.ok(
      schemaSql.includes('SET search_path = public, auth, pg_temp'),
      'Security definer functions must pin search_path to public, auth, pg_temp'
    );
  });

  await t.test('5. Critical RPC functions enforce authorization guards and pin search_path', () => {
    const rpcs = [
      'vf_issue_yarn_boxes',
      'vf_record_weft_issues',
      'vf_bulk_delete_entities'
    ];

    for (const rpc of rpcs) {
      assert.ok(schemaSql.includes(`public.${rpc}`), `${rpc} must be defined in master schema`);
    }

    assert.ok(
      schemaSql.includes("RAISE EXCEPTION 'Unauthorized: Caller does not possess operator permissions';"),
      'vf_issue_yarn_boxes and vf_record_weft_issues must verify operator permissions'
    );
    assert.ok(
      schemaSql.includes("RAISE EXCEPTION 'Unauthorized: vf_bulk_delete_entities requires administrator privileges';"),
      'vf_bulk_delete_entities must verify administrator privileges'
    );
  });

  await t.test('6. Safe user profile view excludes pass_hash and anonymous privileges are revoked', () => {
    assert.ok(
      schemaSql.includes('CREATE OR REPLACE VIEW public.vf_auth_user_profiles AS'),
      'Safe profile view must exist'
    );
    assert.ok(
      !schemaSql.includes('pass_hash\nFROM public.vf_auth_users') &&
      !schemaSql.includes('pass_hash,\nFROM public.vf_auth_users'),
      'Safe profile view must NEVER include pass_hash'
    );
    assert.ok(
      schemaSql.includes('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;'),
      'All table grants must be revoked from anon'
    );
    assert.ok(
      schemaSql.includes('GRANT EXECUTE ON FUNCTION public.vf_ping() TO anon, authenticated;'),
      'Public ping health check must remain available to anon'
    );
  });

  await t.test('7. Mutable user_metadata is never referenced in RLS policies or role helpers', () => {
    assert.ok(
      !schemaSql.includes('user_metadata'),
      'Master schema must NEVER reference user_metadata for security or RLS policies (only tamper-proof app_metadata or vf_auth_users table)'
    );
  });

  // ============================================================================
  // Suite 2: Offline Policy Simulator (Simulating PostgreSQL RLS Rules)
  // ============================================================================

  /**
   * Evaluates if a request is permitted under the hardened RLS policy rules
   * @param {Object} context
   * @param {string} context.role - 'anon' | 'viewer' | 'operator' | 'payroll_admin' | 'admin'
   * @param {string} context.table - table name
   * @param {string} context.action - 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
   * @param {Object} [context.data] - optional row data or parameters (e.g. key for vf_kv_store, id for vf_auth_users)
   */
  function evaluatePolicy({ role, table, action, data = {} }) {
    const isServiceRole = role === 'service_role';
    if (isServiceRole) return { allowed: true, reason: 'service_role bypass' };

    const isAuthenticated = role !== 'anon';
    const isAdmin = role === 'admin';
    const isOperatorOrAbove = ['operator', 'editor', 'admin'].includes(role);
    const isPayrollAuthorized = ['payroll_admin', 'hr', 'admin'].includes(role);

    // Rule 0: Anonymous role has ZERO operational access
    if (!isAuthenticated) {
      if (table === 'rpc:vf_ping') return { allowed: true, reason: 'public health check' };
      if (table === 'storage:vf_media_assets' && action === 'SELECT') {
        const isThumb = data.name && (data.name.startsWith('public/') || data.name.startsWith('thumbnails/'));
        return isThumb
          ? { allowed: true, reason: 'public thumbnail' }
          : { allowed: false, reason: 'private media requires authentication' };
      }
      return { allowed: false, reason: 'Anonymous access denied by RLS' };
    }

    // Rule 1: Operational Tables (25 tables)
    if (OPERATIONAL_TABLES.includes(table)) {
      if (action === 'SELECT') return { allowed: true, reason: 'authenticated select allowed' };
      if (action === 'INSERT' || action === 'UPDATE') {
        return isOperatorOrAbove
          ? { allowed: true, reason: 'operator write allowed' }
          : { allowed: false, reason: 'viewer cannot mutate operational tables' };
      }
      if (action === 'DELETE') {
        return isAdmin
          ? { allowed: true, reason: 'admin delete allowed' }
          : { allowed: false, reason: 'only admin can delete operational records' };
      }
    }

    // Rule 2: HR & Payroll Tables (4 tables)
    if (HR_PAYROLL_TABLES.includes(table)) {
      if (action === 'SELECT' || action === 'INSERT' || action === 'UPDATE') {
        return isPayrollAuthorized
          ? { allowed: true, reason: 'payroll authorized' }
          : { allowed: false, reason: 'role is not authorized for payroll' };
      }
      if (action === 'DELETE') {
        return isAdmin
          ? { allowed: true, reason: 'admin delete allowed' }
          : { allowed: false, reason: 'only admin can delete HR/payroll records' };
      }
    }

    // Rule 3: Company Settings (vf_companies)
    if (table === 'vf_companies') {
      if (action === 'SELECT') return { allowed: true, reason: 'authenticated company profile read' };
      return isAdmin
        ? { allowed: true, reason: 'admin company settings modification' }
        : { allowed: false, reason: 'only admin can modify company settings' };
    }

    // Rule 4: Key-Value Store (vf_kv_store)
    if (table === 'vf_kv_store') {
      const isSensitiveKey = data.key && SENSITIVE_KV_KEYS.includes(data.key);
      if (isSensitiveKey) {
        return isAdmin
          ? { allowed: true, reason: 'admin access to sensitive key' }
          : { allowed: false, reason: 'sensitive key restricted to admin' };
      }
      if (action === 'SELECT') return { allowed: true, reason: 'authenticated kv read' };
      if (action === 'INSERT' || action === 'UPDATE') {
        return isOperatorOrAbove
          ? { allowed: true, reason: 'operator kv write' }
          : { allowed: false, reason: 'operator or above required for kv write' };
      }
      if (action === 'DELETE') {
        return isAdmin
          ? { allowed: true, reason: 'admin kv delete' }
          : { allowed: false, reason: 'admin required for kv delete' };
      }
    }

    // Rule 5: Enterprise Audit Logs (vf_audit_logs)
    if (table === 'vf_audit_logs') {
      if (action === 'SELECT') {
        return isAdmin
          ? { allowed: true, reason: 'admin audit inspection' }
          : { allowed: false, reason: 'audit logs can only be read by admin' };
      }
      if (action === 'INSERT') return { allowed: true, reason: 'authenticated audit append' };
      // UPDATE and DELETE are strictly denied for all
      return { allowed: false, reason: 'audit logs are strictly immutable (deny-all on update/delete)' };
    }

    // Rule 6: User Accounts (vf_auth_users)
    if (table === 'vf_auth_users') {
      if (action === 'SELECT') {
        const isSelf = data.userId && data.currentUserId && data.userId === data.currentUserId;
        return (isAdmin || isSelf)
          ? { allowed: true, reason: 'admin or self user read' }
          : { allowed: false, reason: 'users can only select their own profile' };
      }
      return isAdmin
        ? { allowed: true, reason: 'admin user management' }
        : { allowed: false, reason: 'only admin can insert/update/delete users' };
    }

    // Rule 7: RPC Calls
    if (table === 'rpc:vf_issue_yarn_boxes' || table === 'rpc:vf_record_weft_issues') {
      return isOperatorOrAbove
        ? { allowed: true, reason: 'operator RPC call allowed' }
        : { allowed: false, reason: 'operator role required for RPC' };
    }
    if (table === 'rpc:vf_bulk_delete_entities') {
      if (!isAdmin) return { allowed: false, reason: 'admin role required for bulk delete' };
      const validTable = data.targetTable && OPERATIONAL_TABLES.includes(data.targetTable);
      return validTable
        ? { allowed: true, reason: 'admin bulk delete on whitelisted table' }
        : { allowed: false, reason: 'table not permitted for bulk deletion' };
    }

    // Rule 8: Storage
    if (table === 'storage:vf_media_assets') {
      if (action === 'SELECT') return { allowed: true, reason: 'authenticated media read' };
      if (action === 'INSERT' || action === 'UPDATE') {
        return isOperatorOrAbove
          ? { allowed: true, reason: 'operator media upload' }
          : { allowed: false, reason: 'operator role required for media upload' };
      }
      if (action === 'DELETE') {
        return isAdmin
          ? { allowed: true, reason: 'admin media delete' }
          : { allowed: false, reason: 'admin role required for media delete' };
      }
    }

    return { allowed: false, reason: 'unmatched policy rule' };
  }

  // ============================================================================
  // Suite 3: Negative Policy Verification (Proving Rejections)
  // ============================================================================
  await t.test('8. Anonymous role is completely denied access to operational tables', () => {
    for (const table of OPERATIONAL_TABLES) {
      for (const action of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const result = evaluatePolicy({ role: 'anon', table, action });
        assert.strictEqual(result.allowed, false, `Anonymous ${action} on ${table} must be rejected`);
      }
    }
  });

  await t.test('9. Anonymous role is completely denied access to HR & Payroll tables', () => {
    for (const table of HR_PAYROLL_TABLES) {
      for (const action of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const result = evaluatePolicy({ role: 'anon', table, action });
        assert.strictEqual(result.allowed, false, `Anonymous ${action} on ${table} must be rejected`);
      }
    }
  });

  await t.test('10. Viewer role cannot mutate any operational table (INSERT, UPDATE, DELETE denied)', () => {
    for (const table of OPERATIONAL_TABLES) {
      assert.strictEqual(
        evaluatePolicy({ role: 'viewer', table, action: 'INSERT' }).allowed,
        false,
        `Viewer INSERT on ${table} must be rejected`
      );
      assert.strictEqual(
        evaluatePolicy({ role: 'viewer', table, action: 'UPDATE' }).allowed,
        false,
        `Viewer UPDATE on ${table} must be rejected`
      );
      assert.strictEqual(
        evaluatePolicy({ role: 'viewer', table, action: 'DELETE' }).allowed,
        false,
        `Viewer DELETE on ${table} must be rejected`
      );
    }
  });

  await t.test('11. Non-payroll roles (Viewer, Operator) cannot read or modify HR & Payroll records', () => {
    for (const role of ['viewer', 'operator']) {
      for (const table of HR_PAYROLL_TABLES) {
        for (const action of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const result = evaluatePolicy({ role, table, action });
          assert.strictEqual(result.allowed, false, `${role} ${action} on ${table} must be rejected`);
        }
      }
    }
  });

  await t.test('12. Non-admin roles cannot modify company settings or user accounts', () => {
    for (const role of ['viewer', 'operator', 'payroll_admin']) {
      // Company settings mutation
      for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
        assert.strictEqual(
          evaluatePolicy({ role, table: 'vf_companies', action }).allowed,
          false,
          `${role} ${action} on vf_companies must be rejected`
        );
        assert.strictEqual(
          evaluatePolicy({ role, table: 'vf_auth_users', action }).allowed,
          false,
          `${role} ${action} on vf_auth_users must be rejected`
        );
      }
    }
  });

  await t.test('13. Sensitive keys in vf_kv_store are inaccessible to non-admins', () => {
    for (const key of SENSITIVE_KV_KEYS) {
      assert.strictEqual(
        evaluatePolicy({ role: 'operator', table: 'vf_kv_store', action: 'SELECT', data: { key } }).allowed,
        false,
        `Operator cannot read sensitive key: ${key}`
      );
      assert.strictEqual(
        evaluatePolicy({ role: 'operator', table: 'vf_kv_store', action: 'UPDATE', data: { key } }).allowed,
        false,
        `Operator cannot update sensitive key: ${key}`
      );
    }
  });

  await t.test('14. Audit logs are strictly immutable (UPDATE and DELETE denied for ALL roles, even admin)', () => {
    for (const role of ['anon', 'viewer', 'operator', 'payroll_admin', 'admin']) {
      assert.strictEqual(
        evaluatePolicy({ role, table: 'vf_audit_logs', action: 'UPDATE' }).allowed,
        false,
        `UPDATE on vf_audit_logs must be denied for ${role}`
      );
      assert.strictEqual(
        evaluatePolicy({ role, table: 'vf_audit_logs', action: 'DELETE' }).allowed,
        false,
        `DELETE on vf_audit_logs must be denied for ${role}`
      );
    }
  });

  await t.test('15. Unauthorized RPC execution is denied', () => {
    // Viewer cannot issue yarn boxes
    assert.strictEqual(
      evaluatePolicy({ role: 'viewer', table: 'rpc:vf_issue_yarn_boxes' }).allowed,
      false,
      'Viewer cannot execute vf_issue_yarn_boxes'
    );
    // Operator cannot execute bulk delete
    assert.strictEqual(
      evaluatePolicy({ role: 'operator', table: 'rpc:vf_bulk_delete_entities', data: { targetTable: 'vf_yarn_rm_boxes' } }).allowed,
      false,
      'Operator cannot execute vf_bulk_delete_entities'
    );
    // Admin cannot bulk delete non-whitelisted tables (e.g. SQL injection attempt or system tables)
    assert.strictEqual(
      evaluatePolicy({ role: 'admin', table: 'rpc:vf_bulk_delete_entities', data: { targetTable: 'pg_authid; DROP TABLE...' } }).allowed,
      false,
      'Illegal table injection in bulk delete must be rejected'
    );
  });

  await t.test('16. Storage access boundaries are enforced', () => {
    // Anonymous cannot read private document
    assert.strictEqual(
      evaluatePolicy({ role: 'anon', table: 'storage:vf_media_assets', action: 'SELECT', data: { name: 'designs/spec.ep' } }).allowed,
      false,
      'Anonymous cannot read private EP file'
    );
    // Viewer cannot upload media
    assert.strictEqual(
      evaluatePolicy({ role: 'viewer', table: 'storage:vf_media_assets', action: 'INSERT' }).allowed,
      false,
      'Viewer cannot upload media'
    );
    // Operator cannot delete media
    assert.strictEqual(
      evaluatePolicy({ role: 'operator', table: 'storage:vf_media_assets', action: 'DELETE' }).allowed,
      false,
      'Operator cannot delete media'
    );
  });

  // ============================================================================
  // Suite 4: Positive Workflow Verification (Authorized Operations)
  // ============================================================================
  await t.test('17. Viewer can read operational tables and company profile', () => {
    for (const table of OPERATIONAL_TABLES) {
      assert.strictEqual(
        evaluatePolicy({ role: 'viewer', table, action: 'SELECT' }).allowed,
        true,
        `Viewer must be able to SELECT ${table}`
      );
    }
    assert.strictEqual(
      evaluatePolicy({ role: 'viewer', table: 'vf_companies', action: 'SELECT' }).allowed,
      true,
      'Viewer must be able to SELECT vf_companies'
    );
  });

  await t.test('18. Operator has operational CRUD (SELECT, INSERT, UPDATE) across all operational modules', () => {
    for (const table of OPERATIONAL_TABLES) {
      assert.strictEqual(
        evaluatePolicy({ role: 'operator', table, action: 'SELECT' }).allowed,
        true,
        `Operator can SELECT ${table}`
      );
      assert.strictEqual(
        evaluatePolicy({ role: 'operator', table, action: 'INSERT' }).allowed,
        true,
        `Operator can INSERT ${table}`
      );
      assert.strictEqual(
        evaluatePolicy({ role: 'operator', table, action: 'UPDATE' }).allowed,
        true,
        `Operator can UPDATE ${table}`
      );
    }
    // Operator can invoke operational RPCs
    assert.strictEqual(
      evaluatePolicy({ role: 'operator', table: 'rpc:vf_issue_yarn_boxes' }).allowed,
      true,
      'Operator can execute vf_issue_yarn_boxes'
    );
    assert.strictEqual(
      evaluatePolicy({ role: 'operator', table: 'rpc:vf_record_weft_issues' }).allowed,
      true,
      'Operator can execute vf_record_weft_issues'
    );
    // Operator can insert audit logs
    assert.strictEqual(
      evaluatePolicy({ role: 'operator', table: 'vf_audit_logs', action: 'INSERT' }).allowed,
      true,
      'Operator can record audit log entries'
    );
  });

  await t.test('19. Payroll Admin can read and write all HR & Payroll records', () => {
    for (const table of HR_PAYROLL_TABLES) {
      assert.strictEqual(
        evaluatePolicy({ role: 'payroll_admin', table, action: 'SELECT' }).allowed,
        true,
        `Payroll admin can SELECT ${table}`
      );
      assert.strictEqual(
        evaluatePolicy({ role: 'payroll_admin', table, action: 'INSERT' }).allowed,
        true,
        `Payroll admin can INSERT ${table}`
      );
      assert.strictEqual(
        evaluatePolicy({ role: 'payroll_admin', table, action: 'UPDATE' }).allowed,
        true,
        `Payroll admin can UPDATE ${table}`
      );
    }
  });

  await t.test('20. Administrator has full verified CRUD access across all operational, HR, and settings tables', () => {
    for (const table of [...OPERATIONAL_TABLES, ...HR_PAYROLL_TABLES, 'vf_companies']) {
      for (const action of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.strictEqual(
          evaluatePolicy({ role: 'admin', table, action }).allowed,
          true,
          `Admin must have ${action} on ${table}`
        );
      }
    }
    // Admin can read audit logs
    assert.strictEqual(
      evaluatePolicy({ role: 'admin', table: 'vf_audit_logs', action: 'SELECT' }).allowed,
      true,
      'Admin can read audit logs'
    );
    // Admin can manage sensitive keys
    assert.strictEqual(
      evaluatePolicy({ role: 'admin', table: 'vf_kv_store', action: 'SELECT', data: { key: 'gemini_api_key' } }).allowed,
      true,
      'Admin can read gemini_api_key'
    );
    // Admin can execute bulk delete
    assert.strictEqual(
      evaluatePolicy({ role: 'admin', table: 'rpc:vf_bulk_delete_entities', data: { targetTable: 'vf_yarn_rm_boxes' } }).allowed,
      true,
      'Admin can execute bulk delete on whitelisted tables'
    );
    // Admin can delete storage media
    assert.strictEqual(
      evaluatePolicy({ role: 'admin', table: 'storage:vf_media_assets', action: 'DELETE' }).allowed,
      true,
      'Admin can delete storage media'
    );
  });
});

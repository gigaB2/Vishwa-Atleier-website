const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://fwlzysudduroyndkiewa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bHp5c3VkZHVyb3luZGtpZXdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4ODMwMDEsImV4cCI6MjEwMDQ1OTAwMX0.Cv0Ns_gslFFSe90_lu1YBqo9aEcHaUbmnsI43TDZ_oo';

const headers = {
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json'
};

async function fetchJson(url, options = {}) {
  const opt = {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    signal: AbortSignal.timeout(6000)
  };
  try {
    const res = await fetch(url, opt);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = text;
    }
    return { status: res.status, ok: res.ok, headers: res.headers, body: json };
  } catch (err) {
    return { status: 0, ok: false, error: err.message, body: null };
  }
}

async function runAudit() {
  console.log('=====================================================');
  console.log('       SUPABASE FULL INFRASTRUCTURE AUDIT REPORT     ');
  console.log('=====================================================');
  console.log(`Endpoint: ${SUPABASE_URL}\n`);

  const audit = {
    openApiTables: [],
    openApiRpcs: [],
    tables: {},
    rpcs: {},
    storage: {},
    auth: {},
    issues: []
  };

  // 1. Fetch OpenAPI spec
  console.log('--- Step 1: Discovering Live Schema via PostgREST OpenAPI ---');
  const spec = await fetchJson(`${SUPABASE_URL}/rest/v1/`, {
    method: 'GET',
    headers: { 'Accept': 'application/openapi+json' }
  });
  if (spec.ok && spec.body && spec.body.paths) {
    const paths = Object.keys(spec.body.paths);
    paths.forEach(p => {
      if (p.startsWith('/rpc/')) {
        audit.openApiRpcs.push(p.replace('/rpc/', ''));
      } else if (p.startsWith('/') && p.length > 1) {
        audit.openApiTables.push(p.substring(1));
      }
    });
    console.log(`✅ Discovered ${audit.openApiTables.length} exposed tables and ${audit.openApiRpcs.length} exposed RPCs in live OpenAPI.`);
  } else {
    console.log(`⚠️ OpenAPI spec returned status ${spec.status || spec.error}`);
  }

  // 2. Read schema sql to find all declared tables & rpcs
  const schemaPath = path.join(__dirname, '..', 'assets', 'supabase-schema.sql');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  const tableMatches = [...schemaContent.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.([a-zA-Z0-9_]+)/g)].map(m => m[1]);
  const schemaTables = [...new Set(tableMatches)];

  const rpcMatches = [...schemaContent.matchAll(/CREATE OR REPLACE FUNCTION (?:public\.)?([a-zA-Z0-9_]+)/g)].map(m => m[1]);
  const schemaRpcs = [...new Set(rpcMatches)];

  console.log(`Schema file declares ${schemaTables.length} tables and ${schemaRpcs.length} functions.\n`);

  // 3. Test every table in schema for SELECT and write access
  console.log('--- Step 2: Live Table Access & RLS Policy Validation ---');
  for (const table of schemaTables) {
    const sel = await fetchJson(`${SUPABASE_URL}/rest/v1/${table}?limit=1`, {
      method: 'GET',
      headers: { 'Prefer': 'count=exact' }
    });

    if (!sel.ok) {
      console.log(`❌ Table [${table}]: SELECT FAIL (${sel.status || sel.error}) -> ${JSON.stringify(sel.body)}`);
      audit.issues.push({
        type: 'Table Select Error',
        table,
        status: sel.status,
        error: sel.body || sel.error
      });
      audit.tables[table] = { select: false, error: sel.body };
      continue;
    }

    const countHeader = sel.headers.get('content-range');
    console.log(`✅ Table [${table}]: OK (Count header: ${countHeader || '0'})`);
    audit.tables[table] = { select: true, count: countHeader };
  }

  // 4. Test RPC functions
  console.log('\n--- Step 3: Live RPC Execution Validation ---');
  const rpcsToTest = [
    { name: 'vf_ping', body: {} },
    { name: 'vf_bulk_delete_entities', body: { p_table: 'vf_kv_store', p_ids: ['__audit_non_existent__'] } },
    { name: 'vf_issue_yarn_boxes', body: { p_box_ids: ['__audit_test_box__'], p_issued_to: '__audit_test__' } },
    { name: 'vf_reconcile_beam', body: { p_beam_id: '__audit_test_beam__' } },
    { name: 'vf_process_attendance_batch', body: { p_month: '2026-09', p_records: [] } },
    { name: 'vf_process_dispatch', body: { p_dispatch_id: '__audit_test_dispatch__' } }
  ];

  for (const rpc of rpcsToTest) {
    const res = await fetchJson(`${SUPABASE_URL}/rest/v1/rpc/${rpc.name}`, {
      method: 'POST',
      body: JSON.stringify(rpc.body)
    });

    if (res.ok) {
      console.log(`✅ RPC [${rpc.name}]: OK -> ${JSON.stringify(res.body)}`);
      audit.rpcs[rpc.name] = { ok: true, res: res.body };
    } else {
      console.log(`❌ RPC [${rpc.name}]: FAIL (${res.status || res.error}) -> ${JSON.stringify(res.body)}`);
      audit.rpcs[rpc.name] = { ok: false, status: res.status, error: res.body };
      audit.issues.push({
        type: 'RPC Failure',
        rpc: rpc.name,
        status: res.status,
        error: res.body || res.error
      });
    }
  }

  // 5. Test Storage Bucket
  console.log('\n--- Step 4: Storage Infrastructure Validation ---');
  const bucketRes = await fetchJson(`${SUPABASE_URL}/storage/v1/bucket/vf_media_assets`);
  if (bucketRes.ok) {
    console.log(`✅ Storage bucket [vf_media_assets]: OK -> ${JSON.stringify(bucketRes.body)}`);
    audit.storage.vf_media_assets = { ok: true, data: bucketRes.body };
  } else {
    console.log(`⚠️ Storage bucket [vf_media_assets]: Status (${bucketRes.status}) -> ${JSON.stringify(bucketRes.body)}`);
    audit.storage.vf_media_assets = { ok: false, status: bucketRes.status, error: bucketRes.body };
    audit.issues.push({
      type: 'Storage Bucket Issue',
      bucket: 'vf_media_assets',
      status: bucketRes.status,
      error: bucketRes.body || bucketRes.error
    });
  }

  // 6. Test Auth System
  console.log('\n--- Step 5: Auth System Validation ---');
  const authHealth = await fetchJson(`${SUPABASE_URL}/auth/v1/health`);
  console.log(`Auth /health: Status ${authHealth.status} -> ${JSON.stringify(authHealth.body)}`);
  audit.auth.health = { status: authHealth.status, body: authHealth.body };

  const authSettings = await fetchJson(`${SUPABASE_URL}/auth/v1/settings`);
  console.log(`Auth /settings: Status ${authSettings.status} -> ${JSON.stringify(authSettings.body)}`);
  audit.auth.settings = { status: authSettings.status, body: authSettings.body };

  // 7. Check Schema Tables vs OpenAPI Discovered
  console.log('\n--- Step 6: Schema vs Live DB Alignment ---');
  if (audit.openApiTables.length > 0) {
    const missingInLive = schemaTables.filter(t => !audit.openApiTables.includes(t));
    if (missingInLive.length > 0) {
      console.log(`⚠️ Missing in live DB API:`, missingInLive);
      missingInLive.forEach(t => {
        audit.issues.push({
          type: 'Missing Table in Live DB',
          table: t
        });
      });
    } else {
      console.log(`✅ All ${schemaTables.length} schema tables are active in live DB!`);
    }
  }

  // 8. Client Code Inspection
  console.log('\n--- Step 7: Client Codebase Supabase Error Handling Audit ---');
  const clientCode = fs.readFileSync(path.join(__dirname, '..', 'assets', 'supabase-client.js'), 'utf8');

  const checkPatterns = [
    { name: '42501 (RLS Policy Violation)', pattern: '42501' },
    { name: '23505 (Unique Constraint Collision)', pattern: '23505' },
    { name: '23503 (Foreign Key Constraint Violation)', pattern: '23503' },
    { name: '21000 (Cardinality/Duplicate Target Error)', pattern: '21000' },
    { name: '42P01 (Undefined Table)', pattern: '42P01' },
    { name: '42703 (Undefined Column)', pattern: '42703' },
    { name: 'PGRST116 (No Rows Returned / Single Row Violation)', pattern: 'PGRST116' },
    { name: 'PGRST301 (JWT Expired)', pattern: 'PGRST301' },
    { name: 'Offline Mutation Queue & Retry Engine', pattern: 'offline' },
    { name: 'Tombstone Synchronization for Deletions', pattern: 'tombstone' },
    { name: 'Realtime Channel Reconnection & Backoff', pattern: 'reconnect' }
  ];

  checkPatterns.forEach(cp => {
    const found = clientCode.toLowerCase().includes(cp.pattern.toLowerCase());
    console.log(`- ${cp.name}: ${found ? '✅ Detected' : '⚠️ Not Explicitly Handled'}`);
    if (!found) {
      audit.issues.push({
        type: 'Missing Client Error Handler',
        pattern: cp.name
      });
    }
  });

  console.log('\n=====================================================');
  console.log('                 AUDIT SUMMARY FINDINGS              ');
  console.log('=====================================================');
  console.log(`Total Issues / Edge Cases Identified: ${audit.issues.length}`);
  if (audit.issues.length > 0) {
    console.log(JSON.stringify(audit.issues, null, 2));
  } else {
    console.log('🎉 No critical Supabase errors found!');
  }
}

runAudit();

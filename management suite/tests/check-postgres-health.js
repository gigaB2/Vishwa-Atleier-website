const fs = require('fs');
const path = require('path');
const dns = require('dns');

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const configPath = path.join(__dirname, '..', 'assets', 'config.js');
const configContent = fs.readFileSync(configPath, 'utf8');

const urlMatch = configContent.match(/SUPABASE_URL:\s*(?:[^"'\n]*\|\|\s*)?["']([^"']+)["']/);
const keyMatch = configContent.match(/SUPABASE_ANON_KEY:\s*(?:[^"'\n]*\|\|\s*)?["']([^"']+)["']/);

if (!urlMatch || !keyMatch) {
  console.error('Could not extract SUPABASE_URL or SUPABASE_ANON_KEY from config.js');
  process.exit(1);
}

const SUPABASE_URL = urlMatch[1];
const SUPABASE_ANON_KEY = keyMatch[1];

console.log('Testing Supabase instance:', SUPABASE_URL);

const tables = [
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

async function runDiagnostics() {
  const results = { passed: [], failed: [], warnings: [] };

  // 1. Check RPC vf_ping
  try {
    const pingRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_ping`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const pingData = await pingRes.text();
    if (pingRes.ok) {
      console.log('✅ RPC vf_ping:', pingData);
      results.passed.push('RPC vf_ping');
    } else {
      console.log(`❌ RPC vf_ping failed (${pingRes.status}):`, pingData);
      results.failed.push({ item: 'RPC vf_ping', status: pingRes.status, error: pingData });
    }
  } catch (e) {
    console.log('❌ RPC vf_ping network error:', e.message);
    results.failed.push({ item: 'RPC vf_ping', error: e.message });
  }

  // 2. Check each table
  for (const table of tables) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?limit=1`, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'count=exact'
        }
      });
      const data = await res.text();
      if (res.ok) {
        const countHeader = res.headers.get('content-range') || '0';
        console.log(`✅ Table ${table}: OK (Range/Count: ${countHeader})`);
        results.passed.push({ table, count: countHeader });
      } else {
        console.log(`❌ Table ${table} (${res.status}): ${data}`);
        results.failed.push({ item: `Table ${table}`, status: res.status, error: data });
      }
    } catch (e) {
      console.log(`❌ Table ${table} error: ${e.message}`);
      results.failed.push({ item: `Table ${table}`, error: e.message });
    }
  }

  // 3. Test RPC vf_bulk_delete_entities
  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_bulk_delete_entities`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_table: 'vf_kv_store', p_ids: ['__non_existent_test_key__'] })
    });
    const rpcData = await rpcRes.text();
    if (rpcRes.ok) {
      console.log('✅ RPC vf_bulk_delete_entities: OK', rpcData);
      results.passed.push('RPC vf_bulk_delete_entities');
    } else {
      console.log(`❌ RPC vf_bulk_delete_entities (${rpcRes.status}):`, rpcData);
      results.failed.push({ item: 'RPC vf_bulk_delete_entities', status: rpcRes.status, error: rpcData });
    }
  } catch (e) {
    results.failed.push({ item: 'RPC vf_bulk_delete_entities', error: e.message });
  }

  // 4. Test RPC vf_issue_yarn_boxes dry run
  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vf_issue_yarn_boxes`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_box_ids: ['__test_box__'], p_issued_to: 'Test' })
    });
    const rpcData = await rpcRes.text();
    if (rpcRes.ok) {
      console.log('✅ RPC vf_issue_yarn_boxes: OK', rpcData);
      results.passed.push('RPC vf_issue_yarn_boxes');
    } else {
      console.log(`❌ RPC vf_issue_yarn_boxes (${rpcRes.status}):`, rpcData);
      results.failed.push({ item: 'RPC vf_issue_yarn_boxes', status: rpcRes.status, error: rpcData });
    }
  } catch (e) {
    results.failed.push({ item: 'RPC vf_issue_yarn_boxes', error: e.message });
  }

  // 5. Test Storage bucket
  try {
    const storageRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket/vf_media_assets`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const storageData = await storageRes.text();
    if (storageRes.ok) {
      console.log('✅ Storage bucket vf_media_assets: OK');
      results.passed.push('Storage bucket vf_media_assets');
    } else {
      console.log(`⚠️ Storage bucket vf_media_assets (${storageRes.status}):`, storageData);
      results.warnings.push({ item: 'Storage bucket vf_media_assets', status: storageRes.status, error: storageData });
    }
  } catch (e) {
    results.warnings.push({ item: 'Storage bucket vf_media_assets', error: e.message });
  }

  console.log('\n==============================');
  console.log('--- SUPABASE AUDIT SUMMARY ---');
  console.log('==============================');
  console.log(`Passed items: ${results.passed.length}`);
  console.log(`Failed items: ${results.failed.length}`);
  console.log(`Warnings: ${results.warnings.length}`);
  if (results.failed.length > 0) {
    console.log('\nFailed details:');
    results.failed.forEach(f => console.log(JSON.stringify(f, null, 2)));
  }
}

runDiagnostics();

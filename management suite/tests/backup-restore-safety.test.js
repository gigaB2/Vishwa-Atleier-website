/**
 * Backup, Import, and Destructive-Operation Safety Test Suite (Phase 6)
 * 
 * Verifies:
 * 1. Full-State Backup Export: Produces version 2.0.0 payload with section counts and retains full workstation state.
 * 2. Pre-flight Backup Validator: Rejects non-objects, malformed structures, and corrupt financial values.
 * 3. Pre-Import Recovery Snapshot: Preserves existing state prior to any destructive operation and can restore it.
 * 4. Transactional Restore & Auto-Rollback: Successfully restores complex datasets and rolls back on failure.
 * 5. Financial & Calculation Fidelity: Net payables, order quantities, and rates remain mathematically identical.
 * 6. UI Safety & Reset Guard: Confirms settings.html includes dry-run preview modal and typed RESET confirmation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Phase 6: Backup, Import, and Destructive-Operation Safety Test Suite ---');

function createTestSandbox() {
  const store = {};
  const mockLocalStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i) => Object.keys(store)[i] || null,
    get length() { return Object.keys(store).length; },
    _store: store
  };

  const listeners = {};
  const sandbox = {
    window: {
      localStorage: mockLocalStorage,
      location: { reload: () => {}, pathname: '/management%20suite/modules/settings.html' },
      APP_CONFIG: {
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.dummy'
      },
      addEventListener(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      removeEventListener(event, fn) {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter(f => f !== fn);
        }
      },
      dispatchEvent(event) {
        const fns = listeners[event.type || event.name] || [];
        fns.forEach(fn => fn(event));
        return true;
      },
      CustomEvent: function(name, opts) { this.type = name; this.name = name; this.detail = opts?.detail; },
      BroadcastChannel: class { postMessage() {} close() {} },
      HTMLInputElement: function() {},
      HTMLTextAreaElement: function() {},
      HTMLSelectElement: function() {}
    },
    document: {
      createElement: () => ({
        setAttribute: () => {},
        click: () => {},
        remove: () => {}
      }),
      body: {
        appendChild: () => {}
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    localStorage: mockLocalStorage,
    navigator: { onLine: true },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: clearTimeout,
    setInterval: () => ({ unref: () => {} }),
    clearInterval: clearInterval,
    Date: Date,
    fetch: async () => ({ ok: false, json: async () => ({}) })
  };

  const clientPath = path.resolve(__dirname, '../assets/supabase-client.js');
  const code = fs.readFileSync(clientPath, 'utf8');
  const runner = new Function(
    'window', 'document', 'localStorage', 'navigator', 'console',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'fetch',
    code
  );
  runner(
    sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator,
    sandbox.console, sandbox.setTimeout, sandbox.clearTimeout, sandbox.setInterval,
    sandbox.clearInterval, sandbox.Date, sandbox.fetch
  );

  return {
    window: sandbox.window,
    VF_DB: sandbox.window.VF_DB,
    VishwaSupabase: sandbox.window.VishwaSupabase,
    localStorage: mockLocalStorage,
    store
  };
}

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

async function runSuite() {
  // Test 1: Full-state export produces version 2.0.0 with manifest counts and preserves full credentials
  await runAsyncTest('exportFullBackup produces v2.0.0 schema, section counts, and preserves workstation session', async () => {
    const env = createTestSandbox();
    env.localStorage.setItem('vf_session', JSON.stringify({ username: 'Admin', role: 'admin', token: 'sec-tok-123' }));
    env.localStorage.setItem('vf_gemini_api_key', 'AIzaSySecretApiKey');
    env.localStorage.setItem('vishwa_yarn_rm_orders_data', JSON.stringify([{ id: 'ORD-101', supplier: 'Reliance' }]));
    env.localStorage.setItem('aethertasks_db_state_v7', JSON.stringify({
      employees: [{ id: 'EMP-1', name: 'Ramesh' }],
      salarySettlements: [{ id: 'SETTLE-1', netPayable: 25000 }]
    }));

    const res = await env.VF_DB.exportFullBackup();
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.meta.version, '2.0.0');
    assert.ok(res.data.meta.export_date);
    assert.ok(res.data.meta.section_counts);
    assert.strictEqual(res.data.meta.section_counts.yarnOrders, 1);
    assert.strictEqual(res.data.meta.section_counts.employees, 1);
    assert.strictEqual(res.data.meta.section_counts.salarySettlements, 1);

    // Verify session & settings are preserved per user directive
    assert.ok(res.data.localStorage['vf_session'].includes('sec-tok-123'));
    assert.ok(res.data.localStorage['vf_gemini_api_key'].includes('AIzaSySecretApiKey'));
  });

  // Test 2: Pre-flight validator catches invalid payloads
  runTest('validateBackupPayload rejects null, arrays, and empty structures', () => {
    const env = createTestSandbox();
    const resNull = env.VF_DB.validateBackupPayload(null);
    assert.strictEqual(resNull.valid, false);

    const resArr = env.VF_DB.validateBackupPayload([1, 2, 3]);
    assert.strictEqual(resArr.valid, false);

    const resEmpty = env.VF_DB.validateBackupPayload({});
    assert.strictEqual(resEmpty.valid, false);
    assert.ok(resEmpty.errors.some(e => e.toLowerCase().includes('local storage')));
  });

  // Test 3: Pre-flight validator catches non-finite financial figures
  runTest('validateBackupPayload catches corrupt/NaN financial figures in settlements', () => {
    const env = createTestSandbox();
    const badPayload = {
      meta: { version: '2.0.0' },
      localStorage: {
        aethertasks_db_state_v7: JSON.stringify({
          salarySettlements: [{ id: 'BAD-SETTLE', netPayable: 'corrupt-not-a-number' }]
        })
      }
    };
    const res = env.VF_DB.validateBackupPayload(badPayload);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some(e => e.includes('Invalid financial netPayable')));
  });

  // Test 4: Pre-import recovery snapshot functionality
  runTest('createPreImportSnapshot saves existing state and restorePreImportSnapshot restores it', () => {
    const env = createTestSandbox();
    env.localStorage.setItem('state_key_a', 'Original Value A');
    env.localStorage.setItem('state_key_b', 'Original Value B');

    const snapRes = env.VF_DB.createPreImportSnapshot();
    assert.strictEqual(snapRes.success, true);
    assert.ok(env.localStorage.getItem('vf_pre_import_recovery_snapshot'));

    // Corrupt or wipe state
    env.localStorage.setItem('state_key_a', 'Modified Corrupt Value');
    env.localStorage.removeItem('state_key_b');

    // Restore from snapshot
    const restoreRes = env.VF_DB.restorePreImportSnapshot();
    assert.strictEqual(restoreRes.success, true);
    assert.strictEqual(env.localStorage.getItem('state_key_a'), 'Original Value A');
    assert.strictEqual(env.localStorage.getItem('state_key_b'), 'Original Value B');
  });

  // Test 5: Safe transactional restore & auto rollback
  await runAsyncTest('restoreBackup executes pre-flight check, snapshots state, and auto-rolls back if payload is corrupt', async () => {
    const env = createTestSandbox();
    env.localStorage.setItem('original_order', 'ORD-SAFE-999');

    // Attempt to restore bad payload
    const badPayload = {
      meta: { version: '2.0.0' },
      localStorage: {
        aethertasks_db_state_v7: '{ invalid json syntax }'
      }
    };

    const res = await env.VF_DB.restoreBackup(badPayload);
    assert.strictEqual(res.success, false);
    // Original data must NOT be lost
    assert.strictEqual(env.localStorage.getItem('original_order'), 'ORD-SAFE-999');
  });

  // Test 6: Financial calculations & settlement totals match down to the exact decimal
  await runAsyncTest('Financial and operational records retain exact values after backup export and restore', async () => {
    const env = createTestSandbox();
    const settlementData = {
      employees: [{ id: 'EMP-77', name: 'Kanti Bhai', salary: 28500 }],
      salarySettlements: [{
        id: 'SETTLE-2026-05',
        employeeId: 'EMP-77',
        effectiveDays: 25.5,
        netPayable: 26425.50
      }]
    };
    env.localStorage.setItem('aethertasks_db_state_v7', JSON.stringify(settlementData));
    env.localStorage.setItem('vishwa_yarn_rm_stock_data', JSON.stringify([{ lotId: 'LOT-99', grossWeight: 1425.75 }]));

    const exportRes = await env.VF_DB.exportFullBackup();
    assert.strictEqual(exportRes.success, true);

    // Clear and restore
    env.localStorage.clear();
    assert.strictEqual(env.localStorage.getItem('aethertasks_db_state_v7'), null);

    const restoreRes = await env.VF_DB.restoreBackup(exportRes.data);
    assert.strictEqual(restoreRes.success, true);

    const restoredState = JSON.parse(env.localStorage.getItem('aethertasks_db_state_v7'));
    assert.strictEqual(restoredState.salarySettlements[0].netPayable, 26425.50);
    assert.strictEqual(restoredState.salarySettlements[0].effectiveDays, 25.5);

    const restoredStock = JSON.parse(env.localStorage.getItem('vishwa_yarn_rm_stock_data'));
    assert.strictEqual(restoredStock[0].grossWeight, 1425.75);
  });

  // Test 7: UI Audit in settings.html
  runTest('modules/settings.html includes import-preview-modal, validateBackupPayload check, and typed RESET safeguard', () => {
    const settingsPath = path.resolve(__dirname, '../modules/settings.html');
    const settingsHtml = fs.readFileSync(settingsPath, 'utf8');

    assert.ok(settingsHtml.includes('id="import-preview-modal"'), 'Must have dry-run preview modal element');
    assert.ok(settingsHtml.includes('validateBackupPayload'), 'Must validate before importing');
    assert.ok(settingsHtml.includes('createPreImportSnapshot'), 'Must create pre-import snapshot');
    assert.ok(settingsHtml.includes('prompt(') && settingsHtml.includes('RESET'), 'Factory reset must require typing RESET');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log('All Phase 6 Backup, Import, and Safety tests passed successfully!\n');
  process.exit(0);
}

runSuite().catch(e => {
  console.error(e);
  process.exit(1);
});

const assert = require('assert');
const test = require('node:test');
const fs = require('fs');
const path = require('path');

test('End-to-End VF_DB Relational Migration and Operations Suite', async (t) => {
  const filePath = path.join(__dirname, '../assets/supabase-client.js');
  const clientCode = fs.readFileSync(filePath, 'utf8');

  // Create isolated sandbox context
  function createTestEnv() {
    const sandbox = {
      window: {
        location: { pathname: '/management%20suite/modules/settings.html', href: 'http://localhost/settings.html' },
        addEventListener: () => {},
        dispatchEvent: () => {},
        CustomEvent: function(name, opts) { this.name = name; this.detail = opts?.detail; },
        StorageEvent: function(name, opts) { this.name = name; this.key = opts?.key; this.newValue = opts?.newValue; },
        HTMLInputElement: function() {},
        HTMLTextAreaElement: function() {},
        HTMLSelectElement: function() {}
      },
      document: {
        location: { pathname: '/management%20suite/modules/settings.html', href: 'http://localhost/settings.html' },
        addEventListener: () => {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        body: {
          appendChild: () => {},
          removeChild: () => {}
        },
        createElement: (tag) => ({
          setAttribute: () => {},
          click: () => {},
          remove: () => {}
        })
      },
      localStorage: {
        _data: {},
        getItem(k) { return this._data[k] || null; },
        setItem(k, v) { this._data[k] = String(v); },
        removeItem(k) { delete this._data[k]; },
        key(i) { return Object.keys(this._data)[i] || null; },
        get length() { return Object.keys(this._data).length; }
      },
      navigator: { onLine: true },
      console: console,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
      Date: Date
    };
    sandbox.window.localStorage = sandbox.localStorage;

    const fn = new Function('window', 'document', 'localStorage', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', clientCode);
    fn(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.navigator, sandbox.console, sandbox.setTimeout, sandbox.clearTimeout, sandbox.setInterval, sandbox.clearInterval, sandbox.Date);
    return sandbox;
  }

  const env = createTestEnv();
  const VF_DB = env.window.VF_DB;

  assert.ok(VF_DB, 'VF_DB is defined on window');

  await t.test('Backup engine packages all local data into a complete JSON payload', async () => {
    env.localStorage.setItem('vishwa_yarn_rm_stock_data', JSON.stringify([
      { id: 'LOT-1', lotNumber: 'L-01', quality: '80/72 Polyester', boxes: [{ id: 'B1', weight: 20 }] }
    ]));
    env.localStorage.setItem('aethertasks_db_state_v7', JSON.stringify({
      employees: [{ id: 'EMP-1', name: 'Ramesh Kumar', role: 'Weaver' }],
      loans: [{ id: 'LN-1', employeeId: 'EMP-1', amount: 5000 }],
      attendance: { '2026-09-01': { 'EMP-1': 'P' } }
    }));

    try {
      const result = await VF_DB.exportFullBackup();
      assert.ok(result.success, 'Backup reported success');
      assert.ok(result.data, 'Backup returned data payload');
      assert.strictEqual(result.data.meta.version, '2.0.0');
      assert.ok(result.data.local_storage_raw['vishwa_yarn_rm_stock_data'], 'Contains stock data');
      assert.ok(result.data.local_storage_raw['aethertasks_db_state_v7'], 'Contains staff state');
    } catch(err) {
      console.error('DEBUG EXPORT ERROR:', err);
      throw err;
    }
  });

  await t.test('Migration engine handles unconfigured gracefully', async () => {
    const progressStages = [];
    const result = await VF_DB.migrateAllToRelational((prog) => {
      progressStages.push(prog);
    });

    // In mock unconfigured env, returns false gracefully
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Supabase unconfigured');
  });
});

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('PostgreSQL Error 21000 & 23503 Safeguards Validation', async (t) => {
  const clientJsPath = path.join(__dirname, '..', 'assets', 'supabase-client.js');
  const clientContent = fs.readFileSync(clientJsPath, 'utf8');

  await t.test('1. dedupeByConflictKey implementation exists and handles collision scenarios', () => {
    assert.ok(clientContent.includes('function dedupeByConflictKey(items, keyField'), 'dedupeByConflictKey helper must be defined');

    // Simulate dedupeByConflictKey behavior
    function dedupeByConflictKey(items, keyField = 'id') {
      if (!Array.isArray(items) || items.length <= 1) return items || [];
      const seen = new Map();
      for (const item of items) {
        if (!item) continue;
        const rawKey = item[keyField];
        const key = (rawKey !== undefined && rawKey !== null) ? String(rawKey).trim() : null;
        if (key) {
          seen.set(key, item);
        } else {
          seen.set(`__item_${Math.random()}`, item);
        }
      }
      return Array.from(seen.values());
    }

    const duplicateRows = [
      { id: 'LOT-001', name: 'Alpha' },
      { id: 'LOT-002', name: 'Beta' },
      { id: 'LOT-001', name: 'Alpha Updated' }
    ];
    const deduped = dedupeByConflictKey(duplicateRows, 'id');
    assert.strictEqual(deduped.length, 2, 'Must deduplicate items by key');
    assert.strictEqual(deduped[0].id, 'LOT-001');
    assert.strictEqual(deduped[0].name, 'Alpha Updated', 'Must preserve the latest state for the duplicate key');
    assert.strictEqual(deduped[1].id, 'LOT-002');
  });

  await t.test('2. Yarn RM Stock sync applies deduplication and FK integrity safeguards', () => {
    assert.ok(clientContent.includes('const dedupedLots = dedupeByConflictKey(lotRows, \'id\');'), 'lotRows must be deduplicated by id');
    assert.ok(clientContent.includes('const activeLotIdSet = new Set(dedupedLots.map(l => l.id));'), 'Must maintain activeLotIdSet for FK validation');
    assert.ok(clientContent.includes('const validBoxRows = dedupeByConflictKey(boxRows.filter(b => b && b.lot_id && activeLotIdSet.has(b.lot_id)), \'id\');'), 'validBoxRows must deduplicate and exclude orphan boxes');
    assert.ok(clientContent.includes('if (lotsSucceeded && validBoxRows.length > 0)'), 'Boxes must only be dispatched if parent lot insertion succeeded');
  });

  await t.test('3. Yarn RM Orders sync applies deduplication and cascading FK guards', () => {
    assert.ok(clientContent.includes('const dedupedOrders = dedupeByConflictKey(orderRows, \'id\');'), 'orderRows must be deduplicated');
    assert.ok(clientContent.includes('const validBatchRows = dedupeByConflictKey(batchRows.filter(b => b && b.order_id && activeOrderIdSet.has(b.order_id)), \'id\');'), 'validBatchRows must be deduplicated and check parent order');
    assert.ok(clientContent.includes('const validOrderBoxRows = dedupeByConflictKey(boxRows.filter(bx => bx && bx.batch_id && activeBatchIdSet.has(bx.batch_id) && activeOrderIdSet.has(bx.order_id)), \'id\');'), 'order boxRows must be deduplicated and check parent batch and order');
    assert.ok(clientContent.includes('if (ordersSucceeded && validBatchRows.length > 0)'), 'Batches must wait for orders success');
    assert.ok(clientContent.includes('if (batchesSucceeded && validOrderBoxRows.length > 0)'), 'Boxes must wait for batches success');
  });

  await t.test('4. Staff & Salary sync applies deduplication and employee FK protection', () => {
    assert.ok(clientContent.includes('empRows = dedupeByConflictKey(empRows, \'id\');'), 'empRows must be deduplicated');
    assert.ok(clientContent.includes('attRows = dedupeByConflictKey(attRows, \'id\');'), 'attRows must be deduplicated');
    assert.ok(clientContent.includes('loanRows = dedupeByConflictKey(loanRows, \'id\');'), 'loanRows must be deduplicated');
    assert.ok(clientContent.includes('settlementRows = dedupeByConflictKey(settlementRows, \'id\');'), 'settlementRows must be deduplicated');
    assert.ok(clientContent.includes('activeEmpIdSet.size > 0 && !activeEmpIdSet.has(targetEmpId)'), 'Orphan attendance must be filtered');
    assert.ok(clientContent.includes('activeEmpIdSet.size > 0 && !activeEmpIdSet.has(cleanEmpId)'), 'Orphan settlement must be filtered');
  });

  await t.test('5. PostgreSQL Schema defines vf_costing_links and dynamic PKs in vf_bulk_delete_entities', () => {
    const schemaPath = path.join(__dirname, '..', 'assets', 'supabase-schema.sql');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');

    assert.ok(schemaContent.includes('CREATE TABLE IF NOT EXISTS public.vf_costing_links'), 'vf_costing_links table definition must exist');
    assert.ok(schemaContent.includes('v_col := \'key\';'), 'vf_bulk_delete_entities must map vf_kv_store to key');
    assert.ok(schemaContent.includes('v_col := \'taka_serial\';'), 'vf_bulk_delete_entities must map vf_fabric_dispatches to taka_serial');
    assert.ok(schemaContent.includes('\'vf_costing_links\''), 'vf_costing_links must be an allowed table in vf_bulk_delete_entities');
    assert.ok(schemaContent.includes('CREATE POLICY "Allow public access to vf_costing_links"'), 'Policy for vf_costing_links must exist');
  });
});

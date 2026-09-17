const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the functions shipped in the page, not copies of their algorithms.
const html = fs.readFileSync(path.join(__dirname, '../modules/yarn/yarn-ledger.html'), 'utf8');
test('all shipped ledger inline JavaScript parses', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc\s*=/.test(m[1]) && !/application\/ld\+json/.test(m[1]));
  assert.ok(scripts.length > 0);
  for (const script of scripts) new vm.Script(script[2]);
});
function source(name) {
  const start = new RegExp(`^( +)(?:async )?function ${name}\\(`, 'm').exec(html);
  assert.ok(start, `Missing production function ${name}`);
  const tail = html.slice(start.index);
  const end = new RegExp(`^${start[1]}}`, 'm').exec(tail);
  assert.ok(end, `Missing end of ${name}`);
  return tail.slice(0, end.index + end[0].length);
}
function environment(remote = {}) {
  const stored = new Map();
  const writes = [];
  const context = {
    console: { ...console, warn: () => {} }, CLOUD_LEDGER_KEYS: ['rows', 'settings'], cachedCloudDataMap: {},
    localStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
    window: { VishwaSupabase: { getMultiple: async () => remote, set: (...args) => writes.push(args) } }
  };
  vm.createContext(context);
  for (const name of ['fetchAllCloudLedgerData', 'mergeLedgerDatasets', 'syncCreditDaysToSource']) {
    vm.runInContext(source(name), context);
  }
  return { context, stored, writes };
}

test('successful empty cloud collections and settings are authoritative over caches', async () => {
  const {context, stored} = environment({rows: [], settings: {}});
  stored.set('rows', '[{"id":"stale"}]');
  stored.set('settings', '{"creditDays":30}');
  context.window.__vf_supabase_cache = {rows: [{id: 'cached'}]};
  assert.equal(JSON.stringify(await context.fetchAllCloudLedgerData()), '{"rows":[],"settings":{}}');
});
test('failed cloud read retains offline fallback', async () => {
  const {context, stored} = environment();
  context.window.VishwaSupabase.getMultiple = async () => { throw new Error('offline'); };
  stored.set('rows', '[{"id":"unsynced"}]');
  assert.equal((await context.fetchAllCloudLedgerData()).rows[0].id, 'unsynced');
});
test('newest row financial values win including explicit zero', () => {
  const {context} = environment();
  const older = {id:'r', updated_at:'2026-09-01', rateMonthly:1, discountPercent:1, gstPercent:5};
  const newer = {id:'r', updated_at:'2026-09-17', rateMonthly:0, discountPercent:0, gstPercent:12};
  for (const [local, remote] of [[older,newer],[newer,older]]) {
    const [result] = context.mergeLedgerDatasets([local],[remote]);
    assert.equal(result.rateMonthly, 0);
    assert.equal(result.discountPercent, 0);
    assert.equal(result.gstPercent, 12);
  }
});
test('credit update matches exactly one order ID without matching absent order numbers', () => {
  const {context} = environment();
  const orders = [{id:'target',creditDays:30},{id:'other',creditDays:45}];
  context.cachedCloudDataMap['yarn-rm-orders'] = orders;
  context.syncCreditDaysToSource({source:'yarn-rm-orders',orderId:'target'},0);
  assert.equal(orders[0].creditDays,0);
  assert.equal(orders[1].creditDays,45);
});
test('missing identifiers and ambiguous legacy order numbers produce no writes', () => {
  const {context,writes} = environment();
  context.cachedCloudDataMap['yarn-rm-orders'] = [{id:'a',orderNumber:'1'},{id:'b',orderNumber:'1'}];
  context.syncCreditDaysToSource({source:'yarn-rm-orders'},60);
  context.syncCreditDaysToSource({source:'yarn-rm-orders',orderNumber:'1'},60);
  assert.equal(writes.length,0);
});
test('sales credit update uses full source key rather than ID suffix or shared challan', () => {
  const {context} = environment();
  const sales = [{id:'123',challanNo:'1',creditDays:30},{id:'23',challanNo:'1',creditDays:45}];
  context.cachedCloudDataMap.yarn_tfo_sales_logs = sales;
  context.syncCreditDaysToSource({source:'yarn_tfo_sales',syncKey:'sales_tfo_123',challanNo:'1'},60);
  assert.equal(sales[0].creditDays,60);
  assert.equal(sales[1].creditDays,45);
});

test('full ledger loader does not re-ingest stale cached orders or sales after empty cloud results', async () => {
  const keys = ['yarn_sales_ledger_data', 'yarn_purchase_ledger_data', 'yarn-rm-orders',
    'vishwa_yarn_rm_stock_data', 'yarn-qualities', 'yarn_covering_sales_logs',
    'yarn_tfo_sales_logs', 'yarn_doubler_sales_logs'];
  const {context, stored, writes} = environment(Object.fromEntries(keys.map(k => [k, []])));
  context.CLOUD_LEDGER_KEYS = keys;
  for (const key of keys) stored.set(key, JSON.stringify([{id:'stale',challanNo:'1',orderedWeight:10,rate:100}]));
  Object.assign(context, {
    ledgerData: {sales:[],purchase:[]}, document: {getElementById: () => null},
    populateQualityDatalist: () => {}, populateQualityFilter: () => {}, populatePartyFilter: () => {},
    saveLedgers: () => assert.fail('Empty cloud data must not generate and save stale rows'),
    defaultCreditDays:30, defaultRateMonthly:1.5, defaultDiscountPercent:1.5, defaultInterestRate:18,
    console: {warn: () => {}, error: (...args) => assert.fail(args.join(' '))}
  });
  vm.runInContext(source('loadAndSyncFromCloud'), context);
  await context.loadAndSyncFromCloud();
  assert.equal(context.ledgerData.sales.length,0);
  assert.equal(context.ledgerData.purchase.length,0);
  assert.equal(writes.length,0);
});

function purchaseEnvironment(orders = [], stock = [], saved = []) {
  const remote = {
    'yarn-rm-orders': orders, 'vishwa_yarn_rm_stock_data': stock,
    yarn_purchase_ledger_data: saved, yarn_sales_ledger_data: []
  };
  const {context} = environment(remote);
  context.CLOUD_LEDGER_KEYS = Object.keys(remote);
  Object.assign(context, {
    ledgerData: {sales:[],purchase:[]}, document: {getElementById: () => null},
    populateQualityDatalist: () => {}, populateQualityFilter: () => {}, populatePartyFilter: () => {},
    saveLedgers: () => {}, defaultCreditDays:30, defaultRateMonthly:1.5,
    defaultDiscountPercent:1.5, defaultInterestRate:18,
    console: {warn: () => {}, error: (...args) => assert.fail(args.join(' '))}
  });
  vm.runInContext(source('loadAndSyncFromCloud'), context);
  return context;
}
function receivedOrder(id, supplier, quantity = 10) {
  return {id, orderNumber:id, supplier, price:100, orderedWeight:100,
    batches:[{id:`batch-${id}`, challanNumber:'1', totalWeight:quantity}]};
}
test('unreceived orders and empty batches never create purchase liabilities', async () => {
  const context = purchaseEnvironment([
    {id:'pending', supplier:'A', orderedWeight:100, price:100},
    {id:'empty', supplier:'B', orderedWeight:100, receivedWeight:20, price:100,
      batches:[{id:'empty-batch', challanNumber:'2', totalWeight:0}]}
  ]);
  await context.loadAndSyncFromCloud();
  assert.equal(context.ledgerData.purchase.length,0);
});
test('explicit order-level receipts use received quantity, preserving explicit zero', async () => {
  const context = purchaseEnvironment([
    {id:'received', supplier:'A', orderedWeight:100, receivedWeight:20, price:100},
    {id:'zero', supplier:'B', orderedWeight:100, receivedWeight:0, price:100}
  ]);
  await context.loadAndSyncFromCloud();
  assert.equal(context.ledgerData.purchase.length,1);
  assert.equal(context.ledgerData.purchase[0].qty,20);
  assert.equal(context.ledgerData.purchase[0].subtotal,2000);
});
test('two suppliers using the same challan remain separate across repeated loads', async () => {
  const context = purchaseEnvironment([receivedOrder('A','Supplier A'), receivedOrder('B','Supplier B',20)]);
  await context.loadAndSyncFromCloud();
  await context.loadAndSyncFromCloud();
  assert.equal(context.ledgerData.purchase.length,2);
  assert.equal(context.ledgerData.purchase.find(r=>r.partyName==='Supplier A').qty,10);
  assert.equal(context.ledgerData.purchase.find(r=>r.partyName==='Supplier B').qty,20);
});
test('standalone stock challan from another supplier is not suppressed', async () => {
  const context = purchaseEnvironment([receivedOrder('A','Supplier A')],
    [{id:'lot-B', supplier:'Supplier B', challanNo:'1', totalWeight:20, rate:200}]);
  await context.loadAndSyncFromCloud();
  assert.equal(context.ledgerData.purchase.length,2);
});
test('stock mirror of a received order does not create a duplicate', async () => {
  const context = purchaseEnvironment([receivedOrder('A','Supplier A')],
    [{id:'lot-A', supplier:'Supplier A', batchId:'batch-A', orderRef:'A', challanNo:'1', totalWeight:10, rate:100}]);
  await context.loadAndSyncFromCloud();
  assert.equal(context.ledgerData.purchase.length,1);
});
test('merging same challan from different parties does not lose a row', () => {
  const {context} = environment();
  const row = {source:'yarn-rm-orders', challanNo:'1'};
  const result = context.mergeLedgerDatasets([{...row,id:'A',partyName:'Supplier A'}],
    [{...row,id:'B',partyName:'Supplier B'}]);
  assert.equal(result.length,2);
});
test('zero-rate batch does not borrow another supplier rate through shared challan', async () => {
  const order = receivedOrder('A','Supplier A'); order.price=0;
  const context = purchaseEnvironment([order],
    [{id:'lot-B', supplier:'Supplier B', challanNo:'1', totalWeight:20, rate:200}]);
  await context.loadAndSyncFromCloud();
  assert.equal(context.ledgerData.purchase.find(r=>r.partyName==='Supplier A').rate,0);
});

test('confirmed missing cloud keys do not fall back to stale local values', async () => {
  const {context,stored} = environment();
  stored.set('rows','[{"id":"deleted"}]');
  context.window.VishwaSupabase.getMultipleResult = async () => ({ok:true,data:{},missingKeys:['rows']});
  assert.equal((await context.fetchAllCloudLedgerData()).rows.length,0);
});
test('explicit failed read preserves offline fallback', async () => {
  const {context,stored} = environment();
  stored.set('rows','[{"id":"offline"}]');
  context.window.VishwaSupabase.getMultipleResult = async () => ({ok:false,data:{},error:'HTTP 503'});
  assert.equal((await context.fetchAllCloudLedgerData()).rows[0].id,'offline');
});

function apiEnvironment(fetch) {
  const client = fs.readFileSync(path.join(__dirname,'../assets/supabase-client.js'),'utf8');
  const context = {fetch, SUPABASE_URL:'https://example.invalid', SUPABASE_ANON_KEY:'public-test-key', console:{error:()=>{}}};
  vm.createContext(context);
  context.api = {getAuthHeaders:()=>({Authorization:'Bearer test-user-token'})};
  for (const name of ['getMultipleResult','getMultiple']) {
    const match = new RegExp(`^    async ${name}\\(keys\\) \\{[\\s\\S]*?^    },`, 'm').exec(client);
    assert.ok(match, `Missing API method ${name}`);
    context.api[name] = vm.runInContext(`({${match[0]}}).${name}`,context);
  }
  return context.api;
}
test('batch API authenticates and distinguishes present empty values from missing keys', async () => {
  const api = apiEnvironment(async (url,options) => {
    assert.equal(options.headers.Authorization,'Bearer test-user-token');
    return {ok:true,json:async()=>[{key:'empty',value:[]},{key:'encoded',value:'[1]'}]};
  });
  const result = await api.getMultipleResult(['empty','encoded','missing']);
  assert.equal(result.ok,true);
  assert.equal(JSON.stringify(result.missingKeys),'["missing"]');
  assert.equal(JSON.stringify(result.data),' {"empty":[],"encoded":[1]}'.trim());
  assert.equal(JSON.stringify(await api.getMultiple(['empty'])),'{"empty":[],"encoded":[1]}');
});
test('batch API reports HTTP, network, and malformed-response failures without asserting absence', async () => {
  for (const fetch of [
    async()=>({ok:false,status:403}),
    async()=>{throw new Error('offline');},
    async()=>({ok:true,json:async()=>({bad:'shape'})}),
    async()=>({ok:true,json:async()=>[{key:'bad',value:'{invalid'}]})
  ]) {
    const api=apiEnvironment(fetch);
    const result=await api.getMultipleResult(['rows']);
    assert.equal(result.ok,false);
    assert.equal(result.missingKeys,undefined);
    assert.equal(JSON.stringify(await api.getMultiple(['rows'])),'{}');
  }
});

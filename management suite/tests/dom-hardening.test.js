/**
 * DOM Injection & Input Hardening Test Suite (Phase 5)
 * Vishwa Atelier Management Suite
 *
 * Verifies:
 * 1. escapeHtml and sanitizeUrl helper semantics (neutralizing XSS, preserving Unicode/Gujarati, numbers, nulls).
 * 2. Neutralization of hostile URI schemes (javascript:, vbscript:, data:).
 * 3. Elimination of unescaped attribute injection patterns in modified modules.
 * 4. Zero regression to core factory calculation results when sanitized.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    testsFailed++;
  }
}

console.log('--- Phase 5: DOM Injection & Input Hardening Test Suite ---');

// Load supabase-client.js to test window.escapeHtml and window.sanitizeUrl
const mockWindow = {
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { href: 'http://localhost' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
};
global.window = mockWindow;
global.document = {
  addEventListener: () => {},
  removeEventListener: () => {}
};

const supabaseClientPath = path.join(__dirname, '../assets/supabase-client.js');
const clientCode = fs.readFileSync(supabaseClientPath, 'utf8');

// Evaluate the helpers in isolation
const clientModule = new Function('window', 'document', `${clientCode}; return { escapeHtml: window.escapeHtml, sanitizeUrl: window.sanitizeUrl, VishwaAuth: window.VishwaAuth };`)(mockWindow, global.document);

const escapeHtml = clientModule.escapeHtml;
const sanitizeUrl = clientModule.sanitizeUrl;

// -------------------------------------------------------------
// Group 1: escapeHtml Core Semantics
// -------------------------------------------------------------
test('escapeHtml: escapes HTML special characters properly', () => {
  assert.strictEqual(escapeHtml('<script>alert("XSS")</script>'), '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
  assert.strictEqual(escapeHtml("Tom & Jerry's 'Adventure'"), 'Tom &amp; Jerry&#039;s &#039;Adventure&#039;');
  assert.strictEqual(escapeHtml('"><img src=x onerror=alert(1)>'), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
});

test('escapeHtml: handles null, undefined, and non-string types safely', () => {
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.strictEqual(escapeHtml(0), '0');
  assert.strictEqual(escapeHtml(1234.56), '1234.56');
  assert.strictEqual(escapeHtml(-42), '-42');
  assert.strictEqual(escapeHtml(false), 'false');
});

test('escapeHtml: preserves Gujarati and Indic Unicode scripts without corruption', () => {
  const gujaratiText = 'વિશ્વા એટેલિયર - ખાતા નં ૧૨૩૪';
  assert.strictEqual(escapeHtml(gujaratiText), gujaratiText);
  const hindiText = 'नमस्ते दुनिया - ₹५०००';
  assert.strictEqual(escapeHtml(hindiText), hindiText);
});

// -------------------------------------------------------------
// Group 2: sanitizeUrl Core Semantics
// -------------------------------------------------------------
test('sanitizeUrl: neutralizes javascript: and vbscript: URIs', () => {
  assert.strictEqual(sanitizeUrl('javascript:alert(1)'), 'about:blank');
  assert.strictEqual(sanitizeUrl('JAVASCRIPT:alert(document.cookie)'), 'about:blank');
  assert.strictEqual(sanitizeUrl('  javascript:void(0)  '), 'about:blank');
  assert.strictEqual(sanitizeUrl('vbscript:msgbox("hello")'), 'about:blank');
  assert.strictEqual(sanitizeUrl('VBSCRIPT:msgbox(1)'), 'about:blank');
});

test('sanitizeUrl: blocks data: URIs unless allowData is explicitly true', () => {
  assert.strictEqual(sanitizeUrl('data:text/html,<script>alert(1)</script>'), 'about:blank');
  assert.strictEqual(sanitizeUrl('DATA:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), 'about:blank');
  
  // When allowData is explicitly enabled (e.g. for canvas/image previews)
  const safeDataImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.strictEqual(sanitizeUrl(safeDataImg, true), safeDataImg);
});

test('sanitizeUrl: allows legitimate web and relative URLs', () => {
  assert.strictEqual(sanitizeUrl('https://example.com/assets/logo.png'), 'https://example.com/assets/logo.png');
  assert.strictEqual(sanitizeUrl('http://localhost:3000/api/view'), 'http://localhost:3000/api/view');
  assert.strictEqual(sanitizeUrl('/images/fabric-design.jpg'), '/images/fabric-design.jpg');
  assert.strictEqual(sanitizeUrl('../assets/style.css'), '../assets/style.css');
  assert.strictEqual(sanitizeUrl('blob:https://example.com/uuid-1234'), 'blob:https://example.com/uuid-1234');
});

test('sanitizeUrl: handles empty, null, and non-string inputs gracefully', () => {
  assert.strictEqual(sanitizeUrl(''), '');
  assert.strictEqual(sanitizeUrl(null), '');
  assert.strictEqual(sanitizeUrl(undefined), '');
});

// -------------------------------------------------------------
// Group 3: Hardened Modules Verification
// -------------------------------------------------------------
test('modules/salary-sheet.html: dynamic renders use escapeHtml and safe data attributes', () => {
  const fileContent = fs.readFileSync(path.join(__dirname, '../modules/salary-sheet.html'), 'utf8');
  assert(fileContent.includes('escapeHtml(w)'), 'Worker names in summary table must be escaped');
  assert(fileContent.includes('escapeHtml(log.dayWorker || \'-\')'), 'Day worker in salary logs must be escaped');
  assert(fileContent.includes('escapeHtml(log.nightWorker || \'-\')'), 'Night worker in salary logs must be escaped');
  assert(fileContent.includes('escapeHtml(log.machineNumber)'), 'Machine numbers in salary logs must be escaped');
  assert(!fileContent.includes("openEditBeamLoadingModal('${"), 'No raw string interpolation in openEditBeamLoadingModal onclick');
  assert(!fileContent.includes("deleteBeamLoadingEntry('${"), 'No raw string interpolation in deleteBeamLoadingEntry onclick');
});

test('modules/manage.html: suppliers, looms, and jacquards use escapeHtml and safe attributes', () => {
  const fileContent = fs.readFileSync(path.join(__dirname, '../modules/manage.html'), 'utf8');
  assert(fileContent.includes('escapeHtml(s.name)'), 'Supplier names must be escaped');
  assert(fileContent.includes('escapeHtml(l.name)'), 'Loom names must be escaped');
  assert(fileContent.includes('escapeHtml(j.name)'), 'Jacquard names must be escaped');
  assert(!fileContent.includes("onclick=\"deleteLoom('${"), 'No raw interpolation in deleteLoom onclick');
  assert(!fileContent.includes("onclick=\"deleteJacquard('${"), 'No raw interpolation in deleteJacquard onclick');
});

test('modules/yarn/yarn-production.html: logs and mobile cards use escapeHtml and safe attributes', () => {
  const fileContent = fs.readFileSync(path.join(__dirname, '../modules/yarn/yarn-production.html'), 'utf8');
  assert(fileContent.includes('escapeHtml(l.boriNo)'), 'Bori number must be escaped');
  assert(fileContent.includes('escapeHtml(displayProdName)'), 'Product name must be escaped');
  assert(!fileContent.includes("printProductionPackingSlip('${l.id}')"), 'Packing slip print must use data attribute');
  assert(!fileContent.includes("deleteProductionLog('${l.id}')"), 'Delete prod log must use data attribute');
});

test('modules/yarn/yarn-sales.html: sales rows and mobile cards use escapeHtml and safe attributes', () => {
  const fileContent = fs.readFileSync(path.join(__dirname, '../modules/yarn/yarn-sales.html'), 'utf8');
  assert(fileContent.includes('escapeHtml(s.customerName)'), 'Customer name must be escaped');
  assert(fileContent.includes('escapeHtml(s.agentName)'), 'Agent name must be escaped');
  assert(!fileContent.includes("printSaleBill('${s.id}')"), 'Print bill must use data attribute');
  assert(!fileContent.includes("deleteSalesLog('${s.id}')"), 'Delete sale log must use data attribute');
});

test('modules/yarn/yarn-stock-dashboard.html: stock items use escapeHtml and data-key', () => {
  const fileContent = fs.readFileSync(path.join(__dirname, '../modules/yarn/yarn-stock-dashboard.html'), 'utf8');
  assert(fileContent.includes('escapeHtml(item.productName)'), 'Stock product name must be escaped');
  assert(fileContent.includes('escapeHtml(item.lotNo)'), 'Stock lot number must be escaped');
  assert(!fileContent.includes("openStockSellPrompt('${safeKey}')"), 'Sell button must use data-key attribute');
});

test('modules/weaving/weaving-production.html: design images use sanitizeUrl and specs use escapeHtml', () => {
  const fileContent = fs.readFileSync(path.join(__dirname, '../modules/weaving/weaving-production.html'), 'utf8');
  assert(fileContent.includes('sanitizeUrl(design.originalImage'), 'Original image must be sanitized');
  assert(fileContent.includes('sanitizeUrl(design.specImage'), 'Spec image must be sanitized');
  assert(fileContent.includes('escapeHtml(design.designer)'), 'Designer must be escaped');
  assert(fileContent.includes('escapeHtml(serial)'), 'Serial rejection notice must be escaped');
});

test('sidebar.js: cut-beam and global beamcard use escapeHtml and safe data attributes', () => {
  const fileContent = fs.readFileSync(path.join(__dirname, '../sidebar.js'), 'utf8');
  assert(fileContent.includes('escapeHtml(beamNumber || \'\')'), 'Beam number in cut modal must be escaped');
  assert(fileContent.includes('escapeHtml(beam.beamNumber)'), 'Beam card header must be escaped');
  assert(fileContent.includes('escapeHtml(g.takaSerial)'), 'Taka serial in beam timeline must be escaped');
  assert(!fileContent.includes("revertLastBeamMove('${beam.id"), 'Revert beam move must use data attribute');
});

// -------------------------------------------------------------
// Group 4: Preserving Zero-Regression Factory Calculations
// -------------------------------------------------------------
test('calculation fidelity: escaped inputs do not affect numeric computations', () => {
  const testQty = '123.45';
  const testRate = '250.00';
  const testDiscount = '10.00';
  const testGst = '5.00';

  const numQty = parseFloat(escapeHtml(testQty)) || 0;
  const numRate = parseFloat(escapeHtml(testRate)) || 0;
  const subtotal = numQty * numRate;
  const discountAmount = subtotal * (parseFloat(escapeHtml(testDiscount)) / 100);
  const taxable = subtotal - discountAmount;
  const gstAmount = taxable * (parseFloat(escapeHtml(testGst)) / 100);
  const grandTotal = taxable + gstAmount;

  assert.strictEqual(subtotal, 30862.5);
  assert.strictEqual(discountAmount, 3086.25);
  assert.strictEqual(taxable, 27776.25);
  assert.strictEqual(gstAmount, 1388.8125);
  assert.strictEqual(grandTotal, 29165.0625);
});

console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('All Phase 5 DOM Hardening tests passed successfully!\n');
}

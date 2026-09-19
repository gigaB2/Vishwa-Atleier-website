/**
 * Phase 9: Security Headers and Hosting Configuration Test Suite
 * Zero external dependencies — runs directly in Node.js test runner or script runner.
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

console.log('--- Phase 9: Security Headers & Hosting Configuration Test Suite ---');

const rootDir = path.resolve(__dirname, '../..');
const vercelConfigPath = path.join(rootDir, 'vercel.json');

// Test 1: vercel.json exists and parses cleanly
assert(fs.existsSync(vercelConfigPath), 'vercel.json must exist at project root');
const rawConfig = fs.readFileSync(vercelConfigPath, 'utf8');
let vercelConfig;
try {
  vercelConfig = JSON.parse(rawConfig);
} catch (e) {
  assert.fail('vercel.json must be valid JSON: ' + e.message);
}
assert(Array.isArray(vercelConfig.headers), 'vercel.json must define a headers array');
console.log('  ✓ vercel.json exists at root and contains valid JSON headers configuration');

// Helper to find headers for a source pattern
function getHeadersForSource(source) {
  const match = vercelConfig.headers.find(h => h.source === source);
  if (!match || !Array.isArray(match.headers)) return {};
  const map = {};
  for (const item of match.headers) {
    map[item.key.toLowerCase()] = item.value;
  }
  return map;
}

const rootHeaders = getHeadersForSource('/(.*)');

// Test 2: X-Content-Type-Options is nosniff
assert.strictEqual(
  rootHeaders['x-content-type-options'],
  'nosniff',
  'X-Content-Type-Options must be set to nosniff'
);
console.log('  ✓ X-Content-Type-Options: nosniff enforced on all routes');

// Test 3: X-Frame-Options is SAMEORIGIN (prevents clickjacking while preserving internal suite iframes)
assert.strictEqual(
  rootHeaders['x-frame-options'],
  'SAMEORIGIN',
  'X-Frame-Options must be SAMEORIGIN'
);
console.log('  ✓ X-Frame-Options: SAMEORIGIN configured to protect iframes without breaking internal modules');

// Test 4: Referrer-Policy and Permissions-Policy
assert.strictEqual(
  rootHeaders['referrer-policy'],
  'strict-origin-when-cross-origin',
  'Referrer-Policy must be strict-origin-when-cross-origin'
);
assert(
  rootHeaders['permissions-policy'] &&
  rootHeaders['permissions-policy'].includes('camera=(self)') &&
  rootHeaders['permissions-policy'].includes('microphone=()') &&
  rootHeaders['permissions-policy'].includes('geolocation=()'),
  'Permissions-Policy must allow camera for self and disable unused hardware'
);
console.log('  ✓ Referrer-Policy and Permissions-Policy configured securely');

// Test 5: Strict-Transport-Security (HSTS)
assert(
  rootHeaders['strict-transport-security'] &&
  rootHeaders['strict-transport-security'].includes('max-age=31536000') &&
  rootHeaders['strict-transport-security'].includes('includeSubDomains'),
  'Strict-Transport-Security must enforce 1-year max-age and subdomains'
);
console.log('  ✓ Strict-Transport-Security (HSTS) configured for HTTPS enforcement');

// Test 6: Content-Security-Policy-Report-Only encompasses all required origins
const csp = rootHeaders['content-security-policy-report-only'];
assert(csp, 'Content-Security-Policy-Report-Only must be defined');
assert(csp.includes("connect-src 'self' https://*.supabase.co wss://*.supabase.co"), 'CSP must allow Supabase REST and WebSocket connections');
assert(csp.includes("script-src 'self' 'unsafe-inline' 'unsafe-eval'"), 'CSP must allow legacy inline and evaluated scripts in report-only');
assert(csp.includes('https://cdn.tailwindcss.com') && csp.includes('https://unpkg.com') && csp.includes('https://cdn.jsdelivr.net'), 'CSP must whitelist approved CDNs');
assert(csp.includes('https://fonts.googleapis.com') && csp.includes('https://fonts.gstatic.com'), 'CSP must whitelist Google Fonts');
assert(csp.includes("frame-ancestors 'self'"), 'CSP must restrict framing to self');
console.log('  ✓ Content-Security-Policy-Report-Only whitelists all required CDNs, fonts, and Supabase endpoints');

// Test 7: Differentiated caching policies
const htmlHeaders = getHeadersForSource('/(.*)\\.(html|htm)');
const slashHeaders = getHeadersForSource('/');
const configHeaders = getHeadersForSource('/management suite/assets/config.js');
const staticHeaders = getHeadersForSource('/(assets|css|js|lookbooks)/(.*)');

assert(
  htmlHeaders['cache-control'] && htmlHeaders['cache-control'].includes('must-revalidate'),
  'HTML files must have must-revalidate cache policy'
);
assert(
  slashHeaders['cache-control'] && slashHeaders['cache-control'].includes('must-revalidate'),
  'Root path must have must-revalidate cache policy'
);
assert(
  configHeaders['cache-control'] && configHeaders['cache-control'].includes('must-revalidate'),
  'config.js must have must-revalidate cache policy to ensure immediate credential updates'
);
assert(
  staticHeaders['cache-control'] && staticHeaders['cache-control'].includes('immutable'),
  'Static assets must have immutable cache policy'
);
console.log('  ✓ Differentiated caching policies correctly configured for immediate HTML/config vs immutable assets');

console.log('\nResults: 7 passed, 0 failed');
console.log('All Phase 9 Security Headers tests passed successfully!\n');

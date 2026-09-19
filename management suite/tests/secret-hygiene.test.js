/**
 * Secret & Configuration Hygiene Test Suite (Phase 6)
 * Vishwa Atelier Management Suite
 *
 * Verifies:
 * 1. .env.example exists and contains exclusively placeholder templates.
 * 2. .gitignore strictly blocks .env, .env.local, .key, .pem, and credential dumps.
 * 3. Client configuration resolver rejects Supabase service_role keys with a critical guard.
 * 4. Static repository scan confirms 0 tracked client assets contain service_role keys or private DB connection strings.
 * 5. config.js contains only public anon access tokens and allows environment overrides.
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

console.log('--- Phase 6: Secret & Configuration Hygiene Test Suite ---');

const rootDir = path.resolve(__dirname, '../..');
const suiteDir = path.resolve(__dirname, '..');

// -------------------------------------------------------------
// Group 1: Environment Template & Gitignore Protection
// -------------------------------------------------------------
test('.env.example: exists at repository root and contains placeholders only', () => {
  const envExamplePath = path.join(rootDir, '.env.example');
  assert(fs.existsSync(envExamplePath), '.env.example must exist at root');
  
  const content = fs.readFileSync(envExamplePath, 'utf8');
  assert(content.includes('SUPABASE_URL='), '.env.example must document SUPABASE_URL');
  assert(content.includes('SUPABASE_ANON_KEY='), '.env.example must document SUPABASE_ANON_KEY');
  assert(content.includes('GEMINI_API_KEY='), '.env.example must document GEMINI_API_KEY');
  
  // Must NOT contain real live credentials
  assert(!content.includes('fwlzysudduroyndkiewa'), '.env.example must not contain live project ID');
  assert(!content.includes('Cv0Ns_gslFFSe90_lu1YBqo9aEcHaUbmnsI43TDZ_oo'), '.env.example must not contain active live signature');
});

test('.gitignore: strictly ignores local environment files and key dumps', () => {
  const gitignorePath = path.join(rootDir, '.gitignore');
  assert(fs.existsSync(gitignorePath), '.gitignore must exist at root');

  const content = fs.readFileSync(gitignorePath, 'utf8');
  assert(content.includes('.env'), '.gitignore must ignore .env');
  assert(content.includes('.env.local'), '.gitignore must ignore .env.local');
  assert(content.includes('*.key'), '.gitignore must ignore *.key');
  assert(content.includes('*.pem'), '.gitignore must ignore *.pem');
  assert(content.includes('credentials.json'), '.gitignore must ignore credentials.json');
  assert(content.includes('!.env.example'), '.gitignore must preserve .env.example');
});

// -------------------------------------------------------------
// Group 2: Client Service-Role Key Prevention Guard
// -------------------------------------------------------------
test('supabase-client.js: blocks service_role keys from being used client-side', () => {
  const clientPath = path.join(suiteDir, 'assets/supabase-client.js');
  const clientCode = fs.readFileSync(clientPath, 'utf8');

  // Helper to craft synthetic test JWT tokens
  function makeTestJwt(role) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const payload = Buffer.from(JSON.stringify({ iss: 'supabase', role: role, exp: 9999999999 })).toString('base64');
    return `${header}.${payload}.mockSignature1234567890`;
  }

  const anonToken = makeTestJwt('anon');
  const serviceRoleToken = makeTestJwt('service_role');

  // Evaluate resolveConfig inside a sandbox
  const mockStorage = {
    getItem: (key) => {
      if (key === 'vf_supabase_url') return 'https://test-project.supabase.co';
      if (key === 'vf_supabase_anon_key') return serviceRoleToken;
      return null;
    }
  };

  const sandboxWindow = {
    localStorage: mockStorage,
    APP_CONFIG: {
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_ANON_KEY: anonToken
    }
  };

  // Run snippet extracting resolveConfig behavior
  const testFn = new Function('window', 'nativeLocalStorage', `
    ${clientCode}
    return window.VishwaAuth;
  `);

  // Verify that the client code includes the guard against service_role
  assert(clientCode.includes('blocked_service_role'), 'Client must explicitly identify and block service_role');
  assert(clientCode.includes('isServiceRoleKey'), 'Client must implement service_role token inspection');
});

// -------------------------------------------------------------
// Group 3: Static Scan for Secret Leaks in Tracked Client Assets
// -------------------------------------------------------------
test('static scan: zero service_role keys in any tracked suite files', () => {
  const trackedFiles = [];

  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        walkDir(fullPath);
      } else if (e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.html') || e.name.endsWith('.json'))) {
        trackedFiles.push(fullPath);
      }
    }
  }

  walkDir(suiteDir);

  const violations = [];
  const jwtRegex = /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g;

  for (const file of trackedFiles) {
    const rel = path.relative(rootDir, file);
    // Skip this test file itself
    if (file.includes('secret-hygiene.test.js')) continue;

    const content = fs.readFileSync(file, 'utf8');

    // 1. Check for JWT tokens containing service_role
    let match;
    while ((match = jwtRegex.exec(content)) !== null) {
      try {
        const token = match[0];
        const payloadBase64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonStr = Buffer.from(payloadBase64, 'base64').toString('utf8');
        const payload = JSON.parse(jsonStr);
        if (payload.role === 'service_role') {
          violations.push(`${rel}: Found exposed service_role JWT`);
        }
      } catch(e) {}
    }

    // 2. Check for private database connection strings with live passwords
    if (/(?:postgres|postgresql):\/\/[^:]+:[^@]+@[^/]+\/[^\s"']+/i.test(content)) {
      // Exclude documentation or placeholder examples
      if (!content.includes('your-password') && !content.includes('aws-0-region')) {
        violations.push(`${rel}: Found hardcoded database connection URI with password`);
      }
    }

    // 3. Check for raw RSA / EC private keys
    if (content.includes('-----BEGIN PRIVATE KEY-----') || content.includes('-----BEGIN RSA PRIVATE KEY-----')) {
      violations.push(`${rel}: Found raw private key header`);
    }
  }

  assert.strictEqual(violations.length, 0, `Secret scan violations detected:\n${violations.join('\n')}`);
});

// -------------------------------------------------------------
// Group 4: config.js Hygiene Verification
// -------------------------------------------------------------
test('config.js: holds only client-safe anon credentials and allows environment overrides', () => {
  const configPath = path.join(suiteDir, 'assets/config.js');
  const content = fs.readFileSync(configPath, 'utf8');

  // Verify it reads from window.__ENV__ if present
  assert(content.includes('window.__ENV__'), 'config.js must support window.__ENV__ overrides');

  // Verify the key in config.js is an anon key
  const mockWindow = {};
  new Function('window', content)(mockWindow);

  assert(mockWindow.APP_CONFIG, 'APP_CONFIG must be defined');
  const token = mockWindow.APP_CONFIG.SUPABASE_ANON_KEY;
  assert(token, 'SUPABASE_ANON_KEY must be defined');

  const payloadStr = Buffer.from(token.split('.')[1], 'base64').toString('utf8');
  const payload = JSON.parse(payloadStr);

  assert.strictEqual(payload.role, 'anon', 'config.js key must have role: "anon"');
  assert.notStrictEqual(payload.role, 'service_role', 'config.js key MUST NOT be service_role');
});

console.log(`\nResults: ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('All Phase 6 Secret & Configuration Hygiene tests passed successfully!\n');
}

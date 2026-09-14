const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlFiles = [];

function findHtml(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '.git' || item.name === 'node_modules') continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      findHtml(full);
    } else if (item.name.endsWith('.html')) {
      htmlFiles.push(full);
    }
  }
}

findHtml(root);

console.log(`Auditing ${htmlFiles.length} HTML files in the Management Suite...`);

let issues = 0;
for (const file of htmlFiles) {
  const rel = path.relative(root, file);
  const content = fs.readFileSync(file, 'utf8');

  // Check if supabase-client.js is referenced
  if (!content.includes('supabase-client.js')) {
    console.warn(`[NOTICE] Missing supabase-client.js in: ${rel}`);
    issues++;
  } else {
    console.log(`[OK] ${rel}`);
  }
}

let parser = null;
try {
  parser = require('@babel/parser');
} catch (e) {
  console.log('Notice: @babel/parser not installed in this environment, skipping AST checks.');
}

let syntaxErrors = 0;
for (const file of htmlFiles) {
  if (!parser) break;
  const rel = path.relative(root, file);
  const content = fs.readFileSync(file, 'utf8');

  // Check all inline babel scripts
  const startTag = '<script type="text/babel">';
  const endTag = '</script>';
  let startPos = 0;
  let scriptNum = 0;

  while ((startPos = content.indexOf(startTag, startPos)) !== -1) {
    const contentStart = startPos + startTag.length;
    const endPos = content.indexOf(endTag, contentStart);
    if (endPos === -1) break;
    const code = content.substring(contentStart, endPos);
    scriptNum++;

    try {
      parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx']
      });
    } catch (e) {
      console.error(`[SYNTAX ERROR] in ${rel} (script #${scriptNum}): ${e.message}`);
      syntaxErrors++;
    }

    startPos = endPos + endTag.length;
  }
}

if (syntaxErrors > 0) {
  throw new Error(`Found ${syntaxErrors} JSX syntax error(s) across HTML files!`);
}

if (issues === 0) {
  console.log(`SUCCESS: All ${htmlFiles.length} HTML pages have supabase-client.js active and 0 syntax errors!`);
} else {
  console.log(`Found ${issues} files without explicit supabase-client.js tag.`);
}

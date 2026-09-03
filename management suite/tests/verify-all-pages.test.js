const fs = require('fs');
const path = require('path');

const root = 'c:\\Users\\Admin\\Desktop\\Websi\\Website\\management suite';
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

if (issues === 0) {
  console.log(`SUCCESS: All ${htmlFiles.length} HTML pages have supabase-client.js active!`);
} else {
  console.log(`Found ${issues} files without explicit supabase-client.js tag.`);
}

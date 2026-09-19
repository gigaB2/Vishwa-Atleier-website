/**
 * Accessibility (a11y) & SEO Standards Test Suite (Phase 8)
 * 
 * Verifies:
 * 1. Heading Hierarchy: Exactly one <h1> per public page to maintain clean document outlines.
 * 2. Semantic Button Types: All <button> elements have an explicit type="button" or type="submit".
 * 3. Reverse Tabnabbing Defense: All target="_blank" links include rel="noopener noreferrer".
 * 4. Control Accessibility: Icon-only buttons provide descriptive aria-label or accessible text.
 * 5. Image Alternative Text: 100% of <img> elements have non-empty alt text descriptions.
 * 6. Search & Sitemap Alignment: Canonical tags match domain URLs and sitemap.xml records valid routes.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Phase 8: Accessibility & SEO Standards Test Suite ---');

const ROOT_DIR = path.resolve(__dirname, '../../');
const PUBLIC_PAGES = [
  'index.html',
  'airjet-fabric-manufacturer-surat.html',
  'jacquard-fabric-manufacturer-surat.html'
];

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

// 1. Heading Hierarchy: Single <h1> per page
runTest('Each public HTML page has exactly one <h1> heading', () => {
  PUBLIC_PAGES.forEach(pageName => {
    const content = fs.readFileSync(path.join(ROOT_DIR, pageName), 'utf8');
    const h1Matches = content.match(/<h1[\s\S]*?<\/h1>/gi) || [];
    assert.strictEqual(h1Matches.length, 1, `${pageName} must have exactly one <h1> element, found ${h1Matches.length}`);
  });
});

// 2. Semantic Button Types: Every button has explicit type
runTest('All <button> elements define an explicit type attribute', () => {
  PUBLIC_PAGES.forEach(pageName => {
    const content = fs.readFileSync(path.join(ROOT_DIR, pageName), 'utf8');
    const buttonMatches = content.match(/<button[\s\S]*?>/gi) || [];
    
    buttonMatches.forEach(buttonTag => {
      const hasType = /type=["'](button|submit|reset)["']/i.test(buttonTag);
      assert.ok(hasType, `Button in ${pageName} missing explicit type attribute: ${buttonTag.slice(0, 60)}...`);
    });
  });
});

// 3. Tabnabbing Defense: All target="_blank" links have rel="noopener noreferrer"
runTest('All target="_blank" links specify rel="noopener noreferrer"', () => {
  PUBLIC_PAGES.forEach(pageName => {
    const content = fs.readFileSync(path.join(ROOT_DIR, pageName), 'utf8');
    const targetBlankMatches = content.match(/<a\b[^>]*target=["']_blank["'][^>]*>/gi) || [];
    
    targetBlankMatches.forEach(aTag => {
      const hasRel = /rel=["'][^"']*noopener[^"']*noreferrer[^"']*["']/i.test(aTag) ||
                     /rel=["'][^"']*noreferrer[^"']*noopener[^"']*["']/i.test(aTag);
      assert.ok(hasRel, `Link in ${pageName} with target="_blank" must include rel="noopener noreferrer": ${aTag.slice(0, 70)}...`);
    });
  });
});

// 4. Control Accessibility: All icon-only buttons provide aria-label or accessible text
runTest('All icon-only buttons provide descriptive aria-label attributes', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
  const iconButtonIds = [
    'mobile-toggle-btn',
    'lb-prev-btn',
    'lb-next-btn',
    'gc-prev-btn',
    'gc-next-btn',
    'modal-close-btn'
  ];

  iconButtonIds.forEach(id => {
    const btnRegex = new RegExp(`<button[^>]*id=["']${id}["'][^>]*>`, 'i');
    const match = indexHtml.match(btnRegex);
    assert.ok(match, `Button #${id} must exist in index.html`);
    assert.ok(
      /aria-label=["'][^"']+["']/i.test(match[0]),
      `Button #${id} must have a descriptive aria-label: ${match[0]}`
    );
  });
});

// 5. Image Alternative Text: 100% of <img> tags have non-empty alt text
runTest('All <img> elements define meaningful alt attributes', () => {
  PUBLIC_PAGES.forEach(pageName => {
    const content = fs.readFileSync(path.join(ROOT_DIR, pageName), 'utf8');
    const imgMatches = content.match(/<img[^>]*>/gi) || [];
    
    imgMatches.forEach(imgTag => {
      const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);
      assert.ok(altMatch, `Image in ${pageName} must have an alt attribute: ${imgTag.slice(0, 60)}...`);
      assert.ok(altMatch[1].trim().length > 0, `Image in ${pageName} must have non-empty alt text: ${imgTag.slice(0, 60)}...`);
    });
  });
});

// 6. Search Engine Optimization & Sitemap Alignment
runTest('Robots.txt, Sitemap, and canonical tags align with production domain', () => {
  const robotsTxt = fs.readFileSync(path.join(ROOT_DIR, 'robots.txt'), 'utf8');
  assert.ok(robotsTxt.includes('Disallow: /management suite/'), 'robots.txt must protect management suite');
  assert.ok(robotsTxt.includes('Sitemap: https://vishwaatelier.com/sitemap.xml'), 'robots.txt must declare sitemap URL');

  const sitemapXml = fs.readFileSync(path.join(ROOT_DIR, 'sitemap.xml'), 'utf8');
  assert.ok(sitemapXml.includes('https://vishwaatelier.com/'), 'sitemap must include homepage');
  assert.ok(sitemapXml.includes('https://vishwaatelier.com/airjet-fabric-manufacturer-surat.html'), 'sitemap must include airjet page');
  assert.ok(sitemapXml.includes('https://vishwaatelier.com/jacquard-fabric-manufacturer-surat.html'), 'sitemap must include jacquard page');

  PUBLIC_PAGES.forEach(pageName => {
    const content = fs.readFileSync(path.join(ROOT_DIR, pageName), 'utf8');
    const canonicalMatch = content.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
    assert.ok(canonicalMatch, `${pageName} must define a canonical link tag`);
    assert.ok(canonicalMatch[1].startsWith('https://vishwaatelier.com/'), `${pageName} canonical URL must be absolute HTTPS: ${canonicalMatch[1]}`);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
console.log('All Phase 8 Accessibility & SEO tests passed successfully!\n');
process.exit(0);

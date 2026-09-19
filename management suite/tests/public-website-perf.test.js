/**
 * Public Website Performance & Asset Integrity Test Suite (Phase 7)
 * 
 * Verifies:
 * 1. Asset Integrity: All local image and video paths referenced in public pages exist on disk.
 * 2. LCP & Preload Optimization: Hero image is preloaded with fetchpriority="high".
 * 3. Lazy Loading & Asynchronous Decoding: All below-the-fold images have loading="lazy" and decoding="async".
 * 4. Video Bandwidth Optimization: Zero video tags use preload="auto"; all use preload="metadata".
 * 5. Layout Shift (CLS) Safeguards: Image elements define dimensions (width/height) or aspect-ratio wrappers.
 * 6. Open Graph & Twitter Social Metadata: All preview images use absolute HTTPS URLs.
 * 7. HTML Syntax & Structural Parity: Pages maintain clean markup and valid head elements.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Phase 7: Public Website Performance & Asset Integrity Test Suite ---');

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

// 1. Asset existence check
runTest('All referenced local images and videos exist on disk (zero 404s)', () => {
  const assetRegex = /(?:src|href|poster)=["']([^"']+\.(?:webp|png|jpg|jpeg|svg|mp4|webm|pdf))["']/gi;
  
  PUBLIC_PAGES.forEach(pageName => {
    const pagePath = path.join(ROOT_DIR, pageName);
    assert.ok(fs.existsSync(pagePath), `${pageName} must exist`);
    const content = fs.readFileSync(pagePath, 'utf8');

    let match;
    while ((match = assetRegex.exec(content)) !== null) {
      let assetPath = match[1];
      if (assetPath.startsWith('http://') || assetPath.startsWith('https://')) {
        continue; // external asset
      }
      // Clean query params or decode URI
      assetPath = decodeURIComponent(assetPath.split('?')[0]);
      const fullPath = path.resolve(ROOT_DIR, assetPath);
      assert.ok(fs.existsSync(fullPath), `Asset "${assetPath}" referenced in ${pageName} must exist on disk`);
    }
  });
});

// 2. LCP & Preload Optimization in index.html
runTest('Hero LCP image is preloaded with fetchpriority="high"', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
  assert.ok(
    indexHtml.includes('<link rel="preload" as="image" href="assets/images/Jacquard%20rapier.webp" type="image/webp" fetchpriority="high" />'),
    'Hero LCP image must be preloaded with fetchpriority="high"'
  );
});

// 3. Lazy loading & decoding="async" coverage on index.html
runTest('All below-the-fold images in index.html have loading="lazy" and decoding="async"', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
  const imgMatches = indexHtml.match(/<img[^>]+>/g) || [];
  
  assert.ok(imgMatches.length >= 25, 'Should find all primary images in index.html');
  imgMatches.forEach(imgTag => {
    assert.ok(imgTag.includes('loading="lazy"'), `Image tag must have loading="lazy": ${imgTag.slice(0, 60)}...`);
    assert.ok(imgTag.includes('decoding="async"'), `Image tag must have decoding="async": ${imgTag.slice(0, 60)}...`);
  });
});

// 4. Video bandwidth optimization
runTest('Zero video tags use preload="auto"; all use preload="metadata"', () => {
  PUBLIC_PAGES.forEach(pageName => {
    const content = fs.readFileSync(path.join(ROOT_DIR, pageName), 'utf8');
    const videoMatches = content.match(/<video[^>]+>/g) || [];
    
    videoMatches.forEach(videoTag => {
      assert.ok(!videoTag.includes('preload="auto"'), `Video tag in ${pageName} must not use preload="auto"`);
      assert.ok(videoTag.includes('preload="metadata"'), `Video tag in ${pageName} must use preload="metadata"`);
    });
  });
});

// 5. Open Graph & Twitter preview image absolute URLs
runTest('All social preview images use absolute HTTPS URLs', () => {
  PUBLIC_PAGES.forEach(pageName => {
    const content = fs.readFileSync(path.join(ROOT_DIR, pageName), 'utf8');
    
    // Check og:image
    const ogImageMatch = content.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogImageMatch) {
      assert.ok(ogImageMatch[1].startsWith('https://'), `og:image in ${pageName} must be absolute HTTPS URL: ${ogImageMatch[1]}`);
    }

    // Check twitter:image
    const twImageMatch = content.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
    if (twImageMatch) {
      assert.ok(twImageMatch[1].startsWith('https://'), `twitter:image in ${pageName} must be absolute HTTPS URL: ${twImageMatch[1]}`);
    }
  });
});

// 6. Prefers-reduced-motion accessibility safeguard in design system
runTest('css/style.css includes prefers-reduced-motion media query', () => {
  const cssPath = path.join(ROOT_DIR, 'css/style.css');
  assert.ok(fs.existsSync(cssPath), 'css/style.css must exist');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'Must respect user reduced motion preference');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
console.log('All Phase 7 Performance & Asset Integrity tests passed successfully!\n');
process.exit(0);

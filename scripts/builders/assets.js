/**
 * Asset & File Copying
 * Handles copying CSS, JS, assets, root files, hand-crafted pages, and portal pages.
 */

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function writeVersionJson(BUILD, versionInfo) {
  fs.writeFileSync(path.join(BUILD, 'version.json'), JSON.stringify(versionInfo, null, 2));
  console.log('  ✓ version.json written');
}

function copyCss(SRC, BUILD) {
  copyDir(path.join(SRC, 'css'), path.join(BUILD, 'src', 'css'));
  console.log('  ✓ CSS copied');
}

function copyJs(SRC, BUILD) {
  if (fs.existsSync(path.join(SRC, 'js'))) {
    copyDir(path.join(SRC, 'js'), path.join(BUILD, 'src', 'js'));
    console.log('  ✓ JS copied');
  }
}

function copyAssets(SRC, BUILD) {
  if (fs.existsSync(path.join(SRC, 'assets'))) {
    copyDir(path.join(SRC, 'assets'), path.join(BUILD, 'src', 'assets'));
    console.log('  ✓ Assets copied');
  }
}

function copyRootPages(SRC, BUILD, injectVersion) {
  const rootPages = ['index.html', 'contact.html', 'privacy.html', 'terms.html', 'login.html', '404.html'];
  for (const file of rootPages) {
    const src = path.join(SRC, 'pages', file);
    if (fs.existsSync(src)) {
      const content = fs.readFileSync(src, 'utf8');
      fs.writeFileSync(path.join(BUILD, file), injectVersion(content));
      console.log(`  ✓ ${file}`);
    }
  }
  return rootPages;
}

function copySubPages(SRC, BUILD, injectVersion) {
  const subPages = [
    ['about', 'index.html'],
    ['about', 'team.html'],
    ['about', 'locations.html'],
    ['about', 'community.html'],
    ['about', 'careers.html'],
  ];
  for (const [dir, file] of subPages) {
    const src = path.join(SRC, 'pages', dir, file);
    if (fs.existsSync(src)) {
      ensureDir(path.join(BUILD, dir));
      const content = fs.readFileSync(src, 'utf8');
      fs.writeFileSync(path.join(BUILD, dir, file), injectVersion(content));
      console.log(`  ✓ ${dir}/${file} (hand-crafted)`);
    }
  }
  return subPages;
}

function copyRootFiles(ROOT, BUILD) {
  for (const file of ['_redirects', '_headers', 'robots.txt', 'favicon.ico']) {
    const src = path.join(ROOT, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(BUILD, file));
      console.log(`  ✓ ${file}`);
    }
  }
}

function copyPortalPages(SRC, BUILD, injectVersion) {
  const portalPages = [
    { src: 'intake.html', dest: 'intake/index.html', sitemap: '/intake/' },
    { src: 'portal.html', dest: 'portal/index.html', sitemap: null },
    { src: 'partner.html', dest: 'partner/index.html', sitemap: null },
  ];
  for (const page of portalPages) {
    const srcFile = path.join(SRC, page.src);
    if (fs.existsSync(srcFile)) {
      const destDir = path.join(BUILD, path.dirname(page.dest));
      ensureDir(destDir);
      const pageContent = fs.readFileSync(srcFile, 'utf8');
      fs.writeFileSync(path.join(BUILD, page.dest), injectVersion(pageContent));
      console.log(`  ✓ ${page.dest}`);
    }
  }
  return portalPages;
}

module.exports = {
  ensureDir,
  copyDir,
  writeVersionJson,
  copyCss,
  copyJs,
  copyAssets,
  copyRootPages,
  copySubPages,
  copyRootFiles,
  copyPortalPages,
};

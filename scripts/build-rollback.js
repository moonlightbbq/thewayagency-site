#!/usr/bin/env node
/**
 * Build Rollback System
 * Snapshot, archive, rollback, and diff build outputs.
 *
 * Usage:
 *   node scripts/build-rollback.js snapshot  — save current build manifest
 *   node scripts/build-rollback.js archive   — compress build to .build-history/
 *   node scripts/build-rollback.js list       — show available snapshots
 *   node scripts/build-rollback.js diff [ver] — compare current vs snapshot
 *   node scripts/build-rollback.js rollback [ver] — restore a previous build
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const HISTORY = path.join(ROOT, '.build-history');

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectFiles(dir, base) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, rel));
    } else {
      const stat = fs.statSync(full);
      files.push({ path: rel, size: stat.size, sha256: sha256(full) });
    }
  }
  return files;
}

function getGitCommit() {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); }
  catch { return 'unknown'; }
}

function loadIndex() {
  const indexPath = path.join(HISTORY, 'index.json');
  if (fs.existsSync(indexPath)) return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  return { snapshots: [] };
}

function saveIndex(index) {
  fs.writeFileSync(path.join(HISTORY, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}

const cmd = process.argv[2];
const arg = process.argv[3];

if (!cmd || cmd === 'help') {
  console.log('Usage: node scripts/build-rollback.js <snapshot|archive|list|diff|rollback> [version]');
  process.exit(0);
}

ensureDir(HISTORY);

if (cmd === 'snapshot') {
  if (!fs.existsSync(BUILD)) { console.log('No build/ directory found.'); process.exit(1); }
  const files = collectFiles(BUILD, '');
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const manifest = {
    version: new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19),
    timestamp: new Date().toISOString(),
    gitCommit: getGitCommit(),
    fileCount: files.length,
    totalSize,
    files
  };
  const manifestPath = path.join(HISTORY, `manifest-${manifest.version}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const index = loadIndex();
  index.snapshots.push({ version: manifest.version, timestamp: manifest.timestamp, gitCommit: manifest.gitCommit, fileCount: files.length, totalSize });
  saveIndex(index);

  console.log(`Snapshot saved: ${manifest.version} (${files.length} files, ${(totalSize / 1024).toFixed(0)}KB)`);

} else if (cmd === 'archive') {
  if (!fs.existsSync(BUILD)) { console.log('No build/ directory found.'); process.exit(1); }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const archivePath = path.join(HISTORY, `build-${timestamp}.tar.gz`);
  try {
    execSync(`tar -czf "${archivePath}" -C "${ROOT}" build/`, { stdio: 'pipe' });
  } catch (e) {
    console.error('Failed to create archive:', e.message);
    process.exit(1);
  }

  // Keep only last 5 archives
  const archives = fs.readdirSync(HISTORY).filter(f => f.startsWith('build-') && f.endsWith('.tar.gz')).sort();
  while (archives.length > 5) {
    fs.unlinkSync(path.join(HISTORY, archives.shift()));
  }
  console.log(`Archived: ${path.basename(archivePath)} (${(fs.statSync(archivePath).size / 1024).toFixed(0)}KB)`);

} else if (cmd === 'list') {
  const index = loadIndex();
  if (index.snapshots.length === 0) { console.log('No snapshots found.'); process.exit(0); }
  console.log('\nAvailable snapshots:\n');
  for (const s of index.snapshots.slice(-10)) {
    console.log(`  ${s.version}  ${s.gitCommit}  ${s.fileCount} files  ${(s.totalSize / 1024).toFixed(0)}KB`);
  }
  // Also show archives
  const archives = fs.readdirSync(HISTORY).filter(f => f.startsWith('build-') && f.endsWith('.tar.gz'));
  if (archives.length > 0) {
    console.log(`\nArchives: ${archives.length} available`);
  }

} else if (cmd === 'diff') {
  const index = loadIndex();
  const version = arg || (index.snapshots.length > 0 ? index.snapshots[index.snapshots.length - 1].version : null);
  if (!version) { console.log('No snapshot to diff against.'); process.exit(1); }
  const manifestPath = path.join(HISTORY, `manifest-${version}.json`);
  if (!fs.existsSync(manifestPath)) { console.log(`Snapshot ${version} not found.`); process.exit(1); }
  const prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const prevMap = {};
  for (const f of prev.files) prevMap[f.path] = f;

  if (!fs.existsSync(BUILD)) { console.log('No build/ directory.'); process.exit(1); }
  const current = collectFiles(BUILD, '');
  const currentMap = {};
  for (const f of current) currentMap[f.path] = f;

  const added = current.filter(f => !prevMap[f.path]);
  const removed = prev.files.filter(f => !currentMap[f.path]);
  const changed = current.filter(f => prevMap[f.path] && prevMap[f.path].sha256 !== f.sha256);

  console.log(`\nDiff vs ${version}:`);
  console.log(`  Added:   ${added.length}`);
  console.log(`  Removed: ${removed.length}`);
  console.log(`  Changed: ${changed.length}`);

  const prevSize = prev.totalSize;
  const currSize = current.reduce((sum, f) => sum + f.size, 0);
  const pctChange = ((currSize - prevSize) / prevSize * 100).toFixed(1);
  console.log(`  Size: ${(prevSize / 1024).toFixed(0)}KB → ${(currSize / 1024).toFixed(0)}KB (${pctChange}%)`);
  if (currSize < prevSize * 0.7) {
    console.log('  ⚠ WARNING: Build shrank by >30%!');
  }

} else if (cmd === 'rollback') {
  if (!arg) { console.log('Usage: node scripts/build-rollback.js rollback <version>'); process.exit(1); }
  const archivePath = path.join(HISTORY, `build-${arg}.tar.gz`);
  if (!fs.existsSync(archivePath)) { console.log(`Archive ${arg} not found.`); process.exit(1); }
  // Backup current build first
  if (fs.existsSync(BUILD)) {
    const backupTs = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    execSync(`tar -czf "${path.join(HISTORY, `pre-rollback-${backupTs}.tar.gz`)}" -C "${ROOT}" build/`, { stdio: 'pipe' });
  }
  fs.rmSync(BUILD, { recursive: true, force: true });
  execSync(`tar -xzf "${archivePath}" -C "${ROOT}"`, { stdio: 'pipe' });
  console.log(`Rolled back to ${arg}. Previous build backed up.`);

} else {
  console.log(`Unknown command: ${cmd}`);
  process.exit(1);
}

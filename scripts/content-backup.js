#!/usr/bin/env node
/**
 * Content Backup & Guard
 * Snapshot, diff, restore, and guard data/ JSON files.
 *
 * Usage:
 *   node scripts/content-backup.js snapshot  — copy data/ to .content-backups/
 *   node scripts/content-backup.js diff [id]  — structural JSON diff
 *   node scripts/content-backup.js restore [id] — restore (requires typing RESTORE)
 *   node scripts/content-backup.js guard      — block if JSON emptied or >50% entries removed
 *   node scripts/content-backup.js list       — show available backups
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const BACKUPS = path.join(ROOT, '.content-backups');

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function getJsonFiles(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.'));
}

function loadIndex() {
  const fp = path.join(BACKUPS, 'index.json');
  if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  return { backups: [] };
}

function saveIndex(index) {
  fs.writeFileSync(path.join(BACKUPS, 'index.json'), JSON.stringify(index, null, 2) + '\n');
}

function countEntries(data) {
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'object' && data !== null) {
    let count = 0;
    for (const val of Object.values(data)) {
      if (Array.isArray(val)) count += val.length;
    }
    return count || Object.keys(data).length;
  }
  return 0;
}

const cmd = process.argv[2];
const arg = process.argv[3];

if (!cmd || cmd === 'help') {
  console.log('Usage: node scripts/content-backup.js <snapshot|diff|restore|guard|list>');
  process.exit(0);
}

ensureDir(BACKUPS);

if (cmd === 'snapshot') {
  const id = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const backupDir = path.join(BACKUPS, id);
  ensureDir(backupDir);
  const files = getJsonFiles(DATA);
  for (const file of files) {
    fs.copyFileSync(path.join(DATA, file), path.join(backupDir, file));
  }
  const index = loadIndex();
  index.backups.push({ id, timestamp: new Date().toISOString(), fileCount: files.length });
  // Keep last 10
  while (index.backups.length > 10) {
    const old = index.backups.shift();
    const oldDir = path.join(BACKUPS, old.id);
    if (fs.existsSync(oldDir)) fs.rmSync(oldDir, { recursive: true });
  }
  saveIndex(index);
  console.log(`Snapshot saved: ${id} (${files.length} files)`);

} else if (cmd === 'list') {
  const index = loadIndex();
  if (index.backups.length === 0) { console.log('No backups found.'); process.exit(0); }
  console.log('\nAvailable backups:\n');
  for (const b of index.backups) {
    console.log(`  ${b.id}  ${b.fileCount} files`);
  }

} else if (cmd === 'diff') {
  const index = loadIndex();
  const id = arg || (index.backups.length > 0 ? index.backups[index.backups.length - 1].id : null);
  if (!id) { console.log('No backup to diff against.'); process.exit(1); }
  const backupDir = path.join(BACKUPS, id);
  if (!fs.existsSync(backupDir)) { console.log(`Backup ${id} not found.`); process.exit(1); }

  console.log(`\nDiff vs backup ${id}:\n`);
  const currentFiles = getJsonFiles(DATA);
  const backupFiles = getJsonFiles(backupDir);

  for (const file of currentFiles) {
    const backupPath = path.join(backupDir, file);
    if (!fs.existsSync(backupPath)) { console.log(`  + ${file} (new)`); continue; }
    const current = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
    const prev = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const currentCount = countEntries(current);
    const prevCount = countEntries(prev);
    if (currentCount !== prevCount) {
      console.log(`  ~ ${file}: ${prevCount} → ${currentCount} entries (${currentCount > prevCount ? '+' : ''}${currentCount - prevCount})`);
    }
  }
  for (const file of backupFiles) {
    if (!currentFiles.includes(file)) console.log(`  - ${file} (deleted)`);
  }

} else if (cmd === 'restore') {
  if (!arg) { console.log('Usage: node scripts/content-backup.js restore <id>'); process.exit(1); }
  const backupDir = path.join(BACKUPS, arg);
  if (!fs.existsSync(backupDir)) { console.log(`Backup ${arg} not found.`); process.exit(1); }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Type RESTORE to confirm: ', (answer) => {
    rl.close();
    if (answer !== 'RESTORE') { console.log('Aborted.'); process.exit(1); }
    const files = getJsonFiles(backupDir);
    for (const file of files) {
      fs.copyFileSync(path.join(backupDir, file), path.join(DATA, file));
    }
    console.log(`Restored ${files.length} files from backup ${arg}.`);
  });

} else if (cmd === 'guard') {
  let blocked = false;
  const files = getJsonFiles(DATA);
  const index = loadIndex();
  const lastBackup = index.backups.length > 0 ? index.backups[index.backups.length - 1] : null;

  for (const file of files) {
    const fp = path.join(DATA, file);
    const content = fs.readFileSync(fp, 'utf8').trim();
    // Block completely empty JSON
    if (content === '{}' || content === '[]' || content === '') {
      console.log(`  ✗ BLOCKED: ${file} is empty`);
      blocked = true;
    }
    // Check for >50% entry removal vs last backup
    if (lastBackup) {
      const backupPath = path.join(BACKUPS, lastBackup.id, file);
      if (fs.existsSync(backupPath)) {
        const current = JSON.parse(content);
        const prev = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        const currentCount = countEntries(current);
        const prevCount = countEntries(prev);
        if (prevCount > 0 && currentCount < prevCount * 0.5) {
          console.log(`  ✗ BLOCKED: ${file} lost >50% of entries (${prevCount} → ${currentCount})`);
          blocked = true;
        }
      }
    }
  }

  if (blocked) {
    console.log('\n❌ Content guard FAILED — potential data loss detected.');
    process.exit(1);
  } else {
    console.log('✅ Content guard passed — no data loss detected.');
  }

} else {
  console.log(`Unknown command: ${cmd}`);
  process.exit(1);
}

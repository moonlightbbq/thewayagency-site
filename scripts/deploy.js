#!/usr/bin/env node
/**
 * Safe Deploy Pipeline
 * Runs: pre-build → content backup → build → validate → archive → size guard → git push
 * Any failure aborts with clear message.
 *
 * Usage: node scripts/deploy.js
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(label, cmd) {
  console.log(`\n── ${label} ──`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch (e) {
    console.log(`\n❌ DEPLOY ABORTED at "${label}"`);
    process.exit(1);
  }
}

console.log('╔══════════════════════════════════════════════╗');
console.log('║           Safe Deploy Pipeline               ║');
console.log('╚══════════════════════════════════════════════╝');

// 1. Pre-build safety checks
run('Pre-build checks', 'node scripts/pre-build-check.js');

// 2. Content backup snapshot
run('Content backup', 'node scripts/content-backup.js snapshot');

// 3. Build
run('Build', 'node scripts/build.js');

// 4. Validate build
run('Validate build', 'node scripts/validate-build.js');

// 5. Archive build
run('Archive build', 'node scripts/build-rollback.js archive');

// 6. Size guard (diff against last snapshot)
run('Size guard', 'node scripts/build-rollback.js snapshot');

// 7. Git commit and push
console.log('\n── Git commit & push ──');
try {
  const status = execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
  if (status) {
    execSync('git add -A', { cwd: ROOT, stdio: 'inherit' });
    execSync('git commit -m "Deploy: safe build pipeline"', { cwd: ROOT, stdio: 'inherit' });
    execSync('git push', { cwd: ROOT, stdio: 'inherit' });
    console.log('✓ Changes committed and pushed');
  } else {
    console.log('✓ No changes to commit');
  }
} catch (e) {
  console.log('! Git push failed — changes are committed locally');
}

console.log('\n✅ Deploy complete!');

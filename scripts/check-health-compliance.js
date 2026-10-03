#!/usr/bin/env node
/**
 * Medicare and health compliance guard: command-line entry. The rules live in
 * scripts/lib/health-compliance.js (scripts/build.js step 11c and
 * scripts/check-data-integrity.js use them from there).
 *
 *   node scripts/check-health-compliance.js     (scans build/)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib/health-compliance');

module.exports = lib;

if (require.main === module) {
  const buildDir = path.resolve(__dirname, '..', 'build');
  const tpmoPath = path.resolve(__dirname, '..', 'data', 'medicare-tpmo.json');
  const tpmo = fs.existsSync(tpmoPath) ? JSON.parse(fs.readFileSync(tpmoPath, 'utf8')) : null;
  const { problems, warnings } = lib.checkHealthCompliance(buildDir, { tpmo });
  warnings.forEach((w) => console.log(`  ! ${w}`));
  problems.forEach((p) => console.error(`  - ${p}`));
  console.log(problems.length ? `\n✗ ${problems.length} health compliance problem(s)` : '  ✓ Health compliance guard: clean');
  process.exit(problems.length ? 1 : 0);
}

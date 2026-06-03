/**
 * Sync the intake → Risk Profile field descriptor from SAGE at build time.
 *
 * SAGE owns the single coverage catalog (src/schemas/coverageFields.js) and
 * publishes the intake subset at GET /api/intake/fields. We pull it during the
 * build and write data/intake-fields.json so the intake form's keys/labels/types
 * stay aligned with the Risk Profile — no drift.
 *
 * Resilient: on any fetch failure (offline / CI without network / SAGE down) we
 * KEEP the committed data/intake-fields.json fallback rather than failing the
 * build. The committed copy is regenerated whenever this runs successfully.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SAGE_FIELDS_URL = process.env.SAGE_FIELDS_URL || 'https://sage.thewayagency.com/api/intake/fields';
const OUT = path.join(__dirname, '..', '..', 'data', 'intake-fields.json');

async function syncIntakeFields() {
  try {
    if (typeof fetch !== 'function') throw new Error('global fetch unavailable (Node < 18)');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(SAGE_FIELDS_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.lobs) throw new Error('unexpected payload shape');
    fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
    console.log('  ✓ data/intake-fields.json synced from SAGE');
    return data;
  } catch (err) {
    const hasFallback = fs.existsSync(OUT);
    console.warn(`  ⚠ intake-fields sync skipped (${err.message}) — ${hasFallback ? 'using committed fallback' : 'NO fallback present!'}`);
    if (!hasFallback) throw err; // a missing artifact with no fallback is a real build problem
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  }
}

module.exports = { syncIntakeFields };

// CLI entrypoint (used by the prebuild / safe-build npm scripts).
if (require.main === module) {
  syncIntakeFields().catch((err) => { console.error('[sync-intake-fields] fatal:', err.message); process.exit(1); });
}

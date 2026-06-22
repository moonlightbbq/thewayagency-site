#!/usr/bin/env node
/**
 * sync-catalogs.js — P1 O1 site consumer.
 *
 * Pulls sage's canonical producer roster (GET /api/public/team) and merges the
 * SAGE-OWNED fields (title, phone) onto slug-matched entries in data/team.json.
 * It NEVER touches site-owned fields (bio, photo, license_*, npn, specialties, …),
 * and NEVER auto-appends new sage producers (a card with no photo/bio is broken) —
 * those are reported in the status file for a human to add. data/team-sync-overrides.json
 * (optional) can `exclude` slugs from sync or `field_overrides` to pin values.
 *
 * Mirrors update-reviews.js: runs in CI (not in build.js) so CF builds never depend
 * on sage being up — the last-good committed team.json always ships.
 *
 * Exit codes (mirrors update-reviews): 0 = team.json changed, 1 = no change, >=2 = fail.
 *
 * Usage: node scripts/sync-catalogs.js [--verbose]
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const TEAM_PATH = path.join(DATA, 'team.json');
const OVERRIDES_PATH = path.join(DATA, 'team-sync-overrides.json');
const STATUS_PATH = path.join(DATA, 'team-sync-status.json');

const SAGE_API_BASE = process.env.SAGE_API_BASE || 'https://sage.thewayagency.com';
const DEFAULT_ENDPOINT = `${SAGE_API_BASE}/api/public/team`;

// Only these fields are sage-canonical; everything else on a team.json entry is
// site-owned and must never be overwritten by the sync.
const SAGE_OWNED = ['title', 'phone'];

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

async function writeJsonAtomic(p, obj) {
  const tmp = `${p}.tmp.${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n');
  await fsp.rename(tmp, p);
}

/**
 * Pure merge — testable. Returns { team, changed, updated, reported }.
 * @param localTeamObj  the parsed team.json ({ team: [...] })
 * @param sageProducers array of { slug, title, phone, ... } from /api/public/team
 * @param overrides     { exclude?: string[], field_overrides?: { [slug]: {title?,phone?} } }
 */
function mergeTeam(localTeamObj, sageProducers, overrides = {}) {
  const team = (localTeamObj && Array.isArray(localTeamObj.team)) ? localTeamObj.team.map((m) => ({ ...m })) : [];
  const exclude = new Set(overrides.exclude || []);
  const fieldOverrides = overrides.field_overrides || {};
  const bySlug = new Map(team.map((m) => [m.slug, m]));

  let changed = false;
  const updated = [];
  const reported = [];

  for (const sp of sageProducers || []) {
    if (!sp || !sp.slug) continue;
    if (exclude.has(sp.slug)) continue;            // operator opted this slug out of sync
    const local = bySlug.get(sp.slug);
    if (!local) { reported.push(sp.slug); continue; } // new sage producer — report, never auto-append

    const pin = fieldOverrides[sp.slug] || {};
    for (const field of SAGE_OWNED) {
      if (pin[field] !== undefined) continue;       // pinned — sage cannot override
      const next = sp[field];
      if (next != null && next !== '' && local[field] !== next) {
        local[field] = next;
        changed = true;
        if (!updated.includes(sp.slug)) updated.push(sp.slug);
      }
    }
  }

  return { team: { ...localTeamObj, team }, changed, updated, reported };
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  const endpoint = process.env.SAGE_TEAM_URL || DEFAULT_ENDPOINT;
  let sage;
  try {
    const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sage = await res.json();
  } catch (err) {
    console.error(`[sync-catalogs] fetch failed (${endpoint}): ${err.message} — leaving team.json untouched`);
    process.exit(2);
  }

  const local = loadJson(TEAM_PATH, { team: [] });
  const overrides = loadJson(OVERRIDES_PATH, {});
  const { team, changed, updated, reported } = mergeTeam(local, sage.producers || [], overrides);

  await writeJsonAtomic(STATUS_PATH, {
    syncedAt: new Date().toISOString(),
    source: endpoint,
    changed,
    updated,
    new_producers_reported: reported, // present in sage, absent from team.json — add a card manually
  });

  if (reported.length) {
    console.warn(`[sync-catalogs] ${reported.length} new sage producer(s) not in team.json (add a card): ${reported.join(', ')}`);
  }
  if (verbose) console.log(`[sync-catalogs] changed=${changed} updated=[${updated.join(', ')}]`);

  if (!changed) { console.log('[sync-catalogs] team.json already in sync'); process.exit(1); }
  await writeJsonAtomic(TEAM_PATH, team);
  console.log(`[sync-catalogs] team.json updated: ${updated.join(', ')}`);
  process.exit(0);
}

if (require.main === module) main().catch((err) => { console.error('[sync-catalogs] fatal:', err.message); process.exit(2); });

module.exports = { mergeTeam, SAGE_OWNED };

/**
 * scripts/update-reviews.js (TRUST-11 provenance, TRUST-14 freshness): asks
 * SAGE for ?limit=50, stores published_at/date/review_key on new entries,
 * --backfill-provenance fills only those three fields on matched existing
 * entries, and a manual --rating/--count override never refreshes
 * google_reviews_last_updated. Runs against temporary data directories with a
 * stubbed fetch: no network, no repo data touched. All names and texts are synthetic.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ur = require('../scripts/update-reviews');
const { getTestimonialsForLine } = require('../scripts/builders/pages');

const SYNCED = '2026-09-26T10:00:00.000Z';
const NOW = new Date('2026-10-03T12:00:00.000Z');
const KEY_A = 'aaaaaaaaaaaaaaaa';
const KEY_B = 'bbbbbbbbbbbbbbbb';
const KEY_C = 'cccccccccccccccc';

function curated(over = {}) {
  return {
    id: 'zz-curated', name: 'Zz Privacycheck', rating: 5, text: 'Synthetic curated text about a home policy review.',
    source: 'google', source_url: '', date: '2024-06-15', agent: '', product_lines: ['personal'], products: [], ...over,
  };
}

function writeData(dir, { testimonials, agency } = {}) {
  const loc = {
    agency: {
      name: 'The Way Agency', google_maps_url: 'https://g.page/r/listing-id', google_review_url: 'https://g.page/r/listing-id/review',
      google_rating: '5.0', google_review_count: '31', google_reviews_last_updated: SYNCED, ...agency,
    },
    offices: [],
  };
  fs.writeFileSync(path.join(dir, 'locations.json'), JSON.stringify(loc, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'testimonials.json'), JSON.stringify({ testimonials: testimonials || [curated()] }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'testimonials-blocklist.json'), JSON.stringify({ blocked: [], manual_overrides: {} }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'google-reviews-status.json'), JSON.stringify({ ok: true, fetchedAt: SYNCED }, null, 2) + '\n');
}

const readJson = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const readRaw = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

function stubFetch(body, calls) {
  return async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, statusText: 'OK', json: async () => JSON.parse(JSON.stringify(body)) };
  };
}

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twa-update-reviews-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const quiet = () => {};

describe('the sync asks for 50 reviews and stores provenance', () => {
  test('?limit=50 on the default and an overridden endpoint', () => {
    assert.equal(ur.withLimit('https://sage.example.test/api/public/google-reviews'), 'https://sage.example.test/api/public/google-reviews?limit=50');
    assert.equal(ur.withLimit('https://sage.example.test/x?limit=5&a=1'), 'https://sage.example.test/x?limit=50&a=1');
    assert.equal(ur.FETCH_LIMIT, 50);
  });

  test('new entries carry published_at, date and review_key; nothing renders from them', async () => {
    writeData(dir);
    const calls = [];
    const api = {
      rating: 5, count: 32, reviews: [
        { reviewer_name: 'Zz Newreviewer', star_rating: 5, review_text: "It's a synthetic review <b>text</b>.", published_at: '2026-09-23', review_key: KEY_A },
        { reviewer_name: 'Zz Olderreviewer', star_rating: 5, review_text: 'Another synthetic review.', published_at: null, review_key: KEY_B },
        { reviewer_name: 'Zz Lowstar', star_rating: 4, review_text: 'Not imported.', published_at: '2026-09-01', review_key: KEY_C },
      ],
    };
    const code = await ur.run(['--force'], { dataDir: dir, fetchImpl: stubFetch(api, calls), now: () => NOW, log: quiet, endpoint: 'https://sage.example.test/api/public/google-reviews' });
    assert.equal(code, 0);
    assert.deepEqual(calls, ['https://sage.example.test/api/public/google-reviews?limit=50']);
    const t = readJson(dir, 'testimonials.json').testimonials;
    assert.equal(t.length, 3);
    assert.deepEqual(t[0], curated(), 'existing entry untouched');
    assert.equal(t[1].published_at, '2026-09-23');
    assert.equal(t[1].date, '2026-09-23');
    assert.equal(t[1].review_key, KEY_A);
    assert.equal(t[1].text, 'It&#39;s a synthetic review &lt;b&gt;text&lt;/b&gt;.', 'still escaped at ingest');
    assert.deepEqual(t[1].product_lines, []);
    assert.equal(t[2].published_at, null);
    assert.equal(t[2].date, '');
    assert.equal(t[2].review_key, KEY_B);
    const loc = readJson(dir, 'locations.json').agency;
    assert.equal(loc.google_review_count, '32');
    assert.equal(loc.google_reviews_last_updated, NOW.toISOString(), 'a successful fetch refreshes the sync time');
    for (const line of ['personal', 'commercial', 'life', 'health']) {
      assert.ok(getTestimonialsForLine({ testimonials: t }, line).every((e) => e.id === 'zz-curated'), `untagged imports render nowhere (${line})`);
    }
  });

  test('a second run with the same reviews adds nothing (review_key match, even when the text was edited)', async () => {
    writeData(dir);
    const api = { rating: 5, count: 31, reviews: [{ reviewer_name: 'Zz Newreviewer', star_rating: 5, review_text: 'First version.', published_at: '2026-09-23', review_key: KEY_A }] };
    await ur.run(['--force'], { dataDir: dir, fetchImpl: stubFetch(api, []), now: () => NOW, log: quiet });
    api.reviews[0].review_text = 'Edited by the reviewer later.';
    const code = await ur.run(['--force'], { dataDir: dir, fetchImpl: stubFetch(api, []), now: () => NOW, log: quiet });
    assert.equal(code, 1, 'no change');
    assert.equal(readJson(dir, 'testimonials.json').testimonials.length, 2);
  });

  test('an older SAGE without provenance still imports, with null fields', () => {
    const e = ur.buildTestimonialEntry({ reviewer_name: 'Zz Privacycheck', star_rating: 5, review_text: 'Synthetic.' }, { manual_overrides: {} });
    assert.equal(e.published_at, null);
    assert.equal(e.review_key, null);
    assert.equal(e.date, '');
    assert.deepEqual(ur.provenanceOf({ published_at: '2026-02-30', review_key: 'x' }), { published_at: null, review_key: null });
    assert.deepEqual(ur.provenanceOf({ published_at: '2026-09-23T14:00:00Z', review_key: KEY_A }), { published_at: '2026-09-23', review_key: KEY_A });
  });

  test('a failed fetch leaves the data and the sync time alone', async () => {
    writeData(dir);
    const before = readRaw(dir, 'locations.json');
    const code = await ur.run(['--force'], { dataDir: dir, fetchImpl: async () => ({ ok: false, status: 503, statusText: 'Unavailable' }), now: () => NOW, log: quiet });
    assert.equal(code, 1);
    assert.equal(readRaw(dir, 'locations.json'), before);
    assert.equal(readJson(dir, 'google-reviews-status.json').ok, false);
  });
});

describe('--backfill-provenance', () => {
  test('fills only published_at, date and review_key on matched entries; changes nothing else', async () => {
    const imported = ur.buildTestimonialEntry({ reviewer_name: 'Zz Imported', star_rating: 5, review_text: "It's an imported synthetic review." }, {});
    const untouched = curated({ id: 'zz-unmatched', name: 'Zz Nomatch', text: 'No API review matches this.', date: '2024-02-20', product_lines: ['commercial'] });
    writeData(dir, { testimonials: [curated(), imported, untouched] });
    const beforeLoc = readRaw(dir, 'locations.json');
    const beforeStatus = readRaw(dir, 'google-reviews-status.json');
    const beforeBlock = readRaw(dir, 'testimonials-blocklist.json');
    const api = {
      rating: 4.9, count: 40, reviews: [
        { reviewer_name: 'Zz Privacycheck', star_rating: 5, review_text: 'Synthetic curated text about a home policy review.', published_at: '2025-05-23', review_key: KEY_A },
        { reviewer_name: 'Zz Imported', star_rating: 5, review_text: "It's an imported synthetic review.", published_at: '2026-03-18', review_key: KEY_B },
        { reviewer_name: 'Zz Brandnew', star_rating: 5, review_text: 'Not in the file: never appended by a backfill.', published_at: '2026-09-23', review_key: KEY_C },
      ],
    };
    const calls = [];
    const code = await ur.run(['--backfill-provenance'], { dataDir: dir, fetchImpl: stubFetch(api, calls), now: () => NOW, log: quiet, endpoint: 'https://sage.example.test/r' });
    assert.equal(code, 0);
    assert.deepEqual(calls, ['https://sage.example.test/r?limit=50']);
    const t = readJson(dir, 'testimonials.json').testimonials;
    assert.equal(t.length, 3, 'nothing appended or removed');
    assert.deepEqual(t.map((e) => e.id), ['zz-curated', imported.id, 'zz-unmatched'], 'order kept');
    assert.deepEqual(t[0], { ...curated(), date: '2025-05-23', published_at: '2025-05-23', review_key: KEY_A }, 'curated date corrected from published_at');
    assert.deepEqual(t[1], { ...imported, date: '2026-03-18', published_at: '2026-03-18', review_key: KEY_B }, 'escaped text still matches');
    assert.deepEqual(t[2], untouched);
    assert.equal(readRaw(dir, 'locations.json'), beforeLoc, 'aggregate and sync time untouched');
    assert.equal(readRaw(dir, 'google-reviews-status.json'), beforeStatus);
    assert.equal(readRaw(dir, 'testimonials-blocklist.json'), beforeBlock);
  });

  test('--dry-run writes nothing; a second run finds nothing to change', async () => {
    writeData(dir);
    const api = { rating: 5, count: 31, reviews: [{ reviewer_name: 'Zz Privacycheck', star_rating: 5, review_text: 'Synthetic curated text about a home policy review.', published_at: '2025-05-23', review_key: KEY_A }] };
    const before = readRaw(dir, 'testimonials.json');
    assert.equal(await ur.run(['--backfill-provenance', '--dry-run'], { dataDir: dir, fetchImpl: stubFetch(api, []), now: () => NOW, log: quiet }), 0);
    assert.equal(readRaw(dir, 'testimonials.json'), before);
    assert.equal(await ur.run(['--backfill-provenance'], { dataDir: dir, fetchImpl: stubFetch(api, []), now: () => NOW, log: quiet }), 0);
    assert.equal(await ur.run(['--backfill-provenance'], { dataDir: dir, fetchImpl: stubFetch(api, []), now: () => NOW, log: quiet }), 1, 'idempotent');
  });

  test('never matches by reviewer name alone, and skips an entry two reviews could be', () => {
    const entries = [curated({ text: 'Text the API never sends.' }), curated({ id: 'zz-two', name: 'Zz Twice', text: 'Same opening sixty characters for both reviews here, then it differs A' })];
    const snapshot = JSON.parse(JSON.stringify(entries));
    const result = ur.backfillProvenance([
      { reviewer_name: 'Zz Privacycheck', star_rating: 5, review_text: 'A different review by the same name.', published_at: '2025-01-22', review_key: KEY_A },
      { reviewer_name: 'Zz Twice', star_rating: 5, review_text: 'Same opening sixty characters for both reviews here, then it differs A', published_at: '2024-04-10', review_key: KEY_B },
      { reviewer_name: 'Zz Twice', star_rating: 5, review_text: 'Same opening sixty characters for both reviews here, then it differs B', published_at: '2024-04-11', review_key: KEY_C },
    ], entries);
    assert.deepEqual(result.changed, []);
    assert.deepEqual(result.ambiguous, ['zz-two']);
    assert.equal(result.unmatched, 1);
    assert.deepEqual(entries, snapshot);
  });

  test('a fetch failure writes nothing, not even the status file', async () => {
    writeData(dir);
    const before = ['locations.json', 'testimonials.json', 'google-reviews-status.json'].map((f) => readRaw(dir, f));
    const code = await ur.run(['--backfill-provenance'], { dataDir: dir, fetchImpl: async () => { throw new Error('offline'); }, now: () => NOW, log: quiet });
    assert.equal(code, 1);
    assert.deepEqual(['locations.json', 'testimonials.json', 'google-reviews-status.json'].map((f) => readRaw(dir, f)), before);
  });
});

describe('manual --rating/--count override', () => {
  test('changes the rating and count but never google_reviews_last_updated, the status file or any source page', async () => {
    writeData(dir);
    const beforeStatus = readRaw(dir, 'google-reviews-status.json');
    let fetched = false;
    const code = await ur.run(['--rating', '4.9', '--count', '33'], { dataDir: dir, fetchImpl: async () => { fetched = true; }, now: () => NOW, log: quiet });
    assert.equal(code, 0);
    assert.equal(fetched, false, 'no API call');
    const a = readJson(dir, 'locations.json').agency;
    assert.equal(a.google_rating, '4.9');
    assert.equal(a.google_review_count, '33');
    assert.equal(a.google_reviews_last_updated, SYNCED, 'a hand override goes stale 30 days after the last real sync');
    assert.equal(readRaw(dir, 'google-reviews-status.json'), beforeStatus);
    assert.doesNotMatch(fs.readFileSync(require.resolve('../scripts/update-reviews'), 'utf8'), /propagateReviewCountToSource|writeFileSync\(file/, 'the sync no longer edits src/ pages');
  });
});

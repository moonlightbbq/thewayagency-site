/**
 * TRUST-14: the Google rating badge says "<rating> on Google", links to the
 * Business Profile listing (never the write-a-review form), carries a separate
 * "Leave a review" link, draws its stars from the rating, and renders nothing
 * when the rating is missing, has no listing URL or is more than 30 days old.
 * No file here runs the build or writes build/.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { googleRating, renderReviewBadge, renderReviewBadgeMarkers, RATING_MAX_AGE_DAYS } = require('../scripts/lib/review-badge');
const { renderFooter } = require('../scripts/shared-templates');
const { createInjectVersion } = require('../scripts/builders/seo');

const DAY = 24 * 60 * 60 * 1000;
const LISTING = 'https://g.page/r/listing-id';
const COMPOSE = 'https://g.page/r/listing-id/review';
const SYNCED = '2026-09-30T10:08:07.138Z';
const NOW = new Date('2026-10-03T12:00:00Z');
const FRESH = {
  google_rating: '5.0', google_review_count: '31', google_reviews_last_updated: SYNCED,
  google_maps_url: LISTING, google_review_url: COMPOSE,
};
const OFFICE = { street: 'PO Box 187', city: 'Mt Washington', state: 'KY', zip: '40047', phone: '(502) 413-5335', email: 'zz.privacycheck@example.com' };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function listingAnchor(html) {
  const m = html.match(/<a class="review-badge__listing" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  return m && { href: m[1], text: m[2].replace(/<svg[\s\S]*?<\/svg>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
}

describe('googleRating: one reader, fails closed', () => {
  test('fresh data with a listing URL gives the rating, count, stars and both URLs', () => {
    assert.deepEqual(googleRating(FRESH, NOW), { rating: '5.0', count: 31, stars: 5, listingUrl: LISTING, reviewUrl: COMPOSE, syncedAt: SYNCED });
  });
  test('stale, future, missing or malformed data gives null (no "5.0" or "20+" fallback)', () => {
    const at = (iso) => googleRating({ ...FRESH, google_reviews_last_updated: iso }, NOW);
    assert.equal(at(new Date(NOW.getTime() - (RATING_MAX_AGE_DAYS + 1) * DAY).toISOString()), null, '31 days old');
    assert.ok(at(new Date(NOW.getTime() - (RATING_MAX_AGE_DAYS - 1) * DAY).toISOString()), '29 days old still shows');
    assert.equal(at(new Date(NOW.getTime() + 2 * DAY).toISOString()), null, 'future sync time');
    assert.equal(at(undefined), null);
    assert.equal(at('not a date'), null);
    assert.equal(googleRating({ ...FRESH, google_review_count: '20+' }, NOW), null);
    assert.equal(googleRating({ ...FRESH, google_review_count: '0' }, NOW), null);
    assert.equal(googleRating({ ...FRESH, google_rating: '' }, NOW), null);
    assert.equal(googleRating({ ...FRESH, google_rating: '5.7' }, NOW), null);
    assert.equal(googleRating({ ...FRESH, google_maps_url: undefined }, NOW), null, 'no listing URL');
    assert.equal(googleRating({ ...FRESH, google_maps_url: COMPOSE }, NOW), null, 'the compose form is not the listing');
    assert.equal(googleRating({ ...FRESH, google_maps_url: COMPOSE + '/' }, NOW), null);
    assert.equal(googleRating({ ...FRESH, google_maps_url: 'http://g.page/r/listing-id' }, NOW), null);
    assert.equal(googleRating(undefined, NOW), null);
  });
  test('no review URL: the rating still shows, without "Leave a review"', () => {
    const g = googleRating({ ...FRESH, google_review_url: undefined }, NOW);
    assert.equal(g.reviewUrl, null);
    assert.doesNotMatch(renderReviewBadge('footer', g), /Leave a review/);
  });
  test('data/locations.json carries the verified interim listing URL (claims spec PR-3 item 1)', () => {
    const agency = JSON.parse(read('data/locations.json')).agency;
    assert.equal(agency.google_maps_url, 'https://g.page/r/CSHCy85xJ8VOEBM');
    const day = new Date(Date.parse(agency.google_reviews_last_updated) + DAY);
    const g = googleRating(agency, day);
    assert.ok(g, 'the committed data renders a badge the day after its sync');
    assert.equal(g.listingUrl, 'https://g.page/r/CSHCy85xJ8VOEBM');
    assert.match(g.reviewUrl, /\/review$/);
  });
});

describe('renderReviewBadge', () => {
  for (const variant of ['footer', 'section']) {
    test(`${variant}: "<rating> on Google", links to the listing, separate "Leave a review"`, () => {
      const html = renderReviewBadge(variant, googleRating(FRESH, NOW));
      const a = listingAnchor(html);
      assert.equal(a.href, LISTING);
      assert.match(a.text, /^5\.0 on Google (&#9733;){5} &middot; 31 reviews$/);
      assert.match(html, /<strong[^>]*>5\.0 on Google<\/strong>/);
      assert.match(html, /&middot; 31 reviews<\/span>/);
      assert.match(html, new RegExp(`<a class="review-badge__write" href="${COMPOSE}"[^>]*>Leave a review</a>`));
      assert.equal((html.match(/href="[^"]*\/review"/g) || []).length, 1, 'only "Leave a review" goes to the form');
      assert.doesNotMatch(html, /\(\d+ reviews\)|20\+|itemprop|application\/ld\+json/);
      assert.match(html, new RegExp(`review-badge--${variant}`));
    });
  }
  test('inline: a compact "<rating> on Google" line linking to the listing, with no "Leave a review"', () => {
    const html = renderReviewBadge('inline', googleRating(FRESH, NOW));
    const a = listingAnchor(html);
    assert.equal(a.href, LISTING);
    assert.match(a.text, /^5\.0 on Google (&#9733;){5} &middot; 31 reviews$/);
    assert.match(html, /review-badge--inline/);
    assert.doesNotMatch(html, /review-badge__write|Leave a review|\/review"/);
    assert.equal(renderReviewBadge('inline', null), '');
  });
  test('stars follow the rating', () => {
    const stars = (rating) => (renderReviewBadge('footer', googleRating({ ...FRESH, google_rating: rating }, NOW)).match(/aria-hidden="true" style="color:#FBBC05;">([^<]*)</) || [])[1];
    assert.equal(stars('5.0'), '&#9733;'.repeat(5));
    assert.equal(stars('4.4'), '&#9733;'.repeat(4) + '&#9734;');
    assert.equal(stars('3.6'), '&#9733;'.repeat(4) + '&#9734;');
    assert.equal(stars('1.0'), '&#9733;' + '&#9734;'.repeat(4));
  });
  test('no data, or a bare {rating, count} without a listing, renders nothing', () => {
    assert.equal(renderReviewBadge('footer', null), '');
    assert.equal(renderReviewBadge('section', { rating: '5.0', count: '31' }), '');
    assert.throws(() => renderReviewBadge('sidebar', googleRating(FRESH, NOW)), /unknown variant/);
  });
});

describe('renderFooter and the handcrafted-page markers', () => {
  test('renderFooter: fresh data shows the badge; stale or missing data shows none and no "20+"', () => {
    const fresh = renderFooter(OFFICE, googleRating(FRESH, NOW));
    assert.equal(listingAnchor(fresh).href, LISTING);
    assert.match(fresh, /5\.0 on Google/);
    assert.match(fresh, />Leave a review</);
    const stale = renderFooter(OFFICE, googleRating({ ...FRESH, google_reviews_last_updated: '2026-08-01T00:00:00Z' }, NOW));
    for (const html of [stale, renderFooter(OFFICE, null), renderFooter(OFFICE, undefined)]) {
      assert.doesNotMatch(html, /review-badge|on Google|20\+|reviews\)|g\.page/);
    }
  });
  test('markers fill with the badge, or with nothing; a typo fails loudly', () => {
    const g = googleRating(FRESH, NOW);
    const page = '<footer><!--render:review-badge:footer--><!--/render:review-badge:footer--></footer><div class="section-header"><!--render:review-badge:section--><!--/render:review-badge:section--></div>';
    const out = renderReviewBadgeMarkers(page, g);
    assert.equal((out.match(/class="review-badge review-badge--footer"/g) || []).length, 1);
    assert.equal((out.match(/class="review-badge review-badge--section"/g) || []).length, 1);
    assert.doesNotMatch(out, /render:review-badge/);
    assert.equal(renderReviewBadgeMarkers(page, null), '<footer></footer><div class="section-header"></div>');
    assert.throws(() => renderReviewBadgeMarkers('<!--render:review-badge:footer--><!--/render:review-badge:section-->', g), /opens "footer" but closes "section"/);
    assert.throws(() => renderReviewBadgeMarkers('<!--render:review-badge:aside--><!--/render:review-badge:aside-->', g), /unknown variant/);
    assert.throws(() => renderReviewBadgeMarkers('<!--render:review-badge:footer-->', g), /unpaired/);
  });
  test('/intake/ step 4: the rating line follows the data (live count, on Google, listing link) and is gone when stale', () => {
    const src = read('src/intake.html');
    const step4 = (html) => html.slice(html.indexOf('<div id="step-4"'), html.indexOf('<!-- Confirmation -->'));
    assert.equal((step4(src).match(/<!--render:review-badge:inline--><!--\/render:review-badge:inline-->/g) || []).length, 1, 'step 4 marks the inline badge');
    assert.doesNotMatch(step4(src), /Google reviews|&#9733;|\b\d+ reviews/, 'no hand-typed rating left in step 4');
    const fresh = step4(renderReviewBadgeMarkers(src, googleRating(FRESH, NOW)));
    assert.equal(listingAnchor(fresh).href, LISTING);
    assert.match(fresh, /5\.0 on Google[\s\S]*&middot; 31 reviews/);
    assert.doesNotMatch(fresh, /Leave a review/);
    const stale = step4(renderReviewBadgeMarkers(src, googleRating({ ...FRESH, google_reviews_last_updated: '2026-08-01T00:00:00Z' }, NOW)));
    assert.doesNotMatch(stale, /&#9733;|on Google|reviews|review-badge/);
  });
  test('injectVersion fills the markers of a handcrafted page', () => {
    const inject = createInjectVersion({ buildVersion: 't', gitInfo: { branch: 'b' }, buildDate: 'd', reviews: googleRating(FRESH, NOW), renderHead_GTM: () => '', renderBody_GTM: () => '' });
    const html = inject('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><footer class="footer"><!--render:review-badge:footer--><!--/render:review-badge:footer--></footer></body></html>', '/x.html');
    assert.match(html, /5\.0 on Google/);
    assert.doesNotMatch(html, /render:review-badge/);
  });
});

describe('source: no hand-typed badge left', () => {
  function walk(dir, out = []) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) { if (!['assets', 'blog'].includes(e.name) || dir !== 'src') walk(rel, out); }
      else if (/\.(html|js)$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const files = walk('src');
  test('no "(N reviews)" text and no review-form link in a badge anywhere in src/', () => {
    for (const f of files) {
      const s = read(f);
      assert.doesNotMatch(s, /\(\d+\+? reviews?\)/, `${f} still carries "(N reviews)"`);
    }
    // The one remaining compose link is the intake's post-submit "Leave a Review" prompt.
    const compose = files.filter((f) => read(f).includes('g.page/r/CSHCy85xJ8VOEBM/review'));
    assert.deepEqual(compose, ['src/intake.html']);
    assert.ok(/g\.page\/r\/CSHCy85xJ8VOEBM\/review"[\s\S]{0,3000}?Leave a Review/.test(read('src/intake.html')), 'intake keeps its post-submit Leave a Review link');
  });
  test('every handcrafted footer that had the badge marks it (at most once, inside the footer), outside <main> on compliance pages', () => {
    const marked = files.filter((f) => read(f).includes('<!--render:review-badge:footer-->'));
    // 20 handcrafted pages (the homepage and the six compliance pages among them) and the 13 frozen legacy blog pages (claims spec PR-4 item 6).
    assert.equal(marked.length, 33, `found ${marked.length} footer badge markers`);
    for (const f of marked) {
      const s = read(f);
      assert.equal((s.match(/<!--render:review-badge:footer--><!--\/render:review-badge:footer-->/g) || []).length, 1, `${f}: one footer badge marker`);
      assert.ok(s.indexOf('render:review-badge:footer') > s.indexOf('<footer class="footer"') && s.indexOf('<footer class="footer"') >= 0, `${f}: marker inside the footer`);
    }
    for (const page of ['privacy', 'terms', 'disclosures', 'privacy-notice', 'ai-disclosure', 'information-security']) {
      const s = read(`src/pages/${page}.html`);
      assert.ok(s.indexOf('render:review-badge') > s.lastIndexOf('</main>'), `${page}: marker sits outside <main>`);
    }
    assert.equal((read('src/pages/index.html').match(/<!--render:review-badge:section--><!--\/render:review-badge:section-->/g) || []).length, 1, 'homepage section badge');
  });
  test('app.js no longer injects a hard-coded "(30 reviews)" badge', () => {
    const app = read('src/js/app.js');
    assert.doesNotMatch(app, /initFormTestimonials|g\.page\/r\//);
  });
  test('generators read the rating through googleRating, with no "5.0" or "20+" defaults', () => {
    for (const f of ['scripts/build.js', 'scripts/generate-blog.js', 'scripts/shared-templates.js', 'scripts/builders/pages.js', 'scripts/builders/seo.js']) {
      const s = read(f);
      assert.doesNotMatch(s, /'20\+'|g\.page\/r\//, f);
      assert.doesNotMatch(s, /google_rating \|\| '5\.0'/, f);
    }
    assert.match(read('scripts/build.js'), /googleRating\(agency\)/);
    assert.match(read('scripts/generate-blog.js'), /googleRating\(agency\)/);
  });
});

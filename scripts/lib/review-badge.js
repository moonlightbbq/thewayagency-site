/**
 * The agency's Google rating, read once and rendered one way (TRUST-14).
 *
 * googleRating(agency, now) is the only reader of data/locations.json
 * agency.{google_rating, google_review_count, google_reviews_last_updated,
 * google_maps_url, google_review_url}. It returns null, so nothing renders,
 * when any of these holds:
 *   - the rating is not a number from 0.0 to 5.0, or the count is not a whole
 *     number of at least 1 (no '5.0' or '20+' fallbacks);
 *   - there is no listing URL (google_maps_url: the Business Profile listing,
 *     never the write-a-review form ending in /review);
 *   - the last successful sync (google_reviews_last_updated, written only by a
 *     successful scripts/update-reviews.js fetch, never by a manual
 *     --rating/--count override) is missing, unreadable, more than 30 days old
 *     or in the future. A stale rating shown as current would mislead.
 *
 * renderReviewBadge(variant, g) says "<rating> on Google", links to the
 * listing, and carries a separate "Leave a review" link to the review form.
 * Stars are drawn from the rating. No review markup (SCHEMA-03): visible text only.
 *
 * Handcrafted pages carry the empty marker pair
 *   <!--render:review-badge:footer--><!--/render:review-badge:footer-->
 * (or :section) where the badge goes; renderReviewBadgeMarkers() fills it at
 * build time, so a data change never edits a page's source (the six compliance
 * pages keep their bytes inside and outside <main>).
 */
'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const RATING_MAX_AGE_DAYS = 30;
const VARIANTS = Object.freeze(['footer', 'section']);

function esc(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function validRating(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (!/^\d(?:\.\d)?$/.test(s)) return null;
  const n = Number(s);
  if (!(n >= 0 && n <= 5)) return null;
  return n.toFixed(1);
}

function validCount(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && Number.isSafeInteger(n) ? n : null;
}

function listingUrlOk(url) {
  return typeof url === 'string' && /^https:\/\/\S+$/.test(url) && !/\/review\/?(?:[?#].*)?$/.test(url);
}

/**
 * @param {object} agency  data/locations.json agency
 * @param {Date} [now]
 * @returns {{ rating: string, count: number, stars: number, listingUrl: string, reviewUrl: string|null, syncedAt: string } | null}
 */
function googleRating(agency, now = new Date()) {
  const a = agency || {};
  const rating = validRating(a.google_rating);
  const count = validCount(a.google_review_count);
  if (rating === null || count === null) return null;
  const listingUrl = a.google_maps_url;
  if (!listingUrlOk(listingUrl)) return null;
  const synced = Date.parse(String(a.google_reviews_last_updated || ''));
  const t = now.getTime();
  if (!Number.isFinite(synced) || t - synced > RATING_MAX_AGE_DAYS * DAY_MS || synced > t + DAY_MS) return null;
  const reviewUrl = typeof a.google_review_url === 'string' && /^https:\/\/\S+$/.test(a.google_review_url) ? a.google_review_url : null;
  const stars = Math.min(5, Math.max(0, Math.round(Number(rating))));
  return { rating, count, stars, listingUrl, reviewUrl, syncedAt: new Date(synced).toISOString() };
}

const GOOGLE_G_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>';

// Inline styles, as the badge had before: the six compliance pages carry their
// own CSS and do not load components.css, and the badge must look the same there.
const STYLE = {
  footer: {
    wrap: 'display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:var(--space-md);font-size:var(--text-xs);font-weight:500;',
    listing: 'display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:var(--border-radius);text-decoration:none;color:rgba(255,255,255,0.85);',
    strong: 'color:var(--white);',
    count: 'color:rgba(255,255,255,0.75);',
    write: 'color:rgba(255,255,255,0.75);text-decoration:underline;',
    icon: 16,
  },
  section: {
    wrap: 'display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px 16px;margin-top:var(--space-sm);font-size:var(--text-sm);font-weight:500;',
    listing: 'display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:var(--white);border:1px solid var(--border);border-radius:var(--border-radius);text-decoration:none;color:var(--charcoal);',
    strong: 'color:var(--navy);',
    count: 'color:var(--slate);',
    write: 'color:var(--navy);text-decoration:underline;',
    icon: 18,
  },
};

/**
 * @param {'footer'|'section'} variant
 * @param {ReturnType<typeof googleRating>} g
 * @returns {string} the badge, or '' when there is no usable rating
 */
function renderReviewBadge(variant, g) {
  if (!VARIANTS.includes(variant)) throw new Error(`renderReviewBadge: unknown variant "${variant}"`);
  if (!g) return '';
  const rating = validRating(g.rating);
  const count = validCount(g.count);
  if (rating === null || count === null || !listingUrlOk(g.listingUrl)) return '';
  const st = STYLE[variant];
  const n = Math.min(5, Math.max(0, Math.round(Number(rating))));
  const icon = GOOGLE_G_SVG.replace('width="16" height="16"', `width="${st.icon}" height="${st.icon}"`);
  const write = g.reviewUrl && /^https:\/\/\S+$/.test(g.reviewUrl)
    ? `\n          <a class="review-badge__write" href="${esc(g.reviewUrl)}" target="_blank" rel="noopener" style="${st.write}">Leave a review</a>`
    : '';
  return `<div class="review-badge review-badge--${variant}" style="${st.wrap}">
          <a class="review-badge__listing" href="${esc(g.listingUrl)}" target="_blank" rel="noopener" style="${st.listing}">${icon}
            <strong style="${st.strong}">${rating} on Google</strong>
            <span class="review-badge__stars" aria-hidden="true" style="color:#FBBC05;">${'&#9733;'.repeat(n)}${'&#9734;'.repeat(5 - n)}</span>
            <span class="review-badge__count" style="${st.count}">&middot; ${count} reviews</span>
          </a>${write}
        </div>`;
}

const MARKER = /<!--render:review-badge:([a-z]+)-->([\s\S]*?)<!--\/render:review-badge:([a-z]+)-->/g;

/**
 * Fill every <!--render:review-badge:VARIANT--><!--/render:review-badge:VARIANT-->
 * pair. Throws on an unknown variant, a mismatched pair or a stray marker, so a
 * typo fails the build instead of shipping a raw comment or an old badge.
 */
function renderReviewBadgeMarkers(html, g, where = 'a page') {
  const out = html.replace(MARKER, (all, open, inner, close) => {
    if (open !== close) throw new Error(`review badge marker: ${where} opens "${open}" but closes "${close}"`);
    if (!VARIANTS.includes(open)) throw new Error(`review badge marker: ${where} uses unknown variant "${open}"`);
    if (/render:review-badge/.test(inner)) throw new Error(`review badge marker: ${where} has a nested marker`);
    return renderReviewBadge(open, g);
  });
  if (/render:review-badge/.test(out)) throw new Error(`review badge marker: ${where} has an unpaired review-badge marker`);
  return out;
}

module.exports = { googleRating, renderReviewBadge, renderReviewBadgeMarkers, RATING_MAX_AGE_DAYS, VARIANTS };

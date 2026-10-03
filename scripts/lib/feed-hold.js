'use strict';
/**
 * Posts held out of the blog RSS feed (and only the feed) until the Medicare
 * and health corrections of PR #63 (TRUST-01, TRUST-04) are live.
 *
 * Why: the feed carries each item's full text (content:encoded), and feed
 * readers cache item content; a later correction does not reliably reach
 * them. Holding these posts keeps stale Medicare figures out of feed caches.
 * The posts stay on the site, in the blog index, in the sitemap and in
 * Related Articles; nothing else reads this file.
 *
 * Rule: a post is held when its slug is listed below, when its category is
 * health or life_health, or when its slug, title or a tag names Medicare,
 * Medicaid, kynect or health.
 *
 * REMOVE THIS FILE (and its two callers, scripts/generate-blog.js step 3 and
 * scripts/validate-build.js section 11, plus tests/feed-hold.test.js) when
 * PR #63 merges. Until then the feed lists the 20 newest posts that are not
 * held.
 *
 * Dependency-free: CI's safe-build job runs validate-build.js on Node 18
 * without npm ci.
 */

// The Medicare posts PR #63 corrects. Listed by slug as well, so a tag edit
// can never release them early.
const HELD_SLUGS = Object.freeze([
  'medicare-enrollment-guide-louisville-2026',
  'medicare-open-enrollment-2027',
]);

const HELD_CATEGORIES = Object.freeze(['health', 'life_health']);

const HELD_WORDS = /\b(?:medicare|medicaid|kynect|health)\b/i;

const asList = (tags) => (Array.isArray(tags) ? tags : String(tags === undefined || tags === null ? '' : tags).replace(/[[\]]/g, '').split(','))
  .map((t) => String(t).trim()).filter(Boolean);

/**
 * @param {{slug?: string, title?: string, category?: string, tags?: string|string[]}} post
 * @returns {string} why the post is held, or '' when it may be listed
 */
function feedHoldReason(post) {
  const p = post || {};
  const slug = String(p.slug || '');
  if (HELD_SLUGS.includes(slug)) return `slug ${slug} is on the hold list`;
  const category = String(p.category || '').trim().toLowerCase();
  if (HELD_CATEGORIES.includes(category)) return `category ${category}`;
  // Slugs use hyphens: read them as words.
  if (HELD_WORDS.test(slug.replace(/-/g, ' '))) return `slug ${slug} names a held topic`;
  if (HELD_WORDS.test(String(p.title || ''))) return 'title names a held topic';
  const tag = asList(p.tags).find((t) => HELD_WORDS.test(t.replace(/-/g, ' ')));
  if (tag) return `tag "${tag}" names a held topic`;
  return '';
}

const isHeldFromFeed = (post) => feedHoldReason(post) !== '';

module.exports = { HELD_SLUGS, HELD_CATEGORIES, HELD_WORDS, feedHoldReason, isHeldFromFeed };

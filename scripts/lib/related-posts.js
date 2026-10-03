'use strict';
/**
 * Relevance-ranked "Related Articles" (BLOG-03; priority-hubs R1-11 step 4).
 *
 * The old block showed the newest posts in the same category, so the 39
 * uncategorized posts all showed the same three, which collected 42 inbound
 * links each, and the liability post's "related" posts were about floods,
 * boating and Farm Bureau. This ranks candidates by shared signals and uses
 * recency only as the last tie-break:
 *
 *   same related_cluster            +100
 *   same target product page         +60  (target_product_page or related_page)
 *   each shared non-generic tag      +20
 *   a shared priority-market hub     +15  (target_location_pages, tier priority)
 *   same category                    +10  (never undefined === undefined)
 *
 * A candidate needs at least minScore (20) to be shown, so a post with no real
 * match gets no Related section rather than three irrelevant links. No post
 * receives more than perTargetCap (15) Related links across the site. Hosts are
 * processed in slug order so the output is deterministic.
 *
 * Dependency-free (Node 18). Reads nothing; generate-blog.js passes the data.
 */
const { canonicalHref } = require('./site-urls');

const GENERIC_TAGS = new Set(['kentucky', 'ky', 'insurance', 'indiana', 'tennessee']);

/** Front-matter tags ("[a, b]", "a, b" or an array) as a normalised set. */
function tagSet(tags) {
  const list = Array.isArray(tags) ? tags : String(tags === undefined || tags === null ? '' : tags).replace(/[[\]"']/g, '').split(',');
  return new Set(list
    .map((t) => String(t).toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t && !GENERIC_TAGS.has(t)));
}

const pageOf = (p) => (p && p !== 'null' ? canonicalHref(String(p).trim()) : '');
const str = (v) => (v === undefined || v === null ? '' : String(v));

/**
 * @param {Array<object>} hosts       posts that get a Related section
 * @param {Array<object>} candidates  posts that may be linked (live in this build)
 *   each: { slug, publish_date?, category?, related_cluster?, target_product_page?,
 *           related_page?, target_location_pages?, tags? }
 * @returns {Map<string, string[]>} host slug -> up to `max` candidate slugs
 */
function rankRelated(hosts, candidates, { max = 3, perTargetCap = 15, minScore = 20, priorityHubs = new Set() } = {}) {
  const hubsOf = (x) => new Set((Array.isArray(x.target_location_pages) ? x.target_location_pages : [])
    .map(pageOf).filter((h) => priorityHubs.has(h)));
  const C = (candidates || []).filter((c) => c && c.slug).map((c) => ({
    slug: String(c.slug),
    date: str(c.publish_date),
    category: str(c.category),
    cluster: str(c.related_cluster),
    page: pageOf(c.target_product_page || c.related_page),
    tags: tagSet(c.tags),
    hubs: hubsOf(c),
  }));
  const inbound = new Map();
  const out = new Map();
  const ordered = [...(hosts || [])].filter((h) => h && h.slug).sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  for (const h of ordered) {
    const cluster = str(h.related_cluster);
    const category = str(h.category);
    const page = pageOf(h.target_product_page || h.related_page);
    const tags = tagSet(h.tags);
    const hubs = hubsOf(h);
    const scored = [];
    for (const c of C) {
      if (c.slug === String(h.slug)) continue;
      let s = 0;
      if (cluster && cluster === c.cluster) s += 100;
      if (page && page === c.page) s += 60;
      for (const t of tags) if (c.tags.has(t)) s += 20;
      if ([...hubs].some((x) => c.hubs.has(x))) s += 15;
      if (category && category === c.category) s += 10;
      if (s >= minScore) scored.push({ slug: c.slug, s, d: c.date });
    }
    scored.sort((a, b) => b.s - a.s || b.d.localeCompare(a.d) || a.slug.localeCompare(b.slug));
    const picked = [];
    for (const x of scored) {
      if ((inbound.get(x.slug) || 0) >= perTargetCap) continue;
      picked.push(x.slug);
      inbound.set(x.slug, (inbound.get(x.slug) || 0) + 1);
      if (picked.length === max) break;
    }
    out.set(String(h.slug), picked);
  }
  return out;
}

module.exports = { rankRelated, tagSet, GENERIC_TAGS };

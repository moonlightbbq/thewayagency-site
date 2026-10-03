/**
 * `noindex: true` in a blog post's front matter (BLOG-08, content-accuracy
 * WP-A6). The page still renders and returns 200, with robots
 * "noindex, follow", and stays crawlable (robots.txt is not touched: Google
 * must fetch the page to see the tag). The build leaves it out of the /blog/
 * index, every Related Articles block, the feed, the sitemap and the 404
 * suggestions. Its calendar entry stays 'published'; a 'retired' entry would
 * stop it rendering. Dependency-free.
 */
'use strict';

/** The robots meta a noindexed post carries. */
const NOINDEX_META = '<meta name="robots" content="noindex, follow">';

/** True when built HTML carries a robots noindex meta (sitemap, 404 data). */
const NOINDEX_META_RE = /<meta name="robots" content="[^"]*noindex/i;

/** True when a post's front matter says `noindex: true` (any case). */
function isNoindex(meta) {
  return String((meta && meta.noindex) || '').trim().toLowerCase() === 'true';
}

module.exports = { NOINDEX_META, NOINDEX_META_RE, isNoindex };

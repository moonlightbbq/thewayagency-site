/**
 * Relevance-ranked Related Articles (BLOG-03; scripts/lib/related-posts.js).
 * Synthetic corpus only; nothing here reads build/.
 *
 *   node --test tests/          (npm test)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankRelated, tagSet } = require('../scripts/lib/related-posts');

const post = (slug, extra = {}) => ({ slug, publish_date: '2026-01-01', ...extra });

test('two posts with no category, cluster, product or tags are never related (no undefined === undefined)', () => {
  const a = post('a'); const b = post('b');
  const out = rankRelated([a, b], [a, b]);
  assert.deepEqual(out.get('a'), []);
  assert.deepEqual(out.get('b'), []);
});

test('the same related_cluster outranks a newer post that shares only a category', () => {
  const host = post('host', { related_cluster: 'personal-protection', category: 'personal' });
  const clusterMate = post('cluster-mate', { related_cluster: 'personal-protection', publish_date: '2025-01-01' });
  const newerSameCategory = post('newer', { category: 'personal', tags: ['umbrella'], publish_date: '2026-09-01' });
  const out = rankRelated([host], [host, clusterMate, newerSameCategory], { minScore: 10 });
  assert.equal(out.get('host')[0], 'cluster-mate');
});

test('no candidate receives more than perTargetCap (15) Related links', () => {
  const target = post('popular', { tags: ['flood'], publish_date: '2026-09-01' });
  const hosts = Array.from({ length: 40 }, (_, i) => post(`host-${String(i).padStart(2, '0')}`, { tags: ['flood'] }));
  const out = rankRelated(hosts, [target, ...hosts]);
  const inbound = [...out.values()].filter((list) => list.includes('popular')).length;
  assert.ok(inbound <= 15, `popular got ${inbound} Related links`);
  assert.equal(inbound, 15);
});

test('a post missing from the candidates (retired or unpublished) never appears', () => {
  const host = post('host', { tags: ['umbrella', 'liability'] });
  const live = post('live', { tags: ['umbrella'] });
  const retired = post('what-is-liability-insurance', { tags: ['umbrella', 'liability'] });
  const out = rankRelated([host, retired], [host, live]);
  assert.deepEqual(out.get('host'), ['live']);
  assert.ok(![...out.values()].flat().includes('what-is-liability-insurance'));
});

test('the output is deterministic across runs and host order', () => {
  const corpus = Array.from({ length: 30 }, (_, i) => post(`p${i}`, { tags: [`t${i % 4}`, 'shared'], category: i % 2 ? 'personal' : 'commercial', publish_date: `2026-0${(i % 9) + 1}-01` }));
  const one = rankRelated(corpus, corpus);
  const two = rankRelated([...corpus].reverse(), [...corpus].reverse());
  assert.deepEqual([...one.entries()].sort(), [...two.entries()].sort());
});

test('the liability post gets umbrella and liability posts, not flood, boating or Farm Bureau (BLOG-03)', () => {
  const host = post('liability-limits-how-much-enough', {
    related_cluster: 'personal-protection', target_product_page: '/personal/umbrella.html',
    tags: ['liability-insurance', 'umbrella', 'kentucky', 'coverage-limits'], category: 'personal',
  });
  const umbrella = post('umbrella-insurance-worth-it', { related_cluster: 'personal-protection', tags: ['umbrella'], publish_date: '2025-05-01' });
  const autoLimits = post('understanding-auto-insurance-coverage-options', { target_product_page: '/personal/umbrella', tags: ['liability insurance'], publish_date: '2025-04-01' });
  const limits = post('coverage-limits-explained', { tags: ['coverage limits'], publish_date: '2025-03-01' });
  const flood = post('owensboro-flood-risk', { tags: ['flood', 'kentucky'], category: 'personal', publish_date: '2026-09-30' });
  const boating = post('boating-safety', { tags: ['boat', 'insurance'], publish_date: '2026-09-29' });
  const kfb = post('independent-vs-kentucky-farm-bureau', { tags: ['kentucky', 'farm bureau'], publish_date: '2026-09-28' });
  const out = rankRelated([host], [host, flood, boating, kfb, umbrella, autoLimits, limits]);
  assert.deepEqual(out.get(host.slug), ['umbrella-insurance-worth-it', 'understanding-auto-insurance-coverage-options', 'coverage-limits-explained']);
});

test('generic tags (kentucky, insurance) never count as a shared signal', () => {
  assert.deepEqual([...tagSet('[kentucky, insurance, Coverage-Limits]')], ['coverage limits']);
  const a = post('a', { tags: ['kentucky', 'insurance'] });
  const b = post('b', { tags: ['kentucky', 'insurance'] });
  assert.deepEqual(rankRelated([a], [a, b]).get('a'), []);
});

test('a shared priority hub counts only for hubs in the priority set', () => {
  const host = post('host', { target_location_pages: ['/insurance/owensboro-ky.html'], category: 'local' });
  const cand = post('cand', { target_location_pages: ['/insurance/owensboro-ky'], category: 'local' });
  assert.deepEqual(rankRelated([host], [host, cand], { priorityHubs: new Set(['/insurance/owensboro-ky']) }).get('host'), ['cand']);
  assert.deepEqual(rankRelated([host], [host, cand], { priorityHubs: new Set() }).get('host'), []);
});

test('relatedBlockedProblems flags a Related Articles link to a blocked_guides post, not other links', () => {
  const { relatedBlockedProblems } = require('../scripts/lib/link-structure-check');
  const page = (links) => `<article><p><a href="/blog/held-post">in-text link is not Related</a></p>
      <section><h2 style="x">Related Articles</h2><div>${links.map((s) => `<a href="/blog/${s}" class="card">t</a>`).join('')}</div></section></article>`;
  const site = new Map([
    ['/blog/a', { rel: 'blog/a.html', html: page(['ok-post', 'held-post']) }],
    ['/blog/b', { rel: 'blog/b.html', html: page(['ok-post']) }],
    ['/blog/frozen', { rel: 'blog/frozen.html', html: page(['held-post']) }],
    ['/personal/home', { rel: 'personal/home.html', html: page(['held-post']) }],
  ]);
  const out = relatedBlockedProblems(site, ['held-post'], new Set(['blog/frozen.html']));
  assert.equal(out.length, 1);
  assert.match(out[0], /^\/blog\/a: Related Articles links held-post/);
});

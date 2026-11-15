'use strict';
/**
 * Y-84 (A): applying scripts/lib/blog-writing-guard.js to the posts on disk.
 *
 *   - An UNPUBLISHED post (a calendar entry not yet 'published', a post off the
 *     calendar dated after today, or anything in src/blog/_drafts/) must break
 *     no rule. The PR check applies this to the posts a PR adds or edits; the
 *     review-request and publish gates apply it to each post as it moves.
 *   - A LIVE post is held to data/blog-writing-baseline.json: per post and per
 *     rule, its count may only go down. A count above the baseline fails, and so
 *     does one below it (the entry is stale: lower it in the same PR), so the
 *     list only shrinks as the Y-84 (B) clean-up batches land.
 *   - An exception (data/blog-writing-exceptions.json) that waives nothing fails.
 */
const fs = require('fs');
const path = require('path');
const { RULES, problemCounts, postProblems, loadExceptions } = require('./blog-writing-guard');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULTS = Object.freeze({
  blogDir: path.join(ROOT, 'src', 'blog'),
  calendarFile: path.join(ROOT, 'data', 'content-calendar.json'),
  baselineFile: path.join(ROOT, 'data', 'blog-writing-baseline.json'),
  exceptionsFile: path.join(ROOT, 'data', 'blog-writing-exceptions.json'),
});

/** Every calendar entry with a slug and a publish date, by slug. */
function calendarEntries(calendar) {
  const out = new Map();
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.slug === 'string' && v.publish_date) { out.set(v.slug, v); return; }
    Object.values(v).forEach(walk);
  };
  walk(calendar);
  return out;
}

/** The posts on disk: [{ slug, file, rel, md, draft }]. */
function postsOnDisk(blogDir) {
  const out = [];
  const read = (dir, draft) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.md') || f === 'README.md') continue;
      const file = path.join(dir, f);
      out.push({ slug: f.slice(0, -3), file, rel: path.relative(ROOT, file).split(path.sep).join('/'), md: fs.readFileSync(file, 'utf8'), draft });
    }
  };
  read(blogDir, false);
  read(path.join(blogDir, '_drafts'), true);
  return out;
}

/** Is this post live? A draft never; a calendar post when 'published'; any other post once its date has come. */
function isLive(post, entries, today) {
  if (post.draft) return false;
  const e = entries.get(post.slug);
  if (e) return e.status === 'published';
  const date = (/^date:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(post.md) || [])[1];
  return !!date && date <= today;
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

/**
 * The whole check.
 * @param {object} o
 * @param {Set<string>|null} [o.changed] repo-relative post paths a PR adds or edits (null: check no unpublished post)
 * @returns {{ problems: string[], liveCounts: object, unpublished: number, live: number }}
 */
function checkPosts({ blogDir = DEFAULTS.blogDir, calendar, baseline, exceptions, today, changed = null } = {}) {
  const entries = calendarEntries(calendar);
  const base = (baseline && baseline.posts) || {};
  const problems = [];
  const liveCounts = {};
  const usedExceptions = new Set();
  const seen = new Set();
  let live = 0;
  let unpublished = 0;
  for (const post of postsOnDisk(blogDir)) {
    const { problems: found, used } = postProblems(post.slug, post.md, exceptions);
    used.forEach((u) => usedExceptions.add(u));
    if (isLive(post, entries, today)) {
      live++;
      seen.add(post.slug);
      const counts = {};
      for (const p of found) counts[p.rule] = (counts[p.rule] || 0) + 1;
      if (Object.keys(counts).length) liveCounts[post.slug] = counts;
      const want = base[post.slug] || {};
      for (const r of RULES) {
        const have = counts[r.id] || 0;
        const allowed = want[r.id] || 0;
        if (have > allowed) {
          const first = found.find((p) => p.rule === r.id);
          problems.push(`${post.rel}: live post has ${have} "${r.id}" problem(s), its baseline allows ${allowed} (it may only improve). First: line ${first.line}: ${first.text}`);
        } else if (have < allowed) {
          problems.push(`${post.rel}: live post now has ${have} "${r.id}" problem(s); lower its entry in data/blog-writing-baseline.json from ${allowed} to ${have} in this change`);
        }
      }
    } else {
      unpublished++;
      if (changed && changed.has(post.rel)) {
        for (const p of found) problems.push(`${post.rel}:${p.line}: unpublished post breaks the "${p.rule}" rule: ${p.text}`);
      }
    }
  }
  for (const slug of Object.keys(base)) {
    if (!seen.has(slug)) problems.push(`data/blog-writing-baseline.json: "${slug}" is not a live post; remove its entry`);
  }
  for (const e of exceptions) {
    if (!usedExceptions.has(e)) problems.push(`data/blog-writing-exceptions.json: the exception for "${e.slug}" (${e.rule}, "${e.contains}") waives nothing; remove it`);
  }
  return { problems, liveCounts, live, unpublished };
}

/**
 * The baseline to write from today's live counts. It never raises a count or adds a
 * post that the current baseline does not list, unless `init` (no baseline yet).
 */
function nextBaseline(current, liveCounts, { init = false } = {}) {
  const posts = {};
  const refused = [];
  for (const [slug, counts] of Object.entries(liveCounts).sort(([a], [b]) => a.localeCompare(b))) {
    const was = current && current.posts ? current.posts[slug] : undefined;
    for (const [rule, n] of Object.entries(counts)) {
      if (!init && (!was || (was[rule] || 0) < n)) refused.push(`${slug} ${rule}: ${was ? was[rule] || 0 : 'not listed'} -> ${n}`);
    }
    posts[slug] = Object.fromEntries(RULES.map((r) => [r.id, counts[r.id] || 0]).filter(([, n]) => n > 0));
  }
  if (refused.length) throw new Error(`blog-writing baseline: a live post may only improve; refusing to raise: ${refused.join('; ')}`);
  return {
    _note: 'Y-84 (A) ratchet: per live post, per rule (scripts/lib/blog-writing-guard.js), the number of problems it may still have. Counts only go down: scripts/check-blog-writing.js fails a live post above its count, and an entry above the post\'s real count (lower it in the same change). Rewrite with: node scripts/check-blog-writing.js --write-baseline (never raises a count).',
    posts,
  };
}

/**
 * W1 (scripts/queue-status.js): unpublished calendar posts 0-18 days out (the
 * review request window) whose markdown breaks a rule: [{ entry, problems }].
 */
function writingHolds(calendar, { blogDir = DEFAULTS.blogDir, today, exceptions = [] } = {}) {
  const day = (ymd) => Date.parse(`${ymd}T00:00:00Z`);
  const holds = [];
  for (const p of (calendar && calendar.year1) || []) {
    if (!p || !p.slug || ['published', 'error', 'approved'].includes(p.status) || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.publish_date || ''))) continue;
    const daysOut = Math.round((day(p.publish_date) - day(today)) / 86400000);
    if (daysOut < 0 || daysOut > 18) continue;
    const file = path.join(blogDir, `${p.slug}.md`);
    if (!fs.existsSync(file)) continue;
    const found = postProblems(p.slug, fs.readFileSync(file, 'utf8'), exceptions).problems;
    if (found.length) holds.push({ entry: p, problems: found });
  }
  return holds;
}

module.exports = { writingHolds, DEFAULTS, calendarEntries, postsOnDisk, isLive, checkPosts, nextBaseline, readJson, loadExceptions, problemCounts };

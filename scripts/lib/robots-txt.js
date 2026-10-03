'use strict';
/**
 * A small robots.txt evaluator following RFC 9309 (the Robots Exclusion
 * Protocol), used by tests/robots-txt.test.js and scripts/validate-build.js
 * to prove which crawlers robots.txt allows (AEO-03).
 *
 * - Groups: consecutive User-agent lines open a group; the rules after them
 *   belong to it until the next User-agent line that follows a rule. Other
 *   lines (Sitemap, Content-Signal) neither open nor close a group.
 * - A crawler obeys every group naming its product token (case-insensitive,
 *   merged), and the '*' group only when no group names it.
 * - The longest matching path pattern wins; on a tie, Allow wins. '*' matches
 *   any characters and a trailing '$' anchors the end. No match: allowed.
 *
 * Dependency-free: validate-build.js loads it on Node 18 without npm ci.
 */

/** Search and answer crawlers that must stay allowed (AEO-03 acceptance criteria, 16 tokens). */
const SEARCH_AND_ANSWER_AGENTS = Object.freeze([
  'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User',
  'Googlebot', 'Bingbot', 'Applebot', 'DuckAssistBot', 'Amzn-SearchBot', 'Amzn-User',
  'Meta-WebIndexer', 'Meta-ExternalFetcher', 'MistralAI-Index', 'MistralAI-User',
]);

/** AI-training crawlers disallowed under AEO-03 Option A (owner's ai-train=no). */
const TRAINING_AGENTS = Object.freeze([
  'GPTBot', 'ClaudeBot', 'Applebot-Extended', 'CCBot', 'Amazonbot', 'MistralAI-Training', 'Bytespider',
]);

/** Tokens held for an explicit owner decision (AEO-03): neither added nor blocked here. */
const OWNER_PENDING_AGENTS = Object.freeze(['Google-Extended', 'meta-externalagent']);

function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      if (current) current.rules.push({ allow: key === 'allow', path: value });
      lastWasAgent = false;
    }
    // Sitemap, Content-Signal and unknown lines: part of no group's rules, and
    // they neither open nor close a group.
  }
  return groups;
}

/** The rules a crawler with this product token obeys. */
function rulesFor(groups, token) {
  const t = String(token).toLowerCase();
  const named = groups.filter((g) => g.agents.includes(t));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function patternRegExp(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** True when a crawler with this product token may fetch urlPath. */
function isAllowed(robotsText, token, urlPath) {
  const rules = rulesFor(parseRobots(robotsText), token);
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue; // "Disallow:" with no path matches nothing
    if (!patternRegExp(r.path).test(urlPath)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
  }
  return best ? best.allow : true;
}

/** Problems with robots.txt against the AEO-03 Option A policy, for the given sample paths. */
function robotsPolicyProblems(robotsText, paths = ['/', '/insurance/owensboro-ky', '/blog/']) {
  const problems = [];
  for (const p of paths) {
    for (const t of SEARCH_AND_ANSWER_AGENTS) if (!isAllowed(robotsText, t, p)) problems.push(`robots.txt disallows search/answer crawler ${t} on ${p}`);
    for (const t of TRAINING_AGENTS) if (isAllowed(robotsText, t, p)) problems.push(`robots.txt allows training crawler ${t} on ${p}`);
  }
  return problems;
}

module.exports = {
  SEARCH_AND_ANSWER_AGENTS, TRAINING_AGENTS, OWNER_PENDING_AGENTS,
  parseRobots, rulesFor, isAllowed, robotsPolicyProblems,
};

/**
 * robots.txt (AEO-03 Option A): the * group and its Content-Signal line are
 * kept, one group disallows the seven AI-training crawlers, and the 16 search
 * and answer crawlers stay allowed. Evaluated with scripts/lib/robots-txt.js
 * (RFC 9309 group selection and longest-match rules).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { isAllowed, parseRobots, SEARCH_AND_ANSWER_AGENTS, TRAINING_AGENTS, OWNER_PENDING_AGENTS } = require('../scripts/lib/robots-txt');

const robots = fs.readFileSync(path.join(__dirname, '..', 'robots.txt'), 'utf8');
const PATHS = ['/', '/insurance/owensboro-ky', '/blog/understanding-insurance-endorsements', '/health/medicare', '/llms.txt'];

describe('robots.txt policy', () => {
  test('the 16 search and answer crawlers are allowed', () => {
    assert.equal(SEARCH_AND_ANSWER_AGENTS.length, 16);
    for (const token of SEARCH_AND_ANSWER_AGENTS) for (const p of PATHS) assert.ok(isAllowed(robots, token, p), `${token} ${p}`);
  });
  test('the seven training crawlers are disallowed everywhere', () => {
    assert.deepEqual([...TRAINING_AGENTS], ['GPTBot', 'ClaudeBot', 'Applebot-Extended', 'CCBot', 'Amazonbot', 'MistralAI-Training', 'Bytespider']);
    for (const token of TRAINING_AGENTS) for (const p of PATHS) assert.ok(!isAllowed(robots, token, p), `${token} ${p}`);
    // Product tokens match case-insensitively.
    assert.ok(!isAllowed(robots, 'gptbot', '/'));
  });
  test('Google-Extended and meta-externalagent are not named (owner decision pending)', () => {
    const named = parseRobots(robots).flatMap((g) => g.agents);
    for (const token of OWNER_PENDING_AGENTS) {
      assert.ok(!named.includes(token.toLowerCase()), token);
      assert.ok(isAllowed(robots, token, '/'), token);
    }
  });
  test('the * group, its Content-Signal line and its existing rules are unchanged', () => {
    assert.match(robots, /^User-agent: \*\nContent-Signal: search=yes, ai-input=yes, ai-train=no\nAllow: \/$/m);
    assert.match(robots, /^Sitemap: https:\/\/www\.thewayagency\.com\/sitemap\.xml$/m);
    assert.ok(!isAllowed(robots, 'Googlebot', '/admin/x'));
    assert.ok(isAllowed(robots, 'Googlebot', '/src/js/app.js'));
    assert.doesNotMatch(robots, /noarchive/i);
  });
});

describe('the evaluator (RFC 9309)', () => {
  const r = 'User-agent: *\nDisallow: /private/\nAllow: /private/ok\n\nUser-agent: TestBot\nUser-agent: OtherBot\nDisallow: /\nAllow: /public$\n\nUser-agent: testbot\nDisallow: /extra\n';
  test('longest match wins, Allow wins a tie, no match is allowed', () => {
    assert.ok(!isAllowed(r, 'AnyBot', '/private/x'));
    assert.ok(isAllowed(r, 'AnyBot', '/private/ok'));
    assert.ok(isAllowed(r, 'AnyBot', '/elsewhere'));
    assert.ok(isAllowed('User-agent: *\nDisallow: /a\nAllow: /a\n', 'AnyBot', '/a'));
  });
  test('a named group replaces *, consecutive User-agent lines share a group, same-name groups merge', () => {
    assert.ok(!isAllowed(r, 'TestBot', '/'));
    assert.ok(!isAllowed(r, 'OtherBot', '/anything'));
    assert.ok(isAllowed(r, 'TestBot', '/public'));
    assert.ok(!isAllowed(r, 'TestBot', '/public/more'));
    assert.equal(parseRobots(r).filter((g) => g.agents.includes('testbot')).length, 2);
  });
  test('Sitemap and unknown lines do not end a group', () => {
    assert.ok(!isAllowed('User-agent: *\nSitemap: https://example.com/s.xml\nDisallow: /x\n', 'AnyBot', '/x'));
  });
});

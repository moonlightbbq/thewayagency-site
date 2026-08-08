/**
 * The research brief has to survive the trip from backlog to dated post.
 *
 * The pipeline picks a topic BECAUSE of a specific angle: page 1 is weak here,
 * the AI Overview cites something stale, these are the real questions people
 * ask. All of that lives in `research_brief`. blog-planner injects it into the
 * blog-write task, and seo-auditor's draft gate checks the finished draft
 * AGAINST it — direct answer delivered, questions answered, sources cited.
 *
 * candidateToPost() did not copy it. So a topic chosen for its angle would
 * reach the writer as a bare title, and the gate that exists to verify the
 * angle was honoured would have nothing to compare against — while still
 * reporting a clean pass.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const q = require('../scripts/lib/content-queue');

const BRIEF = {
  demand_evidence: '125 impressions at position 2.1 with 0.8% CTR',
  serp_landscape: 'Page 1 is national carriers; no Kentucky-specific filing detail anywhere',
  differentiation_angle: 'State-specific filing steps and real costs, which page 1 omits entirely',
  direct_answer_target: 'Medicare open enrollment runs October 15 to December 7 each year.',
  questions_to_answer: ['When does it start?', 'What can I change?'],
  entities_to_cover: ['Medicare Advantage', 'Part D', 'KY DOI'],
  internal_links: ['/health/medicare.html'],
  sources: ['https://www.medicare.gov', 'https://insurance.ky.gov'],
};

function candidate(over = {}) {
  return {
    slug: 'medicare-open-enrollment-kentucky',
    title: 'Medicare Open Enrollment in Kentucky',
    primary_keyword: 'medicare open enrollment kentucky',
    status: 'approved',
    seasonality_window: null,
    target_location_pages: [],
    ...over,
  };
}

describe('candidateToPost carries the research brief', () => {
  test('the brief reaches the dated post intact', () => {
    const post = q.candidateToPost(candidate({ research_brief: BRIEF }), '2026-10-14', '2026-10-01');
    assert.deepEqual(post.research_brief, BRIEF);
  });

  test('the differentiation angle specifically survives', () => {
    // This is the field the whole selection decision rests on.
    const post = q.candidateToPost(candidate({ research_brief: BRIEF }), '2026-10-14', '2026-10-01');
    assert.equal(post.research_brief.differentiation_angle, BRIEF.differentiation_angle);
  });

  test('sources survive, so the draft gate can verify citations', () => {
    const post = q.candidateToPost(candidate({ research_brief: BRIEF }), '2026-10-14', '2026-10-01');
    assert.deepEqual(post.research_brief.sources, BRIEF.sources);
  });

  test('a candidate without a brief yields null, not undefined', () => {
    // Explicit null so the absence is visible in the committed JSON rather
    // than the key vanishing.
    const post = q.candidateToPost(candidate(), '2026-10-14', '2026-10-01');
    assert.equal(post.research_brief, null);
  });

  test('the rest of the post is unchanged', () => {
    const post = q.candidateToPost(candidate({ research_brief: BRIEF }), '2026-10-14', '2026-10-01');
    assert.equal(post.slug, 'medicare-open-enrollment-kentucky');
    assert.equal(post.publish_date, '2026-10-14');
    assert.equal(post.status, 'planned');
    assert.equal(post.source, 'queue-lock');
  });
});

describe('backlog schema', () => {
  const backlog = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'content-backlog.json'), 'utf8'),
  );

  test('is at version 2', () => {
    assert.equal(backlog.version, 2);
  });

  test('documents the candidate shape, including research_brief', () => {
    assert.match(backlog._doc, /research_brief/);
    assert.match(backlog._doc, /CANDIDATE SHAPE/);
  });

  test('every live candidate carries the fields the scheduler requires', () => {
    for (const c of backlog.candidates) {
      assert.ok(c.slug, 'candidate missing slug');
      assert.ok(c.title, `${c.slug}: missing title`);
      assert.ok(c.primary_keyword, `${c.slug}: missing primary_keyword`);
      assert.ok(['proposed', 'approved', 'on-hold', 'rejected'].includes(c.status), `${c.slug}: bad status`);
    }
  });

  test('no live candidate carries an unschedulable seasonality_window', () => {
    // Under fail-closed, a window outside the taxonomy means the candidate can
    // never be placed — and the only symptom is "out of season".
    const windows = q.loadWindowMonths();
    for (const c of backlog.candidates) {
      if (!c.seasonality_window) continue;
      assert.ok(windows[c.seasonality_window],
        `${c.slug}: seasonality_window "${c.seasonality_window}" is not in the taxonomy`);
    }
  });
});

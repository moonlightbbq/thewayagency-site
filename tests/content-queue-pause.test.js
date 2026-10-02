/**
 * The explicit content-queue pause (BLOG-06, content-accuracy E1).
 *
 * On 2026-10-02 the approved backlog was 0, and the reserved slots on
 * 2026-10-03, 10-07 and 10-10 tripped I2b, the invariant that turns
 * publish-blog.yml red. Deleting those slots does not help: reserveSlots()
 * re-reserves every free date on its next run. The pause is one calendar field
 * the owner sets (queue_pause). reserveSlots, fillSlots and the invariants
 * honour it, and I9 makes a malformed or over-long pause loud.
 *
 * Fixtures only. The two CLI tests run the real scripts against copies in a
 * temporary directory; nothing here reads or writes this checkout's data/.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const q = require('../scripts/lib/content-queue');

const ROOT = path.join(__dirname, '..');
// The day BLOG-06 was reproduced. Every date below is relative to it, and every
// call passes it explicitly, so nothing here depends on the real clock.
const TODAY = '2026-10-02'; // a Friday
const PAUSE = Object.freeze({
  until: '2026-10-27',
  reason: 'accuracy and consolidation program (SEO/AEO audit 2026-10-02)',
  set_by: 'owner',
  set_on: '2026-10-02',
});
// The reserved slot ledger origin/main held on 2026-10-02 (the Wed/Sat
// cadence), plus one past locked slot (history, never pruned).
const LEDGER_DATES = ['2026-10-03', '2026-10-07', '2026-10-10', '2026-10-14', '2026-10-17', '2026-10-21', '2026-10-24', '2026-10-28'];
// The publish dates the queue's own cadence puts in the horizon (equal to
// LEDGER_DATES under Wed/Sat), so these tests hold whatever PUBLISH_WEEKDAYS is.
const HORIZON = q.publishDatesWithin(TODAY, q.HORIZON_DAYS);
const PAUSED_HORIZON = HORIZON.filter(d => d <= PAUSE.until);
const noMarkdown = () => false;
const allMarkdown = () => true;
const WINDOWS = { 'winter-prep': [9, 10] };

function ledger() {
  return [
    { date: '2026-09-26', state: 'locked', locked_slug: 'synthetic-past-post', locked_at: '2026-09-12', reserved_at: '2026-08-29' },
    ...LEDGER_DATES.map(date => ({ date, state: 'reserved', locked_slug: null, locked_at: null, reserved_at: '2026-09-05' })),
  ];
}
function calendar({ pause, slots = ledger(), posts = [] } = {}) {
  const cal = { year1: [{ slug: 'synthetic-past-post', title: 'T', publish_date: '2026-09-26', status: 'published' }, ...posts], slots };
  if (pause !== undefined) cal.queue_pause = pause;
  return cal;
}
const ids = r => r.violations.map(v => v.id);
const i9 = r => r.violations.filter(v => v.id === 'I9');
const approved = slug => ({
  slug, title: 'Synthetic Topic', primary_keyword: `synthetic ${slug} keyword`, status: 'approved', seasonality_window: null,
});

describe('queuePause / isPaused', () => {
  test('no field: no pause', () => {
    assert.equal(q.queuePause(calendar()), null);
    assert.equal(q.isPaused(calendar(), '2026-10-03'), false);
  });

  test('a valid pause covers every date up to and including "until", and nothing after', () => {
    const cal = calendar({ pause: { ...PAUSE } });
    assert.equal(q.queuePause(cal).until, '2026-10-27');
    for (const d of ['2026-10-03', '2026-10-24', '2026-10-27']) assert.equal(q.isPaused(cal, d), true, d);
    for (const d of ['2026-10-28', '2026-11-04']) assert.equal(q.isPaused(cal, d), false, d);
  });

  test('a pause whose "until" is not a real date is not honoured (I9 reports it)', () => {
    for (const until of [undefined, null, '', '2026-10-xx', '2026-02-30', '27/10/2026', 20261027]) {
      const cal = calendar({ pause: { ...PAUSE, until } });
      assert.equal(q.queuePause(cal), null, String(until));
      assert.equal(q.isPaused(cal, '2026-10-03'), false, String(until));
    }
    for (const pause of [null, 'until 2026-10-27', ['2026-10-27']]) {
      assert.equal(q.queuePause(calendar({ pause })), null, JSON.stringify(pause));
    }
  });
});

describe('reserveSlots honours the pause', () => {
  test('control: without a pause, deleting the empty slots does nothing - the next run re-reserves them', () => {
    const cal = calendar({ slots: ledger().filter(s => s.state === 'locked') });
    const { added } = q.reserveSlots(cal, TODAY);
    assert.deepEqual(added, HORIZON);
    assert.ok(added.includes('2026-10-07'));
  });

  test('drops every unlocked slot on a paused date and keeps the first date after the pause', () => {
    const cal = calendar({ pause: { ...PAUSE } });
    const { added, pruned } = q.reserveSlots(cal, TODAY);
    assert.deepEqual(added, []);
    assert.equal(pruned, 7);
    assert.deepEqual(cal.slots.map(s => s.date), ['2026-09-26', '2026-10-28']);
  });

  test('never reserves a paused date, and resumes on the first date after "until"', () => {
    const cal = calendar({ pause: { ...PAUSE }, slots: [] });
    const { added } = q.reserveSlots(cal, TODAY);
    assert.deepEqual(added, ['2026-10-28']);
  });

  test('keeps a LOCKED slot inside the pause: its post is committed, and the pause does not unschedule it', () => {
    const slots = [...ledger().filter(s => s.date !== '2026-10-14'),
      { date: '2026-10-14', state: 'locked', locked_slug: 'synthetic-locked', locked_at: '2026-09-30', reserved_at: '2026-09-16' }];
    const cal = calendar({ pause: { ...PAUSE }, slots, posts: [{ slug: 'synthetic-locked', title: 'T', publish_date: '2026-10-14', status: 'planned' }] });
    q.reserveSlots(cal, TODAY);
    assert.ok(cal.slots.some(s => s.date === '2026-10-14' && s.state === 'locked'));
  });

  test('is idempotent under a pause', () => {
    const cal = calendar({ pause: { ...PAUSE } });
    q.reserveSlots(cal, TODAY);
    const snapshot = JSON.stringify(cal.slots);
    const second = q.reserveSlots(cal, TODAY);
    assert.deepEqual([second.added.length, second.pruned], [0, 0]);
    assert.equal(JSON.stringify(cal.slots), snapshot);
  });

  test('an ended pause is inert: the queue reserves as usual', () => {
    const cal = calendar({ pause: { ...PAUSE, until: '2026-10-01', set_on: '2026-09-15' }, slots: [] });
    const { added } = q.reserveSlots(cal, TODAY);
    assert.deepEqual(added, HORIZON);
  });
});

describe('fillSlots skips paused slots', () => {
  // 10-14 is 12 days out: inside the lock window and past the review floor.
  const IN_WINDOW = '2026-10-14';
  const oneSlot = () => [{ date: IN_WINDOW, state: 'reserved', locked_slug: null, locked_at: null, reserved_at: '2026-09-16' }];

  test('commits no topic to a paused date, even an approved one with its draft written', () => {
    const cal = calendar({ pause: { ...PAUSE }, slots: oneSlot() });
    const backlog = { candidates: [approved('ready')] };
    for (const allowReviewSkip of [false, true]) {
      const { locked } = q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: allMarkdown, allowReviewSkip });
      assert.equal(locked.length, 0, `allowReviewSkip=${allowReviewSkip}`);
    }
    assert.equal(cal.slots[0].state, 'reserved');
    assert.equal(cal.year1.length, 1, 'no post may be dated');
    assert.equal(backlog.candidates.length, 1, 'the candidate stays in the backlog');
  });

  test('control: the same slot is filled once the pause no longer covers it', () => {
    const cal = calendar({ pause: { ...PAUSE, until: '2026-10-13' }, slots: oneSlot() });
    const backlog = { candidates: [approved('ready')] };
    const { locked } = q.fillSlots(cal, backlog, TODAY, WINDOWS, { hasMarkdown: allMarkdown });
    assert.deepEqual(locked.map(l => [l.date, l.slug]), [[IN_WINDOW, 'ready']]);
  });
});

describe('the invariants under a pause', () => {
  test('reproduction: without the pause, the 2026-10-02 ledger trips I2 and I2b', () => {
    const r = q.evaluateInvariants(calendar(), { candidates: [] }, TODAY, { hasMarkdown: noMarkdown });
    assert.match(r.violations.find(v => v.id === 'I2b').message, /2026-10-03, 2026-10-07, 2026-10-10$/);
    assert.match(r.violations.find(v => v.id === 'I2').message, /2026-10-14$/);
    assert.equal(r.stats.pause, null);
  });

  test('with the pause, I1, I2 and I2b are quiet; I5 stays (a planning signal)', () => {
    const r = q.evaluateInvariants(calendar({ pause: { ...PAUSE } }), { candidates: [] }, TODAY, { hasMarkdown: noMarkdown });
    for (const id of ['I1', 'I2', 'I2b', 'I9']) assert.ok(!ids(r).includes(id), id);
    assert.ok(ids(r).includes('I5'));
  });

  test('also after reserveSlots dropped the paused slots, and the horizon counts add up', () => {
    const cal = calendar({ pause: { ...PAUSE } });
    q.reserveSlots(cal, TODAY);
    const r = q.evaluateInvariants(cal, { candidates: [] }, TODAY, { hasMarkdown: noMarkdown });
    for (const id of ['I1', 'I2', 'I2b']) assert.ok(!ids(r).includes(id), id);
    const s = r.stats;
    assert.deepEqual(s.horizonDates, HORIZON);
    assert.equal(s.reserved, 1);
    assert.deepEqual(s.pause.dates, PAUSED_HORIZON);
    assert.equal(s.filled + s.reserved + s.pause.dates.length + s.unreserved.length, s.horizonDates.length);
    assert.equal(s.nextEmptyDate, '2026-10-28', 'the next empty date is the first one the queue may use');
  });

  test('stats.pause exposes the pause', () => {
    const { stats } = q.evaluateInvariants(calendar({ pause: { ...PAUSE } }), { candidates: [] }, TODAY, { hasMarkdown: noMarkdown });
    assert.equal(stats.pause.until, PAUSE.until);
    assert.equal(stats.pause.reason, PAUSE.reason);
    assert.equal(stats.pause.set_by, 'owner');
    assert.equal(stats.pause.set_on, '2026-10-02');
    assert.equal(stats.pause.active, true);
    assert.deepEqual(stats.pause.posts, []);
    const ended = q.evaluateInvariants(calendar({ pause: { ...PAUSE } }), { candidates: [] }, '2026-10-28', { hasMarkdown: noMarkdown });
    assert.equal(ended.stats.pause.active, false);
  });

  test('a post dated inside the pause still publishes, so it is listed and I4 still guards its markdown', () => {
    const posts = [{ slug: 'synthetic-dated-inside', title: 'T', publish_date: '2026-10-07', status: 'planned' }];
    const r = q.evaluateInvariants(calendar({ pause: { ...PAUSE }, posts }), { candidates: [] }, TODAY, { hasMarkdown: noMarkdown });
    assert.deepEqual(r.stats.pause.posts.map(p => p.slug), ['synthetic-dated-inside']);
    assert.match(r.violations.find(v => v.id === 'I4').message, /synthetic-dated-inside/);
  });

  test('a locked slot inside the pause is still checked (I3)', () => {
    const slots = [{ date: '2026-10-14', state: 'locked', locked_slug: 'synthetic-ghost', locked_at: '2026-09-30', reserved_at: '2026-09-16' }];
    const r = q.evaluateInvariants(calendar({ pause: { ...PAUSE }, slots }), { candidates: [] }, TODAY, { hasMarkdown: allMarkdown });
    assert.match(r.violations.find(v => v.id === 'I3').message, /synthetic-ghost/);
  });

  test('the day after "until", empty dates count again', () => {
    const r = q.evaluateInvariants(calendar({ pause: { ...PAUSE }, slots: [] }), { candidates: [] }, '2026-10-28', { hasMarkdown: noMarkdown });
    assert.ok(ids(r).includes('I1'));
  });
});

describe('I9: a malformed, open-ended or over-long pause is loud', () => {
  const run = pause => q.evaluateInvariants(calendar({ pause }), { candidates: [] }, TODAY, { hasMarkdown: noMarkdown });

  test('a valid pause raises no I9, up to exactly 90 days', () => {
    assert.deepEqual(i9(run({ ...PAUSE })), []);
    assert.equal(q.MAX_PAUSE_DAYS, 90);
    assert.deepEqual(i9(run({ ...PAUSE, until: '2026-12-31' })), [], '90 days after 2026-10-02');
  });

  const NOT_HONOURED = [
    ['no "until"', (() => { const p = { ...PAUSE }; delete p.until; return p; })(), /has no "until"/],
    ['a malformed "until"', { ...PAUSE, until: '2026-10-xx' }, /"until" is "2026-10-xx", not a YYYY-MM-DD date/],
    ['an impossible "until"', { ...PAUSE, until: '2026-02-30', set_on: '2026-02-01' }, /"until" is "2026-02-30"/],
    ['a string', 'until 2026-10-27', /is not an object/],
    ['an array', ['2026-10-27'], /is not an object/],
  ];
  for (const [label, pause, message] of NOT_HONOURED) {
    test(`${label}: I9, the queue is NOT paused, and the empty dates alarm again`, () => {
      const r = run(pause);
      assert.equal(i9(r).length, 1);
      assert.match(i9(r)[0].message, message);
      assert.match(i9(r)[0].message, /The queue is NOT paused/);
      assert.ok(ids(r).includes('I2b'), 'not honoured, so I2b is back');
    });
  }

  test('"until" more than 90 days after "set_on": I9, though the stated pause is still honoured', () => {
    const r = run({ ...PAUSE, until: '2027-01-01' });
    assert.match(i9(r)[0].message, /"until" 2027-01-01 is 91 days after "set_on" 2026-10-02; a pause runs at most 90 days/);
    assert.doesNotMatch(i9(r)[0].message, /NOT paused/);
    assert.ok(!ids(r).includes('I2b'));
  });

  test('"until" before "set_on", or a missing or bad "set_on", "reason" or "set_by"', () => {
    const cases = [
      [{ ...PAUSE, until: '2026-10-01' }, /"until" 2026-10-01 is before "set_on" 2026-10-02/],
      [{ ...PAUSE, set_on: undefined }, /has no "set_on"/],
      [{ ...PAUSE, set_on: 'today' }, /"set_on" is "today"/],
      [{ ...PAUSE, reason: '  ' }, /has no "reason"/],
      [{ ...PAUSE, set_by: undefined }, /has no "set_by"/],
    ];
    for (const [pause, message] of cases) {
      const r = run(JSON.parse(JSON.stringify(pause)));
      assert.equal(i9(r).length, 1, JSON.stringify(pause));
      assert.match(i9(r)[0].message, message);
    }
  });

  test('ending a pause never turns the run red: an ended, deleted or null pause raises nothing', () => {
    for (const [label, pause] of [['ended', { ...PAUSE, until: '2026-10-01', set_on: '2026-09-15' }], ['null', null], ['absent', undefined]]) {
      const r = run(pause);
      assert.deepEqual(i9(r), [], label);
      assert.deepEqual(q.queuePauseProblems(calendar({ pause })), [], label);
    }
    assert.equal(q.queuePause(calendar({ pause: null })), null);
  });

  test('one list for I9 and the build check: queuePauseProblems', () => {
    assert.deepEqual(q.queuePauseProblems(calendar()), [], 'absent');
    assert.deepEqual(q.queuePauseProblems(calendar({ pause: { ...PAUSE } })), [], 'valid');
    assert.deepEqual(q.queuePauseProblems(calendar({ pause: {} })),
      ['has no "until"', 'has no "set_on"', 'has no "reason"', 'has no "set_by"']);
  });
});

describe('the publish workflow fails on I9', () => {
  test('I9 is in the queue-health --fail-on list, next to I4, I2b, I6 and I7', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8');
    const m = wf.match(/queue-status\.js --fail-on (\S+)/);
    assert.ok(m, 'queue-status --fail-on step not found');
    const list = m[1].split(',');
    for (const id of ['I4', 'I2b', 'I6', 'I7', 'I9']) assert.ok(list.includes(id), id);
    assert.ok(!list.includes('I5'), 'a thin backlog stays a planning signal');
  });
});

describe('the scripts', () => {
  function withCalendar(cal, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-pause-'));
    try {
      const file = path.join(dir, 'content-calendar.json');
      fs.writeFileSync(file, `${JSON.stringify(cal, null, 2)}\n`);
      return fn(file);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const queueStatus = (file, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'queue-status.js'), '--today', TODAY, ...args],
    { encoding: 'utf8', env: { ...process.env, CONTENT_CALENDAR_PATH: file } });

  test('queue-status prints "PAUSED until <date>: <reason>" first, and the CI invocation stays green', () => {
    withCalendar(calendar({ pause: { ...PAUSE } }), (file) => {
      const r = queueStatus(file, '--fail-on', 'I4,I2b,I6,I7,I9');
      assert.equal(r.stderr, '');
      assert.equal(r.status, 0, r.stdout);
      const body = r.stdout.split('\n').filter(l => l.trim() && !/^Content queue as of|^=+$/.test(l));
      assert.equal(body[0], `PAUSED until ${PAUSE.until}: ${PAUSE.reason}`);
      assert.match(r.stdout, new RegExp(`paused {12}: ${PAUSED_HORIZON.length}\n`));
    });
  });

  test('queue-status flags a pause it cannot honour, and --fail-on I9 turns the run red', () => {
    withCalendar(calendar({ pause: { ...PAUSE, until: 'soon' } }), (file) => {
      const r = queueStatus(file, '--fail-on', 'I9');
      assert.equal(r.status, 1);
      assert.match(r.stdout, /queue_pause is set but NOT honoured/);
      assert.match(r.stdout, /x I9: queue_pause "until" is "soon"/);
    });
  });

  test('check-data-integrity validates the field with the same rules (run on a temporary copy of data/)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-pause-data-'));
    try {
      fs.cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
      fs.cpSync(path.join(ROOT, 'scripts', 'lib'), path.join(dir, 'scripts', 'lib'), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'scripts', 'check-data-integrity.js'), path.join(dir, 'scripts', 'check-data-integrity.js'));
      const calPath = path.join(dir, 'data', 'content-calendar.json');
      const real = JSON.parse(fs.readFileSync(calPath, 'utf8'));
      const check = (pause) => {
        fs.writeFileSync(calPath, `${JSON.stringify({ ...real, queue_pause: pause }, null, 2)}\n`);
        return spawnSync(process.execPath, [path.join(dir, 'scripts', 'check-data-integrity.js')], { encoding: 'utf8' });
      };
      const valid = check({ ...PAUSE });
      assert.doesNotMatch(valid.stdout, /queue_pause/);
      const bad = check({ until: '2027-03-01', set_on: '2026-10-02' });
      assert.equal(bad.status, 1);
      assert.match(bad.stdout, /✗ content-calendar\.json: queue_pause has no "reason"/);
      assert.match(bad.stdout, /✗ content-calendar\.json: queue_pause "until" 2027-03-01 is 150 days after/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

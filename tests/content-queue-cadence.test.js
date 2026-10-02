/**
 * One post a week, on Wednesday (content-accuracy D10, BLOG-06, E2).
 *
 * The owner decided 1/week on 2026-08-04; the Wed/Sat queue that launched the
 * same week doubled it. The queue lib, the publish workflow's cron and the
 * build check each carried their own copy of the weekdays, so these tests pin
 * the three together: the cron is read from the workflow, and the build check
 * takes its weekdays from the lib, validating them only from the date the
 * cadence changed (seven past Saturday slots are history and must not fail).
 *
 * Fixtures only; the check-data test runs the real script on a temporary copy
 * of data/.
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

describe('the cadence is one post a week, on Wednesday', () => {
  test('the publish workflow runs on every one of the queue lib\'s publish days', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8');
    const crons = [...wf.matchAll(/^\s*-\s*cron:\s*'([^']+)'/gm)].map(m => m[1]);
    assert.equal(crons.length, 1, 'one schedule');
    const days = crons[0].trim().split(/\s+/)[4].split(',').map(Number);
    for (const d of q.PUBLISH_WEEKDAYS) assert.ok(days.includes(d), `the cron misses publish weekday ${d}`);
    assert.deepEqual(q.PUBLISH_WEEKDAYS, [3]);
  });

  test('the workflow still runs twice a week, so a slot locked at T-14 after the Wednesday run gets its review email', () => {
    // SAGE locks a slot 14 days out in the afternoon, after the 10:00 UTC run;
    // send-review-emails.js asks only while a post is 10-18 days out. A
    // Wednesday-only run would next see it at T-7, too late; Saturday is T-11.
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8');
    const days = wf.match(/^\s*-\s*cron:\s*'([^']+)'/m)[1].trim().split(/\s+/)[4].split(',').map(Number);
    const post = '2026-11-11'; // a Wednesday
    const lockedAt = q.toYmd(new Date(q.asDate(post).getTime() - 14 * 86400000));
    const runsAfterLock = [];
    for (let i = 1; i <= 14; i++) {
      const d = q.toYmd(new Date(q.asDate(lockedAt).getTime() + i * 86400000));
      if (days.includes(q.asDate(d).getUTCDay())) runsAfterLock.push(q.daysBetween(d, post));
    }
    assert.ok(runsAfterLock.some(n => n >= 10 && n <= 18), `runs at T-${runsAfterLock.join(', T-')} miss the 10-18 window`);
  });

  test('the approved-backlog floor is four weeks at one a week, and I5 says so', () => {
    assert.equal(q.MIN_APPROVED_BACKLOG, 4);
    const r = q.evaluateInvariants({ year1: [], slots: [] }, { candidates: [] }, '2026-10-28', { hasMarkdown: () => true });
    assert.equal(r.violations.find(v => v.id === 'I5').message, 'approved backlog is 0, below the floor of 4 (4 weeks at 1x/week)');
  });

  test('reserveSlots reserves Wednesdays only', () => {
    const cal = { year1: [], slots: [] };
    const { added } = q.reserveSlots(cal, '2026-10-28');
    assert.deepEqual(added, ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
  });

  test('the cadence change is dated, so the build check can leave the Wed/Sat history alone', () => {
    assert.match(q.PUBLISH_WEEKDAYS_SINCE, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(q.PUBLISH_WEEKDAYS_SINCE > '2026-09-26', 'after the last locked Saturday slot');
  });
});

describe('check-data-integrity checks slot weekdays from the cadence change on (temporary copy of data/)', () => {
  function checkData(mutateCalendar) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-cadence-data-'));
    try {
      fs.cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
      fs.cpSync(path.join(ROOT, 'scripts', 'lib'), path.join(dir, 'scripts', 'lib'), { recursive: true });
      fs.copyFileSync(path.join(ROOT, 'scripts', 'check-data-integrity.js'), path.join(dir, 'scripts', 'check-data-integrity.js'));
      const calPath = path.join(dir, 'data', 'content-calendar.json');
      const cal = JSON.parse(fs.readFileSync(calPath, 'utf8'));
      mutateCalendar(cal);
      fs.writeFileSync(calPath, `${JSON.stringify(cal, null, 2)}\n`);
      return spawnSync(process.execPath, [path.join(dir, 'scripts', 'check-data-integrity.js')], { encoding: 'utf8' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const slot = (date, state = 'reserved') => ({ date, state, locked_slug: state === 'locked' ? 'synthetic-locked' : null, locked_at: null, reserved_at: '2026-10-02' });
  const weekdayErrors = r => r.stdout.split('\n').filter(l => /✗ content-calendar\.json: slot \S+ is not a /.test(l));

  test('Saturday slots before the change are history: no weekday error', () => {
    // 2026-08-01 was a Saturday on the old Wed/Sat ledger (the real one holds
    // seven more, 2026-08-08 to 09-26).
    const r = checkData((cal) => { cal.slots.unshift(slot('2026-08-01', 'locked')); });
    assert.deepEqual(weekdayErrors(r), []);
  });

  test('a Saturday slot on or after the change is an error; a Wednesday one is not', () => {
    const r = checkData((cal) => { cal.slots.push(slot('2026-10-31'), slot('2026-11-04')); });
    assert.deepEqual(weekdayErrors(r).map(l => l.trim()), ['✗ content-calendar.json: slot 2026-10-31 is not a Wednesday']);
    assert.equal(r.status, 1);
  });
});

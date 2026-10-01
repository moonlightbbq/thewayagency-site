/**
 * scripts/git-push-rebase.sh — the publish workflow's push step.
 *
 * SAGE commits to main directly (sage-server #943), so a publish run can find
 * main moved under it. The script must rebase this run's own commit onto what
 * landed and push it, keep both sides only when they changed different units
 * (a calendar entry, a post file), and never pick a side: not when they changed
 * the same lines, not when they changed the same entry on different lines (the
 * compare-and-swap rule, scripts/push-cas-check.js), and not when main was
 * rewritten (a PII purge force-pushed while the run worked).
 *
 * Each case builds a throwaway bare "origin", a checkout that plays the
 * workflow and a full clone that plays SAGE. No network.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'git-push-rebase.sh');

// Hermetic git: nothing inherited from a caller's GIT_* environment (a hook)
// or from the user's global or system config.
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: os.devNull,
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
};

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function bare(origin, ...args) {
  return execFileSync('git', ['--git-dir', origin, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Calendar entries long enough that publish_date and status sit on lines far
// apart, as in data/content-calendar.json; author_slug sits right after status.
const entry = (slug, status, extra = {}) => ({
  publish_date: '2026-10-03',
  week: 40,
  title: `Title ${slug}`,
  slug,
  description: `About ${slug}.`,
  pillar: 'auto',
  primary_keyword: slug,
  status,
  author_slug: 'the-way-agency',
  reviewer: 'Test Reviewer',
  ...extra,
});
const CAL = (a, b, { a: extraA = {}, b: extraB = {} } = {}) => JSON.stringify({
  version: '1',
  year1: [
    entry('test-post-a', a, extraA),
    entry('test-spacer-1', 'planned'),
    entry('test-spacer-2', 'planned'),
    entry('test-spacer-3', 'planned'),
    entry('test-post-b', b, extraB),
  ],
}, null, 2) + '\n';

const POST = ({ date = '2026-09-01', line5 = 'Paragraph five.' } = {}) => [
  '---', 'title: "Test post A"', 'description: "A test post."', `date: ${date}`, '---', '',
  'Paragraph one.', '', 'Paragraph two.', '', 'Paragraph three.', '', 'Paragraph four.', '', line5, '',
].join('\n');

/**
 * checkout: 'clone' (full history) or 'actions' (what actions/checkout@v4 does
 * by default: init, fetch --depth=1 the triggering sha into
 * refs/remotes/origin/main, checkout -B main).
 */
function setup({ checkout = 'clone' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-rebase-'));
  const origin = path.join(dir, 'origin.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = path.join(dir, 'seed');
  git(dir, 'clone', '-q', origin, seed);
  git(seed, 'config', 'user.name', 'Test Seed');
  git(seed, 'config', 'user.email', 'seed@example.com');
  fs.mkdirSync(path.join(seed, 'data'));
  fs.mkdirSync(path.join(seed, 'src', 'blog'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'data', 'content-calendar.json'), CAL('in-review', 'in-review'));
  fs.writeFileSync(path.join(seed, 'src', 'blog', 'test-post-a.md'), POST());
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'seed');
  // A file a later history purge removes.
  fs.writeFileSync(path.join(seed, 'pii.txt'), 'customer data that must not come back\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'add pii.txt');
  // A few commits of history so a shallow checkout really is shallow.
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(seed, `note-${i}.txt`), `note ${i}\n`);
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', `history ${i}`);
  }
  git(seed, 'push', '-q', 'origin', 'HEAD:main');

  const named = (p, name) => {
    git(p, 'config', 'user.name', `Test ${name}`);
    git(p, 'config', 'user.email', `${name}@example.com`);
    return p;
  };
  const run = path.join(dir, 'workflow');
  if (checkout === 'actions') {
    const sha = bare(origin, 'rev-parse', 'main');
    git(dir, 'init', '-q', '-b', 'main', run);
    git(run, 'remote', 'add', 'origin', `file://${origin}`);
    git(run, 'fetch', '-q', '--no-tags', '--prune', '--no-recurse-submodules', '--depth=1', 'origin', `+${sha}:refs/remotes/origin/main`);
    git(run, 'checkout', '-q', '--force', '-B', 'main', 'refs/remotes/origin/main');
  } else {
    git(dir, 'clone', '-q', origin, run);
  }
  named(run, 'workflow');
  const sage = path.join(dir, 'sage');
  git(dir, 'clone', '-q', origin, sage);
  named(sage, 'sage');
  return { dir, origin, run, sage, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function commitCal(repo, a, b, msg, extra) {
  fs.writeFileSync(path.join(repo, 'data', 'content-calendar.json'), CAL(a, b, extra));
  git(repo, 'add', 'data/content-calendar.json');
  git(repo, 'commit', '-q', '-m', msg);
}
function sageCommits(t, a, b, msg, extra) {
  commitCal(t.sage, a, b, msg, extra);
  git(t.sage, 'push', '-q', 'origin', 'HEAD:main');
  return git(t.sage, 'rev-parse', 'HEAD');
}

function push(repo, env = {}) {
  return spawnSync('bash', [SCRIPT, 'main'], {
    cwd: repo, encoding: 'utf8', env: { ...ENV, PUSH_RETRY_SLEEP: '0', PUSH_ATTEMPTS: '3', ...env },
  });
}
const out = (r) => r.stdout + r.stderr;

const originTip = (t) => bare(t.origin, 'rev-parse', 'main');
const originCal = (t) => JSON.parse(bare(t.origin, 'show', 'main:data/content-calendar.json'));
const originHas = (t, p) => spawnSync('git', ['--git-dir', t.origin, 'cat-file', '-e', `main:${p}`], { env: ENV }).status === 0;

/** Every refusal: non-zero exit, origin exactly where SAGE left it, the shared give-up message. */
function assertRefused(r, t, tip) {
  assert.notEqual(r.status, 0, out(r));
  assert.equal(originTip(t), tip, 'origin is untouched');
  assert.match(out(r), /::error::.*Nothing was pushed/);
  assert.match(out(r), /Do NOT use "Re-run jobs"/);
  assert.match(out(r), /Run workflow/);
  assert.match(out(r), /Review emails and reminders this run sent were not recorded/);
  assert.doesNotMatch(out(r), /A re-run \(or the next scheduled run\) redoes/, 'a re-run replays the stale commit; it is never the remedy');
}

describe('git-push-rebase.sh', () => {
  test('nothing landed meanwhile: pushes on the first attempt', () => {
    const t = setup();
    try {
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assert.equal(r.status, 0, out(r));
      assert.equal(originCal(t).year1[0].status, 'published');
    } finally { t.cleanup(); }
  });

  test('SAGE committed a different entry meanwhile: rebased, pushed, both changes kept', () => {
    const t = setup();
    try {
      sageCommits(t, 'in-review', 'approved', 'SAGE approves b');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assert.equal(r.status, 0, out(r));
      const cal = originCal(t);
      assert.equal(cal.year1[0].status, 'published', 'the run\'s publish is on main');
      assert.equal(cal.year1[4].status, 'approved', 'SAGE\'s approval survived');
      // Linear history: the run's commit sits on top of SAGE's.
      assert.deepEqual(bare(t.origin, 'log', '--format=%s', '-2', 'main').split('\n'), ['publish a', 'SAGE approves b']);
    } finally { t.cleanup(); }
  });

  test('SAGE changed the same lines meanwhile: no side is picked, nothing is pushed, the step fails', () => {
    const t = setup();
    try {
      const sageTip = sageCommits(t, 'changes-requested', 'in-review', 'SAGE holds a');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const runTip = git(t.run, 'rev-parse', 'HEAD');
      const r = push(t.run);
      assertRefused(r, t, sageTip);
      assert.match(out(r), /changed the same lines as this run \(conflict in: data\/content-calendar\.json\)/);
      assert.equal(originCal(t).year1[0].status, 'changes-requested', 'SAGE\'s hold stands');
      assert.equal(git(t.run, 'rev-parse', 'HEAD'), runTip, 'the rebase was aborted, the run\'s commit is intact');
      assert.equal(fs.existsSync(path.join(t.run, '.git', 'rebase-merge')) || fs.existsSync(path.join(t.run, '.git', 'rebase-apply')), false);
    } finally { t.cleanup(); }
  });

  // ── Compare-and-swap: the same entry or file, on different lines ──

  test('SAGE rescheduled the entry this run publishes (different lines): refused, the reschedule stands', () => {
    const t = setup();
    try {
      const sageTip = sageCommits(t, 'in-review', 'in-review', 'reschedule a', { a: { publish_date: '2026-11-01' } });
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assertRefused(r, t, sageTip);
      assert.match(out(r), /data\/content-calendar\.json: entry "test-post-a": origin changed it after this run read it/);
      const a = originCal(t).year1[0];
      assert.equal(a.publish_date, '2026-11-01');
      assert.equal(a.status, 'in-review', 'not published on the date it no longer has');
    } finally { t.cleanup(); }
  });

  test('SAGE reassigned the reviewer of the entry this run publishes (two lines below status): refused', () => {
    const t = setup();
    try {
      const sageTip = sageCommits(t, 'in-review', 'in-review', 'reassign a', { a: { reviewer: 'Another Reviewer' } });
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assertRefused(r, t, sageTip);
      assert.match(out(r), /entry "test-post-a": origin changed it after this run read it/, 'refused by the compare-and-swap check: the lines merged');
      assert.equal(originCal(t).year1[0].reviewer, 'Another Reviewer');
      assert.equal(originCal(t).year1[0].status, 'in-review');
    } finally { t.cleanup(); }
  });

  test('SAGE rewrote the body of the post this run publishes (different lines): refused, the run checked other bytes', () => {
    const t = setup();
    try {
      fs.writeFileSync(path.join(t.sage, 'src', 'blog', 'test-post-a.md'), POST({ line5: 'A rewritten paragraph five.' }));
      git(t.sage, 'commit', '-q', '-am', 'SAGE rewrites the body of a');
      git(t.sage, 'push', '-q', 'origin', 'HEAD:main');
      const sageTip = git(t.sage, 'rev-parse', 'HEAD');
      // The run publishes a: calendar status, and the frontmatter date rewritten.
      fs.writeFileSync(path.join(t.run, 'src', 'blog', 'test-post-a.md'), POST({ date: '2026-10-03' }));
      git(t.run, 'add', 'src/blog/test-post-a.md');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assertRefused(r, t, sageTip);
      assert.match(out(r), /src\/blog\/test-post-a\.md: origin changed this file after this run read it/);
    } finally { t.cleanup(); }
  });

  test('the merged calendar does not parse: refused', () => {
    const t = setup();
    try {
      const cal = path.join(t.sage, 'data', 'content-calendar.json');
      fs.writeFileSync(cal, fs.readFileSync(cal, 'utf8').replace('"version": "1",', '"version": "1",,'));
      git(t.sage, 'commit', '-q', '-am', 'a broken edit far from entry a');
      git(t.sage, 'push', '-q', 'origin', 'HEAD:main');
      const sageTip = git(t.sage, 'rev-parse', 'HEAD');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assertRefused(r, t, sageTip);
      assert.match(out(r), /not valid JSON/);
    } finally { t.cleanup(); }
  });

  // ── A rewritten main (a PII purge force-pushed while the run worked) ──

  for (const [label, checkout, gc] of [
    ['a full clone', 'clone', false],
    ['an actions/checkout shallow checkout', 'actions', false],
    ['an actions/checkout shallow checkout, old objects pruned on the server', 'actions', true],
  ]) {
    test(`main was force-pushed without a purged file (${label}): refused, the file stays gone`, () => {
      const t = setup({ checkout });
      try {
        execFileSync('git', ['filter-branch', '-f', '--index-filter', 'git rm -q --cached --ignore-unmatch pii.txt', 'HEAD'], {
          cwd: t.sage, env: { ...ENV, FILTER_BRANCH_SQUELCH_WARNING: '1' }, stdio: 'pipe',
        });
        git(t.sage, 'push', '-q', '-f', 'origin', 'HEAD:main');
        if (gc) {
          bare(t.origin, 'reflog', 'expire', '--expire=now', '--all');
          bare(t.origin, 'gc', '-q', '--prune=now');
        }
        const purgedTip = git(t.sage, 'rev-parse', 'HEAD');
        assert.equal(originHas(t, 'pii.txt'), false);
        commitCal(t.run, 'published', 'in-review', 'publish a');
        const r = push(t.run);
        assertRefused(r, t, purgedTip);
        assert.match(out(r), /was rewritten \(force-pushed\)/);
        assert.equal(originHas(t, 'pii.txt'), false, 'the purged file did not come back');
      } finally { t.cleanup(); }
    });
  }

  // ── Retrying ──

  test('main moves during every back-off: the push follows the rebase at once and lands', () => {
    const t = setup();
    try {
      sageCommits(t, 'in-review', 'approved', 'SAGE approves b');
      // `sleep` stands in for the back-off, and SAGE commits during each one.
      const shim = path.join(t.dir, 'shim');
      fs.mkdirSync(shim);
      fs.writeFileSync(path.join(shim, 'sleep'), [
        '#!/bin/sh',
        'n=$(( $(cat "$SHIM_COUNT" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$SHIM_COUNT"',
        'cd "$SHIM_SAGE" || exit 1',
        'echo "moved $n" > "moved-$n.txt"',
        'git add "moved-$n.txt" && git commit -q -m "SAGE moves main ($n)" && git push -q origin HEAD:main',
      ].join('\n') + '\n', { mode: 0o755 });
      const count = path.join(t.dir, 'sleep-count');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run, { PATH: `${shim}${path.delimiter}${ENV.PATH}`, SHIM_SAGE: t.sage, SHIM_COUNT: count });
      assert.equal(r.status, 0, out(r));
      assert.equal(fs.readFileSync(count, 'utf8').trim(), '1', 'one back-off, then a rebase and a push that landed');
      assert.equal(originCal(t).year1[0].status, 'published');
      assert.equal(originCal(t).year1[4].status, 'approved');
      assert.equal(originHas(t, 'moved-1.txt'), true, 'what landed during the back-off is kept');
    } finally { t.cleanup(); }
  });

  test('a rejection that is not a race (a pre-receive hook): bounded attempts, nothing pushed, the full give-up message', () => {
    const t = setup();
    try {
      const count = path.join(t.dir, 'hook-count');
      fs.writeFileSync(path.join(t.origin, 'hooks', 'pre-receive'), `#!/bin/sh\necho x >> '${count}'\necho 'protected branch' >&2\nexit 1\n`, { mode: 0o755 });
      const tip = originTip(t);
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assertRefused(r, t, tip);
      assert.match(out(r), /rejected 3 times/);
      assert.equal(fs.readFileSync(count, 'utf8').trim().split('\n').length, 3, 'exactly PUSH_ATTEMPTS pushes');
    } finally { t.cleanup(); }
  });

  test('a failed fetch is reported and bounded, not a bare git exit', () => {
    const t = setup();
    try {
      const sageTip = sageCommits(t, 'in-review', 'approved', 'SAGE approves b');
      git(t.run, 'remote', 'set-url', 'origin', path.join(t.dir, 'no-such-remote.git'));
      git(t.run, 'remote', 'set-url', '--push', 'origin', t.origin);
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assertRefused(r, t, sageTip);
      assert.equal(r.status, 1);
      assert.match(out(r), /::warning::git fetch of origin\/main failed/);
    } finally { t.cleanup(); }
  });

  // ── Local state ──

  test('a tracked file the run left modified but did not commit does not block the rebase', () => {
    const t = setup();
    try {
      sageCommits(t, 'in-review', 'approved', 'SAGE approves b');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      fs.writeFileSync(path.join(t.run, 'note-0.txt'), 'regenerated by the build, not committed\n');
      const r = push(t.run);
      assert.equal(r.status, 0, out(r));
      assert.equal(originCal(t).year1[0].status, 'published');
      assert.equal(originCal(t).year1[4].status, 'approved');
      assert.equal(fs.readFileSync(path.join(t.run, 'note-0.txt'), 'utf8'), 'regenerated by the build, not committed\n', 'the uncommitted edit is put back');
    } finally { t.cleanup(); }
  });

  test('an uncommitted edit that conflicts when put back: pushed, no conflict markers left, the edit kept in the stash', () => {
    const t = setup();
    try {
      fs.writeFileSync(path.join(t.sage, 'note-0.txt'), 'changed by SAGE\n');
      git(t.sage, 'add', 'note-0.txt');
      commitCal(t.sage, 'in-review', 'approved', 'SAGE approves b and changes note-0');
      git(t.sage, 'push', '-q', 'origin', 'HEAD:main');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      fs.writeFileSync(path.join(t.run, 'note-0.txt'), 'regenerated by the build, not committed\n');
      const r = push(t.run);
      assert.equal(r.status, 0, out(r));
      assert.equal(originCal(t).year1[0].status, 'published');
      assert.match(out(r), /::warning::This run's uncommitted edits to note-0\.txt/);
      assert.equal(fs.readFileSync(path.join(t.run, 'note-0.txt'), 'utf8'), 'changed by SAGE\n', 'the working tree holds the pushed version, no markers');
      assert.equal(git(t.run, 'diff', '--name-only', '--diff-filter=U'), '');
      assert.match(git(t.run, 'stash', 'list'), /autostash/);
    } finally { t.cleanup(); }
  });

  test('an untracked file in the way of one SAGE added: refused, and not reported as a same-lines conflict', () => {
    const t = setup();
    try {
      fs.writeFileSync(path.join(t.sage, 'data', 'new.json'), '{"by":"sage"}\n');
      git(t.sage, 'add', 'data/new.json');
      git(t.sage, 'commit', '-q', '-m', 'SAGE adds data/new.json');
      git(t.sage, 'push', '-q', 'origin', 'HEAD:main');
      const sageTip = git(t.sage, 'rev-parse', 'HEAD');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      fs.writeFileSync(path.join(t.run, 'data', 'new.json'), '{"by":"run"}\n');
      const r = push(t.run);
      assertRefused(r, t, sageTip);
      assert.match(out(r), /could not start/);
      assert.doesNotMatch(out(r), /same lines/);
    } finally { t.cleanup(); }
  });

  test('SAGE deleted the post this run publishes: refused', () => {
    const t = setup();
    try {
      git(t.sage, 'rm', '-q', 'src/blog/test-post-a.md');
      git(t.sage, 'commit', '-q', '-m', 'SAGE withdraws a');
      git(t.sage, 'push', '-q', 'origin', 'HEAD:main');
      const sageTip = git(t.sage, 'rev-parse', 'HEAD');
      fs.writeFileSync(path.join(t.run, 'src', 'blog', 'test-post-a.md'), POST({ date: '2026-10-03' }));
      git(t.run, 'commit', '-q', '-am', 'publish a: frontmatter date');
      const r = push(t.run);
      assertRefused(r, t, sageTip);
      assert.equal(originHas(t, 'src/blog/test-post-a.md'), false);
    } finally { t.cleanup(); }
  });

  test('a detached HEAD (actions/checkout of a sha) still rebases and pushes', () => {
    const t = setup({ checkout: 'actions' });
    try {
      git(t.run, 'checkout', '-q', '--detach');
      sageCommits(t, 'in-review', 'approved', 'SAGE approves b');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assert.equal(r.status, 0, out(r));
      assert.equal(originCal(t).year1[0].status, 'published');
      assert.equal(originCal(t).year1[4].status, 'approved');
    } finally { t.cleanup(); }
  });

  test('an actions/checkout shallow checkout rebases without deepening and moves only the run\'s commit', () => {
    const t = setup({ checkout: 'actions' });
    try {
      assert.equal(git(t.run, 'rev-parse', '--is-shallow-repository'), 'true');
      sageCommits(t, 'in-review', 'approved', 'SAGE approves b');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assert.equal(r.status, 0, out(r));
      assert.equal(originCal(t).year1[0].status, 'published');
      assert.equal(originCal(t).year1[4].status, 'approved');
      assert.equal(git(t.run, 'rev-parse', '--is-shallow-repository'), 'true');
      assert.equal(git(t.run, 'rev-list', '--count', 'HEAD'), '3', 'the shallow root, SAGE\'s commit, the run\'s commit');
      assert.deepEqual(bare(t.origin, 'log', '--format=%s', '-3', 'main').split('\n'), ['publish a', 'SAGE approves b', 'history 2']);
    } finally { t.cleanup(); }
  });

  test('a checkout that is not built on origin/main is refused, never pushed to main', () => {
    const t = setup();
    try {
      // A branch forked two commits back, as a dispatch from another branch with full history would be.
      git(t.run, 'checkout', '-q', '-b', 'feature', 'HEAD~2');
      fs.writeFileSync(path.join(t.run, 'feature.txt'), 'feature work\n');
      git(t.run, 'add', 'feature.txt');
      git(t.run, 'commit', '-q', '-m', 'feature work');
      const tip = originTip(t);
      const r = push(t.run);
      assertRefused(r, t, tip);
      assert.match(out(r), /HEAD is not built on origin\/main/);
      assert.equal(originHas(t, 'feature.txt'), false);
    } finally { t.cleanup(); }
  });

  test('a checkout with no origin/main (actions/checkout of another branch) is refused, never pushed to main', () => {
    const t = setup();
    try {
      git(t.run, 'update-ref', '-d', 'refs/remotes/origin/main');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const tip = originTip(t);
      const r = push(t.run);
      assertRefused(r, t, tip);
      assert.match(out(r), /There is no origin\/main to start from/);
    } finally { t.cleanup(); }
  });

  test('the publish workflow pushes through the script, never with a bare git push', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8');
    const commit = wf.slice(wf.indexOf('- name: Commit and push'), wf.indexOf('- name: Queue health'));
    assert.match(commit, /bash scripts\/git-push-rebase\.sh main/);
    assert.doesNotMatch(commit, /^\s*git push\b/m);
  });
});

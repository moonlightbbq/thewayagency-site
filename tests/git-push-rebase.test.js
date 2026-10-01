/**
 * scripts/git-push-rebase.sh — the publish workflow's push step.
 *
 * SAGE commits to main directly (sage-server #943), so a publish run can find
 * main moved under it. The script must rebase onto what landed and push, keep
 * both sides when they touched different lines, and never pick a side when they
 * touched the same lines (that is the lost update #943 removed).
 *
 * Each case builds a throwaway bare "origin", a clone that plays the workflow
 * and a second clone that plays SAGE. No network.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'git-push-rebase.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const CAL = (a, b) => JSON.stringify({ year1: [
  { slug: 'test-post-a', status: a },
  { slug: 'test-spacer-1', status: 'planned' },
  { slug: 'test-spacer-2', status: 'planned' },
  { slug: 'test-spacer-3', status: 'planned' },
  { slug: 'test-post-b', status: b },
] }, null, 2) + '\n';

function setup({ shallow = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-rebase-'));
  const origin = path.join(dir, 'origin.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  const seed = path.join(dir, 'seed');
  git(dir, 'clone', '-q', origin, seed);
  for (const c of [seed]) { git(c, 'config', 'user.name', 'Test Seed'); git(c, 'config', 'user.email', 'seed@example.com'); }
  fs.mkdirSync(path.join(seed, 'data'));
  fs.writeFileSync(path.join(seed, 'data', 'content-calendar.json'), CAL('in-review', 'in-review'));
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'seed');
  // A few commits of history so a shallow clone really is shallow.
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(seed, `note-${i}.txt`), `note ${i}\n`);
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', `history ${i}`);
  }
  git(seed, 'push', '-q', 'origin', 'HEAD:main');

  const clone = (name, depth) => {
    const p = path.join(dir, name);
    const args = ['clone', '-q'];
    if (depth) args.push('--depth', String(depth), '--no-local');
    args.push(depth ? `file://${origin}` : origin, p);
    git(dir, ...args);
    git(p, 'config', 'user.name', `Test ${name}`);
    git(p, 'config', 'user.email', `${name}@example.com`);
    return p;
  };
  const run = clone('workflow', shallow ? 1 : 0);
  const sage = clone('sage', 0);
  return { dir, origin, run, sage, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function commitCal(repo, a, b, msg) {
  fs.writeFileSync(path.join(repo, 'data', 'content-calendar.json'), CAL(a, b));
  git(repo, 'add', 'data/content-calendar.json');
  git(repo, 'commit', '-q', '-m', msg);
}

function push(repo) {
  return spawnSync('bash', [SCRIPT, 'main'], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, PUSH_RETRY_SLEEP: '0', PUSH_ATTEMPTS: '3' },
  });
}

function originCal(origin) {
  return JSON.parse(execFileSync('git', ['--git-dir', origin, 'show', 'main:data/content-calendar.json'], { encoding: 'utf8' }));
}

describe('git-push-rebase.sh', () => {
  test('nothing landed meanwhile: pushes on the first attempt', () => {
    const t = setup();
    try {
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(originCal(t.origin).year1[0].status, 'published');
    } finally { t.cleanup(); }
  });

  test('SAGE committed a different entry meanwhile: rebased, pushed, both changes kept', () => {
    const t = setup();
    try {
      commitCal(t.sage, 'in-review', 'approved', 'SAGE approves b');
      git(t.sage, 'push', '-q', 'origin', 'HEAD:main');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const cal = originCal(t.origin);
      assert.equal(cal.year1[0].status, 'published', 'the run\'s publish is on main');
      assert.equal(cal.year1[4].status, 'approved', 'SAGE\'s approval survived');
      // Linear history: the run's commit sits on top of SAGE's.
      const log = execFileSync('git', ['--git-dir', t.origin, 'log', '--format=%s', '-2', 'main'], { encoding: 'utf8' }).trim().split('\n');
      assert.deepEqual(log, ['publish a', 'SAGE approves b']);
    } finally { t.cleanup(); }
  });

  test('SAGE changed the same entry meanwhile: no side is picked, nothing is pushed, the step fails', () => {
    const t = setup();
    try {
      commitCal(t.sage, 'changes-requested', 'in-review', 'SAGE holds a');
      git(t.sage, 'push', '-q', 'origin', 'HEAD:main');
      const sageTip = git(t.sage, 'rev-parse', 'HEAD');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const runTip = git(t.run, 'rev-parse', 'HEAD');
      const r = push(t.run);
      assert.notEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /conflict in: data\/content-calendar\.json/);
      assert.equal(execFileSync('git', ['--git-dir', t.origin, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), sageTip, 'origin is untouched');
      assert.equal(originCal(t.origin).year1[0].status, 'changes-requested', 'SAGE\'s hold stands');
      assert.equal(git(t.run, 'rev-parse', 'HEAD'), runTip, 'the rebase was aborted, the run\'s commit is intact');
      assert.equal(fs.existsSync(path.join(t.run, '.git', 'rebase-merge')) || fs.existsSync(path.join(t.run, '.git', 'rebase-apply')), false);
    } finally { t.cleanup(); }
  });

  test('a tracked file the run left modified but did not commit does not block the rebase', () => {
    const t = setup();
    try {
      commitCal(t.sage, 'in-review', 'approved', 'SAGE approves b');
      git(t.sage, 'push', '-q', 'origin', 'HEAD:main');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      fs.writeFileSync(path.join(t.run, 'note-0.txt'), 'regenerated by the build, not committed\n');
      const r = push(t.run);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(originCal(t.origin).year1[0].status, 'published');
      assert.equal(originCal(t.origin).year1[4].status, 'approved');
      assert.equal(fs.readFileSync(path.join(t.run, 'note-0.txt'), 'utf8'), 'regenerated by the build, not committed\n', 'the uncommitted edit is put back');
    } finally { t.cleanup(); }
  });

  test('a shallow checkout (actions/checkout default) still finds the merge base', () => {
    const t = setup({ shallow: true });
    try {
      assert.equal(git(t.run, 'rev-parse', '--is-shallow-repository'), 'true');
      commitCal(t.sage, 'in-review', 'approved', 'SAGE approves b');
      git(t.sage, 'push', '-q', 'origin', 'HEAD:main');
      commitCal(t.run, 'published', 'in-review', 'publish a');
      const r = push(t.run);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const cal = originCal(t.origin);
      assert.equal(cal.year1[0].status, 'published');
      assert.equal(cal.year1[4].status, 'approved');
    } finally { t.cleanup(); }
  });

  test('the publish workflow pushes through the script, never with a bare git push', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-blog.yml'), 'utf8');
    const commit = wf.slice(wf.indexOf('- name: Commit and push'), wf.indexOf('- name: Queue health'));
    assert.match(commit, /bash scripts\/git-push-rebase\.sh main/);
    assert.doesNotMatch(commit, /^\s*git push\b/m);
  });
});

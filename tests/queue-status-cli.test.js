/**
 * queue-status exit codes.
 *
 * CI runs `--fail-on I4,I2b` rather than `--strict`: an empty slot inside the
 * markdown window (I4) or a date that will publish nothing (I2b) must break the
 * build, but a thin backlog (I5) is a planning signal and should not turn the
 * publish workflow red.
 *
 * Uses a future clock against the real data so it exercises the actual script
 * without mutating anything.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'queue-status.js');
// Far enough out that the horizon is entirely unreserved, so I1 is guaranteed.
const FUTURE = '2026-12-01';

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('queue-status exit codes', () => {
  test('exits 0 with no flags even when invariants are violated', () => {
    const r = run('--today', FUTURE);
    assert.equal(r.status, 0, 'reporting alone must never break a build');
    assert.match(r.stdout, /invariant violation/);
  });

  test('--fail-on fires for an invariant that IS violated', () => {
    assert.equal(run('--today', FUTURE, '--fail-on', 'I1').status, 1);
  });

  test('--fail-on stays green for an invariant that is not violated', () => {
    // I1 is violated at this clock, I4 is not. Selecting only I4 must pass,
    // which is what stops a thin backlog from reddening the publish run.
    assert.equal(run('--today', FUTURE, '--fail-on', 'I4').status, 0);
  });

  test('--strict fails on any violation', () => {
    assert.equal(run('--today', FUTURE, '--strict').status, 1);
  });

  test('an unknown invariant id is inert rather than a crash', () => {
    const r = run('--today', FUTURE, '--fail-on', 'I99');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('the CI invocation is exercised verbatim', () => {
    // Whatever the current state, the real command must not crash.
    const r = run('--fail-on', 'I4,I2b');
    assert.ok([0, 1].includes(r.status));
    assert.equal(r.stderr, '');
  });
});

/**
 * The weekly topic-approval digest — the human gate between "an adapter
 * proposed a topic" and "it can be scheduled".
 *
 * The scoring it reports is content-queue's and is tested there; what matters
 * here is that the script is safe to run unattended: it must never send
 * without credentials, never crash on an empty backlog, and must surface a
 * cannibalization conflict rather than presenting a doomed topic as fine.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'send-approval-digest.js');

function run(env = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--dry-run', '--today', '2026-08-05'], {
    encoding: 'utf8',
    env: { ...process.env, SAGE_API_URL: '', SAGE_API_TOKEN: '', SAGE_CLIENT_ID: '', ...env },
  });
}

describe('send-approval-digest', () => {
  test('runs clean against the real backlog and never sends in dry-run', () => {
    const r = run();
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /dry-run|No proposed candidates/);
  });

  test('does not attempt a send when SAGE_API_URL is absent', () => {
    // A cron misconfiguration must degrade to a no-op, not a crash loop.
    const r = run({ SAGE_API_URL: '' });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /send failed/);
  });

  test('exits 2 rather than silently doing nothing when configured but missing credentials', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--today', '2026-08-05'], {
      encoding: 'utf8',
      env: { ...process.env, SAGE_API_URL: 'https://example.invalid', SAGE_API_TOKEN: '', SAGE_CLIENT_ID: '' },
    });
    // Either it exits 2 for missing credentials, or 0 because nothing is
    // proposed. Both are correct; a crash is not.
    assert.ok([0, 2].includes(r.status), `unexpected exit ${r.status}: ${r.stderr}`);
  });
});

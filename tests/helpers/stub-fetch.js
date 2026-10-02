/**
 * Test-only preload (node -r): replaces global fetch so a spawned script that
 * "sends" email talks to nothing. Every request body is appended, one JSON per
 * line, to the file STUB_FETCH_LOG names. STUB_FETCH_MODE picks the answer:
 *   ok (default)  200 {"id": ...}
 *   403           403 RECIPIENT_NOT_INTERNAL (SAGE: not an active SAGE user)
 *   409           409 KILL_SWITCH_OUTBOUND_PAUSED (SAGE: outbound mail paused)
 *   403-review    403 for every recipient except the alert address (STUB_FETCH_OK_TO)
 * No network is ever opened.
 */
'use strict';
const fs = require('fs');

globalThis.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (process.env.STUB_FETCH_LOG) fs.appendFileSync(process.env.STUB_FETCH_LOG, `${JSON.stringify({ url: String(url), body })}\n`);
  const mode = process.env.STUB_FETCH_MODE || 'ok';
  const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (mode === '403' || (mode === '403-review' && body && body.to !== process.env.STUB_FETCH_OK_TO)) {
    return json(403, { error: 'Not sent: an API key can send only to active SAGE users or the system mailbox', code: 'RECIPIENT_NOT_INTERNAL' });
  }
  if (mode === '409') return json(409, { error: 'Not sent: outbound email is paused (kill switch).', code: 'KILL_SWITCH_OUTBOUND_PAUSED' });
  return json(200, { id: 'stub-draft' });
};

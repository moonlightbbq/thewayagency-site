#!/usr/bin/env node
/**
 * Weekly topic-approval digest.
 *
 * Adapters propose candidates; only APPROVED ones may occupy a slot. This is
 * the human gate between the two. Without it, the three adapters that can
 * write topics do so with no editorial judgement anywhere in the loop -- which
 * is how four hollow entries (no keywords, no links, boilerplate descriptions)
 * ended up on the calendar.
 *
 * Sends through the same path as the review emails: POST /api/email-drafts on
 * sage, which owns the mailbox. The reply is parsed by sage's
 * src/email/topic-approvals.js.
 *
 * Usage: node scripts/send-approval-digest.js [--dry-run] [--today YYYY-MM-DD]
 *
 * Env: SAGE_API_URL, SAGE_API_TOKEN, SAGE_CLIENT_ID (same as review emails)
 *      APPROVAL_TO defaults to the agency principal.
 */
const q = require('./lib/content-queue');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const todayArg = args.indexOf('--today');
const today = todayArg !== -1 ? args[todayArg + 1] : new Date().toISOString().slice(0, 10);

const SAGE_API_URL = process.env.SAGE_API_URL;
const SAGE_API_TOKEN = process.env.SAGE_API_TOKEN;
const SAGE_CLIENT_ID = process.env.SAGE_CLIENT_ID;
const APPROVAL_TO = process.env.APPROVAL_TO || 'sheilia@thewayagency.com';
const APPROVAL_CC = process.env.APPROVAL_CC || 'partner@thewayagency.com';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cal = q.loadCalendar();
const backlog = q.loadBacklog();
const proposed = (backlog.candidates || []).filter(c => c.status === 'proposed');
const approvedCount = q.approvedCandidates(backlog).length;

if (!proposed.length) {
  console.log(`No proposed candidates awaiting approval. Approved backlog: ${approvedCount}.`);
  process.exit(0);
}

// Score each against the next open publish date, so the digest can say WHY a
// topic is worth running rather than just listing it.
const ctx = q.buildSchedulingContext(cal);
const nextDate = q.publishDatesWithin(today, q.HORIZON_DAYS)
  .find(d => !q.occupiedDates(cal).has(d)) || q.publishDatesWithin(today, q.HORIZON_DAYS)[0];

const scored = proposed.map((c) => {
  // Evergreen scoring context: seasonal eligibility is judged at lock time
  // against the real slot, not here, so a seasonal topic is never rejected
  // from the digest for being out of season today.
  const r = q.scoreCandidate({ ...c, status: 'approved', seasonality_window: null }, nextDate, ctx, {});
  const conflict = q.cannibalizationConflict(c, ctx);
  return { c, score: r.score, reasons: r.reasons, conflict };
}).sort((a, b) => b.score - a.score);

const rows = scored.map(({ c, score, reasons, conflict }, i) => `
  <tr>
    <td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top"><strong>${i + 1}</strong></td>
    <td style="padding:8px;border-bottom:1px solid #eee">
      <strong>${esc(c.title)}</strong><br>
      <code style="font-size:12px;color:#666">${esc(c.slug)}</code><br>
      <span style="font-size:13px">${esc(c.description || '')}</span><br>
      <span style="font-size:12px;color:#666">
        keyword: ${esc(c.primary_keyword || '(none)')}
        ${c.seasonality_window ? ` &middot; season: ${esc(c.seasonality_window)}` : ''}
        ${c.related_cluster ? ` &middot; cluster: ${esc(c.related_cluster)}` : ''}
        &middot; source: ${esc(c.source || 'unknown')}
      </span>
      ${conflict ? `<br><span style="font-size:12px;color:#b00">Overlaps "${esc(conflict.slug)}" (${conflict.score.toFixed(2)}) - approving this will not place it while that stays live.</span>` : ''}
      ${reasons.length ? `<br><span style="font-size:12px;color:#060">${esc(reasons.join('; '))}</span>` : ''}
    </td>
    <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${score}</td>
  </tr>`).join('');

const subject = `Topic Approval: ${proposed.length} candidate${proposed.length === 1 ? '' : 's'} for week of ${today}`;
const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:720px">
  <h2 style="margin-bottom:4px">Topic approval</h2>
  <p style="color:#555;margin-top:0">
    ${proposed.length} candidate${proposed.length === 1 ? '' : 's'} proposed. Approved backlog is currently
    <strong>${approvedCount}</strong> (floor is ${q.MIN_APPROVED_BACKLOG}).
    Only approved topics can be scheduled.
  </p>
  <p style="background:#f6f6f6;padding:12px;border-radius:6px;font-size:14px">
    <strong>To approve, reply with:</strong><br>
    <code>approve 1,3,5</code> &nbsp;or&nbsp; <code>approve all</code> &nbsp;or&nbsp; <code>approve none</code><br>
    <span style="color:#666">You can also name slugs: <code>approve surety-bonds-explained</code></span>
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr style="text-align:left;border-bottom:2px solid #333">
      <th style="padding:8px">#</th><th style="padding:8px">Topic</th><th style="padding:8px;text-align:right">Score</th>
    </tr>
    ${rows}
  </table>
  <p style="color:#888;font-size:12px;margin-top:20px">
    Scores rank topics that already passed the hard filters. Seasonality is checked
    again when a topic is locked into a real date, so an out-of-season topic can be
    approved now and will simply wait for its window.
  </p>
</div>`;

if (dryRun || !SAGE_API_URL) {
  console.log(`${dryRun ? '[dry-run] ' : '[no SAGE_API_URL] '}${subject}`);
  console.log(`  to: ${APPROVAL_TO}  cc: ${APPROVAL_CC}`);
  for (const { c, score, conflict } of scored) {
    console.log(`  ${String(score).padStart(4)}  ${c.slug}${conflict ? `  [overlaps ${conflict.slug}]` : ''}`);
  }
  process.exit(0);
}

if (!SAGE_API_TOKEN || !SAGE_CLIENT_ID) {
  console.log('  ! SAGE_API_TOKEN and SAGE_CLIENT_ID are required to send');
  process.exit(2);
}

(async () => {
  const resp = await fetch(`${SAGE_API_URL}/api/email-drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': SAGE_API_TOKEN,
      // SAGE enforces CSRF on every api-key call; without this the request
      // dies at 403 before reaching auth.
      'X-SAGE-Client-Id': SAGE_CLIENT_ID,
    },
    body: JSON.stringify({ to: APPROVAL_TO, cc: APPROVAL_CC, subject, body: html, send: true }),
  });
  if (!resp.ok) {
    console.log(`  ! send failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
    process.exit(2);
  }
  console.log(`Sent approval digest: ${proposed.length} candidate(s) to ${APPROVAL_TO}`);
})();

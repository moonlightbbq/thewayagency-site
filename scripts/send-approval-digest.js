#!/usr/bin/env node
/**
 * Topic-approval digest.
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
 * The reply is bound to THIS digest (BL-78, sage AIA-121). The digest has an
 * id, <today>-<first 12 hex of sha256 over its ordered slugs joined by "\n">,
 * carried in the subject ("[digest:<id>]") and in a footer line
 * ("digest-id: <id> | slugs: a,b,c"). After a successful send the snapshot is
 * recorded in data/content-backlog.json:
 *
 *   digests: [{ id, sent_on, slugs: [ordered as numbered],
 *               recipients: [the To and every Cc address sent],
 *               topic_hashes: { <slug>: topicHash(the topic as shown) } }]
 *
 * (the newest DIGEST_KEEP), and the workflow that runs this commits it in the
 * same commit (.github/workflows/topic-approval-digest.yml). SAGE resolves
 * "approve 2" and "approve all" against that recorded list only, accepts a
 * reply only from one of its recipients and only for 14 days, does not approve
 * a topic whose title, description or keyword changed since the digest showed
 * it, and refuses a reply it cannot bind (or one whose digest was never
 * recorded), or whose instruction says more than an approval, or with
 * another line that names a topic or may change the instruction (sage BL-78:
 * a number, a slug, a decision verb such as "reject", a word such as
 * "except"; below the sign-off, only a P.S. or a line naming a topic together
 * with such a word), with "Topic approval not applied: <reason>" to the sender
 * (the email's instructions say so). So a
 * digest sent but not committed approves nothing, which is the safe direction.
 *
 * Usage: node scripts/send-approval-digest.js [--dry-run] [--today YYYY-MM-DD]
 *
 * Env: SAGE_API_URL, SAGE_API_TOKEN, SAGE_CLIENT_ID (same as review emails)
 *      APPROVAL_TO: ONE address (SAGE's email-drafts API takes a single To);
 *        defaults to the agency principal. More than one exits 2, nothing sent.
 *      APPROVAL_CC: one address or a comma-separated list; defaults to the
 *        partner inbox. Sent to SAGE as a list.
 *      Each must be an ACTIVE SAGE user: SAGE sends internal mail only to
 *      active users, and approves only replies from active users who were sent
 *      the digest.
 */
const crypto = require('crypto');
const fs = require('fs');
const q = require('./lib/content-queue');

// Digests kept in the backlog: SAGE accepts replies for 14 days, so a weekly
// digest needs two; the rest is a short history of what was asked.
const DIGEST_KEEP = 12;
// Who the digest goes to when APPROVAL_TO / APPROVAL_CC are not set.
const DEFAULT_TO = 'sheilia@thewayagency.com';
const DEFAULT_CC = 'partner@thewayagency.com';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The id SAGE recomputes from the recorded snapshot (src/email/topic-approvals.js digestIdFor). */
function digestId(sentOn, slugs) {
  const h = crypto.createHash('sha256').update(slugs.join('\n'), 'utf8').digest('hex').slice(0, 12);
  return `${sentOn}-${h}`;
}

/**
 * What the digest showed of a topic, hashed (SAGE src/email/topic-approvals.js
 * topicHash computes the same): 12 hex of sha256 over its title, description
 * and primary keyword joined by "\n", a missing one as "". SAGE approves a
 * topic only while it still hashes to this, so a reply never approves text
 * the reviewer was not shown.
 */
function topicHash(c) {
  const s = (v) => (typeof v === 'string' ? v : '');
  const t = c || {};
  return crypto.createHash('sha256').update([s(t.title), s(t.description), s(t.primary_keyword)].join('\n'), 'utf8').digest('hex').slice(0, 12);
}

/** Addresses from strings ("a, b; c") and/or arrays, lowercased, each once, in order. */
function parseRecipients(...lists) {
  const out = [];
  for (const list of lists.flat()) {
    for (const r of String(list || '').split(/[,;]/)) {
      const a = r.trim().toLowerCase();
      if (a && !out.includes(a)) out.push(a);
    }
  }
  return out;
}

// The shape SAGE's POST /api/email-drafts accepts (src/schemas/email-drafts.js):
// `to` one address, `cc` addresses. Checked here so a bad setting stops the
// run before anything is sent, instead of a 400 from SAGE.
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * The digest's recipients from APPROVAL_TO / APPROVAL_CC (or the defaults):
 * exactly one To, any number of Cc (the To dropped from them). These are the
 * addresses sent AND the ones recorded, so only they can approve by reply.
 * @returns {{ ok: true, to: string, cc: string[] } | { ok: false, error: string }}
 */
function resolveRecipients(env) {
  const toList = parseRecipients(env.APPROVAL_TO || DEFAULT_TO);
  if (toList.length !== 1) {
    return { ok: false, error: `APPROVAL_TO must be exactly one address (SAGE's email-drafts API takes a single To); it has ${toList.length}. Put the others in APPROVAL_CC.` };
  }
  const [to] = toList;
  const cc = parseRecipients(env.APPROVAL_CC || DEFAULT_CC).filter(a => a !== to);
  const bad = [to, ...cc].filter(a => !EMAIL.test(a));
  if (bad.length) return { ok: false, error: `not an email address in APPROVAL_TO/APPROVAL_CC: ${bad.join(', ')}` };
  return { ok: true, to, cc };
}

/**
 * Build the digest for today: the proposed candidates ranked by score, the
 * email, and the snapshot to record. Pure (no I/O). null when nothing is proposed.
 * `to` and `cc`: addresses (a string, a comma-separated string or an array).
 */
function buildDigest({ cal, backlog, today, to, cc }) {
  const proposed = (backlog.candidates || []).filter(c => c.status === 'proposed');
  if (!proposed.length) return null;
  const approvedCount = q.approvedCandidates(backlog).length;

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

  // The numbers in the email ARE this order: entry i is "approve i+1".
  const slugs = scored.map(({ c }) => c.slug);
  const id = digestId(today, slugs);
  const topic_hashes = Object.fromEntries(scored.map(({ c }) => [c.slug, topicHash(c)]));
  const snapshot = { id, sent_on: today, slugs, recipients: parseRecipients(to, cc), topic_hashes };

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

  const n = proposed.length;
  const subject = `Topic Approval: ${n} candidate${n === 1 ? '' : 's'} for week of ${today} [digest:${id}]`;
  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:720px">
  <h2 style="margin-bottom:4px">Topic approval</h2>
  <p style="color:#555;margin-top:0">
    ${n} candidate${n === 1 ? '' : 's'} proposed. Approved backlog is currently
    <strong>${approvedCount}</strong> (floor is ${q.MIN_APPROVED_BACKLOG}).
    Only approved topics can be scheduled.
  </p>
  <p style="background:#f6f6f6;padding:12px;border-radius:6px;font-size:14px">
    <strong>To approve, reply to this email with one line:</strong><br>
    <code>approve 1,3,5</code> &nbsp;or&nbsp; <code>approve all</code> &nbsp;or&nbsp; <code>approve none</code><br>
    <span style="color:#666">You can also name slugs: <code>approve surety-bonds-explained</code></span><br>
    <span style="color:#666">The numbers mean the topics in THIS email. Keep the subject line as it is: it names this digest.
    SAGE emails you back what it approved; a reply naming a number or slug not listed here approves nothing.</span><br>
    <span style="color:#666">Put the whole instruction on that one line, with nothing before "approve" but a greeting or thanks,
    and mention no topic anywhere else in your reply: to leave a topic out, list the ones you approve (<code>approve 1,2,4</code>).
    SAGE refuses a reply with another line, above your sign-off or in a P.S., that names a topic by its number or slug
    or says reject, postpone, except, not or wait: "approve all" with "reject 4" below it approves nothing, and SAGE asks you to re-send.
    Your sign-off is the first line below the instruction that is only a closing, such as "Thanks," or "Best regards, Sam",
    or only a name: up to three capitalized words on a line of their own. A line such as "Thanks for these" is not a sign-off.
    SAGE reads only what you type above the quoted email, so leave the quoted email below your reply: an indented line is read,
    but a comment typed inside this email, or below a quote you add, is not. A reply with struck-through text, or with an indented block
    and no quoted email below it, approves nothing: delete the text instead of striking it through.</span>
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
  <p style="color:#aaa;font-size:11px;margin-top:12px">digest-id: ${esc(id)} | slugs: ${esc(slugs.join(','))}</p>
</div>`;

  return { subject, html, scored, snapshot, approvedCount };
}

/** Record a sent digest on a backlog object (mutates it): newest last, one entry per id, the newest DIGEST_KEEP. */
function recordDigest(backlog, snapshot) {
  const kept = (Array.isArray(backlog.digests) ? backlog.digests : []).filter(d => d && d.id !== snapshot.id);
  kept.push(snapshot);
  backlog.digests = kept.slice(-DIGEST_KEEP);
  return backlog;
}

/**
 * Write the snapshot into the backlog file, re-read just before the write so
 * only the digests key changes (the scorer read a copy minutes earlier).
 */
function saveDigestSnapshot(snapshot, backlogPath = q.BACKLOG_PATH) {
  const current = q.loadBacklog(backlogPath);
  recordDigest(current, snapshot);
  fs.writeFileSync(backlogPath, `${JSON.stringify(current, null, 2)}\n`);
}

/**
 * @param {string[]} argv
 * @param {object} env
 * @param {object} [o] tests: { backlogPath (a fixture, never the real file), fetchImpl }
 * @returns {Promise<number>} the exit code
 */
async function main(argv = process.argv.slice(2), env = process.env, { backlogPath = q.BACKLOG_PATH, fetchImpl = globalThis.fetch } = {}) {
  const dryRun = argv.includes('--dry-run');
  const todayArg = argv.indexOf('--today');
  const today = todayArg !== -1 ? argv[todayArg + 1] : new Date().toISOString().slice(0, 10);
  const recipients = resolveRecipients(env);
  if (!recipients.ok) {
    console.log(`  ! ${recipients.error}`);
    return 2;
  }
  const { to, cc } = recipients;

  const backlog = q.loadBacklog(backlogPath);
  const digest = buildDigest({ cal: q.loadCalendar(), backlog, today, to, cc });
  if (!digest) {
    console.log(`No proposed candidates awaiting approval. Approved backlog: ${q.approvedCandidates(backlog).length}.`);
    return 0;
  }

  if (dryRun || !env.SAGE_API_URL) {
    console.log(`${dryRun ? '[dry-run] ' : '[no SAGE_API_URL] '}${digest.subject}`);
    console.log(`  to: ${to}  cc: ${cc.join(', ') || '(none)'}`);
    console.log(`  digest-id: ${digest.snapshot.id} (not recorded: nothing was sent)`);
    for (const { c, score, conflict } of digest.scored) {
      console.log(`  ${String(score).padStart(4)}  ${c.slug}${conflict ? `  [overlaps ${conflict.slug}]` : ''}`);
    }
    return 0;
  }

  if (!env.SAGE_API_TOKEN || !env.SAGE_CLIENT_ID) {
    console.log('  ! SAGE_API_TOKEN and SAGE_CLIENT_ID are required to send');
    return 2;
  }

  const resp = await fetchImpl(`${env.SAGE_API_URL}/api/email-drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.SAGE_API_TOKEN,
      // SAGE enforces CSRF on every api-key call; without this the request
      // dies at 403 before reaching auth.
      'X-SAGE-Client-Id': env.SAGE_CLIENT_ID,
    },
    // `to` one address, `cc` a list: the shape SAGE validates. The snapshot
    // records exactly these addresses (buildDigest got the same two).
    body: JSON.stringify({ to, cc, subject: digest.subject, body: digest.html, send: true }),
  });
  if (!resp.ok) {
    console.log(`  ! send failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
    return 2;
  }
  // Recorded only once it was sent: a digest nobody received binds nothing.
  saveDigestSnapshot(digest.snapshot, backlogPath);
  console.log(`Sent approval digest ${digest.snapshot.id}: ${digest.scored.length} candidate(s) to ${to}`);
  console.log('  Recorded in data/content-backlog.json (digests). Commit it: SAGE refuses replies to a digest it cannot find on main.');
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(2); });
}

module.exports = { digestId, topicHash, parseRecipients, resolveRecipients, buildDigest, recordDigest, saveDigestSnapshot, main, DIGEST_KEEP };

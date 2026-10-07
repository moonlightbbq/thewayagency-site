#!/usr/bin/env node
/**
 * The Way Agency — Blog Review Email Sender
 *
 * Every scheduled post needs its assigned licensed reviewer's approval to
 * publish (owner decision 2026-10-02: "Required - but if they do not approve,
 * and are silent, then they get daily emails the 3 days leading up to
 * publishing"). A post that is due without it is HELD: it does not publish or
 * render, and the queue's I8 invariant turns the publish workflow red
 * (scripts/lib/calendar-status.js). This script asks for the approval:
 *
 *   request   status 'planned', markdown on disk, publishes in 0-18 days
 *             (normally caught at ~D-14): assigns a licensed reviewer and sends
 *             the article; status -> 'in-review', review_sent_date = today
 *   D-7       status 'in-review', 5-9 days out, once (reminder_sent)
 *   D-3/2/1   status 'in-review', 1-3 days out, once on EACH of those days
 *             (final_reminder_dates records the days sent; a rerun the same
 *             day sends nothing): "it will NOT publish until you approve it"
 *
 * Nothing is sent for 'approved' or 'published' posts, nor for one on a
 * 'changes-requested' hold (its reviewer is not silent: SAGE emails them the
 * proposed edit, and I6 makes the held date loud), nor on or after the publish
 * date (I8 takes over). A request that goes out on one of D-3..D-1 counts as
 * that day's email.
 *
 * Runs:
 *   node scripts/send-review-emails.js                    every pass (the Wed/Sat
 *                                                         publish workflow)
 *   node scripts/send-review-emails.js --final-reminders  the D-3/D-2/D-1 pass, plus
 *                                                         the request for a 'planned'
 *                                                         post 1-3 days out
 *                                                         (.github/workflows/
 *                                                         review-reminders.yml, daily)
 *
 * Reviewers and channels. The rotation is every data/team.json member with an
 * email and licence_states (Sheilia, Audrey, Kelly, Jill), fewest assignments
 * first; an entry that already names a licensed reviewer keeps them. Each
 * member's "review_via" says how they review (owner decision 2026-10-02, Q3):
 *   "sage" (or absent)  the email links to SAGE's review page, where they
 *                       approve the exact text with one click (BL-07)
 *   "email"             no SAGE account: the request and every reminder carry
 *                       the article's full text, the title, the publish date
 *                       and the signed subject token, and they approve this
 *                       exact version by replying APPROVED as the first line
 *                       (or reply with the changes they want). SAGE checks the
 *                       token, that the bytes are unchanged, the sender and the
 *                       message's email authentication before it records the
 *                       same signed approval a click records.
 * Posts are never reassigned here. When the assigned reviewer cannot be
 * reached (not a licensed data/team.json member, an unknown review_via, or
 * SAGE refusing the address: 403 RECIPIENT_NOT_INTERNAL, i.e. not an active
 * SAGE user and SAGE does not allow them as an email reviewer) the content
 * owner (REVIEW_CC) gets an alert and the run exits 2.
 *
 * A send SAGE accepts but cannot deliver because outbound mail is paused (409
 * KILL_SWITCH_OUTBOUND_PAUSED: the draft waits in SAGE's email queue) is
 * recorded as sent, so no second copy is queued on the next run, and the run
 * exits 2. A 403 RECIPIENT_NOT_INTERNAL also leaves the draft in SAGE's email
 * queue for a person, on every retry.
 *
 * The "Request Changes" link composes a reply carrying the signed
 * review-request token, which SAGE turns into a held post and a proposed edit.
 *
 * Required env vars:
 *   SAGE_API_URL    — e.g., https://sage.thewayagency.com
 *   SAGE_API_TOKEN  — JWT token for sage-server API auth
 * Optional:
 *   SAGE_REVIEW_URL — the public SAGE app URL the approval link opens (https).
 *     Defaults to SAGE_API_URL (a trailing "/" or "/api" is dropped). Set it
 *     when SAGE_API_URL is not the address reviewers sign in at.
 *   BLOG_REVIEW_TOKEN_SECRET — signs the review-request token SAGE verifies on
 *     the reviewer's reply (BL-07). The same value is set in the sage .env.
 *     REQUIRED: without it (or shorter than 32 characters) the run exits 2
 *     before sending anything.
 *   REVIEW_CC — the content owner: cc'd on every review email, and the
 *     recipient of the no-channel alerts (default partner@thewayagency.com).
 *
 * Loading this file (require) has no side effects; it only runs when executed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CALENDAR_PATH = path.join(ROOT, 'data', 'content-calendar.json');
const TEAM_PATH = path.join(ROOT, 'data', 'team.json');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');

const SAGE_API_URL = process.env.SAGE_API_URL;
const SAGE_API_TOKEN = process.env.SAGE_API_TOKEN;
const SAGE_CLIENT_ID = process.env.SAGE_CLIENT_ID;
const REVIEW_CC = process.env.REVIEW_CC || 'partner@thewayagency.com';

// ─── Review-request token (BL-07) ───────────
//
// SAGE acts on a reviewer's reply only when its subject carries a token this
// script signed for that post, that reviewer and the exact article bytes the
// reviewer was sent. The reference implementation is signRequestToken in
// sage-server src/email/blog-review-guard.js; both repositories pin the same
// fixed test vector (tests/review-reply-binding.test.js here), so the two can
// never drift apart unnoticed.
//
//   token = YYYYMMDD "." <first 16 hex of sha256(article bytes)> "." <MAC>
//   MAC   = base64url(HMAC-SHA256(secret, "blog-review-request/v1|<slug>|<reviewer email, lowercased>|<publish date>|<sha256 hex>")), first 22 chars
//
// The token expires on the publish date. Editing the article afterwards
// invalidates it for an AI edit (SAGE still holds the post on a change request
// but makes the edit by hand: "content changed").
const REQUEST_TOKEN_VERSION = 'blog-review-request/v1';
const MIN_SECRET_LENGTH = 32;

/**
 * @param {{slug: string, reviewerEmail: string, publishDate: string, content: Buffer}} args
 *   content: the RAW BYTES of src/blog/<slug>.md (fs.readFileSync without an encoding)
 * @param {string} secret
 * @returns {string}
 */
function issueReviewToken({ slug, reviewerEmail, publishDate, content }, secret) {
  if (!secret || String(secret).length < MIN_SECRET_LENGTH) {
    throw new Error(`issueReviewToken: the secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (!slug || !reviewerEmail || !/^\d{4}-\d{2}-\d{2}$/.test(String(publishDate || '')) || !Buffer.isBuffer(content)) {
    throw new Error('issueReviewToken: slug, reviewerEmail, publishDate (YYYY-MM-DD) and content (a Buffer) are required');
  }
  const contentSha256 = crypto.createHash('sha256').update(content).digest('hex');
  const message = [REQUEST_TOKEN_VERSION, slug, String(reviewerEmail).trim().toLowerCase(), publishDate, contentSha256].join('|');
  const mac = crypto.createHmac('sha256', String(secret)).update(message, 'utf8').digest('base64url').slice(0, 22);
  return `${publishDate.replace(/-/g, '')}.${contentSha256.slice(0, 16)}.${mac}`;
}

/**
 * The review email's subject, and the subject its Request Changes link
 * composes. With a token both carry "[ref:<token>]"; without one they are the
 * legacy subjects (SAGE holds the post on a change request to them, but makes
 * no AI edit).
 * @param {{title: string, publish_date: string}} post
 * @param {string|null} token
 * @returns {{email: string, reply: string}}
 */
function buildReviewSubjects(post, token) {
  const tag = token ? ` [ref:${token}]` : '';
  return {
    email: `Review Request: "${post.title}" — publishes ${post.publish_date}${tag}`,
    reply: `Re: Review Request: "${post.title}"${tag}`,
  };
}

// ─── The approval link (BL-07) ───────────────
//
// SAGE's review page for one post. The shape '#/content/review?post=<slug>' is
// pinned in both repositories' tests (sage-server tests/blog-review-trigger-
// binding.test.js checks it against its own reviewUrl).

/**
 * The SAGE base URL the approval link opens: SAGE_REVIEW_URL, else
 * SAGE_API_URL, without a trailing "/" or "/api". https only: a reviewer
 * signs in there.
 * @returns {string}
 */
function sageReviewBase(env = process.env) {
  const raw = String(env.SAGE_REVIEW_URL || env.SAGE_API_URL || '').trim();
  const base = raw.replace(/\/+$/, '').replace(/\/api$/i, '').replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/?#@]+$/i.test(base)) {
    throw new Error('sageReviewBase: SAGE_REVIEW_URL (or SAGE_API_URL) must be an https origin, e.g. https://sage.example.com');
  }
  return base;
}

/** The link that opens SAGE's review page for this post. */
function reviewApprovalUrl(sageUrl, slug) {
  const base = String(sageUrl || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/?#@]+$/i.test(base)) throw new Error('reviewApprovalUrl: sageUrl must be an https origin');
  if (!slug) throw new Error('reviewApprovalUrl: slug is required');
  return `${base}/#/content/review?post=${encodeURIComponent(slug)}`;
}

/** The signing secret when it is usable, else null. */
function reviewTokenSecret(env = process.env) {
  const s = env.BLOG_REVIEW_TOKEN_SECRET || '';
  return s.length >= MIN_SECRET_LENGTH ? s : null;
}

// ─── Date helpers ───────────────────────────
// Calendar dates in UTC, as the publisher and the queue count them
// (scripts/lib/content-queue.js daysBetween).
function todayUtc() {
  return new Date().toISOString().split('T')[0];
}

function daysBetweenUtc(fromYmd, toYmd) {
  return Math.round((Date.parse(`${toYmd}T12:00:00Z`) - Date.parse(`${fromYmd}T12:00:00Z`)) / 86400000);
}

// ─── Reviewers and channels ────────────────
const lowerEmail = (s) => String(s || '').trim().toLowerCase();

/** A licensed reviewer: a team member with an email and licence_states. */
function isLicensedReviewer(member) {
  return !!member && !!member.email && Array.isArray(member.license_states) && member.license_states.length > 0;
}

/**
 * How a member reviews: 'sage' (review_via absent or "sage"), 'email'
 * (review_via "email"), or null when they cannot review at all (not licensed,
 * no email, or a review_via this code does not know).
 */
function reviewChannel(member) {
  if (!isLicensedReviewer(member)) return null;
  if (member.review_via === undefined || member.review_via === 'sage') return 'sage';
  if (member.review_via === 'email') return 'email';
  return null;
}

/** The rotation: licensed members with a review channel. */
function rotationReviewers(team) {
  return (Array.isArray(team) ? team : []).filter((m) => reviewChannel(m) !== null);
}

/**
 * The reviewer the entry names, as data/team.json has them, and whether they
 * can be reached. {member: null} when the entry names nobody.
 * @returns {{named: boolean, member: object|null, channel: string|null, why: string|null}}
 */
function assignedReviewer(post, team) {
  const list = Array.isArray(team) ? team : [];
  if (!post.reviewer_email && !post.reviewer_slug) return { named: false, member: null, channel: null, why: null };
  const member = post.reviewer_slug
    ? list.find((m) => m && m.slug === post.reviewer_slug) || null
    : list.find((m) => m && lowerEmail(m.email) === lowerEmail(post.reviewer_email)) || null;
  const who = post.reviewer_email || post.reviewer_slug;
  if (!member) return { named: true, member: null, channel: null, why: `${who} is not a data/team.json member (left the agency, or a typo on the calendar)` };
  if (post.reviewer_email && lowerEmail(member.email) !== lowerEmail(post.reviewer_email)) {
    return { named: true, member, channel: null, why: `the calendar names ${post.reviewer_email}, but data/team.json gives ${member.slug} the address ${member.email || '(none)'}` };
  }
  if (!isLicensedReviewer(member)) return { named: true, member, channel: null, why: `${member.name || member.slug} has no email or no licence_states in data/team.json, so cannot be the licensed reviewer` };
  const channel = reviewChannel(member);
  if (!channel) return { named: true, member, channel: null, why: `${member.name || member.slug} has review_via ${JSON.stringify(member.review_via)} in data/team.json, which is neither "sage" nor "email"` };
  return { named: true, member, channel, why: null };
}

function getNextReviewer(calendar, reviewers) {
  // Count how many times each reviewer has been assigned
  const counts = {};
  for (const r of reviewers) counts[r.email] = 0;

  for (const post of calendar.year1) {
    if (post.reviewer_email && counts[post.reviewer_email] !== undefined) {
      counts[post.reviewer_email]++;
    }
  }

  // Pick the reviewer with the fewest assignments
  let minCount = Infinity;
  let picked = reviewers[0];
  for (const r of reviewers) {
    if (counts[r.email] < minCount) {
      minCount = counts[r.email];
      picked = r;
    }
  }
  return picked;
}

// ─── Read markdown post ────────────────────
// Raw bytes: the token hashes exactly what is on disk (and on the branch).
function readPostBytes(slug) {
  const mdPath = path.join(BLOG_SRC, `${slug}.md`);
  if (!fs.existsSync(mdPath)) return null;
  return fs.readFileSync(mdPath);
}

// ─── Markdown to email HTML ─────────────────
/**
 * HTML-escape a value for element text or a quoted attribute. Every calendar
 * or article value is data where it lands in these emails, as on the site
 * (scripts/generate-blog.js esc): a title or a paragraph cannot add markup, or
 * a link of its own, to an email that goes to a licensed reviewer.
 */
function escHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Where a markdown link in the article preview may point: a site path
 * (prefixed with the site origin) or an absolute http(s) URL, else nowhere.
 * Prefixing anything else made "@host/x" a link to another host
 * (https://www.thewayagency.com@host/x).
 */
function emailLinkHref(url) {
  const u = String(url).trim();
  if (/^\/(?!\/)/.test(u)) return `https://www.thewayagency.com${u}`;
  if (/^https?:\/\/[^\s]+$/i.test(u)) return u;
  return null;
}

function markdownToEmailHtml(md) {
  // Strip front matter
  const bodyOnly = md.replace(/^---[\s\S]*?---\n/, '').trim();

  const blocks = bodyOnly.split(/\n\n+/);
  const htmlBlocks = [];

  let inList = false;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // FAQ heading
    if (/^### FAQ: (.+)$/.test(trimmed)) {
      if (inList) { htmlBlocks.push('</ul>'); inList = false; }
      const q = trimmed.replace(/^### FAQ: /, '');
      htmlBlocks.push(`<div style="background:#f0f9ff;border-left:4px solid #0891b2;padding:16px 20px;margin:28px 0 8px;border-radius:0 6px 6px 0;"><p style="margin:0;font-weight:600;color:#0c4a6e;font-size:15px;">Q: ${applyInline(q)}</p></div>`);
      continue;
    }

    // H2
    if (/^## (.+)$/.test(trimmed)) {
      if (inList) { htmlBlocks.push('</ul>'); inList = false; }
      const heading = trimmed.replace(/^## /, '');
      htmlBlocks.push(`<h2 style="color:#0f172a;font-size:20px;font-weight:700;margin:32px 0 12px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;">${applyInline(heading)}</h2>`);
      continue;
    }

    // H3
    if (/^### (.+)$/.test(trimmed)) {
      if (inList) { htmlBlocks.push('</ul>'); inList = false; }
      const heading = trimmed.replace(/^### /, '');
      htmlBlocks.push(`<h3 style="color:#1e293b;font-size:17px;font-weight:600;margin:24px 0 8px;">${applyInline(heading)}</h3>`);
      continue;
    }

    // List block (lines starting with -)
    const lines = trimmed.split('\n');
    const allList = lines.every(l => /^- /.test(l.trim()));
    if (allList) {
      if (!inList) { htmlBlocks.push('<ul style="margin:12px 0;padding-left:24px;color:#334155;">'); inList = true; }
      for (const line of lines) {
        const item = line.replace(/^- /, '').trim();
        htmlBlocks.push(`<li style="margin:6px 0;line-height:1.6;">${applyInline(item)}</li>`);
      }
      continue;
    }

    // Close open list before paragraph
    if (inList) { htmlBlocks.push('</ul>'); inList = false; }

    // Regular paragraph
    htmlBlocks.push(`<p style="margin:0 0 16px;line-height:1.75;color:#334155;font-size:15px;">${applyInline(trimmed.replace(/\n/g, ' '))}</p>`);
  }

  if (inList) htmlBlocks.push('</ul>');
  return htmlBlocks.join('\n');
}

// The text is escaped first; only the markdown below adds markup. A link's
// target was escaped with it, so it cannot leave its href.
function applyInline(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0f172a;">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
      const raw = url.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      const href = emailLinkHref(raw);
      return href ? `<a href="${escHtml(href)}" style="color:#0891b2;text-decoration:underline;">${label}</a>` : label;
    });
}

// ─── Pillar display labels ──────────────────
const pillarLabels = {
  product: 'Product Deep-Dive',
  local: 'Local & Community',
  education: 'Advice & Education',
  seasonal: 'Seasonal & Industry'
};


// ─── Copy shared by the review and reminder emails ───────
//
// What happens on silence and on a change request, said the same way in every
// email. Silence HOLDS the post (owner decision 2026-10-02). The cut-off is
// SAGE's: from the publish date (which begins at midnight UTC) a post may
// already be live, so a reply can no longer hold it.
function notPublishedSentence(publishDate, channel = 'sage') {
  return channel === 'email'
    ? `It will NOT publish until you approve it. Until you do, you get this email again on each of the 3 days before ${publishDate}; if it is still not approved on ${publishDate}, it does not publish that day and the content owner is told.`
    : `It will NOT publish until you approve it in SAGE. Until you do, you get a reminder on each of the 3 days before ${publishDate}; if it is still not approved on ${publishDate}, it does not publish that day and the content owner is told.`;
}

function changeRequestSentence(token) {
  return token
    ? 'If you request changes, SAGE holds the post and emails you the proposed edit as a list of changes, and nothing is published until you approve a version.'
    : 'If you request changes, SAGE holds the post until a version is approved in SAGE. This email carries no review code, so SAGE cannot prepare the edit itself: the content owner makes it by hand.';
}

const CUTOFF_SENTENCE = 'A change request has to reach SAGE before the publish date begins (midnight UTC, which is the evening before in US time): from then on the post may already be live, and SAGE can no longer hold it.';

function longDate(ymd) {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function replyToAddress() {
  return process.env.REVIEW_REPLY_TO || 'sage@thewayagency.com';
}

// ─── Format post as HTML email ─────────────
function formatReviewEmail(post, content, reviewer, token = null, { sageUrl } = {}) {
  if (!sageUrl) throw new Error('formatReviewEmail: sageUrl is required (the approval link opens SAGE)');
  const approveUrl = reviewApprovalUrl(sageUrl, post.slug);
  const articleHtml = markdownToEmailHtml(content);

  const publishDate = longDate(post.publish_date);

  // Calendar values: data, escaped where they land.
  const title = escHtml(post.title);
  const pillarLabel = escHtml(pillarLabels[post.pillar] || post.pillar);
  const readingTime = escHtml(post.reading_time || '5-7 min read');
  const firstName = escHtml(String(reviewer.name || '').split(' ')[0]);

  // Approving is a click in SAGE (BL-07): the green action is a link to SAGE's
  // review page, where the reviewer sees the exact text that will publish.
  // For a reviewer who reviews in SAGE an email reply cannot approve
  // (classifying emailed text as an approval proved unsafe), so there is no
  // "Approve" mailto. Reviewers who review by email get
  // formatEmailChannelEmail instead.
  //
  // The orange Request Changes link composes a reply. Its subject has to
  // satisfy sage's anchored reply grammar (src/email/blog-review-guard.js:
  // reply prefix, the review marker, the quoted title, then only the binding
  // tag) AND carry the review-request token, or SAGE refuses the change
  // request. Replies go to the mailbox sage polls for intake.
  const replySubject = encodeURIComponent(buildReviewSubjects(post, token).reply);
  const changesHref = `mailto:${replyToAddress()}?subject=${replySubject}&body=${encodeURIComponent('Changes requested:\n\n')}`;

  return `
<div style="max-width:680px;margin:0 auto;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#f8fafc;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:white;padding:32px 36px;border-radius:12px 12px 0 0;">
    <table style="width:100%;"><tr>
      <td style="vertical-align:top;">
        <p style="margin:0 0 4px;font-size:11px;color:#38bdf8;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Review Request</p>
        <h1 style="margin:0;font-size:24px;font-weight:700;line-height:1.3;color:white;">${title}</h1>
        <p style="margin:10px 0 0;font-size:13px;color:#94a3b8;">${pillarLabel} &middot; ${readingTime} &middot; Publishes ${publishDate}</p>
      </td>
    </tr></table>
  </div>

  <!-- Action Bar -->
  <div style="background:#ffffff;padding:24px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
    <p style="margin:0 0 14px;color:#1e293b;font-size:15px;">Hi ${firstName},</p>
    <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6;">
      This article is ready for your review before it goes live on <strong style="color:#0f172a;">${publishDate}</strong>.
      Please check it for accuracy and let us know if anything needs to be updated.
    </p>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;"><tr>
      <td style="width:50%;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;text-align:center;vertical-align:top;">
        <a href="${approveUrl}" style="display:block;font-weight:700;color:#166534;font-size:14px;text-decoration:underline;margin-bottom:4px;">Review and approve in SAGE</a>
        <p style="margin:0;color:#15803d;font-size:12px;">Opens SAGE, where you see the exact text that will publish and approve it with one click</p>
      </td>
      <td style="width:50%;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;text-align:center;vertical-align:top;">
        <a href="${changesHref}" style="display:block;font-weight:700;color:#9a3412;font-size:14px;text-decoration:underline;margin-bottom:4px;">Request Changes</a>
        <p style="margin:0;color:#c2410c;font-size:12px;">Opens a reply &mdash; type your edits or notes. ${token
    ? 'SAGE holds the post and emails you a proposed edit to approve in SAGE.'
    : 'SAGE holds the post; the content owner makes the edit by hand.'}</p>
      </td>
    </tr></table>
    <p style="margin:14px 0 0;color:#475569;font-size:13px;line-height:1.6;">
      <strong style="color:#0f172a;">Approving is a click in SAGE, where you see the exact text that will publish. Email replies cannot approve.</strong>
      ${changeRequestSentence(token)}
      ${CUTOFF_SENTENCE}${token ? `
      When you request changes, please keep the subject line as it is: it carries the code that ties your reply to this request.` : ''}
      <strong style="color:#0f172a;">${notPublishedSentence(publishDate)}</strong>
    </p>
  </div>

  <!-- Article Content -->
  <div style="background:#ffffff;padding:36px;border:1px solid #e2e8f0;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
    <p style="margin:0 0 24px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#94a3b8;padding-bottom:12px;border-bottom:1px solid #e2e8f0;">Article Preview</p>
    ${articleHtml}
  </div>

  <!-- Footer -->
  <div style="background:#0f172a;padding:20px 36px;border-radius:0 0 12px 12px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#64748b;">The Way Agency &middot; Content Review System</p>
    <p style="margin:6px 0 0;font-size:11px;color:#475569;">This article publishes on ${publishDate} only once you approve it in SAGE, and then names you as its reviewer.</p>
  </div>

</div>`;
}

// ─── Reminder email (7 days before publish) ─
function formatReminderEmail(post, reviewer, { sageUrl, token = null } = {}) {
  if (!sageUrl) throw new Error('formatReminderEmail: sageUrl is required (the approval link opens SAGE)');
  const approveUrl = reviewApprovalUrl(sageUrl, post.slug);
  const publishDate = longDate(post.publish_date);
  const title = escHtml(post.title);
  const pillarLabel = escHtml(pillarLabels[post.pillar] || post.pillar);
  const firstName = escHtml(String(reviewer.name || '').split(' ')[0]);
  const changes = token
    ? `<a href="mailto:${replyToAddress()}?subject=${encodeURIComponent(buildReviewSubjects(post, token).reply)}&body=${encodeURIComponent('Changes requested:\n\n')}" style="color:#9a3412;font-weight:700;">Request Changes</a>`
    : 'the Request Changes link in the original review email';
  return `
<div style="max-width:680px;margin:0 auto;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;">
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:white;padding:32px 36px;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 4px;font-size:11px;color:#fbbf24;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Reminder &middot; 1 Week Until Publish</p>
    <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3;">${title}</h1>
    <p style="margin:10px 0 0;font-size:13px;color:#94a3b8;">${pillarLabel} &middot; Publishes ${publishDate}</p>
  </div>
  <div style="background:#ffffff;padding:28px 36px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 14px;color:#1e293b;font-size:15px;">Hi ${firstName},</p>
    <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6;">
      This article is scheduled to publish in <strong style="color:#0f172a;">one week</strong> on <strong style="color:#0f172a;">${publishDate}</strong>.
      To approve it, review it in SAGE. If you have changes, use ${changes}. ${changeRequestSentence(token)}
      ${CUTOFF_SENTENCE}
      <strong style="color:#0f172a;">${notPublishedSentence(publishDate)}</strong>
    </p>
    <p style="margin:0 0 18px;text-align:center;"><a href="${approveUrl}" style="display:inline-block;background:#166534;color:#ffffff;font-weight:700;padding:12px 20px;border-radius:8px;text-decoration:none;">Review and approve in SAGE</a></p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;">
      <p style="margin:0;color:#92400e;font-size:13px;"><strong>Email replies cannot approve.</strong> Approving is a click in SAGE, where you see the exact text that will publish.</p>
    </div>
  </div>
  <div style="background:#0f172a;padding:16px 36px;border-radius:0 0 12px 12px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#64748b;">The Way Agency &middot; Content Review System</p>
  </div>
</div>`;
}

const dayWord = (n) => (n === 1 ? '1 day' : `${n} days`);

// ─── Final reminders (D-3, D-2, D-1), SAGE reviewers ─
function formatFinalReminderEmail(post, reviewer, { sageUrl, token = null, daysLeft } = {}) {
  if (!sageUrl) throw new Error('formatFinalReminderEmail: sageUrl is required (the approval link opens SAGE)');
  const approveUrl = reviewApprovalUrl(sageUrl, post.slug);
  const publishDate = longDate(post.publish_date);
  const title = escHtml(post.title);
  const firstName = escHtml(String(reviewer.name || '').split(' ')[0]);
  const changes = token
    ? `<a href="mailto:${replyToAddress()}?subject=${encodeURIComponent(buildReviewSubjects(post, token).reply)}&body=${encodeURIComponent('Changes requested:\n\n')}" style="color:#9a3412;font-weight:700;">Request Changes</a>`
    : 'the Request Changes link in the original review email';
  return `
<div style="max-width:680px;margin:0 auto;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;">
  <div style="background:linear-gradient(135deg,#7f1d1d 0%,#1e3a5f 100%);color:white;padding:32px 36px;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 4px;font-size:11px;color:#fca5a5;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Not approved yet &middot; ${dayWord(daysLeft)} until publish</p>
    <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3;">${title}</h1>
    <p style="margin:10px 0 0;font-size:13px;color:#cbd5e1;">Scheduled for ${publishDate}</p>
  </div>
  <div style="background:#ffffff;padding:28px 36px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 14px;color:#1e293b;font-size:15px;">Hi ${firstName},</p>
    <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6;">
      This article is scheduled for <strong style="color:#0f172a;">${publishDate}</strong>, in ${dayWord(daysLeft)}, and you have not approved it yet.
      <strong style="color:#0f172a;">It will NOT publish until you approve it in SAGE.</strong>
      If it is still not approved on ${publishDate}, it does not publish that day and the content owner is told.
      If you have changes, use ${changes}. ${changeRequestSentence(token)}
      ${CUTOFF_SENTENCE}
    </p>
    <p style="margin:0 0 18px;text-align:center;"><a href="${approveUrl}" style="display:inline-block;background:#166534;color:#ffffff;font-weight:700;padding:12px 20px;border-radius:8px;text-decoration:none;">Review and approve in SAGE</a></p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;">
      <p style="margin:0;color:#92400e;font-size:13px;"><strong>Email replies cannot approve.</strong> Approving is a click in SAGE, where you see the exact text that will publish.</p>
    </div>
  </div>
  <div style="background:#0f172a;padding:16px 36px;border-radius:0 0 12px 12px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#64748b;">The Way Agency &middot; Content Review System</p>
  </div>
</div>`;
}

// ─── Email-channel reviewers (review_via "email") ─
//
// The shared contract with sage-server (owner decision 2026-10-02, Q3): for a
// reviewer who reviews by email, the request and EVERY reminder carry the
// article's full text exactly as it will publish (the markdown body, front
// matter removed), the title and the publish date, under the review subject
// with the signed token (bound to the sha256 of the exact file bytes), and say:
// reply with APPROVED as the first line to approve this exact version, or reply
// with the changes you want. There is no SAGE link: they have no SAGE account.

/** The markdown body without its front matter, as it will publish. */
function articleBodyText(md) {
  return String(md).replace(/^---[\s\S]*?---\n/, '').replace(/^\n+/, '').replace(/\s+$/, '');
}

const EMAIL_CHANNEL_KICKER = {
  request: () => 'Review Request',
  reminder: () => 'Reminder &middot; 1 Week Until Publish',
  final: (n) => `Not approved yet &middot; ${dayWord(n)} until publish`,
};

/**
 * @param {object} post      the calendar entry
 * @param {string} content   the markdown file's text (the bytes the token is bound to)
 * @param {object} reviewer  the data/team.json member
 * @param {string} token     the review-request token over these bytes (required)
 * @param {{kind: 'request'|'reminder'|'final', daysLeft?: number}} opts
 */
function formatEmailChannelEmail(post, content, reviewer, token, { kind = 'request', daysLeft } = {}) {
  if (!token) throw new Error('formatEmailChannelEmail: the review-request token is required (it is what binds an emailed APPROVED to these exact bytes)');
  if (!EMAIL_CHANNEL_KICKER[kind]) throw new Error(`formatEmailChannelEmail: unknown kind ${JSON.stringify(kind)}`);
  const publishDate = longDate(post.publish_date);
  const title = escHtml(post.title);
  const firstName = escHtml(String(reviewer.name || '').split(' ')[0]);
  const reply = encodeURIComponent(buildReviewSubjects(post, token).reply);
  const approveHref = `mailto:${replyToAddress()}?subject=${reply}&body=${encodeURIComponent('APPROVED\n')}`;
  const changesHref = `mailto:${replyToAddress()}?subject=${reply}&body=${encodeURIComponent('Changes requested:\n\n')}`;
  const intro = kind === 'final'
    ? `This article is scheduled for <strong style="color:#0f172a;">${publishDate}</strong>, in ${dayWord(daysLeft)}, and you have not approved it yet. <strong style="color:#0f172a;">It will NOT publish until you approve it.</strong> If it is still not approved on ${publishDate}, it does not publish that day and the content owner is told.`
    : `This article is ready for your review. It is scheduled for <strong style="color:#0f172a;">${publishDate}</strong>${kind === 'reminder' ? ', one week from now' : ''}. Please check it for accuracy. <strong style="color:#0f172a;">${notPublishedSentence(publishDate, 'email')}</strong>`;
  return `
<div style="max-width:680px;margin:0 auto;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#f8fafc;">
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:white;padding:32px 36px;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 4px;font-size:11px;color:#38bdf8;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">${EMAIL_CHANNEL_KICKER[kind](daysLeft)}</p>
    <h1 style="margin:0;font-size:24px;font-weight:700;line-height:1.3;color:white;">${title}</h1>
    <p style="margin:10px 0 0;font-size:13px;color:#94a3b8;">Publishes ${publishDate} (${escHtml(post.publish_date)}), once you approve it</p>
  </div>
  <div style="background:#ffffff;padding:24px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
    <p style="margin:0 0 14px;color:#1e293b;font-size:15px;">Hi ${firstName},</p>
    <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6;">${intro}</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 18px;margin:0 0 12px;">
      <p style="margin:0 0 8px;color:#166534;font-size:14px;"><strong>To approve this exact version: reply to this email with APPROVED as the first line.</strong></p>
      <p style="margin:0 0 8px;color:#166534;font-size:14px;"><strong>To ask for changes: reply with the changes you want.</strong></p>
      <p style="margin:0;color:#15803d;font-size:12px;">Or use these links, which open the reply for you: <a href="${approveHref}" style="color:#166534;font-weight:700;">Approve</a> &middot; <a href="${changesHref}" style="color:#9a3412;font-weight:700;">Request Changes</a></p>
    </div>
    <p style="margin:0;color:#475569;font-size:13px;line-height:1.6;">
      Please keep the subject line as it is: it carries the code that ties your reply to this exact text.
      If the article changes before your reply arrives, your APPROVED does not count for the old text: you are sent the current text to approve.
      ${changeRequestSentence(token)}
      ${CUTOFF_SENTENCE}
    </p>
  </div>
  <div style="background:#ffffff;padding:36px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#94a3b8;">The full article, exactly as it will publish</p>
    <p style="margin:0 0 4px;font-size:15px;color:#0f172a;"><strong>Title:</strong> ${title}</p>
    <p style="margin:0 0 18px;font-size:13px;color:#475569;padding-bottom:12px;border-bottom:1px solid #e2e8f0;"><strong>Publish date:</strong> ${escHtml(post.publish_date)}</p>
    <pre style="white-space:pre-wrap;word-wrap:break-word;margin:0;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.7;color:#1e293b;">${escHtml(articleBodyText(content))}</pre>
  </div>
  <div style="background:#0f172a;padding:20px 36px;border-radius:0 0 12px 12px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#64748b;">The Way Agency &middot; Content Review System</p>
    <p style="margin:6px 0 0;font-size:11px;color:#475569;">This article publishes on ${publishDate} only once you approve it, and then names you as its reviewer.</p>
  </div>
</div>`;
}

// ─── Alert to the content owner ─────────────
function formatAlertEmail(post, problem) {
  return `
<div style="max-width:680px;margin:0 auto;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;">
  <div style="background:#7f1d1d;color:white;padding:24px 32px;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 4px;font-size:11px;color:#fecaca;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Blog review cannot reach its reviewer</p>
    <h1 style="margin:0;font-size:20px;font-weight:700;line-height:1.3;">${escHtml(post.title)}</h1>
    <p style="margin:8px 0 0;font-size:13px;color:#fecaca;">${escHtml(post.slug)} &middot; scheduled for ${escHtml(post.publish_date)}</p>
  </div>
  <div style="background:#ffffff;padding:24px 32px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 12px;color:#1e293b;font-size:14px;line-height:1.6;">${escHtml(problem)}</p>
    <p style="margin:0 0 12px;color:#475569;font-size:14px;line-height:1.6;">Every post needs its assigned licensed reviewer's approval to publish, so this post will not publish on its date unless that is fixed. Nothing was reassigned. To fix it: give the entry in data/content-calendar.json a licensed reviewer who can be reached (an active SAGE user, or a data/team.json member with "review_via": "email"), or correct data/team.json.</p>
    <p style="margin:0;color:#64748b;font-size:12px;">Sent by scripts/send-review-emails.js. This alert repeats on every run until it is fixed.</p>
  </div>
</div>`;
}

// ─── Send email via sage API ───────────────
//
// SAGE_API_TOKEN is a long-lived MCP API key (sage_<hex>) tied to the
// sage-bot service user — sent via the x-api-key header. JWTs aren't
// suitable here (24h expiry doesn't survive a weekly cron). Retries on
// network errors, 5xx, and 429. Does NOT retry 4xx — bad request stays
// bad. Each attempt is logged so the workflow run UI shows the timeline.
// A refusal throws an Error carrying the HTTP `status` and SAGE's error `code`
// (403 RECIPIENT_NOT_INTERNAL, 409 KILL_SWITCH_OUTBOUND_PAUSED, ...).
const SEND_RETRY_DELAYS = [1000, 2000, 4000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendError(status, text) {
  let code = null;
  try {
    const j = JSON.parse(text);
    code = (j && (j.code || (j.error && j.error.code))) || null;
  } catch { /* not JSON */ }
  if (!code) {
    const m = /\b(RECIPIENT_NOT_INTERNAL|KILL_SWITCH_OUTBOUND_PAUSED)\b/.exec(String(text));
    if (m) code = m[1];
  }
  const err = new Error(`Email send failed (${status}): ${text}`);
  err.status = status;
  err.code = code;
  return err;
}

async function sendEmail(to, subject, htmlBody, { cc = REVIEW_CC } = {}) {
  const url = `${SAGE_API_URL}/api/email-drafts`;
  // One key per email, reused by every retry below (BL-34). SAGE never saves
  // or sends a second copy under one key: a retry after a send that certainly
  // failed (a 429, a 5xx before it left) is sent once more under the same
  // key; a retry of a sent email gets the first answer. A send SAGE handed to
  // Microsoft without an answer comes back as 202 { outcome: 'unknown' }: not
  // retried (it may have been delivered).
  const idempotencyKey = `site-review-${crypto.randomUUID()}`;
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'x-api-key': SAGE_API_TOKEN,
      // SAGE enforces CSRF on every api-key call (SAGE_FF_BEARER_CSRF_ENFORCE).
      // Without this header the request dies at 403 CLIENT_ID_REQUIRED *before*
      // it ever reaches auth — which is exactly what silently killed every
      // review email from 2026-05-16 onward. The value is the mcp_api_keys row
      // id of the key in SAGE_API_TOKEN.
      'X-SAGE-Client-Id': SAGE_CLIENT_ID,
    },
    body: JSON.stringify({
      to,
      ...(cc ? { cc } : {}),
      subject,
      body: htmlBody,
      send: true,
    }),
  };

  let lastErr;
  for (let attempt = 0; attempt <= SEND_RETRY_DELAYS.length; attempt++) {
    try {
      const resp = await fetch(url, opts);
      if (resp.ok) {
        if (attempt > 0) console.log(`    ✓ succeeded on attempt ${attempt + 1}`);
        const answer = await resp.json();
        if (answer && answer.outcome === 'unknown') {
          console.log('    ! SAGE could not confirm delivery (outcome unknown): not retried; check the sending mailbox\'s Sent Items');
        }
        return answer;
      }
      const text = await resp.text();
      const retryable = resp.status >= 500 || resp.status === 429;
      lastErr = sendError(resp.status, text);
      if (!retryable) throw lastErr;
      console.log(`    ! attempt ${attempt + 1}: HTTP ${resp.status} (retryable)`);
    } catch (err) {
      // Distinguish thrown 4xx (already logged above) from network errors
      if (err === lastErr) throw err;
      lastErr = err;
      console.log(`    ! attempt ${attempt + 1}: ${err.message} (network error)`);
    }
    if (attempt < SEND_RETRY_DELAYS.length) {
      const delay = SEND_RETRY_DELAYS[attempt];
      console.log(`    … waiting ${delay}ms before retry`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ─── The passes ─────────────────────────────

const isPaused = (err) => !!err && (err.code === 'KILL_SWITCH_OUTBOUND_PAUSED' || (err.status === 409 && /KILL_SWITCH/.test(String(err.message))));
const isNotInternal = (err) => !!err && (err.code === 'RECIPIENT_NOT_INTERNAL' || (err.status === 403 && /RECIPIENT_NOT_INTERNAL/.test(String(err.message))));

/**
 * Every review email this run is due to send, sent through `send`.
 *
 * @param {object} args
 * @param {object} args.calendar      data/content-calendar.json (mutated: the review fields)
 * @param {Array}  args.team          data/team.json's team list
 * @param {string} args.today         YYYY-MM-DD (UTC)
 * @param {string} args.sageUrl       the SAGE origin the approval link opens
 * @param {string} args.tokenSecret   BLOG_REVIEW_TOKEN_SECRET
 * @param {(slug: string) => Buffer|null} args.readPostBytes
 * @param {(to: string, subject: string, html: string, opts?: {cc?: string|null}) => Promise<any>} args.send
 *   throws an Error with `status` and `code` when SAGE refuses
 * @param {boolean} [args.finalOnly]  the daily run: the D-3/D-2/D-1 pass (and a
 *   request for a 'planned' post 1-3 days out) only
 * @param {string} [args.alertTo]     the content owner (REVIEW_CC)
 * @param {(line: string) => void} [args.log]
 * @returns {Promise<{calendarChanged: boolean, counts: object, failures: string[]}>}
 */
async function runReviewEmails({
  calendar, team, today, sageUrl, tokenSecret, readPostBytes: readBytes, send,
  finalOnly = false, alertTo = REVIEW_CC, log = (line) => console.log(line),
}) {
  if (!tokenSecret) throw new Error('runReviewEmails: the review-request token secret is required');
  const counts = { requests: 0, reminders: 0, finals: 0, alerts: 0, queued: 0 };
  const failures = [];
  let calendarChanged = false;
  const rotation = rotationReviewers(team);
  const alerted = new Set();

  async function alert(post, problem) {
    if (alerted.has(post.slug)) return;
    alerted.add(post.slug);
    const subject = `Blog review cannot reach its reviewer: "${post.title}" (${post.publish_date})`;
    log(`  ! ALERT for "${post.title}" (${post.slug}): ${problem}`);
    try {
      await send(alertTo, subject, formatAlertEmail(post, problem), { cc: null });
      counts.alerts++;
      log(`    alert sent to the content owner (${alertTo})`);
    } catch (err) {
      // The alert could not be sent either (outbound paused, or SAGE refused
      // it): the run log is the alert, in full, and the run goes red.
      failures.push(`alert for ${post.slug} not sent: ${err.message}`);
      log(`    ! the alert to ${alertTo} could not be sent (${err.message}). Its text: ${subject}. ${problem}`);
    }
  }

  /**
   * Send one review email; returns 'sent', 'queued' (outbound paused: SAGE
   * keeps the draft for a person to send, so it counts as sent) or the Error
   * of a failed send.
   */
  async function deliver(post, member, subject, html, what) {
    try {
      await send(member.email, subject, html, { cc: alertTo });
      log(`  ✓ ${what} sent to ${member.name} (${member.email}): "${post.title}"`);
      return 'sent';
    } catch (err) {
      if (isPaused(err)) {
        counts.queued++;
        failures.push(`${what} for ${post.slug} queued in SAGE: outbound email is paused`);
        log(`  ! ${what} to ${member.email} for "${post.title}" is QUEUED in SAGE, not sent: outbound email is paused (kill switch). `
          + 'It is recorded as sent so no second copy is queued; send it from the SAGE email queue once the kill switch is lifted.');
        return 'queued';
      }
      failures.push(`${what} for ${post.slug} to ${member.email}: ${err.message}`);
      log(`  ! Failed to send ${what} to ${member.email}: ${err.message}`);
      if (isNotInternal(err)) {
        await alert(post, `SAGE refused to email ${member.name} (${member.email}), the assigned reviewer: not an active SAGE user`
          + `${member.review_via === 'email' ? ', and SAGE does not (yet) allow email to reviewers who review by email' : ''}. `
          + 'SAGE keeps the refused email in its email queue for a person to review.');
      }
      return err;
    }
  }

  /** The token over the current bytes (null without them). */
  const tokenFor = (post, member, bytes) => (bytes
    ? issueReviewToken({ slug: post.slug, reviewerEmail: member.email, publishDate: post.publish_date, content: bytes }, tokenSecret)
    : null);

  for (const post of calendar.year1 || []) {
    if (!post || !post.slug || !/^\d{4}-\d{2}-\d{2}$/.test(String(post.publish_date || ''))) continue;
    const days = daysBetweenUtc(today, post.publish_date);

    // ── Request (normally ~D-14) ──
    // Window 0-18 days out. The upper end: the post's markdown is produced by
    // SAGE's machine gate, which can land a draft as late as D-13, and this
    // runs twice a week. The lower end is 0, not 10 as it was while silence
    // published: a post whose draft lands late, or that is locked late, still
    // has to be approved to publish at all, so it is still sent. The daily
    // run (finalOnly) sends it for a post 1-3 days out, so a late post is not
    // left without a request for up to 4 days.
    const requestWindow = finalOnly ? (days >= 1 && days <= 3) : (days >= 0 && days <= 18);
    if (post.status === 'planned' && requestWindow) {
      const bytes = readBytes(post.slug);
      if (!bytes) {
        log(`  ! Skipping "${post.title}" — markdown file not found`);
        continue;
      }
      let member;
      let channel;
      const named = assignedReviewer(post, team);
      if (named.named) {
        // An entry that already names its reviewer keeps them (a failed send,
        // or the content owner's choice): never reassigned here.
        if (!named.channel) {
          failures.push(`${post.slug}: ${named.why}`);
          await alert(post, `The assigned reviewer cannot review it: ${named.why}.`);
          continue;
        }
        member = named.member;
        channel = named.channel;
      } else {
        if (!rotation.length) {
          failures.push(`${post.slug}: no licensed reviewer in data/team.json`);
          await alert(post, 'There is no licensed reviewer with a review channel in data/team.json to assign.');
          continue;
        }
        member = getNextReviewer(calendar, rotation);
        channel = reviewChannel(member);
      }
      const token = tokenFor(post, member, bytes);
      const content = bytes.toString('utf8');
      const subject = buildReviewSubjects(post, token).email;
      const html = channel === 'email'
        ? formatEmailChannelEmail(post, content, member, token, { kind: 'request' })
        : formatReviewEmail(post, content, member, token, { sageUrl });

      post.reviewer = member.name;
      post.reviewer_email = member.email;
      post.reviewer_slug = member.slug;
      calendarChanged = true;
      const outcome = await deliver(post, member, subject, html, 'Review request');
      if (outcome instanceof Error) {
        // Stays 'planned' so it is picked up next run — but KEEP the reviewer
        // fields and record why. Deleting them erased the only evidence the
        // send had ever been attempted: combined with a 4xx (never retried) and
        // a workflow step that swallowed the exit code, the review email failed
        // silently for two months while every run reported green.
        post.review_send_error = `${today}: ${outcome.message}`.slice(0, 300);
      } else {
        post.status = 'in-review';
        post.review_sent_date = today;
        delete post.review_send_error;
        if (outcome === 'sent') counts.requests++;
      }
      continue;
    }

    if (post.status !== 'in-review') continue;
    const isFinal = days >= 1 && days <= 3;
    const isWeek = !finalOnly && days >= 5 && days <= 9 && !post.reminder_sent;
    if (!isFinal && !isWeek) continue;
    // The request went out today: that is today's email.
    if (post.review_sent_date === today) continue;
    const sentDates = Array.isArray(post.final_reminder_dates) ? post.final_reminder_dates : [];
    if (isFinal && sentDates.includes(today)) continue;

    const named = assignedReviewer(post, team);
    if (!named.channel) {
      const why = named.named ? named.why : 'the entry is in review but names no reviewer';
      failures.push(`${post.slug}: ${why}`);
      await alert(post, `It is waiting for its reviewer's approval, but the assigned reviewer cannot be reminded: ${why}.`);
      continue;
    }
    const member = named.member;
    const bytes = readBytes(post.slug);
    if (named.channel === 'email' && !bytes) {
      // The email-channel reminder IS the text to approve; without the file
      // there is nothing to approve.
      failures.push(`${post.slug}: markdown file not found for an email-channel reminder`);
      log(`  ! Not reminding ${member.email} for "${post.title}": src/blog/${post.slug}.md is missing, and the reminder must carry the full text`);
      continue;
    }
    const token = tokenFor(post, member, bytes);
    let subject;
    let html;
    if (named.channel === 'email') {
      subject = buildReviewSubjects(post, token).email;
      html = formatEmailChannelEmail(post, bytes.toString('utf8'), member, token, isFinal ? { kind: 'final', daysLeft: days } : { kind: 'reminder' });
    } else if (isFinal) {
      subject = `Not approved yet: "${post.title}" will not publish on ${post.publish_date} until you approve it`;
      html = formatFinalReminderEmail(post, member, { sageUrl, token, daysLeft: days });
    } else {
      subject = `Reminder: "${post.title}" publishes ${post.publish_date} once you approve it`;
      html = formatReminderEmail(post, member, { sageUrl, token });
    }
    const outcome = await deliver(post, member, subject, html, isFinal ? `Final reminder (D-${days})` : 'Reminder (D-7)');
    if (outcome instanceof Error) continue;
    if (isFinal) {
      post.final_reminder_dates = [...sentDates, today];
      if (outcome === 'sent') counts.finals++;
    } else {
      post.reminder_sent = true;
      if (outcome === 'sent') counts.reminders++;
    }
    calendarChanged = true;
  }

  return { calendarChanged, counts, failures };
}

// ─── Main ──────────────────────────────────
async function main() {
  const finalOnly = process.argv.slice(2).includes('--final-reminders');

  // Fail loudly on a misconfigured secret rather than 403-ing into the void.
  const missing = ['SAGE_API_URL', 'SAGE_API_TOKEN', 'SAGE_CLIENT_ID'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`  ! Missing required secret(s): ${missing.join(', ')}`);
    process.exit(2);
  }

  // ─── Load data ──────────────────────────────
  const calendar = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));
  const teamData = JSON.parse(fs.readFileSync(TEAM_PATH, 'utf8'));
  const team = Array.isArray(teamData) ? teamData : (teamData.team || []);

  // The approval link's base. Fail loudly on a bad value rather than mailing
  // reviewers a link that does not open SAGE.
  let sageUrl;
  try {
    sageUrl = sageReviewBase();
  } catch (err) {
    console.error(`  ! ${err.message}`);
    process.exit(2);
  }

  // The review code is what binds a reply to the exact text (a change request
  // to a proposed edit, an emailed APPROVED to these bytes). Fail loudly on a
  // missing or short secret, before anything is sent.
  const tokenSecret = reviewTokenSecret();
  if (!tokenSecret) {
    console.error(`  ! BLOG_REVIEW_TOKEN_SECRET is not set (or shorter than ${MIN_SECRET_LENGTH} characters). Set it in the `
      + 'repository secrets, with the same value as in the sage .env. No review email was sent.');
    process.exit(2);
  }

  const today = todayUtc();
  console.log(`  Review emails for ${today}${finalOnly ? ' (daily run: D-3/D-2/D-1 reminders, and requests 1-3 days out)' : ''}`);
  const { calendarChanged, counts, failures } = await runReviewEmails({
    calendar, team, today, sageUrl, tokenSecret, readPostBytes, send: sendEmail, finalOnly,
  });

  if (calendarChanged) {
    fs.writeFileSync(CALENDAR_PATH, JSON.stringify(calendar, null, 2) + '\n');
    // Tell the workflow to commit — including a recorded review_send_error, which
    // is exactly the evidence the old self-erasing catch block destroyed.
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'reviews_sent=true\n');
    }
  }

  console.log(`\n  ${counts.requests} review(s) sent, ${counts.reminders} reminder(s) sent, ${counts.finals} final reminder(s) sent, `
    + `${counts.queued} queued in SAGE (outbound paused), ${counts.alerts} alert(s) to the content owner, ${failures.length} failed.`);

  // Exit codes are load-bearing. This used to exit 1 for BOTH "nothing was due"
  // and "the send failed", so the workflow had to ignore the code entirely —
  // which is how a two-month outage reported green every single run.
  //   0 = sent, or nothing was due (both normal)
  //   2 = a send failed or was only queued, or a reviewer cannot be reached
  //       (the workflow must go red)
  if (failures.length > 0) {
    console.error(`  ! ${failures.length} problem(s):`);
    for (const f of failures) console.error(`    - ${f}`);
    process.exit(2);
  }
  process.exit(0);
}

module.exports = {
  issueReviewToken, buildReviewSubjects, formatReviewEmail, formatReminderEmail, formatFinalReminderEmail,
  formatEmailChannelEmail, formatAlertEmail, articleBodyText, reviewTokenSecret,
  sageReviewBase, reviewApprovalUrl, MIN_SECRET_LENGTH, escHtml, markdownToEmailHtml,
  reviewChannel, rotationReviewers, assignedReviewer, getNextReviewer, daysBetweenUtc, runReviewEmails, sendEmail,
};

if (require.main === module) {
  if (!SAGE_API_URL || !SAGE_API_TOKEN) {
    console.log('  ! SAGE_API_URL and SAGE_API_TOKEN are required');
    process.exit(1);
  }
  main().catch(err => {
    console.error('  ! Review script error:', err.message);
    process.exit(2);
  });
}

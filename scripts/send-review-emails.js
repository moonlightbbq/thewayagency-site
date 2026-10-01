#!/usr/bin/env node
/**
 * The Way Agency — Blog Review Email Sender
 *
 * Checks content-calendar.json for posts with publish_date 14 days from now
 * and sends the article to a licensed team member for review via sage-server.
 *
 * Also sends reminders for posts still in "in-review" status 7 days before publish.
 *
 * Reviewer rotation: cycles through licensed agents (Sheilia, Audrey, Kelly, Jill).
 * Assignment is stored in each calendar entry's "reviewer" field.
 *
 * Usage: node scripts/send-review-emails.js
 *
 * Approving is a click in SAGE (BL-07): the email's primary action is
 * "Review and approve in SAGE", a link to SAGE's review page for the post,
 * where the assigned reviewer sees the exact text that will publish and
 * approves it. Email replies cannot approve. The "Request Changes" link still
 * composes a reply (carrying the signed review-request token) that SAGE turns
 * into a held post and a proposed edit. A reply to an older email's "Approve"
 * link now gets SAGE's answer with the approval link, and changes nothing.
 *
 * Silence publishes the post on its date with NO reviewer named: only an
 * approval in SAGE earns the "Reviewed by" credit
 * (scripts/lib/review-credit.js), and the emails say so.
 *
 * Required env vars:
 *   SAGE_API_URL    — e.g., https://sage.thewayagency.com
 *   SAGE_API_TOKEN  — JWT token for sage-server API auth
 * Optional:
 *   SAGE_REVIEW_URL — the public SAGE app URL the approval link opens (https).
 *     Defaults to SAGE_API_URL (a trailing "/" or "/api" is dropped). Set it
 *     when SAGE_API_URL is not the address reviewers sign in at.
 *   BLOG_REVIEW_TOKEN_SECRET — signs the review-request token SAGE verifies on
 *     the reviewer's change request (BL-07). The same value is set in the sage
 *     .env. REQUIRED: without it (or shorter than 32 characters) the run exits
 *     2 before sending anything. A token-less email would still let SAGE hold
 *     the post on a change request, but never prepare the edit, and the
 *     misconfiguration would otherwise pass unseen.
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
function today() {
  return new Date().toISOString().split('T')[0];
}

function daysUntil(dateStr) {
  const target = new Date(dateStr + 'T12:00:00');
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

// ─── Reviewer rotation ─────────────────────
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

function applyInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0f172a;">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="https://www.thewayagency.com$2" style="color:#0891b2;text-decoration:underline;">$1</a>');
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
// What happens on silence and on a change request, said the same way in both.
// The cut-off is SAGE's: from the publish date (which begins at midnight UTC)
// a post may already be live, so a reply can no longer hold it.
function silenceSentence(publishDate) {
  return `If you take no action it publishes on ${publishDate} without a reviewer named: only an approval in SAGE puts your name on it.`;
}

function changeRequestSentence(token) {
  return token
    ? 'If you request changes, SAGE holds the post and emails you the proposed edit as a list of changes, and nothing is published until you approve a version in SAGE.'
    : 'If you request changes, SAGE holds the post until a version is approved in SAGE. This email carries no review code, so SAGE cannot prepare the edit itself: the content owner makes it by hand.';
}

const CUTOFF_SENTENCE = 'A change request has to reach SAGE before the publish date begins (midnight UTC, which is the evening before in US time): from then on the post may already be live, and SAGE can no longer hold it.';

// ─── Format post as HTML email ─────────────
function formatReviewEmail(post, content, reviewer, token = null, { sageUrl } = {}) {
  if (!sageUrl) throw new Error('formatReviewEmail: sageUrl is required (the approval link opens SAGE)');
  const approveUrl = reviewApprovalUrl(sageUrl, post.slug);
  const articleHtml = markdownToEmailHtml(content);

  const publishDate = new Date(post.publish_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const pillarLabel = pillarLabels[post.pillar] || post.pillar;
  const targetPage = post.target_product_page
    ? `<a href="https://www.thewayagency.com${post.target_product_page}" style="color:#0891b2;">${post.target_product_page}</a>`
    : 'General';
  const readingTime = post.reading_time || '5-7 min read';

  // Approving is a click in SAGE (BL-07): the green action is a link to SAGE's
  // review page, where the reviewer sees the exact text that will publish.
  // An email reply cannot approve (it once could, and classifying emailed text
  // as an approval proved unsafe), so there is no "Approve" mailto.
  //
  // The orange Request Changes link composes a reply. Its subject has to
  // satisfy sage's anchored reply grammar (src/email/blog-review-guard.js:
  // reply prefix, the review marker, the quoted title, then only the binding
  // tag) AND carry the review-request token, or SAGE refuses the change
  // request. Replies go to the mailbox sage polls for intake.
  const replyTo = process.env.REVIEW_REPLY_TO || 'sage@thewayagency.com';
  const replySubject = encodeURIComponent(buildReviewSubjects(post, token).reply);
  const changesHref = `mailto:${replyTo}?subject=${replySubject}&body=${encodeURIComponent('Changes requested:\n\n')}`;

  return `
<div style="max-width:680px;margin:0 auto;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#f8fafc;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:white;padding:32px 36px;border-radius:12px 12px 0 0;">
    <table style="width:100%;"><tr>
      <td style="vertical-align:top;">
        <p style="margin:0 0 4px;font-size:11px;color:#38bdf8;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Review Request</p>
        <h1 style="margin:0;font-size:24px;font-weight:700;line-height:1.3;color:white;">${post.title}</h1>
        <p style="margin:10px 0 0;font-size:13px;color:#94a3b8;">${pillarLabel} &middot; ${readingTime} &middot; Publishes ${publishDate}</p>
      </td>
    </tr></table>
  </div>

  <!-- Action Bar -->
  <div style="background:#ffffff;padding:24px 36px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
    <p style="margin:0 0 14px;color:#1e293b;font-size:15px;">Hi ${reviewer.name.split(' ')[0]},</p>
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
      ${silenceSentence(publishDate)}
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
    <p style="margin:6px 0 0;font-size:11px;color:#475569;">This article publishes automatically on ${publishDate} unless changes are requested in time. It names you as reviewer only if you approve it in SAGE.</p>
  </div>

</div>`;
}

// ─── Reminder email (7 days before publish) ─
function formatReminderEmail(post, reviewer, { sageUrl, token = null } = {}) {
  if (!sageUrl) throw new Error('formatReminderEmail: sageUrl is required (the approval link opens SAGE)');
  const approveUrl = reviewApprovalUrl(sageUrl, post.slug);
  const publishDate = new Date(post.publish_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const pillarLabel = pillarLabels[post.pillar] || post.pillar;
  const replyTo = process.env.REVIEW_REPLY_TO || 'sage@thewayagency.com';
  const changes = token
    ? `<a href="mailto:${replyTo}?subject=${encodeURIComponent(buildReviewSubjects(post, token).reply)}&body=${encodeURIComponent('Changes requested:\n\n')}" style="color:#9a3412;font-weight:700;">Request Changes</a>`
    : 'the Request Changes link in the original review email';
  return `
<div style="max-width:680px;margin:0 auto;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;">
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:white;padding:32px 36px;border-radius:12px 12px 0 0;">
    <p style="margin:0 0 4px;font-size:11px;color:#fbbf24;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">Reminder &middot; 1 Week Until Publish</p>
    <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3;">${post.title}</h1>
    <p style="margin:10px 0 0;font-size:13px;color:#94a3b8;">${pillarLabel} &middot; Publishes ${publishDate}</p>
  </div>
  <div style="background:#ffffff;padding:28px 36px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 14px;color:#1e293b;font-size:15px;">Hi ${reviewer.name.split(' ')[0]},</p>
    <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6;">
      This article publishes in <strong style="color:#0f172a;">one week</strong> on <strong style="color:#0f172a;">${publishDate}</strong>.
      To approve it, review it in SAGE. If you have changes, use ${changes}. ${changeRequestSentence(token)}
      ${CUTOFF_SENTENCE}
      ${silenceSentence(publishDate)}
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

// ─── Send email via sage API ───────────────
//
// SAGE_API_TOKEN is a long-lived MCP API key (sage_<hex>) tied to the
// sage-bot service user — sent via the x-api-key header. JWTs aren't
// suitable here (24h expiry doesn't survive a weekly cron). Retries on
// network errors, 5xx, and 429. Does NOT retry 4xx — bad request stays
// bad. Each attempt is logged so the workflow run UI shows the timeline.
const SEND_RETRY_DELAYS = [1000, 2000, 4000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendEmail(to, subject, htmlBody) {
  const url = `${SAGE_API_URL}/api/email-drafts`;
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
      cc: REVIEW_CC,
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
        return resp.json();
      }
      const text = await resp.text();
      const retryable = resp.status >= 500 || resp.status === 429;
      lastErr = new Error(`Email send failed (${resp.status}): ${text}`);
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

// ─── Main ──────────────────────────────────
async function main() {
  let reviewsSent = 0;
  let remindersSent = 0;
  let sendFailures = 0;

  // Fail loudly on a misconfigured secret rather than 403-ing into the void.
  const missing = ['SAGE_API_URL', 'SAGE_API_TOKEN', 'SAGE_CLIENT_ID'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`  ! Missing required secret(s): ${missing.join(', ')}`);
    process.exit(2);
  }

  // ─── Load data ──────────────────────────────
  const calendar = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));
  const teamData = JSON.parse(fs.readFileSync(TEAM_PATH, 'utf8'));
  // Licensed agents only (have email and license_states)
  const reviewers = teamData.team.filter(t => t.email && t.license_states && t.license_states.length > 0);

  // The approval link's base. Fail loudly on a bad value rather than mailing
  // reviewers a link that does not open SAGE.
  let sageUrl;
  try {
    sageUrl = sageReviewBase();
  } catch (err) {
    console.error(`  ! ${err.message}`);
    process.exit(2);
  }

  // The review code is what lets SAGE turn a change request into a proposed
  // edit. Fail loudly on a missing or short secret, before anything is sent,
  // rather than mail emails whose change requests can only be made by hand.
  const tokenSecret = reviewTokenSecret();
  if (!tokenSecret) {
    console.error(`  ! BLOG_REVIEW_TOKEN_SECRET is not set (or shorter than ${MIN_SECRET_LENGTH} characters). Set it in the `
      + 'repository secrets, with the same value as in the sage .env. No review email was sent.');
    process.exit(2);
  }
  let calendarChanged = false;

  for (const post of calendar.year1) {
    const days = daysUntil(post.publish_date);

    // ── Send initial review email ──
    // Window is 10-18 days out, not 12-16. The post's markdown is produced by
    // SAGE's machine gate (SEO score + fact-check), which auto-promotes after a
    // 5-day hold — so for a draft spawned at T-18 the file only appears at T-13.
    // Against the old 12-16 window that left a 2-day slot, and this cron runs
    // just twice a week (Wed/Sat): the post would sail past the window with no
    // reviewer ever emailed, and publish with a byline nobody earned. A 10-18
    // window always gives the file at least one cron hit after it lands.
    if (post.status === 'planned' && days >= 10 && days <= 18) {
      const bytes = readPostBytes(post.slug);
      if (!bytes) {
        console.log(`  ! Skipping "${post.title}" — markdown file not found`);
        continue;
      }
      const content = bytes.toString('utf8');

      const reviewer = getNextReviewer(calendar, reviewers);
      post.status = 'in-review';
      post.reviewer = reviewer.name;
      post.reviewer_email = reviewer.email;
      post.reviewer_slug = reviewer.slug;
      post.review_sent_date = today();
      calendarChanged = true;

      const token = tokenSecret
        ? issueReviewToken({ slug: post.slug, reviewerEmail: reviewer.email, publishDate: post.publish_date, content: bytes }, tokenSecret)
        : null;
      const htmlBody = formatReviewEmail(post, content, reviewer, token, { sageUrl });
      try {
        await sendEmail(
          reviewer.email,
          buildReviewSubjects(post, token).email,
          htmlBody
        );
        reviewsSent++;
        console.log(`  ✓ Review sent to ${reviewer.name} (${reviewer.email}): "${post.title}"`);
      } catch (err) {
        console.log(`  ! Failed to send review to ${reviewer.email}: ${err.message}`);
        // Revert status so it gets picked up next run — but KEEP the reviewer
        // fields and record why. Deleting them erased the only evidence the
        // send had ever been attempted: combined with a 4xx (never retried) and
        // a workflow step that swallowed the exit code, the review email failed
        // silently for two months while every run reported green.
        post.status = 'planned';
        post.review_send_error = `${new Date().toISOString().split('T')[0]}: ${err.message}`.slice(0, 300);
        sendFailures++;
      }
    }

    // ── Send reminder (7 days before publish) ──
    if (post.status === 'in-review' && days >= 5 && days <= 9 && !post.reminder_sent) {
      const reviewer = reviewers.find(r => r.email === post.reviewer_email);
      if (!reviewer) continue;

      const bytes = readPostBytes(post.slug);
      const token = tokenSecret && bytes
        ? issueReviewToken({ slug: post.slug, reviewerEmail: reviewer.email, publishDate: post.publish_date, content: bytes }, tokenSecret)
        : null;
      const reminderHtml = formatReminderEmail(post, reviewer, { sageUrl, token });

      try {
        await sendEmail(
          reviewer.email,
          `Reminder: "${post.title}" publishes ${post.publish_date}`,
          reminderHtml
        );
        post.reminder_sent = true;
        calendarChanged = true;
        remindersSent++;
        console.log(`  ✓ Reminder sent to ${reviewer.name}: "${post.title}"`);
      } catch (err) {
        console.log(`  ! Failed to send reminder to ${reviewer.email}: ${err.message}`);
      }
    }
  }

  if (calendarChanged) {
    fs.writeFileSync(CALENDAR_PATH, JSON.stringify(calendar, null, 2) + '\n');
    // Tell the workflow to commit — including a recorded review_send_error, which
    // is exactly the evidence the old self-erasing catch block destroyed.
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'reviews_sent=true\n');
    }
  }

  console.log(`\n  ${reviewsSent} review(s) sent, ${remindersSent} reminder(s) sent, ${sendFailures} failed.`);

  // Exit codes are load-bearing. This used to exit 1 for BOTH "nothing was due"
  // and "the send failed", so the workflow had to ignore the code entirely —
  // which is how a two-month outage reported green every single run.
  //   0 = sent, or nothing was due (both normal)
  //   2 = a send actually failed (the workflow must go red)
  if (sendFailures > 0) {
    console.error(`  ! ${sendFailures} review email(s) failed to send.`);
    process.exit(2);
  }
  process.exit(0);
}

module.exports = {
  issueReviewToken, buildReviewSubjects, formatReviewEmail, formatReminderEmail, reviewTokenSecret,
  sageReviewBase, reviewApprovalUrl, MIN_SECRET_LENGTH,
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

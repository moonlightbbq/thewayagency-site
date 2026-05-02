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
 * Required env vars:
 *   SAGE_API_URL    — e.g., https://sage.thewayagency.com
 *   SAGE_API_TOKEN  — JWT token for sage-server API auth
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CALENDAR_PATH = path.join(ROOT, 'data', 'content-calendar.json');
const TEAM_PATH = path.join(ROOT, 'data', 'team.json');
const BLOG_SRC = path.join(ROOT, 'src', 'blog');

const SAGE_API_URL = process.env.SAGE_API_URL;
const SAGE_API_TOKEN = process.env.SAGE_API_TOKEN;
const REVIEW_CC = process.env.REVIEW_CC || 'partner@thewayagency.com';

if (!SAGE_API_URL || !SAGE_API_TOKEN) {
  console.log('  ! SAGE_API_URL and SAGE_API_TOKEN are required');
  process.exit(1);
}

// ─── Load data ──────────────────────────────
const calendar = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));
const teamData = JSON.parse(fs.readFileSync(TEAM_PATH, 'utf8'));

// Licensed agents only (have email and license_states)
const reviewers = teamData.team.filter(t => t.email && t.license_states && t.license_states.length > 0);

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
function getNextReviewer(calendar) {
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
function readPostContent(slug) {
  const mdPath = path.join(BLOG_SRC, `${slug}.md`);
  if (!fs.existsSync(mdPath)) return null;
  return fs.readFileSync(mdPath, 'utf8');
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

// ─── Format post as HTML email ─────────────
function formatReviewEmail(post, content, reviewer) {
  const articleHtml = markdownToEmailHtml(content);

  const publishDate = new Date(post.publish_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const pillarLabel = pillarLabels[post.pillar] || post.pillar;
  const targetPage = post.target_product_page
    ? `<a href="https://www.thewayagency.com${post.target_product_page}" style="color:#0891b2;">${post.target_product_page}</a>`
    : 'General';
  const readingTime = post.reading_time || '5-7 min read';

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
        <p style="margin:0 0 4px;font-weight:700;color:#166534;font-size:14px;">Approve</p>
        <p style="margin:0;color:#4ade80;font-size:12px;">Reply "Approved" or take no action</p>
      </td>
      <td style="width:50%;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;text-align:center;vertical-align:top;">
        <p style="margin:0 0 4px;font-weight:700;color:#9a3412;font-size:14px;">Request Changes</p>
        <p style="margin:0;color:#fb923c;font-size:12px;">Reply with your edits or notes</p>
      </td>
    </tr></table>
  </div>

  <!-- Article Content -->
  <div style="background:#ffffff;padding:36px;border:1px solid #e2e8f0;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
    <p style="margin:0 0 24px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#94a3b8;padding-bottom:12px;border-bottom:1px solid #e2e8f0;">Article Preview</p>
    ${articleHtml}
  </div>

  <!-- Footer -->
  <div style="background:#0f172a;padding:20px 36px;border-radius:0 0 12px 12px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#64748b;">The Way Agency &middot; Content Review System</p>
    <p style="margin:6px 0 0;font-size:11px;color:#475569;">This article will publish automatically on ${publishDate} unless changes are requested.</p>
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
  let calendarChanged = false;

  for (const post of calendar.year1) {
    const days = daysUntil(post.publish_date);

    // ── Send initial review email (14 days before publish) ──
    if (post.status === 'planned' && days >= 12 && days <= 16) {
      const content = readPostContent(post.slug);
      if (!content) {
        console.log(`  ! Skipping "${post.title}" — markdown file not found`);
        continue;
      }

      const reviewer = getNextReviewer(calendar);
      post.status = 'in-review';
      post.reviewer = reviewer.name;
      post.reviewer_email = reviewer.email;
      post.reviewer_slug = reviewer.slug;
      post.review_sent_date = today();
      calendarChanged = true;

      const htmlBody = formatReviewEmail(post, content, reviewer);
      try {
        await sendEmail(
          reviewer.email,
          `Review Request: "${post.title}" — publishes ${post.publish_date}`,
          htmlBody
        );
        reviewsSent++;
        console.log(`  ✓ Review sent to ${reviewer.name} (${reviewer.email}): "${post.title}"`);
      } catch (err) {
        console.log(`  ! Failed to send review to ${reviewer.email}: ${err.message}`);
        // Revert status so it gets picked up next run
        post.status = 'planned';
        delete post.reviewer;
        delete post.reviewer_email;
        delete post.reviewer_slug;
        delete post.review_sent_date;
      }
    }

    // ── Send reminder (7 days before publish) ──
    if (post.status === 'in-review' && days >= 5 && days <= 9 && !post.reminder_sent) {
      const reviewer = reviewers.find(r => r.email === post.reviewer_email);
      if (!reviewer) continue;

      const publishDate = new Date(post.publish_date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });

      const pillarLabel = pillarLabels[post.pillar] || post.pillar;
      const reminderHtml = `
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
      If you have changes, reply to the original review email. Otherwise, it will go live as written.
    </p>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;">
      <p style="margin:0;color:#92400e;font-size:13px;"><strong>No action needed to approve.</strong> The article publishes automatically on schedule.</p>
    </div>
  </div>
  <div style="background:#0f172a;padding:16px 36px;border-radius:0 0 12px 12px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#64748b;">The Way Agency &middot; Content Review System</p>
  </div>
</div>`;

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
  }

  console.log(`\n  ${reviewsSent} review(s) sent, ${remindersSent} reminder(s) sent.`);
  process.exit(reviewsSent > 0 || remindersSent > 0 ? 0 : 1);
}

main().catch(err => {
  console.error('  ! Review script error:', err.message);
  process.exit(1);
});

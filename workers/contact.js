/**
 * Contact Form Worker
 * Receives contact form submissions and sends notification emails.
 * Deployed as a Cloudflare Worker at thewayagency.com/api/contact
 *
 * Environment variables (set via wrangler secret):
 *   CONTACT_EMAIL — agency email to receive submissions
 */

const ALLOWED_ORIGINS = [
  'https://thewayagency.com',
  'https://www.thewayagency.com',
  'https://staging.thewayagency-site.pages.dev',
];

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

// Simple in-memory rate limiter: Map<"ip:hourBucket", count>
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 10;

function checkRateLimit(ip) {
  const hourBucket = Math.floor(Date.now() / 3600000);
  const key = `${ip}:${hourBucket}`;

  // Prune stale entries (different hour bucket)
  for (const k of rateLimitMap.keys()) {
    if (!k.endsWith(`:${hourBucket}`)) {
      rateLimitMap.delete(k);
    }
  }

  const count = rateLimitMap.get(key) || 0;
  if (count >= RATE_LIMIT_MAX) {
    return false;
  }
  rateLimitMap.set(key, count + 1);
  return true;
}

function stripHtmlTags(str) {
  return String(str).replace(/<[^>]*>/g, '');
}

export default {
  async fetch(request, env) {
    const cors = getCorsHeaders(request);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });
    }

    // Rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(clientIP)) {
      return Response.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: cors });
    }

    try {
      const data = await request.json();

      // Honeypot check
      if (data._hp_company) {
        return Response.json({ error: 'Verification failed' }, { status: 403, headers: cors });
      }

      // --- Input validation ---

      // name: required, max 100 chars, strip HTML
      if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
        return Response.json({ error: 'Name is required' }, { status: 400, headers: cors });
      }
      const name = stripHtmlTags(data.name.trim()).slice(0, 100);

      // email: required, max 254 chars, validate format, reject newlines
      if (!data.email || typeof data.email !== 'string' || !data.email.trim()) {
        return Response.json({ error: 'Email is required' }, { status: 400, headers: cors });
      }
      const email = data.email.trim().slice(0, 254);
      if (/[\r\n]/.test(email)) {
        return Response.json({ error: 'Invalid email address' }, { status: 400, headers: cors });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: 'Invalid email address' }, { status: 400, headers: cors });
      }

      // phone: optional, digits only after stripping non-digits, max 15 digits
      let phone = '';
      if (data.phone && typeof data.phone === 'string' && data.phone.trim()) {
        phone = data.phone.replace(/\D/g, '').slice(0, 15);
        if (phone.length === 0) {
          phone = '';
        }
      }

      // message: optional, max 5000 chars
      let message = '';
      if (data.message && typeof data.message === 'string') {
        message = data.message.slice(0, 5000);
      }

      // Send email via MailChannels (free for Cloudflare Workers)
      const toEmail = env.CONTACT_EMAIL || 'hello@thewayagency.com';
      const emailRes = await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: toEmail, name: 'The Way Agency' }] }],
          from: { email: 'noreply@thewayagency.com', name: 'The Way Agency Website' },
          reply_to: { email, name },
          subject: `Website Contact: ${name}`,
          content: [{
            type: 'text/html',
            value: `
              <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">
                <h2 style="color:#173358;">New Contact Form Submission</h2>
                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                  <tr><td style="padding:8px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Name</td><td style="padding:8px;font-weight:600;border-bottom:1px solid #e5e7eb;">${escapeHtml(name)}</td></tr>
                  <tr><td style="padding:8px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Email</td><td style="padding:8px;font-weight:600;border-bottom:1px solid #e5e7eb;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
                  ${phone ? `<tr><td style="padding:8px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Phone</td><td style="padding:8px;font-weight:600;border-bottom:1px solid #e5e7eb;"><a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></td></tr>` : ''}
                  ${message ? `<tr><td style="padding:8px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Message</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(message)}</td></tr>` : ''}
                </table>
                <p style="font-size:12px;color:#9ca3af;margin-top:16px;">Submitted from ${escapeHtml(data.page || 'thewayagency.com')} at ${new Date().toISOString()}</p>
              </div>
            `,
          }],
        }),
      });

      if (!emailRes.ok) {
        console.error('MailChannels error:', await emailRes.text());
        return Response.json({ ok: false, error: 'Email delivery failed' }, { status: 502, headers: cors });
      }

      return Response.json({ ok: true }, { headers: cors });
    } catch (err) {
      console.error('Contact worker error:', err);
      return Response.json({ error: 'Failed to process contact form' }, { status: 500, headers: cors });
    }
  },
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

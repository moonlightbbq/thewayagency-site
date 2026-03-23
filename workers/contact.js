/**
 * Contact Form Worker
 * Receives contact form submissions and sends notification emails.
 * Deployed as a Cloudflare Worker at thewayagency.com/api/contact
 *
 * Environment variables (set via wrangler secret):
 *   CONTACT_EMAIL — agency email to receive submissions
 */

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
      const data = await request.json();
      const { name, email, phone, message } = data;

      if (!name || !email) {
        return Response.json({ error: 'Name and email are required' }, { status: 400 });
      }

      // Honeypot check
      if (data._hp_company) {
        return Response.json({ error: 'Verification failed' }, { status: 403 });
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
      }

      return Response.json({ ok: true }, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } catch (err) {
      console.error('Contact worker error:', err);
      return Response.json({ error: 'Failed to process contact form' }, { status: 500 });
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

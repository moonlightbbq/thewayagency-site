/**
 * Quote Form Worker
 * Forwards quote requests to sage's /api/intake/lead endpoint.
 * Deployed as a Cloudflare Worker at thewayagency.com/api/quote
 *
 * Environment variables (set via wrangler secret):
 *   SAGE_API_URL — e.g. https://sage.thewayagency.com
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
const RATE_LIMIT_MAX = 5;

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

const ALLOWED_FIELDS = [
  'name',
  'firstName',
  'lastName',
  'email',
  'phone',
  'product',
  'lineOfBusiness',
  'source',
  'page',
  'referrer',
  'timestamp',
  'cfToken',
  '_hp_company',
  'city',
  'state',
  'industry',
];

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

    // Content-length check (< 100KB)
    const contentLength = request.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength, 10) > 102400) {
      return Response.json({ error: 'Request body too large' }, { status: 413, headers: cors });
    }

    const sageUrl = env.SAGE_API_URL || 'https://sage.thewayagency.com';

    try {
      // Read body as text first for size validation
      const bodyText = await request.text();
      if (bodyText.length > 102400) {
        return Response.json({ error: 'Request body too large' }, { status: 413, headers: cors });
      }

      // Parse JSON (validates it is valid JSON)
      let data;
      try {
        data = JSON.parse(bodyText);
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: cors });
      }

      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return Response.json({ error: 'Request body must be a JSON object' }, { status: 400, headers: cors });
      }

      // Honeypot check
      if (data._hp_company) {
        return Response.json({ error: 'Verification failed' }, { status: 403, headers: cors });
      }

      // Validate minimum required fields
      const hasName = (data.name && typeof data.name === 'string' && data.name.trim()) ||
        (data.firstName && typeof data.firstName === 'string' && data.firstName.trim() &&
         data.lastName && typeof data.lastName === 'string' && data.lastName.trim());
      const hasContact = (data.email && typeof data.email === 'string' && data.email.trim()) ||
        (data.phone && typeof data.phone === 'string' && data.phone.trim());

      if (!hasName) {
        return Response.json({ error: 'Name (or firstName + lastName) is required' }, { status: 400, headers: cors });
      }
      if (!hasContact) {
        return Response.json({ error: 'Email or phone is required' }, { status: 400, headers: cors });
      }

      // Whitelist allowed fields
      const sanitized = {};
      for (const field of ALLOWED_FIELDS) {
        if (data[field] !== undefined) {
          sanitized[field] = data[field];
        }
      }

      // Forward to sage
      const res = await fetch(`${sageUrl}/api/intake/lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': clientIP,
        },
        body: JSON.stringify(sanitized),
      });

      const result = await res.json();
      return Response.json(result, { status: res.status, headers: cors });
    } catch (err) {
      console.error('Quote worker error:', err);
      return Response.json({ error: 'Failed to submit quote request' }, { status: 502, headers: cors });
    }
  },
};

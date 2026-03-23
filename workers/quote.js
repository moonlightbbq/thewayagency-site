/**
 * Quote Form Worker
 * Forwards quote requests to sage's /api/intake/lead endpoint.
 * Deployed as a Cloudflare Worker at thewayagency.com/api/quote
 *
 * Environment variables (set via wrangler secret):
 *   SAGE_API_URL — e.g. https://sage.thewayagency.com
 */

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, {
        status: 405,
        headers: corsHeaders(),
      });
    }

    const sageUrl = env.SAGE_API_URL || 'https://sage.thewayagency.com';

    try {
      const data = await request.json();

      // Forward to sage
      const res = await fetch(`${sageUrl}/api/intake/lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': request.headers.get('CF-Connecting-IP') || '',
        },
        body: JSON.stringify(data),
      });

      const result = await res.json();
      return Response.json(result, {
        status: res.status,
        headers: corsHeaders(),
      });
    } catch (err) {
      console.error('Quote worker error:', err);
      return Response.json({ error: 'Failed to submit quote request' }, {
        status: 502,
        headers: corsHeaders(),
      });
    }
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

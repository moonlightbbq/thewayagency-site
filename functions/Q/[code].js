/**
 * Tracked QR codes on printed partner kits (owner 2026-11-16).
 *
 *   GET https://thewayagency.com/Q/<code>
 *
 * A printed piece's QR code opens this path. The code (five characters, upper
 * case, no look-alikes) names one partner's print run of one piece. This
 * Cloudflare Pages Function asks SAGE (GET https://sage.thewayagency.com/q/<code>),
 * which counts the scan and answers a 302 to the code's page on this site with
 * ?src=flyer-<code>. That redirect is passed on. The site's attribution.js then
 * keeps the flyer code across the visit and files any lead under it.
 *
 * The printed code never breaks: if SAGE is slow, down or answers anything else,
 * a well-formed code goes to the quote form with its flyer code attached (the
 * lead is still attributed; only the scan count is missed), and a malformed one
 * goes to the home page. The redirect target from SAGE is followed only when it
 * is on this site, so this is not an open redirect.
 *
 * Upper case keeps the printed QR in alphanumeric mode (a smaller code). The
 * path is /Q/ only: Pages _redirects must land on a built page (validate-build
 * 9b), so there is no lower-case alias.
 */

export const SITE = 'https://thewayagency.com';
export const SAGE = 'https://sage.thewayagency.com';
export const CODE_RE = /^[2-9A-HJKMNP-Z]{5}$/;
export const SAGE_TIMEOUT_MS = 2500;

export function fallbackLocation(code) {
  return CODE_RE.test(code) ? `${SITE}/intake/?src=flyer-${code.toLowerCase()}` : `${SITE}/`;
}

/** True when `location` is an absolute https URL on this site. */
export function onSite(location) {
  try {
    const u = new URL(location);
    return u.protocol === 'https:' && (u.hostname === 'thewayagency.com' || u.hostname === 'www.thewayagency.com');
  } catch {
    return false;
  }
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * The location for one request. `fetchImpl` is injectable for tests.
 */
export async function resolve(rawCode, method, fetchImpl = fetch) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return `${SITE}/`;
  try {
    const res = await fetchImpl(`${SAGE}/q/${code}`, {
      method: method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(SAGE_TIMEOUT_MS),
      headers: { 'User-Agent': 'thewayagency-site-qr' },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location && onSite(location)) return location;
  } catch {
    // SAGE unreachable or slow: fall through to the quote form.
  }
  return fallbackLocation(code);
}

export async function onRequest(context) {
  const { request, params } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  return redirect(await resolve(params.code, request.method));
}

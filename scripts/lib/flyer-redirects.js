'use strict';
/**
 * Flyer redirects (Y-76; owner's website brief 11/14, item 3; Y0 design ruling (A)).
 *
 * A printed flyer's QR code opens an existing page with ?src=flyer-XX. Three of
 * them now have pages of their own, so a visit that lands on the old page with
 * that exact code moves to the new page, query string and hash unchanged:
 *
 *   /personal/      ?src=flyer-rv  ->  /personal/rv
 *   /personal/home  ?src=flyer-co  ->  /personal/condo
 *   /personal/      ?src=flyer-ll  ->  /personal/landlord
 *
 * Cloudflare Pages _redirects cannot match a query string, so the two source
 * pages carry a short inline script, first in <head>: it runs before GTM and
 * attribution.js, so the first page records nothing and the target records the
 * landing with its src (and rep, utm_*) intact. location.replace leaves no back
 * button loop.
 *
 * Rules (Y0): the src value must equal a code exactly (case-sensitive, the whole
 * value; no prefix or contains match); the target comes from this table, never
 * from the URL; the script is on these two pages only (tests/flyer-redirects
 * fails on any other page); the build refuses a target page that does not exist.
 * Every other visit to these pages is unchanged.
 */
const fs = require('fs');
const path = require('path');

const FLYER_REDIRECTS = Object.freeze([
  Object.freeze({ from: '/personal/', src: 'flyer-rv', to: '/personal/rv' }),
  Object.freeze({ from: '/personal/home', src: 'flyer-co', to: '/personal/condo' }),
  Object.freeze({ from: '/personal/', src: 'flyer-ll', to: '/personal/landlord' }),
]);

/** The inline script for the page at `pagePath` (its canonical path), or '' when none. */
function flyerRedirectScript(pagePath) {
  const map = {};
  for (const r of FLYER_REDIRECTS) if (r.from === pagePath) map[r.src] = r.to;
  if (!Object.keys(map).length) return '';
  const json = JSON.stringify(map).replace(/</g, '\\u003c');
  return `<script data-flyer-redirect>(function(){try{var m=${json};var q=location.search;var s=new URLSearchParams(q).get('src');if(s!==null&&Object.prototype.hasOwnProperty.call(m,s)){location.replace(m[s]+q+location.hash);}}catch(e){}})();</script>`;
}

/** The built file a site path is served from: /personal/ -> personal/index.html, /personal/rv -> personal/rv.html. */
function builtFileFor(sitePath) {
  const rel = sitePath.replace(/^\//, '');
  return rel.endsWith('/') || rel === '' ? path.join(rel, 'index.html') : `${rel}.html`;
}

/** Throws when a redirect's source or target page is not in the build. */
function assertFlyerPages(buildDir) {
  const missing = [];
  for (const r of FLYER_REDIRECTS) {
    for (const p of [r.from, r.to]) if (!fs.existsSync(path.join(buildDir, builtFileFor(p)))) missing.push(`${p} (${r.src})`);
  }
  if (missing.length) throw new Error(`Flyer redirects: no built page for ${[...new Set(missing)].join(', ')}`);
}

module.exports = { FLYER_REDIRECTS, flyerRedirectScript, builtFileFor, assertFlyerPages };

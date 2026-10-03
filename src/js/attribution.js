/**
 * TWA attribution module — shared between app.js (the build prepends this file
 * into the built app.js, so every page that loads app.js gets window.TWA for
 * free, in guaranteed order) and /intake/, which loads it standalone from a
 * <head> script tag WITHOUT defer (intake's giant inline script runs at parse
 * time and needs TWA to exist already).
 *
 * Owns: first/last-touch cookies (twa_ft / twa_lt), the latest external
 * referral cookie (twa_rl, CONV-05), visitor id (twa_vid),
 * ad-platform cookie ids (_fbp/_fbc/_ga), the A/B assignment hash, sha256, and
 * enhanced-conversion pushes. Functions are moved verbatim from app.js — keep
 * behavior identical; app.js keeps thin wrappers for its internal call sites.
 */
(function () {
  'use strict';
  if (window.TWA) return; // idempotent — double inclusion is harmless

  var DEBUG = /[?&]twa_debug/.test(window.location.search);
  function _log(event, params) {
    if (DEBUG) console.log('%c[TWA:attr] ' + event, 'color:#0891b2;font-weight:bold', params || '');
  }

  // ─── Cookie helpers ───────────────────────────
  // Secure on https (the live site is https-only behind HSTS); a plain-http
  // local build would otherwise drop the cookie.
  function setCookie(name, value, days) {
    document.cookie = name + '=' + encodeURIComponent(JSON.stringify(value)) + ';path=/;max-age=' + (days * 86400) + ';SameSite=Lax'
      + (window.location.protocol === 'https:' ? ';Secure' : '');
  }
  function getCookie(name) {
    var match = document.cookie.match(new RegExp(name + '=([^;]+)'));
    if (!match) return null;
    try { return JSON.parse(decodeURIComponent(match[1])); } catch (e) { return null; }
  }

  // ─── Visitor id ───────────────────────────────
  function getVisitorId() {
    var id;
    try { id = localStorage.getItem('twa_vid'); } catch (e) {}
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem('twa_vid', id); } catch (e) {}
    }
    return id;
  }

  // ─── Ad-platform cookie ids ───────────────────
  function getTrackingIds() {
    function getCookieVal(name) {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    }
    return {
      fbp: getCookieVal('_fbp'),
      fbc: getCookieVal('_fbc') || (function () {
        var fbclid = new URLSearchParams(window.location.search).get('fbclid');
        return fbclid ? 'fb.1.' + Date.now() + '.' + fbclid : '';
      })(),
      ga_client_id: (getCookieVal('_ga') || '').replace(/^GA\d+\.\d+\./, ''),
    };
  }

  // ─── External referral (CONV-05) ──────────────
  // AI assistants by referrer domain. This is SAGE's AI_HOSTS map
  // (sage-server src/services/attribution.js), copied exactly: SAGE files a
  // lead as ai_assistant from the same list. Change the two together.
  var AI_HOSTS = {
    'chatgpt.com': 'chatgpt',
    'chat.openai.com': 'chatgpt',
    'perplexity.ai': 'perplexity',
    'claude.ai': 'claude',
    'gemini.google.com': 'gemini',
    'copilot.microsoft.com': 'copilot',
    'chat.deepseek.com': 'deepseek',
    'grok.com': 'grok',
  };
  var REFERRAL_COOKIE = 'twa_rl';
  var REFERRAL_DAYS = 30; // the twa_lt lifetime: this is a last touch

  function onDomain(host, domain) {
    return host === domain || host.slice(-(domain.length + 1)) === '.' + domain;
  }
  // Lower-case host of a URL or a host-like value, without 'www.'; '' if none.
  function hostOf(value) {
    var v = String(value || '').trim().toLowerCase();
    if (!v) return '';
    try {
      return new URL(v.indexOf('://') !== -1 ? v : 'https://' + v).hostname.replace(/^www\./, '').replace(/\.$/, '');
    } catch (e) { return ''; }
  }
  // The AI assistant a DOMAIN names ('chatgpt.com', a referrer URL on www.perplexity.ai),
  // else ''. A bare name ('perplexity', 'copilot') is never enough: as a
  // utm_source it may be any campaign's label (same rule as SAGE's aiHostOf).
  function aiSourceOfDomain(value) {
    var v = String(value || '').trim().toLowerCase();
    if (v.indexOf('.') === -1) return '';
    var host = hostOf(v);
    if (!host) return '';
    for (var domain in AI_HOSTS) {
      if (Object.prototype.hasOwnProperty.call(AI_HOSTS, domain) && onDomain(host, domain)) return AI_HOSTS[domain];
    }
    return '';
  }
  // Our own pages (any host on the agency's domain, a Pages preview, or the
  // host serving this page) are navigation, not an acquisition source.
  function isInternalHost(host) {
    var self = String(window.location.hostname || '').toLowerCase().replace(/^www\./, '');
    return host === self || onDomain(host, 'thewayagency.com') || onDomain(host, 'thewayagency-site.pages.dev');
  }

  // Writes twa_rl when this landing came from another site (ref_host) or a
  // domain-style utm_source names an AI assistant (ai_source). A landing with
  // neither (direct, internal navigation, a stripped referrer) leaves the
  // stored referral alone, so clicking through to /intake/ never overwrites
  // it. Only the host is kept: the site's Referrer-Policy sends other sites
  // an origin at most, and no prospect data ever goes in the cookie.
  // Campaign UTMs and click ids stay in twa_ft/twa_lt exactly as before, and
  // SAGE's deriveChannel() ranks them above this referral.
  function captureReferral(params) {
    var refHost = hostOf(document.referrer);
    var external = !!refHost && !isInternalHost(refHost);
    var ai = (external ? aiSourceOfDomain(refHost) : '') || aiSourceOfDomain(params.get('utm_source'));
    if (!external && !ai) return null;
    var rt = {};
    if (external) rt.ref_host = refHost.slice(0, 100);
    if (ai) rt.ai_source = ai;
    setCookie(REFERRAL_COOKIE, rt, REFERRAL_DAYS);
    _log('referral_set', rt);
    return rt;
  }

  // The stored referral as clean strings ({} when none or malformed).
  function getReferral() {
    var c = getCookie(REFERRAL_COOKIE);
    var out = {};
    if (!c || typeof c !== 'object') return out;
    var host = typeof c.ref_host === 'string' ? hostOf(c.ref_host).slice(0, 100) : '';
    var ai = typeof c.ai_source === 'string' && /^[a-z]{1,32}$/.test(c.ai_source) ? c.ai_source : '';
    if (host) out.ref_host = host;
    if (ai) out.ai_source = ai;
    return out;
  }

  // ─── Capture attribution from URL ─────────────
  function captureAttribution() {
    var params = new URLSearchParams(window.location.search);
    var utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var touchData = {};
    var hasAttribution = false;

    for (var i = 0; i < utmKeys.length; i++) {
      var val = params.get(utmKeys[i]);
      if (val) { touchData[utmKeys[i]] = val; hasAttribution = true; }
    }

    var gclid = params.get('gclid');
    var fbclid = params.get('fbclid');
    if (gclid) { touchData.gclid = gclid; hasAttribution = true; }
    if (fbclid) { touchData.fbclid = fbclid; hasAttribution = true; }

    var src = params.get('src');
    var agent = params.get('agent');
    if (src) touchData.src = src;
    if (agent) touchData.agent = agent;

    // The first/last-touch cookies keep this for 365/30 days and ride every
    // SAGE submission: never store identity or a token in them (TRUST-08).
    // Capped at 300 characters: a touch value over 500 is cut by SAGE (CONV-05).
    touchData.landing_page = (window.location.pathname + stripSensitive(window.location.search)).slice(0, 300);
    touchData.date = new Date().toISOString().split('T')[0];

    // First-touch: set once, never overwrite (365-day expiry)
    if (hasAttribution && !getCookie('twa_ft')) {
      setCookie('twa_ft', touchData, 365);
      _log('first_touch_set', touchData);
    }
    // Last-touch: overwrite on every visit with attribution (30-day expiry)
    if (hasAttribution) {
      setCookie('twa_lt', touchData, 30);
      _log('last_touch_set', touchData);
    }
    // Latest external referral: its own cookie, so the touches above resolve
    // exactly as before (CONV-05).
    captureReferral(params);

    // Session landing page (set once per session via sessionStorage)
    try {
      if (!sessionStorage.getItem('twa_lp')) {
        sessionStorage.setItem('twa_lp', window.location.pathname);
      }
    } catch (e) { /* private browsing */ }

    return touchData;
  }

  // ─── Full attribution for form submission ─────
  // Shape matches sage's attributionSchema (docs/TECHNICAL-REFERENCE.md):
  // flat last-touch-wins fields + the raw first/last touch objects.
  //
  // ref_host / ai_source (CONV-05): the latest external referral (twa_rl), sent
  // where SAGE's deriveChannel() reads it, as the top-level pair and inside
  // last_touch. It is a last touch only, so first_touch is left as stored.
  // Keys are omitted when there is no referral; the flat fields are unchanged.
  function getAttribution() {
    var ft = getCookie('twa_ft') || {};
    var lt = getCookie('twa_lt') || {};
    var rf = getReferral();
    if (rf.ref_host || rf.ai_source) {
      var ltOut = {};
      for (var k in lt) {
        if (Object.prototype.hasOwnProperty.call(lt, k) && k !== 'ref_host' && k !== 'ai_source') ltOut[k] = lt[k];
      }
      if (rf.ref_host) ltOut.ref_host = rf.ref_host;
      if (rf.ai_source) ltOut.ai_source = rf.ai_source;
      lt = ltOut;
    }
    var lp = window.location.pathname;
    try { lp = sessionStorage.getItem('twa_lp') || lp; } catch (e) { /* private browsing */ }
    var out = {
      first_touch: ft,
      last_touch: lt,
      landing_page: lp,
      referrer: document.referrer || 'direct',
      utm_source: lt.utm_source || ft.utm_source || '',
      utm_medium: lt.utm_medium || ft.utm_medium || '',
      utm_campaign: lt.utm_campaign || ft.utm_campaign || '',
      utm_content: lt.utm_content || ft.utm_content || '',
      utm_term: lt.utm_term || ft.utm_term || '',
      gclid: lt.gclid || ft.gclid || '',
      fbclid: lt.fbclid || ft.fbclid || '',
      src: lt.src || ft.src || '',
      agent: lt.agent || ft.agent || '',
    };
    if (rf.ref_host) out.ref_host = rf.ref_host;
    if (rf.ai_source) out.ai_source = rf.ai_source;
    return out;
  }

  // ─── Privacy guard: identity never rides a URL (TRUST-08) ──────────────
  // GA4, Clarity and the Meta Pixel collect the page URL and the referrer.
  // Keep this list identical to the twa-url-scrub list in src/intake.html
  // <head> (tests/pii-url-guard.test.js compares them).
  var SENSITIVE_PARAMS = ['name', 'first_name', 'last_name', 'email', 'phone', 't', 'token'];
  var PREFILL_KEY = 'twa_inline_prefill';
  var PREFILL_MAX_AGE_MS = 30 * 60 * 1000;

  // Drops the sensitive keys and keeps everything else (utm_*, gclid, src...).
  function stripSensitive(search) {
    var p = new URLSearchParams(search || '');
    for (var i = 0; i < SENSITIVE_PARAMS.length; i++) p.delete(SENSITIVE_PARAMS[i]);
    var s = p.toString();
    return s ? '?' + s : '';
  }

  // Inline quote form -> /intake/. Page context goes in the URL; what the
  // visitor typed goes to this tab's sessionStorage only. Never add identity,
  // a SAGE sessionId or utm_* here: attribution already rides the twa_ft and
  // twa_lt cookies and TWA.getAttribution().
  function buildIntakeHandoff(data, pageSearch) {
    var params = new URLSearchParams();
    if (data.product) params.set('product', data.product);
    var line = data.line || data.lineOfBusiness;
    if (line) params.set('line', line);
    if (data.industry) params.set('industry', data.industry);
    if (data.city) params.set('city', data.city);
    if (data.county) params.set('county', data.county);
    if (data.state) params.set('state', data.state);
    var agent = new URLSearchParams(pageSearch || '').get('agent');
    if (agent) params.set('agent', agent);
    params.set('src', data.src || 'inline');
    return {
      url: '/intake/?' + params.toString(),
      prefill: { name: data.name || '', email: data.email || '', phone: data.phone || '' },
    };
  }

  // Writes the hand-off for the next page in this tab. Returns false when
  // storage is blocked: the caller then navigates without a prefill and never
  // falls back to URL parameters.
  function stashPrefill(prefill) {
    try {
      var rec = { v: 1, at: Date.now() };
      for (var k in prefill) {
        if (Object.prototype.hasOwnProperty.call(prefill, k) && prefill[k]) rec[k] = String(prefill[k]).slice(0, 254);
      }
      sessionStorage.setItem(PREFILL_KEY, JSON.stringify(rec));
      return true;
    } catch (e) { return false; }
  }

  // One-shot: returns the stash (or null) and always removes it.
  function takePrefill() {
    var raw = null;
    try { raw = sessionStorage.getItem(PREFILL_KEY); sessionStorage.removeItem(PREFILL_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var rec = JSON.parse(raw);
      if (!rec || rec.v !== 1 || typeof rec.at !== 'number' || Date.now() - rec.at > PREFILL_MAX_AGE_MS) return null;
      return rec;
    } catch (e) { return null; }
  }

  // ─── A/B assignment ───────────────────────────
  // Uniform split: hash(visitorId:testName) % variantCount. Weights are NOT
  // supported — a weighted rollout must launch as a NEW test name, because
  // changing the hash→variant mapping mid-test re-buckets returning visitors.
  function hashAssign(visitorId, testName, variantCount) {
    var hash = 0;
    var str = visitorId + ':' + testName;
    for (var i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return Math.abs(hash) % variantCount;
  }
  function assignVariant(testName, variantNames) {
    var force = new URLSearchParams(window.location.search).get('force_variant');
    if (force && variantNames.indexOf(force) !== -1) return force;
    return variantNames[hashAssign(getVisitorId(), testName, variantNames.length)];
  }
  function pushExposure(testName, variant) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'ab_exposure', test_name: testName, variant: variant, visitor_id: getVisitorId() });
    _log('ab_exposure', { test_name: testName, variant: variant });
  }

  // ─── SHA-256 hash helper (for PII) ────────────
  async function sha256(str) {
    if (!str || !window.crypto || !window.crypto.subtle) return '';
    var data = new TextEncoder().encode(str.toLowerCase().trim());
    var hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // ─── Enhanced conversions (hashed PII) ────────
  // dataLayer only. No Meta advanced matching of any kind (TRUST-12): Meta's
  // Business Tools Terms bar unhashed contact data, and these forms can carry
  // health and Medicare interest.
  async function pushEnhancedConversion(data) {
    if (!data.email && !data.phone) return;
    var hashed = await Promise.all([
      sha256(data.email || ''),
      sha256((data.phone || '').replace(/\D/g, '')),
      sha256(data.firstName || ''),
      sha256(data.lastName || ''),
    ]);
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'enhanced_conversion',
      enhanced_conversion_data: {
        email: hashed[0],
        phone_number: hashed[1],
        first_name: hashed[2],
        last_name: hashed[3],
        address: {
          postal_code: (data.zip || '').trim(),
          region: (data.state || '').trim(),
          country: 'US',
        },
      },
    });
    _log('enhanced_conversion', { email: '***', phone: '***' });
  }

  window.TWA = {
    setCookie: setCookie,
    getCookie: getCookie,
    getVisitorId: getVisitorId,
    getTrackingIds: getTrackingIds,
    captureAttribution: captureAttribution,
    getAttribution: getAttribution,
    getReferral: getReferral,
    aiSourceOfDomain: aiSourceOfDomain,
    AI_HOSTS: Object.freeze(Object.assign({}, AI_HOSTS)),
    hashAssign: hashAssign,
    assignVariant: assignVariant,
    pushExposure: pushExposure,
    sha256: sha256,
    pushEnhancedConversion: pushEnhancedConversion,
    SENSITIVE_PARAMS: SENSITIVE_PARAMS.slice(),
    stripSensitive: stripSensitive,
    buildIntakeHandoff: buildIntakeHandoff,
    stashPrefill: stashPrefill,
    takePrefill: takePrefill,
  };
})();

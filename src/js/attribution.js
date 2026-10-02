/**
 * TWA attribution module — shared between app.js (the build prepends this file
 * into the built app.js, so every page that loads app.js gets window.TWA for
 * free, in guaranteed order) and /intake/, which loads it standalone from a
 * <head> script tag WITHOUT defer (intake's giant inline script runs at parse
 * time and needs TWA to exist already).
 *
 * Owns: first/last-touch cookies (twa_ft / twa_lt), visitor id (twa_vid),
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
  function setCookie(name, value, days) {
    document.cookie = name + '=' + encodeURIComponent(JSON.stringify(value)) + ';path=/;max-age=' + (days * 86400) + ';SameSite=Lax';
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
    touchData.landing_page = window.location.pathname + stripSensitive(window.location.search);
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
  function getAttribution() {
    var ft = getCookie('twa_ft') || {};
    var lt = getCookie('twa_lt') || {};
    var lp = window.location.pathname;
    try { lp = sessionStorage.getItem('twa_lp') || lp; } catch (e) { /* private browsing */ }
    return {
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

  // ─── Purge pre-fix intake drafts (CONV-08, owner decision D11) ───────
  // Drafts written before the retention change kept name, email, phone,
  // address, date of birth and health answers in localStorage for 7 days.
  // Every page removes any intake draft that is not the current version (v2,
  // allowlisted fields only) or is older than 24 hours, so an old draft does
  // not wait for the next /intake/ visit. Keep in step with src/intake.html.
  (function purgeStaleIntakeDraft() {
    try {
      var raw = localStorage.getItem('twa_intake_draft');
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || d.v !== 2 || !(Date.now() - d.savedAt <= 24 * 60 * 60 * 1000)) localStorage.removeItem('twa_intake_draft');
    } catch (e) { try { localStorage.removeItem('twa_intake_draft'); } catch (e2) { /* storage blocked */ } }
  })();

  window.TWA = {
    setCookie: setCookie,
    getCookie: getCookie,
    getVisitorId: getVisitorId,
    getTrackingIds: getTrackingIds,
    captureAttribution: captureAttribution,
    getAttribution: getAttribution,
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

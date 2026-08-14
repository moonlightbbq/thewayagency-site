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

  var FB_PIXEL_ID = '33110648475215550'; // used for fbq('setUserProperties') only

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

    touchData.landing_page = window.location.pathname + window.location.search;
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
  async function pushEnhancedConversion(data, fbPixelId) {
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
    // Meta Advanced Matching (fbq handles its own hashing)
    if (window.fbq) {
      window.fbq('setUserProperties', fbPixelId || FB_PIXEL_ID, {
        em: (data.email || '').toLowerCase().trim(),
        ph: (data.phone || '').replace(/\D/g, ''),
        fn: (data.firstName || '').toLowerCase().trim(),
        ln: (data.lastName || '').toLowerCase().trim(),
        zp: (data.zip || '').trim(),
        country: 'us',
        external_id: getVisitorId(),
      });
    }
    _log('enhanced_conversion', { email: '***', phone: '***' });
  }

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
  };
})();

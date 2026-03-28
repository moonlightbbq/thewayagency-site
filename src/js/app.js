/* ═══════════════════════════════════════════════
   THE WAY AGENCY  -  Lead Generation Engine
   Version 3.0  -  Production-grade analytics + attribution
   ═══════════════════════════════════════════════ */

(function() {
  'use strict';

  // ═══════════════════════════════════════════════
  // ERROR BOUNDARY & FEATURE DETECTION
  // ═══════════════════════════════════════════════
  var _errorCount = 0;
  var FEATURES = {
    fetch: typeof fetch === 'function',
    localStorage: (function() { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return true; } catch(e) { return false; } })(),
    crypto: !!(window.crypto && window.crypto.subtle),
    intersectionObserver: typeof IntersectionObserver === 'function',
  };

  window.onerror = function(msg, src, line, col, err) {
    if (_errorCount >= 5) return;
    _errorCount++;
    try {
      if (FEATURES.fetch) {
        fetch('https://sage.thewayagency.com/api/errors/client', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: String(msg).slice(0, 500), source: src, line: line, col: col, stack: err && err.stack ? err.stack.slice(0, 1000) : '', url: location.href, ua: navigator.userAgent }),
        }).catch(function() {});
      }
    } catch(e) {}
  };

  window.addEventListener('unhandledrejection', function(e) {
    if (_errorCount >= 5) return;
    _errorCount++;
    var reason = e.reason ? String(e.reason.message || e.reason).slice(0, 500) : 'Unknown';
    try {
      if (FEATURES.fetch) {
        fetch('https://sage.thewayagency.com/api/errors/client', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Unhandled rejection: ' + reason, url: location.href, ua: navigator.userAgent }),
        }).catch(function() {});
      }
    } catch(e) {}
  });

  // Broken image handler
  document.addEventListener('error', function(e) {
    if (e.target.tagName === 'IMG') {
      e.target.outerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:' + (e.target.width || 40) + 'px;height:' + (e.target.height || 40) + 'px;background:#f1f5f9;border-radius:8px;color:#94a3b8;font-size:14px;">&#128247;</span>';
    }
  }, true);

  // Test trigger
  if (new URLSearchParams(location.search).has('twa_test_error')) {
    setTimeout(function() { throw new Error('TWA test error — this is intentional'); }, 100);
  }

  // ─── Configuration ───────────────────────────
  const CONFIG = {
    webhookUrl: 'https://sage.thewayagency.com/api/intake/lead',
    turnstileSiteKey: '0x4AAAAAACuOvP2DfWPQJz9W',
    phone: '(502) 413-5335',
    phoneRaw: '+15024135335',
    email: 'hello@thewayagency.com',
    textNumber: '(502) 413-5335',
    calendarUrl: '',
    // GA4 + Meta Pixel are loaded by GTM (GTM-MCQG9SN3). Do not initialize here.
    // GA4 measurement ID: G-C79ZCDZVPE (configure in GTM, not in code)
    fbPixelId: '33110648475215550', // used for fbq('setUserProperties') only
    debug: new URLSearchParams(window.location.search).has('twa_debug'),
  };

  // ─── Utility ─────────────────────────────────
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function createElement(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    if (children) {
      // WARNING: caller must ensure children is trusted HTML or use textContent
      if (typeof children === 'string') el.innerHTML = children;
      else if (Array.isArray(children)) children.forEach(c => el.appendChild(c));
    }
    return el;
  }

  // ═══════════════════════════════════════════════
  // MULTI-LANGUAGE (i18n)
  // ═══════════════════════════════════════════════
  let _i18nData = null;
  let _i18nOriginals = new Map();
  let _currentLang = 'en';

  function initI18n() {
    const navLinks = $('#navLinks');
    if (!navLinks) return;
    const toggle = createElement('button', {
      id: 'langToggle',
      'aria-label': 'Switch language',
    }, 'EN | <span style="opacity:.5">ES</span>');
    toggle.style.cssText = 'background:none;border:1px solid var(--border,#e2e8f0);border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;color:var(--slate,#64748b);cursor:pointer;margin-left:8px;white-space:nowrap;';
    navLinks.appendChild(toggle);
    toggle.addEventListener('click', () => { switchLang(_currentLang === 'en' ? 'es' : 'en'); });
    try { if (localStorage.getItem('twa_lang') === 'es') switchLang('es'); } catch(e) {}
  }

  async function switchLang(lang) {
    if (lang === 'en') {
      _currentLang = 'en';
      _i18nOriginals.forEach((original, el) => { el.textContent = original; });
      updateLangToggle();
      try { localStorage.setItem('twa_lang', 'en'); } catch(e) {}
      return;
    }
    if (!_i18nData) {
      try {
        const res = await fetch('/data/i18n/es.json');
        if (!res.ok) return;
        _i18nData = await res.json();
      } catch(e) { return; }
    }
    _currentLang = 'es';
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (_i18nData[key]) {
        if (!_i18nOriginals.has(el)) _i18nOriginals.set(el, el.textContent);
        el.textContent = _i18nData[key];
      }
    });
    updateLangToggle();
    try { localStorage.setItem('twa_lang', 'es'); } catch(e) {}
  }

  function updateLangToggle() {
    const t = $('#langToggle');
    if (!t) return;
    t.innerHTML = _currentLang === 'es' ? '<span style="opacity:.5">EN</span> | ES' : 'EN | <span style="opacity:.5">ES</span>';
  }

  // ═══════════════════════════════════════════════
  // A/B TESTING FRAMEWORK
  // ═══════════════════════════════════════════════
  const AB_EXPERIMENTS = {
    'hero-headline': {
      variants: {
        control: { '[data-ab-test="hero-headline"]': null },
        'value-prop': { '[data-ab-test="hero-headline"]': 'Insurance That Actually Fits Your Life' },
        'action-cta': { '[data-ab-test="hero-headline"]': 'Get Covered the Right Way' },
      },
      weight: [50, 25, 25],
    },
    'hero-cta': {
      variants: {
        control: { '[data-ab-test="hero-cta"]': null },
        'free-quote': { '[data-ab-test="hero-cta"]': 'Get a Free Quote' },
        'compare': { '[data-ab-test="hero-cta"]': 'Compare Rates Now' },
      },
      weight: [50, 25, 25],
    },
  };

  function getVisitorId() {
    let id;
    try { id = localStorage.getItem('twa_vid'); } catch(e) {}
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { localStorage.setItem('twa_vid', id); } catch(e) {}
    }
    return id;
  }

  function hashAssign(visitorId, testName, variantCount) {
    let hash = 0;
    const str = visitorId + ':' + testName;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return Math.abs(hash) % variantCount;
  }

  function initABTests() {
    const params = new URLSearchParams(window.location.search);
    const forceVariant = params.get('force_variant');
    const visitorId = getVisitorId();

    Object.entries(AB_EXPERIMENTS).forEach(([testName, config]) => {
      const variantNames = Object.keys(config.variants);
      let chosenIdx;
      if (forceVariant && variantNames.includes(forceVariant)) {
        chosenIdx = variantNames.indexOf(forceVariant);
      } else {
        chosenIdx = hashAssign(visitorId, testName, variantNames.length);
      }
      const chosenName = variantNames[chosenIdx];
      const changes = config.variants[chosenName];

      // Apply DOM changes
      Object.entries(changes).forEach(([selector, newText]) => {
        if (newText === null) return; // control — no change
        const el = document.querySelector(selector);
        if (el) el.textContent = newText;
      });

      // Track exposure
      window.dataLayer = window.dataLayer || [];
      dataLayer.push({ event: 'ab_exposure', test_name: testName, variant: chosenName, visitor_id: visitorId });

      if (CONFIG.debug) _log('AB Test: ' + testName + ' → ' + chosenName);
    });
  }

  // ═══════════════════════════════════════════════
  // ANALYTICS ENGINE (v3 — clean taxonomy)
  // ═══════════════════════════════════════════════

  // ─── Debug logger ─────────────────────────────
  function _log(event, params) {
    if (CONFIG.debug) console.log(`%c[TWA] ${event}`, 'color:#0891b2;font-weight:bold', params || '');
  }

  // ─── Core event dispatch ──────────────────────
  // All tracking goes through dataLayer → GTM handles GA4 forwarding.
  function track(event, params) {
    _log(event, params);
    window.dataLayer = window.dataLayer || [];
    dataLayer.push({ event, ...params });
  }

  // ─── SHA-256 hash helper (for PII) ────────────
  async function sha256(str) {
    if (!str || !window.crypto?.subtle) return '';
    const data = new TextEncoder().encode(str.toLowerCase().trim());
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ═══════════════════════════════════════════════
  // ATTRIBUTION ENGINE
  // ═══════════════════════════════════════════════

  // ─── Cookie helpers ───────────────────────────
  function setCookie(name, value, days) {
    document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};path=/;max-age=${days * 86400};SameSite=Lax`;
  }
  function getCookie(name) {
    const match = document.cookie.match(new RegExp(`${name}=([^;]+)`));
    if (!match) return null;
    try { return JSON.parse(decodeURIComponent(match[1])); } catch(e) { return null; }
  }

  // ─── Capture attribution from URL ─────────────
  function captureAttribution() {
    const params = new URLSearchParams(window.location.search);
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    const touchData = {};
    let hasAttribution = false;

    // UTM params
    for (const key of utmKeys) {
      const val = params.get(key);
      if (val) { touchData[key] = val; hasAttribution = true; }
    }

    // Click IDs (Google Ads, Meta)
    const gclid = params.get('gclid');
    const fbclid = params.get('fbclid');
    if (gclid) { touchData.gclid = gclid; hasAttribution = true; }
    if (fbclid) { touchData.fbclid = fbclid; hasAttribution = true; }

    // Custom params
    const src = params.get('src');
    const agent = params.get('agent');
    if (src) touchData.src = src;
    if (agent) touchData.agent = agent;

    // Landing page
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
    if (!sessionStorage.getItem('twa_lp')) {
      sessionStorage.setItem('twa_lp', window.location.pathname);
    }

    return touchData;
  }

  // ─── Get full attribution for form submission ─
  function getAttribution() {
    const ft = getCookie('twa_ft') || {};
    const lt = getCookie('twa_lt') || {};
    const lp = sessionStorage.getItem('twa_lp') || window.location.pathname;
    return {
      first_touch: ft,
      last_touch: lt,
      landing_page: lp,
      // Flat fields for backward compat with sage formData
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

  // Backward compat wrapper
  function getUTMParams() { return getAttribution(); }

  // ═══════════════════════════════════════════════
  // PAGE TYPE DETECTION (for remarketing + context)
  // ═══════════════════════════════════════════════
  function detectPageType() {
    const path = window.location.pathname;
    if (path === '/') return 'homepage';
    if (path.startsWith('/intake')) return 'quote_form';
    if (path.startsWith('/personal/')) return 'product_personal';
    if (path.startsWith('/commercial/')) return 'product_commercial';
    if (path.startsWith('/life-health/')) return 'product_life_health';
    if (path.startsWith('/blog/')) return path === '/blog/' ? 'blog_index' : 'blog_post';
    if (path.startsWith('/insurance/')) return 'geo_landing';
    if (path.startsWith('/industries/')) return 'industry_landing';
    if (path.startsWith('/about')) return 'about';
    if (path === '/contact.html') return 'contact';
    return 'other';
  }

  // ═══════════════════════════════════════════════
  // ENHANCED CONVERSIONS (hashed PII)
  // ═══════════════════════════════════════════════
  async function pushEnhancedConversion(data) {
    if (!data.email && !data.phone) return;

    // Hash PII client-side before pushing to dataLayer
    const [hashedEmail, hashedPhone, hashedFn, hashedLn] = await Promise.all([
      sha256(data.email || ''),
      sha256((data.phone || '').replace(/\D/g, '')),
      sha256(data.firstName || ''),
      sha256(data.lastName || ''),
    ]);

    window.dataLayer = window.dataLayer || [];
    dataLayer.push({
      event: 'enhanced_conversion',
      enhanced_conversion_data: {
        email: hashedEmail,
        phone_number: hashedPhone,
        first_name: hashedFn,
        last_name: hashedLn,
        address: {
          postal_code: (data.zip || '').trim(),
          region: (data.state || '').trim(),
          country: 'US',
        },
      },
    });

    // Meta Advanced Matching (fbq handles its own hashing)
    if (window.fbq) {
      fbq('setUserProperties', CONFIG.fbPixelId, {
        em: (data.email || '').toLowerCase().trim(),
        ph: (data.phone || '').replace(/\D/g, ''),
        fn: (data.firstName || '').toLowerCase().trim(),
        ln: (data.lastName || '').toLowerCase().trim(),
        zp: (data.zip || '').trim(),
        country: 'us',
      });
    }
    _log('enhanced_conversion', { email: '***', phone: '***' });
  }

  // ═══════════════════════════════════════════════
  // CONVERSION EVENTS
  // ═══════════════════════════════════════════════
  function fireConversion(type, data) {
    window.dataLayer = window.dataLayer || [];
    // Google Ads conversion (configure conversion ID/label in GTM)
    dataLayer.push({
      event: 'conversion',
      conversion_type: type,
      conversion_value: data.value || 0,
      conversion_products: data.products || '',
      conversion_reference: data.reference || '',
      conversion_source: data.source || '',
    });
    // Meta conversion events
    if (window.fbq) {
      if (type === 'quote_request') {
        fbq('track', 'Lead', { content_name: data.products, content_category: 'quote', value: data.value || 0, currency: 'USD' });
      } else if (type === 'contact_form') {
        fbq('track', 'Contact', { content_name: 'contact_form' });
      } else if (type === 'phone_call') {
        fbq('track', 'Contact', { content_name: 'phone_call' });
      }
    }
    _log('conversion', { type, ...data });
  }

  // ─── Turnstile Helper ───────────────────────
  function getTurnstileToken() {
    return new Promise((resolve) => {
      if (!CONFIG.turnstileSiteKey || !window.turnstile) { resolve(''); return; }
      const container = document.createElement('div');
      container.style.display = 'none';
      document.body.appendChild(container);
      window.turnstile.render(container, {
        sitekey: CONFIG.turnstileSiteKey,
        size: 'invisible',
        callback: (token) => { container.remove(); resolve(token); },
        'error-callback': () => { container.remove(); resolve(''); },
        'expired-callback': () => { container.remove(); resolve(''); },
      });
    });
  }

  // ═══════════════════════════════════════════════
  // FORM SUBMISSION HANDLER
  // ═══════════════════════════════════════════════
  async function submitLead(data, source) {
    data.timestamp = new Date().toISOString();
    data.source = source || 'website';
    data.page = window.location.pathname;
    data.referrer = document.referrer || 'direct';

    // Attach full attribution data
    const attr = getAttribution();
    data.utm = attr;
    // Flatten key fields for sage compat
    if (attr.utm_source) data.utm_source = attr.utm_source;
    if (attr.utm_medium) data.utm_medium = attr.utm_medium;
    if (attr.utm_campaign) data.utm_campaign = attr.utm_campaign;
    if (attr.gclid) data.gclid = attr.gclid;
    if (attr.fbclid) data.fbclid = attr.fbclid;

    if (CONFIG.turnstileSiteKey) {
      data.cfToken = await getTurnstileToken();
    }

    // Fire conversion + enhanced conversion
    const convType = source === 'contact-form' ? 'contact_form' : 'quote_request';
    track(convType === 'contact_form' ? 'lead_contact_submitted' : 'lead_quote_submitted', { category: 'conversion', source, products: data.product || '' });
    pushEnhancedConversion({ email: data.email, phone: data.phone, firstName: data.firstName || data.name, lastName: data.lastName });
    fireConversion(convType, { products: data.product || '', source });

    if (CONFIG.webhookUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(CONFIG.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const result = await res.json();
        if (result.sessionId) {
          try { localStorage.setItem('twa_last_session', result.sessionId); } catch(e) {}
        }
        return result;
      } catch (err) {
        clearTimeout(timeout);
        console.error('[TWA] Submission error:', err);
        return { ok: false, error: 'submission_failed' };
      }
    }
    return { ok: true };
  }

  // ═══════════════════════════════════════════════
  // 1. NAVIGATION
  // ═══════════════════════════════════════════════
  function initNav() {
    const toggle = $('#navToggle');
    const links = $('#navLinks');
    const nav = $('#nav');
    if (!toggle || !links) return;

    toggle.addEventListener('click', () => {
      links.classList.toggle('nav__links--open');
      toggle.setAttribute('aria-expanded', links.classList.contains('nav__links--open'));
    });

    window.addEventListener('scroll', () => {
      if (nav) nav.classList.toggle('nav--scrolled', window.scrollY > 10);
    }, { passive: true });

    $$('.nav__dropdown > .nav__link').forEach(link => {
      link.setAttribute('aria-expanded', 'false');
      link.addEventListener('click', (e) => {
        if (window.innerWidth <= 968) {
          e.preventDefault();
          const isOpen = link.parentElement.classList.toggle('nav__dropdown--open');
          link.setAttribute('aria-expanded', isOpen);
        }
      });
      // Keyboard: Enter/Space opens, Escape closes, ArrowDown moves into menu
      link.addEventListener('keydown', (e) => {
        const dropdown = link.parentElement;
        const menu = dropdown.querySelector('.nav__dropdown-menu');
        if (!menu) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          dropdown.classList.add('nav__dropdown--open');
          link.setAttribute('aria-expanded', 'true');
          const firstItem = menu.querySelector('.nav__dropdown-item');
          if (firstItem) firstItem.focus();
        }
        if (e.key === 'Escape') {
          dropdown.classList.remove('nav__dropdown--open');
          link.setAttribute('aria-expanded', 'false');
          link.focus();
        }
      });
    });

    // Keyboard nav within dropdown menus
    $$('.nav__dropdown-menu').forEach(menu => {
      menu.addEventListener('keydown', (e) => {
        const items = Array.from(menu.querySelectorAll('.nav__dropdown-item'));
        const idx = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' && idx < items.length - 1) { e.preventDefault(); items[idx + 1].focus(); }
        if (e.key === 'ArrowUp' && idx > 0) { e.preventDefault(); items[idx - 1].focus(); }
        if (e.key === 'Escape') {
          const parentLink = menu.parentElement.querySelector('.nav__link');
          menu.parentElement.classList.remove('nav__dropdown--open');
          if (parentLink) { parentLink.setAttribute('aria-expanded', 'false'); parentLink.focus(); }
        }
      });
    });

    // Track nav link clicks (Phase 2: CRO measurement)
    $$('.nav__dropdown-item, .nav__link').forEach(link => {
      link.addEventListener('click', () => {
        track('nav_click', {
          category: 'engagement',
          link_text: link.textContent.trim().slice(0, 40),
          destination: link.getAttribute('href') || '',
        });
      });
    });
  }

  // ═══════════════════════════════════════════════
  // 2. FAQ ACCORDION
  // ═══════════════════════════════════════════════
  function initFAQ() {
    $$('.faq-item__question').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.parentElement;
        const isOpen = item.classList.contains('faq-item--open');
        $$('.faq-item').forEach(i => i.classList.remove('faq-item--open'));
        $$('.faq-item__question').forEach(b => b.setAttribute('aria-expanded', 'false'));
        if (!isOpen) {
          item.classList.add('faq-item--open');
          btn.setAttribute('aria-expanded', 'true');
          // Track FAQ open (Phase 2: CRO measurement)
          const questionText = (btn.querySelector('h3') || btn).textContent.trim().slice(0, 80);
          track('faq_open', {
            category: 'engagement',
            question_text: questionText,
            page_path: window.location.pathname,
          });
        }
      });
    });
  }

  // ═══════════════════════════════════════════════
  // 3. INLINE QUOTE FORMS (Product Pages)
  // ═══════════════════════════════════════════════
  function initInlineForms() {
    $$('.inline-quote-form').forEach(form => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        track('lead_quote_submitted', { category: 'conversion', source: 'inline-product-form', products: data.product || '' });

        const params = new URLSearchParams();
        if (data.product) params.set('product', data.product);
        if (data.lineOfBusiness) params.set('line', data.lineOfBusiness);
        if (data.name) params.set('name', data.name);
        if (data.email) params.set('email', data.email);
        if (data.phone) params.set('phone', data.phone);
        if (data.industry) params.set('industry', data.industry);
        const pageAgent = new URLSearchParams(window.location.search).get('agent');
        if (pageAgent) params.set('agent', pageAgent);
        params.set('src', 'inline');

        window.location.href = '/intake/?' + params.toString();
      });
    });
  }

  // ═══════════════════════════════════════════════
  // 4. STICKY MOBILE CTA BAR
  // ═══════════════════════════════════════════════
  function getIntakeUrl() {
    const path = window.location.pathname;
    const productMatch = path.match(/\/(personal|commercial|life-health)\/([^/]+)\.html$/);
    if (productMatch && productMatch[2] !== 'index') {
      const slug = productMatch[2];
      const slugMap = { 'home': 'homeowners', 'general-liability': 'cgl', 'commercial-auto': 'commercial_auto',
        'commercial-property': 'bop', 'workers-compensation': 'workers_comp', 'professional-liability': 'eo',
        'builders-risk': 'builders_risk', 'special-event': 'bop', 'classic-car': 'auto',
        'farm-ranch': 'farm_ranch', 'dwelling-fire': 'dwelling_fire', 'term-life': 'life',
        'whole-life': 'life', 'final-expense': 'life', 'family-health': 'life',
        'individual-health': 'life', 'group-health': 'life', 'supplemental-health': 'life',
        'dental-vision': 'life', 'disability': 'life', 'medicare': 'life', 'medicaid': 'life', 'annuities': 'life' };
      const pid = slugMap[slug] || slug;
      return '/intake/?product=' + encodeURIComponent(pid);
    }
    if (path.match(/\/personal\/?$/)) return '/intake/?line=personal';
    if (path.match(/\/commercial\/?$/)) return '/intake/?line=commercial';
    if (path.match(/\/life-health\/?$/)) return '/intake/?line=life-health';
    const geoMatch = path.match(/\/insurance\/([^/]+)\.html$/);
    if (geoMatch) {
      const parts = geoMatch[1].split('-');
      const state = parts.pop().toUpperCase();
      const city = parts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return '/intake/?city=' + encodeURIComponent(city) + '&state=' + encodeURIComponent(state);
    }
    const indMatch = path.match(/\/industries\/([^/]+)\.html$/);
    if (indMatch) return '/intake/?line=commercial&industry=' + encodeURIComponent(indMatch[1]);
    return '/intake/';
  }

  function initStickyMobileCTA() {
    if (window.innerWidth > 768) return;
    const isIntake = window.location.pathname.startsWith('/intake');

    if (isIntake) {
      // On intake page: floating "Call for Help" button
      const style = document.createElement('style');
      style.textContent = '.intake-call-fab{display:flex;align-items:center;gap:6px;position:fixed;bottom:20px;right:16px;z-index:900;background:var(--blue);color:#fff;padding:12px 18px;border-radius:28px;font-size:13px;font-weight:600;text-decoration:none;box-shadow:0 4px 16px rgba(26,111,181,.35);transition:background .2s,transform .2s}.intake-call-fab:hover{background:var(--navy);transform:scale(1.04)}.intake-call-fab svg{flex-shrink:0}';
      document.head.appendChild(style);
      const fab = createElement('a', {
        href: 'tel:' + CONFIG.phoneRaw,
        id: 'intakeCallFab',
        class: 'intake-call-fab',
      }, `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg>
        Call for Help
      `);
      document.body.appendChild(fab);
      fab.addEventListener('click', () => {
        track('intake_call_fab_click', { category: 'conversion', page_path: window.location.pathname });
      });
      return;
    }

    // Non-intake pages: sticky bottom bar with Call Now + Get a Quote
    const intakeUrl = getIntakeUrl();
    const bar = createElement('div', { id: 'stickyMobileCTA', class: 'sticky-cta' }, `
      <a href="tel:${CONFIG.phoneRaw}" class="sticky-cta__link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg>
        Call Now
      </a>
      <a href="${intakeUrl}" class="sticky-cta__link sticky-cta__link--primary">
        Get a Quote
      </a>
    `);
    document.body.appendChild(bar);
    let shown = false;
    window.addEventListener('scroll', () => {
      const shouldShow = window.scrollY > 400;
      if (shouldShow && !shown) { bar.classList.add('sticky-cta--visible'); shown = true; }
      else if (!shouldShow && shown) { bar.classList.remove('sticky-cta--visible'); shown = false; }
    }, { passive: true });
    document.body.style.paddingBottom = '64px';
  }

  // ═══════════════════════════════════════════════
  // 5. EXIT INTENT POPUP
  // ═══════════════════════════════════════════════
  function initExitIntent() {
    if (window.innerWidth < 768) return;
    if (window.location.pathname.startsWith('/intake')) return;
    if (sessionStorage.getItem('twa_exit_shown')) return;
    if (getCookie('twa_exit_dismissed')) return;
    try { if (localStorage.getItem('twa_intake_submitted')) return; } catch(e) {}
    let shown = false;
    document.addEventListener('mouseout', (e) => {
      if (shown) return;
      if (e.clientY < 10 && e.relatedTarget === null) {
        shown = true;
        sessionStorage.setItem('twa_exit_shown', '1');
        showExitPopup();
      }
    });
  }

  function showExitPopup() {
    const overlay = createElement('div', { id: 'exitOverlay', class: 'exit-overlay' }, `
      <div class="exit-popup">
        <button id="exitClose" class="exit-popup__close" aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h3 class="exit-popup__title">Before you go...</h3>
        <p class="exit-popup__desc">Get a free insurance quote in under 2 minutes. No obligation, no spam.</p>
        <a href="/intake/?src=exit-intent" id="exitCta" class="exit-popup__submit" style="display:block;text-align:center;text-decoration:none;">Get My Quote</a>
        <button id="exitDismiss" style="background:none;border:none;color:var(--slate,#64748b);font-size:13px;cursor:pointer;padding:8px;margin-top:4px;width:100%;text-align:center;">No thanks</button>
      </div>
    `);

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('exit-overlay--visible'));

    function closeExit() {
      overlay.classList.remove('exit-overlay--visible');
      setCookie('twa_exit_dismissed', true, 1);
      setTimeout(() => overlay.remove(), 300);
    }
    $('#exitClose').addEventListener('click', closeExit);
    $('#exitDismiss').addEventListener('click', closeExit);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeExit(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { closeExit(); document.removeEventListener('keydown', onEsc); }
    });

    $('#exitCta').addEventListener('click', () => {
      track('exit_intent_clicked', { category: 'conversion', page_path: window.location.pathname });
    });

    track('exit_intent_shown', { category: 'engagement', page_path: window.location.pathname });
  }

  // ═══════════════════════════════════════════════
  // 6. CLICK TRACKING (calls, texts, emails, CTAs)
  // ═══════════════════════════════════════════════
  function initClickTracking() {
    $$('a[href^="tel:"]').forEach(el => {
      el.addEventListener('click', () => {
        track('lead_phone_call', { category: 'conversion', page_path: window.location.pathname });
        track('phone_click', { category: 'conversion', page_path: window.location.pathname, link_text: el.textContent.trim().slice(0, 30), position: getElementPosition(el) });
        fireConversion('phone_call', { source: window.location.pathname });
      });
    });
    $$('a[href^="sms:"]').forEach(el => {
      el.addEventListener('click', () => {
        track('lead_phone_text', { category: 'conversion', page_path: window.location.pathname });
      });
    });
    $$('a[href^="mailto:"]').forEach(el => {
      el.addEventListener('click', () => {
        track('lead_email_click', { category: 'conversion', page_path: window.location.pathname });
      });
    });
    // CTA click tracking with position context (Phase 2)
    $$('a[href*="/intake"], .btn--primary, .btn-primary').forEach(el => {
      el.addEventListener('click', () => {
        track('cta_click', {
          category: 'engagement',
          cta_text: el.textContent.trim().slice(0, 50),
          page_path: window.location.pathname,
          destination: el.getAttribute('href') || '',
          position: getElementPosition(el),
        });
      });
    });
  }

  // Determine element position on page (hero, body, footer, sidebar)
  function getElementPosition(el) {
    const rect = el.getBoundingClientRect();
    const scrollY = window.scrollY + rect.top;
    const pageHeight = document.body.scrollHeight;
    if (scrollY < 600) return 'hero';
    if (scrollY > pageHeight - 500) return 'footer';
    // Check if it's in a CTA banner
    if (el.closest('.cta-banner')) return 'cta_banner';
    if (el.closest('.inline-quote-section')) return 'inline_form';
    return 'body';
  }

  // ═══════════════════════════════════════════════
  // 7. MULTI-STEP QUOTE WIZARD
  // ═══════════════════════════════════════════════
  function initQuoteWizard() {
    const form = $('#quoteWizard');
    if (!form) return;

    const steps = $$('.wizard-step', form);
    const progressDots = $$('.wizard-dot');
    let currentStep = 0;

    function showStep(n) {
      steps.forEach((s, i) => s.style.display = i === n ? 'block' : 'none');
      progressDots.forEach((d, i) => {
        d.classList.toggle('wizard-dot--active', i === n);
        d.classList.toggle('wizard-dot--done', i < n);
      });
      currentStep = n;
      track('intake_step_view', { category: 'funnel', step_number: n + 1, step_name: 'wizard_step_' + (n + 1) });
    }

    $$('.wizard-next', form).forEach(btn => {
      btn.addEventListener('click', () => {
        const currentFields = $$('input[required], select[required]', steps[currentStep]);
        let valid = true;
        currentFields.forEach(f => {
          if (!f.value.trim()) { f.style.borderColor = 'var(--error)'; valid = false; }
          else { f.style.borderColor = 'var(--border)'; }
        });
        if (valid && currentStep < steps.length - 1) showStep(currentStep + 1);
      });
    });
    $$('.wizard-back', form).forEach(btn => {
      btn.addEventListener('click', () => { if (currentStep > 0) showStep(currentStep - 1); });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button[type="submit"]');
      btn.textContent = 'Sending...'; btn.disabled = true;
      const result = await submitLead(data, 'quote-wizard');
      if (result && result.ok === false) {
        btn.textContent = 'Send Quote Request'; btn.disabled = false;
        form.insertAdjacentHTML('afterbegin', '<p style="color:var(--error);font-size:var(--text-sm);margin-bottom:var(--space-md);">Something went wrong. Please try again or call us at ' + CONFIG.phone + '.</p>');
        return;
      }
      form.innerHTML = `
        <div style="text-align:center;padding:var(--space-3xl) 0;">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" style="margin:0 auto var(--space-lg);">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <h2 style="margin-bottom:var(--space-md);">Quote request received</h2>
          <p style="color:var(--slate);font-size:var(--text-lg);font-weight:300;max-width:480px;margin:0 auto var(--space-lg);">
            A licensed agent will follow up within one business day (Mon–Fri, 8:30 AM – 5:00 PM).
          </p>
          <p style="color:var(--slate);font-size:var(--text-sm);">
            Prefer to talk now? <a href="tel:${CONFIG.phoneRaw}" style="font-weight:600;">Call ${CONFIG.phone}</a> or <a href="sms:${CONFIG.phoneRaw}" style="font-weight:600;">text us</a>.
          </p>
        </div>`;
    });
    showStep(0);
  }

  // ═══════════════════════════════════════════════
  // 8. MAIN QUOTE PAGE FORM (backwards compat)
  // ═══════════════════════════════════════════════
  function initMainQuoteForm() {
    const form = $('#quoteForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const required = $$('[required]', form);
      let valid = true;
      required.forEach(input => {
        if (!input.value.trim()) { input.style.borderColor = 'var(--error)'; valid = false; }
        else { input.style.borderColor = 'var(--border)'; }
      });
      if (!valid) return;
      const data = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button[type="submit"]');
      btn.textContent = 'Sending...'; btn.disabled = true;
      const result = await submitLead(data, 'main-quote-form');
      if (result && result.ok === false) {
        btn.textContent = 'Send'; btn.disabled = false;
        form.insertAdjacentHTML('afterbegin', '<p style="color:var(--error);font-size:var(--text-sm);margin-bottom:var(--space-md);">Something went wrong. Please try again or call us at ' + CONFIG.phone + '.</p>');
        return;
      }
      form.style.display = 'none';
      const success = $('#quoteSuccess');
      if (success) success.style.display = 'block';
    });
  }

  // ═══════════════════════════════════════════════
  // 9. CONTACT FORM
  // ═══════════════════════════════════════════════
  function initContactForm() {
    const form = $('#contactForm');
    if (!form) return;

    const phoneInput = form.querySelector('[name="phone"]');
    if (phoneInput) {
      phoneInput.addEventListener('input', () => {
        let digits = phoneInput.value.replace(/\D/g, '').slice(0, 10);
        if (digits.length >= 7) phoneInput.value = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
        else if (digits.length >= 4) phoneInput.value = `(${digits.slice(0,3)}) ${digits.slice(3)}`;
        else if (digits.length > 0) phoneInput.value = `(${digits}`;
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.querySelectorAll('.field-error').forEach(el => el.remove());
      let hasError = false;
      function showError(field, msg) {
        hasError = true;
        const el = form.querySelector(`[name="${field}"]`);
        if (el) { el.style.borderColor = 'var(--error)'; el.insertAdjacentHTML('afterend', `<p class="field-error" style="color:var(--error);font-size:12px;margin:4px 0 0;">${msg}</p>`); }
      }
      const data = Object.fromEntries(new FormData(form));
      form.querySelectorAll('input, textarea, select').forEach(el => el.style.borderColor = '');
      if (!data.firstName || !data.firstName.trim()) showError('firstName', 'First name is required');
      if (!data.lastName || !data.lastName.trim()) showError('lastName', 'Last name is required');
      if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) showError('email', 'Please enter a valid email address');
      const phoneDigits = (data.phone || '').replace(/\D/g, '');
      if (phoneDigits.length < 10) showError('phone', 'Please enter a valid 10-digit phone number');
      if (hasError) return;

      const btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; }
      const result = await submitLead(data, 'contact-form');
      if (result && result.ok === false) {
        if (btn) { btn.textContent = 'Send Message'; btn.disabled = false; }
        form.insertAdjacentHTML('afterbegin', '<p style="color:var(--error);font-size:var(--text-sm);margin-bottom:var(--space-md);">Something went wrong. Please try again or call us at ' + CONFIG.phone + '.</p>');
        return;
      }
      form.innerHTML = '<div style="text-align:center;padding:var(--space-2xl) 0;"><p style="font-weight:600;color:var(--navy);font-size:var(--text-xl);">Message sent!</p><p style="color:var(--slate);margin-top:8px;">We\'ll respond within 1 business day.</p></div>';
    });
  }

  // ═══════════════════════════════════════════════
  // 10. ANALYTICS INIT (GTM is the single owner of GA4 + Meta Pixel loading)
  // ═══════════════════════════════════════════════
  // GTM (GTM-MCQG9SN3) loads via shared-templates.js in <head>.
  // GTM owns: GA4 tag (G-C79ZCDZVPE), Meta Pixel (33110648475215550), pageviews.
  // This file only: pushes structured events to dataLayer, calls fbq() for conversions.
  function initAnalytics() {
    window.dataLayer = window.dataLayer || [];
    // Provide gtag helper for event dispatch (GTM loads the gtag.js library)
    if (!window.gtag) {
      window.gtag = function() { dataLayer.push(arguments); };
    }

    // Capture attribution (Phase 3)
    captureAttribution();

    // Push page context (Phase 5: reporting foundation)
    const attr = getAttribution();
    dataLayer.push({
      event: 'page_context',
      page_type: detectPageType(),
      page_path: window.location.pathname,
      page_referrer: document.referrer || 'direct',
      device_type: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop',
      utm: attr,
      first_touch: attr.first_touch,
      last_touch: attr.last_touch,
      landing_page: attr.landing_page,
    });
  }

  // ═══════════════════════════════════════════════
  // 11. TESTIMONIAL PLACEMENT
  // ═══════════════════════════════════════════════
  function initFormTestimonials() {
    $$('.form-social-proof').forEach(container => {
      container.innerHTML = `
        <a href="https://g.page/r/CSHCy85xJ8VOEBM/review" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:var(--white);border:1px solid var(--border);border-radius:var(--border-radius);text-decoration:none;color:var(--charcoal);font-size:var(--text-sm);font-weight:500;margin-bottom:12px;">
          <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          <span style="display:flex;align-items:center;gap:4px;"><strong style="color:var(--navy);">5.0</strong> <span style="color:#FBBC05;">&#9733;&#9733;&#9733;&#9733;&#9733;</span> <span style="color:var(--slate);">(22 reviews)</span></span>
        </a>
        <p style="font-size:13px;color:var(--slate);font-weight:300;font-style:italic;line-height:1.6;margin:0;">
          "Finding Rebecca has been such a blessing! Not only did she save me a ton of money but she also doubled my coverage. Apparently buying online was not as smart as I thought it was."
          <span style="font-weight:500;color:var(--navy);display:block;margin-top:4px;font-style:normal;"> -  Lisa M., Owensboro</span>
        </p>`;
    });
  }

  // ═══════════════════════════════════════════════
  // 12. SCROLL ANIMATIONS
  // ═══════════════════════════════════════════════
  function initScrollAnimations() {
    if (FEATURES.intersectionObserver) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) { entry.target.classList.add('animate-in'); observer.unobserve(entry.target); }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
      $$('.card, .step, .testimonial-card, .section-header, .lob-card').forEach(el => {
        // Skip cards inside blog/product article content — they break grid layout
        if (el.closest('.product-content, .blog-content')) return;
        el.style.opacity = '0'; el.style.transform = 'translateY(20px)'; el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(el);
      });
    }
  }

  const animStyle = document.createElement('style');
  animStyle.textContent = `.animate-in { opacity: 1 !important; transform: translateY(0) !important; }
    @media (prefers-reduced-motion: reduce) { .card, .step, .testimonial-card, .section-header, .lob-card { opacity: 1 !important; transform: none !important; transition: none !important; } }`;
  document.head.appendChild(animStyle);

  // ═══════════════════════════════════════════════
  // 13. ENGAGEMENT ANALYTICS
  // ═══════════════════════════════════════════════
  function initEngagementTracking() {

    // Scroll depth (25/50/75/100%)
    const scrollThresholds = [25, 50, 75, 100];
    const scrollFired = new Set();
    window.addEventListener('scroll', () => {
      const pct = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
      for (const t of scrollThresholds) {
        if (pct >= t && !scrollFired.has(t)) {
          scrollFired.add(t);
          track('scroll_depth', { category: 'engagement', threshold: t, page_path: window.location.pathname });
        }
      }
    }, { passive: true });

    // Time on page (15s/30s/60s/120s/300s)
    const timeThresholds = [15, 30, 60, 120, 300];
    const timeFired = new Set();
    const pageStart = Date.now();
    setInterval(() => {
      const elapsed = Math.round((Date.now() - pageStart) / 1000);
      for (const t of timeThresholds) {
        if (elapsed >= t && !timeFired.has(t)) {
          timeFired.add(t);
          track('time_on_page', { category: 'engagement', threshold: t, page_path: window.location.pathname });
        }
      }
    }, 5000);

    // Blog CTA tracking (Phase 2)
    if (detectPageType() === 'blog_post') {
      $$('.cta-banner a, .product-content a[href*="/intake"]').forEach(el => {
        el.addEventListener('click', () => {
          const slug = window.location.pathname.replace('/blog/', '').replace('.html', '');
          track('blog_cta_click', { category: 'engagement', blog_slug: slug, cta_text: el.textContent.trim().slice(0, 50), destination: el.getAttribute('href') || '' });
        });
      });
    }

    // CTA visibility tracking via IntersectionObserver
    const ctaVisibleFired = new Set();
    const ctaObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const id = el.id || el.textContent.trim().slice(0, 30);
        if (ctaVisibleFired.has(id)) return;
        ctaVisibleFired.add(id);
        track('cta_visible', {
          category: 'engagement',
          cta_text: el.textContent.trim().slice(0, 50),
          page_path: window.location.pathname,
          position: getElementPosition(el),
        });
      });
    }, { threshold: 0.5 });
    $$('.cta-banner, .btn--primary, .btn-primary, a[href*="/intake"]').forEach(el => ctaObserver.observe(el));
  }

  // ═══════════════════════════════════════════════
  // 14. TESTIMONIAL CAROUSEL
  // ═══════════════════════════════════════════════
  function renderStars(rating) {
    return '<span style="color:#FBBC05;font-size:14px;">' + '&#9733;'.repeat(Math.min(rating || 5, 5)) + '</span>';
  }

  function renderTestimonialCard(t) {
    const products = (t.product_lines || t.products || []).slice(0, 2).map(function(p) {
      return '<span style="display:inline-block;font-size:10px;padding:2px 8px;background:#eff6ff;color:#1e3a8a;border-radius:4px;font-weight:500;">' + (p.charAt(0).toUpperCase() + p.slice(1)).replace(/_/g, ' ') + '</span>';
    }).join(' ');
    return '<div class="twa-testimonial-card" style="background:var(--white,#fff);border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.06);min-width:280px;flex:1;">' +
      '<div style="margin-bottom:8px;">' + renderStars(t.rating) + '</div>' +
      '<p style="font-size:14px;color:var(--charcoal,#1e293b);line-height:1.7;margin-bottom:12px;font-style:italic;font-weight:300;">"' + (t.text || '') + '"</p>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;">' +
      '<span style="font-size:13px;font-weight:600;color:var(--navy,#173358);">' + (t.name || '') + '</span>' +
      (products ? '<div style="display:flex;gap:4px;">' + products + '</div>' : '') +
      '</div></div>';
  }

  function initTestimonialCarousel(selector, opts) {
    var containers = $$(selector);
    if (!containers.length) return;
    var options = opts || {};
    var filter = options.filter || null;
    var mode = options.mode || 'carousel';
    var autoAdvance = options.autoAdvance !== false;

    containers.forEach(function(container) {
      var dataAttr = container.getAttribute('data-testimonials');
      var items;
      try { items = dataAttr ? JSON.parse(dataAttr) : null; } catch(e) { items = null; }
      if (!items || !items.length) return;

      if (filter) {
        items = items.filter(function(t) {
          var lines = t.product_lines || [];
          var prods = t.products || [];
          return lines.indexOf(filter) !== -1 || prods.indexOf(filter) !== -1;
        });
      }
      if (!items.length) return;

      if (mode === 'grid') {
        container.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">' +
          items.map(renderTestimonialCard).join('') + '</div>';
        return;
      }

      if (mode === 'single') {
        container.innerHTML = renderTestimonialCard(items[0]);
        return;
      }

      // Carousel mode
      var perPage = window.innerWidth < 768 ? 1 : 3;
      var page = 0;
      var totalPages = Math.ceil(items.length / perPage);

      function renderCarouselPage() {
        var start = page * perPage;
        var pageItems = items.slice(start, start + perPage);
        var cardsHtml = pageItems.map(renderTestimonialCard).join('');
        container.querySelector('.twa-carousel-track').innerHTML = cardsHtml;
      }

      container.innerHTML =
        '<div style="position:relative;">' +
        '<div class="twa-carousel-track" style="display:flex;gap:16px;transition:opacity .3s;"></div>' +
        (totalPages > 1 ? '<div style="display:flex;justify-content:center;align-items:center;gap:16px;margin-top:16px;">' +
        '<button class="twa-carousel-prev" aria-label="Previous" style="background:none;border:1px solid var(--border,#e2e8f0);border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:16px;color:var(--slate,#64748b);">&#8249;</button>' +
        '<span class="twa-carousel-dots" style="display:flex;gap:6px;"></span>' +
        '<button class="twa-carousel-next" aria-label="Next" style="background:none;border:1px solid var(--border,#e2e8f0);border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:16px;color:var(--slate,#64748b);">&#8250;</button>' +
        '</div>' : '') +
        '</div>';

      renderCarouselPage();

      function updateDots() {
        var dotsEl = container.querySelector('.twa-carousel-dots');
        if (!dotsEl) return;
        dotsEl.innerHTML = '';
        for (var i = 0; i < totalPages; i++) {
          var dot = document.createElement('span');
          dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + (i === page ? 'var(--blue,#1a6fb5)' : 'var(--border,#e2e8f0)') + ';transition:background .2s;';
          dotsEl.appendChild(dot);
        }
      }
      updateDots();

      var prevBtn = container.querySelector('.twa-carousel-prev');
      var nextBtn = container.querySelector('.twa-carousel-next');
      if (prevBtn) prevBtn.addEventListener('click', function() { page = (page - 1 + totalPages) % totalPages; renderCarouselPage(); updateDots(); });
      if (nextBtn) nextBtn.addEventListener('click', function() { page = (page + 1) % totalPages; renderCarouselPage(); updateDots(); });

      var timer = null;
      if (autoAdvance && totalPages > 1) {
        timer = setInterval(function() { page = (page + 1) % totalPages; renderCarouselPage(); updateDots(); }, 8000);
      }
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden' && timer) { clearInterval(timer); timer = null; }
        else if (document.visibilityState === 'visible' && autoAdvance && totalPages > 1 && !timer) {
          timer = setInterval(function() { page = (page + 1) % totalPages; renderCarouselPage(); updateDots(); }, 8000);
        }
      });
    });
  }

  // Expose globally for inline use
  window.initTestimonialCarousel = initTestimonialCarousel;

  // ═══════════════════════════════════════════════
  // 15. LIVE CHAT WIDGET
  // ═══════════════════════════════════════════════
  function initChatWidget() {
    const path = window.location.pathname;
    if (path.startsWith('/intake') || path.startsWith('/portal') || path.startsWith('/partner') || path.startsWith('/admin')) return;

    const style = document.createElement('style');
    style.textContent = '.twa-chat-bubble{position:fixed;bottom:20px;right:20px;z-index:800;width:56px;height:56px;border-radius:50%;background:var(--navy,#173358);color:#fff;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;transition:transform .2s}.twa-chat-bubble:hover{transform:scale(1.08)}.twa-chat-panel{position:fixed;bottom:86px;right:20px;z-index:801;width:340px;max-width:calc(100vw - 40px);background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);display:none;overflow:hidden}.twa-chat-panel.open{display:block}.twa-chat-header{background:var(--navy,#173358);color:#fff;padding:16px;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center}.twa-chat-close{background:none;border:none;color:#fff;cursor:pointer;font-size:20px;padding:0 4px}.twa-chat-body{padding:16px}.twa-chat-body .form-group{margin-bottom:12px}.twa-chat-body label{display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px}.twa-chat-body input,.twa-chat-body select,.twa-chat-body textarea{width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none}.twa-chat-body input:focus,.twa-chat-body select:focus,.twa-chat-body textarea:focus{border-color:var(--blue,#1a6fb5)}.twa-chat-submit{width:100%;padding:10px;background:var(--blue,#1a6fb5);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}.twa-chat-submit:hover{background:var(--navy,#173358)}.twa-chat-submit:disabled{opacity:.6;cursor:not-allowed}';
    document.head.appendChild(style);

    const bubble = createElement('button', { class: 'twa-chat-bubble', 'aria-label': 'Chat with us' },
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>');

    const panel = createElement('div', { class: 'twa-chat-panel', id: 'twaChatPanel' }, `
      <div class="twa-chat-header">
        <span>Send us a message</span>
        <button class="twa-chat-close" id="twaChatClose" aria-label="Close chat">&times;</button>
      </div>
      <div class="twa-chat-body">
        <div class="form-group"><label for="chat_name">Your Name</label><input type="text" id="chat_name" placeholder="Name"></div>
        <div class="form-group"><label for="chat_type">What do you need?</label><select id="chat_type"><option value="">Select...</option><option value="quote">Insurance quote</option><option value="question">Coverage question</option><option value="claim">Claims help</option><option value="other">Something else</option></select></div>
        <div class="form-group"><label for="chat_message">Message</label><textarea id="chat_message" rows="3" placeholder="How can we help?"></textarea></div>
        <button class="twa-chat-submit" id="twaChatSubmit">Send Message</button>
        <div id="twaChatStatus" style="display:none;margin-top:8px;font-size:12px;text-align:center" role="alert" aria-live="polite"></div>
      </div>
    `);

    document.body.appendChild(panel);
    document.body.appendChild(bubble);

    let isOpen = false;
    function toggleChat() { isOpen = !isOpen; panel.classList.toggle('open', isOpen); if (isOpen) track('chat_widget_opened', { category: 'engagement' }); }

    bubble.addEventListener('click', toggleChat);
    panel.querySelector('#twaChatClose').addEventListener('click', toggleChat);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) toggleChat(); });

    panel.querySelector('#twaChatSubmit').addEventListener('click', async () => {
      const name = panel.querySelector('#chat_name').value.trim();
      const type = panel.querySelector('#chat_type').value;
      const message = panel.querySelector('#chat_message').value.trim();
      const status = panel.querySelector('#twaChatStatus');
      const btn = panel.querySelector('#twaChatSubmit');

      if (!message) { status.style.display = 'block'; status.style.color = '#ef4444'; status.textContent = 'Please enter a message.'; return; }

      btn.disabled = true; btn.textContent = 'Sending...';
      try {
        await fetch(CONFIG.webhookUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name || 'Chat visitor', message, subject: type, source: 'chat_widget', page: window.location.pathname }),
        });
        status.style.display = 'block'; status.style.color = '#16a34a'; status.textContent = 'Sent! We\'ll get back to you soon.';
        panel.querySelector('#chat_name').value = ''; panel.querySelector('#chat_message').value = '';
        track('chat_widget_submitted', { category: 'conversion', type });
      } catch(e) {
        status.style.display = 'block'; status.style.color = '#ef4444'; status.textContent = 'Failed to send. Call us at ' + CONFIG.phone;
      } finally { btn.disabled = false; btn.textContent = 'Send Message'; }
    });
  }

  // ═══════════════════════════════════════════════
  // 16. CONVERSION BASELINE & MEASUREMENT
  // ═══════════════════════════════════════════════
  /*
   * GA4 Event Schema Reference:
   * - page_engagement: page_type, entry_source, time_to_first_interaction, scroll_at_exit, cta_visible, form_started
   * - intake_funnel: steps[{name,enter_ms,complete_ms}], total_ms, completed, products
   * - ab_exposure: test_name, variant, visitor_id
   * - exit_intent_shown/clicked: page_path
   * - phone_click: page_path, link_text, position
   * - cta_visible: cta_text, page_path, position
   * - scroll_depth: threshold (25/50/75/100)
   * - time_on_page: threshold (15/30/60/120/300)
   * - chat_widget_opened/submitted: type
   * - intake_entry: source, product, city, line
   * - login_attempt: method (magic_link/password)
   * - nav_click: link_text, destination
   */

  function initConversionBaseline() {
    const baseline = {
      page_type: detectPageType(),
      entry_source: (function() {
        const p = new URLSearchParams(location.search);
        return p.get('utm_source') || p.get('src') || (document.referrer ? new URL(document.referrer).hostname : 'direct');
      })(),
      first_interaction_ms: null,
      cta_was_visible: false,
      form_was_started: false,
      max_scroll: 0,
      load_time: Date.now(),
    };

    // Time to first interaction
    function onFirstInteraction() {
      if (!baseline.first_interaction_ms) baseline.first_interaction_ms = Date.now() - baseline.load_time;
      document.removeEventListener('click', onFirstInteraction);
      document.removeEventListener('scroll', onFirstInteraction);
      document.removeEventListener('keydown', onFirstInteraction);
    }
    document.addEventListener('click', onFirstInteraction, { once: false, passive: true });
    document.addEventListener('scroll', onFirstInteraction, { once: false, passive: true });
    document.addEventListener('keydown', onFirstInteraction, { once: false, passive: true });

    // Track max scroll
    window.addEventListener('scroll', function() {
      const pct = Math.round((window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight)) * 100);
      if (pct > baseline.max_scroll) baseline.max_scroll = pct;
    }, { passive: true });

    // CTA visibility
    if (FEATURES.intersectionObserver) {
      const obs = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) { if (e.isIntersecting) baseline.cta_was_visible = true; });
      }, { threshold: 0.5 });
      document.querySelectorAll('a[href*="/intake"], .btn--primary').forEach(function(el) { obs.observe(el); });
    }

    // Form started
    document.addEventListener('focusin', function(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        baseline.form_was_started = true;
      }
    }, { passive: true });

    // Push on unload
    function pushBaseline() {
      window.dataLayer = window.dataLayer || [];
      dataLayer.push({
        event: 'page_engagement',
        page_type: baseline.page_type,
        entry_source: baseline.entry_source,
        time_to_first_interaction: baseline.first_interaction_ms,
        scroll_at_exit: baseline.max_scroll,
        cta_visible: baseline.cta_was_visible,
        form_started: baseline.form_was_started,
        time_on_page_sec: Math.round((Date.now() - baseline.load_time) / 1000),
      });
    }
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') pushBaseline(); });
    window.addEventListener('pagehide', pushBaseline);
  }

  // Metrics overlay (admin-only, via ?twa_metrics=1)
  function initMetricsOverlay() {
    if (!new URLSearchParams(location.search).has('twa_metrics')) return;
    const overlay = createElement('div', { id: 'twaMetrics' });
    overlay.style.cssText = 'position:fixed;top:60px;right:10px;width:260px;background:rgba(15,23,42,.92);color:#e2e8f0;font-size:11px;padding:12px;border-radius:8px;z-index:9999;font-family:monospace;line-height:1.6;max-height:70vh;overflow-y:auto;';
    overlay.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;color:#38bdf8;">Metrics Overlay</div><div id="twaMetricsBody"></div>';
    document.body.appendChild(overlay);

    setInterval(function() {
      const body = document.getElementById('twaMetricsBody');
      if (!body) return;
      const scrollPct = Math.round((window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight)) * 100);
      const timeOnPage = Math.round((Date.now() - performance.timing.navigationStart) / 1000);
      const visibleCtas = document.querySelectorAll('.btn--primary, a[href*="/intake"]').length;
      const events = (window.dataLayer || []).filter(function(e) { return e.event; }).length;
      body.innerHTML =
        '<div>Page: ' + detectPageType() + '</div>' +
        '<div>Scroll: ' + scrollPct + '%</div>' +
        '<div>Time: ' + timeOnPage + 's</div>' +
        '<div>CTAs on page: ' + visibleCtas + '</div>' +
        '<div>Events fired: ' + events + '</div>' +
        '<div>Lang: ' + _currentLang + '</div>' +
        '<div>Visitor: ' + (getVisitorId() || '').slice(0, 8) + '...</div>';
    }, 1000);
  }

  // ═══════════════════════════════════════════════
  // INITIALIZE
  // ═══════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    initABTests();
    initNav();
    initI18n();
    initFAQ();
    initInlineForms();
    initStickyMobileCTA();
    initExitIntent();
    initClickTracking();
    initQuoteWizard();
    initMainQuoteForm();
    initContactForm();
    initAnalytics();
    initFormTestimonials();
    initScrollAnimations();
    initEngagementTracking();
    initChatWidget();
    initConversionBaseline();
    initMetricsOverlay();
    initTestimonialCarousel('[data-testimonials]', {});
    // Auto-init carousels with mode attribute
    $$('[data-testimonial-mode]').forEach(function(el) {
      initTestimonialCarousel('[data-testimonial-mode="' + el.getAttribute('data-testimonial-mode') + '"]', {
        mode: el.getAttribute('data-testimonial-mode'),
        filter: el.getAttribute('data-testimonial-filter') || null,
      });
    });
  });

})();

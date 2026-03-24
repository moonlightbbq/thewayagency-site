/* ═══════════════════════════════════════════════
   THE WAY AGENCY  -  Lead Generation Engine
   Version 2.0  -  Full conversion optimization
   ═══════════════════════════════════════════════ */

(function() {
  'use strict';

  // ─── Configuration ───────────────────────────
  const CONFIG = {
    webhookUrl: 'https://sage.thewayagency.com/api/intake/lead',
    turnstileSiteKey: '0x4AAAAAACuOvP2DfWPQJz9W',
    phone: '(502) 413-5335',
    phoneRaw: '+15024135335',
    email: 'hello@thewayagency.com',
    textNumber: '(502) 413-5335',
    calendarUrl: '', // Set to Calendly or scheduling tool URL
    gaId: 'G-C79ZCDZVPE',
    fbPixelId: '', // Set to Facebook Pixel ID
    responseTimeMinutes: 60, // Used in messaging
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
      if (typeof children === 'string') el.innerHTML = children;
      else if (Array.isArray(children)) children.forEach(c => el.appendChild(c));
    }
    return el;
  }

  // ─── Analytics Tracking ──────────────────────
  function trackEvent(action, category, label, value) {
    // GA4
    if (window.gtag) {
      gtag('event', action, {
        event_category: category,
        event_label: label,
        value: value
      });
    }
    // Facebook Pixel
    if (window.fbq) {
      fbq('track', action === 'form_submit' ? 'Lead' : 'ViewContent', {
        content_name: label,
        content_category: category
      });
    }
    console.log('[TWA Track]', action, category, label);
  }

  // ─── Turnstile Helper ───────────────────────
  let _turnstileReady = false;
  function getTurnstileToken() {
    return new Promise((resolve) => {
      if (!CONFIG.turnstileSiteKey || !window.turnstile) { resolve(''); return; }
      // Create a temporary invisible container
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

  // ─── Form Submission Handler ─────────────────
  async function submitLead(data, source) {
    data.timestamp = new Date().toISOString();
    data.source = source || 'website';
    data.page = window.location.pathname;
    data.referrer = document.referrer || 'direct';
    data._hp_company = ''; // Honeypot — bots will fill this, humans won't

    // Get Turnstile token if configured
    if (CONFIG.turnstileSiteKey) {
      data.cfToken = await getTurnstileToken();
    }

    trackEvent('form_submit', 'lead', source);

    if (CONFIG.webhookUrl) {
      try {
        const res = await fetch(CONFIG.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.sessionId) {
          // Store sessionId for status checking
          try { localStorage.setItem('twa_last_session', result.sessionId); } catch(e) {}
        }
        return result;
      } catch (err) {
        console.error('[TWA] Submission error:', err);
      }
    } else {
      console.log('[TWA] Lead data (no webhook):', data);
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

    // Mobile dropdown toggles
    $$('.nav__dropdown > .nav__link').forEach(link => {
      link.addEventListener('click', (e) => {
        if (window.innerWidth <= 968) {
          e.preventDefault();
          link.parentElement.classList.toggle('nav__dropdown--open');
        }
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
        trackEvent('form_submit', 'lead', 'inline-product-form');

        // Build intake URL with pre-filled context
        const params = new URLSearchParams();
        if (data.product) params.set('product', data.product);
        if (data.lineOfBusiness) params.set('line', data.lineOfBusiness);
        if (data.name) params.set('name', data.name);
        if (data.email) params.set('email', data.email);
        if (data.phone) params.set('phone', data.phone);
        if (data.industry) params.set('industry', data.industry);
        params.set('src', 'inline');

        window.location.href = '/intake/?' + params.toString();
      });
    });
  }

  // ═══════════════════════════════════════════════
  // 4. STICKY MOBILE CTA BAR
  // ═══════════════════════════════════════════════
  // Detect page context for smart intake links
  function getIntakeUrl() {
    const path = window.location.pathname;
    // Product pages: /personal/home.html, /commercial/cyber.html, etc.
    const productMatch = path.match(/\/(personal|commercial|life-health)\/([^/]+)\.html$/);
    if (productMatch && productMatch[2] !== 'index') {
      const slug = productMatch[2];
      // Map slug to product ID (most match, some need mapping)
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
    // Hub pages: /personal/, /commercial/, /life-health/
    if (path.match(/\/personal\/?$/)) return '/intake/?line=personal';
    if (path.match(/\/commercial\/?$/)) return '/intake/?line=commercial';
    if (path.match(/\/life-health\/?$/)) return '/intake/?line=life-health';
    // Geo pages: /insurance/louisville-ky.html
    const geoMatch = path.match(/\/insurance\/([^/]+)\.html$/);
    if (geoMatch) {
      const parts = geoMatch[1].split('-');
      const state = parts.pop().toUpperCase();
      const city = parts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return '/intake/?city=' + encodeURIComponent(city) + '&state=' + encodeURIComponent(state);
    }
    // Industry pages: /industries/roofing-contractors.html
    const indMatch = path.match(/\/industries\/([^/]+)\.html$/);
    if (indMatch) return '/intake/?line=commercial&industry=' + encodeURIComponent(indMatch[1]);
    return '/intake/';
  }

  function initStickyMobileCTA() {
    if (window.innerWidth > 768) return;

    const intakeUrl = getIntakeUrl();
    const bar = createElement('div', {
      id: 'stickyMobileCTA',
      style: {
        position: 'fixed',
        bottom: '0',
        left: '0',
        right: '0',
        zIndex: '999',
        background: 'var(--navy)',
        padding: '10px 16px',
        display: 'flex',
        gap: '8px',
        justifyContent: 'center',
        alignItems: 'center',
        boxShadow: '0 -2px 12px rgba(0,0,0,0.15)',
        transform: 'translateY(100%)',
        transition: 'transform 0.3s ease',
      }
    }, `
      <a href="tel:${CONFIG.phoneRaw}" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;background:transparent;border:1.5px solid rgba(255,255,255,0.3);border-radius:6px;color:white;font-size:13px;font-weight:600;text-decoration:none;text-transform:uppercase;letter-spacing:0.04em;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg>
        Call
      </a>
      <a href="sms:${CONFIG.phoneRaw}" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;background:transparent;border:1.5px solid rgba(255,255,255,0.3);border-radius:6px;color:white;font-size:13px;font-weight:600;text-decoration:none;text-transform:uppercase;letter-spacing:0.04em;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Text
      </a>
      <a href="${intakeUrl}" style="flex:1.5;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;background:var(--cyan);border:1.5px solid var(--cyan);border-radius:6px;color:var(--navy-dark);font-size:13px;font-weight:600;text-decoration:none;text-transform:uppercase;letter-spacing:0.04em;">
        Get a Quote
      </a>
    `);

    document.body.appendChild(bar);

    // Show after scrolling past hero
    let shown = false;
    window.addEventListener('scroll', () => {
      const shouldShow = window.scrollY > 400;
      if (shouldShow && !shown) {
        bar.style.transform = 'translateY(0)';
        shown = true;
      } else if (!shouldShow && shown) {
        bar.style.transform = 'translateY(100%)';
        shown = false;
      }
    }, { passive: true });

    // Add bottom padding to body so footer isn't hidden
    document.body.style.paddingBottom = '64px';
  }

  // ═══════════════════════════════════════════════
  // 5. EXIT INTENT POPUP
  // ═══════════════════════════════════════════════
  function initExitIntent() {
    if (window.innerWidth < 768) return; // Desktop only
    if (sessionStorage.getItem('twa_exit_shown')) return; // Already shown this session
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
    const overlay = createElement('div', {
      id: 'exitOverlay',
      style: {
        position: 'fixed',
        inset: '0',
        zIndex: '10000',
        background: 'rgba(15,34,64,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        opacity: '0',
        transition: 'opacity 0.3s ease',
      }
    }, `
      <div style="background:white;border-radius:12px;max-width:460px;width:100%;padding:40px;position:relative;transform:translateY(20px);transition:transform 0.3s ease;">
        <button id="exitClose" style="position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;padding:8px;color:var(--slate);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h3 style="font-family:var(--font-heading);font-size:1.5rem;font-weight:600;color:var(--navy);margin-bottom:8px;">Before you go</h3>
        <p style="color:var(--slate);font-size:0.95rem;font-weight:300;margin-bottom:20px;">Get a free coverage review  -  we'll look at what you have and tell you if there's a better option. No commitment, no pressure.</p>
        <form id="exitForm">
          <input type="text" name="_hp_company" style="display:none" tabindex="-1" autocomplete="off">
          <div style="display:flex;gap:8px;margin-bottom:10px;">
            <input type="text" name="name" placeholder="Your name" required style="flex:1;padding:10px 14px;border:1px solid var(--border);border-radius:6px;font-family:var(--font-body);font-size:14px;font-weight:300;">
            <input type="email" name="email" placeholder="Email address" required style="flex:1;padding:10px 14px;border:1px solid var(--border);border-radius:6px;font-family:var(--font-body);font-size:14px;font-weight:300;">
          </div>
          <button type="submit" style="width:100%;padding:12px;background:var(--cyan);color:var(--navy-dark);border:none;border-radius:6px;font-family:var(--font-body);font-size:14px;font-weight:600;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em;">Get a Free Coverage Review</button>
          <p style="font-size:11px;color:var(--gray);margin-top:8px;text-align:center;">We never sell your data. A licensed agent will follow up within 1 business day.</p>
        </form>
      </div>
    `);

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      overlay.querySelector('div').style.transform = 'translateY(0)';
    });

    // Close handlers
    $('#exitClose').addEventListener('click', () => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
      }
    });

    // Form handler — redirect to full intake with pre-filled data
    $('#exitForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      trackEvent('form_submit', 'lead', 'exit-intent');

      const params = new URLSearchParams();
      if (data.name) params.set('name', data.name);
      if (data.email) params.set('email', data.email);
      params.set('src', 'coverage-review');

      window.location.href = '/intake/?' + params.toString();
    });

    trackEvent('popup_show', 'exit_intent', window.location.pathname);
  }

  // ═══════════════════════════════════════════════
  // 6. CLICK-TO-CALL/TEXT TRACKING
  // ═══════════════════════════════════════════════
  function initClickTracking() {
    $$('a[href^="tel:"]').forEach(el => {
      el.addEventListener('click', () => trackEvent('click', 'contact', 'phone-call'));
    });
    $$('a[href^="sms:"]').forEach(el => {
      el.addEventListener('click', () => trackEvent('click', 'contact', 'text-message'));
    });
    $$('a[href^="mailto:"]').forEach(el => {
      el.addEventListener('click', () => trackEvent('click', 'contact', 'email'));
    });
    // Track quote button clicks
    $$('a[href*="quote"]').forEach(el => {
      el.addEventListener('click', () => trackEvent('click', 'cta', 'quote-button'));
    });
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
      steps.forEach((s, i) => {
        s.style.display = i === n ? 'block' : 'none';
      });
      progressDots.forEach((d, i) => {
        d.classList.toggle('wizard-dot--active', i === n);
        d.classList.toggle('wizard-dot--done', i < n);
      });
      currentStep = n;
      trackEvent('form_step', 'quote_wizard', `step_${n + 1}`);
    }

    $$('.wizard-next', form).forEach(btn => {
      btn.addEventListener('click', () => {
        // Validate current step
        const currentFields = $$('input[required], select[required]', steps[currentStep]);
        let valid = true;
        currentFields.forEach(f => {
          if (!f.value.trim()) {
            f.style.borderColor = 'var(--error)';
            valid = false;
          } else {
            f.style.borderColor = 'var(--border)';
          }
        });
        if (valid && currentStep < steps.length - 1) {
          showStep(currentStep + 1);
        }
      });
    });

    $$('.wizard-back', form).forEach(btn => {
      btn.addEventListener('click', () => {
        if (currentStep > 0) showStep(currentStep - 1);
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button[type="submit"]');
      btn.textContent = 'Sending...';
      btn.disabled = true;
      await submitLead(data, 'quote-wizard');

      form.innerHTML = `
        <div style="text-align:center;padding:var(--space-3xl) 0;">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" style="margin:0 auto var(--space-lg);">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <h2 style="margin-bottom:var(--space-md);">Quote request received</h2>
          <p style="color:var(--slate);font-size:var(--text-lg);font-weight:300;max-width:480px;margin:0 auto var(--space-lg);">
            A licensed agent will reach out within ${CONFIG.responseTimeMinutes} minutes during business hours (Mon–Fri, 8:30 AM – 5:00 PM).
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
        if (!input.value.trim()) {
          input.style.borderColor = 'var(--error)';
          valid = false;
        } else {
          input.style.borderColor = 'var(--border)';
        }
      });
      if (!valid) return;

      const data = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button[type="submit"]');
      btn.textContent = 'Sending...';
      btn.disabled = true;
      await submitLead(data, 'main-quote-form');

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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      await submitLead(data, 'contact-form');
      form.innerHTML = '<div style="text-align:center;padding:var(--space-2xl) 0;"><p style="font-weight:600;color:var(--navy);font-size:var(--text-xl);">Message sent!</p><p style="color:var(--slate);margin-top:8px;">We\'ll respond within 1 business day.</p></div>';
    });
  }

  // ═══════════════════════════════════════════════
  // 10. GOOGLE ANALYTICS 4
  // ═══════════════════════════════════════════════
  function initGA4() {
    if (!CONFIG.gaId) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${CONFIG.gaId}`;
    document.head.appendChild(script);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function() { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', CONFIG.gaId, {
      send_page_view: true,
      cookie_flags: 'SameSite=None;Secure',
    });
  }

  // ═══════════════════════════════════════════════
  // 11. FACEBOOK PIXEL
  // ═══════════════════════════════════════════════
  function initFBPixel() {
    if (!CONFIG.fbPixelId) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', CONFIG.fbPixelId);
    fbq('track', 'PageView');
  }

  // ═══════════════════════════════════════════════
  // 12. TESTIMONIAL PLACEMENT NEAR FORMS
  // ═══════════════════════════════════════════════
  function initFormTestimonials() {
    // Add social proof next to any quote form
    $$('.form-social-proof').forEach(container => {
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <div style="display:flex;gap:1px;color:var(--cyan);">
            ${'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'.repeat(5)}
          </div>
          <span style="font-size:12px;color:var(--slate);font-weight:300;">from Google Reviews</span>
        </div>
        <p style="font-size:13px;color:var(--slate);font-weight:300;font-style:italic;line-height:1.6;margin:0;">
          "She saved me a ton of money and doubled my coverage. Buying online was not as smart as I thought."
          <span style="font-weight:500;color:var(--navy);display:block;margin-top:4px;font-style:normal;"> -  Lisa M., Owensboro</span>
        </p>`;
    });
  }

  // ═══════════════════════════════════════════════
  // 13. SCROLL ANIMATIONS
  // ═══════════════════════════════════════════════
  function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    $$('.card, .step, .testimonial-card, .section-header, .lob-card').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      observer.observe(el);
    });
  }

  // CSS for scroll animations
  const animStyle = document.createElement('style');
  animStyle.textContent = `
    .animate-in { opacity: 1 !important; transform: translateY(0) !important; }
    @media (prefers-reduced-motion: reduce) {
      .card, .step, .testimonial-card, .section-header, .lob-card {
        opacity: 1 !important; transform: none !important; transition: none !important;
      }
    }
  `;
  document.head.appendChild(animStyle);

  // ═══════════════════════════════════════════════
  // INITIALIZE EVERYTHING
  // ═══════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initFAQ();
    initInlineForms();
    initStickyMobileCTA();
    initExitIntent();
    initClickTracking();
    initQuoteWizard();
    initMainQuoteForm();
    initContactForm();
    initGA4();
    initFBPixel();
    initFormTestimonials();
    initScrollAnimations();
  });


})();

/**
 * Mid-post CTA copy by line of business (CONT-03, content-accuracy WP-A7b,
 * owner decision D8). Dependency-free.
 *
 * No "free" on life, health or Medicare posts: "Get a free quote" conflicts
 * with KRS 304.15-712(3)(b) on a conservative reading of the life rules, and
 * the health and Medicare lines follow the same rule. No "top-rated" anywhere
 * (TRUST-05). Health and Medicare leads go to the partner agency (owner
 * decision 3), so their lines make no carrier-comparison claim.
 */
'use strict';

const CTA_COPY = Object.freeze({
  medicare: Object.freeze({ text: 'Talk with a licensed agent about your Medicare options.', button: 'Get a Quote' }),
  health: Object.freeze({ text: 'Talk with a licensed agent about your health insurance options.', button: 'Get a Quote' }),
  life: Object.freeze({ text: 'Get a quote from an independent agent. We compare the insurance companies we represent for you.', button: 'Get a Quote' }),
  other: Object.freeze({ text: 'Get a free quote from an independent agent. We compare the insurance companies we represent for you.', button: 'Get a Free Quote' }),
});

/**
 * The post's line: 'medicare', 'health', 'life' or 'other'. The category alone
 * misses most life posts (46 markdown files have none, final-expense-insurance-
 * guide among them), so a /life/ or /health/ related_page counts too. A health
 * page wins over a life category, and a life_health post with no /life/ page is
 * read as health: the stricter copy.
 */
function ctaLine(category, relatedPage, { medicare = false } = {}) {
  if (medicare) return 'medicare';
  const related = (/^\/(life|health)\//.exec(String(relatedPage || '')) || [])[1];
  if (category === 'health' || related === 'health') return 'health';
  if (category === 'life' || related === 'life') return 'life';
  if (category === 'life_health') return 'health';
  return 'other';
}

/** { text, button } for the post. */
function ctaCopy(category, relatedPage, opts) {
  return CTA_COPY[ctaLine(category, relatedPage, opts)];
}

module.exports = { CTA_COPY, ctaLine, ctaCopy };

'use strict';
/**
 * Exemptions for the call-and-text pairing lint (scripts/lib/contact-pairing.js).
 *
 * Kept apart from the lint so the list is easy to read and to change. Every
 * entry names the page, the rule it suspends, the exact link (by the text right
 * before it), the decision it rests on and why.
 *
 * STATUS: the D10 entries below are the audit's RECOMMENDED exemptions
 * (above-the-fold spec D10). They are NOT approved yet: they wait on the owner's
 * answer to OA-18 (plans/seo-aeo-remediation-2026-10/owner-actions.md). If the
 * owner declines, delete the entry and pair the link; on a compliance page that
 * is a <main> wording change, so it also needs a Version bump and a
 * legal-archive/ snapshot (CLAUDE.md).
 *
 * The /about/team "ext 1-4" links need no entry: each is already paired with
 * "or text (502) 413-5335" in the same sentence (a text cannot reach an
 * extension, so the text link goes to the main line), which passes the lint.
 */

const COMPLIANCE_PHONE_LINE = 'Phone:';

const D10_EXEMPTIONS = [
  // The six compliance pages' in-<main> contact block. privacy, terms and
  // disclosures already carry a "Text:" line under "Phone:", so they pass; these
  // three do not. Adding one is a <main> wording change (Version bump plus
  // legal-archive snapshot), so D10 recommends leaving them until each page's
  // next Version bump. The footer on each page is paired.
  { page: 'ai-disclosure.html', rule: 'unpaired', before: COMPLIANCE_PHONE_LINE, decision: 'D10 (awaits OA-18)', reason: 'compliance page <main> contact line; pairing needs a Version bump' },
  { page: 'information-security.html', rule: 'unpaired', before: COMPLIANCE_PHONE_LINE, decision: 'D10 (awaits OA-18)', reason: 'compliance page <main> contact line; pairing needs a Version bump' },
  { page: 'privacy-notice.html', rule: 'unpaired', before: COMPLIANCE_PHONE_LINE, decision: 'D10 (awaits OA-18)', reason: 'compliance page <main> contact line; pairing needs a Version bump' },
];

// Entries for links another open PR already fixes; empty now that #66 (the
// giveaway page's paired contact line) is on main. validate-build.js warns when
// an entry stops matching, so stale ones get removed.
const TEMPORARY_EXEMPTIONS = [];

const DEFAULT_EXEMPTIONS = Object.freeze([...D10_EXEMPTIONS, ...TEMPORARY_EXEMPTIONS]);

module.exports = { D10_EXEMPTIONS, TEMPORARY_EXEMPTIONS, DEFAULT_EXEMPTIONS };

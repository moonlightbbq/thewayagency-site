/**
 * Blog content guard: what a post may say about who wrote it and who reviewed
 * it (sage-server BL-07, AIA-018).
 *
 * THE SAME FILE, byte for byte, lives in two repositories:
 *   thewayagency-site  scripts/lib/blog-content-guard.js   (publisher, reconciler, renderer)
 *   sage-server        src/services/blog-content-guard.js  (every BL-06 promote and BL-07
 *                                                          approval, before it commits)
 * sage-server's tests/blog-content-guard-parity.test.js fails when the two
 * differ. Change both together.
 *
 * A "Reviewed by" credit is earned only through the assigned reviewer's
 * approval in SAGE, signed by SAGE and bound to the exact bytes; the renderer
 * prints it from the data/team.json member that approval is bound to
 * (review-credit.js). This guard keeps every OTHER value the page prints from
 * carrying a credit or a byline of its own:
 *
 *   Byline identity: an allowlist, not a wording test
 *     author_slug   names a data/team.json member, or is absent; the byline
 *                   prints that member's name and title from data/team.json
 *                   (bylineAuthor), never the front matter's author or
 *                   author_title, and "Written by The Way Agency" without one.
 *                   A slug that names no member (one who left) prints the
 *                   agency: the post still renders.
 *     author, author_title  never printed. A BL-06 promote (new text entering
 *                   src/blog/) also requires them to be that member's, and
 *                   author_slug to be absent on an AI draft unless that member
 *                   approves it (bylineProblem; sage-server blog-publication.js)
 *     reading_time  "<1-3 digits> min" or "<1-3 digits> min read", or absent
 *                   (then it is computed); any other value refuses the post
 *     date, modified  YYYY-MM-DD
 *   Every front-matter value
 *     - no '<' or '>' (markup);
 *     - only printable ASCII, Latin-1 and Latin Extended-A letters, general
 *       punctuation, currency signs and the trade mark sign: nothing invisible
 *       (soft hyphen, zero-width and bidi characters), no control characters,
 *       no combining marks, no other scripts' look-alike letters, no
 *       full-width or mathematical letters;
 *     - slug, author_slug and reviewer_slug are lower-case letters, digits
 *       and hyphens;
 *     - no review or approval credit. A value is short, so word order and
 *       distance are not weighed: a credit word in any form (review,
 *       reviewed, reviewer, approve, approval, vet, verify, check, fact-check,
 *       endorse, certify, audit, sign off, proofread, edit, validate, ...)
 *       ANYWHERE beside an identity ANYWHERE (a team member's full name, first
 *       name or surname, the agency, "licensed", agent, principal, producer,
 *       staff, expert, a team title) refuses the value; so does a credit
 *       participle followed by "by" with any object, however many words lie
 *       between them in the clause ("Reviewed for accuracy and compliance
 *       by ..."). A service the agency sells is not a credit: "coverage
 *       review", "premium audit", "policy endorsement" (unless a colon, a dash
 *       or "by" follows it). A slug or image path, printed only inside URLs,
 *       gets the "by" and colon rules but not the anywhere ones.
 *       The review keys themselves (reviewer, reviewer_slug, ...) are the
 *       signed credit's own lines: the publisher writes them and strips any
 *       others, so they are not wording-checked here.
 *   The body, read the way the page prints it
 *     The renderer prints a single line break inside a paragraph or a
 *     blockquote as a space, and joins an FAQ answer's lines (blank ones too)
 *     with spaces, in the page and in the FAQPage JSON-LD. So the body is read
 *     as written, with those line breaks folded, and each FAQ question and
 *     answer as printed (bodyViews). In each:
 *     - no sentence that has a credit word in any form or voice and a team
 *       member's full name, first name or honorific and surname ("Ms.
 *       Royal"), in any order and at any distance ("Jill Boone reviewed and
 *       approved this guide.");
 *     - no review or approval credit naming the agency, a licensed agent, a
 *       team title or "our" staff about the text itself (the body may well
 *       say "approved by the state", "inspected by the health department" or
 *       "have it reviewed by a licensed agent").
 *
 * Wording is read through Unicode compatibility folding (full-width and
 * mathematical letters), with invisible characters removed, accents stripped,
 * Cyrillic, Greek and other look-alike letters mapped to Latin, digits and
 * symbols standing in for letters ("Rev1ewed"), punctuation or markdown
 * emphasis inside a word ("Re-viewed", "Re**viewed**") and letter-spaced
 * words ("R e v i e w e d") collapsed. A wording test on free text is best
 * effort: no list holds every way to say "reviewed". The structured credit
 * (the byline and the JSON-LD reviewedBy) never depends on it: it prints only
 * from data/team.json and a signed approval.
 *
 * Front matter is read exactly as the site's renderer reads it
 * (scripts/generate-blog.js parseFrontMatter): the block between a first line
 * "---" and the next "\n---\n", each line's text before the first ':'
 * trimmed as the key, the rest trimmed (and unquoted) as the value, the last
 * line of a key winning.
 *
 * Pure: no I/O, no dependencies. Node 18+.
 */
'use strict';

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;
const SAFE_SLUG_RE = /^[a-z0-9-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const READING_TIME_RE = /^\d{1,3} min(?: read)?$/;
const SLUG_KEYS = Object.freeze(['slug', 'author_slug', 'reviewer_slug']);
// Values printed only inside URLs (an href, a src, og:image): a path, not a
// sentence. related_page is not one: the page prints it as a card title.
const URL_KEYS = Object.freeze([...SLUG_KEYS, 'image']);
const DATE_KEYS = Object.freeze(['date', 'modified']);
const REVIEW_KEYS = Object.freeze(['reviewer', 'reviewer_slug', 'reviewer_title', 'reviewed_date', 'reviewed_by']);
const AGENCY_AUTHOR = 'The Way Agency';

// Every character a front-matter key or value may contain. Printable ASCII;
// Latin-1 (U+00A0-U+00FF, without the soft hyphen U+00AD) and Latin
// Extended-A (U+0100-U+017F) letters and symbols; general punctuation
// U+2010-U+2027 and U+2030-U+205E (dashes, quotes, bullets, the ellipsis,
// primes; it excludes the zero-width and bidi characters U+200B-U+200F and
// U+202A-U+202E, the line separators U+2028/U+2029 and U+205F onwards);
// currency signs; the trade mark sign. Nothing else: the live posts use
// ASCII and the em dash.
const FM_ALLOWED = /^[\x20-\x7E\u00A0-\u00AC\u00AE-\u017F\u2010-\u2027\u2030-\u205E\u20A0-\u20BF\u2122]*$/;

// Look-alike letters (after compatibility folding, accent stripping and
// lower-casing) and the Latin letters they pass for. Cyrillic, Greek,
// Armenian and Cherokee look-alikes, IPA and small-capital letters, and
// Latin letters with a stroke or without a dot.
const CONFUSABLE = Object.freeze({
  // Cyrillic
  'а': 'a', 'в': 'b', 'г': 'r', 'д': 'd', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o',
  'п': 'n', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'ш': 'w', 'щ': 'w', 'ь': 'b', 'ъ': 'b',
  'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'һ': 'h', 'ԛ': 'q', 'ԝ': 'w', 'ӏ': 'l', 'ү': 'y',
  'ұ': 'y', 'ѵ': 'v', 'ө': 'o', 'ҫ': 'c', 'ҝ': 'k', 'ҟ': 'k', 'ҡ': 'k', 'ң': 'h', 'ҭ': 't', 'ӄ': 'k',
  'ԍ': 'g', 'ԑ': 'e', 'є': 'e', 'ѐ': 'e', 'ѝ': 'u', 'и': 'u', 'ц': 'u', 'л': 'n', 'ѡ': 'w', 'ꙇ': 'i',
  // Greek
  'α': 'a', 'β': 'b', 'γ': 'y', 'δ': 'd', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'μ': 'u', 'ν': 'v',
  'ο': 'o', 'π': 'n', 'ρ': 'p', 'σ': 'o', 'ς': 'c', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w', 'ϲ': 'c',
  'ϳ': 'j', 'ϝ': 'f', 'ϵ': 'e', 'ϱ': 'p', 'ϰ': 'k',
  // Armenian
  'ա': 'w', 'հ': 'h', 'ո': 'n', 'ս': 'u', 'օ': 'o', 'զ': 'q', 'ց': 'g', 'ւ': 'l', 'ք': 'p',
  // Cherokee (the lower-case forms the upper-case look-alikes lower-case to)
  'ꭰ': 'd', 'ꭱ': 'r', 'ꭲ': 't', 'ꭺ': 'a', 'ꮃ': 'w', 'ꮇ': 'm', 'ꮋ': 'h', 'ꮓ': 'z', 'ꮪ': 's', 'ꮯ': 'c',
  'ꮲ': 'p', 'ꮶ': 'k', 'ꮩ': 'v', 'ꭼ': 'e', 'ꮐ': 'g', 'ꮮ': 'l', 'ꭹ': 'y', 'ꮟ': 'b', 'ꭵ': 'i', 'ꮀ': 'h',
  'ꮍ': 'y', 'ꮤ': 'w', 'ꮻ': 'o', 'ꮜ': 'u',
  // Latin letters that do not decompose, IPA and small capitals
  'ı': 'i', 'ȷ': 'j', 'ł': 'l', 'đ': 'd', 'ħ': 'h', 'ŧ': 't', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss',
  'þ': 'p', 'ð': 'd', 'ƀ': 'b', 'ɨ': 'i', 'ɵ': 'o', 'ʉ': 'u', 'ɑ': 'a', 'ɐ': 'a', 'ɒ': 'o', 'ɓ': 'b',
  'ɔ': 'o', 'ɖ': 'd', 'ɗ': 'd', 'ɘ': 'e', 'ə': 'e', 'ɛ': 'e', 'ɜ': 'e', 'ɡ': 'g', 'ɢ': 'g', 'ɦ': 'h',
  'ɩ': 'i', 'ɪ': 'i', 'ɫ': 'l', 'ɬ': 'l', 'ɭ': 'l', 'ɱ': 'm', 'ɲ': 'n', 'ɳ': 'n', 'ɴ': 'n', 'ɶ': 'oe',
  'ɹ': 'r', 'ɼ': 'r', 'ɽ': 'r', 'ɾ': 'r', 'ʀ': 'r', 'ʂ': 's', 'ʈ': 't', 'ʋ': 'v', 'ʍ': 'w', 'ʏ': 'y',
  'ʐ': 'z', 'ʑ': 'z', 'ʙ': 'b', 'ʜ': 'h', 'ʝ': 'j', 'ʟ': 'l', 'ᴀ': 'a', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e',
  'ᴊ': 'j', 'ᴋ': 'k', 'ᴍ': 'm', 'ᴏ': 'o', 'ᴘ': 'p', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ᴢ': 'z',
  'ꜱ': 's', 'ꞯ': 'q', 'ƈ': 'c', 'ɋ': 'q', 'ƙ': 'k', 'ƚ': 'l', 'ƞ': 'n', 'ƥ': 'p', 'ƭ': 't', 'ƴ': 'y',
  'ȥ': 'z', 'ɍ': 'r', 'ɏ': 'y', 'ŀ': 'l', 'ſ': 's',
});

// Digits and symbols that stand in for a letter inside a claim word.
const LOOK = Object.freeze({ a: 'a4@', b: 'b8', e: 'e3', g: 'g9', i: 'i1l!|', l: 'l1i!|', o: 'o0', s: 's5$', t: 't7+', z: 'z2' });

// Participles that state a credit with any object: "Reviewed by", "Approved
// by". Refused in any front-matter value; in the body only with an identity.
const CREDIT_PARTICIPLES = Object.freeze([
  'reviewed', 'approved', 'vetted', 'checked', 'verified', 'endorsed',
  'vouched', 'proofread', 'proofed', 'edited', 'okayed', 'signed off', 'signed-off',
]);
// Participles that state a credit only when an identity follows ("Confirmed
// by our licensed agents"): "inspected by the health department" or
// "certified by the state" is not one.
const IDENTITY_PARTICIPLES = Object.freeze([
  'certified', 'audited', 'validated',
  'examined', 'inspected', 'evaluated', 'assessed', 'confirmed', 'authorized', 'authorised', 'cleared', 'sanctioned',
  'overseen', 'supervised',
]);
// Nouns that state a credit when "by" and an identity follow ("Review by
// <a team member>"); a colon after them does not ("Policy review: our checklist").
const CREDIT_NOUNS = Object.freeze([
  'review', 'approval', 'sign off', 'sign-off', 'signoff', 'endorsement', 'certification', 'verification', 'vetting',
]);
// Agent nouns, with "by" or a colon and an identity ("Reviewer: <name>").
const CREDIT_AGENTS = Object.freeze([
  'reviewers', 'reviewer', 'approver', 'checker', 'verifier', 'editor', 'auditor', 'endorser', 'certifier', 'validator',
]);
// Every form of a credit word, in any voice: a front-matter value with one
// beside an identity is refused, and so is a body sentence with one beside a
// team member's name, in any order and at any distance.
const CREDIT_FORMS = Object.freeze([
  'review', 'reviews', 'reviewed', 'reviewing', 'reviewer', 'reviewers',
  'approve', 'approves', 'approved', 'approving', 'approval', 'approvals', 'approver', 'approvers',
  'vetted', 'vetting',
  'verify', 'verifies', 'verified', 'verifying', 'verification', 'verifier',
  'check', 'checks', 'checked', 'checking', 'checker',
  'endorse', 'endorses', 'endorsed', 'endorsing', 'endorsement', 'endorsements', 'endorser',
  'certify', 'certifies', 'certified', 'certifying', 'certification', 'certifier',
  'audit', 'audits', 'audited', 'auditing', 'auditor', 'auditors',
  'sign off', 'signs off', 'signed off', 'signing off',
  'proofread', 'proofreads', 'proofreading', 'proofreader', 'proofed',
  'edit', 'edits', 'edited', 'editing', 'editor', 'editors',
  'vouch', 'vouches', 'vouched', 'okayed', 'validate', 'validates', 'validated', 'validator',
]);
const CREDIT_PREFIX = '(?:(?:fact|double|pre|peer|co|expert|human|agent|hand)[^a-z0-9\\n]{0,2})?';
// Fixed identities a credit in the body may not name (the team's names and
// titles are added from data/team.json).
const FIXED_IDENTITIES = [
  'the way agency', 'way agency', 'agency principal',
  'licensed (?:[a-z]+ ){0,2}?(?:agents?|producers?|professionals?)',
  'our (?:[a-z\'-]+ ){0,2}?(?:team|agents?|staff|producers?|principal|experts?|specialists?|advisors?|advisers?|professionals?|licensed|editors?|reviewers?|agency)',
];
// Identities a front-matter value may not put beside a credit word, on top of
// the team's names and titles and FIXED_IDENTITIES.
const IDENTITY_WORDS = ['licensed', 'agents?', 'principals?', 'producers?', 'staff', 'staffers?', 'experts?', '(?:the|our) agency'];
const HONORIFIC = '(?:mr|mrs|ms|miss|dr|mx)';

const _escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A claim word as a pattern: look-alike digits and one stray symbol allowed between letters. */
function _tolerant(word) {
  return [...word].map((c) => {
    if (c === ' ' || c === '-') return '[^a-z0-9\\n]{0,3}';
    return LOOK[c] ? `[${_escapeRe(LOOK[c])}]` : _escapeRe(c);
  }).join('[^\\sa-z0-9]?');
}

const _alt = (words) => [...words].sort((a, b) => b.length - a.length).map(_tolerant).join('|');
const _head = (words, flags = 'g') => new RegExp(`(?<![a-z0-9])${CREDIT_PREFIX}(?:${_alt(words)})(?![a-z0-9])`, flags);
const STRICT_HEAD = _head(CREDIT_PARTICIPLES);
const BY_HEAD = _head([...CREDIT_PARTICIPLES, ...IDENTITY_PARTICIPLES, ...CREDIT_NOUNS, ...CREDIT_AGENTS]);
const COLON_HEAD = _head([...CREDIT_PARTICIPLES, ...IDENTITY_PARTICIPLES, ...CREDIT_AGENTS]);
const CREDIT_ANY = _head(CREDIT_FORMS, '');
// Separators within a clause (a sentence end, ';' or a line break ends it).
const SEP = '[^a-z0-9.;!?\\n]';
// "by" anywhere later in the clause, however many words come first ("reviewed
// for accuracy and compliance by"). A lazy scan of one character class: linear.
const BY_CLAUSE = /^[^.;!?\n]*?(?<![a-z0-9])b[^a-z0-9\n]?y(?![a-z0-9])/;
const COLON = /^[^\S\n]*[:|–—-]+/;
// A credit participle run into "by" inside a letter-spaced run ("reviewedby").
const SQUEEZED_CREDIT = new RegExp(`(${CREDIT_PARTICIPLES.map((w) => w.replace(/[^a-z]/g, '')).join('|')})by`, 'g');
// A service the agency sells, not a credit ("coverage reviews", "a premium
// audit", "policy endorsements"), unless a colon, a dash or "by" follows it
// ("Policy review: <name>", "coverage review by <name>").
const SERVICE = new RegExp('(?<![a-z0-9])(?:coverage|policy|policies|insurance|annual|yearly|premium|rate|claims?|risk|renewal|benefits?|plan|free|background|credit|payroll)'
  + '[^a-z0-9.;!?\\n]{1,3}(?:reviews?|audits?|checks?|endorsements?)(?![a-z0-9])'
  + '(?![^\\S\\n]*(?:[:|\\u2013\\u2014-]|b[^a-z0-9\\n]?y(?![a-z0-9])))', 'g');
// Where a sentence ends: '.', '!', '?', ';' or a line break. A '.' after an
// honorific or a single letter ("Ms. Royal", "J. Boone", "e.g.") or inside a
// word or number ("example.com", "2.5") does not end one.
const SENTENCE_END = /(?<!(?:^|[^a-z0-9])(?:mr|mrs|ms|miss|dr|mx|st|[a-z]))\.(?![a-z0-9])|[!?;\n]/;

/** Text as the credit test reads it (see the header). */
function claimFold(text) {
  let s = String(text === undefined || text === null ? '' : text);
  s = s.normalize('NFKC');
  s = s.replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '');
  s = s.normalize('NFKD').replace(/\p{M}/gu, '');
  s = s.toLowerCase();
  s = s.replace(/[^\x00-\x7f]/g, (c) => (Object.prototype.hasOwnProperty.call(CONFUSABLE, c) ? CONFUSABLE[c] : c));
  // Markdown: a link or image keeps its text; emphasis and code markers go.
  s = s.replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1');
  s = s.replace(/[*_`~]/g, '');
  // Letter-spaced words: "r e v i e w e d", "r.e.v.i.e.w.e.d" (one separator
  // between letters; a wider gap is a word break). A run spaced the same way
  // throughout comes out as one word: a credit inside it is split back out.
  s = s.replace(/(?<![a-z0-9])[a-z0-9](?:[^a-z0-9\n][a-z0-9](?![a-z0-9])){3,}/g,
    (m) => m.replace(/[^a-z0-9]/g, '').replace(SQUEEZED_CREDIT, '$1 by '));
  return s.replace(/[^\S\n]+/g, ' ');
}

function _members(team) {
  return (Array.isArray(team) ? team : []).filter((m) => m && typeof m === 'object');
}

/** The data/team.json member with this slug, or null. */
function teamMember(team, slug) {
  if (typeof slug !== 'string' || !slug) return null;
  return _members(team).find((m) => m.slug === slug) || null;
}

/**
 * The identities a credit may not name, as patterns:
 *   named      every team member's full name, first name, and honorific and
 *              surname ("Ms. Royal"): read from the start of the text after
 *              "by" (or the colon), up to four words in, a credit naming one
 *              is refused wherever it stands;
 *   generic    the agency, a licensed agent, a team title, "our" staff, read
 *              the same way: refused when the credit is about the text itself
 *              (see _aboutTheText), not in advice such as "have your policy
 *              reviewed by a licensed agent";
 *   inSentence a team member's name anywhere (the sentence rule);
 *   names      the same plus a surname alone, anywhere: blanked before a
 *              value is searched for a credit word, so a name that contains
 *              one is not itself a credit;
 *   anyStrict  any of the above, a surname alone, a team title, and
 *              IDENTITY_WORDS, anywhere (a front-matter value).
 * The last name alone counts only in a front-matter value: in the body it is
 * also a place name here ("inspected by Boone County").
 */
function _identityPatterns(team) {
  const named = [];
  const surnames = [];
  const generic = [...FIXED_IDENTITIES];
  const titles = [];
  for (const m of _members(team)) {
    const tokens = claimFold(m.name).split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.length) named.push(tokens.map(_escapeRe).join('[^a-z0-9\\n]+'));
    if (tokens.length > 1 && tokens[0].length >= 3) named.push(_escapeRe(tokens[0]));
    if (tokens.length > 1) {
      const last = tokens[tokens.length - 1];
      named.push(`${HONORIFIC}[^a-z0-9\\n]{1,2}${_escapeRe(last)}`);
      if (last.length >= 3) surnames.push(_escapeRe(last));
    }
    for (const part of String(m.title || '').split('/')) {
      const tt = claimFold(part).split(/[^a-z0-9]+/).filter(Boolean);
      if (tt.length >= 2) generic.push(tt.map(_escapeRe).join('[^a-z0-9\\n]+'));
      if (tt.length) titles.push(tt.map(_escapeRe).join('[^a-z0-9\\n]+'));
    }
  }
  const within = (alts) => (alts.length
    ? new RegExp(`^${SEP}*(?:(?:${HONORIFIC}\\.|[a-z]\\.|[a-z0-9'&-]+)${SEP}+){0,4}?(?:${alts.join('|')})(?![a-z0-9])`)
    : null);
  const anywhere = (alts, flags = '') => (alts.length ? new RegExp(`(?<![a-z0-9])(?:${alts.join('|')})(?![a-z0-9])`, flags) : null);
  return {
    named: within(named),
    generic: within(generic),
    inSentence: anywhere(named),
    names: anywhere([...named, ...surnames], 'g'),
    anyStrict: anywhere([...named, ...surnames, ...generic, ...titles, ...IDENTITY_WORDS]),
  };
}

// The clause before a credit is about the text itself: the credit opens its
// sentence or line ("Reviewed by our licensed agents."), or the clause names
// the text ("This article was reviewed by ...", "Every answer here is checked
// by ...").
const ABOUT_THE_TEXT = /^[^a-z0-9]*$|(?<![a-z0-9])(?:article|post|guide|page|content|piece|blog|story|resource|information|faq|checklist|text|copy|answers?|here)s?(?![a-z0-9])/;
// How far back a clause is read. Bounded so a body with thousands of
// candidate credits is checked in linear time (SAGE runs this inside a
// request; an unbounded look-back made it quadratic).
const CLAUSE_WINDOW = 400;
function _aboutTheText(folded, index) {
  const from = Math.max(0, index - CLAUSE_WINDOW);
  const before = folded.slice(from, index);
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf(';'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n'), before.lastIndexOf('#'));
  // A clause longer than the window is read from the window's start: it
  // cannot then "open its sentence", only name the text.
  const clause = before.slice(start + 1);
  return start < 0 && from > 0 ? ABOUT_THE_TEXT.test(clause) && !/^[^a-z0-9]*$/.test(clause) : ABOUT_THE_TEXT.test(clause);
}

const _snippet = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 80);
const _blank = (s, re) => (re ? s.replace(re, (m) => ' '.repeat(m.length)) : s);

/** The credit in already-folded text, or null (see reviewClaimIn). */
function _claimIn(folded, ids, strict) {
  // A service is not a credit word; a team member's name that happens to
  // contain one ("Test Reviewer A") is not one either.
  const words = _blank(_blank(folded, SERVICE), ids.names);
  if (strict) {
    for (const m of folded.matchAll(STRICT_HEAD)) {
      const tail = folded.slice(m.index + m[0].length, m.index + m[0].length + 300);
      const by = BY_CLAUSE.exec(tail);
      if (by) return _snippet(m[0] + by[0]);
    }
  }
  if (strict === true) {
    const credit = CREDIT_ANY.exec(words);
    const who = credit && ids.anyStrict ? ids.anyStrict.exec(folded) : null;
    if (credit && who) {
      const [a, b] = credit.index < who.index ? [credit.index, who.index + who[0].length] : [who.index, credit.index + credit[0].length];
      return _snippet(folded.slice(a, b));
    }
  }
  for (const [head, link] of [[BY_HEAD, BY_CLAUSE], [COLON_HEAD, COLON]]) {
    for (const m of folded.matchAll(head)) {
      const tail = folded.slice(m.index + m[0].length, m.index + m[0].length + 240);
      const l = link.exec(tail);
      if (!l) continue;
      const after = tail.slice(l[0].length);
      const who = (ids.named && ids.named.exec(after)) || (ids.generic && _aboutTheText(folded, m.index) && ids.generic.exec(after));
      if (who) return _snippet(m[0] + l[0] + who[0]);
    }
  }
  // A sentence with a credit word and a team member's name, in any order.
  if (ids.inSentence && strict !== 'by') {
    let at = 0;
    for (const sentence of folded.split(SENTENCE_END)) {
      const from = folded.indexOf(sentence, at);
      at = from + sentence.length;
      if (!ids.inSentence.test(sentence)) continue;
      if (CREDIT_ANY.test(words.slice(from, at))) return _snippet(sentence);
    }
  }
  return null;
}

/**
 * The review or approval credit `text` states, as folded text, or null.
 * strict (a front-matter value): a credit participle followed by "by" with
 * any object, or a credit word in any form beside any identity. Always: a
 * credit naming a team member (after "by" or a colon, or anywhere in the same
 * sentence), or naming the agency, a licensed agent or our staff about the
 * text itself. strict 'by' (a slug or image path, printed only inside URLs):
 * the "by" and colon rules only, not the anywhere and sentence rules.
 */
function reviewClaimIn(text, team, { strict = false } = {}) {
  return _claimIn(claimFold(text), _identityPatterns(team), strict);
}

const _unquote = (v) => ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")) ? v.slice(1, -1) : v);
const _isReviewKey = (key) => REVIEW_KEYS.includes(String(key).trim().toLowerCase());

/**
 * The front matter as the renderer reads it, or null when it has none:
 * { lines: [{key, value}], meta: {key: value, the last line winning}, body }.
 */
function frontMatterOf(md) {
  const s = String(md === undefined || md === null ? '' : md);
  const m = FRONT_MATTER.exec(s);
  if (!m) return null;
  const lines = [];
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = _unquote(line.slice(idx + 1).trim());
    lines.push({ key, value });
    meta[key] = value;
  }
  return { lines, meta, body: s.slice(m[0].length) };
}

// ─── The body as the page prints it ─────────────────────────────────────────
//
// These mirror scripts/generate-blog.js (markdownToHtml, extractFAQs); the
// site renderer also checks the text it actually rendered.

// A line the renderer prints as a block of its own: a heading (##, ###,
// ####), a list item ("- ", "1. "), a stat, a rule, a blockquote ("> ").
const _lineKind = (line) => {
  if (!line.trim()) return 'blank';
  if (/^#{2,4} ./.test(line) || /^- ./.test(line) || /^\d+\. ./.test(line) || /^!!!stat /.test(line) || line === '---') return 'block';
  return /^> ./.test(line) ? 'quote' : 'text';
};

/** The body with every line break the page prints as a space folded into one. */
function _printedLines(body) {
  const out = [];
  let prev = null;
  for (const line of String(body).split('\n')) {
    const kind = _lineKind(line);
    if (out.length && kind === prev && (kind === 'text' || kind === 'quote')) out[out.length - 1] += ` ${kind === 'quote' ? line.slice(2) : line}`;
    else out.push(line);
    prev = kind;
  }
  return out.join('\n');
}

/** The FAQ items as the page and the FAQPage JSON-LD print them (extractFAQs). */
function _faqs(body) {
  const faqs = [];
  const re = /### FAQ: (.+?)\n\n([\s\S]*?)(?=\n###|\n## |$)/g;
  let m;
  while ((m = re.exec(String(body).trim())) !== null) faqs.push({ question: m[1].trim(), answer: m[2].trim().replace(/\n/g, ' ') });
  return faqs;
}

/**
 * The texts a post's body puts on the page: the body as written, the body
 * with in-paragraph line breaks folded, and each FAQ question and answer as
 * printed.
 */
function bodyViews(md) {
  const fm = frontMatterOf(md);
  const body = fm ? fm.body : String(md === undefined || md === null ? '' : md);
  const views = [body, _printedLines(body)];
  for (const f of _faqs(body)) views.push(f.question, f.answer);
  return views;
}

/**
 * The byline author the renderer prints: the data/team.json member author_slug
 * names, with team.json's name and title, or null (the agency is the author).
 * The front matter's author and author_title are never printed, so a member's
 * new title or name shows on their posts as team.json gives it, and a slug
 * naming no member (one who left) prints the agency.
 */
function bylineAuthor(meta, team) {
  const slug = meta && typeof meta.author_slug === 'string' ? meta.author_slug : '';
  if (!SAFE_SLUG_RE.test(slug)) return null;
  const member = teamMember(team, slug);
  if (!member || typeof member.name !== 'string' || !member.name.trim()) return null;
  return { slug, name: member.name, title: typeof member.title === 'string' ? member.title : '' };
}

const _show = (key) => JSON.stringify(String(key).replace(/[^\x20-\x7E]/g, '?').slice(0, 40));

/**
 * Why a post's front matter must not publish or render, or null. Who the
 * byline names is not a reason (see bylineAuthor and bylineProblem): a
 * data/team.json edit must never take a live post off the site.
 * @param {string} md    the markdown file
 * @param {Array} team   data/team.json's team list (a credit naming a member is refused)
 */
function frontMatterProblem(md, team) {
  const fm = frontMatterOf(md);
  if (!fm) return null;
  for (const { key, value } of fm.lines) {
    if (/[<>]/.test(key) || /[<>]/.test(value)) return `the front-matter line ${_show(key)} carries '<' or '>'`;
    if (!FM_ALLOWED.test(key) || !FM_ALLOWED.test(value)) {
      return `the front-matter line ${_show(key)} carries a character other than letters, digits and common punctuation (an invisible, control, combining or look-alike character)`;
    }
    if (SLUG_KEYS.includes(key) && !SAFE_SLUG_RE.test(value)) return `the front-matter ${key} is not lower-case letters, digits and hyphens`;
    if (DATE_KEYS.includes(key) && !DATE_RE.test(value)) return `the front-matter ${key} is not a YYYY-MM-DD date`;
    if (key === 'reading_time' && !READING_TIME_RE.test(value)) return 'the front-matter reading_time is not "<minutes> min" or "<minutes> min read"';
    if (_isReviewKey(key)) continue;
    // A slug or an image path is printed only inside URLs: it gets the "by"
    // rules, not the anywhere ones ("what-your-agent-checks" is a path).
    const claim = reviewClaimIn(value, team, { strict: URL_KEYS.includes(key) ? 'by' : true });
    if (claim) return `the front-matter ${_show(key)} states a review or approval credit ("${claim}")`;
  }
  return null;
}

/**
 * Why the byline fields of NEW text are not consistent, or null: an
 * author_slug that names no data/team.json member, or an author or
 * author_title that is not that member's. sage-server refuses this before a
 * BL-06 promote commits a draft. The renderer only warns: it prints the member
 * (bylineAuthor), or the agency when the slug names no one.
 */
function bylineProblem(md, team) {
  const fm = frontMatterOf(md);
  if (!fm || fm.meta.author_slug === undefined) return null;
  const { meta } = fm;
  const member = teamMember(team, meta.author_slug);
  if (!member) return `the front-matter author_slug ${_show(meta.author_slug)} names no data/team.json member`;
  if (meta.author !== undefined && meta.author !== member.name) return `the front-matter author is not the name data/team.json gives ${member.slug} (the byline prints the team member's name)`;
  if (meta.author_title !== undefined && meta.author_title !== (typeof member.title === 'string' ? member.title : '')) {
    return `the front-matter author_title is not the title data/team.json gives ${member.slug} (the byline prints the team member's title)`;
  }
  return null;
}

/**
 * Why a post's body must not publish or render (it states a review or approval
 * credit naming a team member, the agency, a licensed agent or our staff, in
 * any text the page prints from it: bodyViews), or null.
 */
function bodyProblem(md, team) {
  const ids = _identityPatterns(team);
  for (const view of bodyViews(md)) {
    const claim = _claimIn(claimFold(view), ids, false);
    if (claim) return `the article body states a review or approval credit ("${claim}"); a credit is earned only by the reviewer's approval in SAGE, and the byline prints it`;
  }
  return null;
}

module.exports = {
  FRONT_MATTER,
  SAFE_SLUG_RE,
  READING_TIME_RE,
  SLUG_KEYS,
  REVIEW_KEYS,
  AGENCY_AUTHOR,
  FM_ALLOWED,
  claimFold,
  reviewClaimIn,
  teamMember,
  frontMatterOf,
  bodyViews,
  bylineAuthor,
  bylineProblem,
  frontMatterProblem,
  bodyProblem,
};

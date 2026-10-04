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
 * prints it, in the byline and the JSON-LD reviewedBy, from the data/team.json
 * member that approval is bound to (review-credit.js), never from any text in
 * the post. That structured credit is the only credit code can vouch for.
 * This file holds two kinds of rule.
 *
 * DETERMINISTIC RULES: a post that breaks one does not publish or render.
 *   Byline identity: an allowlist, not a wording test
 *     author_slug   names a data/team.json member, or is absent; the byline
 *                   prints that member's name and title from data/team.json
 *                   (bylineAuthor), never the front matter's author or
 *                   author_title, and the agency (AGENCY_AUTHOR) without one.
 *                   A slug that names no member (one who left) prints the
 *                   agency: the post still renders.
 *     author, author_title  never printed. A BL-06 promote (new text entering
 *                   src/blog/) also requires them to be that member's, and
 *                   author_slug to be absent on an AI draft unless that member
 *                   approves it (bylineProblem; sage-server blog-publication.js)
 *   Every front-matter value (frontMatterProblem)
 *     - no '<' or '>' (markup);
 *     - no character that prints as nothing or changes how the text around
 *       it reads (UNSAFE_CHAR): control characters, format characters (soft
 *       hyphen, zero-width characters, bidi marks, embeddings, overrides and
 *       isolates, the byte-order mark, tag characters), other invisible
 *       characters (Hangul fillers, variation selectors), U+2028/U+2029, lone
 *       surrogates and noncharacters (which also make the RSS feed invalid
 *       XML). An emoji's own joiners, presentation selectors, keycap and
 *       flag tags are part of the emoji and allowed. Every other printable
 *       character is allowed: letters of any script, accents, arrows,
 *       symbols, emoji. The renderer encodes every value; look-alike and
 *       full-width letters matter only to the wording warnings, which fold
 *       them (fix round 1 after the scope decision: an arrow in a title took
 *       a live post down);
 *     - slug, author_slug and reviewer_slug are lower-case letters, digits
 *       and hyphens;
 *     - date and modified are YYYY-MM-DD.
 *   The whole post, front matter and body (sage-server BL-54, AIA-089)
 *     - no "javascript:" in any case. A built blog page that carries it fails
 *       the site build (scripts/lib/blog-html-guard.js), which halts every
 *       deploy; refused here, a post never reaches main through SAGE and is
 *       not rendered by the site, so the build never sees it. No post needs
 *       the text: the renderer prints no such link.
 *   reading_time is not a rule: the renderer prints it only when it is
 *     "<1-3 digits> min" or "<1-3 digits> min read" (READING_TIME_RE), and
 *     the time it computes otherwise (it logs that it did).
 *
 * WORDING: a warning, never a refusal (reviewWordingWarnings).
 *   Free text can always say a review happened, and every tighter wording
 *   rule refused more legitimate posts ("Check with your agent" in a title).
 *   So text that reads as a review or approval credit is flagged, not
 *   refused: SAGE shows the flag next to the exact text in the approval page
 *   of an AI draft (BL-06) and of an AI-proposed edit (BL-07), where a person
 *   approves those exact bytes, and the site's build logs it. The post
 *   renders as written, and carries no structured credit unless its reviewer
 *   approved it in SAGE. What is flagged:
 *   Front-matter values: a value is short, so word order and distance are
 *     not weighed. A credit word in any form (review, reviewed, reviewer,
 *     approve, approval, vet, verify, check, fact-check, endorse, certify,
 *     audit, sign off, proofread, edit, validate, ...) ANYWHERE beside an
 *     identity ANYWHERE (a team member's full name, first name or surname, the
 *     agency, "licensed", agent, principal, producer, staff, expert, a team
 *     title); a credit participle followed by "by" with any object, however
 *     many words lie between them in the clause ("Reviewed for accuracy and
 *     compliance by ..."). A service the agency sells is not a credit:
 *     "coverage review", "premium audit", "policy endorsement" (unless a
 *     colon, a dash or "by" follows it). A slug or image path, printed only
 *     inside URLs, gets the "by" and colon rules but not the anywhere ones.
 *     The review keys themselves (reviewer, reviewer_slug, ...) are the
 *     signed credit's own lines: the publisher writes them and strips any
 *     others, so they are not read here.
 *   The body, read the way the page prints it: the renderer prints a single
 *     line break inside a paragraph or a blockquote as a space, and joins an
 *     FAQ answer's lines (blank ones too) with spaces, in the page and in the
 *     FAQPage JSON-LD. So the body is read as written, with those line breaks
 *     folded, and each FAQ question and answer as printed (bodyViews). In
 *     each: a sentence that has a credit word in any form or voice and a team
 *     member's full name, first name or honorific and surname ("Ms. Royal"),
 *     in any order and at any distance; a review or approval credit naming
 *     the agency, a licensed agent, a team title or "our" staff about the
 *     text itself (not "approved by the state", "inspected by the health
 *     department" or "have it reviewed by a licensed agent").
 *
 * Wording is read through Unicode compatibility folding (full-width and
 * mathematical letters), with invisible characters removed, accents stripped,
 * Cyrillic, Greek and other look-alike letters mapped to Latin, digits and
 * symbols standing in for letters ("Rev1ewed"), punctuation or markdown
 * emphasis inside a word ("Re-viewed", "Re**viewed**") and letter-spaced
 * words ("R e v i e w e d") collapsed. It is best effort: no list holds every
 * way to say "reviewed", which is why it only warns.
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

// A character no front-matter key or value may contain: one that prints as
// nothing, or changes how the text around it reads, or breaks a sink
// (see the header). Control (Cc), format (Cf: soft hyphen, zero-width
// characters, bidi marks, embeddings, overrides and isolates, the BOM, tag
// characters), surrogate (Cs), line and paragraph separators (Zl, Zp), the
// other default-ignorable characters (Hangul fillers, variation selectors,
// the combining grapheme joiner) and noncharacters (U+FFFE, U+FFFF, ...;
// not valid in XML). Everything else is printable and allowed.
const UNSAFE_CHAR = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}]/u;
// An emoji, with the zero-width joiners (U+200D), presentation selectors
// (U+FE0E, U+FE0F), skin tones, keycap (U+20E3) and subdivision-flag tags
// that are part of it: a warning sign with U+FE0F, a family of three people
// joined by U+200D, a digit with U+FE0F U+20E3. Removed before UNSAFE_CHAR is
// tested, so only a joiner, selector or tag outside an emoji is refused.
const EMOJI_SEQUENCE = /[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?)*/gu;

/** Whether `s` carries a character outside an emoji that UNSAFE_CHAR refuses. */
function hasUnsafeChar(s) {
  return UNSAFE_CHAR.test(String(s === undefined || s === null ? '' : s).replace(EMOJI_SEQUENCE, ''));
}

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
// by". Flagged in any front-matter value; in the body only with an identity.
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
// beside an identity is flagged, and so is a body sentence with one beside a
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
// Fixed identities a credit in the body is flagged for naming (the team's
// names and titles are added from data/team.json).
const FIXED_IDENTITIES = [
  'the way agency', 'way agency', 'agency principal',
  'licensed (?:[a-z]+ ){0,2}?(?:agents?|producers?|professionals?)',
  'our (?:[a-z\'-]+ ){0,2}?(?:team|agents?|staff|producers?|principal|experts?|specialists?|advisors?|advisers?|professionals?|licensed|editors?|reviewers?|agency)',
];
// Identities a front-matter value is flagged for putting beside a credit word,
// on top of the team's names and titles and FIXED_IDENTITIES.
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
 * The identities a credit is flagged for naming, as patterns:
 *   named      every team member's full name, first name, and honorific and
 *              surname ("Ms. Royal"): read from the start of the text after
 *              "by" (or the colon), up to four words in, a credit naming one
 *              is flagged wherever it stands;
 *   generic    the agency, a licensed agent, a team title, "our" staff, read
 *              the same way: flagged when the credit is about the text itself
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
// site renderer also reads the text it actually rendered.

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

// The literal the site build refuses on any blog page (blog-html-guard.js).
const SCRIPT_URL_TEXT_RE = /javascript:/i;

/**
 * Why a post's front matter must not publish or render, or null: one of the
 * deterministic rules (markup, an invisible, control or bidi character, a
 * slug or date that is not its plain form, and anywhere in the post the text
 * "javascript:"; see the header). Wording is never
 * a reason (reviewWordingWarnings), and neither is who the byline names
 * (bylineAuthor, bylineProblem): a data/team.json edit must never take a live
 * post off the site. Nor is a reading_time that is not "N min" or "N min
 * read": the renderer prints the computed time instead.
 * @param {string} md  the markdown file
 */
function frontMatterProblem(md) {
  if (SCRIPT_URL_TEXT_RE.test(String(md === undefined || md === null ? '' : md))) {
    return 'the post carries the text "javascript:", which the site build refuses on any blog page';
  }
  const fm = frontMatterOf(md);
  if (!fm) return null;
  for (const { key, value } of fm.lines) {
    if (/[<>]/.test(key) || /[<>]/.test(value)) return `the front-matter line ${_show(key)} carries '<' or '>'`;
    if (hasUnsafeChar(key) || hasUnsafeChar(value)) {
      return `the front-matter line ${_show(key)} carries an invisible, control or bidi character (a zero-width, soft-hyphen, direction or line-separator character, or a control code)`;
    }
    if (SLUG_KEYS.includes(key) && !SAFE_SLUG_RE.test(value)) return `the front-matter ${key} is not lower-case letters, digits and hyphens`;
    if (DATE_KEYS.includes(key) && !DATE_RE.test(value)) return `the front-matter ${key} is not a YYYY-MM-DD date`;
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

// ─── Wording: warnings, never refusals ──────────────────────────────────────

/** What a review-wording warning tells the person looking at the text. */
const REVIEW_WORDING_NOTICE = 'This text contains review-credit wording; only the signed byline is a verified credit.';
const WARNING_TEXT_MAX = 500;
// Past this many, a post's remaining wording is not listed (a page of them
// helps nobody; the first ones say what to look for).
const WARNINGS_MAX = 50;

const _excerpt = (s) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > WARNING_TEXT_MAX ? `${t.slice(0, WARNING_TEXT_MAX - 3)}...` : t;
};

/** Each sentence of `text` that carries wording, as [sentence, wording]; else [[text, wording]]. */
function _flaggedSentences(text, wording, ids, strict) {
  const sentences = text.split(/(?<=[.!?;])\s+/);
  const found = [];
  if (sentences.length > 1) {
    for (const s of sentences) {
      const w = _claimIn(claimFold(s), ids, strict);
      if (w) found.push([s, w]);
    }
  }
  return found.length ? found : [[text, wording]];
}

/**
 * Review or approval credit wording in the text a post prints, as warnings
 * (see the header). Never a reason to refuse a post: the post renders as
 * written, and only a signed approval prints a structured credit.
 * @param {string} md    the markdown file
 * @param {Array} team   data/team.json's team list (wording naming a member is flagged)
 * @returns {Array<{field: string, text: string, wording: string}>}
 *   field    the front-matter key, 'body' or 'FAQ'
 *   text     the exact text as written: the front-matter value, or each
 *            sentence (else the paragraph) that carries the wording, cut at
 *            500 characters; at most 50 warnings
 *   wording  what was read as a credit, folded (lower case, look-alikes mapped)
 */
function reviewWordingWarnings(md, team) {
  const ids = _identityPatterns(team);
  const out = [];
  const inBody = (field) => field === 'body' || field === 'FAQ';
  const add = (field, text, wording) => {
    if (out.length >= WARNINGS_MAX) return;
    const t = _excerpt(text);
    // The body is read in views that overlap: one warning per passage.
    const seen = out.some((w) => (inBody(field)
      ? inBody(w.field) && (w.text.includes(t) || t.includes(w.text))
      : w.field === field && w.text === t));
    if (!seen) out.push({ field, text: t, wording });
  };
  const fm = frontMatterOf(md);
  for (const { key, value } of fm ? fm.lines : []) {
    if (_isReviewKey(key)) continue;
    // A slug or an image path is printed only inside URLs: it gets the "by"
    // rules, not the anywhere ones ("what-your-agent-checks" is a path).
    const strict = URL_KEYS.includes(key) ? 'by' : true;
    const wording = _claimIn(claimFold(value), ids, strict);
    if (wording) add(key, value, wording);
  }
  const [asWritten, printed, ...faq] = bodyViews(md);
  for (const [field, texts] of [['body', [...printed.split('\n'), ...asWritten.split('\n')]], ['FAQ', faq]]) {
    for (const text of texts) {
      if (!text.trim()) continue;
      const wording = _claimIn(claimFold(text), ids, false);
      if (wording) for (const [sentence, w] of _flaggedSentences(text, wording, ids, false)) add(field, sentence, w);
    }
  }
  return out;
}

module.exports = {
  FRONT_MATTER,
  SAFE_SLUG_RE,
  READING_TIME_RE,
  SLUG_KEYS,
  REVIEW_KEYS,
  AGENCY_AUTHOR,
  UNSAFE_CHAR,
  hasUnsafeChar,
  claimFold,
  reviewClaimIn,
  teamMember,
  frontMatterOf,
  bodyViews,
  bylineAuthor,
  bylineProblem,
  frontMatterProblem,
  REVIEW_WORDING_NOTICE,
  reviewWordingWarnings,
};

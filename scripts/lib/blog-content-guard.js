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
 *     author_slug   names a data/team.json member, or is absent
 *     author        with author_slug: that member's name exactly, or absent
 *     author_title  with author_slug: that member's title exactly, or absent
 *                   (the renderer prints the member's name and title from
 *                   data/team.json, never these fields; without author_slug
 *                   the byline is "Written by The Way Agency" and neither
 *                   field is printed)
 *     reading_time  "<1-3 digits> min" or "<1-3 digits> min read"
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
 *     - no review or approval credit ("Reviewed by", "Approved by", "Vetted
 *       by", "Fact-checked by", "Verified by", ... with any object), and none
 *       naming a team member, the agency or a licensed agent ("Reviewer:
 *       <name>", "Review by <name>", "Certified by <name>").
 *       The review keys themselves (reviewer, reviewer_slug, ...) are the
 *       signed credit's own lines: the publisher writes them and strips any
 *       others, so they are not wording-checked here.
 *   The body
 *     - no review or approval credit naming a team member, the agency, a
 *       licensed agent or "our" staff (the body may well say "approved by the
 *       state" or "inspected by the health department").
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
const CREDIT_PREFIX = '(?:(?:fact|double|pre|peer|co|expert|human|agent|hand)[^a-z0-9\\n]{0,2})?';
// Words allowed between a participle and "by" in a front-matter credit.
const INTERVENING = ['and', 'or', 'then', 'also', 'for', 'accuracy', 'compliance', 'content', 'quality', 'personally',
  'carefully', 'independently', 'fully', 'thoroughly', 'professionally', 'expertly', 'manually', 'officially', 'formally',
  'internally', 'legally', 'medically', 'expert', 'human'];
// Fixed identities a credit in the body may not name (the team's names and
// titles are added from data/team.json).
const FIXED_IDENTITIES = [
  'the way agency', 'way agency', 'agency principal',
  'licensed (?:[a-z]+ ){0,2}?(?:agents?|producers?|professionals?)',
  'our (?:[a-z\'-]+ ){0,2}?(?:team|agents?|staff|producers?|principal|experts?|specialists?|advisors?|advisers?|professionals?|licensed|editors?|reviewers?|agency)',
];

const _escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A claim word as a pattern: look-alike digits and one stray symbol allowed between letters. */
function _tolerant(word) {
  return [...word].map((c) => {
    if (c === ' ' || c === '-') return '[^a-z0-9\\n]{0,3}';
    return LOOK[c] ? `[${_escapeRe(LOOK[c])}]` : _escapeRe(c);
  }).join('[^\\sa-z0-9]?');
}

const _alt = (words) => [...words].sort((a, b) => b.length - a.length).map(_tolerant).join('|');
const _head = (words) => new RegExp(`(?<![a-z0-9])${CREDIT_PREFIX}(?:${_alt(words)})(?![a-z0-9])`, 'g');
const STRICT_HEAD = _head(CREDIT_PARTICIPLES);
const BY_HEAD = _head([...CREDIT_PARTICIPLES, ...IDENTITY_PARTICIPLES, ...CREDIT_NOUNS, ...CREDIT_AGENTS]);
const COLON_HEAD = _head([...CREDIT_PARTICIPLES, ...IDENTITY_PARTICIPLES, ...CREDIT_AGENTS]);
// Separators within a clause (a sentence end, ';' or a line break ends it).
const SEP = '[^a-z0-9.;!?\\n]';
const BY = 'b[^a-z0-9\\n]?y(?![a-z0-9])';
const BY_STRICT = new RegExp(`^(?:${SEP}+(?:${INTERVENING.join('|')}|${_alt(CREDIT_PARTICIPLES)})){0,3}${SEP}*${BY}`);
const BY_LOOSE = new RegExp(`^(?:${SEP}+[a-z0-9'-]+){0,3}?${SEP}*${BY}`);
const COLON = /^[^\S\n]*[:|\u2013\u2014-]+/;
// A credit participle run into "by" inside a letter-spaced run ("reviewedby").
const SQUEEZED_CREDIT = new RegExp(`(${CREDIT_PARTICIPLES.map((w) => w.replace(/[^a-z]/g, '')).join('|')})by`, 'g');

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
 * The identities a credit may not name, as two patterns read from the start of
 * the text after "by" (or the colon), up to four words in:
 *   named    every team member's full name and first name: a credit naming
 *            one is refused wherever it stands;
 *   generic  the agency, a licensed agent, a team title, "our" staff: refused
 *            when the credit is about the text itself (see _aboutTheText),
 *            not in advice such as "have your policy reviewed by a licensed
 *            agent".
 */
function _identityPatterns(team) {
  const named = [];
  const generic = [...FIXED_IDENTITIES];
  for (const m of _members(team)) {
    const tokens = claimFold(m.name).split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.length) named.push(tokens.map(_escapeRe).join('[^a-z0-9\\n]+'));
    // The first name too ("Reviewed by Sheilia"); not the last name alone,
    // which is also a place name here ("inspected by Boone County").
    if (tokens.length > 1 && tokens[0].length >= 3) named.push(_escapeRe(tokens[0]));
    for (const part of String(m.title || '').split('/')) {
      const tt = claimFold(part).split(/[^a-z0-9]+/).filter(Boolean);
      if (tt.length >= 2) generic.push(tt.map(_escapeRe).join('[^a-z0-9\\n]+'));
    }
  }
  const within = (alts) => (alts.length
    ? new RegExp(`^${SEP}*(?:(?:[a-z]\\.|[a-z0-9'&-]+)${SEP}+){0,4}?(?:${alts.join('|')})(?![a-z0-9])`)
    : null);
  return { named: within(named), generic: within(generic) };
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

/**
 * The review or approval credit `text` states, as folded text, or null.
 * strict (front matter): a credit participle followed by "by" counts with any
 * object. Always: a credit naming a team member, or naming the agency, a
 * licensed agent or our staff about the text itself.
 */
function reviewClaimIn(text, team, { strict = false } = {}) {
  const folded = claimFold(text);
  if (strict) {
    for (const m of folded.matchAll(STRICT_HEAD)) {
      const tail = folded.slice(m.index + m[0].length, m.index + m[0].length + 200);
      const by = BY_STRICT.exec(tail);
      if (by) return _snippet(m[0] + by[0]);
    }
  }
  const { named, generic } = _identityPatterns(team);
  for (const [head, link] of [[BY_HEAD, BY_LOOSE], [COLON_HEAD, COLON]]) {
    for (const m of folded.matchAll(head)) {
      const tail = folded.slice(m.index + m[0].length, m.index + m[0].length + 240);
      const l = link.exec(tail);
      if (!l) continue;
      const after = tail.slice(l[0].length);
      const who = (named && named.exec(after)) || (generic && _aboutTheText(folded, m.index) && generic.exec(after));
      if (who) return _snippet(m[0] + l[0] + who[0]);
    }
  }
  return null;
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

/**
 * The byline author the renderer prints: the data/team.json member author_slug
 * names, with that member's name and title, when author and author_title (if
 * present) are exactly theirs; otherwise null (the agency is the author).
 */
function bylineAuthor(meta, team) {
  const slug = meta && typeof meta.author_slug === 'string' ? meta.author_slug : '';
  if (!SAFE_SLUG_RE.test(slug)) return null;
  const member = teamMember(team, slug);
  if (!member || typeof member.name !== 'string' || !member.name.trim()) return null;
  const title = typeof member.title === 'string' ? member.title : '';
  if (meta.author !== undefined && meta.author !== member.name) return null;
  if (meta.author_title !== undefined && meta.author_title !== title) return null;
  return { slug, name: member.name, title };
}

const _show = (key) => JSON.stringify(String(key).replace(/[^\x20-\x7E]/g, '?').slice(0, 40));

/**
 * Why a post's front matter must not publish or render, or null.
 * @param {string} md    the markdown file
 * @param {Array} team   data/team.json's team list (author_slug is checked against it)
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
    const claim = reviewClaimIn(value, team, { strict: true });
    if (claim) return `the front-matter ${_show(key)} states a review or approval credit ("${claim}")`;
  }
  const { meta } = fm;
  if (meta.author_slug !== undefined) {
    const member = teamMember(team, meta.author_slug);
    if (!member) return `the front-matter author_slug "${meta.author_slug}" names no data/team.json member`;
    if (meta.author !== undefined && meta.author !== member.name) return `the front-matter author is not the name data/team.json gives ${member.slug} (the byline prints the team member's name)`;
    if (meta.author_title !== undefined && meta.author_title !== (typeof member.title === 'string' ? member.title : '')) {
      return `the front-matter author_title is not the title data/team.json gives ${member.slug} (the byline prints the team member's title)`;
    }
  }
  return null;
}

/**
 * Why a post's body must not publish or render (it states a review or approval
 * credit naming a team member, the agency, a licensed agent or our staff), or null.
 */
function bodyProblem(md, team) {
  const fm = frontMatterOf(md);
  const claim = reviewClaimIn(fm ? fm.body : md, team, { strict: false });
  return claim ? `the article body states a review or approval credit ("${claim}"); a credit is earned only by the reviewer's approval in SAGE, and the byline prints it` : null;
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
  bylineAuthor,
  frontMatterProblem,
  bodyProblem,
};

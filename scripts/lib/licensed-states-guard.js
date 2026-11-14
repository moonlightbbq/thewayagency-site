'use strict';
/**
 * The licensed-states guard (Y-74 PR-B; Y4 and Y0 review 2026-11-14): every
 * list of US states a built page prints agrees with data/entity.json
 * licensed_states, in BOTH directions:
 *
 *   1. a list that names a state the agency is not licensed in fails
 *      ("Kentucky, Indiana, Tennessee, and Ohio" after OH leaves entity.json);
 *   2. a list made only of licensed states that leaves one of them out fails
 *      ("KY, IN & TN" while OH is licensed: the owner's 11/14 complaint, "OH
 *      hasnt been added to all of the locations where our states are listed").
 *
 * A list is two or more state names, or two or more state abbreviations, joined
 * by commas, "and", "&" / "&amp;" or "/", anywhere in the file: text, FAQ
 * answers, JSON-LD and JSON-fed content. A single state is never a list.
 *
 * A list that is right for another reason (a person's own licences, geography,
 * a law that names other states, frozen or published blog text) passes only
 * through an explicit ALLOW rule naming the file, the exact states and why.
 * There is no blanket skip. scripts/build.js runs this over every built text
 * file next to the agency email guard; tests/licensed-states-guard.test.js
 * covers both directions.
 */
const fs = require('fs');
const path = require('path');
const { LEGACY_BLOG_PAGES } = require('./legacy-blog-pages');

const US_STATES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
});
const BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([c, n]) => [n.toLowerCase(), c]));
const NAME_ALT = Object.values(US_STATES).sort((a, b) => b.length - a.length).map((n) => n.replace(/ /g, '\\s+')).join('|');
const ABBR_ALT = Object.keys(US_STATES).join('|');
const SEP = '(?:\\s*,\\s*(?:and\\s+|&amp;\\s+|&\\s+)?|\\s+and\\s+|\\s*&amp;\\s*|\\s*&\\s*|\\s*\\/\\s*)';
const NAME_LIST = new RegExp(`\\b(?:${NAME_ALT})\\b(?:${SEP}\\b(?:${NAME_ALT})\\b)+`, 'g');
// Abbreviations only in upper case: "in", "or", "me" stay words.
const ABBR_LIST = new RegExp(`\\b(?:${ABBR_ALT})\\b(?:${SEP}\\b(?:${ABBR_ALT})\\b)+`, 'g');
const SEP_RE = new RegExp(SEP);

/** Every state list in `text`: [{ codes: ['IN','KY'], text }], codes sorted and unique. */
function findStateLists(text) {
  const out = [];
  for (const [re, kind] of [[NAME_LIST, 'name'], [ABBR_LIST, 'abbr']]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const codes = m[0].split(SEP_RE).map((t) => (kind === 'name' ? BY_NAME[t.replace(/\s+/g, ' ').trim().toLowerCase()] : t.trim()));
      out.push({ codes: [...new Set(codes)].sort(), text: m[0].replace(/\s+/g, ' ') });
    }
  }
  return out;
}

// The frozen hand-made pages as built. blog/index.html is the GENERATED listing
// (generate-blog.js overwrites the hand page), so it has its own rule below.
const FROZEN_BLOG = Object.freeze(Object.keys(LEGACY_BLOG_PAGES).filter((n) => n !== 'index.html').map((n) => `blog/${n}`));
const PUBLISHED_POST_REASON = 'published blog post text (dated, reviewed content); its state wording is updated in the Y-84 live clean-up batches, each on the owner\'s OK';

/**
 * The explicit exceptions: { file, codes ('IN,KY' sorted), reason }. A rule
 * allows that exact list in that exact file, nothing else.
 */
const ALLOW = Object.freeze([
  ...FROZEN_BLOG.map((file) => ({ file, codes: 'IN,KY,TN', reason: 'frozen hand-made blog page (byte-pinned, scripts/lib/legacy-blog-pages.js): its footer is never edited' })),
  { file: 'blog/earthquake-insurance.html', codes: 'KY,TN', reason: 'frozen hand-made blog page (byte-pinned): its own text' },
  { file: 'about/team.html', codes: 'IN,KY', reason: 'a team member\'s own licensed states (visible card and JSON-LD)' },
  { file: 'about/team.html', codes: 'IN,KY,TN', reason: 'Y0 ruling option (a): the two Ohio-licensed people\'s JSON-LD descriptions are unchanged (visible text only); flagged for the owner on the preview' },
  { file: 'privacy.html', codes: 'IN,KY,TN', reason: 'the "Residents of ..." sentence: owner call, unchanged and flagged on the preview (Y0)' },
  ...['about/careers.html', 'about/careers/apply.html', 'about/careers/employee-benefits-leader.html', 'about/careers/intern.html', 'about/careers/pc-insurance-agent.html']
    .map((file) => ({ file, codes: 'IN,KY,TN', reason: 'careers copy: unchanged by Y0 ruling (job territory), flagged for the owner on the preview' })),
  { file: 'forrest-frank-2026.html', codes: 'IN,KY,TN', reason: 'the ended sweepstakes page: unchanged by Y0 ruling (its official rules named the eligible states)' },
  ...['blog/community-involvement-2026.html', 'blog/community-spotlight-local-businesses.html', 'blog/how-independent-agents-save-money.html',
    'blog/how-to-read-declarations-page.html', 'blog/independent-vs-kentucky-farm-bureau-bullitt-county.html', 'blog/small-business-insurance-evansville-in.html',
    'blog/understanding-auto-insurance-coverage-options.html', 'blog/feed.xml']
    .map((file) => ({ file, codes: 'IN,KY,TN', reason: PUBLISHED_POST_REASON })),
  { file: 'blog/index.html', codes: 'IN,KY,TN', reason: 'the blog listing carries a published post\'s excerpt (Y-84)' },
  { file: 'blog/small-business-insurance-evansville-in.html', codes: 'IN,KY', reason: 'geography: a business working on both sides of the Ohio River' },
  { file: 'blog/kentucky-auto-insurance-guide.html', codes: 'IN,KY', reason: PUBLISHED_POST_REASON },
  { file: 'blog/understanding-auto-insurance-coverage-options.html', codes: 'IN,TN', reason: PUBLISHED_POST_REASON },
  { file: 'insurance/evansville-in.html', codes: 'IN,KY', reason: 'geography: the Tri-State hub (commuters and businesses across the Indiana and Kentucky line)' },
  { file: 'insurance/henderson-ky.html', codes: 'IN,KY', reason: 'geography: the Tri-State hub (businesses working in both Kentucky and Indiana)' },
  { file: 'insurance/memphis-tn.html', codes: 'AR,MS,TN', reason: 'geography: Memphis sits where Tennessee, Arkansas and Mississippi meet' },
  { file: 'insurance/fort-wayne-in.html', codes: 'MI,OH', reason: 'geography: specialist practices serving parts of Ohio and Michigan (a provider network fact, not a licensing claim)' },
  { file: 'life/disability.html', codes: 'CA,HI,NJ,NY,RI', reason: 'law: the states with their own short-term disability programs' },
  { file: 'life/disability.html', codes: 'CA,NJ,NY', reason: 'law: the states with their own short-term disability programs' },
]);

function allowed(rel, codes, allow) {
  const key = codes.join(',');
  return allow.find((r) => r.file === rel && r.codes === key) || null;
}

/**
 * Problems in one file's text against the licensed states.
 * @param {string} text
 * @param {string} rel  path relative to the build root, with forward slashes
 * @param {string[]} licensed  data/entity.json licensed_states
 * @param {object[]} [allow]  ALLOW by default
 * @returns {{ problems: string[], used: object[] }}
 */
function licensedStateProblems(text, rel, licensed, allow = ALLOW) {
  const lic = new Set(licensed);
  const want = [...lic].sort().join(',');
  const problems = [];
  const used = [];
  for (const l of findStateLists(text)) {
    const outside = l.codes.filter((c) => !lic.has(c));
    const omits = !outside.length && l.codes.length >= 2 && l.codes.join(',') !== want;
    if (!outside.length && !omits) continue;
    const rule = allowed(rel, l.codes, allow);
    if (rule) { used.push(rule); continue; }
    if (outside.length) problems.push(`${rel}: "${l.text}" names ${outside.join(', ')}, which data/entity.json does not license (licensed: ${want})`);
    else problems.push(`${rel}: "${l.text}" lists the agency's states but leaves out ${[...lic].filter((c) => !l.codes.includes(c)).join(', ')} (licensed: ${want})`);
  }
  return { problems, used };
}

const TEXT_FILE = /\.(html?|txt|json|xml|js|mjs)$/i;

/** The guard over a built tree. */
function licensedStateProblemsInTree(dir, licensed, allow = ALLOW) {
  const problems = [];
  const usedRules = new Set();
  let files = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!TEXT_FILE.test(e.name)) continue;
      files++;
      const rel = path.relative(dir, p).split(path.sep).join('/');
      const r = licensedStateProblems(fs.readFileSync(p, 'utf8'), rel, licensed, allow);
      problems.push(...r.problems);
      r.used.forEach((u) => usedRules.add(u));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { problems, files, usedRules: [...usedRules] };
}

module.exports = { US_STATES, ALLOW, FROZEN_BLOG, findStateLists, licensedStateProblems, licensedStateProblemsInTree };

#!/usr/bin/env node
/**
 * Out-of-area decline guard (ticket c2cc96ea).
 *
 * The agency writes personal / life / health only in KY, IN and TN. Commercial it
 * writes anywhere. Turning an out-of-area applicant away has gone wrong in four
 * distinct ways already, and each one is pinned here so it cannot come back.
 *
 *   1. The decline must NEVER mention commercial lines. We do write CL nationwide,
 *      but the owner was explicit that this is for us to know and not something to
 *      say to a personal-lines applicant we are declining. The first version ended
 *      "If you need commercial coverage, please call us and we can help." That is
 *      the exact sentence he asked us not to write. The words now live on the
 *      SERVER (one copy, GET /api/intake/rules), so this checks them there.
 *
 *   2. The State field must stay on STEP 1. It is step 1's "Continue" that calls
 *      trackPartial(true) — the request that persists the lead AND pages a
 *      producer. When the field sat on step 3, the state was always empty at the
 *      only moment the notification was decided.
 *
 *   3. This page must NOT keep its own idea of what is personal and what is
 *      commercial. It used to, and it disagreed with SAGE: dwelling_fire and
 *      special_event are commercial in the product grid and personal (or
 *      unrecognised) on the server, so the form waved a Texas applicant through
 *      and the server then declined them. PRODUCTS[].line is a DISPLAY fact; the
 *      licensing answer comes from the server's map. A local licence list — even a
 *      "fallback" one — is the bug, because a duplicate that can disagree WILL.
 *
 *   4. hideOutOfArea() must clear the decline everywhere showOutOfArea() put it,
 *      or a customer who corrects their state to Kentucky goes on reading that we
 *      cannot write them.
 *
 * Run standalone:  node scripts/check-intake-gate.js
 * Wired into scripts/build.js, so a regression fails the build.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'intake.html');
const SAGE_API = process.env.SAGE_API || 'https://sage.thewayagency.com';

function checkIntakeGate(srcFile) {
  const file = srcFile || SRC;
  const problems = [];
  if (!fs.existsSync(file)) return [`${file}: missing`];
  const html = fs.readFileSync(file, 'utf8');

  // ── 1. State is captured on step 1, before the producer is paged ────────────
  const step1 = html.match(/<div id="step-1"[\s\S]*?<div id="step-2"/);
  if (!step1) {
    problems.push('could not locate the step-1 card — the step markup changed shape');
  } else if (!/id="i_state"/.test(step1[0])) {
    problems.push('the State field (#i_state) is no longer inside step-1. Step 1 is what fires '
      + 'trackPartial(true), the call that persists the lead and pages a producer — if the state '
      + 'is not collected before that, the out-of-area gate has nothing to judge and every '
      + 'out-of-area applicant reaches a producer anyway.');
  }
  if (!/if \(mustDecline\(\)\)/.test(html)) {
    problems.push('nothing calls mustDecline() — the gate is not wired to any step, so nothing '
      + 'would actually be declined.');
  }

  // ── 2. ONE licence list, and it is not this one ────────────────────────────
  // The decision must come from the server's map (RULES.productLines), not from
  // PRODUCTS[].line, and not from a local copy of the licensed states.
  if (/const\s+SERVICE_STATES\s*=/.test(html)) {
    problems.push('intake.html declares its own SERVICE_STATES. The licensed-state list lives in '
      + 'SAGE (src/lib/product-lines.js) and is served by GET /api/intake/rules — a second copy here '
      + 'is exactly what let the two sides disagree.');
  }
  const ruleFn = html.match(/function lineRuleFor\([\s\S]*?\n}/);
  if (!ruleFn) {
    problems.push('lineRuleFor() is gone — the personal-vs-commercial decision must stay in one '
      + "named function that reads the server's map.");
  } else {
    if (!/RULES\.productLines/.test(ruleFn[0])) {
      problems.push("lineRuleFor() no longer reads RULES.productLines (the server's map). If it is "
        + 'classifying products locally again, the site and the server can disagree about what is '
        + 'commercial — which is ticket c2cc96ea.');
    }
    if (/getProductLine\(/.test(ruleFn[0])) {
      problems.push('lineRuleFor() calls getProductLine(), which returns the DISPLAY line — '
        + 'dwelling_fire and special_event sit under Commercial in the grid. That is not the '
        + 'licensing line, and confusing the two is the bug.');
    }
  }

  // ── 3. The decline is fully retractable ────────────────────────────────────
  const hide = html.match(/function hideOutOfArea\([\s\S]*?\n}/);
  if (!hide) {
    problems.push('hideOutOfArea() is gone — something has to take the decline back when the '
      + 'applicant corrects their state.');
  } else if (!/_oosBoxes/.test(hide[0])) {
    problems.push('hideOutOfArea() no longer clears the boxes showOutOfArea() wrote into (_oosBoxes). '
      + 'showOutOfArea() copies the decline into the step-2 / step-3 error box; if hide only hides '
      + '#state-oos, a customer who changes their state to Kentucky keeps reading that we cannot '
      + 'write them.');
  }

  // ── 4. The submit path renders the decline, not "Submission failed" ────────
  if (!/function renderSubmitError\(/.test(html)) {
    problems.push("renderSubmitError() is gone — the submit handlers must render the server's "
      + '400 OUT_OF_AREA text verbatim. Without it they show "Submission failed", or worse the '
      + "catch block's \"Network error\", and the applicant never reads the decline at all.");
  }
  // renderSubmitError owns the one generic "Submission failed" fallback. Anywhere
  // ELSE that phrase appears in live code means a submit handler is composing its
  // own message again, and a decline routed through it is a decline the applicant
  // never reads. (Comments are allowed to mention it — they explain why.)
  const live = html
    .replace(/function renderSubmitError\([\s\S]*?\n}/, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const strays = (live.match(/Submission failed/g) || []).length;
  if (strays) {
    problems.push(`${strays} submit handler(s) still compose their own "Submission failed" message `
      + 'instead of going through renderSubmitError() — a 400 OUT_OF_AREA sent down that path is a '
      + 'decline the applicant never reads.');
  }

  return problems;
}

/**
 * The words themselves live on the server, so check them there. Network-optional:
 * a deploy must not be blocked because SAGE is briefly unreachable, but when it IS
 * reachable, a decline that has started pitching commercial fails the build.
 */
async function checkDeclineCopy(apiBase) {
  const base = apiBase || SAGE_API;
  let rules;
  try {
    const res = await fetch(base + '/api/intake/rules', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    rules = await res.json();
  } catch (e) {
    console.warn(`  ! Could not reach ${base}/api/intake/rules (${e.message}) — skipping the live `
      + 'decline-copy check. The server still enforces it.');
    return [];
  }

  const problems = [];
  const copy = String(rules.declineTemplate || '');
  if (!copy) {
    problems.push('GET /api/intake/rules returned no declineTemplate — the page would have no words '
      + 'to decline anyone with, and would fall silent instead.');
  } else {
    if (/commercial|business insurance/i.test(copy)) {
      problems.push('the decline copy mentions commercial lines: "' + copy.slice(0, 90) + '…". We write '
        + 'CL anywhere, but that is for us to know — do not pitch it to a personal-lines applicant we '
        + 'are turning away.');
    }
    if (!/sorry/i.test(copy)) {
      problems.push('the decline copy no longer apologises — it is meant to be a warm decline, not a '
        + 'validation error.');
    }
  }
  if (!Array.isArray(rules.serviceStates) || !rules.serviceStates.length) {
    problems.push('GET /api/intake/rules returned no serviceStates — the gate would decline nobody.');
  }

  // Every tile the form offers must be classifiable by SAGE. An id it has never
  // heard of is now treated as "not personal" on BOTH sides (they agree, which is
  // the point) — but silently, and silence is how special_event slipped through.
  const html = fs.readFileSync(SRC, 'utf8');
  const grid = html.match(/const PRODUCTS = \[[\s\S]*?\n\];/);
  const ids = grid ? [...grid[0].matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1]) : [];
  const known = rules.productLines || {};
  const unclassified = ids.filter((id) => id !== 'other' && !known[id]);
  if (unclassified.length) {
    problems.push('the form offers product(s) SAGE cannot classify: ' + unclassified.join(', ')
      + '. Add them to PL_PRODUCTS / CL_PRODUCTS in sage-server/src/lib/product-lines.js — until then '
      + 'nothing can tell whether we are licensed to write them.');
  }
  return problems;
}

if (require.main === module) {
  (async () => {
    const problems = checkIntakeGate(process.argv[2]).concat(await checkDeclineCopy());
    if (problems.length) {
      console.error('✗ Intake out-of-area gate guard failed:');
      for (const p of problems) console.error('  - ' + p);
      process.exit(1);
    }
    console.log('✓ Intake out-of-area decline intact (no CL pitch, state on step 1, one licence list)');
  })();
}

module.exports = { checkIntakeGate, checkDeclineCopy };

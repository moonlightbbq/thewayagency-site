#!/usr/bin/env node
/**
 * Out-of-area decline guard (ticket c2cc96ea).
 *
 * The agency writes personal / life / health only in KY, IN and TN. When we turn
 * an out-of-area applicant away, three things must stay true, and each one has
 * already been got wrong once:
 *
 *   1. The decline must NEVER mention commercial lines. We do write commercial
 *      nationwide, but the owner was explicit that this is for us to know and not
 *      something to say to a personal-lines applicant we are declining. The first
 *      version of this copy ended "If you need commercial coverage, please call us
 *      and we can help." That is the exact sentence he asked us not to write.
 *
 *   2. The State field must stay on STEP 1. It is step 1's "Continue" that calls
 *      trackPartial(true) — the request that persists the lead AND pages a
 *      producer. When the field sat on step 3, the state was always empty at the
 *      only moment the notification was decided, so the server had nothing to
 *      judge and paged a producer about every out-of-area applicant anyway.
 *
 *   3. The licensed-state list must live in exactly ONE place (SERVICE_STATES), so
 *      that licensing a fourth state is a one-line change and cannot half-land.
 *
 * Run standalone:  node scripts/check-intake-gate.js
 * Wired into scripts/build.js, so a regression fails the build.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'intake.html');

function checkIntakeGate(srcFile) {
  const file = srcFile || SRC;
  const problems = [];
  if (!fs.existsSync(file)) return [`${file}: missing`];
  const html = fs.readFileSync(file, 'utf8');

  // ── 1. The decline must not pitch commercial ────────────────────────────────
  const copy = html.match(/function outOfAreaCopy\([\s\S]*?\n}/);
  if (!copy) {
    problems.push('outOfAreaCopy() is gone — the decline copy must stay in one named function');
  } else {
    const text = copy[0];
    if (/commercial/i.test(text)) {
      problems.push('outOfAreaCopy() mentions commercial lines. We write CL anywhere, but that is '
        + 'for us to know — do not pitch it to a personal-lines applicant we are declining.');
    }
    if (!/sorry/i.test(text)) {
      problems.push('outOfAreaCopy() no longer apologises — the decline is supposed to be warm, '
        + 'not a validation error.');
    }
  }

  // ── 2. State must be captured on step 1, before the producer is paged ───────
  const step1 = html.match(/<div id="step-1"[\s\S]*?<div id="step-2"/);
  if (!step1) {
    problems.push('could not locate the step-1 card — the step markup changed shape');
  } else if (!/id="i_state"/.test(step1[0])) {
    problems.push('the State field (#i_state) is no longer inside step-1. Step 1 is what fires '
      + 'trackPartial(true), the call that persists the lead and pages a producer — if the state '
      + 'is not collected before that, the out-of-area gate has nothing to judge and every '
      + 'out-of-area applicant reaches a producer anyway.');
  }

  // The decline has to be reachable from the step that pages the producer.
  if (!/if \(mustDecline\(\)\)/.test(html)) {
    problems.push('nothing calls mustDecline() — the gate is not wired to any step, so nothing '
      + 'would actually be declined.');
  }

  // ── 3. One list, one place ──────────────────────────────────────────────────
  const decl = html.match(/const SERVICE_STATES = \[[^\]]*\]/g) || [];
  if (decl.length !== 1) {
    problems.push(`SERVICE_STATES is declared ${decl.length} times — the licensed-state list must `
      + 'live in exactly one place so a fourth state is a one-line change.');
  }
  // A hardcoded "Kentucky, Indiana and Tennessee" anywhere but the derived helper
  // means a 4th state would silently leave stale copy behind.
  const hardcoded = html.split('\n').filter((l) =>
    /Kentucky, Indiana and Tennessee/.test(l) && !/^\s*(\/\/|\*)/.test(l.trim()));
  if (hardcoded.length) {
    problems.push('the licensed states are hardcoded into copy: ' + hardcoded[0].trim().slice(0, 80)
      + ' — build the list with serviceStateNames() instead, or licensing a 4th state leaves this behind.');
  }

  return problems;
}

if (require.main === module) {
  const problems = checkIntakeGate(process.argv[2]);
  if (problems.length) {
    console.error('✗ Intake out-of-area gate guard failed:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('✓ Intake out-of-area decline intact (no CL pitch, state on step 1, one state list)');
}

module.exports = { checkIntakeGate };

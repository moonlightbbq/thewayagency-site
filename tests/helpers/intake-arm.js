/**
 * /intake/ runs the 50/50 A/B 'intake-short-form', bucketed on the twa_vid
 * visitor id. A harness that inlines the real src/js/attribution.js otherwise
 * gets a random id, and so a random arm. Tests written for the four-step form
 * pin control with this id; tests/intake-short-form.test.js checks that it still
 * buckets to control.
 */
const CONTROL_VID = 'test-vid-control-2';

function pinFourStepForm(w) {
  w.localStorage.setItem('twa_vid', CONTROL_VID);
}

module.exports = { CONTROL_VID, pinFourStepForm };

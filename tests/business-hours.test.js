/**
 * One hours constant, with an explicit time zone (CONV-01, above-the-fold spec Step
 * 5.1; owner decision 2026-10-02: Monday-Friday 9:00 AM-5:00 PM, America/New_York,
 * shown as "ET").
 *
 * The chat used to treat 08:30-17:00 as open (the site publishes 9:00-5:00) and read
 * the clock through new Date(toLocaleString()). src/js/business-hours.js is now the
 * single constant: the chat reads it in the browser and build code can require it.
 *
 *   node --test tests/          (npm test)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const H = require('../src/js/business-hours');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('business hours: Monday-Friday 9:00 AM to 5:00 PM, America/New_York', () => {
  // Instants in UTC; 2026-10-05 is a Monday, Eastern Daylight Time (UTC-4).
  const cases = [
    ['2026-10-05T12:59:00Z', 'Mon 08:59 ET', true],
    ['2026-10-05T13:00:00Z', 'Mon 09:00 ET', false],
    ['2026-10-05T20:59:00Z', 'Mon 16:59 ET', false],
    ['2026-10-05T21:00:00Z', 'Mon 17:00 ET', true],
    ['2026-10-09T16:00:00Z', 'Fri 12:00 ET', false],
    ['2026-10-03T16:00:00Z', 'Sat 12:00 ET', true],
    ['2026-10-04T16:00:00Z', 'Sun 12:00 ET', true],
    ['2026-10-04T02:00:00Z', 'Sat 22:00 ET', true],
    ['2026-10-06T04:30:00Z', 'Tue 00:30 ET', true],
    // Daylight time ends 2026-11-01: Monday 2026-11-02 is EST (UTC-5).
    ['2026-11-02T15:00:00Z', 'Mon 10:00 EST', false],
    ['2026-11-02T13:30:00Z', 'Mon 08:30 EST', true],
    ['2026-11-02T22:00:00Z', 'Mon 17:00 EST', true],
    // A visitor in Kentucky's Central zone: the agency's Eastern clock decides.
    ['2026-10-06T13:30:00Z', 'Tue 08:30 CT = 09:30 ET', false],
    ['2026-10-06T21:30:00Z', 'Tue 16:30 CT = 17:30 ET', true],
    ['2026-10-06T12:45:00Z', 'Tue 08:45 ET (old code said open)', true],
  ];
  for (const [iso, label, after] of cases) {
    test(`${label} -> ${after ? 'after hours' : 'open'}`, () => {
      assert.equal(H.isAfterHoursAt(new Date(iso)), after);
      assert.equal(H.isOpenAt(new Date(iso)), !after);
    });
  }

  test('the constant names the zone and labels it ET, never EST', () => {
    assert.equal(H.BUSINESS_HOURS.timeZone, 'America/New_York');
    assert.equal(H.BUSINESS_HOURS.zoneLabel, 'ET');
    assert.deepEqual([...H.BUSINESS_HOURS.days], [1, 2, 3, 4, 5]);
    assert.equal(H.formatTime(H.BUSINESS_HOURS.openMin), '9:00 AM');
    assert.equal(H.formatTime(H.BUSINESS_HOURS.closeMin), '5:00 PM');
    assert.ok(Object.isFrozen(H.BUSINESS_HOURS));
  });

  test('matches data/locations.json (hours and hours_timezone) and the footer', () => {
    const office = JSON.parse(read('data/locations.json')).offices[0];
    assert.equal(office.hours_timezone, H.BUSINESS_HOURS.timeZone);
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const open = `${H.formatTime(H.BUSINESS_HOURS.openMin)} – ${H.formatTime(H.BUSINESS_HOURS.closeMin)}`;
    names.forEach((day, i) => {
      assert.equal(office.hours[day], H.BUSINESS_HOURS.days.includes(i) ? open : 'Closed', day);
    });
    assert.ok(read('scripts/shared-templates.js').includes(`Mon\\u2013Fri: ${H.formatTime(H.BUSINESS_HOURS.openMin)} \\u2013 ${H.formatTime(H.BUSINESS_HOURS.closeMin)}`));
  });

  test('a browser that cannot resolve the zone is treated as open (no after-hours prompt on a guess)', () => {
    assert.equal(H.isAfterHoursAt(new Date(), { ...H.BUSINESS_HOURS, timeZone: 'Not/AZone' }), false);
  });

  test('in a browser it is window.TWA_HOURS, and the build prepends it to app.js', () => {
    const dom = new JSDOM('<!DOCTYPE html><p></p>', { runScripts: 'outside-only' });
    dom.window.eval(read('src/js/business-hours.js'));
    assert.equal(dom.window.TWA_HOURS.BUSINESS_HOURS.timeZone, 'America/New_York');
    dom.window.close();
    assert.match(read('scripts/builders/assets.js'), /'business-hours\.js'/);
  });
});

/**
 * The agency's published business hours: the ONE hours constant for the site.
 *
 * Owner decision, 2026-10-02: Monday to Friday, 9:00 AM to 5:00 PM Eastern, closed
 * weekends. IANA zone America/New_York. Display the zone as "ET", never "EST", so the
 * label stays right during daylight time.
 *
 * Works in both places that need it:
 *   - the browser: the build prepends this file to app.js (scripts/builders/assets.js),
 *     so every app.js page gets window.TWA_HOURS; it is also copied standalone to
 *     /src/js/business-hours.js for pages that do not load app.js (/intake/).
 *   - Node: require('src/js/business-hours.js') for build-time copy (footer, /contact,
 *     callback slots) and for tests.
 * data/locations.json offices[0].hours + hours_timezone must say the same thing
 * (tests/business-hours.test.js).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root && !root.TWA_HOURS) root.TWA_HOURS = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var BUSINESS_HOURS = Object.freeze({
    timeZone: 'America/New_York',
    zoneLabel: 'ET',
    days: Object.freeze([1, 2, 3, 4, 5]), // 0 = Sunday ... 6 = Saturday
    openMin: 9 * 60, // 9:00 AM
    closeMin: 17 * 60, // 5:00 PM (closed from 17:00)
  });

  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Day of week and minutes after midnight at `date` in the hours' own zone. Uses
  // Intl, not new Date(toLocaleString()), which is unreliable across engines.
  function localParts(date, h) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: h.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    var get = function (type) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
      return '';
    };
    return {
      day: WEEKDAYS.indexOf(get('weekday')),
      minutes: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10),
    };
  }

  /** True when the agency is open at `date` (default: now). */
  function isOpenAt(date, h) {
    h = h || BUSINESS_HOURS;
    var p = localParts(date || new Date(), h);
    return h.days.indexOf(p.day) !== -1 && p.minutes >= h.openMin && p.minutes < h.closeMin;
  }

  /**
   * True when the agency is closed at `date`. If this browser cannot resolve the time
   * zone, it answers false (treat as open) so no after-hours prompt appears on a guess.
   */
  function isAfterHoursAt(date, h) {
    try { return !isOpenAt(date, h); } catch (e) { return false; }
  }

  function isAfterHours() { return isAfterHoursAt(new Date()); }

  /** 540 -> "9:00 AM", 1020 -> "5:00 PM". */
  function formatTime(min) {
    var hh = Math.floor(min / 60) % 24, mm = min % 60;
    return ((hh + 11) % 12 + 1) + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (hh < 12 ? 'AM' : 'PM');
  }

  return {
    BUSINESS_HOURS: BUSINESS_HOURS,
    isOpenAt: isOpenAt,
    isAfterHoursAt: isAfterHoursAt,
    isAfterHours: isAfterHours,
    formatTime: formatTime,
  };
});

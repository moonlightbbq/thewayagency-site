/**
 * Which carriers get a standalone /carriers/<slug> page (CONT-05, content-accuracy
 * WP-H). build.js, the carriers index and the tests all ask this one function.
 *
 * Owner decision D6 keeps five standalone pages (berkshire-guard, steadily, obie,
 * hartford, liberty-mutual: `standalone_page: true` in data/carriers.json) and
 * 301s the rest to /carriers/#<slug>. Until D6 is answered every carrier with a
 * description keeps its page, so no live URL 404s; the "WAITS ON D6" commit
 * narrows this to standalone_page and adds the redirects in the same change.
 */
function carrierHasPage(carrier) {
  return Boolean(carrier && (carrier.standalone_page === true || carrier.description));
}

module.exports = { carrierHasPage };

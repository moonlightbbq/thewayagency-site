/**
 * Which carriers get a standalone /carriers/<slug> page (CONT-05, content-accuracy
 * WP-H). build.js, the carriers index and the tests all ask this one function.
 *
 * Owner decision D6 keeps five standalone pages (berkshire-guard, steadily, obie,
 * hartford, liberty-mutual: `standalone_page: true` in data/carriers.json). The
 * other nine former pages 301 to /carriers/#<slug> (_redirects, kept at least a
 * year), and the sitemap drops them because they are no longer built.
 */
function carrierHasPage(carrier) {
  return Boolean(carrier && carrier.standalone_page === true);
}

module.exports = { carrierHasPage };

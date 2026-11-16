#!/usr/bin/env node
/**
 * Y-97: `npm test` runs this first. It builds build/ once, against a stub SAGE
 * (no network, no production read), so the tests that check the built site
 * (licensed-states-guard, agency-email-guard, flyer-redirects) always have a
 * whole, current build to read and never skip. A build the guards refuse fails
 * here, and so fails `npm test`.
 */
const { ROOT, goodRules, startStubSage, runBuild } = require('./site-build');

(async () => {
  const sage = await startStubSage(() => goodRules());
  const { code, out } = await runBuild(ROOT, sage.url, { repo: true });
  await sage.close();
  if (code !== 0) {
    process.stderr.write(out);
    process.stderr.write(`\nnpm test: the site build failed (exit ${code}); the tests did not run.\n`);
    process.exit(1);
  }
  console.log('npm test: built build/ against a stub SAGE');
})();

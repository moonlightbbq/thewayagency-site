/**
 * SEO & Version Injection
 * Handles git info, build versioning, GTM injection, and the review badge markers.
 */

const { execSync } = require('child_process');
const { renderReviewBadgeMarkers } = require('../lib/review-badge');

function getGitInfo(ROOT) {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

function createVersionInfo(ROOT) {
  const gitInfo = getGitInfo(ROOT);
  const buildDate = new Date().toISOString();
  const buildVersion = `${buildDate.split('T')[0]}-${gitInfo.commit}`;
  return { gitInfo, buildDate, buildVersion };
}

// Mobile-menu call + text pair (CONV-04, CONTENT_RULES rule 3; above-the-fold
// Step 6.2). Rendered into the HTML for every page with the site nav, so it no
// longer depends on app.js (which used to inject a tel:-only link at load).
// components.css shows it only inside the mobile menu; the desktop header pair is
// the "contact-pair" A/B test (Step 9), not this.
const NAV_CONTACT_HTML = '<div class="nav__contact">'
  + '<a href="tel:+15024135335" class="nav__phone"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> <span>Call (502) 413-5335</span></a>'
  + '<a href="sms:+15024135335" class="nav__phone nav__phone--text"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> <span>Text</span></a>'
  + '</div>';

/**
 * Insert NAV_CONTACT_HTML right before the menu's "Get a Quote" button
 * (the last .btn--primary link inside #navLinks). A page that has the nav but
 * not that button fails the build: a silent skip would ship a menu without the
 * pair.
 */
function injectNavContact(html, outputPath) {
  const at = html.indexOf('id="navLinks"');
  if (at < 0 || html.includes('class="nav__contact"')) return html;
  const navEnd = html.indexOf('</nav>', at);
  const segment = html.slice(at, navEnd < 0 ? html.length : navEnd);
  const re = /<a\b[^>]*\bclass="[^"]*\bbtn btn--primary\b[^"]*"[^>]*>/g;
  let last = -1;
  let m;
  while ((m = re.exec(segment)) !== null) last = m.index;
  if (last < 0) throw new Error(`nav__contact: ${outputPath || 'a page'} has #navLinks but no "Get a Quote" button to place the call/text pair before`);
  const pos = at + last;
  return html.slice(0, pos) + NAV_CONTACT_HTML + html.slice(pos);
}

function createInjectVersion({ buildVersion, gitInfo, buildDate, reviews, renderHead_GTM, renderBody_GTM }) {
  const versionMeta = `<meta name="build-version" content="${buildVersion}">`;
  const versionComment = `<!-- build: ${buildVersion} | ${gitInfo.branch} | ${buildDate} -->`;
  const versionFooter = `<!-- build: ${buildVersion} -->`;

  return function injectVersion(html, outputPath) {
    // Add meta tag after charset
    html = html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n  ${versionMeta}`);
    // Add build comment after doctype
    html = html.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n${versionComment}`);
    // Add version to footer bottom
    html = html.replace(
      /(<div class="footer__legal-links">[\s\S]*?<\/div>\s*<\/div>)/,
      `$1\n      ${versionFooter}`
    );
    // Handcrafted pages mark where the Google rating badge goes; fill it from
    // the current data, or with nothing when the rating is missing or stale
    // (TRUST-14). Visible text only: the agency's own rating is never JSON-LD (SCHEMA-03).
    html = renderReviewBadgeMarkers(html, reviews, outputPath || 'a page');
    // Add hreflang if not already present
    if (!html.includes('hreflang')) {
      const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)">/);
      if (canonicalMatch) {
        html = html.replace(canonicalMatch[0], `${canonicalMatch[0]}\n  <link rel="alternate" hreflang="en-US" href="${canonicalMatch[1]}">`);
      }
    }
    // Add noindex for portal, intake, partner, login pages
    if (!html.includes('name="robots"')) {
      const canonicalUrl = (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1] || '';
      const isNoindex = /\/(intake|portal|partner|login)[\/.]/.test(canonicalUrl) ||
        (outputPath && /\/(intake|portal|partner|login)[\/.]/.test(outputPath));
      if (isNoindex) {
        html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n  <meta name="robots" content="noindex, nofollow">');
      }
    }
    html = injectNavContact(html, outputPath);
    // The menu toggle names the panel it controls and starts collapsed (PERF-07);
    // app.js keeps aria-expanded in step.
    html = html.replace(/<button class="nav__toggle" id="navToggle"([^>]*)>/g, (tag, rest) => {
      let extra = '';
      if (!/\saria-controls=/.test(rest)) extra += ' aria-controls="navLinks"';
      if (!/\saria-expanded=/.test(rest)) extra += ' aria-expanded="false"';
      return `<button class="nav__toggle" id="navToggle"${extra}${rest}>`;
    });
    // Cache-bust JS and CSS with build version
    html = html.replace(/src="\/src\/js\/([\w-]+)\.js"/g, `src="/src/js/$1.js?v=${buildVersion}"`);
    html = html.replace(/href="\/src\/css\/(\w+)\.css"/g, `href="/src/css/$1.css?v=${buildVersion}"`);

    // Inject GTM head snippet (before </head>) and body snippet (after <body>)
    if (!html.includes('gtm.js')) {
      html = html.replace('</head>', renderHead_GTM() + '\n</head>');
      html = html.replace(/<body[^>]*>/, '$&\n' + renderBody_GTM());
    }
    return html;
  };
}

module.exports = { getGitInfo, createVersionInfo, createInjectVersion, injectNavContact, NAV_CONTACT_HTML };

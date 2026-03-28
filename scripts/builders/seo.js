/**
 * SEO & Version Injection
 * Handles git info, build versioning, GTM injection, and review data injection.
 */

const { execSync } = require('child_process');

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

function createInjectVersion({ buildVersion, gitInfo, buildDate, reviews, renderHead_GTM, renderBody_GTM, criticalCss }) {
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
    // Inject live Google review data (replaces any hardcoded count/rating in all formats)
    html = html.replace(/from \d+ Google reviews/g, `from ${reviews.count} Google reviews`);
    html = html.replace(/\(\d+ reviews\)/g, `(${reviews.count} reviews)`);
    html = html.replace(/\(\d+ Google reviews\)/g, `(${reviews.count} Google reviews)`);
    html = html.replace(/"reviewCount":\s*"\d+"/g, `"reviewCount": "${reviews.count}"`);
    html = html.replace(/"ratingValue":\s*"[\d.]+"/g, `"ratingValue": "${reviews.rating}"`);
    // Inject critical CSS into hand-crafted pages that have standard CSS links
    if (criticalCss && html.includes('<link rel="stylesheet" href="/src/css/base.css">') && !html.includes('<style>')) {
      const cssLinks = '  <link rel="stylesheet" href="/src/css/base.css">\n  <link rel="stylesheet" href="/src/css/components.css">\n  <link rel="stylesheet" href="/src/css/leadgen.css">';
      const lazyCss = `  <style>${criticalCss}</style>\n  <link rel="stylesheet" href="/src/css/base.css" media="print" onload="this.media='all'">\n  <link rel="stylesheet" href="/src/css/components.css" media="print" onload="this.media='all'">\n  <link rel="stylesheet" href="/src/css/leadgen.css" media="print" onload="this.media='all'">\n  <noscript><link rel="stylesheet" href="/src/css/base.css"><link rel="stylesheet" href="/src/css/components.css"><link rel="stylesheet" href="/src/css/leadgen.css"></noscript>`;
      if (html.includes(cssLinks)) {
        html = html.replace(cssLinks, lazyCss);
      } else {
        // CSS link block doesn't match exact pattern — skip critical CSS injection, leaving original links intact
        console.warn(`  ⚠ Critical CSS: link block pattern not found in ${outputPath || 'unknown page'}, skipping injection`);
      }
    }
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
    // Cache-bust JS and CSS with build version
    html = html.replace(/src="\/src\/js\/app\.js"/g, `src="/src/js/app.js?v=${buildVersion}"`);
    html = html.replace(/href="\/src\/css\/(\w+)\.css"/g, `href="/src/css/$1.css?v=${buildVersion}"`);

    // Inject GTM head snippet (before </head>) and body snippet (after <body>)
    if (!html.includes('gtm.js')) {
      html = html.replace('</head>', renderHead_GTM() + '\n</head>');
      html = html.replace(/<body[^>]*>/, '$&\n' + renderBody_GTM());
    }
    return html;
  };
}

module.exports = { getGitInfo, createVersionInfo, createInjectVersion };

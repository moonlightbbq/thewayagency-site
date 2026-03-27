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

  return function injectVersion(html) {
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
    // Inject GTM head snippet (before </head>) and body snippet (after <body>)
    if (!html.includes('gtm.js')) {
      html = html.replace('</head>', renderHead_GTM() + '\n</head>');
      html = html.replace(/<body[^>]*>/, '$&\n' + renderBody_GTM());
    }
    return html;
  };
}

module.exports = { getGitInfo, createVersionInfo, createInjectVersion };

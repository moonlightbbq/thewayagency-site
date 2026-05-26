# thewayagency-site &middot; repo conventions for AI assistants

The workspace `~/CLAUDE.md` covers cross-repo basics (build, deploy, after-
task steps). This file holds rules specific to this repo.

## Compliance pages: version + archive rule

When you change any of the six compliance pages:

- `src/pages/privacy.html`
- `src/pages/terms.html`
- `src/pages/disclosures.html`
- `src/pages/privacy-notice.html`
- `src/pages/ai-disclosure.html`
- `src/pages/information-security.html`

and the change is **substantive** (any wording, section, or policy change
beyond pure styling), you **must**:

1. **Bump the `Version` chip** on that page (for example, `2026.05` to
   `2026.06`). Format: `YYYY.MM` or `YYYY.MM.N` for multiple revisions in
   the same month.
2. **Set the `Updated` chip** on that page to today's date.
3. Run `npm run build`. `scripts/snapshot-legal-pages.js` writes the new
   version into `legal-archive/<version>/`.
4. **Commit the new `legal-archive/<version>/` folder** in the same commit
   as the page change.

The build prints a warning if any compliance page's `<main>` content
changed without a version bump &mdash; do not ignore that warning, it
means the archive is stale.

Full convention: `legal-archive/README.md`.

## Compliance page style guard

`scripts/check-legal-pages.js` runs in `build.js` and **fails the build** if
any compliance page contains em dashes (`&mdash;`, literal em dash), text
double-hyphens (` -- `), or broken in-page anchors. Keep the copy plain
(use commas, parentheses, or separate sentences instead of em dashes). The
footer business-hours en dash (`Mon-Fri: 9:00 AM - 5:00 PM`, using a real
en dash) sits outside `<main>` and is intentionally allowed.

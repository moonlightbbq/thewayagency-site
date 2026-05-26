# Legal Archive

This folder is the durable record of every published version of The Way
Agency's compliance pages:

- `/privacy` &middot; Website Privacy Policy
- `/terms` &middot; Terms and Conditions
- `/disclosures` &middot; Disclosure Center hub
- `/privacy-notice` &middot; Privacy Notice
- `/ai-disclosure` &middot; AI &amp; Technology Disclosure
- `/information-security` &middot; Information Security Statement

Each subfolder is named after the `Version` chip on the page (for example,
`2026.05`) and holds the full HTML as it was published at that version.

## How snapshots are made

The build pipeline calls `scripts/snapshot-legal-pages.js` after each
successful build. For every compliance page it reads the `Version` chip and
writes the HTML into `legal-archive/<version>/<page>.html` **if no snapshot
exists for that version yet**. Snapshots are write-once per version: once a
version has been archived, that folder is frozen.

You can also run the snapshot on its own:

```bash
npm run snapshot:legal
```

## The version rule

> **When you update a compliance page, bump the version.**

Whenever you make a substantive change to any of the six pages above (any
wording or section change beyond pure styling), you must:

1. **Bump the `Version` chip** on that page (for example, `2026.05` to
   `2026.06`). Use `YYYY.MM` for the first revision in a month, or
   `YYYY.MM.N` for subsequent revisions within the same month.
2. **Set the `Updated` chip** to today's date.
3. Run `npm run build`. The new version snapshot is written into
   `legal-archive/<new-version>/`.
4. **Commit the new `legal-archive/<version>/` folder** along with the page
   change in the same commit.

If you change a page's `<main>` content but do not bump the version, the
build prints a warning and the archive at the existing version is **not**
overwritten. The published change will only be archived once the version is
bumped. Heed the warning.

## Don't edit files inside this folder

The folders here are archived snapshots, not editable copies. To change
something, edit the page in `src/pages/` and bump the version.

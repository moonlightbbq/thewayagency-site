# Blog Post Authoring Guide

## How to publish a new blog post

1. Create a `.md` file in this directory (`src/blog/`)
2. Add front matter at the top (see template below)
3. Write your content in Markdown
4. Run `node scripts/generate-blog.js` to convert to HTML
5. Run `node scripts/build.js` to update the sitemap
6. Commit and push — Cloudflare deploys automatically

## Front Matter Template

```
---
title: Your Post Title Here
slug: your-post-slug-here
description: A 150-160 character SEO description for search results.
author: The Way Agency
author_title: Independent Insurance Agency
date: 2026-03-15
modified: 2026-03-20
reading_time: 5 min read
related_page: /personal/home.html
tags: home insurance, kentucky, weather
image: /src/assets/images/blog/your-post-slug-here.jpg
image_alt: Short description of the featured image
sources: [CMS CY2027 Rate Announcement | https://www.cms.gov/files/document/2027-announcement.pdf, https://www.medicare.gov/plan-compare]
---
```

`image`/`image_alt` are optional. When present, the post renders a featured
image above the byline and uses it for og:image/twitter:image (1536x1024
expected); without them the social logo is used. The hive pipeline generates
these automatically for AI-drafted posts.

`sources` is optional: the primary sources behind the post's statutes,
deadlines and figures. Write it on one line, as a list of items that are each
either `Label | https://url` or a bare `https://url` (the page then shows the
host and path as the label). The page prints a "Sources" list after the FAQ
and adds the URLs to the Article structured data as `citation`. Only `https://`
URLs without spaces, quotes or angle brackets are kept. Items are split on
commas, so no label or URL may contain a comma. Keep linking each statute
inline in the body as well.

## Who the byline names

The byline says who wrote the post and, only when it is true, who reviewed it.
Both are trust signals on a regulated-industry page, so neither is free text
(sage-server BL-07; `scripts/lib/blog-content-guard.js`):

- **"Written by"** is the agency ("Written by The Way Agency") unless a team
  member actually wrote the post. Then add `author_slug` with their slug from
  `data/team.json`; the page prints their name and title as `data/team.json`
  gives them, so a new title shows on all their posts. `author` and
  `author_title` are never printed; the build warns when they differ from
  `data/team.json`. A slug that names no member (someone who left) prints
  "Written by The Way Agency"; the post stays up. An AI-drafted post is written
  by the agency: do not put a person's name on text they did not write (SAGE
  refuses to promote an AI draft with an `author_slug` unless that person
  approves it).
- **"Reviewed by"** is never written here. The byline's "Reviewed by" (and the
  JSON-LD reviewedBy) renders only for the assigned reviewer's approval in SAGE
  of the exact file: the reviewer clicks "Review and approve in SAGE" in the
  review email, and SAGE signs the approval. Review lines typed into the front
  matter are ignored.
- **Do not claim a review in the text either.** Don't write "Reviewed by ...",
  "Checked by our licensed agents" and the like in a title, description, CTA,
  alt text or the article. Code cannot reliably tell such a claim from advice
  ("Ask your agent to check your coverage"), so it does not refuse the post:
  the build logs a warning naming the text ("review-credit wording"), and SAGE
  shows the same warning next to the text when a person approves an AI draft
  or an AI-proposed edit. Only the signed byline is a verified credit.
- These do stop a post from publishing (`unsafe_frontmatter`): a front-matter
  value with `<` or `>`, or an invisible, control or bidi character
  (zero-width, soft hyphen, direction marks, line separators; an emoji's own
  joiners are fine); a `slug`/`author_slug` that is not lower-case letters,
  digits and hyphens; `date`/`modified` other than YYYY-MM-DD. Arrows, emoji,
  accents and other scripts are fine.
- `reading_time` should be "N min" or "N min read", or left out. Any other
  value is not printed: the page shows the computed time and the build logs a
  warning.

## Team members (for `author_slug`, only when that person wrote the post)

| Name | Title | Slug |
|------|-------|------|
| Sheilia Royal | Agency Principal / Licensed Agent | sheilia-royal |
| Audrey Lillpop | Licensed Agent | audrey-lillpop |
| Kelly McCallister | Client Care Specialist | kelly-mccallister |
| Jill Boone | Licensed Agent | jill-boone |

`data/team.json` is the source of truth for names and titles.

## Markdown Formatting

- `## Heading` — Section heading (H2)
- `### Heading` — Subsection heading (H3)
- `**bold**` — Bold text
- `*italic*` — Italic text
- `[link text](url)` — Hyperlink
- `- item` — Bullet list

## FAQ Sections

To add FAQ items that get their own accordion and FAQPage schema, use this format:

```
### FAQ: Is flood insurance included in homeowners?

No. Standard homeowners insurance in Kentucky does not cover flood damage. You need a separate flood policy.

### FAQ: How much does home insurance cost?

Most Owensboro homeowners pay between $1,200 and $2,400 per year depending on home value, age, and claims history.
```

H3 headings starting with `FAQ:` are automatically extracted into an accordion section with structured data.

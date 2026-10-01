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
---
```

`image`/`image_alt` are optional. When present, the post renders a featured
image above the byline and uses it for og:image/twitter:image (1536x1024
expected); without them the social logo is used. The hive pipeline generates
these automatically for AI-drafted posts.

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
- **"Reviewed by"** is never written here. It renders only for the assigned
  reviewer's approval in SAGE of the exact file. No front-matter value (title,
  description, CTA text, image alt text, ...) may use a review word (review,
  approve, check, verify, vet, edit, audit, endorse, certify, sign off, ...)
  together with a team member's name, the agency, "licensed", agent, principal,
  producer, staff or expert, in any order: "Ask your agent to check your
  coverage" is refused in a title or description too (a "coverage review" or
  "premium audit" is fine). No sentence in the article (including an FAQ
  answer, and across a line break) may put a review word next to a team
  member's name, or credit a review or approval of the post to the agency or
  a licensed agent. Such a post does not publish
  (`unsafe_frontmatter` / `review_claim_in_body`).
- `reading_time` is "N min" or "N min read" (or leave it out: it is computed).
  `date` and `modified` are YYYY-MM-DD. Values are plain text: no `<` or `>`,
  and no invisible, look-alike or full-width characters.

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

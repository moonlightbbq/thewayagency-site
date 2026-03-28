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
author: Sheilia Royal
author_title: Agency Principal / Licensed Agent
author_slug: sheilia-royal
date: 2026-03-15
modified: 2026-03-20
reading_time: 5 min read
related_page: /personal/home.html
tags: home insurance, kentucky, weather
---
```

## Available Authors

| Name | Title | Slug |
|------|-------|------|
| Sheilia Royal | Agency Principal / Licensed Agent | sheilia-royal |
| Audrey Lillpop | Licensed Agent | audrey-lillpop |
| Kelly McCallister | Client Care Specialist | kelly-mccallister |
| Jill Boone | Licensed Agent | jill-boone |

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

#!/usr/bin/env node
/**
 * The Way Agency — Content Admin CLI
 *
 * Manage blog posts, team members, testimonials, products, and knowledge base
 * entries via the command line. Edits data/*.json files, then optionally
 * rebuilds and deploys.
 *
 * Usage:
 *   node scripts/admin.js <resource> <action> [options]
 *
 * Resources: blog, team, testimonial, product, kb
 * Actions:   list, add, edit, remove
 *
 * Examples:
 *   node scripts/admin.js team list
 *   node scripts/admin.js team add --name "Jane Doe" --title "Licensed Agent"
 *   node scripts/admin.js testimonial add --name "Client" --text "Great service" --rating 5
 *   node scripts/admin.js kb add --question "Is flood covered?" --answer "No, separate policy needed"
 *   node scripts/admin.js blog list
 *   node scripts/admin.js deploy                # rebuild + git push
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

// ─── Helpers ─────────────────────────────────
function loadJSON(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA, filename), 'utf8'));
}

function saveJSON(filename, data) {
  fs.writeFileSync(path.join(DATA, filename), JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  ✓ Saved ${filename}`);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      opts[key] = val;
    }
  }
  return opts;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

// ─── Team ────────────────────────────────────
const teamActions = {
  list() {
    const data = loadJSON('team.json');
    console.log('\nTeam Members:');
    data.team.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.name} — ${m.title} (${m.slug})`);
    });
    console.log(`\n  Total: ${data.team.length}`);
  },

  add(opts) {
    if (!opts.name) { console.error('Error: --name is required'); process.exit(1); }
    const data = loadJSON('team.json');
    const member = {
      name: opts.name,
      slug: slugify(opts.name),
      title: opts.title || 'Licensed Agent',
      photo: opts.photo || `/src/assets/images/team/${slugify(opts.name)}.webp`,
      years_experience: parseInt(opts.years) || 0,
      license_states: (opts.states || 'KY,IN,TN').split(','),
      designations: opts.designations ? opts.designations.split(',') : [],
      specialties: opts.specialties ? opts.specialties.split(',') : [],
      bio: opts.bio || '',
      fun_fact: opts['fun-fact'] || '',
      email: opts.email || '',
      phone: opts.phone || '',
    };
    data.team.push(member);
    saveJSON('team.json', data);
    console.log(`  ✓ Added team member: ${member.name}`);
  },

  remove(opts) {
    if (!opts.slug && !opts.name) { console.error('Error: --slug or --name required'); process.exit(1); }
    const data = loadJSON('team.json');
    const key = opts.slug || slugify(opts.name);
    const idx = data.team.findIndex(m => m.slug === key);
    if (idx === -1) { console.error(`Error: Member "${key}" not found`); process.exit(1); }
    const removed = data.team.splice(idx, 1)[0];
    saveJSON('team.json', data);
    console.log(`  ✓ Removed: ${removed.name}`);
  },
};

// ─── Testimonials ────────────────────────────
const testimonialActions = {
  list() {
    const data = loadJSON('testimonials.json');
    console.log('\nTestimonials:');
    data.testimonials.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.name} — ${'★'.repeat(t.rating)} (${t.id})`);
      console.log(`     "${t.text.slice(0, 80)}..."`);
    });
    console.log(`\n  Total: ${data.testimonials.length}`);
  },

  add(opts) {
    if (!opts.name || !opts.text) { console.error('Error: --name and --text required'); process.exit(1); }
    const data = loadJSON('testimonials.json');
    const entry = {
      id: slugify(opts.name),
      name: opts.name,
      rating: parseInt(opts.rating) || 5,
      text: opts.text,
      source: opts.source || 'google',
      source_url: opts.url || '',
      date: opts.date || new Date().toISOString().split('T')[0],
      agent: opts.agent || '',
      product_lines: opts.lines ? opts.lines.split(',') : ['personal'],
      products: opts.products ? opts.products.split(',') : [],
    };
    data.testimonials.push(entry);
    saveJSON('testimonials.json', data);
    console.log(`  ✓ Added testimonial from: ${entry.name}`);
  },

  remove(opts) {
    if (!opts.id && !opts.name) { console.error('Error: --id or --name required'); process.exit(1); }
    const data = loadJSON('testimonials.json');
    const key = opts.id || slugify(opts.name);
    const idx = data.testimonials.findIndex(t => t.id === key);
    if (idx === -1) { console.error(`Error: Testimonial "${key}" not found`); process.exit(1); }
    const removed = data.testimonials.splice(idx, 1)[0];
    saveJSON('testimonials.json', data);
    console.log(`  ✓ Removed testimonial from: ${removed.name}`);
  },
};

// ─── Knowledge Base ──────────────────────────
const kbActions = {
  list() {
    const data = loadJSON('knowledge-base.json');
    console.log('\nKnowledge Base:');
    data.entries.forEach((e, i) => {
      console.log(`  ${i + 1}. [${e.category}/${e.product}] ${e.question} (${e.id})`);
    });
    console.log(`\n  Total: ${data.entries.length}`);
  },

  add(opts) {
    if (!opts.question || !opts.answer) { console.error('Error: --question and --answer required'); process.exit(1); }
    const data = loadJSON('knowledge-base.json');
    const entry = {
      id: slugify(opts.question).slice(0, 40),
      question: opts.question,
      answer: opts.answer,
      category: opts.category || 'general',
      product: opts.product || '',
      related_products: opts.related ? opts.related.split(',') : [],
      tags: opts.tags ? opts.tags.split(',') : [],
      source_page: opts.page || '',
      last_reviewed: new Date().toISOString().slice(0, 7),
    };
    data.entries.push(entry);
    saveJSON('knowledge-base.json', data);
    console.log(`  ✓ Added KB entry: ${entry.question.slice(0, 60)}`);
  },

  remove(opts) {
    if (!opts.id) { console.error('Error: --id required'); process.exit(1); }
    const data = loadJSON('knowledge-base.json');
    const idx = data.entries.findIndex(e => e.id === opts.id);
    if (idx === -1) { console.error(`Error: Entry "${opts.id}" not found`); process.exit(1); }
    const removed = data.entries.splice(idx, 1)[0];
    saveJSON('knowledge-base.json', data);
    console.log(`  ✓ Removed: ${removed.question.slice(0, 60)}`);
  },
};

// ─── Blog ────────────────────────────────────
const kbBlogDir = path.join(ROOT, 'src', 'blog');

const blogActions = {
  list() {
    const blogDir = path.join(ROOT, 'build', 'blog');
    if (!fs.existsSync(blogDir)) { console.log('\nNo blog posts found.'); return; }
    const posts = fs.readdirSync(blogDir).filter(f => f.endsWith('.html') && f !== 'index.html');
    console.log('\nBlog Posts:');
    posts.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    console.log(`\n  Total: ${posts.length}`);
  },

  add(opts) {
    if (!opts.title) { console.error('Error: --title required'); process.exit(1); }
    const slug = slugify(opts.title);
    const srcDir = path.join(ROOT, 'src', 'blog');
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

    const author = opts.author || 'The Way Agency';
    const date = opts.date || new Date().toISOString().split('T')[0];

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${opts.title} | The Way Agency Blog</title>
  <meta name="description" content="${opts.description || opts.title}">
  <link rel="canonical" href="https://www.thewayagency.com/blog/${slug}.html">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/src/css/base.css">
  <link rel="stylesheet" href="/src/css/components.css">
</head>
<body>
  <main id="main">
    <article class="section">
      <div class="container container--narrow">
        <p style="font-size:var(--text-sm);color:var(--slate);margin-bottom:var(--space-sm);">${date} &middot; ${author}</p>
        <h1>${opts.title}</h1>
        <p><!-- Write your blog content here --></p>
      </div>
    </article>
  </main>
  <script src="/src/js/app.js"></script>
</body>
</html>`;

    const filePath = path.join(srcDir, `${slug}.html`);
    fs.writeFileSync(filePath, html);
    console.log(`  ✓ Created blog post: src/blog/${slug}.html`);
    console.log(`    Edit the file, then run: node scripts/admin.js deploy`);
  },

  remove(opts) {
    if (!opts.slug) { console.error('Error: --slug required'); process.exit(1); }
    const srcFile = path.join(ROOT, 'src', 'blog', `${opts.slug}.html`);
    const buildFile = path.join(ROOT, 'build', 'blog', `${opts.slug}.html`);
    if (fs.existsSync(srcFile)) { fs.unlinkSync(srcFile); console.log(`  ✓ Removed src/blog/${opts.slug}.html`); }
    if (fs.existsSync(buildFile)) { fs.unlinkSync(buildFile); console.log(`  ✓ Removed build/blog/${opts.slug}.html`); }
  },
};

// ─── Product ─────────────────────────────────
const productActions = {
  list() {
    const data = loadJSON('products.json');
    for (const [line, products] of Object.entries(data)) {
      console.log(`\n${line.toUpperCase()}:`);
      products.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} (${p.id}) — ${p.url}`));
    }
  },
};

// ─── Deploy ──────────────────────────────────
async function deploy() {
  console.log('\n🔨 Rebuilding site...');
  execSync('node scripts/build.js', { cwd: ROOT, stdio: 'inherit' });

  console.log('\n📤 Deploying...');
  try {
    execSync('git add -A && git commit -m "Content update via admin CLI" && git push', {
      cwd: ROOT,
      stdio: 'inherit',
    });
    console.log('\n✅ Deployed! Cloudflare Pages will pick up the push.');
  } catch (err) {
    console.error('\n⚠️  Git push failed. You may need to push manually.');
  }
}

// ─── Router ──────────────────────────────────
const resources = {
  team: teamActions,
  testimonial: testimonialActions,
  kb: kbActions,
  blog: blogActions,
  product: productActions,
};

const [,, resource, action, ...rest] = process.argv;

if (resource === 'deploy') {
  deploy();
} else if (!resource || !resources[resource]) {
  console.log(`
The Way Agency — Content Admin CLI

Usage: node scripts/admin.js <resource> <action> [options]

Resources:
  team          Manage team members
  testimonial   Manage client testimonials
  kb            Manage knowledge base entries
  blog          Manage blog posts
  product       View products

Actions:
  list          List all entries
  add           Add a new entry (use --key value for fields)
  remove        Remove an entry (use --slug or --id)

Special:
  deploy        Rebuild site and push to GitHub (triggers Cloudflare Pages deploy)

Examples:
  node scripts/admin.js team list
  node scripts/admin.js team add --name "Jane Doe" --title "Licensed Agent" --bio "..."
  node scripts/admin.js testimonial add --name "Client Name" --text "Great service!" --rating 5
  node scripts/admin.js kb add --question "Is flood covered?" --answer "No, separate policy" --category personal --product home
  node scripts/admin.js blog add --title "Winter Storm Prep Guide" --author "Sheilia Royal"
  node scripts/admin.js deploy
`);
} else if (!action || !resources[resource][action]) {
  console.error(`Error: Unknown action "${action}" for ${resource}. Available: ${Object.keys(resources[resource]).join(', ')}`);
  process.exit(1);
} else {
  const opts = parseArgs(rest);
  resources[resource][action](opts);
}

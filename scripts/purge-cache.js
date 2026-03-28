#!/usr/bin/env node
/**
 * Purge Cloudflare CDN cache for thewayagency.com
 * Run after deploy to ensure visitors get fresh content immediately.
 *
 * Usage: node scripts/purge-cache.js
 * Requires: CF_PURGE_TOKEN and CF_ZONE_ID environment variables
 */

// Load .env if present
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

const CF_ZONE_ID = process.env.CF_ZONE_ID || '0fc1bde06a1cc8b77706e003c9fb8e37';
const CF_PURGE_TOKEN = process.env.CF_PURGE_TOKEN;

async function purgeCache() {
  if (!CF_PURGE_TOKEN) {
    console.log('  ! CF_PURGE_TOKEN not set — skipping cache purge');
    return;
  }

  console.log('  Purging Cloudflare cache...');

  try {
    const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_PURGE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ purge_everything: true }),
    });

    const data = await resp.json();

    if (data.success) {
      console.log('  ✓ Cache purged — changes are live immediately');
    } else {
      const errors = (data.errors || []).map(e => e.message).join(', ');
      console.log(`  ✗ Cache purge failed: ${errors}`);
      process.exit(1);
    }
  } catch (err) {
    console.log(`  ✗ Cache purge error: ${err.message}`);
    process.exit(1);
  }
}

purgeCache();

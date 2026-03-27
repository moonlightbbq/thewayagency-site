#!/usr/bin/env node
/**
 * The Way Agency — Google Review Updater
 *
 * Fetches the current Google rating and review count and updates
 * data/locations.json so the build injects live data everywhere.
 *
 * The Way Agency is a service-area business (no public storefront),
 * so it doesn't appear in Places API search. We use the Knowledge
 * Graph Machine ID (KGMID) to fetch data from Google's public
 * search results.
 *
 * Usage:
 *   node scripts/update-reviews.js                  # auto-fetch
 *   node scripts/update-reviews.js --rating 5.0 --count 23   # manual update
 *
 * Can be run manually or on a schedule via GitHub Actions.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCATIONS_PATH = path.join(ROOT, 'data', 'locations.json');

// Google Knowledge Graph Machine ID for The Way Agency
const KGMID = '/g/11y2clcvb4';
const SEARCH_URL = `https://www.google.com/search?kgmid=${encodeURIComponent(KGMID)}&hl=en-US&q=The+Way+Agency`;

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rating' && args[i + 1]) result.rating = args[++i];
    if (args[i] === '--count' && args[i + 1]) result.count = args[++i];
  }
  return result;
}

async function fetchFromGoogle() {
  try {
    const resp = await fetch(SEARCH_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await resp.text();

    // Extract rating (e.g., "5.0" or "4.9")
    const ratingMatch = html.match(/(\d\.\d)\s*(?:star|out of)/i)
      || html.match(/aria-label="(\d\.\d) stars"/i)
      || html.match(/"ratingValue"[:\s]*"?(\d\.\d)"?/);

    // Extract review count
    const countMatch = html.match(/(\d+)\s*(?:Google\s*)?reviews/i)
      || html.match(/"reviewCount"[:\s]*"?(\d+)"?/);

    if (ratingMatch && countMatch) {
      return { rating: ratingMatch[1], count: countMatch[1] };
    }

    // If we got the page but couldn't parse, log for debugging
    console.log('  ! Could not parse rating/count from Google search results');
    return null;
  } catch (err) {
    console.log(`  ! Google fetch failed: ${err.message}`);
    return null;
  }
}

async function main() {
  const manual = parseArgs();
  let rating, count;

  if (manual.rating && manual.count) {
    // Manual update
    rating = manual.rating;
    count = manual.count;
    console.log(`  Manual update: ${rating} rating, ${count} reviews`);
  } else {
    // Try auto-fetch
    console.log('  Fetching review data from Google...');
    const result = await fetchFromGoogle();
    if (result) {
      rating = result.rating;
      count = result.count;
      console.log(`  Google rating: ${rating} from ${count} reviews`);
    } else {
      console.log('  ! Auto-fetch failed. Use manual update: node scripts/update-reviews.js --rating 5.0 --count 23');
      process.exit(1);
    }
  }

  // Update locations.json
  const locations = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf8'));
  const prev = {
    rating: locations.agency.google_rating,
    count: locations.agency.google_review_count,
  };

  locations.agency.google_rating = String(rating);
  locations.agency.google_review_count = String(count);

  if (prev.rating !== String(rating) || prev.count !== String(count)) {
    fs.writeFileSync(LOCATIONS_PATH, JSON.stringify(locations, null, 2) + '\n');
    console.log(`  Updated: ${prev.rating}/${prev.count} reviews → ${rating}/${count} reviews`);
    process.exit(0); // Changed — caller should rebuild
  } else {
    console.log('  No change — already up to date.');
    process.exit(1); // No change
  }
}

main();

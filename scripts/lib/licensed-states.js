/**
 * The states the agency is licensed in: data/entity.json licensed_states, the one
 * place they are written (owner-verified; scripts/check-data-integrity.js checks
 * each against scripts/lib/entity.js STATE_NAMES). Every builder and the shared
 * footer read them here, so adding a state is one data edit, never a copy hunt.
 *
 * Read from disk once per process. A missing or empty list throws: the site never
 * guesses which states it may name.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { STATE_NAMES } = require('./entity');

const DEFAULT_DATA = path.join(__dirname, '..', '..', 'data');
const cache = new Map();

function licensedStates(dataDir = DEFAULT_DATA) {
  if (cache.has(dataDir)) return cache.get(dataDir).slice();
  const file = path.join(dataDir, 'entity.json');
  const states = JSON.parse(fs.readFileSync(file, 'utf8')).licensed_states;
  if (!Array.isArray(states) || states.length === 0) throw new Error(`licensed-states: ${file} lists no licensed_states`);
  for (const s of states) if (!STATE_NAMES[s]) throw new Error(`licensed-states: unknown state "${s}" in ${file}`);
  cache.set(dataDir, Object.freeze(states.slice()));
  return states.slice();
}

/**
 * The licensed states where the agency also holds an Accident and Health line:
 * data/entity.json health_licensed_states. Every one must be a licensed state;
 * they come back in licensed_states order. A missing or empty list throws.
 */
function healthLicensedStates(dataDir = DEFAULT_DATA) {
  const key = `health:${dataDir}`;
  if (cache.has(key)) return cache.get(key).slice();
  const file = path.join(dataDir, 'entity.json');
  const listed = JSON.parse(fs.readFileSync(file, 'utf8')).health_licensed_states;
  if (!Array.isArray(listed) || listed.length === 0) throw new Error(`licensed-states: ${file} lists no health_licensed_states`);
  const licensed = licensedStates(dataDir);
  for (const s of listed) if (!licensed.includes(s)) throw new Error(`licensed-states: health state "${s}" in ${file} is not a licensed state`);
  const states = licensed.filter((s) => listed.includes(s));
  cache.set(key, Object.freeze(states.slice()));
  return states.slice();
}

// Products sold under an Accident and Health line although the site files them
// under another line: disability income insurance (life/disability).
const ACCIDENT_HEALTH_PRODUCTS = Object.freeze(['disability']);

/**
 * The states a page's Service areaServed names (Y-74): the health line and the
 * Accident and Health products name only health_licensed_states; every other
 * line names every licensed state.
 * @param {{ line: string, productId?: string }} page
 */
function areaServedStates({ line, productId } = {}, dataDir = DEFAULT_DATA) {
  if (line === 'health' || ACCIDENT_HEALTH_PRODUCTS.includes(productId)) return healthLicensedStates(dataDir);
  return licensedStates(dataDir);
}

module.exports = { licensedStates, healthLicensedStates, areaServedStates, ACCIDENT_HEALTH_PRODUCTS };

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

module.exports = { licensedStates };

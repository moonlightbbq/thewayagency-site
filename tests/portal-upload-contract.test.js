/**
 * The portal document upload posts the body SAGE reads (code review 2026-10,
 * CR-014 / R-11). SAGE /api/portal/:token/upload takes
 * { files: [{ filename, mime_type, data }] } and answers { ok, documents }; this
 * page used to post { images: [{ data, mediaType }] } and read fields_extracted,
 * so every upload was refused and the customer was told the photo was unclear.
 * Reads the source only.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'portal.html'), 'utf8');
const start = src.indexOf('async function handleFiles(');
const end = src.indexOf('\nfunction handleDrop(', start);
const handleFiles = src.slice(start, end);

test('handleFiles is found', () => {
  assert.ok(start > 0 && end > start, 'handleFiles() not found in src/portal.html');
});

test('the upload body key is files, each with filename, mime_type and data', () => {
  assert.match(handleFiles, /\/api\/portal\/' \+ TOKEN \+ '\/upload'/);
  assert.match(handleFiles, /body: JSON\.stringify\(\{ files \}\)/);
  assert.match(handleFiles, /files\.push\(\{ filename: [^}]*mime_type: [^}]*data \}\)/);
  assert.doesNotMatch(handleFiles, /\bimages\b|mediaType/);
});

test('the result is read from { ok, documents }, not an extraction count', () => {
  assert.match(handleFiles, /data\.documents/);
  assert.match(handleFiles, /data\.ok/);
  assert.doesNotMatch(handleFiles, /fields_extracted|No information could be extracted/);
});

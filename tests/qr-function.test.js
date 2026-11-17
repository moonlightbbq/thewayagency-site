/**
 * Tracked QR codes on printed partner kits (owner 2026-11-16): the Cloudflare
 * Pages Function at functions/Q/[code].js. It passes SAGE's redirect on when
 * SAGE answers with a page on this site, and otherwise never breaks: a
 * well-formed code goes to the quote form with its flyer code, anything else to
 * the home page. SAGE is stubbed; no network.
 *
 *   node --test tests/qr-function.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FILE = path.join(__dirname, '..', 'functions', 'Q', '[code].js');
const load = () => import(pathToFileURL(FILE).href);

const sageAnswers = (status, location) => async () => ({
  status,
  headers: { get: (k) => (k.toLowerCase() === 'location' ? location : null) },
});

describe('functions/Q/[code].js', () => {
  test('passes on SAGE\'s redirect to a page on the site', async () => {
    const { resolve } = await load();
    const target = 'https://thewayagency.com/intake/?line=personal&src=flyer-ag7k2';
    let asked;
    const fetchImpl = async (url, opts) => { asked = { url, opts }; return sageAnswers(302, target)(); };
    assert.equal(await resolve('AG7K2', 'GET', fetchImpl), target);
    assert.equal(asked.url, 'https://sage.thewayagency.com/q/AG7K2');
    assert.equal(asked.opts.method, 'GET');
    assert.equal(asked.opts.redirect, 'manual');
  });

  test('a lower-case code is read in upper case', async () => {
    const { resolve } = await load();
    let asked;
    const fetchImpl = async (url) => { asked = url; return sageAnswers(302, 'https://thewayagency.com/')(); };
    await resolve('ag7k2', 'GET', fetchImpl);
    assert.equal(asked, 'https://sage.thewayagency.com/q/AG7K2');
  });

  test('HEAD is passed to SAGE as HEAD, so it is not counted', async () => {
    const { resolve } = await load();
    let method;
    const fetchImpl = async (url, opts) => { method = opts.method; return sageAnswers(302, 'https://thewayagency.com/')(); };
    await resolve('AG7K2', 'HEAD', fetchImpl);
    assert.equal(method, 'HEAD');
  });

  test('SAGE down, slow or odd: the quote form with the flyer code', async () => {
    const { resolve } = await load();
    const fallback = 'https://thewayagency.com/intake/?src=flyer-ag7k2';
    assert.equal(await resolve('AG7K2', 'GET', async () => { throw new Error('timeout'); }), fallback);
    assert.equal(await resolve('AG7K2', 'GET', sageAnswers(500, null)), fallback);
    assert.equal(await resolve('AG7K2', 'GET', sageAnswers(200, null)), fallback);
  });

  test('never follows SAGE off the site', async () => {
    const { resolve } = await load();
    const fallback = 'https://thewayagency.com/intake/?src=flyer-ag7k2';
    for (const bad of ['https://evil.example.com/', 'http://thewayagency.com/intake/', '//evil.example.com', 'javascript:alert(1)', 'https://thewayagency.com.evil.example/']) {
      assert.equal(await resolve('AG7K2', 'GET', sageAnswers(302, bad)), fallback, bad);
    }
  });

  test('a malformed code goes home without asking SAGE', async () => {
    const { resolve } = await load();
    let called = false;
    const fetchImpl = async () => { called = true; return sageAnswers(302, 'https://thewayagency.com/')(); };
    for (const bad of ['', 'AB0CD', 'ABCDEF', '../x', 'A%2FB']) {
      assert.equal(await resolve(bad, 'GET', fetchImpl), 'https://thewayagency.com/', bad);
    }
    assert.equal(called, false);
  });

  test('onRequest answers 302 with private headers, and 405 for other methods', async () => {
    const mod = await load();
    const res = await mod.onRequest({ request: new Request('https://thewayagency.com/Q/AB0CD'), params: { code: 'AB0CD' } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://thewayagency.com/');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('x-robots-tag'), /noindex/);
    const post = await mod.onRequest({ request: new Request('https://thewayagency.com/Q/AG7K2', { method: 'POST' }), params: { code: 'AG7K2' } });
    assert.equal(post.status, 405);
  });
});

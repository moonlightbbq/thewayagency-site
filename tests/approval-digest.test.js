/**
 * The topic-approval digest — the human gate between "an adapter proposed a
 * topic" and "it can be scheduled".
 *
 * The scoring it reports is content-queue's and is tested there; what matters
 * here is that the script is safe to run unattended: it must never send
 * without credentials, never crash on an empty backlog, and must surface a
 * cannibalization conflict rather than presenting a doomed topic as fine.
 *
 * BL-78 (sage AIA-121): a reply binds to the digest it answers. The digest
 * carries an id (subject tag and footer) and, once sent, records its ordered
 * slug list and recipients in data/content-backlog.json digests[], which SAGE
 * resolves "approve 2" / "approve all" against.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'send-approval-digest.js');
const digest = require(SCRIPT);
const q = require('../scripts/lib/content-queue');

function run(env = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--dry-run', '--today', '2026-08-05'], {
    encoding: 'utf8',
    env: { ...process.env, SAGE_API_URL: '', SAGE_API_TOKEN: '', SAGE_CLIENT_ID: '', ...env },
  });
}

// A fixture backlog, never the real data/content-backlog.json: node --test runs
// files in parallel processes, and other suites read the real one.
const candidate = (slug, extra = {}) => ({
  slug, title: `Synthetic ${slug}`, primary_keyword: `synthetic ${slug}`, status: 'proposed', source: 'test',
  description: `Synthetic description for ${slug}.`, related_cluster: null, seasonality_window: null, ...extra,
});
function fixture(candidates, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-digest-'));
  const file = path.join(dir, 'content-backlog.json');
  fs.writeFileSync(file, `${JSON.stringify({ _doc: 'synthetic', version: q.BACKLOG_SCHEMA_VERSION, status_values: ['proposed', 'approved', 'on-hold', 'rejected'], candidates, ...extra }, null, 2)}\n`);
  return { dir, file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('send-approval-digest', () => {
  test('runs clean against the real backlog and never sends in dry-run', () => {
    const r = run();
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.match(r.stdout, /dry-run|No proposed candidates/);
  });

  test('does not attempt a send when SAGE_API_URL is absent', () => {
    // A cron misconfiguration must degrade to a no-op, not a crash loop.
    const r = run({ SAGE_API_URL: '' });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /send failed/);
  });

  test('exits 2 rather than silently doing nothing when configured but missing credentials', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--today', '2026-08-05'], {
      encoding: 'utf8',
      env: { ...process.env, SAGE_API_URL: 'https://example.invalid', SAGE_API_TOKEN: '', SAGE_CLIENT_ID: '' },
    });
    // Either it exits 2 for missing credentials, or 0 because nothing is
    // proposed. Both are correct; a crash is not.
    assert.ok([0, 2].includes(r.status), `unexpected exit ${r.status}: ${r.stderr}`);
  });

  test('requiring the script sends nothing (SAGE and the tests load its helpers)', () => {
    assert.equal(typeof digest.buildDigest, 'function');
    assert.equal(typeof digest.digestId, 'function');
  });
});

// What SAGE's POST /api/email-drafts accepts (sage-server src/schemas/email-drafts.js
// createDraftSchema): `to` a single address (z.string().email()), `cc` an
// address or a list of addresses, a subject and a body. Before review round 1
// a comma-separated APPROVAL_TO / APPROVAL_CC was posted as one string and
// SAGE answered 400, so no digest went out.
const SAGE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function sageAccepts(body) {
  const ccOk = body.cc === undefined
    || (typeof body.cc === 'string' && SAGE_EMAIL.test(body.cc))
    || (Array.isArray(body.cc) && body.cc.every((a) => typeof a === 'string' && SAGE_EMAIL.test(a)));
  return typeof body.to === 'string' && SAGE_EMAIL.test(body.to) && ccOk
    && typeof body.subject === 'string' && body.subject !== '' && typeof body.body === 'string' && body.body !== '';
}
const SEND_ENV = { SAGE_API_URL: 'https://sage.example.test', SAGE_API_TOKEN: 'TEST-token', SAGE_CLIENT_ID: 'TEST-client' };

describe('the digest is bound: id, footer and recorded snapshot (BL-78)', () => {
  // The same vector is pinned in sage-server tests/topic-approvals.test.js
  // (digestIdFor): both repos must compute the same id from the same list.
  test('cross-repo vector: the id is the send date and 12 hex of sha256 over the ordered slugs', () => {
    assert.equal(digest.digestId('2026-08-05', ['synthetic-b', 'synthetic-a', 'synthetic-c']), '2026-08-05-35c9aa1c9437');
    assert.notEqual(digest.digestId('2026-08-05', ['synthetic-a', 'synthetic-b', 'synthetic-c']), '2026-08-05-35c9aa1c9437');
  });

  // Review round 1, N-3: the same vector is pinned in sage-server
  // tests/topic-approvals.test.js (topicHash). SAGE approves a topic only while
  // it still hashes to what the digest recorded.
  test('cross-repo vector: a topic hash is 12 hex of sha256 over its title, description and keyword', () => {
    assert.equal(digest.topicHash({ title: 'SYNTHETIC title', description: 'SYNTHETIC description', primary_keyword: 'synthetic keyword' }), '78f09e8b0734');
    assert.equal(digest.topicHash({ title: 'SYNTHETIC title', description: null }), digest.topicHash({ title: 'SYNTHETIC title', description: '', primary_keyword: '' }));
  });

  test('the subject and footer carry the id; the snapshot lists the slugs in the order they are numbered', () => {
    const backlog = { candidates: [candidate('synthetic-one'), candidate('synthetic-two'), candidate('synthetic-held', { status: 'on-hold' }), candidate('synthetic-three')] };
    const d = digest.buildDigest({ cal: q.loadCalendar(), backlog, today: '2026-08-05', to: 'Reviewer@Example.test', cc: 'partner@example.test, second@example.test' });
    const { snapshot } = d;
    assert.equal(snapshot.id, digest.digestId('2026-08-05', snapshot.slugs));
    assert.equal(snapshot.sent_on, '2026-08-05');
    assert.deepEqual([...snapshot.slugs].sort(), ['synthetic-one', 'synthetic-three', 'synthetic-two']); // proposed only
    assert.deepEqual(snapshot.slugs, d.scored.map(({ c }) => c.slug));
    assert.deepEqual(snapshot.recipients, ['reviewer@example.test', 'partner@example.test', 'second@example.test']);
    // What each numbered topic said, for SAGE's changed-since-the-digest check.
    assert.deepEqual(snapshot.topic_hashes, Object.fromEntries(d.scored.map(({ c }) => [c.slug, digest.topicHash(c)])));
    assert.deepEqual(Object.keys(snapshot.topic_hashes).sort(), [...snapshot.slugs].sort());
    assert.match(d.subject, new RegExp(`^Topic Approval: 3 candidates for week of 2026-08-05 \\[digest:${snapshot.id}\\]$`));
    assert.ok(d.html.includes(`digest-id: ${snapshot.id} | slugs: ${snapshot.slugs.join(',')}`));
    // SAGE reads the instruction line as written and refuses a reply with
    // another line that names a topic or may change it (sage BL-78 review
    // rounds 2 to 4); the email says what to do and what SAGE refuses, with
    // examples SAGE does refuse, and promises nothing wider. It says which
    // line SAGE takes as the sign-off (round 4): a closing, or a name of up to
    // three capitalized words, so "Agreed" on its own line is one. Since round
    // 5 the closing must stand alone ("Thanks for these" is not one), and the
    // email says SAGE reads only what is typed above the quoted email. Since
    // round 7 it says so exactly: an indented line is read, a comment inside
    // the quoted email or below a quote the reviewer adds is not, and a reply
    // with struck-through text, or an indent and no quoted email below it,
    // approves nothing.
    assert.ok(d.html.includes('Put the whole instruction on that one line, with nothing before "approve" but a greeting or thanks,'));
    assert.ok(d.html.includes('mention no topic anywhere else in your reply: to leave a topic out, list the ones you approve (<code>approve 1,2,4</code>).'));
    assert.match(d.html, /SAGE refuses a reply with another line, above your sign-off or in a P\.S\., that names a topic by its number or slug\s+or says reject, postpone, except, not or wait: "approve all" with "reject 4" below it approves nothing/);
    assert.doesNotMatch(d.html, /If another line of your reply qualifies it/);
    assert.match(d.html, /Your sign-off is the first line below the instruction that is only a closing, such as "Thanks," or "Best regards, Sam",\s+or only a name: up to three capitalized words on a line of their own\. A line such as "Thanks for these" is not a sign-off\./);
    assert.match(d.html, /SAGE reads only what you type above the quoted email, so leave the quoted email below your reply: an indented line is read,\s+but a comment typed inside this email, or below a quote you add, is not\./);
    assert.match(d.html, /A reply with struck-through text, or with an indented block\s+and no quoted email below it, approves nothing: delete the text instead of striking it through\./);
    assert.doesNotMatch(d.html, /above the quoted email: a comment typed inside this email is not read/);
    assert.doesNotMatch(d.html, /that is a closing such as "Thanks," or a name/);
    // Row N of the email is slug N of the snapshot.
    snapshot.slugs.forEach((slug, i) => {
      const row = d.html.indexOf(`<strong>${i + 1}</strong>`);
      const next = d.html.indexOf(`<strong>${i + 2}</strong>`);
      const at = d.html.indexOf(`>${slug}</code>`);
      assert.ok(row >= 0 && at > row && (next < 0 || at < next), `row ${i + 1} is ${slug}`);
    });
  });

  test('nothing proposed: no digest', () => {
    assert.equal(digest.buildDigest({ cal: q.loadCalendar(), backlog: { candidates: [candidate('x', { status: 'approved' })] }, today: '2026-08-05', to: 'a@example.test', cc: '' }), null);
  });

  test('recordDigest keeps one entry per id, newest last, at most DIGEST_KEEP, and touches nothing else', () => {
    const b = { candidates: [candidate('synthetic-one')], digests: [] };
    for (let i = 0; i < digest.DIGEST_KEEP + 3; i++) digest.recordDigest(b, { id: `2026-08-0${i % 9}-${String(i).padStart(12, '0')}`, sent_on: '2026-08-01', slugs: ['x'], recipients: [] });
    assert.equal(b.digests.length, digest.DIGEST_KEEP);
    assert.equal(b.digests.at(-1).id, `2026-08-0${(digest.DIGEST_KEEP + 2) % 9}-${String(digest.DIGEST_KEEP + 2).padStart(12, '0')}`);
    digest.recordDigest(b, { ...b.digests[0], recipients: ['again@example.test'] });
    assert.equal(b.digests.length, digest.DIGEST_KEEP);
    assert.deepEqual(b.digests.at(-1).recipients, ['again@example.test']);
    assert.deepEqual(b.candidates, [candidate('synthetic-one')]);
  });

  // Review round 1, N-4 (mutation S3 survived): every id above was unique, and
  // re-recording the oldest one let the slice hide a kept duplicate. SAGE binds
  // to the FIRST entry with an id, so a stale duplicate would decide who may approve.
  test('re-recording an id already in the list leaves exactly one entry for it, the newest', () => {
    const b = { candidates: [], digests: [] };
    const ids = ['2026-08-01-000000000001', '2026-08-02-000000000002', '2026-08-03-000000000003'];
    for (const id of ids) digest.recordDigest(b, { id, sent_on: id.slice(0, 10), slugs: ['x'], recipients: ['first@example.test'] });
    digest.recordDigest(b, { id: ids[1], sent_on: '2026-08-02', slugs: ['x'], recipients: ['again@example.test'] });
    assert.deepEqual(b.digests.map((d) => d.id), [ids[0], ids[2], ids[1]]);
    assert.equal(b.digests.filter((d) => d.id === ids[1]).length, 1);
    assert.deepEqual(b.digests.find((d) => d.id === ids[1]).recipients, ['again@example.test']);
  });

  test('a successful send records the snapshot in the backlog (and only the digests key changes)', async () => {
    const fx = fixture([candidate('synthetic-one'), candidate('synthetic-two')]);
    try {
      const before = fx.read();
      const sent = [];
      const fetchImpl = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => '' }; };
      const code = await digest.main(['--today', '2026-08-05'], { ...SEND_ENV, APPROVAL_TO: 'reviewer@example.test', APPROVAL_CC: 'second@example.test' }, { backlogPath: fx.file, fetchImpl });
      assert.equal(code, 0);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].url, 'https://sage.example.test/api/email-drafts');
      assert.ok(sageAccepts(sent[0].body), JSON.stringify({ to: sent[0].body.to, cc: sent[0].body.cc }));
      const after = fx.read();
      assert.equal(after.digests.length, 1);
      const [rec] = after.digests;
      assert.equal(rec.id, digest.digestId('2026-08-05', rec.slugs));
      assert.deepEqual(rec.recipients, ['reviewer@example.test', 'second@example.test']);
      assert.ok(sent[0].body.subject.endsWith(`[digest:${rec.id}]`));
      assert.ok(sent[0].body.body.includes(`digest-id: ${rec.id}`));
      delete after.digests;
      assert.deepEqual(after, before);
      assert.equal(q.loadBacklog(fx.file).version, q.BACKLOG_SCHEMA_VERSION); // still loadable by the queue
    } finally { fx.done(); }
  });

  // Review round 1, M-2 (probe p5-comma-recipients): the comma-separated list
  // the docs allowed reached SAGE as one string, a 400, and no digest was sent.
  test('a Cc list is sent as a list SAGE accepts, and exactly the addresses sent are recorded', async () => {
    for (const APPROVAL_CC of ['partner@example.test, second@example.test', 'partner@example.test;second@example.test', 'Reviewer@Example.test, partner@example.test, second@example.test']) {
      const fx = fixture([candidate('synthetic-one'), candidate('synthetic-two')]);
      try {
        const sent = [];
        const fetchImpl = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, status: 201, text: async () => '' }; };
        assert.equal(await digest.main(['--today', '2026-08-05'], { ...SEND_ENV, APPROVAL_TO: 'Reviewer@Example.test', APPROVAL_CC }, { backlogPath: fx.file, fetchImpl }), 0, APPROVAL_CC);
        const [body] = sent;
        assert.ok(sageAccepts(body), JSON.stringify({ to: body.to, cc: body.cc }));
        assert.equal(body.to, 'reviewer@example.test');
        assert.deepEqual(body.cc, ['partner@example.test', 'second@example.test']); // the To is not copied
        assert.deepEqual(fx.read().digests[0].recipients, [body.to, ...body.cc]);
      } finally { fx.done(); }
    }
  });

  test('no APPROVAL_CC set: the default Cc goes as a one-address list; an empty one sends no Cc', async () => {
    const fx = fixture([candidate('synthetic-one')]);
    try {
      const sent = [];
      const fetchImpl = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, status: 201, text: async () => '' }; };
      assert.equal(await digest.main(['--today', '2026-08-05'], { ...SEND_ENV, APPROVAL_TO: 'reviewer@example.test' }, { backlogPath: fx.file, fetchImpl }), 0);
      assert.ok(sageAccepts(sent[0]));
      assert.equal(sent[0].cc.length, 1);
      assert.deepEqual(fx.read().digests[0].recipients, [sent[0].to, ...sent[0].cc]);
      assert.equal(await digest.main(['--today', '2026-08-06'], { ...SEND_ENV, APPROVAL_TO: 'reviewer@example.test', APPROVAL_CC: ' , ' }, { backlogPath: fx.file, fetchImpl }), 0);
      assert.deepEqual(sent[1].cc, []);
      assert.ok(sageAccepts(sent[1]));
      assert.deepEqual(fx.read().digests[1].recipients, ['reviewer@example.test']);
    } finally { fx.done(); }
  });

  test('more than one APPROVAL_TO, or something that is not an address, exits 2 before anything is sent or recorded', async () => {
    for (const env of [
      { APPROVAL_TO: 'reviewer@example.test, owner@example.test' },
      { APPROVAL_TO: 'reviewer@example.test;owner@example.test' },
      { APPROVAL_TO: ' , ' , APPROVAL_CC: 'partner@example.test' },
      { APPROVAL_TO: 'reviewer@example.test', APPROVAL_CC: 'partner at example dot test' },
      { APPROVAL_TO: 'Reviewer <reviewer@example.test>' },
    ]) {
      const fx = fixture([candidate('synthetic-one')]);
      try {
        const before = fs.readFileSync(fx.file, 'utf8');
        let called = false;
        const fetchImpl = async () => { called = true; return { ok: true, status: 201, text: async () => '' }; };
        assert.equal(await digest.main(['--today', '2026-08-05'], { ...SEND_ENV, ...env }, { backlogPath: fx.file, fetchImpl }), 2, JSON.stringify(env));
        assert.equal(await digest.main(['--dry-run', '--today', '2026-08-05'], { ...SEND_ENV, ...env }, { backlogPath: fx.file, fetchImpl }), 2, `dry run: ${JSON.stringify(env)}`);
        assert.equal(called, false);
        assert.equal(fs.readFileSync(fx.file, 'utf8'), before);
      } finally { fx.done(); }
    }
  });

  test('a failed send or a dry run records nothing', async () => {
    const fx = fixture([candidate('synthetic-one')]);
    try {
      const before = fs.readFileSync(fx.file, 'utf8');
      const env = { SAGE_API_URL: 'https://sage.example.test', SAGE_API_TOKEN: 'TEST-token', SAGE_CLIENT_ID: 'TEST-client' };
      const failing = async () => ({ ok: false, status: 503, text: async () => 'SYNTHETIC outage' });
      assert.equal(await digest.main(['--today', '2026-08-05'], env, { backlogPath: fx.file, fetchImpl: failing }), 2);
      let called = false;
      assert.equal(await digest.main(['--dry-run', '--today', '2026-08-05'], env, { backlogPath: fx.file, fetchImpl: async () => { called = true; } }), 0);
      assert.equal(called, false);
      assert.equal(fs.readFileSync(fx.file, 'utf8'), before);
    } finally { fx.done(); }
  });

  test('the workflow sends and commits the snapshot in one run, by hand only, through the CAS push', () => {
    const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'topic-approval-digest.yml'), 'utf8');
    assert.match(wf, /^on:\n {2}workflow_dispatch:\n/m);
    assert.doesNotMatch(wf, /^\s*schedule:/m); // scheduling is an owner decision
    assert.match(wf, /run: node scripts\/send-approval-digest\.js\n/);
    assert.match(wf, /git add data\/content-backlog\.json\n/);
    assert.match(wf, /bash scripts\/git-push-rebase\.sh main/);
    assert.doesNotMatch(wf, /^\s*git push\b/m);
    // Review round 1, N-7: it shares the calendar workflows' group and never
    // cancels a running one; the comment says what a pending run costs.
    assert.match(wf, /^concurrency:\n {2}group: blog-review-calendar\n {2}cancel-in-progress: false\n/m);
  });
});

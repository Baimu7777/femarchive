import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
let auditPublication, renderAuditMarkdown;
try { ({ auditPublication, renderAuditMarkdown } = await import('../scripts/lib/publication-audit.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('website provides a local read-only publication auditor', () => {
  assert.equal(typeof auditPublication, 'function');
});

async function fixture(t, values = ['private-audit-canary.invalid']) {
  const root = await mkdtemp('/private/tmp/website-audit-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'public'), forbiddenFile = join(root, 'private.json');
  await mkdir(directory);
  await writeFile(forbiddenFile, JSON.stringify(values), { mode: 0o600 });
  return { root, directory, forbiddenFile };
}
const check = (name, fn) => test(name, { skip: !auditPublication }, fn);

check('long inline Base64 is inspected without an unreadable-file exception', async t => {
  const f = await fixture(t);
  const payload = Buffer.alloc(6 * 1024 * 1024, 0xff).toString('base64');
  await writeFile(join(f.directory, 'page.html'), `<img src="data:image/jpeg;base64,${payload}">`);
  const result = await auditPublication({ ...f, limits: { maxFileBytes: 16 * 1024 * 1024 } });
  assert.equal(result.checked, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.findings, []);
});

check('a long plain line without a setext underline is fully inspected instead of overflowing the Markdown regex', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'long.md'), 'Prefix ' + 'A'.repeat(10 * 1024 * 1024) + '\n');
  const result = await auditPublication({ ...f, limits: { maxFileBytes: 16 * 1024 * 1024 } });
  assert.equal(result.checked, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.findings, []);
});

check('audit Markdown keeps real setext headings, including stripped blockquote and list prefixes', () => {
  assert.equal(typeof renderAuditMarkdown, 'function');
  assert.equal(renderAuditMarkdown('Title\n===\n'), '<h1>Title</h1>\n');
  assert.equal(renderAuditMarkdown('> Title\n> ---\n'), '<blockquote>\n<h2>Title</h2>\n</blockquote>\n');
  assert.equal(renderAuditMarkdown('- Title\n  ===\n'), '<ul>\n<li><h1>Title</h1>\n</li>\n</ul>\n');
});

check('explicit finite character budgets count all decoded views and fail closed on exhaustion', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'safe.md'), 'Public text '.repeat(300));
  const limited = await auditPublication({ ...f, limits: { maxDecodeCharsMultiplier: 1 } });
  assert.equal(limited.checked, 1);
  assert.equal(limited.complete, false);
  assert.ok(limited.findings.some(item => item.rule === 'DECODE_LIMIT'));
  const expanded = await auditPublication({ ...f, limits: { maxDecodeCharsMultiplier: 128 } });
  assert.equal(expanded.complete, true);
  assert.deepEqual(expanded.findings, []);
  const invalid = await auditPublication({ ...f, limits: { maxDecodeCharsMultiplier: 1025 } });
  assert.equal(invalid.complete, false);
  assert.ok(invalid.findings.some(item => item.rule === 'INVALID_INPUT'));
});

check('larger explicit decode budgets inspect many unrelated tokens and a late nested canary', async t => {
  const f = await fixture(t);
  const tokens = Array.from({ length: 140 }, (_, index) => Buffer.from(`public unique text ${index}`).toString('base64'));
  const canary = 'private-audit-canary.invalid';
  tokens.push(Buffer.from(Buffer.from(canary).toString('base64')).toString('base64'));
  await writeFile(join(f.directory, 'tokens.md'), tokens.join(' '));
  const result = await auditPublication({ ...f, limits: { maxDecodeViews: 4096, maxDecodeQueue: 16384 } });
  assert.equal(result.complete, true);
  assert.ok(result.findings.some(finding => finding.rule === 'FORBIDDEN_CONTENT'));
  assert.ok(!JSON.stringify(result).includes(canary));
});

check('nested Base64 Unicode expansion remains inspected without length pruning', async t => {
  const canary = '\ufdfa\ufdfa';
  const f = await fixture(t, [canary]);
  const encoded = Buffer.from(Buffer.from(canary).toString('base64')).toString('base64');
  await writeFile(join(f.directory, 'encoded.txt'), encoded);
  const result = await auditPublication(f);
  assert.equal(result.complete, true);
  assert.ok(result.findings.some(item => item.rule === 'FORBIDDEN_CONTENT'));
  assert.ok(!JSON.stringify(result).includes(canary));
});

check('comparison guards retain decoded entity, escape and serialized HTML matches', async t => {
  for (const [needle, source] of [
    ['private-audit-canary.invalid', 'private-audit-canary%2einvalid'],
    ['private-audit-canary.invalid', 'private-audit-canary\\u002einvalid'],
    ['private-audit-canary.invalid', 'private-audit-canary&#46;invalid'],
    ['&gt;', 'prefix > suffix'],
    ['&amp;', 'prefix & suffix'],
  ]) {
    const f = await fixture(t, [needle]);
    await writeFile(join(f.directory, 'encoded.txt'), Buffer.from(source).toString('base64'));
    const result = await auditPublication(f);
    assert.equal(result.complete, true);
    assert.ok(result.findings.some(item => item.rule === 'FORBIDDEN_CONTENT'));
  }
});

check('source, rendered text, encodings and binary metadata still detect private values', async t => {
  const canary = 'private-audit-canary.invalid', f = await fixture(t);
  const encoded = Buffer.from(canary).toString('base64');
  const contents = [
    `<!-- ${canary} -->`,
    'private-<strong>audit-</strong>canary.invalid',
    // Both pinned Hugo/Goldmark and marked render this into the complete
    // forbidden value. A hyphen just before the closing ** is not emphasis.
    'private-**audit**-canary.invalid',
    [...canary].map(c => `%${c.charCodeAt(0).toString(16)}`).join(''),
    [...canary].map(c => `&#${c.charCodeAt(0)};`).join(''),
    `https://public.invalid/${encoded}`,
    Buffer.from(canary, 'utf16le'),
  ];
  for (const [index, body] of contents.entries()) await writeFile(join(f.directory, `probe-${index}.bin`), body);
  const chunk = (name, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(name), data, Buffer.alloc(4)]);
  };
  const png = Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('zTXt', Buffer.concat([Buffer.from('Description\0\0'), deflateSync(Buffer.from(canary))])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  await writeFile(join(f.directory, 'metadata.png'), png);
  const result = await auditPublication(f);
  assert.equal(result.complete, true);
  assert.equal(result.checked, 8);
  assert.equal(result.findings.filter(item => item.rule === 'FORBIDDEN_CONTENT').length, 8);
  assert.ok(!JSON.stringify(result).includes(canary));
});

check('decode and file budgets still report incomplete rather than passing', async t => {
  const f = await fixture(t), canary = 'private-audit-canary.invalid';
  let encoded = canary;
  for (let i = 0; i < 80; i++) encoded = encoded.replaceAll('%', '%25').replaceAll('-', '%2d');
  await writeFile(join(f.directory, 'deep.txt'), encoded);
  const result = await auditPublication(f);
  assert.equal(result.complete, false);
  assert.ok(result.findings.some(item => item.rule === 'DECODE_LIMIT'));
  const limited = await auditPublication({ ...f, limits: { maxFileBytes: 1 } });
  assert.equal(limited.complete, false);
  assert.ok(limited.findings.some(item => item.rule === 'LIMIT_EXCEEDED'));
});

check('deleted Git blobs and commit identities are audited without changing history', async t => {
  const f = await fixture(t), canary = 'private-audit-canary.invalid';
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: canary, GIT_AUTHOR_EMAIL: 'editor@website.invalid',
    GIT_COMMITTER_NAME: canary, GIT_COMMITTER_EMAIL: 'editor@website.invalid' };
  const git = (...args) => execFileSync('git', ['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-C',f.directory,...args], { env, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q');
  await writeFile(join(f.directory, 'old.txt'), canary);
  git('add', '.'); git('commit', '-qm', 'Synthetic article');
  await rm(join(f.directory, 'old.txt'));
  await writeFile(join(f.directory, 'safe.txt'), 'public text');
  git('add', '-A'); git('commit', '-qm', 'Remove old article');
  const head = git('rev-parse', 'HEAD');
  const result = await auditPublication({ git: f.directory, forbiddenFile: f.forbiddenFile });
  assert.equal(result.complete, true);
  assert.ok(result.findings.some(item => item.rule === 'FORBIDDEN_CONTENT'));
  assert.ok(result.findings.some(item => item.rule === 'FORBIDDEN_COMMIT_IDENTITY'));
  assert.ok(!JSON.stringify(result).includes(canary));
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain'), '');
  git('config', 'remote.origin.url', 'https://public.invalid/repo.git');
  const remote = await auditPublication({ git: f.directory, forbiddenFile: f.forbiddenFile });
  assert.equal(remote.complete, false);
  assert.ok(remote.findings.some(item => item.rule === 'REMOTE_HISTORY_UNVERIFIED'));
});

check('local CLI requires explicit inputs and returns only sanitized JSON', async t => {
  const f = await fixture(t), cli = new URL('../scripts/audit-publication.mjs', import.meta.url).pathname;
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  assert.equal(run([]).status, 1);
  assert.equal(run(['--directory', f.directory, '--forbidden-file', f.forbiddenFile, '--unknown']).status, 1);
  assert.equal(run(['--directory', f.directory, '--forbidden-file', f.forbiddenFile, 'toString', 'unused']).status, 1);
  const args = ['--directory', f.directory, '--forbidden-file', f.forbiddenFile, '--large-repository'];
  await writeFile(join(f.directory, 'safe.txt'), 'public text');
  assert.equal(run(args).status, 0);
  await writeFile(join(f.directory, 'unsafe.txt'), 'private-audit-canary.invalid');
  const rejected = run(args);
  assert.equal(rejected.status, 1);
  assert.ok(!rejected.stdout.includes('private-audit-canary.invalid'));
  assert.ok(!rejected.stdout.includes(f.root));
  assert.equal(rejected.stderr, '');
  assert.equal(JSON.parse(rejected.stdout).complete, true);
});

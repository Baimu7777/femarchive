import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request, token } from './helpers.mjs';
let entry, receipts;
try { entry = await import('../api/publishing.mjs'); receipts = await import('../publishing/lib/receipts.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
test('Vercel exposes a Web Request fetch handler', () => assert.equal(typeof entry?.default?.fetch, 'function'));
const check = (name, fn) => test(name, { skip: !entry }, fn);
check('production factory is disabled for missing or invalid configuration without network', async () => {
  let calls = 0;
  const env = { WEBSITE_PUBLISHING_ENABLED: 'true', WEBSITE_PUBLISHING_TOKEN: token, WEBSITE_GITHUB_TOKEN: 'synthetic', WEBSITE_GITHUB_OWNER: 'site-owner', WEBSITE_GITHUB_REPO: 'site-repo', WEBSITE_GITHUB_BRANCH: 'main', WEBSITE_PUBLIC_ORIGIN: 'https://website.example', WEBSITE_R2_ENDPOINT: 'https://synthetic.r2.cloudflarestorage.com', WEBSITE_R2_BUCKET: 'website-private', WEBSITE_R2_ACCESS_KEY_ID: 'synthetic', WEBSITE_R2_SECRET_ACCESS_KEY: 'synthetic' };
  for (const key of Object.keys(env)) {
    const partial = { ...env }; delete partial[key];
    const response = await entry.createConfiguredReceiver(partial, { fetch: () => { calls++; throw new Error('network'); } })(request('catalog'));
    assert.equal(response.status, 503);
  }
  for (const value of [{ WEBSITE_PUBLISHING_ENABLED: 'false' }, { WEBSITE_PUBLIC_ORIGIN: 'http://localhost' }, { WEBSITE_R2_ENDPOINT: 'https://evil.example' }, { WEBSITE_PUBLISHING_TOKEN: 'short' }, { WEBSITE_GITHUB_BRANCH: '../other' }]) assert.equal((await entry.createConfiguredReceiver({ ...env, ...value })(request('catalog'))).status, 503);
  assert.equal(calls, 0);
  assert.equal((await entry.createConfiguredReceiver(env)(request('catalog'))).status, 200);
});

check('real R2 adapter uses immutable conditional private JSON objects', async () => {
  const objects = new Map(), calls = [];
  const client = { async send(command) {
    const input = command.input; calls.push({ name: command.constructor.name, input });
    if (command.constructor.name === 'GetObjectCommand') { if (!objects.has(input.Key)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' }); return { Body: { transformToString: async () => objects.get(input.Key) } }; }
    assert.equal(command.constructor.name, 'PutObjectCommand'); assert.equal(input.IfNoneMatch, '*');
    if (objects.has(input.Key)) throw Object.assign(new Error('exists'), { $metadata: { httpStatusCode: 412 } });
    objects.set(input.Key, input.Body); return {};
  } };
  const store = receipts.createR2Objects({ client, bucket: 'website-private' }); const service = receipts.createReceipts(store); const key = randomUUID();
  const first = await service.reserve('publish', key, 'a'.repeat(64), async () => ({ articleId: randomUUID(), path: 'synthetic' }));
  assert.deepEqual(await service.reserve('publish', key, 'a'.repeat(64), async () => { throw new Error('must not reallocate'); }), first);
  await assert.rejects(service.reserve('publish', key, 'b'.repeat(64), async () => ({})), { status: 409 });
  assert.ok(calls.every(c => c.input.Bucket === 'website-private')); assert.ok(calls.every(c => !c.input.ACL));
});

check('publishing credentials use the same bounded URL-safe alphabet as the sender', async () => {
  const env = { WEBSITE_PUBLISHING_ENABLED: 'true', WEBSITE_PUBLISHING_TOKEN: token, WEBSITE_GITHUB_TOKEN: 'synthetic', WEBSITE_GITHUB_OWNER: 'site-owner', WEBSITE_GITHUB_REPO: 'site-repo', WEBSITE_GITHUB_BRANCH: 'main', WEBSITE_PUBLIC_ORIGIN: 'https://website.example', WEBSITE_R2_ENDPOINT: 'https://synthetic.r2.cloudflarestorage.com', WEBSITE_R2_BUCKET: 'website-private', WEBSITE_R2_ACCESS_KEY_ID: 'synthetic', WEBSITE_R2_SECRET_ACCESS_KEY: 'synthetic' };
  for (const invalid of ['a'.repeat(31), 'a'.repeat(257), 'a'.repeat(32) + '+', 'a'.repeat(32) + '=', 'a'.repeat(32) + '/', 'a'.repeat(32) + ' ']) {
    const response = await entry.createConfiguredReceiver({ ...env, WEBSITE_PUBLISHING_TOKEN: invalid })(request('catalog'));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'UNAVAILABLE', message: 'Publishing unavailable.' });
  }
});

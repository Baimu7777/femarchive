import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredReceiver } from '../api/publishing.mjs';
import { createReceiver } from '../publishing/lib/receiver.mjs';
import { catalog, request } from './helpers.mjs';

const environment = {
  WEBSITE_PUBLISHING_ENABLED: 'true',
  WEBSITE_PUBLISHING_TOKEN: 'synthetic-service-token-0123456789abcdef',
  WEBSITE_GITHUB_TOKEN: 'synthetic', WEBSITE_GITHUB_OWNER: 'site-owner',
  WEBSITE_GITHUB_REPO: 'site-repo', WEBSITE_GITHUB_BRANCH: 'main',
  WEBSITE_PUBLIC_ORIGIN: 'https://website.example',
  WEBSITE_R2_ENDPOINT: 'https://synthetic.r2.cloudflarestorage.com',
  WEBSITE_R2_BUCKET: 'website-private', WEBSITE_R2_ACCESS_KEY_ID: 'synthetic',
  WEBSITE_R2_SECRET_ACCESS_KEY: 'synthetic',
};

// A widened token validator must fail these tests before any network or writes.
const invalid = [
  'A'.repeat(31), 'A'.repeat(257), 'A'.repeat(512),
  `${'A'.repeat(32)}+`, `${'A'.repeat(32)}/`, `${'A'.repeat(32)}=`,
  `${'A'.repeat(32)}!`, `${'A'.repeat(32)} `, `${'A'.repeat(32)}é`,
];
test('configured entry rejects service tokens outside the agreed URL-safe range without network', async () => {
  let calls = 0;
  const fetch = () => { calls++; throw new Error('synthetic network forbidden'); };
  for (const [index, token] of invalid.entries()) {
    const handler = createConfiguredReceiver({ ...environment, WEBSITE_PUBLISHING_TOKEN: token }, { fetch });
    assert.equal((await handler(request('catalog'))).status, 503, `invalid case ${index}`);
  }
  assert.equal(calls, 0);
});

test('direct receiver fails closed for invalid tokens before repository or receipt access', async () => {
  let calls = 0;
  const unavailable = new Proxy({}, { get() { calls++; throw new Error('synthetic storage forbidden'); } });
  for (const [index, token] of invalid.entries()) {
    const handler = createReceiver({ token, catalog, repository: unavailable, receipts: unavailable });
    assert.equal((await handler(request('catalog'))).status, 503, `invalid case ${index}`);
  }
  assert.equal(calls, 0);
});

test('service token bounds accept 32 and 256 URL-safe characters with valid authentication', async () => {
  for (const token of ['A_0-'.repeat(8), 'a_Z-0'.repeat(51) + '_']) {
    const handler = createConfiguredReceiver({ ...environment, WEBSITE_PUBLISHING_TOKEN: token });
    const response = await handler(request('catalog', undefined, undefined, { authorization: `Bearer ${token}` }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), catalog);
  }
});

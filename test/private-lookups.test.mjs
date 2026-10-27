import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createReceiver } from '../publishing/lib/receiver.mjs';
import { createGitHubRepository } from '../publishing/lib/github.mjs';
import { createReceipts } from '../publishing/lib/receipts.mjs';
import { token, catalog, fixture, request, memoryObjects, gitService } from './helpers.mjs';

// Every published term is listed in the term registry, and a publication
// rechecks that registry several times. Each identifier must still be looked
// up only once per request, or a growing glossary outlasts the forum's wait.
test('one publication looks up each identifier once, however many terms exist', async () => {
  const remote = gitService(), objects = memoryObjects(), receipts = createReceipts(objects);
  const repository = createGitHubRepository({ token: 'synthetic', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', fetch: remote.fetch });
  const receiver = () => createReceiver({ token, catalog, repository, receipts });
  for (let index = 0; index < 6; index++) assert.equal((await receiver()(request('publish', { ...fixture(), title: `词条${index}` }, randomUUID()))).status, 200);
  const lookups = [], get = objects.get;
  objects.get = async key => { if (/^(assets|requests|candidates|results)\//.test(key)) lookups.push(key); return get.call(objects, key); };
  assert.equal((await receiver()(request('publish', { ...fixture(), title: '新词条' }, randomUUID()))).status, 200);
  const privacyChecks = lookups.filter(key => /^(assets|requests\/asset|requests\/publish|candidates\/asset|candidates\/publish|results\/asset|results\/publish)\/[0-9a-f-]{36}$/.test(key));
  assert.ok(privacyChecks.length >= 6 * 7, 'every published term is still checked');
  const repeated = privacyChecks.filter((key, index) => privacyChecks.indexOf(key) !== index && !key.startsWith('requests/publish/') && !key.startsWith('candidates/publish/') && !key.startsWith('results/publish/'));
  assert.deepEqual(repeated, []);
});

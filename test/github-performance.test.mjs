import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createGitHubRepository } from '../publishing/lib/github.mjs';
import { gitService } from './helpers.mjs';

test('immutable baseline reads share one request while writes upload at most four blobs concurrently', async () => {
  const remote = gitService();
  let active = 0, peak = 0, reads = 0;
  const repository = createGitHubRepository({ token: 'synthetic', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example',
    fetch: async (url, init) => {
      if (url.includes('/contents/')) reads++;
      if (url.endsWith('/git/blobs') && init.method === 'POST') {
        active++; peak = Math.max(peak, active);
        try { await new Promise(resolve => setTimeout(resolve, 5)); return await remote.fetch(url, init); }
        finally { active--; }
      }
      return remote.fetch(url, init);
    },
  });
  const base = await repository.snapshot();
  const files = Array.from({ length: 6 }, (_, index) => ({ path: `content/lexicon/${randomUUID()}.md`, bytes: Buffer.from(`body ${index}`) }));
  const first = files[0].path;
  assert.deepEqual(await Promise.all([repository.read(first, base.head), repository.read(first, base.head)]), [null, null]);
  assert.equal(reads, 1);
  const candidate = await repository.prepare(base, files);
  assert.equal(peak, 4);
  await repository.apply(candidate);
  const updated = await repository.snapshot();
  assert.equal((await repository.read(first, updated.head)).bytes.toString(), 'body 0');
  assert.equal(reads, 2, 'new revisions never reuse old content');
});


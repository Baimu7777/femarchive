import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webRequest } from '../notifications/config.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a streamed comment body keeps a character that falls across two chunks', async () => {
  const bytes = Buffer.from(JSON.stringify({ comment: '姦如磐石' }));
  const cut = bytes.indexOf(Buffer.from('磐')) + 1;
  const req = { method: 'POST', url: '/api/community', headers: { host: 'archive.test', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield bytes.subarray(0, cut); yield bytes.subarray(cut); } };
  assert.deepEqual(await (await webRequest(req)).json(), { comment: '姦如磐石' });
});

test('a streamed body over the limit is refused', async () => {
  const req = { method: 'POST', url: '/api/community', headers: { host: 'archive.test' },
    async *[Symbol.asyncIterator]() { yield Buffer.alloc(12000, 97); yield Buffer.alloc(12000, 97); } };
  await assert.rejects(webRequest(req), /body limit/);
});

test('an article page asks the comment service for its count once', () => {
  // site.js fills every .waline-comment-count; the comment client must not count again.
  assert.match(read('layouts/partials/waline.html'), /comment: false,/);
  assert.match(read('static/js/site.js'), /commentCountQueued/);
});

test('robots.txt names the sitemap and keeps crawlers off the functions', () => {
  const robots = read('layouts/robots.txt');
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Sitemap: \{\{ "sitemap\.xml" \| absURL \}\}$/m);
  // Entries are kept out of search results by their own noindex tag, which a
  // crawler can only read if it is allowed to fetch the page.
  assert.doesNotMatch(robots, /lexicon/);
});

test('the search index and the search page cover figures as well', () => {
  assert.match(read('layouts/index.json.json'), /slice "posts" "news" "figures"/);
  assert.match(read('layouts/search/list.html'), /data-search-scope="figures"/);
});

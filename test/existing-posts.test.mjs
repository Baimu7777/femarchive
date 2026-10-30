import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createReceiver } from '../publishing/lib/receiver.mjs';
import { createGitHubRepository } from '../publishing/lib/github.mjs';
import { createReceipts } from '../publishing/lib/receipts.mjs';
import { token, catalog, fixture, request, memoryObjects, gitService } from './helpers.mjs';

const id = '1ac5d0b7-46a2-407b-915b-cf9939f9211c';
const path = 'content/posts/35字词整理.md';
const source = '---\ntitle: "字词整理"\nslug: "261035"\nauthor: "文库作者"\ncategories: ["语言回声"]\ntags: []\n---\n\n## 字词整理\n\n<section class="language-discussion-group language-discussion-group--warm" aria-labelledby="words">\n\n### 字义讨论 {#words}\n\n{{< card >}}\n保留已经整理的说明。\n{{< /card >}}\n\n</section>\n';
function setup() {
  const remote = gitService({ slugs: true }); remote.edit(path, source);
  const importedPosts = { [id]: { path, title: '字词整理', revision: remote.files().get(path).sha } };
  const repository = createGitHubRepository({ token: 'test', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', approvedPostPaths: [path], fetch: remote.fetch });
  const receive = createReceiver({ token, repository, receipts: createReceipts(memoryObjects()), catalog, importedPosts });
  return { remote, receive };
}
test('lists and resumes only the approved original website article, preserving its URL and design', async () => {
  const { remote, receive } = setup();
  assert.deepEqual(await (await receive(request('articles'))).json(), { articles: [{ articleId: id, title: '字词整理', url: 'https://website.example/posts/261035/' }] });
  const read = await receive(request(`article&articleId=${id}&section=posts`)); assert.equal(read.status, 200);
  const article = await read.json();
  assert.match(article.html, /data-tone="warm"/); assert.match(article.html, /保留已经整理的说明/);
  assert.equal(remote.calls.filter(call => call.method !== 'GET').length, 0);
  const update = await receive(request('publish', { ...fixture(), section: 'posts', presentation: 'article', title: '字词整理续编', html: article.html, comments: [], categories: [], articleId: id, expectedRevision: article.revision }));
  assert.equal(update.status, 200); assert.equal((await update.json()).url, article.url);
  assert.match(remote.text(path), /author: "文库作者"/); assert.match(remote.text(path), /language-discussion-group--warm/);
  assert.equal(remote.text(`content/posts/${id}.md`), null);
  const reread = await receive(request(`article&articleId=${id}&section=posts`)); assert.equal(reread.status, 200);
  assert.match((await reread.json()).html, /data-tone="warm"/);
});
test('refuses an unknown article and a legacy source changed before its first adoption', async () => {
  const s = setup();
  assert.equal((await s.receive(request(`article&articleId=${randomUUID()}&section=posts`))).status, 404);
  s.remote.edit(path, source + '\n另一次网站修改。\n');
  assert.equal((await s.receive(request(`article&articleId=${id}&section=posts`))).status, 409);
  assert.equal(s.remote.calls.filter(call => call.method !== 'GET').length, 0);
});
test('Git adapter never grants neighboring legacy files or browser supplied paths', async () => {
  const s = setup();
  assert.equal((await s.receive(request('articles&path=content/posts/other.md'))).status, 400);
  const repository = createGitHubRepository({ token: 'test', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', approvedPostPaths: [path], fetch: s.remote.fetch });
  const snapshot = await repository.snapshot();
  await assert.rejects(repository.read('content/posts/other.md', snapshot.head));
  assert.throws(() => createGitHubRepository({ token: 'test', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', approvedPostPaths: ['content/posts/../config.md'] }));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createReceiver, allocateSlug } from '../publishing/lib/receiver.mjs';
import { createGitHubRepository } from '../publishing/lib/github.mjs';
import { createReceipts } from '../publishing/lib/receipts.mjs';
import { readDocument, writeDocument, articleFields, validateArticle, newsSource, readNewsSource } from '../publishing/lib/document.mjs';
import { raisedRegistry, slugProblems } from '../scripts/check-slugs.mjs';
import { token, catalog, fixture, request, memoryObjects, gitService } from './helpers.mjs';

const slugPath = 'data/website-publication-slugs.json';
function setup({ importedPosts = {}, slugs = true } = {}) {
  const remote = gitService({ slugs }), objects = memoryObjects();
  const repository = createGitHubRepository({ token: 'synthetic-github-token', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', approvedPostPaths: Object.values(importedPosts).map(post => post.path), fetch: remote.fetch });
  const receipts = createReceipts(objects);
  return { remote, objects, receive: createReceiver({ token, repository, receipts, catalog, importedPosts }) };
}
const post = (title = '新文章') => ({ ...fixture(), section: 'posts', presentation: 'article', title, comments: [] });
const news = (overrides = {}) => ({ ...fixture(), section: 'news', presentation: 'article', title: '一条新闻', categories: [], comments: [], publishDate: '2026-03-26T16:03:16+08:00', sourceName: '新华网', sourceUrl: 'https://www.news.cn/item.html', ...overrides });
const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: '2-digit' }).format(new Date());
const counter = remote => JSON.parse(remote.text(slugPath));

test('slugs are YY + section + a zero-padded sequence that grows past three digits', () => {
  assert.equal(allocateSlug({ posts: { 26: 39 } }, 'posts', '2026-10-30T03:00:00Z').slug, '261040');
  assert.equal(allocateSlug({ news: { 26: 7 } }, 'news', '2026-10-30T03:00:00Z').slug, '262008');
  assert.equal(allocateSlug({ posts: { 26: 999 } }, 'posts', '2026-10-30T03:00:00Z').slug, '2611000');
  // A new year starts its own sequence; the year is China time.
  assert.equal(allocateSlug({ posts: { 26: 50 } }, 'posts', '2026-12-31T17:00:00Z').slug, '271001');
});

test('a new article takes the next number after the registry, in the same commit', async () => {
  const s = setup();
  const response = await s.receive(request('publish', post()));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.url, `https://website.example/posts/${year}1041/`);
  const text = s.remote.text(`content/posts/${result.articleId}.md`);
  assert.match(text, new RegExp(`slug: ${year}1041|slug: "${year}1041"|slug: '${year}1041'`));
  assert.doesNotMatch(text, /^url:/m);
  assert.equal(counter(s.remote).posts[year], 41);
  assert.equal(s.remote.calls.filter(call => call.method === 'POST' && call.url.endsWith('git/commits')).length, 1);
});

test('a retry keeps its number, an update never renumbers, and a removed number is not reused', async () => {
  const s = setup(), key = randomUUID();
  const first = await (await s.receive(request('publish', post('甲'), key))).json();
  const again = await (await s.receive(request('publish', post('甲'), key))).json();
  assert.deepEqual(again, first);
  const article = await (await s.receive(request(`article&articleId=${first.articleId}&section=posts`))).json();
  const updated = await (await s.receive(request('publish', { ...post('甲改'), articleId: first.articleId, expectedRevision: article.revision }))).json();
  assert.equal(updated.url, first.url);
  assert.equal(counter(s.remote).posts[year], 41);
  const removed = await s.receive(request('delete', { version: 1, confirmed: true, articleId: first.articleId, expectedRevision: updated.revision, section: 'posts' }));
  assert.equal(removed.status, 200);
  const next = await (await s.receive(request('publish', post('乙')))).json();
  assert.equal(next.url, `https://website.example/posts/${year}1042/`);
});

test('one batch numbers its new articles in order without gaps or repeats', async () => {
  const s = setup();
  const response = await s.receive(request('publish-batch', { version: 1, confirmed: true, items: [post('一'), news(), post('二')] }));
  assert.equal(response.status, 200);
  const urls = (await response.json()).items.map(item => item.url);
  assert.deepEqual(urls, [`https://website.example/posts/${year}1041/`, `https://website.example/news/${year}2008/`, `https://website.example/posts/${year}1042/`]);
  assert.deepEqual(counter(s.remote), { posts: { [year]: 42 }, news: { 26: 7, [year]: year === '26' ? 8 : 1 } });
});

test('two sends from the same baseline cannot both take one number', async () => {
  const s = setup();
  const [left, right] = await Promise.all([s.receive(request('publish', post('左'))), s.receive(request('publish', post('右')))]);
  const statuses = [left.status, right.status].sort();
  // One commits; the other finds the branch moved and writes nothing.
  assert.deepEqual(statuses, [200, 409]);
  const retry = await s.receive(request('publish', post('右')));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).url, `https://website.example/posts/${year}1042/`);
});

test('without the number registry nothing new is published', async () => {
  const s = setup({ slugs: false });
  const response = await s.receive(request('publish', post()));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, 'SLUG_REGISTRY_INVALID');
  assert.equal(s.remote.calls.filter(call => call.method === 'POST' && call.url.endsWith('git/commits')).length, 0);
});

test('news carries its own date and named source, no author or categories', async () => {
  const s = setup();
  const result = await (await s.receive(request('publish', news()))).json();
  const document = readDocument(Buffer.from(s.remote.text(`content/news/${result.articleId}.md`)));
  assert.equal(document.metadata.date, '2026-03-26T16:03:16+08:00');
  assert.equal(document.metadata.original_url, '[新华网](https://www.news.cn/item.html)');
  assert.equal(document.metadata.author, undefined);
  assert.equal(document.metadata.categories, undefined);
  const read = await (await s.receive(request(`article&articleId=${result.articleId}&section=news`))).json();
  assert.equal(read.publishDate, '2026-03-26T16:03:16+08:00');
  assert.equal(read.sourceName, '新华网');
  assert.equal(read.sourceUrl, 'https://www.news.cn/item.html');
  const updated = await s.receive(request('publish', news({ articleId: result.articleId, expectedRevision: read.revision, publishDate: '2026-03-27', sourceName: '另一家' })));
  assert.equal(updated.status, 200);
  const after = readDocument(Buffer.from(s.remote.text(`content/news/${result.articleId}.md`)));
  assert.equal(after.metadata.date, '2026-03-27');
  assert.equal(after.metadata.slug, result.url.match(/\/news\/(\d+)\//)[1]);
});

test('news refuses article-only fields, and articles refuse news-only fields', () => {
  assert.throws(() => validateArticle(news({ categories: ['思考讨论'] }), catalog));
  assert.throws(() => validateArticle(news({ publishDate: '26 March' }), catalog));
  assert.throws(() => validateArticle(news({ sourceName: '名称[带括号]' }), catalog));
  assert.throws(() => validateArticle({ ...post(), publishDate: '2026-03-26' }, catalog));
  assert.doesNotThrow(() => validateArticle({ ...post(), replaceCategories: true }, catalog));
  assert.deepEqual(readNewsSource(newsSource('名称', 'https://example.org/a')), { sourceName: '名称', sourceUrl: 'https://example.org/a' });
  assert.deepEqual(readNewsSource('https://example.org/a'), { sourceUrl: 'https://example.org/a' });
  assert.deepEqual(readNewsSource('只有名称'), { sourceName: '只有名称' });
});

test('an article update may replace its categories when it says so', () => {
  const previous = writeDocument(post(), '<p>正文</p>', null, { articleId: randomUUID(), date: '2026-10-29T00:00:00Z', slug: '261041' });
  const kept = readDocument(writeDocument({ ...post(), categories: ['理论分野'] }, '<p>正文</p>', previous, {}));
  assert.deepEqual(kept.metadata.categories, ['思考讨论']);
  const replaced = readDocument(writeDocument({ ...post(), categories: ['理论分野'], replaceCategories: true }, '<p>正文</p>', previous, {}));
  assert.deepEqual(replaced.metadata.categories, ['理论分野']);
  assert.equal(replaced.metadata.slug, '261041');
});

test('registered hand-written posts and news are listed without reading each file', async () => {
  const remote = gitService({ slugs: true });
  remote.edit('content/posts/34女权是不是不应该过生日.md', '---\ntitle: "女权是不是不应该过生日"\nslug: "261034"\noriginal_date: "2025"\n---\n\n正文\n\n{{< commentsection title="评论交流区" >}}\n\n{{< card >}}\n一条评论\n{{< /card >}}\n');
  remote.edit('content/news/07-0326.md', '---\ntitle: "一条旧新闻"\ndate: 2026-03-26T16:03:16+08:00\nslug: "262007"\noriginal_url: "[新华网](https://www.news.cn/a.html)"\n---\n正文\n');
  const files = remote.files();
  const importedPosts = {
    [randomUUID()]: { path: 'content/posts/34女权是不是不应该过生日.md', revision: files.get('content/posts/34女权是不是不应该过生日.md').sha, title: '女权是不是不应该过生日', section: 'posts', slug: '261034' },
    [randomUUID()]: { path: 'content/news/07-0326.md', revision: files.get('content/news/07-0326.md').sha, title: '一条旧新闻', section: 'news', slug: '262007' },
  };
  const repository = createGitHubRepository({ token: 'synthetic-github-token', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', approvedPostPaths: Object.values(importedPosts).map(item => item.path), fetch: remote.fetch });
  const receive = createReceiver({ token, repository, receipts: createReceipts(memoryObjects()), catalog, importedPosts });
  const before = remote.calls.length;
  const listed = (await (await receive(request('articles'))).json()).articles;
  assert.deepEqual(listed.map(article => article.url).sort(), ['https://website.example/news/262007/', 'https://website.example/posts/261034/']);
  assert.equal(remote.calls.slice(before).filter(call => call.url.includes('/contents/')).length, 0);
  const [postId, newsId] = Object.keys(importedPosts);
  const legacy = await (await receive(request(`article&articleId=${postId}&section=posts`))).json();
  assert.match(legacy.html, /data-publication-layout="card"/);
  assert.equal(legacy.originalDate, '2025');
  // Updating keeps the hand-chosen number and writes no number registry change.
  const update = await receive(request('publish', { ...post('女权是不是不应该过生日'), html: legacy.html, articleId: postId, expectedRevision: legacy.revision }));
  assert.equal(update.status, 200);
  assert.equal((await update.json()).url, 'https://website.example/posts/261034/');
  assert.equal(JSON.parse(remote.text(slugPath)).posts[26], 40);
  const oldNews = await (await receive(request(`article&articleId=${newsId}&section=news`))).json();
  assert.equal(oldNews.sourceName, '新华网');
  // A post identifier cannot be read as news, nor the other way round.
  assert.notEqual((await receive(request(`article&articleId=${newsId}&section=posts`))).status, 200);
});

test('a layout the editor cannot carry back is refused with a reason', async () => {
  const remote = gitService({ slugs: true }), path = 'content/posts/40手写.md';
  remote.edit(path, '---\ntitle: "手写"\nslug: "261040"\n---\n\n<div class="custom">手写的布局</div>\n{{< card >}}\n卡片\n{{< /card >}}\n');
  const id = randomUUID();
  const importedPosts = { [id]: { path, revision: remote.files().get(path).sha, title: '手写', section: 'posts', slug: '261040' } };
  const repository = createGitHubRepository({ token: 'synthetic-github-token', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', approvedPostPaths: [path], fetch: remote.fetch });
  const receive = createReceiver({ token, repository, receipts: createReceipts(memoryObjects()), catalog, importedPosts });
  const response = await receive(request(`article&articleId=${id}&section=posts`));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, 'LEGACY_MARKUP');
});

test('the build check finds a repeated number and one the registry has not recorded', () => {
  const used = [
    { section: 'posts', file: 'a.md', slug: '261039' },
    { section: 'posts', file: 'b.md', slug: '261041' },
    { section: 'news', file: 'c.md', slug: '262007' },
    { section: 'news', file: 'd.md', slug: '262007' },
  ];
  const registry = { posts: { 26: 40 }, news: { 26: 7 } };
  const problems = slugProblems(used, registry);
  assert.equal(problems.length, 2);
  assert.match(problems.join('\n'), /262007/);
  assert.match(problems.join('\n'), /261041/);
  assert.deepEqual(raisedRegistry(used, registry), { posts: { 26: 41 }, news: { 26: 7 } });
  assert.deepEqual(articleFields(readDocument(Buffer.from('---\ntitle: T\ndate: 2026-03-26\noriginal_url: "https://x.example/a"\n---\nbody\n')), 'news').sourceUrl, 'https://x.example/a');
});

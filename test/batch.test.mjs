import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { token, catalog, fixture, request, memoryObjects, gitService } from './helpers.mjs';

let modules;
try { modules = await Promise.all([import('../publishing/lib/receiver.mjs'), import('../publishing/lib/github.mjs'), import('../publishing/lib/receipts.mjs')]); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const check = (name, fn) => test(name, { skip: !modules }, fn);

function setup() {
  const remote = gitService(), objects = memoryObjects();
  const repository = modules[1].createGitHubRepository({ token: 'synthetic-github-token', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', fetch: remote.fetch });
  const receipts = modules[2].createReceipts(objects);
  return { remote, objects, repository, receipts, receive: modules[0].createReceiver({ token, repository, receipts, catalog }) };
}
const batch = (s, items, key) => s.receive(request('publish-batch', { version: 1, confirmed: true, items }, key));
const entry = title => ({ ...fixture(), title, html: `<p>${title} 的公开正文</p>`, comments: [] });
const articlePath = id => `content/lexicon/${id}.md`;
const termsPath = 'data/website-publication-terms.json';
const commits = remote => remote.calls.filter(call => call.method === 'POST' && call.url.endsWith('git/commits')).length;
const refWrites = remote => remote.calls.filter(call => call.method === 'PATCH').length;

check('a whole batch becomes one commit and rewrites the term registry once', async () => {
  const s = setup();
  const titles = ['批量词条一', '批量词条二', '批量词条三'];
  const response = await batch(s, titles.map(entry));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.items.length, 3);
  assert.equal(new Set(result.items.map(item => item.articleId)).size, 3);
  // One tree, one commit, one branch update for the whole batch.
  assert.equal(commits(s.remote), 1);
  assert.equal(refWrites(s.remote), 1);
  assert.equal(s.remote.calls.filter(call => call.method === 'POST' && call.url.endsWith('git/trees')).length, 1);
  // Every article and the single shared term list live in that one commit.
  const files = [...s.remote.files().keys()].sort();
  assert.deepEqual(files, [...result.items.map(item => articlePath(item.articleId)), termsPath].sort());
  const terms = JSON.parse(s.remote.text(termsPath));
  assert.deepEqual(terms.map(term => term.title).sort(), [...titles].sort());
  assert.deepEqual(terms.map(term => term.url).sort(), result.items.map(item => item.url).sort());
  for (const item of result.items) assert.match(s.remote.text(articlePath(item.articleId)), /的公开正文/);
});

check('replaying the same batch key returns the same articles without a second commit', async () => {
  const s = setup();
  const key = randomUUID(), items = ['重放一', '重放二'].map(entry);
  const first = await (await batch(s, items, key)).json();
  const head = s.remote.head;
  const again = await (await batch(s, items, key)).json();
  assert.deepEqual(again, first);
  assert.equal(s.remote.head, head);
  assert.equal(commits(s.remote), 1);
});

check('a lost acknowledgement finishes the same prepared commit instead of a new one', async () => {
  const s = setup();
  const key = randomUUID(), items = ['恢复一', '恢复二'].map(entry);
  s.remote.failAfterPatch = true;
  await assert.rejects(batch(s, items, key).then(response => { if (!response.ok) throw new Error(String(response.status)); }));
  const recovered = await (await batch(s, items, key)).json();
  assert.equal(recovered.items.length, 2);
  assert.equal(commits(s.remote), 1);
  assert.equal(JSON.parse(s.remote.text(termsPath)).length, 2);
});

check('a changed batch under an already used key is refused and writes nothing', async () => {
  const s = setup();
  const key = randomUUID();
  await batch(s, ['同一批'].map(entry), key);
  const head = s.remote.head;
  assert.equal((await batch(s, ['另一批'].map(entry), key)).status, 409);
  assert.equal(s.remote.head, head);
});

check('a stale expected revision fails the whole batch without writing any item', async () => {
  const s = setup();
  const created = await (await batch(s, ['可更新词条'].map(entry))).json();
  const head = s.remote.head, target = created.items[0];
  const stale = { ...entry('改过的词条'), articleId: target.articleId, expectedRevision: 'a'.repeat(40) };
  assert.equal((await batch(s, [stale, entry('同批新词条')])).status, 409);
  assert.equal(s.remote.head, head);
  assert.equal(JSON.parse(s.remote.text(termsPath)).length, 1);
});

check('an update and a new entry travel in one commit and the registry keeps both', async () => {
  const s = setup();
  const created = await (await batch(s, ['原词条'].map(entry))).json();
  const target = created.items[0];
  const before = commits(s.remote);
  const updated = await (await batch(s, [
    { ...entry('改名后的词条'), articleId: target.articleId, expectedRevision: target.revision },
    entry('同批新增'),
  ])).json();
  assert.equal(commits(s.remote), before + 1);
  assert.equal(updated.items[0].articleId, target.articleId);
  const terms = JSON.parse(s.remote.text(termsPath));
  assert.deepEqual(terms.map(term => term.title).sort(), ['同批新增', '改名后的词条']);
});

check('two items writing the same article, and malformed envelopes, are refused before any write', async () => {
  const s = setup();
  const created = await (await batch(s, ['唯一词条'].map(entry))).json();
  const head = s.remote.head, target = created.items[0];
  const update = { ...entry('重复目标'), articleId: target.articleId, expectedRevision: target.revision };
  assert.equal((await batch(s, [update, { ...update, title: '另一个标题' }])).status, 409);
  for (const envelope of [
    { version: 1, confirmed: true, items: [] },
    { version: 1, confirmed: false, items: [entry('未确认')] },
    { version: 2, confirmed: true, items: [entry('版本不对')] },
    { version: 1, confirmed: true, items: [entry('多出字段')], extra: 1 },
    { version: 1, confirmed: true, items: Array.from({ length: 21 }, (_, index) => entry(`太多${index}`)) },
    { version: 1, confirmed: true, items: [{ ...entry('缺少确认'), confirmed: false }] },
  ]) assert.equal((await s.receive(request('publish-batch', envelope))).status, 400);
  assert.equal((await s.receive(request('publish-batch', { version: 1, confirmed: true, items: [entry('缺少键')] }, 'not-uuid'))).status, 400);
  assert.equal(s.remote.head, head);
});

check('a private request key inside any item refuses the batch without writing', async () => {
  const s = setup();
  const key = randomUUID();
  const items = [entry('安全的一项'), { ...entry('泄露的一项'), html: `<p>收据 ${key}</p>` }];
  assert.equal((await batch(s, items, key)).status, 400);
  assert.equal(s.objects.data.size, 0);
  assert.equal(s.remote.calls.filter(call => call.method !== 'GET').length, 0);
});

check('an earlier batch key cannot reappear as public text in a later batch', async () => {
  const s = setup();
  const first = randomUUID();
  await batch(s, ['先发一项'].map(entry), first);
  const head = s.remote.head;
  assert.equal((await batch(s, [{ ...entry('引用旧凭据'), html: `<p>${first}</p>` }])).status, 400);
  assert.equal(s.remote.head, head);
});

check('posts in a batch stay out of the term registry', async () => {
  const s = setup();
  const result = await (await batch(s, [
    { ...entry('文章一'), section: 'posts', presentation: 'article' },
    { ...entry('文章二'), section: 'posts', presentation: 'article' },
  ])).json();
  assert.equal(result.items.length, 2);
  assert.equal(commits(s.remote), 1);
  assert.equal(s.remote.text(termsPath), null);
  for (const item of result.items) assert.ok(s.remote.files().has(`content/posts/${item.articleId}.md`));
});

check('the batch operation keeps the protocol gates of a single publication', async () => {
  const s = setup();
  const items = [entry('网关检查')];
  for (const [headers, status] of [[{ authorization: '' }, 401], [{ cookie: 'session=synthetic' }, 403], [{ origin: 'https://website.example' }, 403]]) {
    assert.equal((await s.receive(request('publish-batch', { version: 1, confirmed: true, items }, randomUUID(), headers))).status, status);
  }
  assert.equal((await s.receive(new Request('https://website.example/api/publishing?operation=publish-batch', { headers: { authorization: `Bearer ${token}` } }))).status, 405);
  assert.equal(s.objects.data.size, 0); assert.equal(s.remote.calls.length, 0);
});

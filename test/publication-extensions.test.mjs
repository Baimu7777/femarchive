import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import yaml from 'js-yaml';
import { createReceiver } from '../publishing/lib/receiver.mjs';
import { createGitHubRepository } from '../publishing/lib/github.mjs';
import { createReceipts } from '../publishing/lib/receipts.mjs';
import { fixture, token, catalog, request, memoryObjects, gitService } from './helpers.mjs';

const registryPath = 'data/website-publication-tags.json';
function setup(sharedTags = []) {
  const remote = gitService({ slugs: true }), objects = memoryObjects(), receipts = createReceipts(objects);
  const repository = createGitHubRepository({ token: 'synthetic', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', fetch: remote.fetch });
  const receive = () => createReceiver({ token, repository, receipts, catalog: { ...catalog, sharedTags } });
  return { remote, objects, repository, receipts, receive: receive(), freshReceiver: receive };
}
const publish = (s, value, key) => s.receive(request('publish', value, key));
async function upload(s) {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#884422' } }).webp().toBuffer();
  const response = await s.receive(request('asset', bytes, randomUUID(), { 'content-type': 'image/webp', 'x-publishing-confirmed': '1' }));
  assert.equal(response.status, 200); return response.json();
}
const frontmatter = source => yaml.load(source.split('---')[1]);

test('each selected image stays inside its own discussion card or plain excerpt', async () => {
  const s = setup(), a = await upload(s), b = await upload(s);
  for (const presentation of ['discussion', 'article']) {
    const response = await publish(s, { ...fixture(), section: 'posts', presentation, comments: ['First excerpt', 'Second excerpt'], commentImages: [[a.path], [b.path]], assets: [a.receipt, b.receipt] });
    assert.equal(response.status, 200);
    const { articleId } = await response.json(), source = s.remote.text(`content/posts/${articleId}.md`);
    assert.equal(frontmatter(source).publication_layout, presentation);
    if (presentation === 'discussion') {
      const cards = [...source.matchAll(/<div class="mycard mycard--reply"><div class="mycard__content">([\s\S]*?)<\/div><\/div>/g)].map(m => m[1]);
      assert.equal(cards.length, 2);
      assert.ok(cards[0].includes(a.path)); assert.ok(!cards[0].includes(b.path));
      assert.ok(cards[1].includes(b.path)); assert.ok(!cards[1].includes(a.path));
    } else {
      assert.ok(source.indexOf('First excerpt') < source.indexOf(a.path));
      assert.ok(source.indexOf(a.path) < source.indexOf('Second excerpt'));
      assert.ok(source.indexOf('Second excerpt') < source.indexOf(b.path));
    }
    assert.ok(!source.includes(a.receipt)); assert.ok(!source.includes(b.receipt));
  }
});

test('comment image paths require matching shape, bounded unique entries and selected receipts', async () => {
  const s = setup(), a = await upload(s), before = s.remote.head;
  for (const commentImages of [[], [[] , []], [null], [[a.path, a.path]], [['/private/image.webp']], [['https://website.example' + a.path]], [[`/images/articles/${randomUUID()}.webp`]], [Array.from({ length: 51 }, () => `/images/articles/${randomUUID()}.webp`)]]) {
    assert.equal((await publish(s, { ...fixture(), commentImages, assets: [a.receipt] })).status, 400);
  }
  assert.equal((await publish(s, { ...fixture(), commentImages: [[a.path]], assets: [] })).status, 400);
  assert.equal(s.remote.head, before);
});

test('an image-only selected comment publishes while an entirely empty excerpt is rejected', async () => {
  const s = setup(), image = await upload(s);
  for (const presentation of ['discussion', 'article']) {
    const response = await publish(s, { ...fixture(), presentation, comments: [''], commentImages: [[image.path]], assets: [image.receipt] });
    assert.equal(response.status, 200);
    const source = s.remote.text(`content/lexicon/${(await response.json()).articleId}.md`);
    assert.ok(source.includes(image.path)); assert.doesNotMatch(source, /<p><\/p>/);
  }
  assert.equal((await publish(s, { ...fixture(), comments: [''], commentImages: [[]] })).status, 400);
  assert.equal((await publish(s, { ...fixture(), comments: [''] })).status, 400);
});

test('discussion GET and a title-only update preserve structured text and image-only reply cards', async () => {
  const s = setup(), a = await upload(s), b = await upload(s);
  const value = { ...fixture(), section: 'posts', presentation: 'discussion', html: '<p>Article body</p>', comments: ['First & literal <text>\nSecond line', ''], commentImages: [[a.path], [b.path]], assets: [a.receipt, b.receipt] };
  const created = await publish(s, value); assert.equal(created.status, 200);
  const first = await created.json(), path = `content/posts/${first.articleId}.md`;
  const before = s.remote.text(path), footer = before.slice(before.indexOf('<p class="douban-comments-title">'));
  const read = await s.receive(request(`article&articleId=${first.articleId}&section=posts`)); assert.equal(read.status, 200);
  const current = await read.json();
  assert.deepEqual(current.comments, ['First & literal <text>\nSecond line', '']);
  assert.deepEqual(current.commentImages, [[a.path], [b.path]]);
  assert.match(current.html, /Article body/); assert.doesNotMatch(current.html, /First|Second|mycard|douban-comments-title/);
  assert.ok(!current.html.includes(a.path)); assert.ok(!current.html.includes(b.path));
  const update = await publish(s, { ...value, title: 'Updated title', html: current.html, comments: current.comments, commentImages: current.commentImages, articleId: first.articleId, expectedRevision: current.revision });
  assert.equal(update.status, 200); assert.equal((await update.json()).articleId, first.articleId);
  assert.equal(s.remote.text(path).slice(s.remote.text(path).indexOf('<p class="douban-comments-title">')), footer);
  assert.equal([...s.remote.files().keys()].filter(name => name.startsWith('content/posts/')).length, 1);
});

test('unrecognized discussion cards remain unchanged when safe structured extraction is impossible', async () => {
  const s = setup(), created = await (await publish(s, { ...fixture(), presentation: 'discussion' })).json();
  const path = `content/lexicon/${created.articleId}.md`;
  const original = s.remote.text(path);
  for (const source of [
    original.replace('公开摘录</p>', '公开摘录<strong>website addition</strong></p>'),
    original + '\nWebsite trailing content\n',
    original.replace('class="mycard mycard--reply"', 'class="mycard mycard--reply" data-unknown="keep"'),
    original.replace('<p class="douban-comments-title">讨论摘录</p>', '<p class="douban-comments-title">Website heading</p>'),
  ]) {
    s.remote.edit(path, source); const head = s.remote.head;
    const read = await s.receive(request(`article&articleId=${created.articleId}`));
    assert.equal(read.status, 409); assert.equal(s.remote.head, head); assert.equal(s.remote.text(path), source);
  }
});

test('declared new selected tags become durable catalog entries in the article commit', async () => {
  const s = setup(['现有标签']), key = randomUUID();
  const value = { ...fixture(), tags: ['现有标签', '新标签'], newTags: ['新标签'] };
  const response = await publish(s, value, key); assert.equal(response.status, 200);
  const result = await response.json(), path = `content/lexicon/${result.articleId}.md`;
  assert.deepEqual(frontmatter(s.remote.text(path)).tags, ['现有标签', '新标签']);
  assert.deepEqual(JSON.parse(s.remote.text(registryPath)), ['新标签']);
  const treeWrite = s.remote.calls.find(c => c.method === 'POST' && c.url.endsWith('/git/trees'));
  assert.deepEqual(treeWrite.body.tree.map(f => f.path).sort(), [path, registryPath, 'data/website-publication-terms.json'].sort());
  const later = await s.freshReceiver()(request('catalog'));
  assert.equal(later.status, 200); assert.deepEqual((await later.json()).sharedTags, ['现有标签', '新标签']);
  assert.deepEqual(await (await publish(s, value, key)).json(), result);
  assert.equal((await publish(s, { ...fixture(), tags: ['新标签'] })).status, 200, 'the persisted vocabulary accepts later selections without redeclaring them');
  assert.equal(s.remote.calls.filter(c => c.method === 'PATCH').length, 2);
});

test('article tags remain tags and cannot create lexicon entries or change the term registry', async () => {
  const s = setup(['现有标签']);
  const response = await publish(s, { ...fixture(), section: 'posts', tags: ['现有标签', '自创标签'], newTags: ['自创标签'], relatedTerms: [], author: '编辑署名' });
  assert.equal(response.status, 200);
  const result = await response.json();
  const metadata = frontmatter(s.remote.text(`content/posts/${result.articleId}.md`));
  assert.deepEqual(metadata.tags, ['现有标签', '自创标签']);
  assert.deepEqual(metadata.related_terms, []);
  assert.equal(metadata.author, '编辑署名');
  assert.equal(metadata.license, '该作品版权归原作者所有。');
  assert.equal(s.remote.text('data/website-publication-terms.json'), null);
  assert.equal([...s.remote.files().keys()].filter(path => path.startsWith('content/lexicon/')).length, 0);
  const read = await s.receive(request(`article&articleId=${result.articleId}&section=posts`));
  const current = await read.json();
  assert.equal(current.author, '编辑署名');
  assert.equal(current.license, '该作品版权归原作者所有。');
  const update = await publish(s, { ...fixture(), section: 'posts', articleId: result.articleId, expectedRevision: current.revision, author: '修改后的署名' });
  assert.equal(update.status, 200);
  const updated = frontmatter(s.remote.text(`content/posts/${result.articleId}.md`));
  assert.equal(updated.author, '修改后的署名');
  assert.deepEqual(updated.date, metadata.date);
});

test('new tags must be selected and explicit, and all public tag bytes undergo privacy checks', async () => {
  const s = setup(), before = s.remote.head;
  for (const value of [
    { ...fixture(), tags: ['unknown'] }, { ...fixture(), newTags: ['unchecked'] },
    { ...fixture(), tags: ['new'], newTags: ['new', 'new'] },
    { ...fixture(), tags: ['new'], newTags: ['new'], replaceTags: 'true' },
    { ...fixture(), tags: ['new'], newTags: [123] },
    { ...fixture(), tags: ['n'.repeat(101)], newTags: ['n'.repeat(101)] },
    { ...fixture(), tags: ['new\nline'], newTags: ['new\nline'] },
  ]) assert.equal((await publish(s, value)).status, 400);
  const key = randomUUID();
  assert.equal((await publish(s, { ...fixture(), tags: [key], newTags: [key] }, key)).status, 400);
  const a = await upload(s), afterUpload = s.remote.head;
  assert.equal((await publish(s, { ...fixture(), tags: [a.receipt], newTags: [a.receipt] })).status, 400);
  assert.equal(s.remote.head, afterUpload);
  assert.equal(s.remote.text(registryPath), null);
  assert.notEqual(before, afterUpload);
});

test('a full-length new tag is accepted while existing longer labels remain selectable', async () => {
  const existing = 'e'.repeat(100), declared = 'n'.repeat(100), s = setup([existing]);
  assert.equal((await publish(s, { ...fixture(), tags: [existing, declared], newTags: [declared] })).status, 200);
  assert.deepEqual(JSON.parse(s.remote.text(registryPath)), [declared]);
});

test('updates preserve tags by default and replace them only with explicit full selections', async () => {
  const s = setup(['目录标签']);
  const created = await (await publish(s, fixture())).json(), path = `content/lexicon/${created.articleId}.md`;
  s.remote.edit(path, `---\ntitle: Old\ntags: [旧站标签] # keep this exact comment\nweight: 4\nurl: /custom/\n---\nOld body\n`);
  let revision = s.remote.files().get(path).sha;
  assert.equal((await publish(s, { ...fixture(), articleId: created.articleId, expectedRevision: revision })).status, 200);
  assert.match(s.remote.text(path), /tags: \[旧站标签\] # keep this exact comment/);
  revision = s.remote.files().get(path).sha;
  assert.equal((await publish(s, { ...fixture(), tags: ['旧站标签', '目录标签'], replaceTags: true, articleId: created.articleId, expectedRevision: revision })).status, 200);
  assert.deepEqual(frontmatter(s.remote.text(path)).tags, ['旧站标签', '目录标签']);
  assert.equal(frontmatter(s.remote.text(path)).weight, 4);
  revision = s.remote.files().get(path).sha;
  assert.equal((await publish(s, { ...fixture(), tags: [], replaceTags: true, articleId: created.articleId, expectedRevision: revision })).status, 200);
  assert.deepEqual(frontmatter(s.remote.text(path)).tags, []);
  assert.equal(s.remote.text(registryPath), null);
});

test('an update cannot select an unknown legacy label from another article without declaring it', async () => {
  const s = setup(), created = await (await publish(s, fixture())).json(), path = `content/lexicon/${created.articleId}.md`;
  const value = { ...fixture(), tags: ['未声明标签'], replaceTags: true, articleId: created.articleId, expectedRevision: s.remote.files().get(path).sha };
  const before = s.remote.head;
  assert.equal((await publish(s, value)).status, 400); assert.equal(s.remote.head, before);
  assert.equal((await publish(s, { ...value, replaceTags: undefined, newTags: ['未声明标签'] })).status, 200);
  assert.equal(frontmatter(s.remote.text(path)).tags, undefined, 'omitting replacement preserves the website tags');
  assert.equal(s.remote.text(registryPath), null, 'unused additions do not enter the vocabulary');
});

test('tag registry retries recover one commit and changed declarations conflict', async () => {
  const s = setup(), key = randomUUID(), value = { ...fixture(), tags: ['新标签'], newTags: ['新标签'] };
  s.remote.failAfterPatch = true;
  assert.equal((await publish(s, value, key)).status, 503);
  const head = s.remote.head;
  assert.equal((await publish(s, value, key)).status, 200);
  assert.equal(s.remote.head, head); assert.deepEqual(JSON.parse(s.remote.text(registryPath)), ['新标签']);
  assert.equal(s.remote.calls.filter(c => c.method === 'PATCH').length, 1);
  assert.equal((await publish(s, { ...value, newTags: [] }, key)).status, 409);
});

test('a pending legacy publication without registry plan fields still resumes safely', async () => {
  const s = setup(), key = randomUUID(), put = s.objects.putIfAbsent; let once = true;
  s.objects.putIfAbsent = async (path, value) => {
    if (once && path === `requests/publish/${key}`) {
      once = false; delete value.plan.tagRegistryRevision; delete value.plan.tagRegistryDigest; delete value.plan.termRegistryRevision; delete value.plan.termRegistryDigest;
      await put(path, value); throw new Error('Synthetic lost legacy reservation acknowledgement');
    }
    return put(path, value);
  };
  assert.equal((await publish(s, fixture(), key)).status, 503);
  assert.equal((await publish(s, fixture(), key)).status, 200);
  assert.equal(s.remote.files().size, 2); assert.equal(s.remote.text(registryPath), null);
});

test('catalog and registry additions reject encoded earlier private receipt identifiers', async () => {
  const s = setup(), image = await upload(s);
  s.remote.edit(registryPath, JSON.stringify([Buffer.from(image.receipt).toString('base64')]));
  const before = s.remote.head;
  assert.equal((await s.receive(request('catalog'))).status, 400);
  assert.equal((await publish(s, { ...fixture(), tags: ['新标签'], newTags: ['新标签'] })).status, 400);
  assert.equal(s.remote.head, before);
});

test('administrator imports adopt only the exact legacy lexicon revision and never posts', async () => {
  const s = setup(), id = randomUUID(), path = `content/lexicon/${id}.md`;
  s.remote.edit(path, '---\ntitle: Imported\ntags: [旧站标签]\n---\nLegacy body\n');
  const revision = s.remote.files().get(path).sha;
  const receive = createReceiver({ token, repository: s.repository, receipts: s.receipts, catalog, importedArticles: { [id]: revision } });
  assert.equal((await receive(request(`article&articleId=${id}&section=posts`))).status, 404);
  const article = await receive(request(`article&articleId=${id}`)); assert.equal(article.status, 200);
  assert.deepEqual((await article.json()).tags, ['旧站标签']);
  assert.equal((await receive(request('publish', { ...fixture(), tags: [], replaceTags: true, articleId: id, expectedRevision: revision }))).status, 200);
  assert.deepEqual(frontmatter(s.remote.text(path)).tags, []);
});

test('a concurrent registry edit survives and requires a newly confirmed publication', async () => {
  const s = setup(), key = randomUUID(), value = { ...fixture(), tags: ['新标签'], newTags: ['新标签'] };
  s.remote.beforePatch = () => s.remote.edit(registryPath, '["其他标签"]\n');
  assert.equal((await publish(s, value, key)).status, 409);
  assert.deepEqual(JSON.parse(s.remote.text(registryPath)), ['其他标签']);
  assert.equal((await publish(s, value, key)).status, 409);
  assert.deepEqual(JSON.parse(s.remote.text(registryPath)), ['其他标签']);
  assert.equal((await publish(s, value)).status, 200);
  assert.deepEqual(JSON.parse(s.remote.text(registryPath)), ['其他标签', '新标签']);
});

test('malformed or oversized tag registries fail closed and no neighboring data file is writable', async () => {
  for (const source of ['{}', '["duplicate","duplicate"]', '[123]', JSON.stringify(Array.from({ length: 1001 }, (_, i) => `tag-${i}`))]) {
    const s = setup(); s.remote.edit(registryPath, source); const before = s.remote.head;
    assert.equal((await s.receive(request('catalog'))).status, 409);
    assert.equal((await publish(s, { ...fixture(), tags: ['新标签'], newTags: ['新标签'] })).status, 409);
    assert.equal(s.remote.head, before);
  }
  const s = setup(), base = await s.repository.snapshot();
  await assert.rejects(s.repository.prepare(base, [{ path: 'data/arbitrary.json', bytes: Buffer.from('[]') }]), { status: 503 });
  assert.equal(s.remote.calls.filter(c => c.method !== 'GET').length, 0);
});

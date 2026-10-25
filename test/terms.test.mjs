import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { createReceiver } from '../publishing/lib/receiver.mjs';
import { createGitHubRepository } from '../publishing/lib/github.mjs';
import { createReceipts } from '../publishing/lib/receipts.mjs';
import { token, catalog, fixture, request, memoryObjects, gitService } from './helpers.mjs';

const registryPath = 'data/website-publication-terms.json';
const baselineId = '5142a97e-735c-4a14-8b3c-0baa73afdfaf';
function setup(terms = []) {
  const remote = gitService(), objects = memoryObjects(), receipts = createReceipts(objects);
  const repository = createGitHubRepository({ token: 'synthetic', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', fetch: remote.fetch });
  const fresh = () => createReceiver({ token, repository, receipts, catalog: { ...catalog, terms } });
  return { remote, objects, receipts, repository, receive: fresh(), fresh };
}
const publish = (s, value, key) => s.receive(request('publish', value, key));
const metadata = source => yaml.load(source.split('---')[1]);

test('the read-only term endpoint returns names and website URLs while catalog stays compatible', async () => {
  const s = setup([{ articleId: baselineId, title: '朔体', url: `/lexicon/${baselineId}/` }]);
  const response = await s.receive(request('terms')); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { terms: [{ title: '朔体', url: `https://website.example/lexicon/${baselineId}/` }] });
  assert.deepEqual(await (await s.receive(request('catalog'))).json(), catalog);
  assert.equal((await s.receive(request('terms', fixture()))).status, 405);
  assert.equal((await s.receive(request('terms&path=private'))).status, 400);
  assert.equal(s.objects.data.size, 0); assert.equal(s.remote.calls.filter(call => call.method !== 'GET').length, 0);
});

test('posts remember pending related names as tags and relations without creating a lexicon entry', async () => {
  const s = setup(), name = '待发布词条';
  const created = await publish(s, { ...fixture(), section: 'posts', tags: [name], newTags: [name], relatedTerms: [name] });
  assert.equal(created.status, 200); const article = await created.json(), path = `content/posts/${article.articleId}.md`;
  assert.deepEqual(metadata(s.remote.text(path)).tags, [name]); assert.deepEqual(metadata(s.remote.text(path)).related_terms, [name]);
  assert.equal(s.remote.text(registryPath), null); assert.deepEqual(await (await s.receive(request('terms'))).json(), { terms: [] });
  assert.equal([...s.remote.files().keys()].some(name => name.startsWith('content/lexicon/')), false);
  const read = await (await s.receive(request(`article&articleId=${article.articleId}&section=posts`))).json();
  assert.deepEqual(read.relatedTerms, [name]);
  assert.equal((await publish(s, { ...fixture(), section: 'posts', articleId: article.articleId, expectedRevision: read.revision })).status, 200);
  assert.deepEqual(metadata(s.remote.text(path)).related_terms, [name], 'legacy callers preserve existing relations');
  const revision = s.remote.files().get(path).sha;
  assert.equal((await publish(s, { ...fixture(), section: 'posts', relatedTerms: [], articleId: article.articleId, expectedRevision: revision })).status, 200);
  assert.deepEqual(metadata(s.remote.text(path)).related_terms, []);
});

test('confirmed lexicon publication atomically registers and renames its one public term', async () => {
  const s = setup();
  const response = await publish(s, { ...fixture(), title: '待发布词条' }); assert.equal(response.status, 200);
  const article = await response.json(), path = `content/lexicon/${article.articleId}.md`;
  assert.deepEqual(JSON.parse(s.remote.text(registryPath)), [{ articleId: article.articleId, title: '待发布词条', url: article.url }]);
  const tree = s.remote.calls.find(call => call.method === 'POST' && call.url.endsWith('/git/trees')).body.tree;
  assert.deepEqual(tree.map(file => file.path).sort(), [path, registryPath].sort());
  assert.deepEqual(await (await s.fresh()(request('terms'))).json(), { terms: [{ title: '待发布词条', url: article.url }] });
  const update = await publish(s, { ...fixture(), title: '词条新名称', articleId: article.articleId, expectedRevision: article.revision });
  assert.equal(update.status, 200); assert.equal((await update.json()).articleId, article.articleId);
  assert.deepEqual(await (await s.receive(request('terms'))).json(), { terms: [{ title: '词条新名称', url: article.url }] });
  assert.equal([...s.remote.files().keys()].filter(name => name.startsWith('content/lexicon/')).length, 1);
});

test('a dynamic term record overrides the old baseline name by public article ID', async () => {
  const s = setup([{ articleId: baselineId, title: 'Old title', url: `/lexicon/${baselineId}/` }]);
  s.remote.edit(registryPath, JSON.stringify([{ articleId: baselineId, title: 'New title', url: 'https://website.example/custom/' }]));
  assert.deepEqual(await (await s.receive(request('terms'))).json(), { terms: [{ title: 'New title', url: 'https://website.example/custom/' }] });
});

test('related names must be bounded selected tags and cannot leak a private request key', async () => {
  const s = setup();
  for (const relatedTerms of [['not-selected'], ['duplicate', 'duplicate'], ['x'.repeat(101)], [123], Array(51).fill('x')]) {
    assert.equal((await publish(s, { ...fixture(), section: 'posts', relatedTerms })).status, 400);
  }
  const key = randomUUID();
  assert.equal((await publish(s, { ...fixture(), section: 'posts', tags: [key], newTags: [key], relatedTerms: [key] }, key)).status, 400);
  assert.equal(s.objects.data.size, 0); assert.equal(s.remote.calls.filter(call => call.method !== 'GET').length, 0);
});

test('term registration recovers a lost acknowledgement without another article or candidate', async () => {
  const s = setup(), key = randomUUID(); s.remote.failAfterPatch = true;
  assert.equal((await publish(s, fixture(), key)).status, 503);
  const head = s.remote.head;
  assert.equal((await publish(s, fixture(), key)).status, 200); assert.equal(s.remote.head, head);
  assert.equal(JSON.parse(s.remote.text(registryPath)).length, 1);
  assert.equal(s.remote.calls.filter(call => call.method === 'PATCH').length, 1);
  assert.equal((await publish(s, { ...fixture(), relatedTerms: [] }, key)).status, 409);
});

test('a racing term registry edit survives and the same pending plan never rebases', async () => {
  const s = setup(), key = randomUUID(), other = { articleId: baselineId, title: 'Other term', url: `https://website.example/lexicon/${baselineId}/` };
  s.remote.beforePatch = () => s.remote.edit(registryPath, JSON.stringify([other]));
  assert.equal((await publish(s, fixture(), key)).status, 409);
  assert.deepEqual(JSON.parse(s.remote.text(registryPath)), [other]);
  assert.equal((await publish(s, fixture(), key)).status, 409);
  assert.equal((await publish(s, fixture())).status, 200);
  assert.equal(JSON.parse(s.remote.text(registryPath)).length, 2);
});

test('malformed term registries fail closed and only the exact data path is writable', async () => {
  const record = { articleId: baselineId, title: 'Term', url: `https://website.example/lexicon/${baselineId}/` };
  for (const source of ['{}', JSON.stringify([record, record]), JSON.stringify([{ ...record, url: 'https://elsewhere.example/' }]), JSON.stringify([{ ...record, extra: 'private' }])]) {
    const s = setup(); s.remote.edit(registryPath, source); const head = s.remote.head;
    assert.equal((await s.receive(request('terms'))).status, 409);
    assert.equal((await publish(s, fixture())).status, 409); assert.equal(s.remote.head, head);
  }
  const s = setup(), base = await s.repository.snapshot();
  await assert.rejects(s.repository.prepare(base, [{ path: 'data/website-publication-terms/other.json', bytes: Buffer.from('[]') }]), { status: 503 });
  assert.equal(s.remote.calls.filter(call => call.method !== 'GET').length, 0);
});

test('the shipped baseline contains the current twelve published lexicon titles and public paths', async () => {
  const { catalog: shipped } = await import('../publishing/catalog.mjs');
  assert.equal(shipped.terms?.length, 12);
  assert.deepEqual(shipped.terms.map(term => term.title).sort(), ['屌', '姃友', '三争三反', '朔体', '6b4t', '14bt', '"占领男厕所"运动', '爱女', '卵腺', 'moonlight', '33F（争反准则）', '女本位'].sort());
  const s = setup(shipped.terms), response = await s.receive(request('terms'));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.terms.some(term => term.title === '朔体' && term.url === `https://website.example/lexicon/${baselineId}/`));
});

test('a hundred-character pending forum term remains an explicitly selected related tag', async () => {
  const s = setup(), name = 'n'.repeat(100);
  const response = await publish(s, { ...fixture(), section: 'posts', tags: [name], newTags: [name], relatedTerms: [name] });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(metadata(s.remote.text(`content/posts/${result.articleId}.md`)).related_terms, [name]);
});

test('term registry responses and later lexicon commits refuse encoded earlier private keys', async () => {
  for (const field of ['title', 'url', 'articleId']) {
    const s = setup(), key = randomUUID();
    assert.equal((await publish(s, fixture(), key)).status, 200);
    const encoded = Buffer.from(key).toString('base64');
    const record = { articleId: baselineId, title: 'Public name', url: `https://website.example/lexicon/${baselineId}/` };
    record[field] = field === 'url' ? `https://website.example/${encoded}/` : field === 'articleId' ? key : encoded;
    s.remote.edit(registryPath, JSON.stringify([record]));
    const head = s.remote.head;
    assert.equal((await s.receive(request('terms'))).status, 400);
    assert.equal((await publish(s, fixture())).status, 400);
    assert.equal(s.remote.head, head);
  }
});

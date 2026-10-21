import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createReceiver } from '../publishing/lib/receiver.mjs';
import { createGitHubRepository } from '../publishing/lib/github.mjs';
import { createReceipts } from '../publishing/lib/receipts.mjs';
import { token, catalog, fixture, request, memoryObjects, gitService } from './helpers.mjs';

function setup() {
  const remote = gitService(), objects = memoryObjects(), receipts = createReceipts(objects);
  const repository = createGitHubRepository({ token: 'synthetic', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', fetch: remote.fetch });
  const receive = createReceiver({ token, catalog, repository, receipts });
  return { remote, objects, receipts, repository, receive };
}
const publish = (s, value = fixture(), key = randomUUID()) => s.receive(request('publish', value, key));
async function upload(s, key = randomUUID()) {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#345678' } }).webp().toBuffer();
  const response = await s.receive(request('asset', bytes, key, { 'content-type': 'image/webp', 'x-publishing-confirmed': '1' }));
  assert.equal(response.status, 200);
  return response.json();
}
async function rejectWithoutWrites(s, value, key = randomUUID(), receive = s.receive) {
  const head = s.remote.head, writes = s.remote.calls.filter(c => c.method !== 'GET').length, records = s.objects.data.size;
  const response = await receive(request('publish', value, key));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'INVALID_REQUEST', message: 'Invalid request.' });
  assert.equal(s.remote.head, head);
  assert.equal(s.remote.calls.filter(c => c.method !== 'GET').length, writes, 'no public blob/tree/commit/ref writes');
  assert.equal(s.objects.data.size, records, 'no new private reservation/result');
}
const base64Views = [
  v => Buffer.from(v).toString('base64'),
  v => Buffer.from(`identifier: ${v};`).toString('base64url'),
  // Valid UTF8 prefixes force the distinguishing + / - _ alphabet bytes.
  v => Buffer.from(`࠾${v};`).toString('base64'),
  v => Buffer.from(`࠿${v};`).toString('base64'),
  v => Buffer.from(`࠾${v};`).toString('base64url'),
  v => Buffer.from(`࠿${v};`).toString('base64url'),
  v => Buffer.from(v.toUpperCase()).toString('base64'),
  v => Buffer.from(Buffer.from(v).toString('base64')).toString('base64'),
  v => [...Buffer.from(v).toString('base64')].map(c => `%${c.charCodeAt(0).toString(16)}`).join(''),
  v => [...Buffer.from(v).toString('base64')].map(c => `&#${c.charCodeAt(0)};`).join(''),
];
function publicField(s, field, value, assets = []) {
  const dto = { ...fixture(), assets, [field]: ['comments', 'tags', 'categories'].includes(field) ? [value] : value };
  // Website taxonomy membership must not accidentally be the rejecting guard.
  const receive = createReceiver({ token, repository: s.repository, receipts: s.receipts, catalog: { categories: [...catalog.categories, value], sharedTags: [value] } });
  return { dto, receive };
}

test('finding2: Base64 current keys are rejected across public DTO fields before any commit', async () => {
  const s = setup();
  for (const encode of base64Views) for (const field of ['title', 'html', 'comments', 'tags', 'categories']) {
    const key = randomUUID(), { dto, receive } = publicField(s, field, encode(key));
    await rejectWithoutWrites(s, dto, key, receive);
  }
  assert.equal(s.remote.blobs.size, 0); assert.equal(s.remote.files().size, 0);
});

test('finding2: Base64 selected and unselected asset receipts cannot enter public artifacts', async () => {
  const s = setup(), asset = await upload(s);
  for (const selected of [false, true]) for (const encode of base64Views) for (const field of ['title', 'html', 'comments', 'tags', 'categories']) {
    const { dto, receive } = publicField(s, field, encode(asset.receipt), selected ? [asset.receipt] : []);
    await rejectWithoutWrites(s, dto, randomUUID(), receive);
  }
  assert.deepEqual([...s.remote.files().keys()], [`static${asset.path}`]);
});

test('finding2: encoded private values in preserved YAML are rejected before replacement commits', async () => {
  const s = setup(), initial = await (await publish(s)).json(), asset = await upload(s);
  const path = `content/posts/${initial.articleId}.md`;
  for (const isReceipt of [false, true]) {
    const key = randomUUID(), secret = isReceipt ? asset.receipt : key;
    for (const front of [`custom: ${Buffer.from(secret).toString('base64')}`, `url: /notes/${Buffer.from(secret).toString('base64url')}/`]) {
      s.remote.edit(path, `---\ntitle: Existing\n${front}\n---\nExisting body\n`);
      await rejectWithoutWrites(s, { ...fixture(), articleId: initial.articleId, expectedRevision: s.remote.files().get(path).sha }, key);
    }
  }
});

test('finding2: reversible-view exhaustion rejects without public or private writes', async () => {
  const s = setup();
  const tokens = Array.from({ length: 80 }, (_, i) => Buffer.from(`public-view-${i.toString().padStart(4, '0')}:done`).toString('base64'));
  await rejectWithoutWrites(s, { ...fixture(), html: `<p>${tokens.join(' ')}</p>` });
});

test('finding2: ordinary Base64 public prose is allowed and does not change replay semantics', async () => {
  const s = setup(), key = randomUUID(), dto = { ...fixture(), title: Buffer.from('公开说明: ordinary public prose').toString('base64') };
  const first = await publish(s, dto, key); assert.equal(first.status, 200); const result = await first.json();
  assert.ok(s.remote.text(`content/posts/${result.articleId}.md`).includes(dto.title));
  const replay = await publish(s, dto, key); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), result);
  assert.equal(s.remote.calls.filter(c => c.method === 'PATCH').length, 1);
});

test('finding2: encoded current keys and receipts inside citation URL components are refused', async () => {
  const s = setup(), asset = await upload(s);
  for (const selected of [false, true]) for (const isReceipt of [false, true]) for (const encoding of ['base64', 'base64url']) {
    const key = randomUUID(), encoded = Buffer.from(isReceipt ? asset.receipt : key).toString(encoding);
    for (const href of [`https://docs.example/notes/${encoded}/`, `https://docs.example/?value=${encoded}#public`]) {
      await rejectWithoutWrites(s, { ...fixture(), assets: selected ? [asset.receipt] : [], html: `<a href="${href}">Public citation</a>` }, key);
    }
  }
});

test('finding2: binary Base64 containing the current private key is refused without writes', async () => {
  const s = setup(), key = randomUUID();
  for (const encoding of ['base64', 'base64url']) for (const field of ['title', 'html', 'comments', 'categories', 'tags']) {
    const encoded = Buffer.concat([Buffer.from([0xff]), Buffer.from(key)]).toString(encoding);
    const { dto, receive } = publicField(s, field, encoded);
    await rejectWithoutWrites(s, dto, key, receive);
  }
  const split = `${key.slice(0, 18)}<strong>${key.slice(18)}</strong>`;
  await rejectWithoutWrites(s, { ...fixture(), title: Buffer.concat([Buffer.from([0xff]), Buffer.from(split)]).toString('base64') }, key);
});

test('finding2: binary Base64 containing an unselected private receipt is refused without writes', async () => {
  const s = setup(), asset = await upload(s);
  for (const encoding of ['base64', 'base64url']) {
    const encoded = Buffer.concat([Buffer.from([0xff]), Buffer.from(asset.receipt)]).toString(encoding);
    await rejectWithoutWrites(s, { ...fixture(), comments: [encoded] });
  }
});

test('finding2: binary Base64 in preserved metadata and permalinks is refused without writes', async () => {
  const s = setup(), asset = await upload(s), article = await (await publish(s)).json();
  const path = `content/posts/${article.articleId}.md`;
  for (const isReceipt of [false, true]) {
    const key = randomUUID(), secret = isReceipt ? asset.receipt : key;
    const encoded = Buffer.concat([Buffer.from([0xff]), Buffer.from(secret)]).toString('base64url');
    for (const front of [`custom: ${encoded}`, `url: /notes/${encoded}/`]) {
      s.remote.edit(path, `---\ntitle: Existing\n${front}\n---\nExisting body\n`);
      await rejectWithoutWrites(s, { ...fixture(), articleId: article.articleId, expectedRevision: s.remote.files().get(path).sha }, key);
    }
  }
});

test('finding2: binary Base64 without private values and ordinary English long words remain public', async () => {
  const s = setup();
  for (const title of [
    Buffer.from([0xff, 0xfe, 0x80, 0x81, 0, 0x42, 0x43]).toString('base64'),
    Buffer.from([0xff, 0xfe, 0x80, 0x81, 0, 0x42, 0x43]).toString('base64url'),
    'understanding collaboration publication documentation extraordinary',
  ]) {
    const response = await publish(s, { ...fixture(), title });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(s.remote.text(`content/posts/${result.articleId}.md`).includes(title));
  }
});

test('finding2: normal English pages do not exhaust the privacy budget through binary decoding', async () => {
  const s = setup();
  const words = `ordinary document language building research learning planning thinking
readable pictures software hardware keyboard mountain sunlight calendar tomorrow
triangle boundary relation solution question problems children teachers students
families friendly together everyone anything business industry services products
purchase shipping delivery material physical chemical electric magnetic computer
networks internet wireless security password username messages articles comments
chapters sections headings contents appendix examples patterns practice exercise
training painting drawings sculptor musician hospital medicine recovery emotions
feelings memories identity activity vacation holidays weekends journeys distance
movement position location rotation geometry equation fraction addition multiply division`.replace(/\s+/g, ' ');
  const response = await publish(s, { ...fixture(), html: `<p>${words}</p>` });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(s.remote.text(`content/posts/${result.articleId}.md`).includes(words));
});

test('finding2: many safe binary Base64 tokens do not create recursive encoding branches', async () => {
  const s = setup();
  const tokens = Array.from({ length: 80 }, (_, i) => Buffer.from([0xff, 0x80, 0xff, i, 0xff, 0x80]).toString('base64'));
  const response = await publish(s, { ...fixture(), html: `<p>${tokens.join(' ')}</p>` });
  assert.equal(response.status, 200);
  const result = await response.json(), markdown = s.remote.text(`content/posts/${result.articleId}.md`);
  for (const token of tokens) assert.ok(markdown.includes(token));
});

test('finding2: deeply nested reversible input fails closed before creating artifacts', async () => {
  const s = setup();
  let nested = '%41';
  for (let i = 0; i < 80; i++) nested = nested.replaceAll('%', '%25');
  await rejectWithoutWrites(s, { ...fixture(), html: `<p>${nested}</p>` });
});

test('finding3: earlier publish and upload keys remain private in every public field and encoding', async () => {
  for (const kind of ['publish', 'asset']) {
    const s = setup(), prior = randomUUID();
    if (kind === 'publish') assert.equal((await publish(s, fixture(), prior)).status, 200);
    else await upload(s, prior);
    assert.ok(s.objects.data.has(`requests/${kind}/${prior}`));
    for (const encode of [v => v, ...base64Views]) for (const field of ['title', 'html', 'comments', 'tags', 'categories']) {
      const { dto, receive } = publicField(s, field, encode(prior));
      await rejectWithoutWrites(s, dto, randomUUID(), receive);
    }
  }
});

test('finding3: binary Base64 containing earlier publish and asset keys is refused without writes', async () => {
  for (const kind of ['publish', 'asset']) {
    const s = setup(), prior = randomUUID();
    if (kind === 'publish') assert.equal((await publish(s, fixture(), prior)).status, 200);
    else await upload(s, prior);
    for (const encoding of ['base64', 'base64url']) {
      const encoded = Buffer.concat([Buffer.from([0xff]), Buffer.from(prior)]).toString(encoding);
      await rejectWithoutWrites(s, { ...fixture(), title: encoded });
    }
  }
});

test('finding3: earlier request keys in preserved YAML and website URLs prevent a new commit', async () => {
  for (const kind of ['publish', 'asset']) {
    const s = setup(), prior = randomUUID();
    if (kind === 'publish') assert.equal((await publish(s, fixture(), prior)).status, 200);
    else await upload(s, prior);
    const article = await (await publish(s)).json(), path = `content/posts/${article.articleId}.md`;
    for (const front of [`custom: ${prior}`, `custom: ${Buffer.from(prior).toString('base64url')}`, `url: /posts/${prior}/`]) {
      s.remote.edit(path, `---\ntitle: Existing\n${front}\n---\nExisting body\n`);
      await rejectWithoutWrites(s, { ...fixture(), articleId: article.articleId, expectedRevision: s.remote.files().get(path).sha });
    }
  }
});

test('finding3: encoded earlier request keys in preserved permalinks cannot produce public commits', async () => {
  for (const kind of ['publish', 'asset']) {
    const s = setup(), prior = randomUUID();
    if (kind === 'publish') assert.equal((await publish(s, fixture(), prior)).status, 200);
    else await upload(s, prior);
    const article = await (await publish(s)).json(), path = `content/posts/${article.articleId}.md`;
    for (const encoding of ['base64', 'base64url']) {
      const encoded = Buffer.from(prior).toString(encoding);
      s.remote.edit(path, `---\ntitle: Existing\nurl: /notes/${encoded}/\n---\nExisting body\n`);
      await rejectWithoutWrites(s, { ...fixture(), articleId: article.articleId, expectedRevision: s.remote.files().get(path).sha });
    }
  }
});

test('finding3: candidate identifiers are checked in every private receipt/request namespace', async () => {
  for (const namespace of ['assets', 'requests/asset', 'requests/publish', 'candidates/asset', 'candidates/publish', 'results/asset', 'results/publish']) {
    const s = setup(), id = randomUUID();
    // Remote records may be observed at any persisted stage, even after a lost
    // acknowledgement. The UUID stays private regardless of completion state.
    s.objects.data.set(`${namespace}/${id}`, { syntheticRecord: true });
    await rejectWithoutWrites(s, { ...fixture(), title: id });
    await rejectWithoutWrites(s, { ...fixture(), comments: [Buffer.from(id).toString('base64')] });
    await rejectWithoutWrites(s, { ...fixture(), comments: [Buffer.concat([Buffer.from([0xff]), Buffer.from(id)]).toString('base64')] });
    const split = `${id.slice(0, 18)}<strong>${id.slice(18)}</strong>`;
    await rejectWithoutWrites(s, { ...fixture(), comments: [Buffer.concat([Buffer.from([0xff]), Buffer.from(split)]).toString('base64')] });
  }
});

test('finding3: inability to check a private namespace fails closed with a fixed error', async () => {
  const s = setup(), candidate = randomUUID(), originalGet = s.objects.get;
  s.objects.get = async path => { if (path === `requests/publish/${candidate}`) throw new Error('private-canary storage unavailable'); return originalGet(path); };
  const response = await publish(s, { ...fixture(), title: candidate });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'UNAVAILABLE', message: 'Publishing unavailable.' });
  assert.equal(s.objects.data.size, 0); assert.equal(s.remote.calls.filter(c => c.method !== 'GET').length, 0);
});

test('finding3: public managed article and image UUIDs are not confused with private keys', async () => {
  const s = setup(), image = await upload(s), first = await (await publish(s)).json();
  const imageId = image.path.split('/').at(-1).replace('.webp', '');
  const dto = { ...fixture(), title: first.articleId, comments: [imageId], assets: [image.receipt], html: `<img src="${image.path}">` };
  const response = await publish(s, dto); assert.equal(response.status, 200);
  const result = await response.json(), markdown = s.remote.text(`content/posts/${result.articleId}.md`);
  assert.ok(markdown.includes(first.articleId)); assert.ok(markdown.includes(imageId));
  assert.ok(!markdown.includes(image.receipt));
});

test('finding4: every image width/alignment survives publish-read-title-update without input CSS', async () => {
  const s = setup(), image = await upload(s);
  const margins = { left: 'margin-left:0;margin-right:auto', center: 'margin-left:auto;margin-right:auto', right: 'margin-left:auto;margin-right:0' };
  for (const width of ['33', '50', '75', '100']) for (const align of ['left', 'center', 'right']) {
    const dto = { ...fixture(), comments: [], assets: [image.receipt], html: `<p>Image layout</p><img src="${image.path}" data-width="${width}" data-align="${align}">` };
    const creation = await publish(s, dto); assert.equal(creation.status, 200); const initial = await creation.json();
    const read = await s.receive(request(`article&articleId=${initial.articleId}`)); assert.equal(read.status, 200); const article = await read.json();
    assert.doesNotMatch(article.html, /\sstyle=/i);
    assert.ok(article.html.includes(`data-width="${width}"`)); assert.ok(article.html.includes(`data-align="${align}"`));
    const update = await publish(s, { ...dto, title: 'Updated title', html: article.html, articleId: initial.articleId, expectedRevision: article.revision });
    assert.equal(update.status, 200);
    const result = await update.json(), markdown = s.remote.text(`content/posts/${result.articleId}.md`);
    assert.ok(markdown.includes(`style="width:${width}%;display:block;${margins[align]}"`));
    assert.match(markdown, /title: "Updated title"/); assert.ok(!markdown.includes(image.receipt));
  }
});

test('finding4: width-only and alignment-only defaults round-trip through public HTML', async () => {
  const s = setup(), image = await upload(s);
  for (const attrs of ['data-width="75"', 'data-align="right"']) {
    const dto = { ...fixture(), comments: [], assets: [image.receipt], html: `<img src="${image.path}" ${attrs}>` };
    const initial = await (await publish(s, dto)).json(), path = `content/posts/${initial.articleId}.md`, original = s.remote.text(path).split('---\n').at(-1).trim();
    const article = await (await s.receive(request(`article&articleId=${initial.articleId}`))).json();
    assert.doesNotMatch(article.html, /\sstyle=/i); assert.ok(article.html.includes(attrs));
    const update = await publish(s, { ...dto, title: 'New title', html: article.html, articleId: initial.articleId, expectedRevision: article.revision });
    assert.equal(update.status, 200); assert.equal(s.remote.text(path).split('---\n').at(-1).trim(), original);
  }
});

test('finding4: readback strips CSS and invalid layout metadata from website-managed HTML', async () => {
  const s = setup(), image = await upload(s), initial = await (await publish(s)).json();
  s.remote.edit(`content/posts/${initial.articleId}.md`, `---\ntitle: Existing\n---\n<img src="${image.path}" data-width="101" data-align="invalid" style="position:fixed;background:url(https://never-fetch.example/x)">`);
  const read = await s.receive(request(`article&articleId=${initial.articleId}`)); assert.equal(read.status, 200);
  const article = await read.json(); assert.ok(article.html.includes(image.path));
  assert.doesNotMatch(article.html, /style=|data-width=|data-align=|never-fetch/);
  assert.equal((await publish(s, { ...fixture(), comments: [], assets: [image.receipt], html: article.html, articleId: initial.articleId, expectedRevision: article.revision })).status, 200);
});

test('finding4: caller-supplied CSS remains forbidden, including the canonical generated style', async () => {
  const s = setup(), image = await upload(s);
  for (const style of ['width:50%;display:block;margin-left:auto;margin-right:auto', 'background:url(https://never-fetch.example/x)']) {
    await rejectWithoutWrites(s, { ...fixture(), assets: [image.receipt], html: `<img src="${image.path}" data-width="50" data-align="center" style="${style}">` });
  }
});

test('URL wrapping cannot shift standard Base64 slash bytes past private identifier checks', async () => {
  const s = setup(), prior = randomUUID(), image = await upload(s);
  assert.equal((await publish(s, fixture(), prior)).status, 200);
  for (const kind of ['current', 'receipt', 'earlier']) {
    const key = 'af15aa32-6f07-41b7-9711-f1984aaf6c58';
    const value = kind === 'current' ? key : kind === 'receipt' ? image.receipt : prior;
    const binary = Buffer.concat([Buffer.from([0xff]), Buffer.from(value)]).toString('base64');
    for (const token of [binary, binary.replace(/=+$/, '')]) {
      await rejectWithoutWrites(s, { ...fixture(), title: `https://docs.example/notes/${token}/` }, key);
    }
  }
});

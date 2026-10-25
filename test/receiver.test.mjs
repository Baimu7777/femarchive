import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import yaml from 'js-yaml';
import { token, catalog, fixture, request, memoryObjects, gitService } from './helpers.mjs';

let modules;
try { modules = await Promise.all([import('../publishing/lib/receiver.mjs'), import('../publishing/lib/github.mjs'), import('../publishing/lib/receipts.mjs')]); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
test('Task1 provides the real receiver and remote storage adapters', () => assert.ok(modules, 'Task1 implementation is missing'));
const check = (name, fn) => test(name, { skip: !modules }, fn);
function setup() {
  const remote = gitService(), objects = memoryObjects();
  const repository = modules[1].createGitHubRepository({ token: 'synthetic-github-token', owner: 'site-owner', repo: 'site-repo', branch: 'main', publicOrigin: 'https://website.example', fetch: remote.fetch });
  const receipts = modules[2].createReceipts(objects);
  return { remote, objects, repository, receipts, receive: modules[0].createReceiver({ token, repository, receipts, catalog }) };
}
const publish = (s, value = fixture(), key) => s.receive(request('publish', value, key));
const webp = () => sharp({ create: { width: 2, height: 2, channels: 3, background: '#884422' } }).withMetadata().webp().toBuffer();
async function upload(s, bytes, key = randomUUID()) { return s.receive(request('asset', bytes ?? await webp(), key, { 'content-type': 'image/webp', 'x-publishing-confirmed': '1' })); }
const articlePath = id => `content/lexicon/${id}.md`;

check('authentication, browser and confirmation gates make zero remote writes', async () => {
  const s = setup();
  for (const [headers, body, status] of [
    [{ authorization: '' }, fixture(), 401], [{ origin: 'https://website.example' }, fixture(), 403],
    [{ cookie: 'session=synthetic' }, fixture(), 403], [{ 'sec-fetch-site': 'same-origin' }, fixture(), 403],
    [{}, { ...fixture(), confirmed: false }, 400], [{}, { ...fixture(), confirmed: undefined }, 400],
  ]) assert.equal((await s.receive(request('publish', body, randomUUID(), headers))).status, status);
  assert.equal((await s.receive(request('asset', await webp(), randomUUID(), { 'content-type': 'image/webp' }))).status, 400);
  assert.equal(s.objects.data.size, 0); assert.equal(s.remote.calls.length, 0);
});

check('strict DTO, query, types, key, catalog and revision validation precede storage', async () => {
  const s = setup();
  const values = ['topicId', 'source', 'memberId', 'identity', '__proto__', 'url'].map(key => JSON.parse(JSON.stringify(fixture()).replace(/}$/, `,"${key}":"private-canary"}`)));
  values.push({ ...fixture(), comments: [{}] }, { ...fixture(), categories: ['unknown'] }, { ...fixture(), tags: ['not-shared'] }, { ...fixture(), version: 2 }, { ...fixture(), assets: ['bad'] }, { ...fixture(), articleId: randomUUID() }, { ...fixture(), expectedRevision: 'a'.repeat(40) });
  for (const value of values) assert.equal((await publish(s, value)).status, 400);
  assert.equal((await publish(s, fixture(), 'not-uuid')).status, 400);
  assert.equal((await s.receive(new Request('https://website.example/api/publishing?operation=catalog&topicId=secret', { headers: { authorization: `Bearer ${token}` } }))).status, 400);
  assert.equal(s.objects.data.size, 0); assert.equal(s.remote.calls.length, 0);
});

check('bounded raw bodies reject oversized, malformed, unconfirmed and non-WebP uploads', async () => {
  const s = setup();
  assert.equal((await publish(s, 'x'.repeat(512 * 1024 + 1))).status, 413);
  assert.equal((await publish(s, '{bad')).status, 400);
  assert.equal((await upload(s, new Uint8Array(4 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await upload(s, Buffer.from('not-webp'))).status, 400);
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal((await upload(s, png)).status, 400);
  assert.equal(s.objects.data.size, 0); assert.equal(s.remote.calls.length, 0);
});

check('catalog and all responses have no cache, cookies or CORS; errors never echo details', async () => {
  const s = setup();
  const response = await s.receive(request('catalog'));
  assert.deepEqual(await response.json(), catalog);
  const bad = await publish(s, { ...fixture(), topicId: 'private-canary' });
  for (const r of [response, bad]) { assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('set-cookie'), null); assert.equal(r.headers.get('access-control-allow-origin'), null); }
  assert.deepEqual(await bad.json(), { error: 'INVALID_REQUEST', message: 'Invalid request.' });
});

check('new Markdown and generic Git metadata contain no request keys or private receipts', async () => {
  const s = setup(), key = randomUUID();
  const response = await publish(s, fixture(), key); assert.equal(response.status, 200);
  const result = await response.json(); assert.deepEqual(Object.keys(result).sort(), ['articleId', 'revision', 'url']);
  assert.notEqual(result.articleId, key); assert.match(result.articleId, /^[0-9a-f-]{36}$/);
  const markdown = s.remote.text(articlePath(result.articleId));
  assert.match(markdown, /\*\*文本\*\*/); assert.match(markdown, /公开摘录/);
  assert.ok(!markdown.includes(key)); assert.ok(!JSON.stringify([...s.remote.commits.values()]).includes(key));
  for (const call of s.remote.calls) { assert.equal(call.options.redirect, 'error'); assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.headers.cookie, undefined); }
  const commit = s.remote.calls.find(c => c.method === 'POST' && c.url.endsWith('/git/commits')).body;
  assert.deepEqual(commit.author, { name: 'Website Editor', email: 'editor@website.invalid' });
  assert.deepEqual(commit.committer, commit.author); assert.equal(commit.message, 'Update website content');
});

check('identical publish replay returns one result while changed payload conflicts', async () => {
  const s = setup(), key = randomUUID();
  const first = await (await publish(s, fixture(), key)).json();
  assert.deepEqual(await (await publish(s, fixture(), key)).json(), first);
  assert.equal((await publish(s, { ...fixture(), title: 'changed' }, key)).status, 409);
  assert.equal(s.remote.calls.filter(c => c.method === 'PATCH').length, 1);
});

check('timeout after successful branch update recovers without another article or commit', async () => {
  const s = setup(), key = randomUUID(); s.remote.failAfterPatch = true;
  assert.equal((await publish(s, fixture(), key)).status, 503);
  const head = s.remote.head;
  const response = await publish(s, fixture(), key); assert.equal(response.status, 200);
  assert.equal(s.remote.head, head); assert.equal(s.remote.files().size, 1);
  assert.equal(s.remote.calls.filter(c => c.method === 'PATCH').length, 1);
  assert.equal(s.remote.calls.filter(c => c.method === 'POST' && c.url.endsWith('/git/commits')).length, 1);
  assert.ok(!JSON.stringify([...s.objects.data.values()]).includes('公开内容'));
});

check('simultaneous duplicate requests converge on the immutable reservation', async () => {
  const s = setup(), key = randomUUID();
  const responses = await Promise.all([publish(s, fixture(), key), publish(s, fixture(), key)]);
  for (const r of responses) assert.equal(r.status, 200);
  assert.deepEqual(await responses[0].json(), await responses[1].json());
  assert.equal(s.remote.files().size, 1);
});

check('updates preserve raw YAML except title and require the current blob SHA', async () => {
  const s = setup(); const original = await (await publish(s)).json(); const path = articlePath(original.articleId);
  const front = '# website comment\ntitle: "Original" # title comment\ncategories: [理论分野]\ntags: [website-tag]\nslug: custom-slug\nurl: /custom-url/\ndate: 2020-01-01\nauthor: Site Editor\ncustom:\n  nested: true\n';
  s.remote.edit(path, `---\n${front}---\nOld website body\n`);
  const fetched = await s.receive(request(`article&articleId=${original.articleId}`)); assert.equal(fetched.status, 200); const current = await fetched.json();
  assert.equal(current.title, 'Original'); assert.equal(current.url, 'https://website.example/custom-url/');
  assert.equal((await publish(s, { ...fixture(), articleId: original.articleId, expectedRevision: original.revision })).status, 409);
  const update = await publish(s, { ...fixture(), title: 'New title', articleId: original.articleId, expectedRevision: current.revision }); assert.equal(update.status, 200);
  const updated = s.remote.text(path), raw = updated.split('---\n')[1];
  assert.equal(raw.replace(/^title:.*\n/m, ''), front.replace(/^title:.*\n/m, ''));
  assert.equal(yaml.load(raw).title, 'New title'); assert.match(updated, /公开内容/); assert.doesNotMatch(updated, /Old website body/);
});

check('unmanaged UUID files and arbitrary paths cannot be read or updated', async () => {
  const s = setup(), id = randomUUID(); s.remote.edit(articlePath(id), '---\ntitle: Legacy\n---\nlegacy');
  assert.equal((await s.receive(request(`article&articleId=${id}`))).status, 404);
  assert.equal((await publish(s, { ...fixture(), articleId: id, expectedRevision: 'a'.repeat(40) })).status, 404);
  assert.equal((await s.receive(request('article&articleId=../../old'))).status, 400);
  assert.equal(s.remote.calls.filter(c => c.method === 'PATCH').length, 0);
});

check('branch race preserves external edits and does not silently rebase on retry', async () => {
  const s = setup(), key = randomUUID(); s.remote.beforePatch = () => s.remote.edit('content/lexicon/legacy.md', 'external edit');
  assert.equal((await publish(s, fixture(), key)).status, 409);
  const head = s.remote.head; assert.equal((await publish(s, fixture(), key)).status, 409);
  assert.equal(s.remote.head, head); assert.equal(s.remote.text('content/lexicon/legacy.md'), 'external edit'); assert.equal(s.remote.files().size, 1);
});

check('selected WebP is reencoded without metadata and names are independently random', async () => {
  const s = setup(), key = randomUUID(), input = await webp(); const response = await upload(s, input, key); assert.equal(response.status, 200);
  const result = await response.json(); assert.deepEqual(Object.keys(result).sort(), ['path', 'receipt']); assert.match(result.path, /^\/images\/articles\/[0-9a-f-]{36}\.webp$/);
  assert.ok(!result.path.includes(key)); assert.ok(!result.path.includes(result.receipt)); assert.notEqual(result.receipt, key);
  const bytes = s.remote.blobs.get(s.remote.files().get(`static${result.path}`).sha), metadata = await sharp(bytes).metadata();
  assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined); assert.equal(metadata.xmp, undefined);
  assert.deepEqual(await (await upload(s, input, key)).json(), result);
  const changed = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#f00' } }).webp().toBuffer();
  assert.equal((await upload(s, changed, key)).status, 409);
  const value = { ...fixture(), assets: [result.receipt], html: `<p>图片</p><img src="${result.path}" alt="公开图片">` };
  const article = await publish(s, value); assert.equal(article.status, 200); const output = s.remote.text(articlePath((await article.json()).articleId));
  assert.ok(output.includes(result.path)); assert.ok(!output.includes(result.receipt));
});

check('asset timeout retry keeps original receipt and path even if branch later advances', async () => {
  const s = setup(), input = await webp(), key = randomUUID(); s.remote.failAfterPatch = true;
  assert.equal((await upload(s, input, key)).status, 503); const paths = [...s.remote.files().keys()];
  s.remote.edit('content/elsewhere.md', 'remote edit');
  const retry = await upload(s, input, key); assert.equal(retry.status, 200); assert.equal(`static${(await retry.json()).path}`, paths[0]);
  assert.equal(s.remote.calls.filter(c => c.method === 'PATCH').length, 1);
});

check('unsafe HTML, arbitrary URLs, shortcodes and unselected assets never become public', async () => {
  const s = setup(); const uploaded = await (await upload(s)).json(); const before = s.remote.head;
  const unsafe = ['<script>alert(1)</script>', '<iframe src="https://other.example"></iframe>', '<p onclick="x()">text</p>', '<img src="https://other.example/img.webp">', '<img src="/private.webp">', `<img src="${uploaded.path}">`, '<a href="javascript:alert(1)">x</a>', '<a href="https://127.0.0.1/x">x</a>', '<!--private-canary--><p>x</p>'];
  for (const html of unsafe) assert.equal((await publish(s, { ...fixture(), html })).status, 400);
  assert.equal(s.remote.head, before);
  const response = await publish(s, { ...fixture(), html: '<p>{{&lt; unsafe &gt;}} &lt;img src=x onerror=y&gt;</p>', comments: ['<script>literal</script> {{< unsafe >}}'] }); assert.equal(response.status, 200);
  const markdown = s.remote.text(articlePath((await response.json()).articleId)); assert.doesNotMatch(markdown, /\{\{|<script>|<img src=x/);
});

check('missing, forged and changed remote assets fail closed before publication', async () => {
  const s = setup(); assert.equal((await publish(s, { ...fixture(), assets: [randomUUID()] })).status, 400);
  const asset = await (await upload(s)).json(); s.remote.edit(`static${asset.path}`, 'replaced remote bytes');
  assert.equal((await publish(s, { ...fixture(), assets: [asset.receipt], html: `<img src="${asset.path}">` })).status, 409);
});

check('private request keys and receipt UUIDs, including encodings, cannot enter public fields', async () => {
  const s = setup(), uploaded = await (await upload(s)).json();
  const encoders = [v => v, v => v.toUpperCase(), v => [...v].map(c => `&#${c.charCodeAt(0)};`).join(''), v => [...v].map(c => `%${c.charCodeAt(0).toString(16)}`).join(''), v => [...v].map(c => `&amp;#${c.charCodeAt(0)};`).join(''), v => [...v].map(c => `%25${c.charCodeAt(0).toString(16)}`).join('')];
  const before = s.remote.head, count = s.objects.data.size;
  for (const isReceipt of [false, true]) for (const encode of encoders) for (const field of ['title', 'html', 'comments', 'tags', 'categories']) {
    const key = randomUUID(), value = encode(isReceipt ? uploaded.receipt : key);
    const dto = { ...fixture(), assets: [uploaded.receipt], [field]: ['comments', 'tags', 'categories'].includes(field) ? [value] : value };
    // Allowlist membership must not mask the privacy check for taxonomies.
    const receive = modules[0].createReceiver({ token, repository: s.repository, receipts: s.receipts, catalog: { categories: [...catalog.categories, value], sharedTags: [value] } });
    const response = await receive(request('publish', dto, key));
    assert.equal(response.status, 400, `${field} ${isReceipt ? 'receipt' : 'request-key'} encoding`);
    assert.ok(!(await response.text()).includes(isReceipt ? uploaded.receipt : key));
  }
  assert.equal(s.remote.head, before); assert.equal(s.objects.data.size, count);
});

check('private IDs split by HTML markup cannot be revealed by rendering', async () => {
  const s = setup(), key = randomUUID(), split = `${key.slice(0, 18)}<strong>${key.slice(18)}</strong>`;
  assert.equal((await publish(s, { ...fixture(), html: `<p>${split}</p>` }, key)).status, 400);
  assert.equal(s.remote.calls.length, 0); assert.equal(s.objects.data.size, 0);
});

check('plaintext comment comparisons are escaped while comment objects are rejected', async () => {
  const s = setup(); const response = await publish(s, { ...fixture(), comments: ['a < b and c > d', '<img src="/private"> is literal text'] });
  assert.equal(response.status, 200); const markdown = s.remote.text(articlePath((await response.json()).articleId));
  assert.match(markdown, /> a &lt; b and c &gt; d/); assert.match(markdown, /&lt;img/); assert.doesNotMatch(markdown, /<img/);
  assert.equal((await publish(s, { ...fixture(), comments: [{ text: 'public', memberId: 'private' }] })).status, 400);
});

check('editor links, underline, highlight, image layouts and ordered-list starts render safely', async () => {
  const s = setup(), image = await (await upload(s)).json();
  const html = `<p><u>下划线</u> <mark>重点</mark> <a href="https://docs.example/citation?q=%E4%B8%AD%E6%96%87&amp;page=1#section" target="_blank" rel="noopener noreferrer nofollow">引用</a></p><ol start="4"><li>第四项</li><li>第五项</li></ol><img src="${image.path}" alt="公开图片" data-width="50" data-align="center">`;
  const response = await publish(s, { ...fixture(), html, assets: [image.receipt] }); assert.equal(response.status, 200);
  const result = await response.json(), markdown = s.remote.text(articlePath(result.articleId));
  assert.match(markdown, /<u>下划线<\/u>/); assert.match(markdown, /<mark>重点<\/mark>/); assert.match(markdown, /4\. 第四项\n5\. 第五项/);
  assert.ok(markdown.includes('https://docs.example/citation?q=%E4%B8%AD%E6%96%87&page=1#section'));
  assert.match(markdown, /data-width="50"/); assert.match(markdown, /data-align="center"/); assert.ok(!markdown.includes(image.receipt));
  const read = await s.receive(request(`article&articleId=${result.articleId}`));
  assert.equal(read.status, 200); assert.match((await read.json()).html, /data-width="50"/);
});

check('layout whitelist rejects arbitrary attrs and unsafe values', async () => {
  const s = setup(), image = await (await upload(s)).json(), before = s.remote.head;
  for (const html of [
    '<a href="http://docs.example/x">x</a>', '<a href="https://user:pass@docs.example/x">x</a>', '<a href="https://docs.example/x" target="named-window">x</a>', '<a href="https://docs.example/x" rel="opener">x</a>', '<u style="color:red">x</u>', '<mark onclick="x()">x</mark>', '<ol start="-1"><li>x</li></ol>', '<ol start="1e9"><li>x</li></ol>',
    `<img src="${image.path}" data-width="101">`, `<img src="${image.path}" data-align="javascript:foo">`, `<img src="${image.path}" style="background:url(https://private.example)">`,
  ]) assert.equal((await publish(s, { ...fixture(), html, assets: [image.receipt] })).status, 400, html);
  assert.equal(s.remote.head, before);
});

check('a link to a personal page is publishable; transport rules still apply', async () => {
  // Keeping the forum out of the public copy is the sender side job: it holds
  // the member identities and can refuse them precisely. The receiver only
  // enforces transport-level safety, so an ordinary citation goes through.
  const s = setup();
  const allowed = await publish(s, { ...fixture(), html: '<p><a href="https://www.douban.com/people/someone/">主页</a> <a href="https://weibo.com/u/123">微博</a> <a href="https://www.whatsonweibo.com/a-story/">报道</a></p>' });
  assert.equal(allowed.status, 200);
  const markdown = s.remote.text(articlePath((await allowed.json()).articleId));
  for (const href of ['douban.com/people/someone/', 'weibo.com/u/123', 'whatsonweibo.com/a-story/']) assert.ok(markdown.includes(href), href);
  const before = s.remote.head;
  for (const html of ['<a href="http://www.douban.com/people/someone/">x</a>', '<a href="https://127.0.0.1/people/x">x</a>', '<a href="https://host.local/people/x">x</a>']) {
    assert.equal((await publish(s, { ...fixture(), html })).status, 400, html);
  }
  assert.equal(s.remote.head, before);
});

check('citation URL normalization prevents angle-bracket or shortcode interpolation', async () => {
  const s = setup();
  const response = await publish(s, { ...fixture(), html: '<p><a href="https://docs.example/a&gt;b?x=&lt;literal&gt;#note">Reference</a></p>' });
  assert.equal(response.status, 200); const markdown = s.remote.text(articlePath((await response.json()).articleId));
  assert.ok(markdown.includes('[Reference](<https://docs.example/a%3Eb?x=%3Cliteral%3E#note>)')); assert.doesNotMatch(markdown, /<literal>/);
});

check('reservation write timeout never allocates a second asset path on replay', async () => {
  const s = setup(), bytes = await webp(), key = randomUUID(), put = s.objects.putIfAbsent; let once = true;
  s.objects.putIfAbsent = async (path, value) => { const result = await put(path, value); if (once && path.startsWith('requests/asset/')) { once = false; throw new Error('synthetic lost receipt ack'); } return result; };
  assert.equal((await upload(s, bytes, key)).status, 503);
  const reservation = s.objects.data.get(`requests/asset/${key}`); assert.ok(reservation);
  assert.equal(s.remote.calls.filter(c => c.method !== 'GET').length, 0);
  const retry = await upload(s, bytes, key); assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { receipt: reservation.plan.receipt, path: reservation.plan.publicPath });
  assert.equal(s.remote.files().size, 1);
});

check('candidate persistence timeout recovers without creating another candidate commit', async () => {
  const s = setup(), key = randomUUID(), put = s.objects.putIfAbsent; let once = true;
  s.objects.putIfAbsent = async (path, value) => { const result = await put(path, value); if (once && path.startsWith('candidates/publish/')) { once = false; throw new Error('synthetic lost candidate ack'); } return result; };
  assert.equal((await publish(s, fixture(), key)).status, 503);
  assert.equal(s.remote.calls.filter(c => c.method === 'PATCH').length, 0);
  assert.equal((await publish(s, fixture(), key)).status, 200);
  assert.equal(s.remote.calls.filter(c => c.method === 'POST' && c.url.endsWith('/git/commits')).length, 1);
});

check('malformed private asset paths cannot be promoted into public Markdown', async () => {
  const s = setup(), receipt = randomUUID(); s.objects.data.set(`assets/${receipt}`, { path: '/images/articles/../private.webp', revision: 'a'.repeat(40) });
  const before = s.objects.data.size;
  assert.equal((await publish(s, { ...fixture(), assets: [receipt], html: '<img src="/images/articles/../private.webp">' })).status, 400);
  assert.equal(s.remote.calls.length, 0); assert.equal(s.objects.data.size, before);
});

check('an unselected private asset receipt cannot be pasted as public text', async () => {
  const s = setup(), image = await (await upload(s)).json(), before = s.remote.head;
  assert.equal((await publish(s, { ...fixture(), title: image.receipt })).status, 400);
  assert.equal(s.remote.head, before);
});

check('preserved website YAML and response URLs cannot leak this private request key', async () => {
  const s = setup(), initial = await (await publish(s)).json(), key = randomUUID(), path = articlePath(initial.articleId);
  s.remote.edit(path, `---\ntitle: Existing\nauthor: ${key}\nurl: /lexicon/${key}/\n---\nExisting body\n`);
  const revision = s.remote.files().get(path).sha, before = s.remote.head;
  assert.equal((await publish(s, { ...fixture(), articleId: initial.articleId, expectedRevision: revision }, key)).status, 400);
  assert.equal(s.remote.head, before);
});

check('multiline title updates preserve CRLF, YAML comments and nested website settings', async () => {
  const s = setup(), initial = await (await publish(s)).json(), path = articlePath(initial.articleId);
  const front = '# website comment\r\ntitle: |-\r\n  Existing\r\n  multiline title\r\ncustom:\r\n  enabled: true\r\nslug: maintained\r\n';
  s.remote.edit(path, `---\r\n${front}---\r\nOld body\r\n`);
  const current = s.remote.files().get(path).sha;
  assert.equal((await publish(s, { ...fixture(), articleId: initial.articleId, expectedRevision: current })).status, 200);
  const output = s.remote.text(path); assert.match(output, /# website comment\r\n/); assert.match(output, /custom:\r\n  enabled: true\r\nslug: maintained\r\n/); assert.doesNotMatch(output, /multiline title|Old body/);
});

check('Node server fetch metadata alone is accepted but browser provenance is forbidden', async () => {
  const s = setup();
  // Node 24's bundled undici appends sec-fetch-mode:cors to server requests.
  assert.equal((await s.receive(request('catalog', undefined, undefined, { 'sec-fetch-mode': 'cors' }))).status, 200);
  for (const headers of [{ origin: 'null' }, { referer: 'https://website.example/' }, { 'sec-fetch-site': 'none' }, { 'sec-fetch-dest': 'empty' }, { 'sec-fetch-user': '?1' }]) assert.equal((await s.receive(request('catalog', undefined, undefined, headers))).status, 403);
});

check('updates preserve a website-owned dotted or percent-encoded permalink', async () => {
  const s = setup(), initial = await (await publish(s)).json(), path = articlePath(initial.articleId);
  s.remote.edit(path, '---\ntitle: Existing\nurl: /articles/%E4%B8%AD%E6%96%87.html\n---\nOld body\n');
  const response = await publish(s, { ...fixture(), articleId: initial.articleId, expectedRevision: s.remote.files().get(path).sha });
  assert.equal(response.status, 200); assert.equal((await response.json()).url, 'https://website.example/articles/%E4%B8%AD%E6%96%87.html');
  assert.match(s.remote.text(path), /url: \/articles\/%E4%B8%AD%E6%96%87.html/);
});

check('GitHub encoding:none files use fixed-repo blob reads and never download URLs', async () => {
  const s = setup(), image = await (await upload(s)).json(); s.remote.omitContents = true;
  // GitHub returns encoding:none for object-media file responses above 1 MiB.
  const response = await publish(s, { ...fixture(), assets: [image.receipt], html: `<img src="${image.path}">` });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal((await s.receive(request(`article&articleId=${result.articleId}`))).status, 200);
  assert.ok(s.remote.calls.some(c => c.method === 'GET' && c.url.includes('/git/blobs/')));
  assert.ok(s.remote.calls.every(c => new URL(c.url).hostname === 'api.github.com'));
});

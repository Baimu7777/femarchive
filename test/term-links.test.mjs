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
  return { remote, objects, repository, receive: modules[0].createReceiver({ token, repository, receipts: modules[2].createReceipts(objects), catalog }) };
}
const publish = (s, value, key) => s.receive(request('publish', value, key));
const batch = (s, items, key) => s.receive(request('publish-batch', { version: 1, confirmed: true, items }, key));
const entry = (title, html, extra = {}) => ({ ...fixture(), title, html, comments: [], ...extra });
const markdown = (s, id) => s.remote.text(`content/lexicon/${id}.md`);
const termsPath = 'data/website-publication-terms.json';

check('a published term and its other names become links in later articles', async () => {
  const s = setup();
  const first = await (await publish(s, entry('三争三反', '<p>原始解释。</p>', { aliases: ['33F', '争反准则'] }))).json();
  // The registry remembers the other names, so a mention of one can link too.
  assert.deepEqual(JSON.parse(s.remote.text(termsPath)), [{ articleId: first.articleId, title: '三争三反', aliases: ['33F', '争反准则'], url: first.url }]);
  const second = await (await publish(s, entry('后发词条', '<p>33F 就是争反准则，也写作三争三反。</p>'))).json();
  const body = markdown(s, second.articleId);
  const path = `/lexicon/${first.articleId}/`;
  for (const name of ['33F', '争反准则', '三争三反']) assert.ok(body.includes(`[${name}](<${path}>)`), `${name} not linked in ${body}`);
});

check('an entry never links its own name or its own other name', async () => {
  const s = setup();
  const first = await (await publish(s, entry('三争三反', '<p>先放着。</p>', { aliases: ['33F'] }))).json();
  const read = await (await s.receive(new Request(`https://website.example/api/publishing?operation=article&articleId=${first.articleId}`, { headers: { authorization: `Bearer ${token}` } }))).json();
  const updated = await (await publish(s, entry('三争三反', '<p>三争三反又叫 33F。</p>', { aliases: ['33F'], articleId: first.articleId, expectedRevision: read.revision }))).json();
  const body = markdown(s, updated.articleId);
  assert.ok(body.includes('三争三反又叫 33F'), body);
  assert.ok(!body.includes(']('), body);
});

check('existing links, code and image text are never rewritten', async () => {
  const s = setup();
  const first = await (await publish(s, entry('6b4t', '<p>原始解释。</p>'))).json();
  const html = '<p><a href="https://reference.example.com/x">6b4t</a> <code>6b4t</code></p><pre>6b4t</pre><p><img src="/images/articles/00000000-0000-4000-8000-000000000000.webp" alt="6b4t"></p><p>x6b4t 6b4tx 看 6b4t。</p>';
  const second = await (await publish(s, entry('引用词条', html.replace('<p><img src="/images/articles/00000000-0000-4000-8000-000000000000.webp" alt="6b4t"></p>', '')))).json();
  const body = markdown(s, second.articleId);
  assert.ok(body.includes('[6b4t](<https://reference.example.com/x>)'), body);
  assert.ok(body.includes('<code>6b4t</code>'), body);
  assert.ok(body.includes('<pre>6b4t</pre>'), body);
  // A Latin name inside a longer Latin word stays plain text.
  assert.ok(body.includes('x6b4t 6b4tx'), body);
  assert.ok(body.includes(`[6b4t](</lexicon/${first.articleId}/>)。`), body);
});

check('the longest matching name wins and card layouts are linked too', async () => {
  const s = setup();
  const short = await (await publish(s, entry('女权', '<p>一。</p>'))).json();
  const long = await (await publish(s, entry('女权主义', '<p>二。</p>'))).json();
  const value = entry('引用两者', '<div data-publication-layout="card"><p>谈女权主义，也谈女权。</p></div>', { presentation: 'cards' });
  const third = await (await publish(s, value)).json();
  const body = markdown(s, third.articleId);
  assert.ok(body.includes(`<a href="/lexicon/${long.articleId}/">女权主义</a>`), body);
  assert.ok(body.includes(`<a href="/lexicon/${short.articleId}/">女权</a>`), body);
});

check('removing the last other name on the forum removes it from the registry as well', async () => {
  const s = setup();
  const first = await (await publish(s, entry('有别称的词条', '<p>一。</p>', { aliases: ['旧别称'] }))).json();
  assert.ok(JSON.parse(s.remote.text(termsPath))[0].aliases);
  const read = await (await s.receive(new Request(`https://website.example/api/publishing?operation=article&articleId=${first.articleId}`, { headers: { authorization: `Bearer ${token}` } }))).json();
  await publish(s, entry('有别称的词条', '<p>一。</p>', { aliases: [], articleId: first.articleId, expectedRevision: read.revision }));
  assert.deepEqual(JSON.parse(s.remote.text(termsPath)), [{ articleId: first.articleId, title: '有别称的词条', url: first.url }]);
  const second = await (await publish(s, entry('后发', '<p>提到旧别称。</p>'))).json();
  assert.ok(!markdown(s, second.articleId).includes(']('), markdown(s, second.articleId));
});

check('a term published earlier in the same batch is already linkable by the later item', async () => {
  const s = setup();
  const result = await (await batch(s, [
    entry('同批词条', '<p>定义。</p>', { aliases: ['同批别称'] }),
    entry('同批引用', '<p>这里提到同批别称。</p>'),
  ])).json();
  const body = markdown(s, result.items[1].articleId);
  assert.ok(body.includes(`[同批别称](</lexicon/${result.items[0].articleId}/>)`), body);
});

check('malformed other names in the registry fail closed and write nothing', async () => {
  const s = setup();
  const id = randomUUID();
  for (const aliases of [['x'.repeat(51)], ['a', 'a'], [''], [1], 'notalist']) {
    s.remote.edit(termsPath, `${JSON.stringify([{ articleId: id, title: '旧记录', aliases, url: `https://website.example/lexicon/${id}/` }], null, 2)}\n`);
    const head = s.remote.head;
    assert.equal((await publish(s, entry('新词条', '<p>一。</p>'))).status, 409, JSON.stringify(aliases));
    assert.equal(s.remote.head, head);
  }
});

check('other names cannot smuggle a private request key into a later public body', async () => {
  const s = setup();
  const key = randomUUID();
  assert.equal((await publish(s, entry('泄露', '<p>一。</p>', { aliases: [key] }), key)).status, 400);
  assert.equal(s.objects.data.size, 0);
  assert.equal(s.remote.calls.filter(call => call.method !== 'GET').length, 0);
});

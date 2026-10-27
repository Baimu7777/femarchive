import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReceiver } from '../publishing/lib/receiver.mjs';
import { createGitHubRepository } from '../publishing/lib/github.mjs';
import { createReceipts } from '../publishing/lib/receipts.mjs';
import { token, catalog, fixture, request, memoryObjects } from './helpers.mjs';

const hash = x => createHash('sha1').update(x).digest('hex');

// A two-branch stand-in for the GitHub API: production (main) and staging.
function branches() {
  const blobs = new Map(), trees = new Map(), commits = new Map(), refs = new Map(), calls = [];
  let sequence = 0;
  const initialTree = hash('tree-0'); trees.set(initialTree, new Map());
  const initial = hash('head-0'); commits.set(initial, { tree: { sha: initialTree }, parents: [] });
  refs.set('main', initial);
  const ancestors = sha => { const seen = new Set(), queue = [sha]; while (queue.length) { const next = queue.shift(); if (!next || seen.has(next)) continue; seen.add(next); for (const parent of commits.get(next)?.parents ?? []) queue.push(parent.sha); } return seen; };
  const commit = (parents, files) => { const tree = hash(`edit-tree-${++sequence}`); trees.set(tree, files); const sha = hash(`edit-commit-${sequence}`); commits.set(sha, { tree: { sha: tree }, parents: parents.map(sha => ({ sha })) }); return sha; };
  const filesAt = sha => trees.get(commits.get(sha).tree.sha);
  const api = {
    calls, refs,
    text(branch, path) { const entry = filesAt(refs.get(branch)).get(path); return entry ? blobs.get(entry.sha).toString() : null; },
    edit(branch, path, text) { const bytes = Buffer.from(text), sha = hash(bytes); blobs.set(sha, bytes); const files = new Map(filesAt(refs.get(branch))); files.set(path, { sha, mode: '100644', type: 'blob' }); refs.set(branch, commit([refs.get(branch)], files)); },
    async fetch(url, options = {}) {
      const u = new URL(url), route = decodeURIComponent(u.pathname.slice('/repos/site-owner/site-repo/'.length));
      const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
      calls.push({ method, route });
      const ok = (v, status = 200) => new Response(status === 204 ? null : JSON.stringify(v), { status });
      if (route.startsWith('git/ref/heads/')) { const sha = refs.get(route.slice(14)); return sha ? ok({ object: { sha } }) : ok({}, 404); }
      if (route === 'git/refs' && method === 'POST') { refs.set(body.ref.slice(11), body.sha); return ok({ object: { sha: body.sha } }, 201); }
      if (route.startsWith('git/refs/heads/') && method === 'PATCH') {
        const name = route.slice(15);
        if (body.force !== false || !ancestors(body.sha).has(refs.get(name))) return ok({}, 422);
        refs.set(name, body.sha); return ok({ object: { sha: body.sha } });
      }
      if (route === 'merges' && method === 'POST') {
        const base = refs.get(body.base), head = refs.get(body.head) ?? body.head;
        if (ancestors(base).has(head)) return ok(null, 204);
        const files = new Map([...filesAt(head), ...filesAt(base)]);
        const sha = commit([base, head], files); refs.set(body.base, sha); return ok({ sha }, 201);
      }
      if (route.startsWith('compare/')) {
        const [base, tip] = route.slice(8).split('...');
        const status = base === tip ? 'identical' : ancestors(tip).has(base) ? 'ahead' : ancestors(base).has(tip) ? 'behind' : 'diverged';
        return ok({ status });
      }
      if (route.startsWith('git/commits/') && method === 'GET') return ok(commits.get(route.slice(12)));
      if (route.startsWith('contents/') && method === 'GET') {
        const entry = filesAt(u.searchParams.get('ref')).get(route.slice(9));
        return entry ? ok({ type: 'file', sha: entry.sha, size: blobs.get(entry.sha).length, encoding: 'base64', content: blobs.get(entry.sha).toString('base64') }) : ok({}, 404);
      }
      if (route === 'git/blobs' && method === 'POST') { const bytes = Buffer.from(body.content, body.encoding), sha = hash(bytes); blobs.set(sha, bytes); return ok({ sha }, 201); }
      if (route === 'git/trees' && method === 'POST') { const files = new Map(trees.get(body.base_tree)); for (const file of body.tree) files.set(file.path, file); const sha = hash(`tree-${++sequence}`); trees.set(sha, files); return ok({ sha }, 201); }
      if (route === 'git/commits' && method === 'POST') { const sha = hash(`commit-${++sequence}`); commits.set(sha, { tree: { sha: body.tree }, parents: body.parents.map(sha => ({ sha })) }); return ok({ sha }, 201); }
      throw new Error(`unhandled synthetic API ${method} ${route}`);
    },
  };
  return api;
}

function setup() {
  const remote = branches();
  const repository = createGitHubRepository({ token: 'synthetic', owner: 'site-owner', repo: 'site-repo', branch: 'main', stagingBranch: 'publishing', publicOrigin: 'https://website.example', fetch: remote.fetch });
  const receive = createReceiver({ token, catalog, repository, receipts: createReceipts(memoryObjects()) });
  return { remote, receive };
}
const publish = (s, value) => s.receive(request('publish', value, randomUUID()));
const release = async s => (await s.receive(new Request('https://website.example/api/publishing?operation=release', { method: 'POST', headers: { authorization: `Bearer ${token}` } }))).json();
const mainPatches = s => s.remote.calls.filter(call => call.method === 'PATCH' && call.route === 'git/refs/heads/main').length;

test('a batch waits on the staging branch and reaches production in one push', async () => {
  const s = setup(), before = s.remote.refs.get('main');
  const first = await (await publish(s, { ...fixture(), title: '第一篇' })).json();
  const second = await (await publish(s, { ...fixture(), title: '第二篇' })).json();
  assert.equal(s.remote.refs.get('main'), before, 'nothing deploys while the batch is sent');
  assert.match(s.remote.text('publishing', `content/lexicon/${first.articleId}.md`), /第一篇/);
  assert.deepEqual(await release(s), { released: true });
  assert.equal(mainPatches(s), 1);
  assert.equal(s.remote.refs.get('main'), s.remote.refs.get('publishing'));
  assert.match(s.remote.text('main', `content/lexicon/${second.articleId}.md`), /第二篇/);
  assert.deepEqual(await release(s), { released: false }, 'nothing left to release');
  assert.equal(mainPatches(s), 1);
});

test('changes made on production meanwhile are merged in, not overwritten', async () => {
  const s = setup();
  const published = await (await publish(s, { ...fixture(), title: '待发布' })).json();
  s.remote.edit('main', 'content/posts/elsewhere.md', 'edited on the website');
  assert.deepEqual(await release(s), { released: true });
  assert.equal(s.remote.text('main', 'content/posts/elsewhere.md'), 'edited on the website');
  assert.match(s.remote.text('main', `content/lexicon/${published.articleId}.md`), /待发布/);
});

test('a staging branch behind production catches up before the next publication', async () => {
  const s = setup();
  await publish(s, fixture());
  await release(s);
  s.remote.edit('main', 'content/posts/later.md', 'newer production content');
  await publish(s, { ...fixture(), title: '之后' });
  assert.equal(s.remote.text('publishing', 'content/posts/later.md'), 'newer production content');
  assert.deepEqual(await release(s), { released: true });
});

test('reads show production, never unreleased work', async () => {
  const s = setup();
  s.remote.edit('main', 'data/website-publication-tags.json', '["生产标签"]\n');
  await publish(s, { ...fixture(), tags: ['新标签'], newTags: ['新标签'] });
  const listing = await (await s.receive(request('catalog'))).json();
  assert.ok(listing.sharedTags.includes('生产标签'));
  assert.ok(!listing.sharedTags.includes('新标签'), 'a tag waiting for release is not offered yet');
});

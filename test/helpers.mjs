import { createHash, randomUUID } from 'node:crypto';

export const token = 'synthetic-service-token-0123456789abcdef';
export const catalog = { categories: ['理论分野', '结构辨析', '语言回声', '狩猎经验', '女身优势', '思考讨论'], sharedTags: [] };
export const fixture = () => ({ version: 1, confirmed: true, title: '公开标题', html: '<p>公开内容 <strong>文本</strong></p>', categories: ['思考讨论'], tags: [], comments: ['公开摘录'], assets: [] });
export const request = (operation, body, key = randomUUID(), headers = {}) => new Request(`https://website.example/api/publishing?operation=${operation}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': key }), ...headers },
  ...(body === undefined ? {} : { body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) }),
});

// Only the remote object service is replaced; reservation/recovery code stays real.
export function memoryObjects() {
  const data = new Map();
  return { data, async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async putIfAbsent(key, value) { if (data.has(key)) return false; data.set(key, structuredClone(value)); return true; } };
}

const hash = (x) => createHash('sha1').update(x).digest('hex');
export function gitService() {
  const blobs = new Map(), trees = new Map(), commits = new Map(), calls = [];
  let sequence = 0;
  const initialTree = hash('initial-tree'); trees.set(initialTree, new Map());
  let head = hash('initial-head'); commits.set(head, { tree: { sha: initialTree }, parents: [] });
  const api = {
    calls, blobs, trees, commits, failAfterPatch: false, beforePatch: null, omitContents: false,
    get head() { return head; },
    files() { return trees.get(commits.get(head).tree.sha); },
    text(path) { const entry = api.files().get(path); return entry ? blobs.get(entry.sha).toString() : null; },
    edit(path, text) {
      const files = new Map(api.files());
      if (path) { const bytes = Buffer.from(text), sha = hash(bytes); blobs.set(sha, bytes); files.set(path, { sha, mode: '100644', type: 'blob' }); }
      const tree = hash(`external-tree-${++sequence}`); trees.set(tree, files);
      const next = hash(`external-head-${sequence}`); commits.set(next, { tree: { sha: tree }, parents: [{ sha: head }] }); head = next;
    },
    async fetch(url, options = {}) {
      const u = new URL(url); if (u.origin !== 'https://api.github.com' || !u.pathname.startsWith('/repos/site-owner/site-repo/')) throw new Error('unexpected target');
      const route = decodeURIComponent(u.pathname.slice('/repos/site-owner/site-repo/'.length));
      const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url, method, body, options });
      const ok = (v, status = 200) => new Response(JSON.stringify(v), { status });
      if (route === 'git/ref/heads/main') return ok({ object: { sha: head } });
      if (route.startsWith('git/commits/') && method === 'GET') return ok(commits.get(route.slice(12)));
      if (route.startsWith('contents/') && method === 'GET') {
        const commit = commits.get(u.searchParams.get('ref')); const entry = trees.get(commit.tree.sha).get(route.slice(9));
        return entry ? ok({ type: entry.type, sha: entry.sha, size: blobs.get(entry.sha).length, encoding: api.omitContents ? 'none' : 'base64', content: api.omitContents ? '' : blobs.get(entry.sha).toString('base64'), download_url: 'https://never-follow.example/private-canary' }) : ok({}, 404);
      }
      if (route.startsWith('git/blobs/') && method === 'GET') { const sha = route.slice(10), bytes = blobs.get(sha); return ok({ sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }); }
      if (route === 'git/blobs' && method === 'POST') { const bytes = Buffer.from(body.content, body.encoding), sha = hash(bytes); blobs.set(sha, bytes); return ok({ sha }, 201); }
      if (route === 'git/trees' && method === 'POST') { const files = new Map(trees.get(body.base_tree)); for (const file of body.tree) files.set(file.path, file); const sha = hash(`tree-${++sequence}`); trees.set(sha, files); return ok({ sha }, 201); }
      if (route === 'git/commits' && method === 'POST') { const sha = hash(`commit-${++sequence}`); commits.set(sha, { ...body, tree: { sha: body.tree }, parents: body.parents.map(sha => ({ sha })) }); return ok({ sha }, 201); }
      if (route.startsWith('compare/')) {
        const [base, tip] = route.slice(8).split('...'); let cursor = tip;
        while (cursor && cursor !== base) cursor = commits.get(cursor)?.parents[0]?.sha;
        return ok({ status: cursor === base ? (tip === base ? 'identical' : 'ahead') : 'diverged' });
      }
      if (route === 'git/refs/heads/main' && method === 'PATCH') {
        if (api.beforePatch) { const action = api.beforePatch; api.beforePatch = null; action(); }
        if (body.force !== false || (body.sha !== head && commits.get(body.sha).parents[0].sha !== head)) return ok({}, 422);
        head = body.sha;
        if (api.failAfterPatch) { api.failAfterPatch = false; throw new Error('synthetic response timeout private-canary'); }
        return ok({ object: { sha: head } });
      }
      throw new Error(`unhandled synthetic API ${method} ${route}`);
    },
  };
  return api;
}

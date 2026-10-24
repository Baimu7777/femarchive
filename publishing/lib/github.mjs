import { fail, sha, uuid, imagePath } from './errors.mjs';

export function validateGitConfig({ owner, repo, branch, publicOrigin }) {
  if (![owner, repo].every(v => typeof v === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(v) && !v.includes('..'))) fail(503);
  if (typeof branch !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9_/-]{0,150}$/.test(branch) || branch.includes('//') || branch.endsWith('/')) fail(503);
  const url = new URL(publicOrigin);
  if (url.protocol !== 'https:' || url.origin !== publicOrigin || url.username || url.password || url.port || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) || /\.(?:local|internal|localhost)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname)) fail(503);
}
const writablePath = value => (uuid(/^content\/lexicon\/(.+)\.md$/.exec(value)?.[1])) || (value.startsWith('static') && imagePath(value.slice(6)));

export function createGitHubRepository({ token, owner, repo, branch, publicOrigin, fetch: transport = globalThis.fetch }) {
  validateGitConfig({ owner, repo, branch, publicOrigin });
  if (!token) fail(503);
  const root = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/`;
  const branchPath = branch.split('/').map(encodeURIComponent).join('/');
  async function api(path, method = 'GET', body, missing = false, accept = 'application/vnd.github+json') {
    const result = await transport(`${root}${path}`, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${token}`, accept, 'content-type': 'application/json', 'x-github-api-version': '2022-11-28', 'user-agent': 'website-publisher' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (result.status === 404 && missing) return null;
    if ([409, 422].includes(result.status)) fail(409);
    if (!result.ok) fail(503);
    return result.json();
  }
  const validSHA = value => { if (!sha(value)) fail(503); return value; };
  const currentHead = async () => validSHA((await api(`git/ref/heads/${branchPath}`)).object.sha);
  return {
    publicOrigin,
    async snapshot() {
      const head = await currentHead();
      const commit = await api(`git/commits/${head}`);
      return { head, tree: validSHA(commit.tree.sha) };
    },
    async read(path, head) {
      if (!writablePath(path)) fail(503); validSHA(head);
      const file = await api(`contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${head}`, 'GET', undefined, true, 'application/vnd.github.object+json');
      if (!file) return null;
      if (file.type !== 'file' && file.type !== 'blob') fail(409);
      const revision = validSHA(file.sha);
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 8 * 1024 * 1024) fail(503);
      // Contents object media omits bytes above 1 MiB. Construct a fixed-repo
      // blob endpoint from the validated SHA; never follow download_url/git_url.
      const blob = file.encoding === 'none' ? await api(`git/blobs/${revision}`) : file;
      if (validSHA(blob.sha) !== revision || blob.encoding !== 'base64' || blob.size !== file.size || typeof blob.content !== 'string' || blob.content.length > 12 * 1024 * 1024) fail(503);
      const bytes = Buffer.from(blob.content, 'base64');
      if (bytes.length !== file.size) fail(503);
      return { revision, bytes };
    },
    async prepare(base, files) {
      validSHA(base.head); validSHA(base.tree);
      // Abort before creating blobs if an intervening branch edit is visible.
      if (await currentHead() !== base.head) fail(409);
      const tree = [], revisions = {};
      for (const file of files) {
        if (!writablePath(file.path)) fail(503);
        const blob = await api('git/blobs', 'POST', { content: file.bytes.toString('base64'), encoding: 'base64' });
        revisions[file.path] = validSHA(blob.sha);
        tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const newTree = await api('git/trees', 'POST', { base_tree: base.tree, tree });
      const identity = { name: 'Website Editor', email: 'editor@website.invalid' };
      const commit = await api('git/commits', 'POST', { message: 'Update website content', author: identity, committer: identity, parents: [base.head], tree: validSHA(newTree.sha) });
      return { base: base.head, commit: validSHA(commit.sha), revisions };
    },
    async apply(candidate) {
      validSHA(candidate.base); validSHA(candidate.commit);
      const head = await currentHead();
      if (head === candidate.commit) return;
      if (head !== candidate.base) {
        const comparison = await api(`compare/${candidate.commit}...${head}`);
        if (comparison.status === 'ahead' || comparison.status === 'identical') return;
        fail(409);
      }
      // A competing child of base cannot fast-forward to this candidate. Never
      // rebuild against a newer head; callers must read and reconfirm instead.
      await api(`git/refs/heads/${branchPath}`, 'PATCH', { sha: candidate.commit, force: false });
    },
  };
}

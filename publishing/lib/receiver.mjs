import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { fail, response, failure, uuid, sha, articlePath, imagePath } from './errors.mjs';
import { validateArticle, assertNoPrivateValues, assertNoPrivateText, publicBody, readDocument, writeDocument, articleURL, articleFields } from './document.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let imageModule;
// Loaded on demand. A disabled receiver and every non-image operation must not
// depend on the native image module resolving in the deployment runtime; a
// module-scope import answers each request with a platform error instead of a
// generic 503.
async function imageProcessor() {
  if (!imageModule) { try { imageModule = (await import('sharp')).default; } catch { fail(503); } }
  return imageModule;
}
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
async function limitedBody(request, limit) {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) fail(413);
  if (!request.body) fail();
  const reader = request.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); fail(413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) fail();
  return Buffer.concat(chunks, size);
}
const validToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(token);
export function createReceiver({ token, repository, receipts, catalog }) {
  const configured = validToken(token) && repository && receipts && catalog && Array.isArray(catalog.categories) && Array.isArray(catalog.sharedTags);
  const expected = Buffer.from(`Bearer ${token}`);
  async function authenticate(request) {
    if (!configured) fail(503);
    const actual = Buffer.from(request.headers.get('authorization') ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail(401);
    // Node's server-side undici also emits sec-fetch-mode:cors; that header
    // alone does not establish browser provenance. Browsers supply site/dest.
    if (['origin', 'cookie', 'referer', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user'].some(h => request.headers.has(h))) fail(403);
  }
  async function managed(id) {
    const record = await receipts.getArticle(id);
    if (!record) fail(404);
    if (record.path !== articlePath(id)) fail(503);
    return record;
  }
  async function assetsFor(value) {
    const selected = [];
    for (const receipt of value.assets) {
      const record = await receipts.getAsset(receipt);
      if (!record) fail();
      if (!imagePath(record.path) || !sha(record.revision)) fail();
      selected.push(record);
    }
    return selected;
  }
  async function validateAssets(selected, head) {
    for (const record of selected) {
      const file = await repository.read(`static${record.path}`, head);
      if (!file || file.revision !== record.revision) fail(409);
    }
  }
  async function publicArtifacts(fields, forbidden) {
    const ids = assertNoPrivateText(fields, forbidden);
    for (const id of ids) if (await receipts.isPrivateIdentifier(id)) fail();
  }
  async function finish(kind, key, plan, buildFiles) {
    const result = await receipts.getResult(kind, key);
    if (result) return result;
    let candidate = await receipts.getCandidate(kind, key);
    if (!candidate) candidate = await receipts.saveCandidate(kind, key, await repository.prepare(plan.base, await buildFiles()));
    if (candidate.base !== plan.base.head || !sha(candidate.revisions?.[plan.path])) fail(503);
    await repository.apply(candidate);
    if (kind === 'asset') {
      await receipts.saveAsset(plan.receipt, { path: plan.publicPath, revision: candidate.revisions[plan.path] });
      return receipts.saveResult(kind, key, { receipt: plan.receipt, path: plan.publicPath });
    }
    await receipts.saveArticle(plan.articleId, { path: articlePath(plan.articleId) });
    return receipts.saveResult(kind, key, { articleId: plan.articleId, revision: candidate.revisions[plan.path], url: plan.url });
  }
  async function publish(request, key) {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) fail();
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await limitedBody(request, 512 * 1024))); }
    catch (error) { if (error.status) throw error; fail(); }
    validateArticle(value, catalog);
    const candidateIds = assertNoPrivateValues(value, [key, ...value.assets]);
    if (value.articleId === key || value.assets.includes(value.articleId)) fail();
    // Unselected receipts and prior request keys remain private across all
    // persisted stages; candidate UUIDs come from the same reversible views.
    for (const id of candidateIds) if (await receipts.isPrivateIdentifier(id)) fail();
    const selected = await assetsFor(value);
    const body = publicBody(value.html, value.comments, selected.map(a => a.path));
    const fingerprint = digest(canonical(value));
    const plan = await receipts.reserve('publish', key, fingerprint, async () => {
      const articleId = value.articleId ?? randomUUID(), path = articlePath(articleId);
      if (value.articleId) await managed(articleId);
      const base = await repository.snapshot();
      const previous = await repository.read(path, base.head);
      if (value.articleId ? previous?.revision !== value.expectedRevision : previous !== null) fail(409);
      await validateAssets(selected, base.head);
      const allocated = { articleId, path, base, date: new Date().toISOString(), expectedRevision: value.expectedRevision ?? null };
      const bytes = writeDocument(value, body, previous?.bytes, allocated);
      const url = articleURL(repository.publicOrigin, articleId, readDocument(bytes).metadata);
      await publicArtifacts([bytes.toString('utf8'), path, url], [key, ...value.assets]);
      return { ...allocated, documentDigest: digest(bytes), url };
    });
    if (!uuid(plan.articleId) || plan.path !== articlePath(plan.articleId)) fail(503);
    return finish('publish', key, plan, async () => {
      const previous = await repository.read(plan.path, plan.base.head);
      if (plan.expectedRevision ? previous?.revision !== plan.expectedRevision : previous !== null) fail(409);
      await validateAssets(selected, plan.base.head);
      const bytes = writeDocument(value, body, previous?.bytes, plan);
      if (digest(bytes) !== plan.documentDigest) fail(409);
      await publicArtifacts([bytes.toString('utf8'), plan.path, plan.url], [key, ...value.assets]);
      return [{ path: plan.path, bytes }];
    });
  }
  async function asset(request, key) {
    if (request.headers.get('x-publishing-confirmed') !== '1' || request.headers.get('content-type')?.toLowerCase() !== 'image/webp') fail();
    const bytes = await limitedBody(request, 4 * 1024 * 1024);
    const image = await imageProcessor();
    let processed;
    try {
      const input = image(bytes, { limitInputPixels: 16_000_000, failOn: 'warning', animated: false });
      const metadata = await input.metadata();
      if (metadata.format !== 'webp' || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || metadata.width * metadata.height > 16_000_000) fail();
      // sharp strips EXIF/XMP/ICC by default. Never use keepMetadata here.
      processed = await input.rotate().webp({ quality: 85 }).toBuffer();
      if (processed.length > 4 * 1024 * 1024) fail(413);
    } catch (error) { if (error.status) throw error; fail(); }
    const plan = await receipts.reserve('asset', key, digest(bytes), async () => {
      const receipt = randomUUID(), publicPath = `/images/articles/${randomUUID()}.webp`, path = `static${publicPath}`;
      await publicArtifacts([publicPath], [key, receipt]);
      const base = await repository.snapshot();
      if (await repository.read(path, base.head)) fail(409);
      return { receipt, publicPath, path, base, imageDigest: digest(processed) };
    });
    if (!uuid(plan.receipt) || !imagePath(plan.publicPath) || plan.path !== `static${plan.publicPath}` || digest(processed) !== plan.imageDigest) fail(503);
    return finish('asset', key, plan, async () => [{ path: plan.path, bytes: processed }]);
  }
  return async request => {
    try {
      await authenticate(request);
      const params = new URL(request.url).searchParams, operation = params.get('operation');
      const allowed = operation === 'article' ? ['operation', 'articleId'] : ['operation'];
      if ([...params.keys()].some(k => !allowed.includes(k) || params.getAll(k).length !== 1) || !['catalog', 'article', 'asset', 'publish'].includes(operation)) fail();
      if (request.method !== (['catalog', 'article'].includes(operation) ? 'GET' : 'POST')) fail(405);
      if (operation === 'catalog') return response({ categories: [...catalog.categories], sharedTags: [...catalog.sharedTags] });
      if (operation === 'article') {
        const id = params.get('articleId'); if (!uuid(id)) fail(); await managed(id);
        const base = await repository.snapshot(), file = await repository.read(articlePath(id), base.head);
        if (!file) fail(404);
        const document = readDocument(file.bytes);
        return response({ articleId: id, revision: file.revision, url: articleURL(repository.publicOrigin, id, document.metadata), ...articleFields(document) });
      }
      const key = request.headers.get('idempotency-key'); if (!uuid(key)) fail();
      return response(operation === 'publish' ? await publish(request, key) : await asset(request, key));
    } catch (error) { return failure(error.status); }
  };
}

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { fail, response, failure, uuid, sha, articlePath, imagePath } from './errors.mjs';
import { validateArticle, assertNoPrivateValues, assertNoPrivateText, publicBody, readDocument, writeDocument, articleURL, articleFields } from './document.mjs';
import { legacyPostFields } from './legacy-post.mjs';
import { validExistingPostPath } from '../existing-posts.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const termRegistryPath = 'data/website-publication-terms.json';
const tagRegistryPath = 'data/website-publication-tags.json';
const validRegistryTags = value => Array.isArray(value) && value.length <= 1000 && value.every(tag => typeof tag === 'string' && tag.length > 0 && tag.length <= 100 && tag.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(tag)) && new Set(value).size === value.length;
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
export function createReceiver({ token, repository, receipts, catalog, importedArticles = {}, importedPosts = {} }) {
  const imports = importedPosts && typeof importedPosts === 'object' && !Array.isArray(importedPosts) ? Object.entries(importedPosts) : [];
  const validImports = Boolean(importedPosts) && typeof importedPosts === 'object' && !Array.isArray(importedPosts) && imports.length <= 50 && imports.every(([id, post]) => uuid(id) && post && validExistingPostPath(post.path) && sha(post.revision) && typeof post.title === 'string' && post.title.length <= 200 && !/[\r\n]/.test(post.title)) && new Set(imports.map(([, post]) => post.path)).size === imports.length;
  const configured = validToken(token) && repository && receipts && catalog && Array.isArray(catalog.categories) && Array.isArray(catalog.sharedTags) && validImports;
  const managedPath = (id, section) => section === 'posts' && Object.hasOwn(importedPosts, id) ? importedPosts[id].path : articlePath(id, section);
  const expected = Buffer.from(`Bearer ${token}`);
  async function authenticate(request) {
    if (!configured) fail(503);
    const actual = Buffer.from(request.headers.get('authorization') ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail(401);
    // Node's server-side undici also emits sec-fetch-mode:cors; that header
    // alone does not establish browser provenance. Browsers supply site/dest.
    if (['origin', 'cookie', 'referer', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user'].some(h => request.headers.has(h))) fail(403);
  }
  async function managed(id, section) {
    let record = await receipts.getArticle(id);
    if (!record && section === 'posts' && Object.hasOwn(importedPosts, id)) {
      const post = importedPosts[id], snapshot = await repository.snapshot();
      const file = await repository.read(post.path, snapshot.head);
      if (!file || file.revision !== post.revision) fail(409);
      record = await receipts.saveArticle(id, { path: post.path });
    }
    // The administrator import registry only covers legacy lexicon articles.
    if (!record && (!section || section === 'lexicon') && Object.hasOwn(importedArticles, id)) {
      const revision = importedArticles[id];
      if (!sha(revision)) fail(503);
      const snapshot = await repository.snapshot();
      const file = await repository.read(articlePath(id), snapshot.head);
      if (!file || file.revision !== revision) fail(409);
      record = await receipts.saveArticle(id, { path: articlePath(id) });
    }
    if (!record) fail(404);
    if (record.path !== managedPath(id, section)) fail(503);
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
  // Every published term's identifier appears in the term registry, so one
  // publication checks the same identifiers several times. Within one request
  // each is looked up once, sixteen at a time.
  const lookups = new Map();
  const isPrivate = id => { if (!lookups.has(id)) lookups.set(id, receipts.isPrivateIdentifier(id)); return lookups.get(id); };
  async function rejectPrivate(ids) {
    const list = [...ids];
    for (let index = 0; index < list.length; index += 16) if ((await Promise.all(list.slice(index, index + 16).map(isPrivate))).some(Boolean)) fail();
  }
  async function publicArtifacts(fields, forbidden) {
    await rejectPrivate(assertNoPrivateText(fields, forbidden));
  }
  async function tagRegistry(head) {
    const file = await repository.read(tagRegistryPath, head);
    if (!file) return { tags: [], revision: null };
    let tags;
    try {
      if (file.bytes.length > 256 * 1024) fail(409);
      tags = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
    } catch { fail(409); }
    if (!validRegistryTags(tags)) fail(409);
    return { tags, revision: file.revision };
  }
  function normalizeTerms(terms, baseline = false) {
    if (!Array.isArray(terms) || terms.length > 1000) fail(409);
    const ids = new Set();
    return terms.map(term => {
      if (!term || typeof term !== 'object' || Array.isArray(term) || Object.keys(term).sort().join(',') !== 'articleId,title,url' || !uuid(term.articleId) || ids.has(term.articleId) || typeof term.title !== 'string' || !term.title.trim() || term.title.length > 300 || /[\u0000-\u001f\u007f]/.test(term.title) || typeof term.url !== 'string') fail(409);
      ids.add(term.articleId);
      const url = baseline && term.url.startsWith('/') ? articleURL(repository.publicOrigin, term.articleId, { url: term.url }) : term.url;
      if (!url.startsWith(`${repository.publicOrigin}/`)) fail(409);
      const publicURL = articleURL(repository.publicOrigin, term.articleId, { url: url.slice(repository.publicOrigin.length) });
      if (publicURL !== url) fail(409);
      return { articleId: term.articleId, title: term.title, url };
    });
  }
  async function termRegistry(head) {
    const file = await repository.read(termRegistryPath, head);
    if (!file) return { terms: [], revision: null };
    let terms;
    try {
      if (file.bytes.length > 512 * 1024) fail(409);
      terms = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
    } catch { fail(409); }
    const normalized = normalizeTerms(terms);
    await publicArtifacts(normalized.flatMap(term => [term.articleId, term.title, term.url]), []);
    return { terms: normalized, revision: file.revision };
  }
  function publicationTerms(value, registry, articleId, url) {
    if (value.section === 'posts') return null;
    const terms = registry.terms.filter(term => term.articleId !== articleId);
    terms.push({ articleId, title: value.title, url });
    return Buffer.from(`${JSON.stringify(normalizeTerms(terms), null, 2)}\n`);
  }
  function publicationTags(value, registry, previous) {
    const metadata = previous ? readDocument(previous).metadata : {};
    const previousTags = Array.isArray(metadata.tags) ? metadata.tags.filter(tag => typeof tag === 'string') : [];
    const allowed = new Set([...catalog.sharedTags, ...registry.tags, ...previousTags, ...(value.newTags ?? [])]);
    if (value.tags.some(tag => !allowed.has(tag))) fail();
    // A legacy caller does not own website tags. Declared additions only become
    // vocabulary when this publication actually writes the selected tag set.
    const additions = !previous || value.replaceTags === true ? (value.newTags ?? []).filter(tag => !catalog.sharedTags.includes(tag) && !registry.tags.includes(tag)) : [];
    if (!additions.length) return null;
    const tags = [...registry.tags, ...additions];
    if (!validRegistryTags(tags)) fail();
    return Buffer.from(`${JSON.stringify(tags, null, 2)}\n`);
  }
  async function finish(kind, key, plan, buildFiles) {
    const result = await receipts.getResult(kind, key);
    if (result) return result;
    let candidate = await receipts.getCandidate(kind, key);
    if (!candidate) candidate = await receipts.saveCandidate(kind, key, await repository.prepare(plan.base, await buildFiles()));
    if (candidate.base !== plan.base.head || !sha(candidate.revisions?.[plan.path])) fail(503);
    if (plan.tagRegistryDigest && !sha(candidate.revisions?.[tagRegistryPath])) fail(503);
    if (plan.termRegistryDigest && !sha(candidate.revisions?.[termRegistryPath])) fail(503);
    await repository.apply(candidate);
    if (kind === 'asset') {
      await receipts.saveAsset(plan.receipt, { path: plan.publicPath, revision: candidate.revisions[plan.path] });
      return receipts.saveResult(kind, key, { receipt: plan.receipt, path: plan.publicPath });
    }
    await receipts.saveArticle(plan.articleId, { path: plan.path });
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
    await rejectPrivate(candidateIds);
    const selected = await assetsFor(value);
    const body = publicBody(value.html, value.comments, selected.map(a => a.path), value.presentation, value.commentImages);
    const fingerprint = digest(canonical(value));
    const plan = await receipts.reserve('publish', key, fingerprint, async () => {
      const articleId = value.articleId ?? randomUUID(), path = managedPath(articleId, value.section);
      if (value.articleId) await managed(articleId, value.section);
      const base = await repository.snapshot();
      const previous = await repository.read(path, base.head);
      if (value.articleId ? previous?.revision !== value.expectedRevision : previous !== null) fail(409);
      const terms = await termRegistry(base.head);
      const registry = await tagRegistry(base.head), tagBytes = publicationTags(value, registry, previous?.bytes);
      await validateAssets(selected, base.head);
      const allocated = { articleId, path, base, date: new Date().toISOString(), expectedRevision: value.expectedRevision ?? null, tagRegistryRevision: registry.revision, tagRegistryDigest: tagBytes ? digest(tagBytes) : null };
      const bytes = writeDocument(value, body, previous?.bytes, allocated);
      const url = articleURL(repository.publicOrigin, articleId, readDocument(bytes).metadata, value.section);
      const termBytes = publicationTerms(value, terms, articleId, url);
      await publicArtifacts([bytes.toString('utf8'), path, url, ...(tagBytes ? [tagBytes.toString('utf8')] : []), ...(termBytes ? [termBytes.toString('utf8')] : [])], [key, ...value.assets]);
      return { ...allocated, documentDigest: digest(bytes), url, termRegistryRevision: terms.revision, termRegistryDigest: termBytes ? digest(termBytes) : null };
    });
    if (!uuid(plan.articleId) || plan.path !== managedPath(plan.articleId, value.section)) fail(503);
    return finish('publish', key, plan, async () => {
      const previous = await repository.read(plan.path, plan.base.head);
      if (plan.expectedRevision ? previous?.revision !== plan.expectedRevision : previous !== null) fail(409);
      const terms = await termRegistry(plan.base.head), termBytes = Object.hasOwn(plan, 'termRegistryDigest') ? publicationTerms(value, terms, plan.articleId, plan.url) : null;
      if (Object.hasOwn(plan, 'termRegistryDigest') && (terms.revision !== plan.termRegistryRevision || (termBytes ? digest(termBytes) : null) !== plan.termRegistryDigest)) fail(409);
      const registry = await tagRegistry(plan.base.head), tagBytes = publicationTags(value, registry, previous?.bytes);
      if (Object.hasOwn(plan, 'tagRegistryDigest')) {
        if (registry.revision !== plan.tagRegistryRevision || (tagBytes ? digest(tagBytes) : null) !== plan.tagRegistryDigest) fail(409);
      } else if (tagBytes) fail(409); // Legacy plans may resume only without adding a new public file.
      await validateAssets(selected, plan.base.head);
      const bytes = writeDocument(value, body, previous?.bytes, plan);
      if (digest(bytes) !== plan.documentDigest) fail(409);
      await publicArtifacts([bytes.toString('utf8'), plan.path, plan.url, ...(tagBytes ? [tagBytes.toString('utf8')] : []), ...(termBytes ? [termBytes.toString('utf8')] : [])], [key, ...value.assets]);
      return [{ path: plan.path, bytes }, ...(tagBytes ? [{ path: tagRegistryPath, bytes: tagBytes }] : []), ...(termBytes ? [{ path: termRegistryPath, bytes: termBytes }] : [])];
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
  // Reads show what visitors see. Unreleased publications wait on the staging
  // branch, and one item is never published twice inside a batch.
  const visible = () => repository.published ? repository.published() : repository.snapshot();
  return async request => {
    try {
      await authenticate(request);
      const params = new URL(request.url).searchParams, operation = params.get('operation');
      const allowed = operation === 'article' ? ['operation', 'articleId', 'section'] : ['operation'];
      if ([...params.keys()].some(k => !allowed.includes(k) || params.getAll(k).length !== 1) || !['catalog', 'terms', 'articles', 'article', 'asset', 'publish', 'release'].includes(operation)) fail();
      if (request.method !== (['catalog', 'terms', 'articles', 'article'].includes(operation) ? 'GET' : 'POST')) fail(405);
      if (operation === 'release') return response(repository.release ? await repository.release() : { released: false });
      if (operation === 'articles') {
        const base = await visible(), articles = [];
        for (const [articleId, post] of imports) {
          const file = await repository.read(post.path, base.head);
          if (!file) continue;
          const document = readDocument(file.bytes);
          articles.push({ articleId, title: typeof document.metadata.title === 'string' ? document.metadata.title : post.title, url: articleURL(repository.publicOrigin, articleId, document.metadata, 'posts') });
        }
        await publicArtifacts(articles.flatMap(article => [article.title, article.url]), []);
        return response({ articles });
      }
      if (operation === 'terms') {
        const base = await visible(), registry = await termRegistry(base.head);
        const terms = new Map(normalizeTerms(catalog.terms ?? [], true).map(term => [term.articleId, term]));
        for (const term of registry.terms) terms.set(term.articleId, term);
        const publicTerms = [...terms.values()].map(({ title, url }) => ({ title, url }));
        await publicArtifacts(publicTerms.flatMap(term => [term.title, term.url]), []);
        return response({ terms: publicTerms });
      }
      if (operation === 'catalog') {
        const base = await visible(), registry = await tagRegistry(base.head);
        const sharedTags = [...new Set([...catalog.sharedTags, ...registry.tags])];
        await publicArtifacts(sharedTags, []);
        return response({ categories: [...catalog.categories], sharedTags });
      }
      if (operation === 'article') {
        const id = params.get('articleId'), section = params.get('section') ?? 'lexicon'; if (!uuid(id) || !['posts', 'lexicon'].includes(section)) fail(); await managed(id, section);
        const base = await visible(), file = await repository.read(managedPath(id, section), base.head);
        if (!file) fail(404);
        const document = readDocument(file.bytes);
        const fields = section === 'posts' && Object.hasOwn(importedPosts, id) ? legacyPostFields(document) ?? articleFields(document) : articleFields(document);
        return response({ articleId: id, revision: file.revision, url: articleURL(repository.publicOrigin, id, document.metadata, section), ...fields });
      }
      const key = request.headers.get('idempotency-key'); if (!uuid(key)) fail();
      return response(operation === 'publish' ? await publish(request, key) : await asset(request, key));
    } catch (error) { return failure(error.status); }
  };
}

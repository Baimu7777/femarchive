const errors = {
  400: ['INVALID_REQUEST', 'Invalid request.'],
  401: ['UNAUTHORIZED', 'Authentication required.'],
  403: ['FORBIDDEN', 'Request not permitted.'],
  404: ['NOT_FOUND', 'Article not found.'],
  405: ['METHOD_NOT_ALLOWED', 'Method not permitted.'],
  409: ['CONFLICT', 'Publication conflict. Read and confirm again.'],
  413: ['TOO_LARGE', 'Request too large.'],
  503: ['UNAVAILABLE', 'Publishing unavailable.'],
};
// A refusal says which check refused it, so the forum can tell its members
// what actually happened instead of guessing one sentence for every 409.
// Only these fixed tokens and a batch position ever leave: never a path, a
// title, an identifier or any other value read from the request or the site.
const reasons = new Set([
  'ARTICLE_CHANGED', 'ARTICLE_EXISTS', 'DOCUMENT_CHANGED', 'DUPLICATE_ARTICLE',
  'TERM_REGISTRY_CHANGED', 'TERM_REGISTRY_FULL', 'TERM_REGISTRY_INVALID', 'TERM_RECORD_INVALID',
  'TAG_REGISTRY_CHANGED', 'TAG_REGISTRY_FULL', 'TAG_REGISTRY_INVALID', 'TAG_RECORD_INVALID',
  'REQUEST_REUSED', 'ASSET_PATH_TAKEN', 'ASSET_MISSING', 'LEGACY_PLAN', 'IMPORTED_POST_CHANGED', 'BRANCH_MOVED',
]);
const position = value => Number.isInteger(value) && value >= 0 && value < 20;
export function fail(status = 400, reason, item) { throw Object.assign(new Error(errors[status][0]), { status, reason, item }); }
export function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
}
export function failure(status, reason, item) {
  const [error, message] = errors[status] ?? errors[503];
  return response({ error, message, ...(reasons.has(reason) ? { reason } : {}), ...(position(item) ? { item } : {}) }, errors[status] ? status : 503);
}
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
export const articlePath = (id, section = "lexicon") => { if (!uuid(id) || !["posts", "lexicon"].includes(section)) fail(); return `content/${section}/${id}.md`; };
export const imagePath = value => typeof value === 'string' && /^\/images\/articles\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/.test(value);

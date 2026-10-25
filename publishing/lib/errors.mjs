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
export function fail(status = 400) { throw Object.assign(new Error(errors[status][0]), { status }); }
export function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
}
export function failure(status) {
  const [error, message] = errors[status] ?? errors[503];
  return response({ error, message }, errors[status] ? status : 503);
}
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
export const articlePath = id => { if (!uuid(id)) fail(); return `content/lexicon/${id}.md`; };
export const imagePath = value => typeof value === 'string' && /^\/images\/articles\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/.test(value);

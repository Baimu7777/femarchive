import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, inspectImage, normalizeAddress, plainText, referencedImages } from '../deploy/submission-worker/worker.mjs';
import { localBucket, localDatabase } from '../deploy/submission-worker/local/bindings.mjs';

const ORIGIN = 'https://archive.example';
const ADMIN = 'a'.repeat(40);

function setup(overrides = {}) {
  const state = { now: Date.parse('2026-11-16T04:00:00Z'), address: '203.0.113.7', human: true };
  const env = {
    DB: localDatabase(), BUCKET: localBucket(), ADMIN_TOKEN: ADMIN, SOURCE_HASH_KEY: 's'.repeat(40), SESSION_KEY: 'k'.repeat(40),
    ALLOWED_ORIGINS: ORIGIN, ...overrides,
  };
  const worker = createWorker({ now: () => state.now, verifyTurnstile: async () => state.human, addressOf: () => state.address });
  async function call(path, { method = 'GET', body, headers = {}, origin = ORIGIN, raw } = {}) {
    const payload = raw ?? (body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body)));
    const response = await worker.fetch(new Request(`https://receiver.example${path}`, {
      method, body: payload,
      headers: { ...(origin ? { origin } : {}), ...(payload ? { 'content-length': String(payload.byteLength), 'content-type': 'application/json' } : {}), ...headers },
    }), env);
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, headers: response.headers, data: type.includes('json') ? await response.json() : new Uint8Array(await response.arrayBuffer()) };
  }
  const admin = (path, options = {}) => call(path, { ...options, origin: null, headers: { authorization: `Bearer ${ADMIN}` } });
  async function session(code) {
    const result = await call('/session', { method: 'POST', body: { token: 'turnstile-token', ...(code ? { code } : {}) } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data.session;
  }
  const upload = (token, bytes = png(800, 600), type = 'image/png') => call('/images', { method: 'POST', raw: bytes, headers: { authorization: `Bearer ${token}`, 'content-type': type } });
  const submit = (token, fields = {}) => call('/submissions', { method: 'POST', body: { title: '一篇投稿', html: '<p>正文内容</p>', ...fields }, headers: { authorization: `Bearer ${token}` } });
  return { state, env, worker, call, admin, session, upload, submit };
}

function png(width, height, size = 64) {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}
const figure = id => `<img data-submission-image="${id}">`;
const total = async env => (await env.DB.prepare("SELECT value FROM counters WHERE key = 'total'").first())?.value ?? 0;

test('an unconfigured receiver answers 503 and touches nothing', async () => {
  const { call, env } = setup({ ADMIN_TOKEN: 'short' });
  assert.equal((await call('/config')).status, 503);
  assert.equal((await call('/session', { method: 'POST', body: { token: 'x' } })).status, 503);
  assert.deepEqual(env.DB.operations(), { reads: 0, writes: 0 });
});

test('a request from another site is refused before any work', async () => {
  const { call, env } = setup();
  const result = await call('/session', { method: 'POST', body: { token: 'x' }, origin: 'https://evil.example' });
  assert.equal(result.status, 403);
  assert.equal(result.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(env.DB.operations(), { reads: 0, writes: 0 });
});

test('a failed human check costs no database write and no storage', async () => {
  const { call, env, state } = setup();
  state.human = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    assert.equal((await call('/session', { method: 'POST', body: { token: 'bot' } })).status, 403);
  }
  assert.equal(env.DB.operations().writes, 0);
  assert.equal(env.BUCKET.writes(), 0);
});

test('a submission with pictures reaches the forum and can be removed', async () => {
  const { session, upload, submit, admin, env } = setup();
  const token = await session();
  const first = await upload(token), second = await upload(token, png(100, 4000, 512));
  assert.equal(first.status, 201);
  const result = await submit(token, {
    title: '  女性的定义  ', author: '某某', origin: 'https://example.org/a', note: '搬运', contact: 'a@example.org',
    html: `<p>第一段<script>alert(1)</script></p>${figure(first.data.id)}<p>第二段</p>${figure(second.data.id)}`,
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.match(result.data.receipt, /^[0-9a-f]{8}$/u);

  const list = await admin('/admin/submissions?after=0');
  assert.equal(list.data.items.length, 1);
  const meta = list.data.items[0];
  assert.equal(meta.title, '女性的定义');
  assert.equal(meta.imageCount, 2);
  assert.equal(meta.imageBytes, 64 + 512);
  assert.equal(meta.excerpt, '第一段 第二段');
  assert.match(meta.source, /^[0-9a-f]{32}$/u);
  assert.ok(!JSON.stringify(meta).includes('203.0.113.7'), 'the address itself is never stored');

  const detail = await admin(`/admin/submissions/${meta.id}`);
  assert.equal(detail.data.images.length, 2);
  assert.ok(detail.data.html.includes('<script>'), 'the receiver stores what was sent; the forum sanitises it');
  const picture = await admin(`/admin/submissions/${meta.id}/images/${first.data.id}`);
  assert.equal(picture.headers.get('content-type'), 'image/png');
  assert.equal(picture.data.byteLength, 64);
  assert.equal(await total(env), env.BUCKET.bytes());

  assert.equal((await admin('/admin/delete', { method: 'POST', body: { ids: [meta.id] } })).data.removed, 1);
  assert.deepEqual(env.BUCKET.keys(), []);
  assert.equal(await total(env), 0);
  assert.equal((await admin('/admin/submissions?after=0')).data.items.length, 0);
});

test('the admin interface needs the token', async () => {
  const { call } = setup();
  assert.equal((await call('/admin/submissions', { origin: null })).status, 401);
  assert.equal((await call('/admin/submissions', { headers: { authorization: `Bearer ${'b'.repeat(40)}` } })).status, 401);
});

test('pictures left out of the text are discarded, others cannot be claimed', async () => {
  const { session, upload, submit, env, state } = setup();
  const mine = await session();
  const kept = await upload(mine), dropped = await upload(mine);
  state.address = '198.51.100.9';
  const theirs = await session();
  const foreign = await upload(theirs);
  assert.equal((await submit(mine, { html: figure(foreign.data.id) })).status, 400);
  assert.equal((await submit(mine, { html: figure(kept.data.id) })).status, 201);
  assert.ok(env.BUCKET.keys().includes(`images/${kept.data.id}`));
  assert.ok(!env.BUCKET.keys().includes(`images/${dropped.data.id}`));
  assert.ok(env.BUCKET.keys().includes(`images/${foreign.data.id}`));
  assert.equal(await total(env), env.BUCKET.bytes());
});

test('a session submits once', async () => {
  const { session, submit } = setup();
  const token = await session();
  assert.equal((await submit(token)).status, 201);
  assert.equal((await submit(token)).status, 429);
});

test('empty, oversized and malformed submissions are refused', async () => {
  const { session, submit } = setup({ LIMIT_TEXT_CHARS: '10', LIMIT_HTML_CHARS: '200' });
  const token = await session();
  assert.equal((await submit(token, { html: '<p> </p>' })).status, 400);
  assert.equal((await submit(token, { title: '' })).status, 400);
  assert.equal((await submit(token, { title: 'x'.repeat(201) })).status, 400);
  assert.equal((await submit(token, { html: `<p>${'字'.repeat(11)}</p>` })).status, 413);
  assert.equal((await submit(token, { html: `<p>${'<b></b>'.repeat(40)}</p>` })).status, 413);
  assert.equal((await submit(token, { html: 7 })).status, 400);
  assert.equal((await submit(token, { html: '<p>正好十个字正好十个</p>' })).status, 201);
});

test('one source is limited per day and the limit resets the next day', async () => {
  const { session, submit, state } = setup({ LIMIT_SUBMISSIONS_PER_SOURCE_DAY: '2' });
  for (let index = 0; index < 2; index += 1) assert.equal((await submit(await session())).status, 201);
  assert.equal((await submit(await session())).status, 429);
  state.now += 86_400_000;
  assert.equal((await submit(await session())).status, 201);
});

test('the site-wide daily allowance cannot lock out submitters who hold the code', async () => {
  const { session, submit, admin, state } = setup({ LIMIT_SUBMISSIONS_PER_DAY: '2', LIMIT_SUBMISSIONS_PER_SOURCE_DAY: '1' });
  await admin('/admin/settings', { method: 'POST', body: { code: '姊妹同行' } });
  for (const address of ['192.0.2.1', '192.0.2.2']) { state.address = address; assert.equal((await submit(await session())).status, 201); }
  state.address = '192.0.2.3';
  assert.equal((await submit(await session())).status, 429, 'anonymous allowance is used up');
  state.address = '192.0.2.4';
  assert.equal((await submit(await session('姊妹同行'))).status, 201, 'the code has its own allowance');
});

test('picture bytes are bounded per source, per day and in total', async () => {
  const one = setup({ LIMIT_IMAGE_MB_PER_SOURCE_DAY: '1' });
  const token = await one.session();
  assert.equal((await one.upload(token, png(10, 10, 700_000))).status, 201);
  assert.equal((await one.upload(token, png(10, 10, 700_000))).status, 429);
  assert.equal(await total(one.env), 700_000, 'a refused upload leaves no reservation behind');

  const full = setup({ LIMIT_TOTAL_MB: '2', LIMIT_TOTAL_RESERVED_MB: '1' });
  await full.admin('/admin/settings', { method: 'POST', body: { code: 'code' } });
  const anonymous = await full.session();
  assert.equal((await full.upload(anonymous, png(10, 10, 900_000))).status, 201);
  assert.equal((await full.upload(anonymous, png(10, 10, 900_000))).status, 429, 'anonymous uploads stop at the unreserved share');
  assert.equal((await full.submit(anonymous, { html: `<p>${'字'.repeat(60_000)}</p>` })).status, 429, 'a full bucket refuses text too');
  full.state.address = '192.0.2.50';
  assert.equal((await full.upload(await full.session('code'), png(10, 10, 900_000))).status, 201, 'the reserved share is kept for code holders');
});

test('pictures are checked by their own bytes', async () => {
  const { session, upload } = setup({ LIMIT_IMAGE_MB: '1' });
  const token = await session();
  assert.equal((await upload(token, new TextEncoder().encode('<svg onload=alert(1)>'.padEnd(64)), 'image/png')).status, 415);
  assert.equal((await upload(token, png(10, 10), 'image/svg+xml')).status, 415);
  assert.equal((await upload(token, png(20_000, 20_000))).status, 413);
  assert.equal((await upload(token, png(10, 10, 1024 * 1024 + 1))).status, 413);
  assert.equal((await upload(token, png(0, 10))).status, 413);
});

test('one submission keeps at most the allowed number of pictures', async () => {
  const { session, upload, submit } = setup({ LIMIT_IMAGES_PER_SUBMISSION: '2' });
  const token = await session();
  const ids = [];
  for (let index = 0; index < 3; index += 1) ids.push((await upload(token)).data.id);
  assert.equal((await submit(token, { html: ids.map(figure).join('') })).status, 413);
  for (let index = 0; index < 9; index += 1) await upload(token);
  assert.equal((await upload(token)).status, 429, 'uploads stop a little past the limit');
});

test('a banned source cannot open a session or finish one it already holds', async () => {
  const { session, submit, admin, call, state } = setup();
  const before = await session();
  assert.equal((await submit(await session())).status, 201);
  const source = (await admin('/admin/submissions')).data.items[0].source;
  assert.equal((await admin('/admin/bans', { method: 'POST', body: { source, days: 30, note: '灌水' } })).status, 200);
  assert.equal((await call('/session', { method: 'POST', body: { token: 't' } })).status, 403);
  assert.equal((await submit(before)).status, 403);
  assert.equal((await admin('/admin/state')).data.bans[0].source, source);
  state.address = '203.0.113.8';
  assert.equal((await submit(await session())).status, 201, 'other sources are unaffected');
  state.address = '203.0.113.7';
  await admin('/admin/unban', { method: 'POST', body: { source } });
  assert.equal((await submit(await session())).status, 201);
});

test('a ban covers a whole IPv6 /64', () => {
  assert.equal(normalizeAddress('2001:db8:1:2:aaaa::1'), normalizeAddress('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'));
  assert.notEqual(normalizeAddress('2001:db8:1:2::1'), normalizeAddress('2001:db8:1:3::1'));
  assert.equal(normalizeAddress('203.0.113.7'), '203.0.113.7');
});

test('members can close the entrance, require a code, or pause pictures', async () => {
  const { session, upload, submit, admin, call } = setup();
  const open = await session();
  assert.equal((await admin('/admin/settings', { method: 'POST', body: { mode: 'code' } })).status, 400, 'code mode needs a code');
  assert.equal((await call('/config')).data.mode, 'open');
  await admin('/admin/settings', { method: 'POST', body: { mode: 'code', code: '暗号' } });
  assert.equal((await call('/config')).data.mode, 'code');
  const refused = await call('/session', { method: 'POST', body: { token: 't' } });
  assert.equal(refused.status, 403);
  assert.equal(refused.data.needsCode, true);
  assert.equal((await call('/session', { method: 'POST', body: { token: 't', code: '错的' } })).status, 403);
  assert.equal((await submit(open)).status, 403, 'a session opened earlier does not bypass the code');
  const trusted = await session('暗号');
  await admin('/admin/settings', { method: 'POST', body: { images: false } });
  assert.equal((await upload(trusted)).status, 403);
  assert.equal((await submit(trusted)).status, 201);
  await admin('/admin/settings', { method: 'POST', body: { mode: 'closed' } });
  assert.equal((await call('/session', { method: 'POST', body: { token: 't', code: '暗号' } })).status, 403);
  assert.equal((await admin('/admin/state')).data.settings.mode, 'closed');
});

test('wrong codes are throttled like every other session attempt', async () => {
  const { call, admin } = setup({ LIMIT_SESSIONS_PER_SOURCE_HOUR: '3' });
  await admin('/admin/settings', { method: 'POST', body: { mode: 'code', code: 'right' } });
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await call('/session', { method: 'POST', body: { token: 't', code: 'guess' } })).status, 403);
  assert.equal((await call('/session', { method: 'POST', body: { token: 't', code: 'right' } })).status, 429);
});

test('forged and expired sessions are refused', async () => {
  const { session, submit, state } = setup();
  const token = await session();
  const [body, signature] = token.split('.');
  const forged = `${btoa(JSON.stringify({ ...JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))), trusted: true })).replace(/=+$/u, '')}.${signature}`;
  assert.equal((await submit(forged)).status, 401);
  assert.equal((await submit('nonsense')).status, 401);
  state.now += 31 * 60_000;
  assert.equal((await submit(token)).status, 401);
});

test('the daily sweep removes abandoned uploads and expired submissions', async () => {
  const { session, upload, submit, worker, env, state, admin } = setup({ RETENTION_DAYS: '90' });
  await upload(await session());
  const token = await session();
  const kept = await upload(token);
  await submit(token, { html: figure(kept.data.id) });
  state.now += 25 * 3_600_000;
  await worker.scheduled({}, env);
  assert.deepEqual(env.BUCKET.keys().filter(key => key.startsWith('images/')), [`images/${kept.data.id}`]);
  assert.equal(await total(env), env.BUCKET.bytes());
  state.now += 90 * 86_400_000;
  await worker.scheduled({}, env);
  assert.deepEqual(env.BUCKET.keys(), []);
  assert.equal((await admin('/admin/state')).data.usage.totalBytes, 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS count FROM counters').first()).count, 1, 'only the running total remains');
});

test('image headers of every accepted format are read without decoding', () => {
  const gif = new Uint8Array(16); gif.set([...'GIF89a'].map(char => char.charCodeAt(0))); gif[6] = 0x20; gif[7] = 0x03; gif[8] = 0x58; gif[9] = 0x02;
  assert.deepEqual(inspectImage(gif), { mime: 'image/gif', width: 800, height: 600 });
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x02, 0x58, 0x03, 0x20, 1, 1, 0, 0, 0]);
  assert.deepEqual(inspectImage(jpeg), { mime: 'image/jpeg', width: 800, height: 600 });
  const webp = new Uint8Array(32); webp.set([...'RIFF'].map(c => c.charCodeAt(0))); webp.set([...'WEBPVP8X'].map(c => c.charCodeAt(0)), 8); webp[24] = 0x1f; webp[25] = 0x03; webp[27] = 0x57; webp[28] = 0x02;
  assert.deepEqual(inspectImage(webp), { mime: 'image/webp', width: 800, height: 600 });
  assert.equal(inspectImage(new TextEncoder().encode('<?xml version="1.0"?><svg></svg>')), null);
});

test('text helpers', () => {
  assert.equal(plainText('<p>a&amp;b</p><style>x{}</style><p>&lt;c&gt;</p>'), 'a&b <c>');
  assert.deepEqual(referencedImages(`${figure('11111111-1111-4111-8111-111111111111')}${figure('11111111-1111-4111-8111-111111111111')}`), ['11111111-1111-4111-8111-111111111111']);
});

/**
 * Public submission receiver for the archive, deployed as its own Cloudflare
 * Worker so that abuse of it can exhaust only its own free allowance: the
 * archive (Vercel) and the forum (VPS) never see this traffic.
 *
 * It verifies, counts and stores. It never renders submitted HTML, never
 * decodes an image beyond its header, and holds no credential for the forum:
 * the forum pulls from `/admin/*` with a bearer token.
 *
 * Checks run cheapest first. A request that fails the Turnstile check costs
 * no database or storage operation at all.
 */

const MIB = 1024 * 1024;
const DAY = 86_400_000;
const NEVER = 253_402_300_799_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SOURCE = /^[0-9a-f]{32}$/u;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MODES = new Set(['open', 'code', 'closed']);

const DEFAULT_LIMITS = {
  LIMIT_TEXT_CHARS: 200_000,
  LIMIT_HTML_CHARS: 400_000,
  LIMIT_IMAGES_PER_SUBMISSION: 30,
  LIMIT_IMAGE_MB: 4,
  LIMIT_IMAGE_PIXELS: 40_000_000,
  LIMIT_SESSIONS_PER_SOURCE_HOUR: 12,
  LIMIT_SUBMISSIONS_PER_SOURCE_DAY: 5,
  LIMIT_IMAGE_MB_PER_SOURCE_DAY: 100,
  LIMIT_SUBMISSIONS_PER_DAY: 30,
  LIMIT_IMAGE_MB_PER_DAY: 300,
  LIMIT_TRUSTED_SUBMISSIONS_PER_DAY: 60,
  LIMIT_TRUSTED_IMAGE_MB_PER_DAY: 300,
  LIMIT_TOTAL_MB: 2048,
  LIMIT_TOTAL_RESERVED_MB: 500,
  RETENTION_DAYS: 90,
  BAN_DAYS: 30,
};

export function readLimits(env) {
  const limits = {};
  for (const [name, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const raw = env[name];
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    limits[name] = Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  }
  return limits;
}

class Refusal extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromBase64url(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, encoder.encode(message));
}

/** Compares digests, so neither length nor content leaks through timing. */
async function sameSecret(left, right) {
  const [a, b] = await Promise.all([left, right].map(value => crypto.subtle.digest('SHA-256', encoder.encode(String(value)))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < x.length; index += 1) difference |= x[index] ^ y[index];
  return difference === 0;
}

/** An IPv6 customer holds a whole /64, so that is what counts as one source. */
export function normalizeAddress(address) {
  const value = String(address ?? '').trim().toLowerCase();
  if (!value) return 'unknown';
  if (!value.includes(':')) return value;
  const [head, tail = ''] = value.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = value.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/u, '')).join(':')}::/64`;
}

async function sourceOf(env, address) {
  return hex(await hmac(env.SOURCE_HASH_KEY, `source\0${normalizeAddress(address)}`)).slice(0, 32);
}

async function signSession(env, payload) {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${base64url(await hmac(env.SESSION_KEY, `session\0${body}`))}`;
}

async function readSession(env, request, now) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined || token.length > 1000) throw new Refusal(401, '投稿验证已失效，请重新提交。');
  if (!await sameSecret(signature, base64url(await hmac(env.SESSION_KEY, `session\0${body}`)))) throw new Refusal(401, '投稿验证已失效，请重新提交。');
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))); } catch { throw new Refusal(401, '投稿验证已失效，请重新提交。'); }
  if (!UUID.test(payload?.sid ?? '') || !SOURCE.test(payload?.src ?? '') || !(payload.exp > now)) throw new Refusal(401, '投稿验证已过期，请重新提交。');
  return { id: payload.sid, source: payload.src, trusted: payload.trusted === true };
}

/** Beijing calendar day: the day the quotas are explained in. */
const dayOf = now => new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
const endOfDay = now => Math.floor((now + 8 * 3_600_000) / DAY) * DAY + DAY - 8 * 3_600_000 + DAY;

/** Adds to a counter only while it stays within `limit`; one atomic statement. */
async function reserve(db, key, amount, limit, expiresAt) {
  if (amount > limit) return false;
  const row = await db.prepare(
    `INSERT INTO counters (key, value, expires_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + excluded.value
       WHERE counters.value + excluded.value <= ?4
     RETURNING value`,
  ).bind(key, amount, expiresAt, limit).first();
  return Boolean(row);
}

async function release(db, key, amount) {
  if (amount > 0) await db.prepare('UPDATE counters SET value = MAX(0, value - ?2) WHERE key = ?1').bind(key, amount).run();
}

/** All of the reservations or none of them. */
async function reserveAll(db, reservations) {
  const held = [];
  for (const item of reservations) {
    if (await reserve(db, item.key, item.amount, item.limit, item.expiresAt)) { held.push(item); continue; }
    for (const taken of held) await release(db, taken.key, taken.amount);
    throw new Refusal(429, item.message);
  }
  return async () => { for (const taken of held) await release(db, taken.key, taken.amount); };
}

const SETTINGS_TTL = 30_000;
let cachedSettings;

async function readSettings(env, now, fresh = false) {
  if (!fresh && cachedSettings && cachedSettings.db === env.DB && now - cachedSettings.at < SETTINGS_TTL) return cachedSettings.value;
  const rows = (await env.DB.prepare('SELECT key, value FROM settings').all()).results ?? [];
  const stored = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const value = {
    mode: MODES.has(stored.mode) ? stored.mode : 'open',
    images: stored.images !== 'off',
    code: typeof stored.code === 'string' ? stored.code : '',
  };
  cachedSettings = { db: env.DB, at: now, value };
  return value;
}

async function readCapped(request, maximum, tooLarge) {
  const declared = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(declared) || declared <= 0) throw new Refusal(411, '请求缺少长度信息。');
  if (declared > maximum) throw new Refusal(413, tooLarge);
  const reader = request.body?.getReader();
  if (!reader) throw new Refusal(400, '请求没有内容。');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel().catch(() => undefined); throw new Refusal(413, tooLarge); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function readJson(request, maximum, tooLarge) {
  const bytes = await readCapped(request, maximum, tooLarge);
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value && typeof value === 'object' && !Array.isArray(value)) return { value, size: bytes.byteLength };
  } catch { /* Reported below. */ }
  throw new Refusal(400, '请求格式无效。');
}

/** Type and size from the file's own header. Nothing is decoded here: the
 *  forum re-encodes every picture before a member's browser is given one. */
export function inspectImage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && ascii(12, 4) === 'IHDR') {
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    return { mime: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') return { mime: 'image/webp', width: 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16), height: 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16) };
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { mime: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + (bits >>> 14 & 0x3fff) };
    }
    if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { mime: 'image/webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      const length = view.getUint16(offset + 2);
      if (length < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

const collapse = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim();

function field(value, maximum, label, required = false) {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new Refusal(400, `${label}格式无效。`);
  const text = collapse(value);
  if (required && !text) throw new Refusal(400, `请填写${label}。`);
  if ([...text].length > maximum) throw new Refusal(400, `${label}不能超过 ${maximum} 个字。`);
  return text;
}

/** Text for counting and for the list excerpt only. The forum sanitises the
 *  real document with its own sanitiser before anything is shown. */
export function plainText(html) {
  return html.replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(?:nbsp|#160|#xa0);/giu, ' ').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ').trim();
}

export function referencedImages(html) {
  return [...new Set([...html.matchAll(/data-submission-image="([0-9a-f-]{36})"/gu)].map(match => match[1]))];
}

async function defaultTurnstile(env, token, address) {
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (address) body.set('remoteip', address);
  let result;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    result = await response.json();
  } catch { throw new Refusal(503, '验证服务暂时不可用，请稍后重试。'); }
  const hostnames = String(env.TURNSTILE_HOSTNAMES ?? '').split(',').map(item => item.trim()).filter(Boolean);
  return result?.success === true && result.action === 'submission' && (!hostnames.length || hostnames.includes(result.hostname));
}

async function deleteStored(env, submissionIds, imageRows) {
  const keys = [...submissionIds.map(id => `submissions/${id}/body.html`), ...imageRows.map(row => `images/${row.id}`)];
  for (let start = 0; start < keys.length; start += 500) await env.BUCKET.delete(keys.slice(start, start + 500));
}

async function removeSubmissions(env, ids) {
  let removed = 0;
  for (let start = 0; start < ids.length; start += 20) {
    const chunk = ids.slice(start, start + 20);
    const marks = chunk.map((_, index) => `?${index + 1}`).join(',');
    const submissions = (await env.DB.prepare(`SELECT id, body_bytes FROM submissions WHERE id IN (${marks})`).bind(...chunk).all()).results ?? [];
    if (!submissions.length) continue;
    const images = (await env.DB.prepare(`SELECT id, bytes FROM images WHERE submission_id IN (${marks})`).bind(...chunk).all()).results ?? [];
    // Objects first: a row without an object is harmless, an object without a
    // row would be storage nothing accounts for.
    await deleteStored(env, submissions.map(row => row.id), images);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM images WHERE submission_id IN (${marks})`).bind(...chunk),
      env.DB.prepare(`DELETE FROM submissions WHERE id IN (${marks})`).bind(...chunk),
    ]);
    await release(env.DB, 'total', submissions.reduce((sum, row) => sum + row.body_bytes, 0) + images.reduce((sum, row) => sum + row.bytes, 0));
    removed += submissions.length;
  }
  return removed;
}

async function removeImages(env, rows) {
  if (!rows.length) return;
  await deleteStored(env, [], rows);
  for (let start = 0; start < rows.length; start += 50) {
    const chunk = rows.slice(start, start + 50);
    await env.DB.prepare(`DELETE FROM images WHERE submission_id IS NULL AND id IN (${chunk.map((_, index) => `?${index + 1}`).join(',')})`).bind(...chunk.map(row => row.id)).run();
  }
  await release(env.DB, 'total', rows.reduce((sum, row) => sum + row.bytes, 0));
}

function configured(env) {
  return Boolean(env.DB && env.BUCKET && env.ADMIN_TOKEN?.length >= 32 && env.SOURCE_HASH_KEY?.length >= 32 && env.SESSION_KEY?.length >= 32);
}

function publicLimits(limits) {
  return {
    textChars: limits.LIMIT_TEXT_CHARS,
    htmlChars: limits.LIMIT_HTML_CHARS,
    images: limits.LIMIT_IMAGES_PER_SUBMISSION,
    imageBytes: limits.LIMIT_IMAGE_MB * MIB,
    imagePixels: limits.LIMIT_IMAGE_PIXELS,
  };
}

const metaOf = row => ({
  seq: row.seq, id: row.id, receivedAt: new Date(row.received_at).toISOString(), source: row.source, trusted: row.trusted === 1,
  title: row.title, author: row.author, origin: row.origin, note: row.note, contact: row.contact, excerpt: row.excerpt,
  textChars: row.text_chars, bodyBytes: row.body_bytes, imageCount: row.image_count, imageBytes: row.image_bytes,
});

export function createWorker(dependencies = {}) {
  const clock = dependencies.now ?? (() => Date.now());
  const verifyTurnstile = dependencies.verifyTurnstile ?? defaultTurnstile;
  const addressOf = dependencies.addressOf ?? (request => request.headers.get('cf-connecting-ip'));

  async function openSession(request, env, limits, now) {
    const settings = await readSettings(env, now);
    if (settings.mode === 'closed') throw new Refusal(403, '投稿入口暂时关闭，请稍后再来，或改用邮箱投稿。');
    const { value } = await readJson(request, 8192, '请求过大。');
    if (typeof value.token !== 'string' || !value.token || value.token.length > 4096) throw new Refusal(400, '请先完成人机验证。');
    const address = addressOf(request);
    // Before any counter is touched: a failed check costs no database write.
    if (!await verifyTurnstile(env, value.token, address)) throw new Refusal(403, '人机验证未通过，请重试。');
    const source = await sourceOf(env, address);
    if (await env.DB.prepare('SELECT 1 AS banned FROM bans WHERE source = ?1 AND expires_at > ?2').bind(source, now).first()) {
      throw new Refusal(403, '暂时无法接受来自这个网络的投稿。');
    }
    const hour = Math.floor(now / 3_600_000);
    if (!await reserve(env.DB, `session:${source}:${hour}`, 1, limits.LIMIT_SESSIONS_PER_SOURCE_HOUR, (hour + 2) * 3_600_000)) {
      throw new Refusal(429, '操作过于频繁，请一小时后再试。');
    }
    const supplied = typeof value.code === 'string' ? value.code.trim().slice(0, 200) : '';
    const trusted = Boolean(settings.code) && Boolean(supplied) && await sameSecret(supplied, settings.code);
    if (settings.mode === 'code' && !trusted) throw new Refusal(403, supplied ? '投稿码不正确。' : '目前需要投稿码才能投稿，请向小组索取。', { needsCode: true });
    const expiresAt = now + 30 * 60_000;
    return json({ session: await signSession(env, { sid: crypto.randomUUID(), src: source, trusted, exp: expiresAt }), expiresAt: new Date(expiresAt).toISOString(), trusted });
  }

  async function receiveImage(request, env, limits, now) {
    const session = await readSession(env, request, now);
    const settings = await readSettings(env, now);
    if (settings.mode === 'closed') throw new Refusal(403, '投稿入口暂时关闭。');
    if (!settings.images) throw new Refusal(403, '目前暂停接收图片，文字投稿不受影响。');
    const maximum = limits.LIMIT_IMAGE_MB * MIB;
    const tooLarge = `单张图片压缩后不能超过 ${limits.LIMIT_IMAGE_MB} MB。`;
    if (!IMAGE_TYPES.has((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase())) throw new Refusal(415, '只接受 JPG、PNG、WebP 和 GIF 图片。');
    const bytes = await readCapped(request, maximum, tooLarge);
    const image = inspectImage(bytes);
    if (!image) throw new Refusal(415, '图片格式无效或文件已损坏。');
    if (!image.width || !image.height || image.width * image.height > limits.LIMIT_IMAGE_PIXELS) throw new Refusal(413, '图片像素过大，请缩小后再上传。');
    const day = dayOf(now), expiresAt = endOfDay(now);
    const scope = session.trusted ? 'trusted' : 'open';
    const undo = await reserveAll(env.DB, [
      // Room for a few replaced pictures beyond what one submission may keep.
      { key: `images:session:${session.id}`, amount: 1, limit: limits.LIMIT_IMAGES_PER_SUBMISSION + 10, expiresAt, message: `一次投稿最多 ${limits.LIMIT_IMAGES_PER_SUBMISSION} 张图片。` },
      { key: `bytes:source:${session.source}:${day}`, amount: bytes.byteLength, limit: limits.LIMIT_IMAGE_MB_PER_SOURCE_DAY * MIB, expiresAt, message: '你今天上传的图片已达上限，请明天再试；文字投稿不受影响。' },
      { key: `bytes:${scope}:${day}`, amount: bytes.byteLength, limit: (session.trusted ? limits.LIMIT_TRUSTED_IMAGE_MB_PER_DAY : limits.LIMIT_IMAGE_MB_PER_DAY) * MIB, expiresAt, message: '今天全站的图片投稿名额已用完，请明天再试；文字投稿不受影响。' },
      { key: 'total', amount: bytes.byteLength, limit: (limits.LIMIT_TOTAL_MB - (session.trusted ? 0 : limits.LIMIT_TOTAL_RESERVED_MB)) * MIB, expiresAt: NEVER, message: '投稿箱的图片空间已满，暂时无法接收图片；文字投稿不受影响。' },
    ]);
    const id = crypto.randomUUID();
    try {
      await env.BUCKET.put(`images/${id}`, bytes, { httpMetadata: { contentType: image.mime } });
      await env.DB.prepare('INSERT INTO images (id, session, source, bytes, mime, width, height, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
        .bind(id, session.id, session.source, bytes.byteLength, image.mime, image.width, image.height, now).run();
    } catch (error) {
      await env.BUCKET.delete(`images/${id}`).catch(() => undefined);
      await undo();
      throw error;
    }
    return json({ id, width: image.width, height: image.height }, 201);
  }

  async function receiveSubmission(request, env, limits, now) {
    const session = await readSession(env, request, now);
    const settings = await readSettings(env, now);
    if (settings.mode === 'closed') throw new Refusal(403, '投稿入口暂时关闭。');
    if (settings.mode === 'code' && !session.trusted) throw new Refusal(403, '目前需要投稿码才能投稿。', { needsCode: true });
    // Generous enough for the largest accepted document in UTF-8 plus fields.
    const { value } = await readJson(request, limits.LIMIT_HTML_CHARS * 4 + 65_536, '正文过长。');
    const title = field(value.title, 200, '标题', true);
    const author = field(value.author, 100, '作者署名');
    const origin = field(value.origin, 2000, '原文出处');
    const note = field(value.note, 2000, '投稿说明');
    const contact = field(value.contact, 200, '联系方式');
    if (typeof value.html !== 'string') throw new Refusal(400, '正文格式无效。');
    const html = value.html;
    if (html.length > limits.LIMIT_HTML_CHARS) throw new Refusal(413, '正文过长，请删减后再提交。');
    const text = plainText(html);
    const textChars = [...text].length;
    if (textChars > limits.LIMIT_TEXT_CHARS) throw new Refusal(413, `正文不能超过 ${limits.LIMIT_TEXT_CHARS} 字。`);
    const wanted = referencedImages(html);
    if (wanted.length > limits.LIMIT_IMAGES_PER_SUBMISSION) throw new Refusal(413, `一次投稿最多 ${limits.LIMIT_IMAGES_PER_SUBMISSION} 张图片。`);
    if (!textChars && !wanted.length) throw new Refusal(400, '请填写正文或添加图片。');
    if (await env.DB.prepare('SELECT 1 AS banned FROM bans WHERE source = ?1 AND expires_at > ?2').bind(session.source, now).first()) {
      throw new Refusal(403, '暂时无法接受来自这个网络的投稿。');
    }
    const uploaded = (await env.DB.prepare('SELECT id, bytes, submission_id FROM images WHERE session = ?1').bind(session.id).all()).results ?? [];
    const available = new Map(uploaded.filter(row => row.submission_id === null).map(row => [row.id, row]));
    if (wanted.some(id => !available.has(id))) throw new Refusal(400, '有图片没有上传成功，请重新添加后再提交。');
    if (wanted.length && !settings.images) throw new Refusal(403, '目前暂停接收图片，请移除图片后再提交。');

    const body = encoder.encode(html);
    const day = dayOf(now), expiresAt = endOfDay(now);
    const undo = await reserveAll(env.DB, [
      { key: `submitted:${session.id}`, amount: 1, limit: 1, expiresAt, message: '这份投稿已经提交过了。' },
      { key: `count:source:${session.source}:${day}`, amount: 1, limit: limits.LIMIT_SUBMISSIONS_PER_SOURCE_DAY, expiresAt, message: `每天最多投稿 ${limits.LIMIT_SUBMISSIONS_PER_SOURCE_DAY} 篇，请明天再试。` },
      { key: `count:${session.trusted ? 'trusted' : 'open'}:${day}`, amount: 1, limit: session.trusted ? limits.LIMIT_TRUSTED_SUBMISSIONS_PER_DAY : limits.LIMIT_SUBMISSIONS_PER_DAY, expiresAt, message: '今天的投稿名额已用完，请明天再试。' },
      { key: 'total', amount: body.byteLength, limit: (limits.LIMIT_TOTAL_MB - (session.trusted ? 0 : limits.LIMIT_TOTAL_RESERVED_MB)) * MIB, expiresAt: NEVER, message: '投稿箱已满，暂时无法接收新投稿，请稍后再试。' },
    ]);
    const id = crypto.randomUUID();
    const kept = wanted.map(imageId => available.get(imageId));
    try {
      await env.BUCKET.put(`submissions/${id}/body.html`, body, { httpMetadata: { contentType: 'application/octet-stream' } });
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO submissions (id, received_at, source, trusted, title, author, origin, note, contact, excerpt, text_chars, body_bytes, image_count, image_bytes)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
          .bind(id, now, session.source, session.trusted ? 1 : 0, title, author, origin, note, contact, [...text].slice(0, 300).join(''), textChars, body.byteLength, kept.length, kept.reduce((sum, row) => sum + row.bytes, 0)),
        ...kept.map(row => env.DB.prepare('UPDATE images SET submission_id = ?2 WHERE id = ?1 AND session = ?3 AND submission_id IS NULL').bind(row.id, id, session.id)),
      ]);
    } catch (error) {
      await env.BUCKET.delete(`submissions/${id}/body.html`).catch(() => undefined);
      await undo();
      throw error;
    }
    // Pictures she uploaded and then removed from the text are not kept.
    await removeImages(env, [...available.values()].filter(row => !wanted.includes(row.id))).catch(() => undefined);
    return json({ ok: true, receipt: id.slice(0, 8) }, 201);
  }

  async function admin(request, env, url, limits, now) {
    const header = request.headers.get('authorization') ?? '';
    if (!header.startsWith('Bearer ') || !await sameSecret(header.slice(7), env.ADMIN_TOKEN)) throw new Refusal(401, 'Unauthorized.');
    const path = url.pathname.slice('/admin'.length);
    const method = request.method;
    if (method === 'GET' && path === '/submissions') {
      const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0));
      const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 50)));
      const rows = (await env.DB.prepare('SELECT * FROM submissions WHERE seq > ?1 ORDER BY seq LIMIT ?2').bind(after, limit).all()).results ?? [];
      return json({ items: rows.map(metaOf), more: rows.length === limit });
    }
    const one = /^\/submissions\/([0-9a-f-]{36})$/u.exec(path);
    if (method === 'GET' && one) {
      const row = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?1').bind(one[1]).first();
      const object = row ? await env.BUCKET.get(`submissions/${row.id}/body.html`) : null;
      if (!row || !object) throw new Refusal(404, 'Not found.');
      const images = (await env.DB.prepare('SELECT id, bytes, mime, width, height FROM images WHERE submission_id = ?1 ORDER BY created_at, id').bind(row.id).all()).results ?? [];
      return json({ ...metaOf(row), html: await object.text(), images });
    }
    const picture = /^\/submissions\/([0-9a-f-]{36})\/images\/([0-9a-f-]{36})$/u.exec(path);
    if (method === 'GET' && picture) {
      const row = await env.DB.prepare('SELECT id, mime FROM images WHERE id = ?1 AND submission_id = ?2').bind(picture[2], picture[1]).first();
      const object = row ? await env.BUCKET.get(`images/${row.id}`) : null;
      if (!row || !object) throw new Refusal(404, 'Not found.');
      return new Response(await object.arrayBuffer(), { headers: { 'content-type': row.mime, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
    }
    if (method === 'GET' && path === '/state') {
      const day = dayOf(now);
      const [settings, bans, counters, pending] = await Promise.all([
        readSettings(env, now, true),
        env.DB.prepare('SELECT source, created_at, expires_at, note FROM bans WHERE expires_at > ?1 ORDER BY created_at DESC LIMIT 200').bind(now).all(),
        env.DB.prepare('SELECT key, value FROM counters WHERE key IN (?1, ?2, ?3, ?4, ?5)').bind('total', `count:open:${day}`, `count:trusted:${day}`, `bytes:open:${day}`, `bytes:trusted:${day}`).all(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM submissions').first(),
      ]);
      const used = Object.fromEntries((counters.results ?? []).map(row => [row.key, row.value]));
      return json({
        settings,
        bans: (bans.results ?? []).map(row => ({ source: row.source, createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(), note: row.note })),
        usage: {
          held: pending?.count ?? 0, totalBytes: used.total ?? 0, totalLimitBytes: limits.LIMIT_TOTAL_MB * MIB,
          today: {
            open: { submissions: used[`count:open:${day}`] ?? 0, submissionLimit: limits.LIMIT_SUBMISSIONS_PER_DAY, imageBytes: used[`bytes:open:${day}`] ?? 0, imageLimitBytes: limits.LIMIT_IMAGE_MB_PER_DAY * MIB },
            trusted: { submissions: used[`count:trusted:${day}`] ?? 0, submissionLimit: limits.LIMIT_TRUSTED_SUBMISSIONS_PER_DAY, imageBytes: used[`bytes:trusted:${day}`] ?? 0, imageLimitBytes: limits.LIMIT_TRUSTED_IMAGE_MB_PER_DAY * MIB },
          },
        },
      });
    }
    if (method !== 'POST') throw new Refusal(404, 'Not found.');
    const { value } = await readJson(request, 65_536, 'Too large.');
    if (path === '/delete') {
      const ids = Array.isArray(value.ids) ? value.ids.filter(id => typeof id === 'string' && UUID.test(id)).slice(0, 200) : [];
      return json({ removed: await removeSubmissions(env, ids) });
    }
    if (path === '/settings') {
      const changes = [];
      if (value.mode !== undefined) {
        if (!MODES.has(value.mode)) throw new Refusal(400, 'Invalid mode.');
        changes.push(['mode', value.mode]);
      }
      if (value.images !== undefined) changes.push(['images', value.images ? 'on' : 'off']);
      if (value.code !== undefined) {
        if (typeof value.code !== 'string' || value.code.trim().length > 100) throw new Refusal(400, 'Invalid code.');
        changes.push(['code', value.code.trim()]);
      }
      if (changes.length) await env.DB.batch(changes.map(([key, stored]) => env.DB.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, stored)));
      const settings = await readSettings(env, now, true);
      if (settings.mode === 'code' && !settings.code) {
        // A code mode nobody can satisfy would silently close the entrance.
        await env.DB.prepare("UPDATE settings SET value = 'open' WHERE key = 'mode'").run();
        await readSettings(env, now, true);
        throw new Refusal(400, '请先设置投稿码，再切换到投稿码模式。');
      }
      return json({ settings });
    }
    if (path === '/bans') {
      if (!SOURCE.test(value.source ?? '')) throw new Refusal(400, 'Invalid source.');
      const days = Math.min(365, Math.max(1, Math.floor(Number(value.days) || limits.BAN_DAYS)));
      await env.DB.prepare('INSERT INTO bans (source, created_at, expires_at, note) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (source) DO UPDATE SET expires_at = excluded.expires_at, note = excluded.note')
        .bind(value.source, now, now + days * DAY, collapse(value.note).slice(0, 200)).run();
      return json({ ok: true });
    }
    if (path === '/unban') {
      if (!SOURCE.test(value.source ?? '')) throw new Refusal(400, 'Invalid source.');
      await env.DB.prepare('DELETE FROM bans WHERE source = ?1').bind(value.source).run();
      return json({ ok: true });
    }
    throw new Refusal(404, 'Not found.');
  }

  function json(value, status = 200, headers = {}) {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
  }

  function allowedOrigin(request, env) {
    const origin = request.headers.get('origin');
    const allowed = String(env.ALLOWED_ORIGINS ?? '').split(',').map(item => item.trim()).filter(Boolean);
    return origin && allowed.includes(origin) ? origin : null;
  }

  function withCors(response, origin) {
    const headers = new Headers(response.headers);
    headers.set('vary', 'Origin');
    headers.set('x-content-type-options', 'nosniff');
    if (origin) {
      headers.set('access-control-allow-origin', origin);
      headers.set('access-control-allow-headers', 'authorization, content-type');
      headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
      headers.set('access-control-max-age', '86400');
    }
    return new Response(response.body, { status: response.status, headers });
  }

  async function route(request, env, origin) {
    const url = new URL(request.url);
    if (!configured(env)) throw new Refusal(503, '投稿入口尚未开放。');
    const limits = readLimits(env);
    const now = clock();
    if (url.pathname.startsWith('/admin/')) return admin(request, env, url, limits, now);
    if (request.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403 });
    if (request.method === 'GET' && url.pathname === '/config') {
      const settings = await readSettings(env, now);
      return json({ mode: settings.mode, images: settings.images, limits: publicLimits(limits) }, 200, { 'cache-control': 'public, max-age=60' });
    }
    if (request.method !== 'POST') throw new Refusal(404, '没有这个地址。');
    // Browsers always send Origin on these requests; a missing or foreign one
    // is another site or a script, and is turned away before any work.
    if (!origin) throw new Refusal(403, '请从文库的投稿页面提交。');
    if (url.pathname === '/session') return openSession(request, env, limits, now);
    if (url.pathname === '/images') return receiveImage(request, env, limits, now);
    if (url.pathname === '/submissions') return receiveSubmission(request, env, limits, now);
    throw new Refusal(404, '没有这个地址。');
  }

  return {
    async fetch(request, env) {
      const origin = allowedOrigin(request, env);
      try {
        return withCors(await route(request, env, origin), origin);
      } catch (error) {
        if (error instanceof Refusal) return withCors(json({ error: error.message, ...error.extra }, error.status), origin);
        console.error('submission receiver failed', error?.message);
        return withCors(json({ error: '投稿服务暂时不可用，请稍后重试。' }, 503), origin);
      }
    },

    /** Daily sweep: abandoned uploads, expired submissions, old counters. */
    async scheduled(_event, env) {
      if (!configured(env)) return;
      const limits = readLimits(env);
      const now = clock();
      const orphans = (await env.DB.prepare('SELECT id, bytes FROM images WHERE submission_id IS NULL AND created_at < ?1 LIMIT 500').bind(now - DAY).all()).results ?? [];
      await removeImages(env, orphans);
      const expired = (await env.DB.prepare('SELECT id FROM submissions WHERE received_at < ?1 ORDER BY seq LIMIT 100').bind(now - limits.RETENTION_DAYS * DAY).all()).results ?? [];
      await removeSubmissions(env, expired.map(row => row.id));
      await env.DB.batch([
        env.DB.prepare('DELETE FROM counters WHERE expires_at < ?1').bind(now),
        env.DB.prepare('DELETE FROM bans WHERE expires_at < ?1').bind(now),
        // The running total is corrected from what is actually recorded, so a
        // failed request can never leave the bucket looking fuller for good.
        env.DB.prepare(`INSERT INTO counters (key, value, expires_at)
          VALUES ('total', (SELECT COALESCE(SUM(bytes), 0) FROM images) + (SELECT COALESCE(SUM(body_bytes), 0) FROM submissions), ?1)
          ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(NEVER),
      ]);
    },
  };
}

export default createWorker();

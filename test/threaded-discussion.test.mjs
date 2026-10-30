import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { publicBody, readDocument, writeDocument, articleFields, validateArticle } from '../publishing/lib/document.mjs';
import { fixture, catalog } from './helpers.mjs';

const threaded = (overrides = {}) => ({
  ...fixture(), section: 'posts', presentation: 'threaded',
  comments: ['母评论', '回复一', '孤立回复'],
  commentKinds: ['card', 'reply', 'reply'],
  commentOrphans: [false, false, true],
  ...overrides,
});

test('the threaded article layout keeps parent cards, reply bubbles and the withdrawn-parent note', () => {
  const value = threaded();
  validateArticle(value, catalog);
  const body = publicBody('<p>正文</p>', value.comments, [], value.presentation, value.comments.map(() => []), [], value.commentKinds, value.commentOrphans);
  assert.ok(body.includes('<p class="douban-comments-title">评论交流区</p>'), body);
  assert.ok(body.includes('<div class="mycard"><div class="mycard__content"><p>母评论</p></div></div>'), body);
  assert.ok(body.includes('<div class="mycard mycard--reply"><div class="mycard__content"><p>回复一</p></div></div>'), body);
  assert.ok(body.includes('<div class="mycard mycard--reply"><div class="mycard__meta"><span class="mycard__replyto">回复内容已删除</span></div><div class="mycard__content"><p>孤立回复</p></div></div>'), body);
});

test('a threaded discussion survives publication and GET byte for byte', () => {
  const image = `/images/articles/${randomUUID()}.webp`;
  const value = threaded({ commentImages: [[image], [], []] });
  validateArticle(value, catalog);
  const body = publicBody('<p>正文</p>', value.comments, [image], value.presentation, value.commentImages, [], value.commentKinds, value.commentOrphans);
  const document = readDocument(writeDocument(value, body, null, { articleId: randomUUID(), date: '2026-10-29T00:00:00Z' }));
  const read = articleFields(document);
  assert.equal(read.presentation, 'threaded');
  assert.deepEqual(read.comments, value.comments);
  assert.deepEqual(read.commentImages, value.commentImages);
  assert.deepEqual(read.commentKinds, value.commentKinds);
  assert.deepEqual(read.commentOrphans, value.commentOrphans);
  assert.equal(publicBody(read.html, read.comments, [image], read.presentation, read.commentImages, [], read.commentKinds, read.commentOrphans).trim(), body.trim());
});

test('threaded structure is refused when it is inconsistent or used outside an article', () => {
  for (const value of [
    threaded({ section: undefined }),
    threaded({ commentKinds: ['card', 'reply'] }),
    threaded({ commentKinds: ['card', 'reply', 'bubble'] }),
    threaded({ commentOrphans: [false, false] }),
    threaded({ commentOrphans: [true, false, true] }),
    threaded({ commentOrphans: ['true', false, true] }),
    { ...fixture(), commentKinds: ['card'] },
    { ...fixture(), commentOrphans: [false] },
  ]) assert.throws(() => validateArticle(value, catalog), { status: 400 });
});

test('a tampered reply bubble or discussion title refuses a lossy continuation', () => {
  const value = threaded();
  const body = publicBody('<p>正文</p>', value.comments, [], value.presentation, value.comments.map(() => []), [], value.commentKinds, value.commentOrphans);
  const bytes = writeDocument(value, body, null, { articleId: randomUUID(), date: '2026-10-29T00:00:00Z' }).toString();
  for (const source of [
    bytes + '\n额外的网站内容',
    bytes.replace('评论交流区', '讨论摘录'),
    bytes.replace('<span class="mycard__replyto">回复内容已删除</span>', '<span class="mycard__replyto">回复 母评论</span>'),
    bytes.replace('<div class="mycard mycard--reply"><div class="mycard__content"><p>回复一</p>', '<div class="mycard mycard--reply" data-private="x"><div class="mycard__content"><p>回复一</p>'),
  ]) assert.throws(() => articleFields(readDocument(Buffer.from(source))), { status: 409 }, source.slice(-120));
});

test('the original publication date and source link become the archive sidebar fields', () => {
  const value = threaded({ originalDate: '1969（附 2006 年导言）', sourceUrl: 'https://example.org/original' });
  validateArticle(value, catalog);
  const body = publicBody('<p>正文</p>', value.comments, [], value.presentation, value.comments.map(() => []), [], value.commentKinds, value.commentOrphans);
  const document = readDocument(writeDocument(value, body, null, { articleId: randomUUID(), date: '2026-10-29T00:00:00Z' }));
  assert.equal(document.metadata.original_date, '1969（附 2006 年导言）');
  assert.equal(document.metadata.original_url, 'https://example.org/original');
  const read = articleFields(document);
  assert.equal(read.originalDate, '1969（附 2006 年导言）');
  assert.equal(read.sourceUrl, 'https://example.org/original');
});

test('an unsafe or malformed original source link is refused', () => {
  for (const sourceUrl of ['http://example.org/x', 'javascript:alert(1)', 'https://example.org/x?a=1 ', '', 'https://10.0.0.1/x']) {
    assert.throws(() => validateArticle(threaded({ sourceUrl }), catalog), { status: 400 }, sourceUrl);
  }
  assert.throws(() => validateArticle(threaded({ originalDate: '1969\n1970' }), catalog), { status: 400 });
});

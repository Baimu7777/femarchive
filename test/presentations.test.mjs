import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { publicBody, readDocument, writeDocument, articleFields, validateArticle } from '../publishing/lib/document.mjs';
import { fixture, catalog } from './helpers.mjs';

const modes = [
  ['article', '<p>First'], ['cards', '<div class="mycard"><div class="mycard__content">'],
  ['discussion', '<div class="mycard mycard--reply"><div class="mycard__content">'],
  ['quote', '<blockquote class="quote"><div class="quote-content">'], ['centered', '<blockquote class="quote-center">'],
  ['grouped', '<section class="language-discussion-group"><h3>讨论摘录</h3>'],
  ['highlight', '<div class="text-highlight text-highlight--block">'], ['folded', '<details><summary>摘录 1</summary>'],
];
for (const [presentation, markup] of modes) test(`${presentation} keeps selected text and images structured across publication and GET`, () => {
  const image = `/images/articles/${randomUUID()}.webp`, comments = ['First & <literal>\nSecond {{< detail >}}', ''];
  const value = { ...fixture(), presentation, comments, commentImages: [[image], [image]] };
  validateArticle(value, catalog);
  const body = publicBody('<p>Article body</p>', comments, [image], presentation, value.commentImages);
  assert.ok(body.includes(markup), body); assert.ok(!body.includes('{{< detail >}}'));
  const document = readDocument(writeDocument(value, body, null, { articleId: randomUUID(), date: '2026-10-25T00:00:00Z' }));
  const read = articleFields(document);
  assert.equal(read.presentation, presentation); assert.deepEqual(read.comments, comments); assert.deepEqual(read.commentImages, [[image], [image]]);
  assert.match(read.html, /Article body/); assert.doesNotMatch(read.html, /First|literal|Second/); assert.ok(!read.html.includes(image));
  assert.equal(publicBody(read.html, read.comments, [image], read.presentation, read.commentImages).trim(), body.trim());
});

test('structured presentation extraction refuses unknown attributes or trailing website content', () => {
  for (const [presentation] of modes) {
    const value = { ...fixture(), presentation };
    const body = publicBody('', value.comments, [], presentation);
    const bytes = writeDocument(value, body, null, { articleId: randomUUID(), date: '2026-10-25T00:00:00Z' });
    for (const source of [bytes.toString() + '\nAdditional website content', bytes.toString().replace('<p>公开摘录</p>', '<p data-private="private">公开摘录</p>')]) {
      assert.throws(() => articleFields(readDocument(Buffer.from(source))), { status: 409 }, presentation);
    }
  }
});

test('website quote and folded layouts without a receiver boundary refuse a lossy edit', () => {
  for (const [presentation, body] of [
    ['quote', '<blockquote class="quote"><p>Website excerpt</p></blockquote>'],
    ['folded', '<details><summary>Website heading</summary><p>Website excerpt</p></details>'],
  ]) {
    const source = `---\ntitle: Website content\npublication_layout: ${presentation}\n---\n${body}\n`;
    assert.throws(() => articleFields(readDocument(Buffer.from(source))), { status: 409 });
  }
});

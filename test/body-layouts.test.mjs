import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { publicBody, articleFields, readDocument, writeDocument, assertNoPrivateValues } from '../publishing/lib/document.mjs';
import { fixture } from './helpers.mjs';

const image = '/images/articles/550e8400-e29b-41d4-a716-446655440000.webp';
const modes = [
  ['card', 'div', 'mycard', '<div class="mycard__content">'],
  ['reply', 'div', 'mycard mycard--reply', '<div class="mycard__content">'],
  ['quote', 'blockquote', 'quote', '<div class="quote-content">'],
  ['centered', 'blockquote', 'quote-center', '<p>'],
  ['grouped', 'section', 'language-discussion-group', '<h3>讨论摘录</h3>'],
  ['highlight', 'div', 'text-highlight--block', '<p>'],
  ['folded', 'details', '', '<summary>展开内容</summary>'],
];

// Catch a layout applied only to appended excerpts instead of editor body.
for (const [mode, tag, classes, content] of modes) test(`${mode} renders the selected body region with actual website structure`, () => {
  const html = `<p>Before</p><div data-publication-layout="${mode}"><p>Selected <strong>body</strong></p><p><img src="${image}" alt="picture" data-width="50" data-align="right"></p><p>Second paragraph</p></div><p>After</p>`;
  const result = publicBody(html, [], [image]);
  assert.ok(result.includes(`<${tag} data-publication-layout="${mode}"${classes ? ` class="${classes}"` : ''}>${content}`), result);
  assert.match(result, /Selected <strong>body<\/strong>/);
  assert.match(result, /Second paragraph/);
  assert.match(result, /data-width="50" data-align="right" style="width:50%;display:block;margin-left:auto;margin-right:0"/);
  assert.ok(result.indexOf('Before') < result.indexOf('Selected'));
  assert.ok(result.indexOf('Second paragraph') < result.indexOf('After'));
});

test('mixed nested body layouts and image structure survive GET and title-only update with a legacy footer', () => {
  const html = `<h2>Heading</h2><div data-publication-layout="grouped" data-title="A &amp; B"><p>First</p><div data-publication-layout="reply"><p>Reply</p><p><img src="${image}" alt="nested image" data-width="75" data-align="center"></p></div><div data-publication-layout="folded" data-title="More"><p>Second</p></div></div><p>End</p>`;
  const value = { ...fixture(), html, presentation: 'quote' };
  const body = publicBody(html, value.comments, [image], value.presentation);
  const bytes = writeDocument(value, body, null, { articleId: randomUUID(), date: '2026-10-25T00:00:00Z' });
  const read = articleFields(readDocument(bytes));
  assert.match(read.html, /data-publication-layout="grouped" data-title="A &amp; B"/);
  assert.match(read.html, /data-publication-layout="reply"/);
  assert.match(read.html, /data-publication-layout="folded" data-title="More"/);
  assert.match(read.html, /alt="nested image" data-width="75" data-align="center"/);
  assert.doesNotMatch(read.html, /class=|style=|mycard|quote-content/);
  const updatedBody = publicBody(read.html, read.comments, [image], read.presentation);
  const updated = writeDocument({ ...value, title: 'Updated title' }, updatedBody, bytes, {});
  assert.equal(readDocument(updated).body.trim(), body.trim());
  assert.deepEqual(read.comments, value.comments);
});

test('canonical body markers reject unknown modes, attributes, invalid titles and unauthorized images', () => {
  for (const html of [
    '<div data-publication-layout="unknown"><p>Body</p></div>',
    '<div data-publication-layout="card" class="mycard"><p>Body</p></div>',
    '<div data-publication-layout="card" style="color:red"><p>Body</p></div>',
    '<div data-publication-layout="card" onclick="alert(1)"><p>Body</p></div>',
    `<div data-publication-layout="folded" data-title="${'x'.repeat(101)}"><p>Body</p></div>`,
    '<section data-publication-layout="card"><p>Body</p></section>',
    '<div data-publication-layout="card"><p>Body</p>',
    '<div data-publication-layout="card" data-publication-layout="reply"><p>Body</p></div>',
    '<div data-publication-layout="card" data-title="First" data-title="Second"><p>Body</p></div>',
    `<div data-publication-layout="card"><img src="${image}"></div>`,
  ]) assert.throws(() => publicBody(html, [], []), { status: 400 }, html);
});

test('generated body edits with unknown wrapper or content attributes fail closed on GET', () => {
  const body = publicBody('<div data-publication-layout="card"><p>Body</p></div>', [], []);
  for (const altered of [
    body.replace('class="mycard"', 'class="mycard" data-website="keep"'),
    body.replace('class="mycard__content"', 'class="mycard__content extra"'),
    body.replace('<p>Body</p>', '<p data-website="keep">Body</p>'),
    body.replace('</p>', '</p><aside>Website addition</aside>'),
    body.replace('data-publication-layout="card"', 'data-publication-layout="unknown"'),
    body.replace(' data-publication-layout="card"', ''),
  ]) assert.throws(() => articleFields({ body: altered, metadata: { title: 'Title' } }), { status: 409 }, altered);
});

test('body title attributes escape HTML and Hugo syntax and retain privacy validation', () => {
  const html = '<div data-publication-layout="folded" data-title="&quot;&lt;script&gt;{{&lt; x &gt;}}"><p>Body</p></div>';
  const body = publicBody(html, [], []);
  assert.match(body, /data-title="&quot;&lt;script&gt;&#123;&#123;&lt; x &gt;&#125;&#125;"/);
  assert.doesNotMatch(body, /<script>|\{\{/);
  const read = articleFields({ body, metadata: { title: 'Title' } });
  assert.equal(publicBody(read.html, [], []), body);
  const forbidden = randomUUID();
  const escaped = [...forbidden].map(c => `&#${c.charCodeAt(0)};`).join('');
  assert.throws(() => assertNoPrivateValues({ ...fixture(), html: `<div data-publication-layout="folded" data-title="${escaped}">Body</div>` }, [forbidden]), { status: 400 });
});


for (const tone of ['', ' data-tone="warm"']) for (const heading of ['', ' data-heading="none"']) test(`group metadata survives website write/read and title-only update: ${tone} ${heading}`, () => {
  const html = `<h4>条目</h4><div data-publication-layout="grouped" data-title="补充讨论"${tone}${heading}><div data-publication-layout="card"><p>正文</p></div></div>`;
  const value = { ...fixture(), html, comments: [] };
  const body = publicBody(html, [], []);
  assert.ok(body.includes(`class="language-discussion-group${tone ? ' language-discussion-group--warm' : ''}"`));
  assert.equal(body.includes('<h3>补充讨论</h3>'), !heading);
  const bytes = writeDocument(value, body, null, { articleId: randomUUID(), date: '2026-10-25T00:00:00Z' });
  const read = articleFields(readDocument(bytes));
  assert.equal(read.html.replace(/>\s+</g, "><").trim(), html);
  const updatedBody = publicBody(read.html, [], []);
  assert.equal(updatedBody, body);
  const updated = writeDocument({ ...value, title: '新标题' }, updatedBody, bytes, {});
  assert.equal(readDocument(updated).body.trim(), body.trim());
  for (const altered of [body.replace('class="language-discussion-group', 'class="unexpected language-discussion-group'), body.replace('data-title="补充讨论"', 'data-title="补充讨论" data-tone="red"')]) {
    assert.throws(() => articleFields({ body: altered, metadata: { title: 'Title' } }), { status: 409 });
  }
});

test('rejects unknown or unsupported group color and heading metadata', () => {
  for (const marker of [
    'data-publication-layout="grouped" data-tone="red"',
    'data-publication-layout="grouped" data-tone=""',
    'data-publication-layout="card" data-tone="warm"',
    'data-publication-layout="folded" data-heading="none"',
    'data-publication-layout="grouped" data-heading="hidden"',
    'data-publication-layout="grouped" data-tone="warm" data-tone="warm"',
  ]) assert.throws(() => publicBody(`<div ${marker}><p>正文</p></div>`, [], []), { status: 400 });
});

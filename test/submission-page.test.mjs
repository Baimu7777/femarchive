import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { serializeSubmission, withoutPictures } from '../submission/document.mjs';
import { imageSelectionError, isImageSelection } from '../submission/images.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const limits = { imageBytes: 4 * 1024 * 1024, imagePixels: 40_000_000 };

test('the committed editor bundle is the one built from submission/', async t => {
  let buildSubmission;
  try { ({ buildSubmission } = await import('../scripts/build-submission.mjs')); await import('esbuild'); }
  catch { t.skip('development dependencies are not installed'); return; }
  assert.equal(await read('static/js/submission.js'), await buildSubmission(), 'run `npm run build:submission` and commit static/js/submission.js');
});

test('only pictures chosen on the page are sent, by the receiver\'s identifier alone', () => {
  const html = '<p>文字</p><img src="blob:http://x/1" alt="说明 &quot;一&quot;" data-local-id="a" class="post-image"><img src="https://tracker.example/p.gif"><img data-local-id="b" src="blob:http://x/2">';
  assert.deepEqual(serializeSubmission(html).localIds, ['a', 'b']);
  const sent = serializeSubmission(html, new Map([['a', '11111111-1111-4111-8111-111111111111']])).html;
  assert.equal(sent, '<p>文字</p><img data-submission-image="11111111-1111-4111-8111-111111111111" alt="说明 &quot;一&quot;">');
  assert.ok(!sent.includes('blob:') && !sent.includes('tracker.example'));
  assert.equal(withoutPictures(html), '<p>文字</p>');
});

test('unsupported picture selections are explained before any upload', () => {
  const file = (name, type, size = 1000) => ({ name, type, size });
  assert.equal(imageSelectionError(file('a.png', 'image/png'), limits), null);
  assert.equal(imageSelectionError(file('a.JPG', ''), limits), null);
  assert.match(imageSelectionError(file('a.heic', 'image/heic'), limits), /HEIC/u);
  assert.match(imageSelectionError(file('a.svg', 'image/svg+xml'), limits), /不是支持的/u);
  assert.match(imageSelectionError(file('a.png', 'image/png', 21 * 1024 * 1024), limits), /超过 20 MB/u);
  assert.match(imageSelectionError(file('a.gif', 'image/gif', 5 * 1024 * 1024), limits), /GIF/u);
  assert.equal(isImageSelection(file('notes.txt', 'text/plain')), false);
});

test('the page keeps the email and form it had until a receiver is configured', async () => {
  const [layout, content, config] = await Promise.all([read('layouts/_default/submission.html'), read('content/submission-guidelines.md'), read('config/_default/hugo.toml')]);
  assert.match(content, /^layout: "submission"$/mu);
  assert.match(content, /quannv\.feedback@gmail\.com/u);
  assert.match(layout, /\{\{ if \$endpoint \}\}[\s\S]*data-submission[\s\S]*\{\{ else \}\}[\s\S]*docs\.google\.com\/forms[\s\S]*\{\{ end \}\}/u);
  assert.match(config, /\[params\.submission\]\s+endpoint = "[^"]*"/u);
});

test('the content policy allows local previews and the configured receiver', async () => {
  const [vercel, config] = await Promise.all([read('vercel.json').then(JSON.parse), read('config/_default/hugo.toml')]);
  const policy = vercel.headers.find(rule => rule.source === '/(.*)').headers.find(header => header.key === 'Content-Security-Policy').value;
  const directive = name => policy.split(';').map(part => part.trim().split(/\s+/u)).find(([key]) => key === name)?.slice(1) ?? [];
  assert.ok(directive('img-src').includes('blob:'), 'picture previews before upload');
  const endpoint = /\[params\.submission\]\s+endpoint = "([^"]*)"/u.exec(config)[1];
  if (endpoint) assert.ok(directive('connect-src').includes(new URL(endpoint).origin), 'add the receiver to connect-src in vercel.json');
});

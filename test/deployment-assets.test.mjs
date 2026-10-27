import test from 'node:test';
import assert from 'node:assert/strict';
import { externalizeImages } from '../scripts/optimize-deployment.mjs';

test('archive images can be restored byte for byte without changing surrounding HTML', () => {
  const bytes = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(2048, 42)]);
  const uri = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const html = `<p>原文 &amp; 排版</p><img src="${uri}"><style>.avatar{background:url('${uri}')}</style>`;
  const saved = new Map();
  const optimized = externalizeImages(html, (name, value) => saved.set(name, value));
  assert.equal(saved.size, 1);
  const [name, value] = [...saved][0];
  assert.deepEqual(value, bytes);
  assert.equal(optimized.replaceAll(`/allsis/media/${name}`, uri), html);
});

test('octet-stream WebP gets its actual image type; unknown and tiny data stays inline', () => {
  const bytes = Buffer.alloc(2048);
  bytes.write('RIFF');
  bytes.write('WEBP', 8);
  const uri = `data:application/octet-stream;base64,${bytes.toString('base64')}`;
  const output = externalizeImages(`<img src="${uri}">`, name => assert.match(name, /\.webp$/));
  assert.match(output, /src="\/allsis\/media\//);
  for (const original of ['data:image/png;base64,YQ==', `data:application/octet-stream;base64,${Buffer.alloc(2048).toString('base64')}`]) {
    assert.equal(externalizeImages(original, () => assert.fail('unexpected extraction')), original);
  }
});

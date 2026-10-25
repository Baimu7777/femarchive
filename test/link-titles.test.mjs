import test from 'node:test';
import assert from 'node:assert/strict';
import { pageTitle, bareLinks, publicAddress, publicUrl, fetchTitle } from '../scripts/link-titles.mjs';
test('extracts metadata title, decodes entities and falls back to title', () => {
  assert.equal(pageTitle('<title>Other</title><meta content=" A &amp; B " property="og:title">'), 'A & B');
  assert.equal(pageTitle('<title> A\n B </title>'), 'A B');
  assert.equal(pageTitle('<title>Just a moment...</title>'), null);
  assert.equal(pageTitle('<p>No title</p>'), null);
});
test('only discovers bare URL labels, preserving authored labels', () => {
  assert.deepEqual(bareLinks('[https://example.org/a](<https://example.org/a>) [Custom](https://other.org/)'), ['https://example.org/a']);
  assert.deepEqual(bareLinks('[https://example.org/a\\_b](<https://example.org/a_b>)'), ['https://example.org/a_b']);
});
test('blocks private and special networks and credentialed URLs', () => {
  for (const address of ['127.0.0.1','10.1.1.1','169.254.169.254','192.168.1.1','172.16.0.1','100.64.0.1','::1','198.18.0.1']) assert.equal(publicAddress(address),false);
  assert.equal(publicAddress('8.8.8.8'),true);
  for (const url of ['http://example.org','https://user:pass@example.org','https://127.0.0.1','https://example.org:8443']) assert.throws(()=>publicUrl(url));
});
test('failed or cancelled fetches gracefully retain URL labels', async () => {
  assert.equal(await fetchTitle('http://localhost/'),null);
  assert.equal(await fetchTitle('https://example.org/',AbortSignal.abort()),null);
});

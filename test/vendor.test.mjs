/** The committed sanitizer bundle must stay a faithful build of the pinned
 * dependency. Without this check the vendored file could drift away from
 * package.json and silently ship an older sanitizer than the one declared.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let builder;
// esbuild is only needed to regenerate the bundle, so an install that omits
// development dependencies skips this check instead of failing.
try { require.resolve('esbuild'); builder = await import('../scripts/build-vendor.mjs'); } catch { builder = null; }

test('committed sanitizer bundle matches a fresh build of the pinned version', { skip: builder ? false : 'esbuild is not installed' }, async () => {
  assert.equal(await builder.buildVendor(), await readFile(builder.vendorPath, 'utf8'));
});

let forumRoot;
try {
  const manifest = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  if (manifest.name === 'co-governed-discussion-platform') forumRoot = fileURLToPath(new URL('../../../', import.meta.url));
} catch { /* The receiver can also be installed as a standalone website package. */ }
test('root and standalone dependency layouts produce the same sanitizer bundle', { skip: builder && forumRoot ? false : 'forum dependencies are not installed' }, async () => {
  assert.equal(await builder.buildVendor(forumRoot), await builder.buildVendor());
});

test('the bundle carries the sanitizer the manifest pins and no ESM require', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const pinned = manifest.devDependencies?.['sanitize-html'] ?? manifest.dependencies?.['sanitize-html'];
  assert.equal(pinned, require('sanitize-html/package.json').version, 'Rebuild the bundle after changing the pinned sanitizer');
  const bundle = await readFile(new URL('../publishing/vendor/sanitize-html.cjs', import.meta.url), 'utf8');
  assert.ok(!/\brequire\(["']htmlparser2["']\)/.test(bundle), 'The parser must be inlined, not required at runtime');
});

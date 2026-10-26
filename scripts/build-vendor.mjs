/** Regenerates publishing/vendor/sanitize-html.cjs.
 *
 * sanitize-html is CommonJS and requires htmlparser2, which is ESM only. The
 * deployment runtime starts Node with --no-experimental-require-module, so that
 * require fails there even though it works locally. Bundling the sanitizer to a
 * single CommonJS file removes the ESM require without downgrading it: the
 * versions this file is built from stay exactly the ones package.json pins.
 *
 * Run `npm run build:vendor` after changing the sanitizer or esbuild version,
 * and commit the result. test/vendor.test.mjs fails if the two drift apart.
 */
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const vendorPath = new URL('../publishing/vendor/sanitize-html.cjs', import.meta.url);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export async function buildVendor(resolveDir = packageRoot) {
  const result = await build({
    stdin: { contents: "module.exports = require('sanitize-html');\n", resolveDir, sourcefile: fileURLToPath(new URL('../vendor-entry.cjs', import.meta.url)), loader: 'js' },
    absWorkingDir: packageRoot,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', legalComments: 'eof', write: false,
  });
  // esbuild labels each bundled module with its path relative to the package
  // root. The installed website holds its dependencies there, while the forum
  // checkout resolves them from the repository root, so the labels would differ
  // between the two copies. Normalise them to keep the file reproducible.
  return result.outputFiles[0].text.replace(/(?:\.\.\/)+node_modules\//g, 'node_modules/')
    .replace(/node_modules\/(?:[^/]+\/node_modules\/)+/g, 'node_modules/');
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  await writeFile(vendorPath, await buildVendor());
  console.log(`已重新生成 ${fileURLToPath(vendorPath)}`);
}

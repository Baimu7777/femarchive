/** Regenerates static/js/submission.js from submission/editor.mjs.
 *
 * The site is deployed with `npm ci --omit=dev` and no bundler step, so the
 * editor is committed as one built file, like the sanitizer in
 * publishing/vendor. Run `npm run build:submission` after changing anything in
 * submission/ and commit the result; test/submission-page.test.mjs fails if
 * the two drift apart.
 */
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const bundlePath = new URL('../static/js/submission.js', import.meta.url);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

export async function buildSubmission() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../submission/editor.mjs', import.meta.url))],
    absWorkingDir: packageRoot,
    bundle: true, format: 'iife', platform: 'browser', target: ['es2020'], minify: true, legalComments: 'eof', write: false,
  });
  return result.outputFiles[0].text;
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  await writeFile(bundlePath, await buildSubmission());
  console.log(`已重新生成 ${fileURLToPath(bundlePath)}`);
}

/** Deployment entry contract: the disabled receiver must stay reachable even
 * when the runtime cannot load the native image module, and the public
 * vocabulary must not be read from the filesystem at import time. A child
 * process with a resolver hook stands in for the deployment runtime, because an
 * in-process import would already hold the real module graph.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { token } from './helpers.mjs';

const configured = { WEBSITE_PUBLISHING_ENABLED: 'true', WEBSITE_PUBLISHING_TOKEN: token, WEBSITE_GITHUB_TOKEN: 'synthetic', WEBSITE_GITHUB_OWNER: 'site-owner', WEBSITE_GITHUB_REPO: 'site-repo', WEBSITE_GITHUB_BRANCH: 'main', WEBSITE_PUBLIC_ORIGIN: 'https://website.example', WEBSITE_R2_ENDPOINT: 'https://synthetic.r2.cloudflarestorage.com', WEBSITE_R2_BUCKET: 'website-private', WEBSITE_R2_ACCESS_KEY_ID: 'synthetic', WEBSITE_R2_SECRET_ACCESS_KEY: 'synthetic' };
const unavailable = { error: 'UNAVAILABLE', message: 'Publishing unavailable.' };

const directory = mkdtempSync(join(tmpdir(), 'publisher-entry-'));
const hook = join(directory, 'no-image-module.mjs');
writeFileSync(hook, `export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sharp') throw new Error('Synthetic unavailable image module');
  return nextResolve(specifier, context);
}
`);
const probe = join(directory, 'probe.mjs');
writeFileSync(probe, `import { register } from 'node:module';
register(${JSON.stringify(pathToFileURL(hook).href)});
const entry = await import(${JSON.stringify(new URL('../api/publishing.mjs', import.meta.url).href)});
const env = JSON.parse(process.argv[2]);
const url = operation => 'https://website.example/api/publishing?operation=' + operation;
const read = async response => ({ status: response.status, body: await response.json() });
const receive = entry.createConfiguredReceiver(env, { fetch: () => { throw new Error('Real network forbidden in the entry probe'); } });
const result = { fetchHandler: typeof entry.default?.fetch };
result.handler = await read(await entry.default.fetch(new Request(url('catalog'), { headers: { authorization: 'Bearer ' + ${JSON.stringify(token)} } })));
result.catalog = await read(await receive(new Request(url('catalog'), { headers: { authorization: 'Bearer ' + ${JSON.stringify(token)} } })));
result.asset = await read(await receive(new Request(url('asset'), { method: 'POST', headers: { authorization: 'Bearer ' + ${JSON.stringify(token)}, 'content-type': 'image/webp', 'idempotency-key': '2f1c1d0e-8a4b-4c9d-9e7f-0a1b2c3d4e5f', 'x-publishing-confirmed': '1' }, body: new Uint8Array([82, 73, 70, 70]) })));
process.stdout.write(JSON.stringify(result));
`);

// The deployment runtime never carries the sender's configuration, so the
// entry point is probed without any website variable in the real environment.
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('WEBSITE_')));
const run = env => JSON.parse(execFileSync(process.execPath, [probe, JSON.stringify(env)], { env: environment, encoding: 'utf8' }));

test('entry point imports and answers without configuration when the image module is unavailable', () => {
  const result = run({});
  assert.equal(result.fetchHandler, 'function');
  assert.deepEqual(result.handler, { status: 503, body: unavailable });
  assert.deepEqual(result.catalog, { status: 503, body: unavailable });
  assert.deepEqual(result.asset, { status: 503, body: unavailable });
});

test('configured non-image operations keep working while image publishing fails closed', () => {
  const result = run(configured);
  assert.equal(result.catalog.status, 200);
  assert.ok(result.catalog.body.categories.includes('思考讨论'), 'the static vocabulary is served without a data file read');
  assert.deepEqual(result.asset, { status: 503, body: unavailable });
  assert.deepEqual(result.handler, { status: 503, body: unavailable });
});

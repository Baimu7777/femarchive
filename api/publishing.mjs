import { readFileSync } from 'node:fs';
import { S3Client } from '@aws-sdk/client-s3';
import { createReceiver } from '../publishing/lib/receiver.mjs';
import { createGitHubRepository, validateGitConfig } from '../publishing/lib/github.mjs';
import { createReceipts, createR2Objects } from '../publishing/lib/receipts.mjs';
import { failure } from '../publishing/lib/errors.mjs';

const catalog = JSON.parse(readFileSync(new URL('../publishing/catalog.json', import.meta.url), 'utf8'));
const required = ['WEBSITE_PUBLISHING_TOKEN', 'WEBSITE_GITHUB_TOKEN', 'WEBSITE_GITHUB_OWNER', 'WEBSITE_GITHUB_REPO', 'WEBSITE_GITHUB_BRANCH', 'WEBSITE_PUBLIC_ORIGIN', 'WEBSITE_R2_ENDPOINT', 'WEBSITE_R2_BUCKET', 'WEBSITE_R2_ACCESS_KEY_ID', 'WEBSITE_R2_SECRET_ACCESS_KEY'];
export function createConfiguredReceiver(env, { fetch: transport = globalThis.fetch } = {}) {
  try {
    if (env.WEBSITE_PUBLISHING_ENABLED !== 'true' || required.some(k => typeof env[k] !== 'string' || !env[k].trim() || /[\r\n]/.test(env[k]))) return () => failure(503);
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(env.WEBSITE_PUBLISHING_TOKEN)) return () => failure(503);
    const config = { owner: env.WEBSITE_GITHUB_OWNER, repo: env.WEBSITE_GITHUB_REPO, branch: env.WEBSITE_GITHUB_BRANCH, publicOrigin: env.WEBSITE_PUBLIC_ORIGIN };
    validateGitConfig(config);
    const endpoint = new URL(env.WEBSITE_R2_ENDPOINT);
    if (endpoint.origin !== env.WEBSITE_R2_ENDPOINT || endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || !/^[a-z0-9-]+\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.WEBSITE_R2_BUCKET)) return () => failure(503);
    const client = new S3Client({ endpoint: endpoint.origin, region: 'auto', maxAttempts: 1, followRegionRedirects: false, credentials: { accessKeyId: env.WEBSITE_R2_ACCESS_KEY_ID, secretAccessKey: env.WEBSITE_R2_SECRET_ACCESS_KEY }, requestHandler: { connectionTimeout: 5000, requestTimeout: 20000 } });
    return createReceiver({ token: env.WEBSITE_PUBLISHING_TOKEN, catalog, repository: createGitHubRepository({ ...config, token: env.WEBSITE_GITHUB_TOKEN, fetch: transport }), receipts: createReceipts(createR2Objects({ client, bucket: env.WEBSITE_R2_BUCKET })) });
  } catch { return () => failure(503); }
}

// Vercel Node.js Web Standard entry point. No Next.js dependency, background
// task, logging, cookie handling, import-time network activity or retry loop.
const handler = {
  async fetch(request) { return createConfiguredReceiver(process.env)(request); },
};
export default handler;

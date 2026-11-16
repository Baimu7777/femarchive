/**
 * Runs the receiver on this machine for a preview, with an in-memory bucket
 * and SQLite file. The human check always passes here, which is why this file
 * is not the Worker's entry point and is never deployed.
 *
 *   node deploy/submission-worker/local/server.mjs
 */
import { createServer } from 'node:http';
import { createWorker } from '../worker.mjs';
import { localBucket, localDatabase } from './bindings.mjs';

const port = Number(process.env.PORT ?? 8788);
const env = {
  DB: localDatabase(process.env.SUBMISSIONS_DB ?? ':memory:'), BUCKET: localBucket(),
  ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? 'local-preview-admin-token-0123456789abcdef',
  SOURCE_HASH_KEY: 'local-preview-source-key-0123456789abcdef', SESSION_KEY: 'local-preview-session-key-0123456789abcdef',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? 'http://localhost:1313',
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:LIMIT_|RETENTION_|BAN_)/u.test(name))),
};
let address = '127.0.0.1';
const worker = createWorker({ verifyTurnstile: async () => true, addressOf: request => request.headers.get('x-preview-address') ?? address });

createServer(async (incoming, outgoing) => {
  address = incoming.socket.remoteAddress ?? '127.0.0.1';
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(name, value);
  const response = await worker.fetch(new Request(`http://localhost:${port}${incoming.url}`, {
    method: incoming.method, headers, body: body.length ? body : undefined,
  }), env);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`submission receiver preview on http://localhost:${port}`));

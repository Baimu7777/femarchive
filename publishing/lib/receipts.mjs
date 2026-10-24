import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { fail, uuid } from './errors.mjs';

// Website-private immutable records only. No TTL: expiring a reservation would
// make a timeout replay capable of allocating a second public path.
export function createReceipts(objects) {
  async function once(key, value) {
    if (await objects.putIfAbsent(key, value)) return value;
    const existing = await objects.get(key);
    if (!existing) fail(503);
    return existing;
  }
  return {
    async reserve(kind, key, digest, allocate) {
      if (!['asset', 'publish'].includes(kind) || !uuid(key) || !/^[a-f0-9]{64}$/.test(digest)) fail();
      const path = `requests/${kind}/${key}`;
      let record = await objects.get(path);
      if (!record) record = await once(path, { digest, plan: await allocate() });
      if (record.digest !== digest) fail(409);
      return record.plan;
    },
    getCandidate: (kind, key) => objects.get(`candidates/${kind}/${key}`),
    saveCandidate: (kind, key, candidate) => once(`candidates/${kind}/${key}`, candidate),
    getResult: (kind, key) => objects.get(`results/${kind}/${key}`),
    saveResult: (kind, key, result) => once(`results/${kind}/${key}`, result),
    getArticle: id => { if (!uuid(id)) fail(); return objects.get(`articles/${id}`); },
    saveArticle: (id, record) => { if (!uuid(id)) fail(); return once(`articles/${id}`, record); },
    getAsset: id => { if (!uuid(id)) fail(); return objects.get(`assets/${id}`); },
    saveAsset: (id, record) => { if (!uuid(id)) fail(); return once(`assets/${id}`, record); },
    async isPrivateIdentifier(id) {
      if (!uuid(id)) fail();
      // Point lookups only: no bucket listing, forum context or private record
      // contents escape this boolean boundary. Public article IDs are excluded.
      for (const namespace of ['assets', 'requests/asset', 'requests/publish', 'candidates/asset', 'candidates/publish', 'results/asset', 'results/publish']) {
        if (await objects.get(`${namespace}/${id}`) !== null) return true;
      }
      // Storage errors propagate so a failed check is never treated as absence.
      return false;
    },
  };
}

// Only the SDK client (remote transport) is injectable. Conditional PutObject is
// the cross-invocation reservation, not a process-local Map or check-then-write.
export function createR2Objects({ client, bucket }) {
  return {
    async get(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `publishing/v1/${key}` }));
        // Records are small: a corrupt/misconfigured bucket must fail closed.
        if (result.ContentLength > 32768) fail(503);
        const text = await result.Body.transformToString();
        if (Buffer.byteLength(text) > 32768) fail(503);
        return JSON.parse(text);
      } catch (error) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async putIfAbsent(key, value) {
      try {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: `publishing/v1/${key}`, Body: JSON.stringify(value), ContentType: 'application/json', CacheControl: 'no-store', IfNoneMatch: '*' }));
        return true;
      } catch (error) {
        if (error.name === 'PreconditionFailed' || error.$metadata?.httpStatusCode === 412) return false;
        // An uncertain write is NOT absence. Return a generic 503; the next
        // explicit caller retry will read the reservation that may have won.
        throw error;
      }
    },
  };
}

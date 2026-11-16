/**
 * Stand-ins for the Worker's D1 and R2 bindings, for tests and for running
 * the receiver on a laptop. D1 is SQLite, so the statements run unchanged on
 * Node's own SQLite; nothing here is deployed.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

export function localDatabase(path = ':memory:') {
  const database = new DatabaseSync(path);
  database.exec(schema);
  let reads = 0, writes = 0;
  function statement(sql, values = []) {
    const run = () => database.prepare(sql);
    const writing = /^\s*(?:INSERT|UPDATE|DELETE)/iu.test(sql);
    const count = () => { if (writing) writes += 1; else reads += 1; };
    return {
      bind: (...next) => statement(sql, next),
      async first() { count(); return run().get(...values) ?? null; },
      async all() { count(); return { results: run().all(...values) }; },
      async run() { count(); const result = run().run(...values); return { meta: { changes: Number(result.changes) } }; },
      execute() { count(); return /\bRETURNING\b|^\s*SELECT/iu.test(sql) ? { results: run().all(...values) } : { meta: { changes: Number(run().run(...values).changes) } }; },
    };
  }
  return {
    prepare: sql => statement(sql),
    async batch(statements) {
      database.exec('BEGIN');
      try { const results = statements.map(item => item.execute()); database.exec('COMMIT'); return results; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    raw: database,
    operations: () => ({ reads, writes }),
  };
}

export function localBucket() {
  const objects = new Map();
  let writes = 0;
  return {
    async put(key, value, options = {}) {
      writes += 1;
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value.buffer ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value);
      objects.set(key, { bytes, contentType: options.httpMetadata?.contentType });
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        size: object.bytes.byteLength,
        httpMetadata: { contentType: object.contentType },
        arrayBuffer: async () => object.bytes.buffer.slice(object.bytes.byteOffset, object.bytes.byteOffset + object.bytes.byteLength),
        text: async () => new TextDecoder().decode(object.bytes),
      };
    },
    async delete(keys) { for (const key of [].concat(keys)) objects.delete(key); },
    keys: () => [...objects.keys()],
    bytes: () => [...objects.values()].reduce((sum, object) => sum + object.bytes.byteLength, 0),
    writes: () => writes,
  };
}

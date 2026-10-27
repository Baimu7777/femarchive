import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const fontHash = '39ad71264b588165b469e35e6afb162a378dacd1f95348160240ba9038ac3009';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Keep the original bytes: only remove base64 overhead and repeated copies.
// Unknown data types and small inline icons remain untouched.
export function externalizeImages(html, save) {
  return html.replace(/data:(image\/(?:jpeg|png|webp|gif)|application\/octet-stream);base64,([A-Za-z0-9+/=]+)/g, (url, mime, encoded) => {
    if (encoded.length < 1024) return url;
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) return url;
    let ext;
    if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ext = 'jpg';
    else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ext = 'png';
    else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') ext = 'webp';
    else if (/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) ext = 'gif';
    else return url;
    const name = `${digest(bytes)}.${ext}`;
    save(name, bytes);
    return `/allsis/media/${name}`;
  });
}

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

export function optimizeDeployment(output) {
  output = resolve(output);
  if (!existsSync(join(output, 'index.html'))) throw new Error('Expected a built Hugo output directory');
  const font = readFileSync(join(output, 'fonts', 'lxgw-wenkai.woff2'));
  if (font.toString('ascii', 0, 4) !== 'wOF2' || font.length < 48 || font.readUInt32BE(8) !== font.length) {
    throw new Error('Missing or incomplete compressed font');
  }
  const size = () => files(output).reduce((sum, path) => sum + statSync(path).size, 0);
  const before = size();
  const media = join(output, 'allsis', 'media');
  const written = new Set();
  let pages = 0;
  for (const path of files(join(output, 'allsis', 'topics')).filter(path => path.endsWith('.html'))) {
    const original = readFileSync(path, 'utf8');
    const updated = externalizeImages(original, (name, bytes) => {
      if (written.has(name)) return;
      mkdirSync(media, { recursive: true });
      writeFileSync(join(media, name), bytes);
      written.add(name);
    });
    if (updated !== original) {
      writeFileSync(path, updated);
      pages++;
    }
  }
  if (existsSync(join(output, 'fonts', 'lxgw-wenkai.woff2'))) {
    for (const name of ['霞鹜文楷.ttf', '#U971e#U9e5c#U6587#U6977.ttf']) {
      const path = join(output, 'fonts', name);
      if (existsSync(path) && digest(readFileSync(path)) === fontHash) unlinkSync(path);
    }
  }
  const after = size();
  console.log(JSON.stringify({ beforeBytes: before, afterBytes: after, savedBytes: before - after, pages, sharedImages: written.size }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  optimizeDeployment(process.argv[2] || 'public');
}

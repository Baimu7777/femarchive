import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { parseDocument } from 'htmlparser2';
import { marked } from 'marked';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function publicAddress(address) {
  if (isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}
export function publicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || isIP(url.hostname) || !url.hostname.includes('.')) throw new Error('Unsupported URL');
  return url;
}
const text = node => node.type === 'text' ? node.data : (node.children || []).map(text).join('');
export function pageTitle(html) {
  let og = '', title = '';
  const visit = nodes => { for (const node of nodes) {
    if (node.name === 'meta' && node.attribs?.property?.toLowerCase() === 'og:title') og ||= node.attribs.content || '';
    if (node.name === 'title') title ||= text(node);
    if (node.children) visit(node.children);
  }};
  visit(parseDocument(html).children);
  const result = (og || title).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if (!result || result.length > 300 || /^(just a moment|access denied|attention required|security check|verify you are human|robot check)/i.test(result)) return null;
  return result;
}
export function bareLinks(markdown) {
  const result = new Set();
  marked.walkTokens(marked.lexer(markdown), token => {
    if (token.type === 'link' && token.text.replace(/\\([_*])/g,'$1') === token.href) {
      try { publicUrl(token.href); result.add(token.href); } catch { /* keep original label */ }
    }
  });
  return [...result];
}
async function readHtml(value, signal, redirects = 0) {
  const url = publicUrl(value);
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(record => !publicAddress(record.address))) throw new Error('Non-public host');
  const address = addresses[0].address;
  return new Promise((resolve, reject) => {
    const req = request(url, { signal, agent: false, family: 4, autoSelectFamily: false,
      lookup: (_host, _options, callback) => callback(null, address, 4),
      headers: { 'User-Agent': 'FemarchiveLinkTitles/1.0', Accept: 'text/html', 'Accept-Encoding': 'identity' }
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        res.resume();
        if (redirects >= 3 || !res.headers.location) return reject(new Error('Redirect limit'));
        resolve(readHtml(new URL(res.headers.location, url).href, signal, redirects + 1)); return;
      }
      if (res.statusCode !== 200 || !/text\/html|application\/xhtml\+xml/i.test(res.headers['content-type'] || '')) {
        res.resume(); reject(new Error('No HTML')); return;
      }
      const chunks = []; let size = 0;
      res.on('error', reject);
      res.on('data', chunk => {
        chunks.push(chunk); size += chunk.length;
        if (size >= 512 * 1024 || chunk.toString().includes('</head>')) { resolve(Buffer.concat(chunks).toString('utf8')); res.destroy(); }
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject); req.end();
  });
}
export async function fetchTitle(url, parentSignal = AbortSignal.timeout(25000)) {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(6000)]);
  let abort;
  const deadline = new Promise((_, reject) => {
    abort = () => reject(new Error('Title deadline'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return pageTitle(await Promise.race([readHtml(url, signal), deadline])); }
  catch { return null; }
  finally { signal.removeEventListener('abort', abort); }
}
export async function buildTitles(root) {
  const target = path.join(root,'data','link_titles.json');
  let previous = {};
  try { previous = JSON.parse(await readFile(target,'utf8')); } catch { /* first build */ }
  const urls = new Set();
  for (const file of await readdir(path.join(root,'content','lexicon'))) {
    if (!file.endsWith('.md')) continue;
    for (const url of bareLinks(await readFile(path.join(root,'content','lexicon',file),'utf8'))) urls.add(url);
  }
  const titles = Object.create(null), pending = [...urls].slice(0,200);
  const signal = AbortSignal.timeout(25000);
  await Promise.all(Array.from({length:4}, async () => {
    while (pending.length) {
      const url = pending.shift();
      const title = signal.aborted ? null : await fetchTitle(url,signal);
      const fallback = previous[url];
      if (title) titles[url] = title;
      else if (typeof fallback === 'string' && fallback.length <= 300) titles[url] = fallback;
    }
  }));
  await mkdir(path.dirname(target),{recursive:true});
  await writeFile(target,JSON.stringify(Object.fromEntries(Object.entries(titles).sort()),null,2)+'\n');
  console.log(`Link titles: ${Object.keys(titles).length}/${urls.size}; unavailable links keep their URL.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildTitles(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
}

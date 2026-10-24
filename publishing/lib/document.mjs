import yaml from 'js-yaml';
import sanitizeHtml from 'sanitize-html';
import { parseDocument } from 'htmlparser2';
import { marked } from 'marked';
import { isDeepStrictEqual } from 'node:util';
import { isUtf8 } from 'node:buffer';
import { fail, uuid, sha, imagePath } from './errors.mjs';

const fields = ['version', 'confirmed', 'title', 'html', 'categories', 'tags', 'comments', 'assets', 'articleId', 'expectedRevision'];
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const text = (value, max, nonempty = false) => typeof value === 'string' && value.length <= max && !control.test(value) && (!nonempty || value.trim().length > 0);
const strings = (value, maxItems, maxLength) => Array.isArray(value) && value.length <= maxItems && value.every(v => text(v, maxLength, true)) && new Set(value).size === value.length;
export function validateArticle(value, catalog) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) fail();
  if (value.version !== 1 || value.confirmed !== true || !text(value.title, 300, true) || /[\r\n]/.test(value.title) || !text(value.html, 512 * 1024) || !strings(value.categories, 6, 100) || !strings(value.tags, 50, 100)) fail();
  if (value.categories.some(c => !catalog.categories.includes(c)) || value.tags.some(t => !catalog.sharedTags.includes(t))) fail();
  if (!Array.isArray(value.comments) || value.comments.length > 100 || !value.comments.every(c => text(c, 10000, true))) fail();
  if (!Array.isArray(value.assets) || value.assets.length > 50 || !value.assets.every(uuid) || new Set(value.assets).size !== value.assets.length) fail();
  if ('articleId' in value || 'expectedRevision' in value) { if (!uuid(value.articleId) || !sha(value.expectedRevision)) fail(); }
  return value;
}

const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'mark', 's', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'img', 'hr'];
const allowedAttributes = { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'data-width', 'data-align'], ol: ['start'] };
function safeLink(href) {
  try {
    if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return false;
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || /\.(?:local|localhost|internal|home|lan|test)$/.test(url.hostname)) return false;
    if (/(?:^|\.)(?:douban\.com|twitter\.com|x\.com|instagram\.com|facebook\.com|weibo\.com)$/.test(url.hostname)) return false;
    let path = url.pathname;
    for (let depth = 0; depth < 16; depth++) {
      if (/(?:^|\/)(?:@[^/]*|u|users?|members?|profiles?|people)(?:\/|$)/i.test(path)) return false;
      const next = path.replace(/%([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      if (next === path) break;
      if (depth === 15) return false;
      path = next;
    }
    // The URL parser percent-encodes raw angle brackets. Encode braces as well
    // so a citation cannot introduce Hugo shortcodes before Markdown rendering.
    return url.href.replace(/[{}]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch { return false; }
}
// Escape text for Markdown, raw HTML, and Hugo's shortcode syntax. These bytes
// come from the public editor, not from a trusted Markdown author.
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[{}]/g, c => `&#${c.charCodeAt(0)};`).replace(/([\\`*_[\]#!|~])/g, '\\$1');
const attribute = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[{}]/g, c => `&#${c.charCodeAt(0)};`);

export function publicBody(html, comments, selectedPaths) {
  const root = parseDocument(html, { decodeEntities: true });
  function validate(nodes) {
    for (const node of nodes) {
      if (node.type === 'text') { if (!text(node.data, 512 * 1024)) fail(); continue; }
      if (node.type !== 'tag' || !allowedTags.includes(node.name)) fail();
      for (const [key, value] of Object.entries(node.attribs)) {
        if (!(allowedAttributes[node.name] ?? []).includes(key) || !text(value, 2000)) fail();
      }
      if (node.name === 'a' && !safeLink(node.attribs.href)) fail();
      if (node.name === 'a' && ((node.attribs.target !== undefined && node.attribs.target !== '_blank') || (node.attribs.rel !== undefined && node.attribs.rel !== 'noopener noreferrer nofollow'))) fail();
      if (node.name === 'img' && (!imagePath(node.attribs.src) || !selectedPaths.includes(node.attribs.src))) fail();
      if (node.name === 'img' && ((node.attribs['data-width'] !== undefined && !['33', '50', '75', '100'].includes(node.attribs['data-width'])) || (node.attribs['data-align'] !== undefined && !['left', 'center', 'right'].includes(node.attribs['data-align'])))) fail();
      if (node.name === 'ol' && node.attribs.start !== undefined && !/^[1-9][0-9]{0,5}$/.test(node.attribs.start)) fail();
      validate(node.children ?? []);
    }
  }
  validate(root.children);
  // A second independent allowlist also normalizes malformed editor HTML.
  const clean = sanitizeHtml(html, { allowedTags, allowedAttributes, allowedSchemes: ['https'], allowProtocolRelative: false, disallowedTagsMode: 'discard' });
  function render(nodes) {
    return nodes.map(node => {
      if (node.type === 'text') return escape(node.data);
      const inner = render(node.children ?? []);
      switch (node.name) {
        case 'p': return `\n\n${inner}\n\n`;
        case 'br': return '  \n';
        case 'strong': case 'b': return `**${inner}**`;
        case 'em': case 'i': return `*${inner}*`;
        case 'u': case 'mark': return `<${node.name}>${inner}</${node.name}>`;
        case 'del': case 's': return `~~${inner}~~`;
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return `\n\n${'#'.repeat(Number(node.name[1]))} ${inner}\n\n`;
        case 'hr': return '\n\n---\n\n';
        case 'blockquote': return `\n\n${inner.trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
        case 'ul': case 'ol': {
          let index = node.name === 'ol' ? Number(node.attribs.start ?? 1) - 1 : 0;
          return '\n\n' + node.children.filter(n => n.type === 'tag' && n.name === 'li').map(n => {
            const prefix = node.name === 'ol' ? `${++index}. ` : '- ';
            return prefix + render(n.children).trim().replace(/\n/g, `\n${' '.repeat(prefix.length)}`);
          }).join('\n') + '\n\n';
        }
        case 'li': return inner;
        // Entity-encoded HTML code blocks cannot break out or invoke shortcodes.
        case 'pre': return `\n\n<pre>${attribute(plain(node))}</pre>\n\n`;
        case 'code': return `<code>${attribute(plain(node))}</code>`;
        case 'a': return `[${inner}](<${safeLink(node.attribs.href)}>)`;
        case 'img': {
          const width = node.attribs['data-width'], align = node.attribs['data-align'];
          if (!width && !align) return `![${escape(node.attribs.alt ?? '')}](<${node.attribs.src}>)`;
          const layout = `width:${width ?? '100'}%;display:block;margin-left:${align === 'left' ? '0' : 'auto'};margin-right:${align === 'right' ? '0' : 'auto'}`;
          return `<img src="${node.attribs.src}" alt="${attribute(node.attribs.alt ?? '')}"${width ? ` data-width="${width}"` : ''}${align ? ` data-align="${align}"` : ''} style="${layout}">`;
        }
        default: fail();
      }
    }).join('');
  }
  const body = render(parseDocument(clean, { decodeEntities: true }).children).trim();
  const excerpts = comments.map(c => c.split(/\r?\n/).map(line => `> ${escape(line)}`).join('\n')).join('\n\n');
  return `${body}${excerpts ? `\n\n${excerpts}` : ''}\n`;
}
function plain(node) { return node.type === 'text' ? node.data : (node.children ?? []).map(plain).join(''); }

export function assertNoPrivateValues(value, forbidden) {
  return assertNoPrivateText([value.title, value.html, ...value.comments, ...value.categories, ...value.tags], forbidden);
}
export function assertNoPrivateText(fields, forbidden) {
  const needles = forbidden.map(v => v.toLowerCase()), candidates = new Set();
  function inspect(view) {
    const normalized = view.normalize('NFKC').toLowerCase();
    if (needles.some(id => normalized.includes(id))) fail();
    for (const match of normalized.matchAll(/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/g)) candidates.add(match[0]);
    if (candidates.size > 256) fail();
  }
  function check(input) {
    const queue = [], scheduled = new Set(), budget = input.length * 8 + 1024;
    let queuedChars = 0;
    function enqueue(view) {
      if (scheduled.has(view)) return;
      // Fail closed rather than silently accepting uninspected reversible views.
      if (scheduled.size >= 64 || queuedChars + view.length > budget) fail();
      scheduled.add(view); queuedChars += view.length; queue.push(view);
    }
    enqueue(input);
    for (let index = 0; index < queue.length; index++) {
      // Base64 is case-sensitive. Normalize only the comparison/candidate view,
      // never the source bytes used by reversible decoders.
      const view = queue[index];
      inspect(view);
      // Decode entities without interpreting literal '<' as markup, then decode
      // ASCII percent bytes. Queue nested and mixed encodings with the same
      // budgets used for Base64 views and private-record candidate extraction.
      enqueue(plain(parseDocument(view.replace(/</g, '&lt;'), { decodeEntities: true }))
        .replace(/%([a-f0-9]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\u([a-f0-9]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\([\\`*_[\]#!|~{}<>-])/g, '$1').normalize('NFKC'));
      // Rendered text can join UUIDs split across elements or comments, also
      // after another decoder has reconstructed that markup.
      enqueue(plain(parseDocument(view, { decodeEntities: true })));
      // Inspect both whole Base64 tokens (which may contain '/') and URL path
      // components: a public path prefix must not hide its encoded identifier.
      for (const pattern of [/[a-z\d+/_-]{8,}={0,2}/gi, /[a-z\d+_-]{8,}={0,2}/gi]) {
        for (const match of view.matchAll(pattern)) {
          const encoded = match[0].replace(/-/g, '+').replace(/_/g, '/');
          // Standard Base64 '/' can also be a URL separator. Four comparison-
          // only alignments recover embedded identifiers behind URL prefixes;
          // no arbitrary substring search or recursive binary branch is added.
          for (let shift = 0; shift < 4; shift++) {
            const aligned = Buffer.from(encoded.slice(shift), 'base64').toString('utf8');
            inspect(aligned);
            if (aligned.includes('<')) inspect(plain(parseDocument(aligned, { decodeEntities: true })));
          }
          if (encoded.length % 4 === 1) continue;
          const bytes = Buffer.from(encoded, 'base64');
          if (bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) continue;
          const decoded = bytes.toString('utf8');
          if (isUtf8(bytes)) enqueue(decoded);
          else {
            // Binary is comparison-only: replacement characters preserve ASCII
            // UUIDs, including those joined by HTML rendering. No new decoding
            // branch or output is created. Work is bounded by source token size.
            inspect(decoded);
            if (decoded.includes('<')) inspect(plain(parseDocument(decoded, { decodeEntities: true })));
          }
        }
      }
    }
  }
  for (const field of fields) check(field);
  return candidates;
}

export function readDocument(bytes) {
  const source = bytes.toString('utf8');
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) fail(409);
  let metadata;
  try { metadata = yaml.load(match[1], { schema: yaml.DEFAULT_SCHEMA, json: false }); } catch { fail(409); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail(409);
  return { source, raw: match[1], metadata, body: source.slice(match[0].length), prefixLength: match[0].length, newline: match[0].includes('\r\n') ? '\r\n' : '\n' };
}
export function writeDocument(value, body, previous, plan) {
  if (!previous) {
    const metadata = { title: value.title, date: plan.date, categories: value.categories, tags: value.tags, url: `/lexicon/${plan.articleId}/` };
    return Buffer.from(`---\n${yaml.dump(metadata, { lineWidth: -1, noRefs: true })}---\n\n${body}`);
  }
  const document = readDocument(previous), newline = document.newline;
  const lines = document.raw.split(/\r?\n/);
  const titleLines = lines.map((line, index) => /^(?:title|"title"|'title')\s*:/.test(line) ? index : -1).filter(index => index !== -1);
  if (titleLines.length > 1 || (Object.hasOwn(document.metadata, 'title') && titleLines.length !== 1)) fail(409);
  const encoded = `title: ${JSON.stringify(value.title)}`;
  if (titleLines.length) {
    const start = titleLines[0]; let end = start + 1;
    while (end < lines.length && (/^[ \t]+\S/.test(lines[end]) || (/^\s*$/.test(lines[end]) && /^\s+\S/.test(lines[end + 1] ?? '')))) end++;
    lines.splice(start, end - start, encoded);
  } else lines.unshift(encoded);
  const raw = lines.join(newline);
  // Anchors, merge keys or unusual scalar syntax must never change other fields.
  let updated;
  try { updated = yaml.load(raw); } catch { fail(409); }
  const oldFields = { ...document.metadata }; delete oldFields.title;
  const newFields = { ...updated }; delete newFields.title;
  if (updated.title !== value.title || !isDeepStrictEqual(oldFields, newFields)) fail(409);
  const prefix = document.source.startsWith('\uFEFF') ? '\uFEFF' : '';
  return Buffer.from(`${prefix}---${newline}${raw}${newline}---${newline}${newline}${body}`);
}
export function articleURL(origin, id, metadata) {
  let path = metadata?.url;
  if (path === undefined && typeof metadata?.slug === 'string' && /^[a-zA-Z0-9_-]+$/.test(metadata.slug)) path = `/lexicon/${metadata.slug}/`;
  if (path === undefined) path = `/lexicon/${id}/`;
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\u0000-\u0020\u007f\\]/.test(path)) fail(409);
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password) fail(409);
  return url.href;
}
export function articleFields(document) {
  return {
    title: text(document.metadata.title, 300) ? document.metadata.title : '',
    html: sanitizeHtml(marked.parse(document.body, { async: false }), {
      allowedTags, allowedAttributes, allowedSchemes: ['https'], allowProtocolRelative: false,
      // Editor input never accepts CSS. Keep only validated layout data so the
      // next confirmed publication can regenerate its fixed image style.
      transformTags: { img: (tagName, attribs) => {
        const layout = { ...attribs };
        if (!['33', '50', '75', '100'].includes(layout['data-width'])) delete layout['data-width'];
        if (!['left', 'center', 'right'].includes(layout['data-align'])) delete layout['data-align'];
        return { tagName, attribs: layout };
      } },
    }),
    categories: Array.isArray(document.metadata.categories) ? document.metadata.categories.filter(c => text(c, 100)) : [],
    tags: Array.isArray(document.metadata.tags) ? document.metadata.tags.filter(t => text(t, 100)) : [],
    comments: [],
  };
}

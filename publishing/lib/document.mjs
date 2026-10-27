import yaml from 'js-yaml';
// Bundled CommonJS copy: the sanitizer itself is CommonJS and requires the
// ESM-only htmlparser2, which the deployment runtime refuses. See
// scripts/build-vendor.mjs.
import sanitizeHtml from '../vendor/sanitize-html.cjs';
import { parseDocument, Parser } from 'htmlparser2';
import { marked } from 'marked';
import { isDeepStrictEqual } from 'node:util';
import { isUtf8 } from 'node:buffer';
import { fail, uuid, sha, imagePath } from './errors.mjs';

const fields = ['presentation', 'section', 'version', 'confirmed', 'title', 'author', 'license', 'html', 'initial', 'polarity', 'isEvent', 'aliases', 'categories', 'tags', 'newTags', 'replaceTags', 'comments', 'commentImages', 'relatedTerms', 'assets', 'articleId', 'expectedRevision'];
// Closed set: the index letter cannot carry anything the listing does not use.
const PRESENTATIONS = ['article', 'cards', 'discussion', 'quote', 'centered', 'grouped', 'highlight', 'folded'];
const INDEX_LETTERS = new Set(['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '⚑']);
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const text = (value, max, nonempty = false) => typeof value === 'string' && value.length <= max && !control.test(value) && (!nonempty || value.trim().length > 0);
const strings = (value, maxItems, maxLength) => Array.isArray(value) && value.length <= maxItems && value.every(v => text(v, maxLength, true)) && new Set(value).size === value.length;
export function validateArticle(value, catalog) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) fail();
  if (value.version !== 1 || value.confirmed !== true || !text(value.title, 300, true) || /[\r\n]/.test(value.title) || !text(value.html, 512 * 1024) || !strings(value.categories, 6, 100) || !strings(value.tags, 50, 100)) fail();
  if (('author' in value && !text(value.author, 200, true)) || ('license' in value && !text(value.license, 300, true))) fail();
  if (value.categories.some(c => !catalog.categories.includes(c))) fail();
  if ('newTags' in value && (!strings(value.newTags, 50, 100) || value.newTags.some(t => !value.tags.includes(t)))) fail();
  if ('relatedTerms' in value && (!strings(value.relatedTerms, 50, 100) || value.relatedTerms.some(term => !value.tags.includes(term)))) fail();
  if ('replaceTags' in value && typeof value.replaceTags !== 'boolean') fail();
  if ('presentation' in value && !PRESENTATIONS.includes(value.presentation)) fail();
  if ('section' in value && value.section !== 'posts') fail();
  if ('initial' in value && !INDEX_LETTERS.has(value.initial)) fail();
  if ('polarity' in value && !['positive', 'negative', 'unmarked'].includes(value.polarity)) fail();
  if ('isEvent' in value && typeof value.isEvent !== 'boolean') fail();
  if ('aliases' in value && !strings(value.aliases, 20, 50)) fail();
  if (!Array.isArray(value.comments) || value.comments.length > 100 || !value.comments.every(c => text(c, 10000))) fail();
  if ('commentImages' in value && (!Array.isArray(value.commentImages) || value.commentImages.length !== value.comments.length || !value.commentImages.every(images => Array.isArray(images) && images.length <= 50 && images.every(imagePath) && new Set(images).size === images.length))) fail();
  if (value.comments.some((comment, index) => !comment.trim() && !value.commentImages?.[index]?.length)) fail();
  if (!Array.isArray(value.assets) || value.assets.length > 50 || !value.assets.every(uuid) || new Set(value.assets).size !== value.assets.length) fail();
  if ('articleId' in value || 'expectedRevision' in value) { if (!uuid(value.articleId) || !sha(value.expectedRevision)) fail(); }
  return value;
}

const BODY_LAYOUTS = new Set(['card', 'reply', 'quote', 'centered', 'grouped', 'highlight', 'folded']);
const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'mark', 'span', 's', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'img', 'hr', 'div'];
const allowedAttributes = { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'data-width', 'data-align'], ol: ['start'], span: ['data-color', 'data-size'], mark: ['data-color'], div: ['data-publication-layout', 'data-title', 'data-tone', 'data-heading'] };
// Colour and size arrive as names from a closed set, never as CSS: a stylesheet
// from the sender would be arbitrary code on the public site. Keep these in step
// with src/lib/topics/text-style.ts and with the theme that paints them.
const TEXT_COLORS = ['red', 'orange', 'green', 'blue', 'purple', 'gray'];
const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];
const TEXT_SIZES = ['sm', 'lg', 'xl'];
function safeLink(href) {
  try {
    if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return false;
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || /\.(?:local|localhost|internal|home|lan|test)$/.test(url.hostname)) return false;
    // Links to a person's own page are allowed: keeping the forum out of the
    // public copy is the sender's job, and it has the member identities to do
    // it precisely. The receiver only enforces transport-level safety.
    // The URL parser percent-encodes raw angle brackets. Encode braces as well
    // so a citation cannot introduce Hugo shortcodes before Markdown rendering.
    return url.href.replace(/[{}]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch { return false; }
}
// Escape text for Markdown, raw HTML, and Hugo's shortcode syntax. These bytes
// come from the public editor, not from a trusted Markdown author.
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[{}]/g, c => `&#${c.charCodeAt(0)};`).replace(/([\\`*_[\]#!|~])/g, '\\$1');
const attribute = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[{}]/g, c => `&#${c.charCodeAt(0)};`);

function validateBodyNodes(nodes, selectedPaths, status = 400) {
  for (const node of nodes) {
    if (node.type === 'text') { if (!text(node.data, 512 * 1024)) fail(status); continue; }
    if (node.type !== 'tag' || !allowedTags.includes(node.name)) fail(status);
    for (const [key, value] of Object.entries(node.attribs)) {
      if (!(allowedAttributes[node.name] ?? []).includes(key) || !text(value, 2000)) fail(status);
    }
    if (node.name === 'div' && (!BODY_LAYOUTS.has(node.attribs['data-publication-layout']) || (node.attribs['data-title'] !== undefined && (!text(node.attribs['data-title'], 100) || /[\r\n]/.test(node.attribs['data-title']))))) fail(status);
    if (node.name === 'div' && ((node.attribs['data-tone'] !== undefined && (node.attribs['data-publication-layout'] !== 'grouped' || node.attribs['data-tone'] !== 'warm')) || (node.attribs['data-heading'] !== undefined && (node.attribs['data-publication-layout'] !== 'grouped' || node.attribs['data-heading'] !== 'none')))) fail(status);
    if (node.name === 'a' && !safeLink(node.attribs.href)) fail(status);
    if (node.name === 'a' && ((node.attribs.target !== undefined && node.attribs.target !== '_blank') || (node.attribs.rel !== undefined && node.attribs.rel !== 'noopener noreferrer nofollow'))) fail(status);
    if (node.name === 'img' && (!imagePath(node.attribs.src) || (selectedPaths && !selectedPaths.includes(node.attribs.src)))) fail(status);
    if (node.name === 'img' && ((node.attribs['data-width'] !== undefined && !['33', '50', '75', '100'].includes(node.attribs['data-width'])) || (node.attribs['data-align'] !== undefined && !['left', 'center', 'right'].includes(node.attribs['data-align'])))) fail(status);
    if (node.name === 'span' && ((node.attribs['data-color'] !== undefined && !TEXT_COLORS.includes(node.attribs['data-color'])) || (node.attribs['data-size'] !== undefined && !TEXT_SIZES.includes(node.attribs['data-size'])))) fail(status);
    if (node.name === 'mark' && node.attribs['data-color'] !== undefined && !HIGHLIGHT_COLORS.includes(node.attribs['data-color'])) fail(status);
    if (node.name === 'ol' && node.attribs.start !== undefined && !/^[1-9][0-9]{0,5}$/.test(node.attribs.start)) fail(status);
    validateBodyNodes(node.children ?? [], selectedPaths, status);
  }
}
function imageLayout(attributes) {
  const width = attributes['data-width'], align = attributes['data-align'];
  return `width:${width ?? '100'}%;display:block;margin-left:${align === 'left' ? '0' : 'auto'};margin-right:${align === 'right' ? '0' : 'auto'}`;
}
const bodyMarkerAttributes = attributes => ` data-publication-layout="${attributes['data-publication-layout']}"${attributes['data-title'] === undefined ? '' : ` data-title="${attribute(attributes['data-title'])}"`}${attributes['data-tone'] === undefined ? '' : ` data-tone="${attribute(attributes['data-tone'])}"`}${attributes['data-heading'] === undefined ? '' : ` data-heading="${attribute(attributes['data-heading'])}"`}`;
function bodyLayoutHTML(attributes, inner) {
  const marker = bodyMarkerAttributes(attributes), title = attributes['data-title'];
  switch (attributes['data-publication-layout']) {
    case 'card': case 'reply': return `<div${marker} class="mycard${attributes['data-publication-layout'] === 'reply' ? ' mycard--reply' : ''}"><div class="mycard__content">${inner}</div></div>`;
    case 'quote': return `<blockquote${marker} class="quote"><div class="quote-content">${inner}</div></blockquote>`;
    case 'centered': return `<blockquote${marker} class="quote-center">${inner}</blockquote>`;
    case 'grouped': return `<section${marker} class="language-discussion-group${attributes['data-tone'] === 'warm' ? ' language-discussion-group--warm' : ''}">${attributes['data-heading'] === 'none' ? '' : `<h3>${attribute(title ?? '讨论摘录')}</h3>`}${inner}</section>`;
    case 'highlight': return `<div${marker} class="text-highlight--block">${inner}</div>`;
    case 'folded': return `<details${marker}><summary>${attribute(title ?? '展开内容')}</summary>${inner}</details>`;
    default: fail();
  }
}
// Layout regions use complete, closed HTML blocks so nested paragraphs and
// images retain their structure inside the website's existing CSS containers.
function bodyHTML(nodes, generated = true, linker = null) {
  return nodes.map(node => {
    if (node.type === 'text') return linker ? linker(node.data, attribute, (label, path) => `<a href="${attribute(path)}">${attribute(label)}</a>`) : attribute(node.data);
    const inner = bodyHTML(node.children ?? [], generated, ['a', 'code', 'pre'].includes(node.name) ? null : linker);
    if (node.name === 'div') return generated ? bodyLayoutHTML(node.attribs, inner) : `<div${bodyMarkerAttributes(node.attribs)}>${inner}</div>`;
    let attributes = '';
    for (const key of allowedAttributes[node.name] ?? []) {
      if (node.attribs[key] !== undefined) attributes += ` ${key}="${attribute(key === 'href' ? safeLink(node.attribs[key]) : node.attribs[key])}"`;
    }
    if (node.name === 'img' && (node.attribs['data-width'] || node.attribs['data-align']) && generated) attributes += ` style="${imageLayout(node.attribs)}"`;
    return `<${node.name}${attributes}>${['br', 'img', 'hr'].includes(node.name) ? '' : `${inner}</${node.name}>`}`;
  }).join('');
}
function validateMarkerSyntax(html) {
  let seen = new Set(), duplicate = false;
  const stack = [];
  new Parser({
    onopentagname() { seen = new Set(); duplicate = false; },
    onattribute(name) { if (seen.has(name)) duplicate = true; seen.add(name); },
    onopentag(name, attributes) {
      const marker = Object.hasOwn(attributes, 'data-publication-layout');
      if (marker && duplicate) fail();
      stack.push(marker);
    },
    onclosetag(name, implied) { if (stack.pop() && implied) fail(); },
  }, { decodeEntities: true }).end(html);
}

/** Mentions of a published term become links to its archive page, by its own
 *  name or by any other name it is written about under. Text nodes only: an
 *  existing link, code, a heading's attribute or a URL is never rewritten. The
 *  longest name wins, and a Latin name is not matched inside a longer word.
 *  `terms` is `[{ names, path }]`, already without the article's own record. */
export function termLinker(terms = []) {
  const names = terms.flatMap(term => (term.names ?? []).filter(name => typeof name === 'string' && name.trim()).map(name => ({ name: name.trim(), path: term.path })))
    .sort((a, b) => b.name.length - a.name.length);
  if (!names.length) return null;
  const paths = new Map(names.map(item => [item.name.toLowerCase(), item.path]));
  const pattern = new RegExp(names.map(item => item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
  return (value, plainText, link) => {
    let rendered = '', end = 0;
    for (const match of value.matchAll(pattern)) {
      const start = match.index, label = match[0];
      if (start < end) continue;
      // A Latin name may adjoin Chinese prose, but not another Latin word.
      if ((/^[a-z0-9_]/i.test(label) && /[a-z0-9_]$/i.test(value.slice(0, start)))
        || (/[a-z0-9_]$/i.test(label) && /^[a-z0-9_]/i.test(value.slice(start + label.length)))) continue;
      rendered += plainText(value.slice(end, start)) + link(label, paths.get(label.toLowerCase()));
      end = start + label.length;
    }
    return end ? rendered + plainText(value.slice(end)) : plainText(value);
  };
}
export function publicBody(html, comments, selectedPaths, presentation, commentImages = comments.map(() => []), terms = []) {
  if (commentImages.length !== comments.length || commentImages.some(images => images.some(path => !imagePath(path) || !selectedPaths.includes(path)))) fail();
  const linker = termLinker(terms);
  validateMarkerSyntax(html);
  const root = parseDocument(html, { decodeEntities: true });
  validateBodyNodes(root.children, selectedPaths);
  // A second independent allowlist also normalizes malformed editor HTML.
  const clean = sanitizeHtml(html, { allowedTags, allowedAttributes, allowedSchemes: ['https'], allowProtocolRelative: false, disallowedTagsMode: 'discard' });
  function render(nodes, linking = linker) {
    return nodes.map(node => {
      if (node.type === 'text') return linking ? linking(node.data, escape, (label, path) => `[${escape(label)}](<${path}>)`) : escape(node.data);
      const inner = render(node.children ?? [], ['a', 'code', 'pre'].includes(node.name) ? null : linking);
      switch (node.name) {
        case 'div': return `\n\n${bodyLayoutHTML(node.attribs, bodyHTML(node.children ?? [], true, linking))}\n\n`;
        case 'p': return `\n\n${inner}\n\n`;
        case 'br': return '  \n';
        case 'strong': case 'b': return `**${inner}**`;
        case 'em': case 'i': return `*${inner}*`;
        case 'u': return `<u>${inner}</u>`;
        // Raw inline HTML keeps the names; the theme decides what they look like.
        case 'mark': {
          const color = node.attribs['data-color'];
          return `<mark${HIGHLIGHT_COLORS.includes(color) ? ` data-color="${color}"` : ''}>${inner}</mark>`;
        }
        case 'span': {
          const color = node.attribs['data-color'], size = node.attribs['data-size'];
          const marks = `${TEXT_COLORS.includes(color) ? ` data-color="${color}"` : ''}${TEXT_SIZES.includes(size) ? ` data-size="${size}"` : ''}`;
          return marks ? `<span${marks}>${inner}</span>` : inner;
        }
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
          const layout = imageLayout(node.attribs);
          return `<img src="${node.attribs.src}" alt="${attribute(node.attribs.alt ?? '')}"${width ? ` data-width="${width}"` : ''}${align ? ` data-align="${align}"` : ''} style="${layout}">`;
        }
        default: fail();
      }
    }).join('');
  }
  const body = render(parseDocument(clean, { decodeEntities: true }).children.filter(node => node.type !== 'text' || node.data.trim())).trim();
  const excerpts = PRESENTATIONS.includes(presentation) ? presentationFooter(comments, commentImages, presentation)
    : comments.map((c, index) => [c.split(/\r?\n/).map(escape).join('\n'), ...commentImages[index].map(path => `![](<${path}>)`)].filter(Boolean).join('\n\n').split('\n').map(line => `> ${line}`).join('\n')).join('\n\n');
  return `${body}${excerpts ? `\n\n${excerpts}` : ''}\n`;
}
const footerMarker = mode => `<!-- website-publication-comments:${mode} -->`;
function presentationFooter(comments, images, mode) {
  if (!comments.length) return '';
  const contents = comments.map((comment, index) => `${comment.trim() ? `<p>${attribute(comment).replace(/\r?\n/g, '<br>')}</p>` : ''}${images[index].map(path => `<p><img src="${path}" alt=""></p>`).join('')}`);
  const card = (content, reply = false) => `<div class="mycard${reply ? ' mycard--reply' : ''}"><div class="mycard__content">${content}</div></div>`;
  if (mode === 'discussion') return '<p class="douban-comments-title">讨论摘录</p>\n\n' + contents.map(content => card(content, true)).join('\n\n');
  const rendered = mode === 'grouped' ? `<section class="language-discussion-group"><h3>讨论摘录</h3>${contents.map(content => card(content)).join('')}</section>`
    : contents.map((content, index) => {
      switch (mode) {
        case 'article': return `<div>${content}</div>`;
        case 'cards': return card(content);
        case 'quote': return `<blockquote class="quote"><div class="quote-content">${content}</div></blockquote>`;
        case 'centered': return `<blockquote class="quote-center">${content}</blockquote>`;
        case 'highlight': return `<div class="text-highlight text-highlight--block">${content}</div>`;
        case 'folded': return `<details><summary>摘录 ${index + 1}</summary>${content}</details>`;
        default: fail();
      }
    }).join('\n\n');
  return `${footerMarker(mode)}\n${rendered}`;
}

function plain(node) { return node.type === 'text' ? node.data : (node.children ?? []).map(plain).join(''); }

export function assertNoPrivateValues(value, forbidden) {
  return assertNoPrivateText([value.title, value.html, ...value.comments, ...value.categories, ...value.tags, ...(value.newTags ?? []), ...(value.relatedTerms ?? []), ...(value.commentImages ?? []).flat()], forbidden);
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
    // Entries carry no taxonomy. Empty arrays would still render as front
    // matter keys, so only write the ones that actually have values.
    const metadata = { title: value.title, author: value.author ?? '豆瓣-女阅组', date: plan.date, license: value.license ?? '该作品版权归原作者所有。',
      ...(value.presentation ? { publication_layout: value.presentation } : {}),
      ...(INDEX_LETTERS.has(value.initial) ? { initial: value.initial } : {}),
      ...(['positive', 'negative', 'unmarked'].includes(value.polarity) ? { polarity: value.polarity } : {}),
      ...(typeof value.isEvent === 'boolean' ? { event: value.isEvent } : {}),
      ...(Array.isArray(value.aliases) && value.aliases.length ? { aliases: value.aliases } : {}),
      ...(value.categories.length ? { categories: value.categories } : {}),
      ...(value.tags.length ? { tags: value.tags } : {}),
      ...(value.relatedTerms ? { related_terms: value.relatedTerms } : {}),
      url: `/${value.section ?? "lexicon"}/${plan.articleId}/` };
    return Buffer.from(`---\n${yaml.dump(metadata, { lineWidth: -1, noRefs: true })}---\n\n${body}`);
  }
  const document = readDocument(previous), newline = document.newline;
  let lines = document.raw.split(/\r?\n/);
  // Keys the sender owns on every publication. An entry first published
  // before one of them existed gains it on the next update; everything else
  // in the front matter belongs to the website and must come through intact.
  const managed = { title: value.title };
  if ('author' in value) managed.author = value.author;
  if ('license' in value) managed.license = value.license;
  if (value.replaceTags === true) managed.tags = value.tags;
  if ('relatedTerms' in value) managed.related_terms = value.relatedTerms;
  if (value.presentation) managed.publication_layout = value.presentation;
  if (INDEX_LETTERS.has(value.initial)) managed.initial = value.initial;
  if (['positive', 'negative', 'unmarked'].includes(value.polarity)) managed.polarity = value.polarity;
  if (typeof value.isEvent === 'boolean') managed.event = value.isEvent;
  if (Array.isArray(value.aliases)) managed.aliases = value.aliases;
  for (const [key, keyValue] of Object.entries(managed)) {
    const pattern = new RegExp(`^(?:${key}|"${key}"|'${key}')\\s*:`);
    const found = lines.map((line, index) => pattern.test(line) ? index : -1).filter(index => index !== -1);
    if (found.length > 1 || (Object.hasOwn(document.metadata, key) && found.length !== 1)) fail(409);
    const encoded = `${key}: ${JSON.stringify(keyValue)}`;
    if (found.length) {
      const start = found[0]; let end = start + 1;
      while (end < lines.length && (/^[ \t]+\S/.test(lines[end]) || (/^\s*$/.test(lines[end]) && /^\s+\S/.test(lines[end + 1] ?? '')))) end++;
      lines.splice(start, end - start, encoded);
    } else lines = [encoded, ...lines];
  }
  const raw = lines.join(newline);
  // Anchors, merge keys or unusual scalar syntax must never change other fields.
  let updated;
  try { updated = yaml.load(raw); } catch { fail(409); }
  const oldFields = { ...document.metadata }, newFields = { ...updated };
  for (const key of Object.keys(managed)) { delete oldFields[key]; delete newFields[key]; }
  // Deep comparison: a managed key may hold a list, not just a scalar.
  if (Object.entries(managed).some(([key, keyValue]) => !isDeepStrictEqual(updated[key], keyValue)) || !isDeepStrictEqual(oldFields, newFields)) fail(409);
  const prefix = document.source.startsWith('\uFEFF') ? '\uFEFF' : '';
  return Buffer.from(`${prefix}---${newline}${raw}${newline}---${newline}${newline}${body}`);
}
export function articleURL(origin, id, metadata, section = "lexicon") {
  let path = metadata?.url;
  if (path === undefined && typeof metadata?.slug === 'string' && /^[a-zA-Z0-9_-]+$/.test(metadata.slug)) path = `/${section}/${metadata.slug}/`;
  if (path === undefined) path = `/${section}/${id}/`;
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\u0000-\u0020\u007f\\]/.test(path)) fail(409);
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password) fail(409);
  return url.href;
}
function discussionFields(document) {
  const fallback = { body: document.body, comments: [] }, mode = document.metadata.publication_layout;
  if (!PRESENTATIONS.includes(mode)) return fallback;
  const marker = mode === 'discussion' ? '<p class="douban-comments-title">讨论摘录</p>' : footerMarker(mode);
  const start = document.body.indexOf(marker);
  if (start === -1) {
    // A legacy plain article can still be edited as body. Structured website
    // markup cannot be silently stripped or guessed into anonymous excerpts.
    if (/website-publication-comments:|<details\b|class\s*=\s*["'][^"']*\b(?:mycard|douban-comments-title|quote|quote-center|quote-content|language-discussion-group|text-highlight--block)\b/.test(document.body)) fail(409);
    return fallback;
  }
  const footer = document.body.slice(start).trim();
  const fragment = mode === 'discussion' ? footer : footer.slice(marker.length).trim();
  let nodes = parseDocument(fragment, { decodeEntities: true }).children.filter(node => node.type !== 'text' || node.data.trim());
  const tag = (node, name, attributes = {}) => node?.type === 'tag' && node.name === name
    && Object.keys(node.attribs).length === Object.keys(attributes).length
    && Object.entries(attributes).every(([key, value]) => node.attribs[key] === value);
  const onlyChild = (node, name, attributes) => {
    if (node.children.length !== 1 || !tag(node.children[0], name, attributes)) fail(409);
    return node.children[0];
  };
  if (mode === 'discussion') {
    if (!tag(nodes[0], 'p', { class: 'douban-comments-title' }) || plain(nodes[0]) !== '讨论摘录') fail(409);
    nodes = nodes.slice(1);
  }
  if (mode === 'grouped') {
    if (nodes.length !== 1 || !tag(nodes[0], 'section', { class: 'language-discussion-group' }) || !tag(nodes[0].children[0], 'h3') || plain(nodes[0].children[0]) !== '讨论摘录') fail(409);
    nodes = nodes[0].children.slice(1);
  }
  if (!nodes.length || nodes.length > 100) fail(409);
  const comments = [], commentImages = [];
  for (const [cardIndex, card] of nodes.entries()) {
    let paragraphs;
    switch (mode) {
      case 'article': if (!tag(card, 'div')) fail(409); paragraphs = card.children; break;
      case 'cards': case 'discussion': case 'grouped':
        if (!tag(card, 'div', { class: mode === 'discussion' ? 'mycard mycard--reply' : 'mycard' })) fail(409);
        paragraphs = onlyChild(card, 'div', { class: 'mycard__content' }).children; break;
      case 'quote':
        if (!tag(card, 'blockquote', { class: 'quote' })) fail(409);
        paragraphs = onlyChild(card, 'div', { class: 'quote-content' }).children; break;
      case 'centered': if (!tag(card, 'blockquote', { class: 'quote-center' })) fail(409); paragraphs = card.children; break;
      case 'highlight': if (!tag(card, 'div', { class: 'text-highlight text-highlight--block' })) fail(409); paragraphs = card.children; break;
      case 'folded':
        if (!tag(card, 'details') || !tag(card.children[0], 'summary') || plain(card.children[0]) !== `摘录 ${cardIndex + 1}`) fail(409);
        paragraphs = card.children.slice(1); break;
    }
    let comment = '', sawText = false;
    const images = [];
    for (const [index, paragraph] of paragraphs.entries()) {
      if (!tag(paragraph, 'p')) fail(409);
      if (paragraph.children.every(node => node.type === 'text' || tag(node, 'br'))) {
        if (index !== 0 || sawText) fail(409);
        sawText = true;
        comment = paragraph.children.map(node => node.type === 'text' ? node.data : '\n').join('');
      } else {
        const image = paragraph.children[0];
        if (paragraph.children.length !== 1 || !imagePath(image?.attribs?.src) || !tag(image, 'img', { src: image.attribs.src, alt: '' })) fail(409);
        images.push(image.attribs.src);
      }
    }
    if (!text(comment, 10000) || (!comment.trim() && !images.length) || images.length > 50 || new Set(images).size !== images.length) fail(409);
    comments.push(comment); commentImages.push(images);
  }
  // Require byte-reproducible markup so a title edit cannot discard unknown
  // attributes, website additions, or text following the selected excerpts.
  if (presentationFooter(comments, commentImages, mode) !== footer) fail(409);
  return { body: document.body.slice(0, start).trimEnd(), comments, commentImages };
}
function recoverBodyLayouts(source) {
  const root = parseDocument(source, { decodeEntities: true, withStartIndices: true, withEndIndices: true });
  const changes = [];
  const tag = (node, name, attributes = {}) => node?.type === 'tag' && node.name === name
    && Object.keys(node.attribs).length === Object.keys(attributes).length
    && Object.entries(attributes).every(([key, value]) => node.attribs[key] === value);
  function canonicalChildren(nodes) {
    return nodes.map(node => {
      if (node.attribs && Object.hasOwn(node.attribs, 'data-publication-layout')) return recover(node);
      const attributes = { ...node.attribs };
      if (node.name === 'img' && attributes.style !== undefined) {
        if ((!attributes['data-width'] && !attributes['data-align']) || attributes.style !== imageLayout(attributes)) fail(409);
        delete attributes.style;
      }
      return { ...node, attribs: attributes, children: canonicalChildren(node.children ?? []) };
    });
  }
  function recover(node) {
    const mode = node.attribs['data-publication-layout'], title = node.attribs['data-title'], tone = node.attribs['data-tone'], heading = node.attribs['data-heading'];
    if (!BODY_LAYOUTS.has(mode)) fail(409);
    const attributes = { 'data-publication-layout': mode, ...(title === undefined ? {} : { 'data-title': title }), ...(tone === undefined ? {} : { 'data-tone': tone }), ...(heading === undefined ? {} : { 'data-heading': heading }) };
    let children = node.children ?? [];
    const outer = (name, classes) => { if (!tag(node, name, { ...attributes, ...(classes ? { class: classes } : {}) })) fail(409); };
    const unwrap = classes => {
      if (children.length !== 1 || !tag(children[0], 'div', { class: classes })) fail(409);
      children = children[0].children;
    };
    switch (mode) {
      case 'card': case 'reply': outer('div', mode === 'reply' ? 'mycard mycard--reply' : 'mycard'); unwrap('mycard__content'); break;
      case 'quote': outer('blockquote', 'quote'); unwrap('quote-content'); break;
      case 'centered': outer('blockquote', 'quote-center'); break;
      case 'highlight': outer('div', 'text-highlight--block'); break;
      case 'grouped':
        outer('section', `language-discussion-group${tone === 'warm' ? ' language-discussion-group--warm' : ''}`);
        if (heading !== 'none') {
          if (!tag(children[0], 'h3') || plain(children[0]) !== (title ?? '讨论摘录')) fail(409);
          children = children.slice(1);
        }
        break;
      case 'folded':
        outer('details');
        if (!tag(children[0], 'summary') || plain(children[0]) !== (title ?? '展开内容')) fail(409);
        children = children.slice(1); break;
    }
    const canonical = { type: 'tag', name: 'div', attribs: attributes, children: canonicalChildren(children) };
    validateBodyNodes([canonical], null, 409);
    // Recover only receiver-owned, byte-reproducible regions. Website edits
    // with unknown attributes/containers must be resolved without losing them.
    if (bodyHTML([canonical]) !== source.slice(node.startIndex, node.endIndex + 1)) fail(409);
    return canonical;
  }
  function visit(nodes) {
    for (const node of nodes) {
      if (node.attribs && Object.hasOwn(node.attribs, 'data-publication-layout')) {
        changes.push({ start: node.startIndex, end: node.endIndex + 1, html: bodyHTML([recover(node)], false) });
      } else visit(node.children ?? []);
    }
  }
  visit(root.children);
  for (const change of changes.reverse()) source = source.slice(0, change.start) + change.html + source.slice(change.end);
  return source;
}
export function articleFields(document) {
  const discussion = discussionFields({ ...document, body: recoverBodyLayouts(document.body) });
  // A missing boundary is also a website edit. Do not remove recognizable
  // website layout containers merely because legacy front matter is absent.
  if (/website-publication-comments:|<details\b|class\s*=\s*["'][^"']*\b(?:mycard|douban-comments-title|quote|quote-center|quote-content|language-discussion-group|text-highlight--block)\b/.test(discussion.body)) fail(409);
  return {
    ...(PRESENTATIONS.includes(document.metadata.publication_layout) ? { presentation: document.metadata.publication_layout } : {}),
    title: text(document.metadata.title, 300) ? document.metadata.title : '',
    author: text(document.metadata.author, 200, true) ? document.metadata.author : '豆瓣-女阅组',
    date: document.metadata.date instanceof Date ? document.metadata.date.toISOString() : text(document.metadata.date, 100, true) ? document.metadata.date : '',
    license: text(document.metadata.license, 300, true) ? document.metadata.license : '该作品版权归原作者所有。',
    html: sanitizeHtml(marked.parse(discussion.body, { async: false }), {
      allowedTags, allowedAttributes, allowedSchemes: ['https'], allowProtocolRelative: false,
      // Editor input never accepts CSS. Keep only validated layout data so the
      // next confirmed publication can regenerate its fixed image style.
      transformTags: {
        img: (tagName, attribs) => {
          const layout = { ...attribs };
          if (!['33', '50', '75', '100'].includes(layout['data-width'])) delete layout['data-width'];
          if (!['left', 'center', 'right'].includes(layout['data-align'])) delete layout['data-align'];
          return { tagName, attribs: layout };
        },
        span: (tagName, attribs) => {
          const marks = { ...attribs };
          if (!TEXT_COLORS.includes(marks['data-color'])) delete marks['data-color'];
          if (!TEXT_SIZES.includes(marks['data-size'])) delete marks['data-size'];
          return { tagName, attribs: marks };
        },
        mark: (tagName, attribs) => ({ tagName, attribs: HIGHLIGHT_COLORS.includes(attribs['data-color']) ? { 'data-color': attribs['data-color'] } : {} }),
      },
    }),
    categories: Array.isArray(document.metadata.categories) ? document.metadata.categories.filter(c => text(c, 100)) : [],
    tags: Array.isArray(document.metadata.tags) ? document.metadata.tags.filter(t => text(t, 100)) : [],
    relatedTerms: Array.isArray(document.metadata.related_terms) ? document.metadata.related_terms.filter(t => text(t, 100, true)) : [],
    comments: discussion.comments,
    ...(discussion.commentImages ? { commentImages: discussion.commentImages } : {}),
  };
}

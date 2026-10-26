import { marked } from 'marked';
import { parseDocument, Parser } from 'htmlparser2';
import { fail } from './errors.mjs';

// This is deliberately a source converter, not a sanitizer. Unknown website
// markup must block continuation rather than disappear on the next write.
const tags = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'mark', 's', 'del', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'hr']);
const voidTags = new Set(['br', 'hr']);
const attributes = { a: new Set(['href', 'title']), ol: new Set(['start']) };
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const validText = (value, max, nonempty = false) => typeof value === 'string' && value.length <= max && !control.test(value) && (!nonempty || value.trim().length > 0);
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[{}]/g, c => `&#${c.charCodeAt(0)};`);
const plain = node => node.type === 'text' ? node.data : (node.children ?? []).map(plain).join('');

function safeLink(value) {
  try {
    if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) && !/^[\d.]+$/.test(url.hostname)
      && !/\.(?:local|localhost|internal|home|lan|test)$/.test(url.hostname);
  } catch { return false; }
}

function markdown(source) {
  if (!source.trim()) return '';
  if (/\{\{[<%]/.test(source)) fail(409);
  const html = marked.parse(source, { async: false });
  // htmlparser2 repairs missing/stray closing tags and duplicate attributes.
  // Check the original token boundaries first, before using its decoded tree.
  const stack = [];
  for (let index = html.indexOf('<'); index !== -1; index = html.indexOf('<', index)) {
    const match = /^<(?:[^"'<>]|"[^"]*"|'[^']*')*>/.exec(html.slice(index));
    if (!match) fail(409);
    const token = match[0], tag = /^<(\/?)([a-z][a-z0-9]*)([\s\S]*?)>$/i.exec(token);
    if (!tag || !tags.has(tag[2].toLowerCase())) fail(409);
    const name = tag[2].toLowerCase();
    if (tag[1]) {
      if (tag[3].trim() || stack.pop() !== name) fail(409);
    } else {
      const seen = new Set();
      let rest = tag[3];
      while (rest.trim() && rest.trim() !== '/') {
        const attribute = /^\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/.exec(rest);
        if (!attribute || seen.has(attribute[1].toLowerCase())) fail(409);
        seen.add(attribute[1].toLowerCase());
        rest = rest.slice(attribute[0].length);
      }
      if (rest.trim() === '/' && !voidTags.has(name)) fail(409);
      if (!voidTags.has(name)) stack.push(name);
    }
    index += token.length;
  }
  if (stack.length) fail(409);
  new Parser({ onclosetag(name, implied) { if (implied && !voidTags.has(name)) fail(409); } }).end(html);
  function inspect(nodes, parent = null) {
    for (const node of nodes) {
      if (node.type === 'text') { if (!validText(node.data, 512 * 1024)) fail(409); continue; }
      if (node.type !== 'tag' || !tags.has(node.name)) fail(409);
      for (const [key, value] of Object.entries(node.attribs)) {
        if (!attributes[node.name]?.has(key) || !validText(value, 2000)) fail(409);
      }
      if (node.name === 'a' && !safeLink(node.attribs.href)) fail(409);
      if (node.name === 'ol' && node.attribs.start !== undefined && !/^[1-9][0-9]{0,5}$/.test(node.attribs.start)) fail(409);
      if (node.name === 'li' && !['ul', 'ol'].includes(parent)) fail(409);
      if (['ul', 'ol'].includes(node.name) && node.children.some(child => child.type === 'text' ? child.data.trim() : child.type !== 'tag' || child.name !== 'li')) fail(409);
      inspect(node.children ?? [], node.name);
    }
  }
  inspect(parseDocument(html, { decodeEntities: true }).children);
  return html;
}

function groupHeading(line, labelledby) {
  const match = /^###\s+(.+?)\s*$/.exec(line);
  if (!match) { if (labelledby) fail(409); return null; }
  const anchor = /\s+\{#([a-zA-Z][a-zA-Z0-9_-]*)\}\s*$/.exec(match[1]);
  if ((labelledby && anchor?.[1] !== labelledby) || (!labelledby && anchor)) fail(409);
  const titleSource = anchor ? match[1].slice(0, anchor.index) : match[1];
  const parsed = parseDocument(markdown(`### ${titleSource}`), { decodeEntities: true }).children.filter(n => n.type !== 'text' || n.data.trim());
  if (parsed.length !== 1 || parsed[0].name !== 'h3' || parsed[0].children.some(n => n.type !== 'text')) fail(409);
  const title = plain(parsed[0]);
  if (!validText(title, 100, true) || /[\r\n]/.test(title)) fail(409);
  return title;
}

export function legacyPostFields(document) {
  if (!document || !validText(document.body, 512 * 1024)) fail(409);
  const source = document.body.replace(/\r\n/g, '\n');
  const legacySection = /<section\b[^>]*\blanguage-discussion-group\b[^>]*>/g;
  const hasSection = [...source.matchAll(legacySection)].some(match => !/\bdata-publication-layout\s*=/.test(match[0]));
  if (!/\{\{[<%]/.test(source) && !hasSection) return null;
  const lines = source.split('\n');
  let index = 0;
  function region(closing = null) {
    const parts = [], pending = [];
    const flush = () => { parts.push(markdown(pending.join('\n'))); pending.length = 0; };
    while (index < lines.length) {
      const line = lines[index], trimmed = line.trim();
      if (trimmed === '</section>' || /^\{\{<\s*\/(?:card|replycard)\s*>\}\}$/.test(trimmed)) {
        const kind = trimmed === '</section>' ? 'section' : /^\{\{<\s*\/(card|replycard)/.exec(trimmed)[1];
        if (kind !== closing) fail(409);
        flush(); index++; return parts.join('');
      }
      const card = /^\{\{<\s*(card|replycard)\s*>\}\}$/.exec(trimmed);
      const section = /^<section class="(language-discussion-group(?: language-discussion-group--warm)?)" (aria-labelledby|aria-label)="([^"<>]+)">$/.exec(trimmed);
      const comments = /^\{\{<\s*commentsection\s+title="([^"<>]+)"\s*>\}\}$/.exec(trimmed);
      if (card) {
        flush(); index++;
        const inner = region(card[1]);
        parts.push(`<div data-publication-layout="${card[1] === 'card' ? 'card' : 'reply'}">${inner}</div>`);
      } else if (section) {
        flush(); index++;
        const aria = plain(parseDocument(section[3], { decodeEntities: true }));
        if (!validText(aria, 100, true) || /[\r\n]/.test(aria)) fail(409);
        while (index < lines.length && !lines[index].trim()) index++;
        const title = groupHeading(lines[index] ?? '', section[2] === 'aria-labelledby' ? aria : null);
        if (title !== null) index++;
        const inner = region('section');
        parts.push(`<div data-publication-layout="grouped" data-title="${escape(title ?? aria)}"${section[1].endsWith('--warm') ? ' data-tone="warm"' : ''}${title === null ? ' data-heading="none"' : ''}>${inner}</div>`);
      } else if (comments) {
        flush(); index++;
        // The known shortcode emits only a visible paragraph, with no body.
        const title = plain(parseDocument(comments[1], { decodeEntities: true }));
        if (!validText(title, 100, true)) fail(409);
        parts.push(`<p>${escape(title)}</p>`);
      } else {
        if (/\{\{[<%]|<\/?section\b/i.test(line)) fail(409);
        pending.push(line); index++;
      }
    }
    if (closing !== null) fail(409);
    flush(); return parts.join('');
  }
  const html = region();
  if (!validText(html, 512 * 1024)) fail(409);
  const metadata = document.metadata;
  const taxonomy = (values, max) => {
    if (values === undefined) return [];
    if (!Array.isArray(values) || values.length > max || values.some(value => !validText(value, 100, true)) || new Set(values).size !== values.length) fail(409);
    return [...values];
  };
  if (!metadata || !validText(metadata.title, 300, true) || /[\r\n]/.test(metadata.title)) fail(409);
  return { title: metadata.title, html, author: validText(metadata.author, 200, true) ? metadata.author : '豆瓣-女阅组', date: metadata.date instanceof Date ? metadata.date.toISOString() : validText(metadata.date, 100, true) ? metadata.date : '', license: validText(metadata.license, 300, true) ? metadata.license : '该作品版权归原作者所有。', categories: taxonomy(metadata.categories, 6), tags: taxonomy(metadata.tags, 50), relatedTerms: [], comments: [], presentation: 'article' };
}

// Checks the public numbers of articles and news before the site is built.
//
//   node scripts/check-slugs.mjs        fail on a duplicate number, or on a
//                                       number past data/website-publication-slugs.json
//   node scripts/check-slugs.mjs --fix  raise the registry to the highest
//                                       number in use, then check again
//
// The publishing receiver continues from the registry and never scans the
// content folders, so a hand-written article that takes the next number by
// itself must be recorded there (--fix) before anything else is published.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { validSlugRegistry } from '../publishing/lib/receiver.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const registryPath = join(root, 'data/website-publication-slugs.json');
const SECTIONS = { posts: '1', news: '2' };

export function usedSlugs(base = root) {
  const used = [];
  for (const section of Object.keys(SECTIONS)) {
    const folder = join(base, 'content', section);
    for (const name of readdirSync(folder)) {
      if (!name.endsWith('.md') || name === '_index.md') continue;
      const source = readFileSync(join(folder, name), 'utf8');
      const front = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---/.exec(source);
      const slug = front ? yaml.load(front[1])?.slug : undefined;
      if (typeof slug === 'string' || typeof slug === 'number') used.push({ section, file: `content/${section}/${name}`, slug: String(slug) });
    }
  }
  return used;
}

export function slugProblems(used, registry) {
  const problems = [], seen = new Map();
  for (const item of used) {
    const key = `${item.section}:${item.slug}`;
    if (seen.has(key)) problems.push(`${item.file} 与 ${seen.get(key)} 使用了同一个编号 ${item.slug}。`);
    seen.set(key, item.file);
    const match = /^(\d{2})(\d)(\d{3,})$/.exec(item.slug);
    if (!match || match[2] !== SECTIONS[item.section]) continue;
    const last = registry[item.section]?.[match[1]] ?? 0;
    if (Number(match[3]) > last) problems.push(`${item.file} 的编号 ${item.slug} 超过了编号登记（${item.section} ${match[1]} 年记到 ${last}）。运行 node scripts/check-slugs.mjs --fix 并提交。`);
  }
  return problems;
}

export function raisedRegistry(used, registry) {
  const next = structuredClone(registry);
  for (const item of used) {
    const match = /^(\d{2})(\d)(\d{3,})$/.exec(item.slug);
    if (!match || match[2] !== SECTIONS[item.section]) continue;
    next[item.section] ??= {};
    next[item.section][match[1]] = Math.max(next[item.section][match[1]] ?? 0, Number(match[3]));
  }
  return next;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  if (!validSlugRegistry(registry)) { console.error('data/website-publication-slugs.json is not a valid number registry.'); process.exit(1); }
  const used = usedSlugs();
  if (process.argv.includes('--fix')) {
    registry = raisedRegistry(used, registry);
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  }
  const problems = slugProblems(used, registry);
  if (problems.length) { for (const problem of problems) console.error(problem); process.exit(1); }
  console.log(`Public numbers checked: ${used.length} pages.`);
}

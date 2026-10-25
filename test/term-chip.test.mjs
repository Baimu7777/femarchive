import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const hugo = process.env.HUGO_BINARY || 'hugo';
let hasHugo = true;
try { execFileSync(hugo, ['version'], { stdio: 'ignore' }); } catch { hasHugo = false; }
test('term chips link current lexicon entries and resolve pending names on a later website build', { skip: !hasHugo && 'Hugo is required for rendering checks' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-term-chip-'));
  try {
    for (const path of ['layouts/_default','layouts/partials','content/posts','content/lexicon']) await mkdir(join(root,path), {recursive:true});
    await copyFile(fileURLToPath(new URL('../layouts/partials/publication-term-chip.html', import.meta.url)), join(root,'layouts/partials/publication-term-chip.html'));
    await writeFile(join(root,'hugo.toml'), 'baseURL="https://archive.example.com/"\n');
    await writeFile(join(root,'layouts/_default/single.html'), '{{ $page := . }}{{ range .Params.tags }}{{ partial "publication-term-chip.html" (dict "page" $page "name" .) }}{{ end }}');
    await writeFile(join(root,'content/posts/article.md'), '---\ntitle: Article\ntags: [Known, Pending, Legacy]\nrelated_terms: [Known, Pending]\n---\nBody');
    await writeFile(join(root,'content/lexicon/existing.md'), '---\ntitle: Known\n---\nDefinition');
    execFileSync(hugo,['--source',root,'--quiet']);
    let html = await readFile(join(root,'public/posts/article/index.html'),'utf8');
    assert.match(html, /href="\/lexicon\/existing\/"[^>]*>#Known<\/a>/);
    assert.match(html, /<span[^>]*>#Pending<\/span>/);
    assert.match(html, /href="\/tags\/legacy\/"[^>]*>#Legacy<\/a>/);
    await writeFile(join(root,'content/lexicon/later.md'), '---\ntitle: Pending\n---\nLater definition');
    execFileSync(hugo,['--source',root,'--quiet']);
    html = await readFile(join(root,'public/posts/article/index.html'),'utf8');
    assert.match(html, /href="\/lexicon\/later\/"[^>]*>#Pending<\/a>/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

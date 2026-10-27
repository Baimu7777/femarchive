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
    await copyFile(fileURLToPath(new URL('../layouts/partials/publication-term-articles.html', import.meta.url)), join(root,'layouts/partials/publication-term-articles.html'));
    await writeFile(join(root,'hugo.toml'), 'baseURL="https://archive.example.com/"\n');
    await writeFile(join(root,'layouts/_default/single.html'), '{{ $page := . }}{{ range .Params.tags }}{{ partial "publication-term-chip.html" (dict "page" $page "name" .) }}{{ end }}{{ partial "publication-term-articles.html" . }}');
    await writeFile(join(root,'content/posts/article.md'), '---\ntitle: Article\ntags: [Known, Pending, Legacy]\nrelated_terms: [Known, Pending]\n---\nBody');
    await writeFile(join(root,'content/lexicon/existing.md'), '---\ntitle: Known\n---\nDefinition');
    execFileSync(hugo,['--source',root,'--quiet']);
    let html = await readFile(join(root,'public/posts/article/index.html'),'utf8');
    assert.match(html, /href="\/lexicon\/existing\/"[^>]*>#Known<\/a>/);
    assert.match(html, /<span[^>]*>#Pending<\/span>/);
    assert.match(html, /href="\/tags\/legacy\/"[^>]*>#Legacy<\/a>/);
    await writeFile(join(root,'content/lexicon/later.md'), '---\ntitle: Pending\n---\nLater definition');
    await writeFile(join(root,'content/lexicon/from-tag.md'), '---\ntitle: legacy\n---\nCreated later from the lexicon page');
    execFileSync(hugo,['--source',root,'--quiet']);
    html = await readFile(join(root,'public/posts/article/index.html'),'utf8');
    assert.match(html, /href="\/lexicon\/later\/"[^>]*>#Pending<\/a>/);
    assert.match(html, /href="\/lexicon\/from-tag\/"[^>]*>#Legacy<\/a>/);
    const term = await readFile(join(root,'public/lexicon/from-tag/index.html'),'utf8');
    assert.match(term, /aria-label="关联文章"/);
    assert.match(term, /href="\/posts\/article\/"/);
    assert.match(term, />Article<\/h3>/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('a tag matching another name of an entry links to it, and so does a related article', { skip: !hasHugo && 'Hugo is required for rendering checks' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-term-alias-'));
  try {
    for (const path of ['layouts/_default','layouts/partials','content/posts','content/lexicon']) await mkdir(join(root,path), {recursive:true});
    for (const partial of ['publication-term-chip.html','publication-term-articles.html']) {
      await copyFile(fileURLToPath(new URL(`../layouts/partials/${partial}`, import.meta.url)), join(root,`layouts/partials/${partial}`));
    }
    await writeFile(join(root,'hugo.toml'), 'baseURL="https://archive.example.com/"\n');
    await writeFile(join(root,'layouts/_default/single.html'), '{{ $page := . }}{{ range .Params.tags }}{{ partial "publication-term-chip.html" (dict "page" $page "name" .) }}{{ end }}{{ partial "publication-term-articles.html" . }}');
    await writeFile(join(root,'content/posts/article.md'), '---\ntitle: Article\ntags: ["33F", "三争三反"]\n---\nBody');
    await writeFile(join(root,'content/lexicon/rule.md'), '---\ntitle: 三争三反\naliases: ["33F", "争反准则"]\n---\nDefinition');
    execFileSync(hugo,['--source',root,'--quiet']);
    const html = await readFile(join(root,'public/posts/article/index.html'),'utf8');
    // The entry's own name and one of its other names reach the same page.
    assert.equal(html.match(/href="\/lexicon\/rule\/"/g).length, 2);
    assert.match(html, /href="\/lexicon\/rule\/"[^>]*>#33F<\/a>/);
    const term = await readFile(join(root,'public/lexicon/rule/index.html'),'utf8');
    // An article tagged only with another name still shows up as related.
    assert.match(term, /href="\/posts\/article\/"/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('stance marks and the event flag come from the front matter the forum writes', { skip: !hasHugo && 'Hugo is required for rendering checks' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'publication-term-marks-'));
  try {
    for (const path of ['layouts/_default','layouts/partials','content/lexicon']) await mkdir(join(root,path), {recursive:true});
    await copyFile(fileURLToPath(new URL('../layouts/partials/publication-term-marks.html', import.meta.url)), join(root,'layouts/partials/publication-term-marks.html'));
    await writeFile(join(root,'hugo.toml'), 'baseURL="https://archive.example.com/"\n');
    await writeFile(join(root,'layouts/_default/single.html'), '<main>{{ partial "publication-term-marks.html" . }}</main>');
    await writeFile(join(root,'content/lexicon/event.md'), '---\ntitle: 事件词条\npolarity: negative\nevent: true\n---\nDefinition');
    await writeFile(join(root,'content/lexicon/plain.md'), '---\ntitle: 普通词条\npolarity: unmarked\nevent: false\n---\nDefinition');
    await writeFile(join(root,'content/lexicon/legacy.md'), '---\ntitle: 旧词条\n---\nDefinition');
    execFileSync(hugo,['--source',root,'--quiet']);
    const flagged = await readFile(join(root,'public/lexicon/event/index.html'),'utf8');
    assert.match(flagged, /class="lexicon-mark lexicon-mark--negative"[^>]*aria-label="反女权立场"/);
    assert.match(flagged, /class="lexicon-event"[^>]*aria-label="事件"/);
    assert.match(flagged, /<svg[^>]*viewBox="0 0 16 16"/);
    for (const page of ['plain','legacy']) {
      const html = await readFile(join(root,`public/lexicon/${page}/index.html`),'utf8');
      assert.doesNotMatch(html, /lexicon-mark|lexicon-event/);
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});

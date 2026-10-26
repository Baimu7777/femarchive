import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyPostFields } from '../publishing/lib/legacy-post.mjs';
import { publicBody, articleFields } from '../publishing/lib/document.mjs';

const document = body => ({ body, metadata: { title: '字词整理', categories: ['语言回声', '思考讨论'], tags: ['语言'] } });
const compact = html => html.replace(/>\s+</g, '><').trim();

// Missing group conversion or Markdown rendering would discard the original
// heading, card boundaries, prose, emphasis, links or nested list structure.
test('recovers known groups and cards while preserving Markdown content and metadata', () => {
  const result = legacyPostFields(document(`## 字词整理

正文 **强调** [来源](https://example.org/source)

{{< commentsection title="讨论区" >}}

<section class="language-discussion-group" aria-labelledby="language-discussion-01">

### 关于“妙” {#language-discussion-01}

{{< card >}}
第一段。

第二段 **粗体**。

- 甲
- 乙
{{< /card >}}

{{< replycard >}}
#### 回复标题

回应内容。
{{< /replycard >}}

</section>

<section class="language-discussion-group language-discussion-group--warm" aria-label="补充讨论">

{{< card >}}
无可见标题的正文。
{{< /card >}}

</section>`));
  assert.equal(result.title, '字词整理');
  assert.deepEqual(result.categories, ['语言回声', '思考讨论']);
  assert.deepEqual(result.tags, ['语言']);
  assert.deepEqual(result.relatedTerms, []);
  assert.deepEqual(result.comments, []);
  assert.equal(result.presentation, 'article');
  assert.match(result.html, /<h2>字词整理<\/h2>/);
  assert.match(result.html, /<strong>强调<\/strong>/);
  assert.match(result.html, /href="https:\/\/example.org\/source"/);
  assert.match(result.html, /data-publication-layout="grouped" data-title="关于“妙”"/);
  assert.doesNotMatch(result.html, /<h3>|language-discussion-01|\{\{/);
  assert.match(compact(result.html), /<div data-publication-layout="card"><p>第一段。<\/p><p>第二段 <strong>粗体<\/strong>。<\/p><ul><li>甲<\/li><li>乙<\/li><\/ul><\/div>/);
  assert.match(compact(result.html), /<div data-publication-layout="reply"><h4>回复标题<\/h4><p>回应内容。<\/p><\/div>/);
  assert.match(result.html, /data-title="补充讨论" data-tone="warm" data-heading="none"/);
  assert.match(result.html, /讨论区/);
  const body = publicBody(result.html, [], [], result.presentation);
  assert.match(body, /class="language-discussion-group language-discussion-group--warm"/);
  const recovered = articleFields({ metadata: { title: result.title }, body });
  assert.equal(compact(recovered.html), compact(result.html));
});

test('preserves every ordinary heading level and escaped literal text inside cards', () => {
  const source = ['# 一', '## 二', '### 三', '#### 四', '##### 五', '###### 六', '&lt;literal&gt; &amp; 字词'].join('\n\n');
  const result = legacyPostFields(document(`{{< card >}}\n${source}\n{{< /card >}}`));
  for (let level = 1; level <= 6; level++) assert.match(result.html, new RegExp(`<h${level}>`));
  assert.match(result.html, /&lt;literal&gt; &amp; 字词/);
});

test('returns null for articles without legacy design, including canonical markers', () => {
  assert.equal(legacyPostFields(document('## 普通文章\n\n正文')), null);
  assert.equal(legacyPostFields(document('<div data-publication-layout="card"><p>正文</p></div>')), null);
});

// Relaxing source validation must never silently strip an unsupported element,
// shortcode parameter, attribute, or malformed boundary from an approved file.
test('rejects unsupported or unbalanced source before it can be rewritten', () => {
  for (const source of [
    '{{< unknown >}}',
    '{{% card %}}正文{{% /card %}}',
    '{{< card color="red" >}}\n正文\n{{< /card >}}',
    '{{< replycard to="某人" >}}\n正文\n{{< /replycard >}}',
    '{{< card >}}\n正文',
    '{{< /card >}}',
    '{{< card >}}\n{{< replycard >}}\n正文\n{{< /card >}}\n{{< /replycard >}}',
    '<section class="language-discussion-group" aria-label="补充" style="color:red">\n正文\n</section>',
    '<section class="language-discussion-group extra" aria-label="补充">\n正文\n</section>',
    '<section class="language-discussion-group" aria-label="补充" aria-label="重复">\n正文\n</section>',
    '<section class="language-discussion-group" aria-labelledby="missing">\n正文\n</section>',
    '<section class="language-discussion-group" aria-labelledby="id">\n### 标题 {#other}\n\n正文\n</section>',
    '<section class="language-discussion-group" aria-label="补充">\n正文',
    '{{< card >}}\n<div>额外容器</div>\n{{< /card >}}',
    '{{< card >}}\n<p onclick="alert(1)">正文</p>\n{{< /card >}}',
    '{{< card >}}\n<p title="keep">正文</p>\n{{< /card >}}',
    '{{< card >}}\n<script>alert(1)</script>\n{{< /card >}}',
    '{{< card >}}\n![远程图片](https://example.org/image.png)\n{{< /card >}}',
    '{{< card >}}\n[链接](javascript:alert(1))\n{{< /card >}}',
    '{{< card >}}\n<p>未闭合\n{{< /card >}}',
    '{{< card >}}\n<ul>列表外文本<li>保留</li></ul>\n{{< /card >}}',
    '{{< card >}}\n<ul><p>列表外段落</p></ul>\n{{< /card >}}',
    '{{< card >}}\n<li>没有列表的项目</li>\n{{< /card >}}',
    '{{< card >}}\n<p><p>错误嵌套</p></p>\n{{< /card >}}',
  ]) assert.throws(() => legacyPostFields(document(source)), { status: 409 }, source);
});

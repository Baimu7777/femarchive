# 女权文库 Hugo 站点

这是一个可直接运行的最小完整 Hugo 文库站版本，文章由 Markdown 驱动，列表页、分类页、标签页、单篇页与搜索索引自动生成。

## 目录说明

- `config/_default/hugo.toml`：站点配置、菜单、分类法、相关内容、搜索输出格式
- `archetypes/default.md`：新文章模板
- `content/posts/*.md`：文章内容，每篇文章一个 Markdown 文件
- `content/search/index.md`：搜索页
- `content/submit/index.md`：投稿页
- `content/categories/_index.md`：分类总览页
- `content/tags/_index.md`：标签总览页
- `layouts/_default/baseof.html`：基础布局
- `layouts/index.html`：主页
- `layouts/_default/list.html`：列表页（全部文章、分类下文章、标签下文章）
- `layouts/_default/single.html`：单篇文章页
- `layouts/_default/terms.html`：分类/标签总览页
- `layouts/search/single.html`：搜索页模板
- `layouts/submit/single.html`：投稿页模板
- `layouts/index.json.json`：搜索索引 JSON
- `layouts/partials/*`：头部、导航、页脚、文章卡片等局部模板
- `assets/css/main.css`：主样式
- `static/js/search.js`：前端搜索脚本

## 本地运行

```bash
hugo server -D
```

如果你不想显示草稿文章：

```bash
hugo server
```

## 构建上线文件

```bash
hugo
```

生成结果会出现在 `public/` 目录。

## 新建文章

```bash
hugo new posts/your-article.md
```

然后编辑生成的 Markdown 文件，重点维护 front matter：

```yaml
---
title: "标题"
description: "摘要"
date: 2025-07-29T18:12:41+08:00
lastmod: 2025-07-29T18:12:41+08:00
slug: "article-slug"
math: false
license: "CC BY-NC-SA 4.0"
hidden: false
comments: true
draft: false
featured: false
categories:
  - 思考
tags:
  - 讨论
  - 归档
keywords:
  - 关键词1
  - 关键词2
style:
  background: "#fb9968"
  color: "#FFC0CB"
---
```

## 已支持的内容管理方式

- 首页精选文章：给文章设置 `featured: true`
- 最近更新：按日期自动抓取最新文章
- 全部文章：自动列出 `content/posts/` 下的内容
- 分类页：由 `categories` 自动生成
- 标签页：由 `tags` 自动生成
- 搜索页：搜索标题、摘要、正文、分类、标签、关键词
- 投稿页：跳转到外部 Google 表单/Spreadsheet

## 上线前建议替换的内容

1. `config/_default/hugo.toml` 里的 `baseURL`
2. `config/_default/hugo.toml` 里的 `params.submission_url`
3. 示例文章内容
4. 站点标题、标语、描述

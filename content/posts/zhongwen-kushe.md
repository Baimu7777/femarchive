---
title: "为什么要做一个长期可维护的文库站"
description: "关于文库、归档与长期维护的一篇站务说明。"
date: 2025-07-29T18:12:41+08:00
lastmod: 2025-07-29T18:12:41+08:00
slug: "why-a-library-site"
math: false
license: "CC BY-NC-SA 4.0"
hidden: false
comments: true
draft: false
featured: true
categories:
  - 思考
tags:
  - 归档
  - 备份
  - 整理
keywords:
  - 文库
  - 博客
  - Hugo
style:
  background: "#f7e8ff"
  color: "#5d2e86"
---

## 作为文库，而不是论坛

这个站点以文章为核心，重点放在**可检索、可归档、可长期维护**的文本内容上。它适合放原创长文、讨论整理、转载、备份与资料归档，而不是即时互动或灌水式讨论。

## 为什么改成 Hugo

纯静态 HTML 手写页面，在文章数量变多之后会出现几个问题：

1. 新增文章时需要重复维护列表页、文章页、分类页；
2. 文章结构容易失去统一；
3. 搜索、分类、标签等能力难以长期维护；
4. 改版时需要大面积手动同步。

Hugo 的好处是把文章内容交给 Markdown，把页面结构交给模板。以后新增内容时，主要维护 `content/posts/*.md` 即可。

## 以后怎样更新

最常见的工作流是：

- 新建一篇 Markdown；
- 在 front matter 里写好标题、摘要、日期、分类、标签；
- 把正文写完；
- 重新构建站点。

文章页、列表页、分类页、标签页、搜索索引都会自动更新。

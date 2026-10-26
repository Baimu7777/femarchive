---
title: 词条
description: 整理中的词条与文章。
outputs: [HTML, JSON]
build:
  list: never
  render: always
sitemap:
  disable: true
cascade:
  build:
    list: local
    render: always
  sitemap:
    disable: true
  params:
    unlisted: true
---

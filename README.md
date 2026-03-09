# 女阅组文库 Hugo 版本（按参考静态页排版改写）

这是一个可以长期维护的 Hugo 文库站。

## 特点

- 首页、全部文章、分类查看、搜索、投稿，整体排版贴近你提供的静态页
- 文章内容全部由 `content/posts/*.md` 驱动
- 单篇文章使用明显的左宽右窄博客布局
- 搜索页与全部文章页使用 `index.json + 前端 JS` 过滤标题、摘要、标签、关键词、正文
- 分类页使用 Hugo taxonomy 自动生成
- 已附带 `vercel.json` 与 `build.sh`

## 使用

```bash
hugo server -D
```

## 更新文章

1. 在 `content/posts/` 新建或修改 `.md`
2. 确保 `draft: false`
3. 提交到 GitHub
4. 让 Vercel 自动重新部署

# 公开编号、新闻栏目与旧文章登记（2026-10-30）

## 公开编号

文章和新闻在首次发布时由接收端分配数字网址，文件仍按内部 UUID 命名：

| 类型 | 格式 | 例子 |
| --- | --- | --- |
| 文章 | `YY1NNN` | `/posts/261041/` |
| 新闻 | `YY2NNN` | `/news/262008/` |

- `YY` 是**首次发布到文库那一年**（中国时间）的后两位。新闻的显示和排序日期另由 `date` 决定，可以是历史日期；编号年份与新闻日期无关。
- `NNN` 至少三位、补零，超过 999 自然变长（`2611000`），不会截断。
- 编号只从 `data/website-publication-slugs.json` 往下接，不按文章数量计算。这个文件和那篇文章在**同一个提交**里更新，所以：
  - 重试同一请求沿用原编号；更新不重新编号；
  - 两次并发发布基于同一版本时，后到的那次因分支已移动而什么都不写，重新发送会拿到下一个号；
  - 删除文章不会退回编号，号码不会再被用；
  - 一批里的新文章按顺序连续编号。
- 词条（`lexicon`）仍用原来的 UUID 网址，不受影响。

### 手写文章

手动在 `content/posts`、`content/news` 加文章时，请在 front matter 里写好 `slug`，然后运行：

```
node scripts/check-slugs.mjs --fix
```

它把编号登记抬到已用的最大号并检查重号。构建（`build.sh`）会运行 `node scripts/check-slugs.mjs`：出现重号，或手写编号超过登记时构建失败，并说明怎么修。登记文件缺失时，接收端拒绝新建文章（`SLUG_REGISTRY_INVALID`），不会从 001 重新开始。

### 已迁移的旧网址

`content/posts/73f3b15d-c37e-427c-ad21-8d1bd69aeaba.md` 是编号上线前用 UUID 网址发布的，已改为 `slug: "261040"`：

- `aliases` 保留旧地址 `/posts/73f3b15d-…/`，访问会跳到新地址；
- `comment_path` 让 Waline 评论和评论计数继续读旧路径上的评论串（`layouts/partials/waline.html`、`card.html`、`index.html`、`news/list.html` 都已改为优先使用 `comment_path`）。
- 论坛里记录的旧网址仍能打开（跳转），下次更新这篇时会换成新地址。

## 新闻栏目

论坛的「新建文库内容」可以选「新闻」。接收端对 `section: "news"`：

- 写入 `content/news/<UUID>.md`，分配 `YY2NNN`；
- `date` 用论坛填的发布时间（`publishDate`），列表和详情按它显示、排序；
- `original_url` 写成 `[来源名称](链接)`，只有名称或只有链接时各写一项；侧栏照旧按 Markdown 显示可读名称；
- 不写作者（除非明确提供）、不写分类、不带评论；
- 更新时 `date` 和 `original_url` 随之改写，编号不变。

读取（`operation=article&section=news`）会把 `date`、`original_url` 拆回 `publishDate`、`sourceName`、`sourceUrl`。

## 文章分类可以更新

论坛更新文章时会带 `replaceCategories: true`，接收端据此改写 `categories`；不带这个字段的旧请求仍保留文库原有分类。

## 旧文章登记

`publishing/existing-posts.mjs` 由 `scripts/register-legacy-posts.mjs` 生成，登记 `content/posts`、`content/news` 中所有带数字 `slug` 的手写文件（当前 39 篇文章、7 条新闻），每条钉住提交里的 Git blob。登记里带标题和编号，`operation=articles` 不再逐篇读取文件。

- 文件在首次被论坛接手前被手动改过，接收端会拒绝（`IMPORTED_POST_CHANGED`）。重新运行 `node scripts/register-legacy-posts.mjs` 并提交即可；`--check` 只检查不改写。
- 论坛写过的文件（文件名是 UUID）不登记，它们本来就由接收端管理。
- 编辑器读不回来的排版（自定义 HTML、未知短代码、无法安全改写的 front matter）会被拒绝并带上 `LEGACY_MARKUP`，论坛据此说明原因；不会静默丢内容或强行覆盖。

## 部署

先部署本仓库（接收端和站点），再部署论坛：新版论坛会发送 `section: "news"`、`replaceCategories` 等字段，旧接收端会拒收。新接收端对旧论坛完全兼容（这些字段都是可选的）。

`deploy/hugo-publisher`（论坛仓库里的接收端副本）早已落后于本仓库，本次没有同步；以本仓库为准。

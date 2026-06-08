---
title: "零基础发帖指南：如何在文库网站发布、预览与修订文章"
description: "第一次发帖时，可以直接照着第一部分操作；GitHub 原理、文章属性、图片插入和短代码说明可按需查阅。"
date: 2026-06-08
slug: "posting"
draft: false
comments: false
author: ""
build:
  list: never
  render: always
license: ""
toc_numbered: false
---

**发帖时，直接照着第 1 部分一步一步操作即可。**  

需要了解 GitHub 原理、修改文章属性、插入图片或使用特殊排版时，再跳到后面的对应部分查阅。

> **每次发帖只需要记住一个顺序：先 Pull 同步，再写文章，接着本地预览，最后 Commit 和 Push。**

有啥不会写的都可以去翻翻之前的文章写法抄一下。有啥问题卡住了可以在豆瓣私聊@BooM，或者notion的网站反馈页直接留言。

---

# 1. 日常发帖

如果这是你第一次参与网站维护，电脑中还没有网站文件夹，请先阅读[第一次使用前的准备](#first-use)。

## 1.1 第一步：打开 GitHub Desktop，同步最新版本

每次开始编辑前，都要先把她人已经上传的更新同步到自己的电脑。

1. 打开 **GitHub Desktop**。
2. 查看左上角，确认当前仓库是文库网站对应的仓库。
3. 点击顶部的 **Fetch origin**。
4. 如果按钮随后变成 **Pull origin**，再点击一次 **Pull origin**。
5. 如果按钮仍然显示 **Fetch origin**，说明电脑里的网站已经是最新版本。

完成这一步后，再开始写文章。

> 不要先改文章，最后才想起来 Pull。
> 
> 先同步再编辑，可以减少多人协作时的文件冲突。

## 1.2 第二步：用 VS Code 打开网站文件夹

在 GitHub Desktop 中，点击 **Open in Visual Studio Code**。
![](/images/posting1.png)

VS Code 打开后，左侧会显示网站文件夹。正常情况下，可以看到：

```text
content
layouts
static
config
```

日常发帖主要会使用`content`和 `static`两个文件夹

其中：

- `content` 用来保存文章；
- `static` 用来保存图片。

## 1.3 第三步：打开终端

终端是 VS Code 下方的一块输入区域。创建文章和启动本地预览时，需要在这里输入命令。

打开方法：

1. 在 VS Code 顶部菜单栏中点击 **终端**。
2. 点击 **新建终端**。
3. 页面下方会出现一个可以输入文字的区域。
4. 鼠标点击终端中最后一行闪烁光标的位置，即可输入命令。

也可以使用快捷键：

```text
Ctrl + Shift + `
```

键盘上的反引号 `` ` `` 通常位于数字 `1` 左侧。

## 1.4 第四步：创建一篇新文章

### 创建普通文章

在终端中输入：

```powershell
hugo new content/posts/20260608-example.md
```

然后按下回车键。

命令运行后，VS Code 左侧的：

```text
content/posts
```

文件夹中会出现一个新的 `.md` 文件。

点击这个文件，即可开始编辑。

### 创建新闻或女性人物页面

如果要发布的不是普通文章，只需要替换命令中的文件夹名称：

| 内容类型 | 创建命令 |
| --- | --- |
| 普通文章 | `hugo new content/posts/20260608-example.md` |
| 新闻文章 | `hugo new content/news/20260608-example.md` |
| 女性人物 | `hugo new content/figures/20260608-example.md` |

文件名建议只使用英文字母、数字和短横线，不要使用空格。例如：

```text
20260608-example.md
20260608-women-news.md
20260608-figure-name.md
```

文件名只是电脑中的名称，可以随意设置。拿不准可以看看文件夹里别的文件都是怎么写的。网页地址是通过文章开头的 `slug` 单独设置的。

## 1.5 第五步：填写文章属性

打开刚刚创建的 `.md` 文件后，最上方会出现一段被两条 `---` 包起来的内容。这部分叫作文章属性，也叫 Front Matter。

对于属性填写，可查看 [文章属性设置](#4-文章属性设置)。

小诀窍：搞不懂到底怎么填的时候可以找一下其她文章的填写进行参考。比如`04自由派如何接管女性解放运动.md`这篇填的就比较完整。

## 1.6 第六步：在第二条 `---` 下方写正文

文章属性结束后，在第二条 `---` 的下一行开始写正文。

例如：

```md
---
title: "示例文章"
description: "这是一篇示例文章。"
date: 2026-06-08
...
---

这里开始写正文。

这是第二段。两个段落之间需要空一行。
```

可以在notion里面写作，写完之后全选复制到VScode内，会自带md格式。

写作格式、插入图片、链接、引用、卡片或折叠内容时，可以跳到 [Markdown、图片与短代码](#5-按需查阅markdown图片与短代码)。

正文写完后，按：

```text
Ctrl + S
```

保存文件。

## 1.7 第七步：在本地预览文章

不要写完就直接上传。先在自己的电脑上打开网站检查一次。

在 VS Code 下方的终端中输入：

```powershell
hugo server
```

按下回车键后，在浏览器中打开：

```text
http://localhost:1313/
```

这时看到的是电脑中的本地预览，不是已经公开发布的网站。

只要终端没有关闭，本地预览就会保持运行。修改文章并按 `Ctrl + S` 保存后，浏览器通常会自动刷新。

### 草稿为什么没有显示？

如果文章属性中写着：

```yaml
draft: true
```

普通预览不会显示文章。此时在终端中输入：

```powershell
hugo server -D
```

其中，`-D` 表示同时预览草稿。

### 怎样停止预览？

检查完成后，点击终端区域，然后按：

```text
Ctrl + C
```

即可停止本地预览。

### 发布前至少检查这些内容

- 标题、简介和作者是否正确。
- 文章是否出现在预期页面中。
- 分类和标签是否合适。
- 网页中的链接是否能正常打开。
- 图片是否正常显示。
- 段落之间是否有空行。
- `slug` 是否与其她文章重复。
- 准备公开发布的文章是否设置为 `draft: false`。

## 1.8 第八步：Commit 并 Push，正式发布

本地预览没有问题后，回到 **GitHub Desktop**。

1. 左侧 **Changes** 页面会列出刚刚新增或修改的文件。
2. 检查文件列表，确认没有误改无关文件。
3. 在左下角的 **Summary** 中填写一句修改说明。
4. 点击 **Commit to main**。
5. 点击顶部的 **Push origin**。

Summary 可以简单写成：

```text
post: 新增 20260608 文章标题
news: 新增 20260608 新闻
fix: 修订 261001 错别字
```

完成 Push 后，修改会上传到 GitHub。网站接入部署平台后，线上页面通常也会自动更新。

> **Commit 不等于发布。**  
> Commit 只是把修改保存成一个版本；完成 Push 后，线上仓库才会收到更新。

## 1.9 已发布文章需要修改时怎么办？

修改旧文章时，不需要重新创建文件。

1. 打开 GitHub Desktop，先点击 **Fetch origin**；如果出现 **Pull origin**，继续点击。
2. 点击 **Repository → Open in Visual Studio Code**。
3. 在 VS Code 左侧打开 `content` 文件夹。
4. 普通文章在 `content/posts`，新闻在 `content/news`，女性人物在 `content/figures`。
5. 找到对应的 `.md` 文件并编辑。
6. 按 `Ctrl + S` 保存。
7. 在终端中输入 `hugo server`，本地预览。
8. 检查无误后，回到 GitHub Desktop，Commit 并 Push。

文件太多、不知道文章在哪里时，可以在 VS Code 中按：

```text
Ctrl + Shift + F
```

搜索文章标题或 `slug`。

# 2. 第一次使用前的准备 {#first-use}

本节只需要在第一次参与网站维护时阅读。准备完成后，日常发帖直接从第 1 部分开始即可。

## 2.1 需要准备什么？

第一次参与网站维护时，需要：

- 一个 GitHub 账号；
- 网站管理员发出的仓库协作者邀请；
- GitHub Desktop；
- VS Code；
- Hugo Extended。

| 软件 | 用途 |
| --- | --- |
| [GitHub Desktop](https://central.github.com/deployments/desktop/desktop/latest/win32) | 用按钮完成同步、保存版本、上传和回退 |
| [VS Code](https://code.visualstudio.com/sha/download?build=stable&os=win32-x64-user) | 打开网站文件夹、编辑文章、运行预览命令 |
| [Hugo](https://github.com/gohugoio/hugo/releases/download/v0.148.1/hugo_extended_0.148.1_windows-amd64.zip) | 在电脑上创建文章文件并预览网站 | 

## 2.2 怎样检查 Hugo 是否安装成功？

安装完成后：

1. 打开 VS Code。
2. 点击顶部菜单栏的 **终端 → 新建终端**。
3. 在下方终端中输入：

```powershell
hugo version
```

4. 按下回车键。

如果终端显示 Hugo 的版本号，说明 Hugo 已经安装成功。

## 2.3 第一次怎样把网站下载到电脑？

网站管理员需要先把你的 GitHub 账号加入仓库协作者。接受邀请后：

1. 打开 GitHub Desktop，登录自己的 GitHub 账号。
2. 点击 **File → Clone repository**。
3. 在列表中选择文库网站对应的仓库。
4. 选择一个方便找到的本地文件夹。
5. 点击 **Clone**。
6. 下载完成后，点击 **Open in Visual Studio Code**。

此后，电脑上的这个文件夹就是网站的本地副本。

不要每次发帖都重新 Clone，也不要随意移动或删除里面的文件夹。

---
接下来的部分是选读，建议先通读目录，对需要的内容选择性查看。

---
# 3. GitHub 原理

## 3.1 GitHub 到底在做什么？

可以把整个网站理解成一个多人共同维护的文件夹。

GitHub 的特别之处在于：它会记录每一次修改。因此，大家不仅可以共同更新网站，也可以查看修改历史，必要时回到之前的版本。

| 名称 | 可以怎样理解 | 什么时候使用 |
| --- | --- | --- |
| Repository，仓库 | 整个网站文件夹 | 网站的全部内容都在这里 |
| Clone | 第一次把线上网站完整下载到电脑 | 第一次参与维护时 |
| Fetch | 检查线上有没有新修改 | 每次开始编辑前 |
| Pull | 把她人已经上传的修改同步到电脑 | Fetch 后发现更新时 |
| Commit | 给当前修改拍一张快照，并写一句说明 | 本地预览确认后 |
| Push | 把自己的 Commit 上传到 GitHub | Commit 之后 |
| Branch，分支 | 临时开一条独立编辑线 | 修改较多或需要审核时 |

## 3.2 多人怎样同时协作？

如果只是分别发布不同文章，小型协作组可以直接在主分支工作，但要遵守三条规则：

1. 每次编辑前先 Pull。
2. 不要同时修改同一个 `.md` 文件。
3. 新文章的文件名、`slug` 和图片文件名不要与她人的重复。

如果要修改同一篇文章，或者一次修改很多文件，最好使用分支：

1. 在 GitHub Desktop 顶部点击 **Current Branch**。
2. 点击 **New Branch**。
3. 给分支取一个容易理解的名字，例如：

```text
post-new-article
fix-261001-typo
```

4. 在这个分支中编辑、Commit 和 Push。
5. 最终在 GitHub 网页中检查修改并合并。

可以把分支理解成“先在自己的草稿副本中修改，确认后再合并进正式网站”。

## 3.3 改错了，怎样回退？

不用慌。GitHub 最大的优点之一，就是大部分误操作都能撤销。

| 情况 | 操作方式 |
| --- | --- |
| 文件改错了，但还没有 Commit | 在 GitHub Desktop 的 **Changes** 页面选中文件，右键点击 **Discard Changes** |
| 刚刚 Commit，但还没有 Push | 在 GitHub Desktop 的 **Changes** 页面底部点击 **Undo** |
| 已经 Push 到线上 | 打开左侧 **History**，右键点击需要撤销的 Commit，选择 **Revert Changes in Commit**，然后再 Push |
| 连续做了多个本地 Commit，但尚未 Push | 打开 **History**，右键点击想回到的版本，选择 **Reset to commit** |

已经 Push 的内容不要随便使用 Reset。多人协作时，优先使用 **Revert Changes in Commit**。它会新增一条撤销记录，不会悄悄改写大家已经共享的历史。

---

# 4. 文章属性设置

每个 `.md` 文件开头都有一段被两条 `---` 包起来的内容。例如：

```yaml
---
title: "我‘不’和我‘恰好不’的区别"
description: "一句话说明文章在讨论什么。"
date: 2026-06-08
slug: "261028"
draft: false
comments: true
author: "作者名"
categories:
  - "理论分野"
tags:
  - "8b4t"
related_reading:
  - "/posts/261001/"
original_url: "[原文标题](https://example.com)"
original_date: 2021-05-27
license: "该作品版权归原作者所有。"
---
```

这部分叫作文章属性，也叫 Front Matter。第二条 `---` 下面才是正文。

## 4.1 常用属性怎样填写？

| 属性 | 用途 | 怎样填写 |
| --- | --- | --- |
| `title` | 页面标题 | 必填。使用引号包起来最稳妥 |
| `description` | 首页卡片和搜索结果中的简介 | 建议填写一到两句话 |
| `date` | 网站中的发布日期和排序依据 | 通常保留创建文章时自动生成的日期 |
| `slug` | 网页地址最后一段 | [命名规则](#slug-rule) |
| `draft` | 是否为草稿 | `true` 表示不公开；`false` 表示可发布 |
| `comments` | 是否显示页面底部的在线评论区 | `true` 开启；`false` 关闭 |
| `author` | 作者 | 可以填写普通文字，也可以填写 Markdown 链接 |
| `categories` | 大类 | [分类](#43-网站现有的普通文章分类categories) |
| `tags` | 更细的关键词 | 可以填写多个，随意定义，也可以参考以前文章 |
| `related_reading` | 手动添加相关文章 | [每行填写一篇站内文章的路径](#46-怎样设置相关文章related-reading)，可留空 |
| `original_url` | 原文链接 | 转载或归档文章建议填写 |
| `original_date` | 原文首次发布日期 | 与网站收录日期不同，可留空 |
| `license` | 版权说明 | 默认写“该作品版权归原作者所有。”，按实际情况调整 |


这个链接主要是放在`related_reading`这一栏进行使用。

如果 `slug` 留空，网站会根据文件名生成链接。填写 `slug` 可以让链接更加简洁、稳定，也方便分享。

## 4.2 本网站怎样编写 slug？ {#slug-rule}

本网站中，文章 `slug` 的格式为：

```text
年份 + 文章类型编号 + 顺序编号
```

文章类型编号：

| 序号 | 文章类型 |
| --- | --- |
| 1 | 普通文章 |
| 2 | 新闻文章 |
| 3 | 女性人物 |

例如：

```yaml
slug: "261028"
```

其中：

- `26` 表示文章发表年份为 2026 年；
- `1` 表示这是一篇普通文章；
- `028` 表示这是对应类型中的第 28 篇文章。

## 4.3 网站现有的普通文章分类{#categories}

普通文章尽量从下面六个分类中选择：

```text
理论分野
结构辨析
语言回声
狩猎经验
女身优势
思考讨论
```

标签可以更灵活，不需要拘泥于这六类。

## 4.4 多个分类、多个标签怎样写？

每一项单独占一行，前面保留两个空格和一个短横线：

```yaml
categories:
  - "理论分野"
  - "结构辨析"
tags:
  - "8b4t"
  - "女性主义"
```

只有一个分类时，也保持同样的格式。

## 4.5 怎样填写作者链接和原文链接？

只显示作者名：

```yaml
author: "作者名"
```

希望作者名可以点击：

```yaml
author: "[作者名](https://example.com)"
```

原文链接也可以这样写：

```yaml
original_url: "[原文标题](https://example.com)"
```

## 4.6 怎样设置相关文章？{#related-reading}

希望文章末尾手动显示相关阅读时，可以填写：

```yaml
related_reading:
  - "/posts/261001/"
  - "/posts/261002/"
```

每一行放一篇站内文章链接。如果不需要手动推荐，可以删除整个 `related_reading` 区块，或者保持为空。

普通文章页面链接的格式是：

```text
/posts/slug/
```

新闻页面链接的格式是：

```text
/news/slug/
```

女性人物页面链接的格式是：

```text
/figures/slug/
```

例如：

```yaml
slug: "261028"
```

对应的普通文章链接就是：

```text
/posts/261028/
```


## 4.7 不想公开发布时，应该怎样设置？

这里有两种完全不同的情况。

### 情况一：还是草稿，任何人都不应该在线上打开

设置：

```yaml
draft: true
```

这种文章不会被正常发布。自己在本地检查时，使用：

```powershell
hugo server -D
```

### 情况二：不出现在网站列表和搜索中，但知道链接的人可以打开

设置：

```yaml
draft: false
build:
  list: never
  render: always
```

例如：

```yaml
slug: "private-reading-note"
draft: false
build:
  list: never
  render: always
```

页面仍然会生成，可以通过下面的链接直接访问：

```text
/posts/private-reading-note/
```

但它不会出现在普通文章列表、首页最近更新和站内搜索中。

这种设置只能算“未列出”，不是严格的隐私保护。任何得到链接的人仍然可以打开，也可能继续转发链接。真正不能公开的内容不要上传到公开仓库和网站。

## 4.8 文章属性最容易出错的地方

- 开头和结尾的 `---` 不要删除。
- 属性名后面使用英文冒号 `:`，不要误写成中文全角冒号 `：`。
- `draft: true` 和 `comments: false` 这类布尔值不要加引号。
- 分类和标签前面的缩进不要删掉。
- 已经发布的文章不要轻易修改 `slug`，否则旧链接可能失效。
- `date` 控制网站排序。归档旧文时，网站收录日期和原文日期可以分别写在 `date` 与 `original_date` 中。

---

# 5. Markdown、图片与短代码

遇到具体需求时，直接找到对应小节即可。

## 5.1 如何快速写出正确的格式？

正文可以先在 Notion 中完成，再复制到 `.md` 文件。大部分普通段落、标题、加粗、引用和列表会比较顺利地保留下来。

复制后仍然建议在本地预览一次，尤其检查：

- 图片是否仍然能够显示。Notion 中的图片需要下载后，重新放进网站的 `static/images` 文件夹。
- 段落之间是否有空行。
- 标题层级是否合理。
- 外部链接是否完整。
- 脚注和特殊排版是否正确。

遇到排版问题时，也可以把 `.md` 文本交给 AI，让 AI 在不改动正文内容的前提下整理 Markdown 格式。

## 5.2 常用 Markdown 语法

### 标题

```md
# 一级标题
## 二级标题
### 三级标题
```

### 段落

两个段落之间留一个空行：

```md
这是第一段。

这是第二段。
```

### 加粗和斜体

```md
**这是加粗文字**
*这是斜体文字*
```

### 无序列表

```md
- 第一项
- 第二项
- 第三项
```

### 有序列表

```md
1. 第一步
2. 第二步
3. 第三步
```

### 链接

```md
[显示在页面上的文字](https://example.com)
```

### 普通引用

```md
> 这是一段引用。
```

### 分隔线

```md
---
```

### 脚注

```md
正文中需要脚注的位置。[^1]

[^1]: 这里填写脚注内容。
```

## 5.3 怎样插入图片？

文章图片需要先保存到网站项目中。

普通文章图片放在：

```text
static/images/posts/
```

新闻图片放在：

```text
static/images/news/
```

图片文件名建议只使用英文字母、数字和短横线，例如：

```text
static/images/posts/20260608-example-01.webp
```

正文中插入图片时写：

```md
![图片说明](/images/posts/20260608-example-01.webp)
```

方括号中的“图片说明”会显示为图片下方的说明文字。图片尽量先压缩，不要直接上传体积非常大的原图。

## 5.4 什么是短代码？

短代码是网站预先制作好的特殊排版组件。它们看起来有一点像特殊括号，但不需要理解背后的代码。

需要使用时，复制示例，再替换其中的文字即可。

### 5.4.1 行内高亮：`hl`

适合强调一句话中的关键词。

```md
这句话里有一段 {{</* hl */>}}需要特别强调的文字{{</* /hl */>}}。
```

效果：

这句话里有一段 {{< hl >}}需要特别强调的文字{{< /hl >}}。

整段高亮：

```md
{{</* hl block=true */>}}
这一整段内容都会被突出显示。
{{</* /hl */>}}
```

效果：

{{< hl block=true >}}
这一整段内容都会被突出显示。
{{< /hl >}}

### 5.4.2 普通卡片：`card`

适合放补充说明、摘要或需要与正文区分的内容。

```md
{{</* card */>}}
这里可以写一段补充说明。

卡片内部也可以使用普通 Markdown。
{{</* /card */>}}
```

效果：

{{< card >}}
这里可以写一段补充说明。

卡片内部也可以使用普通 Markdown。
{{< /card >}}

### 5.4.3 回复卡片：`replycard`

适合归档讨论、回复或对话。

```md
{{</* replycard */>}}
这里填写回复内容。
{{</* /replycard */>}}
```

效果：

{{< replycard >}}
这里填写回复内容。
{{< /replycard >}}

### 5.4.4 正文中的评论区标题：`commentsection`

如果有交流内容需要记录：

```md
{{</* commentsection title="豆瓣评论区" */>}}
```

不填写标题时，默认显示“评论区”：

```md
{{</* commentsection */>}}
```

效果：

{{< commentsection title="豆瓣评论区" >}}

这与文章属性中的 `comments: true` 不同。`comments: true` 控制的是页面底部供读者现场留言的在线评论组件；`commentsection` 只是正文中的排版标题。

### 5.4.5 引用卡片：`quote`

只有作者和出处时：

```md
{{</* quote author="作者名" source="出处" */>}}
这里填写引用内容。
{{</* /quote */>}}
```

希望出处可以点击时：

```md
{{</* quote author="作者名" link="https://example.com" title="原文标题" */>}}
这里填写引用内容。
{{</* /quote */>}}
```

效果：

{{< quote author="作者名" source="出处" >}}
这里填写引用内容。
{{< /quote >}}

### 5.4.6 居中引用：`quote-center`

适合单独展示一句较短的话。

```md
{{</* quote-center */>}}
这里是一句需要单独展示的话。
{{</* /quote-center */>}}
```

效果：

{{< quote-center >}}
这里是一句需要单独展示的话。
{{< /quote-center >}}

### 5.4.7 折叠内容：`detail`

适合放较长的补充材料。读者点击标题后才会展开。

```md
{{</* detail "点击展开补充内容" */>}}
这里填写默认折叠的内容。
{{</* /detail */>}}
```

效果：

{{< detail "点击展开补充内容" >}}
这里填写默认折叠的内容。
{{< /detail >}}

### 5.4.8 外部链接卡片：`linkcard`

适合推荐网页、文章或外部资料。

```md
{{</* linkcard
  url="https://example.com"
  site="网站名称"
  title="链接标题"
  desc="一句话说明"
  image="/images/posts/20260608-example-01.webp"
*/>}}
```

其中，`url` 和 `title` 必须填写。`site`、`desc` 和 `image` 可以按需省略。

效果：

{{< linkcard
  url="https://example.com"
  site="网站名称"
  title="链接标题"
  desc="一句话说明"
  image="/images/posts/20260608-example-01.webp"
>}}

### 5.4.9 星级评分：`rating`

例如，总共显示 5 颗星，其中点亮 4 颗：

```md
{{</* rating 5 4 */>}}
```

第一个数字是总星数，第二个数字是点亮的星数。

效果：

{{< rating 5 4 >}}

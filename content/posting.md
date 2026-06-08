---
title: "零基础发帖指南：如何在文库网站发布、预览与修订文章"
description: "从同步 GitHub 文件、创建 Markdown 文章、填写文章属性，到本地预览、发布、修订与使用网站短代码。"
date: 2026-06-08
slug: "posting"
draft: false
comments: false
author: ""
build:
  list: never
  render: always
license: ""
---

这份指南写给第一次接触 GitHub、Hugo 和 Markdown 的朋友。日常发帖并不需要学会编程。把网站想象成一个可以多人共同维护、并且会自动保留历史版本的文件夹即可。

每次发帖只需要记住一条最重要的顺序：

> **先 Pull 同步她人的更新，再创建或修改文章，接着本地预览，确认无误后 Commit，最后 Push 发布。**

# 1. 发帖

## 1.1 发帖前准备及 GitHub 机制讲解

### 1.1.1 需要安装什么？

第一次参与网站维护时，需要准备一个 GitHub 账号，并在电脑上安装以下软件：

| 软件 | 用途 | 是否必须 |
| --- | --- | --- |
| GitHub Desktop | 用按钮完成同步、保存版本、上传和回退。日常操作主要使用它。 | 必须 |
| Git | GitHub Desktop 背后的版本管理工具。 | 必须 |
| VS Code | 打开网站文件夹、编辑文章、运行预览命令。 | 必须 |
| Hugo Extended | 在电脑上创建文章文件并预览网站。 | 必须 |

这个网站部署时使用的是 **Hugo Extended 0.148.1**。本地最好也安装相同版本，减少“我的电脑上正常，发布后显示不同”的情况。

安装完成后，可以打开 VS Code，点击顶部菜单栏的 **终端 → 新建终端**，输入：

```powershell
hugo version
```

如果终端能够显示 Hugo 的版本号，说明 Hugo 已经安装成功。

### 1.1.2 第一次如何把网站下载到自己的电脑？

网站管理员需要先把你的 GitHub 账号加入仓库协作者。接受邀请后：

1. 打开 GitHub Desktop，登录自己的 GitHub 账号。
2. 点击 **File → Clone repository**。
3. 在列表中选择这个网站的仓库。
4. 选择一个方便找到的本地文件夹，点击 **Clone**。
5. 下载完成后，点击 **Open in Visual Studio Code**。

此后，电脑上的这个文件夹就是网站的本地副本。不要每次发帖都重新下载一遍，也不要随意移动里面的文件夹。

### 1.1.3 GitHub 到底在做什么？

可以把整个网站理解成一个多人共享文件夹。GitHub 的特别之处在于：它会记录每一次修改，因此不仅能协作，也能回到之前的版本。

| 名称 | 可以怎样理解 | 什么时候使用 |
| --- | --- | --- |
| Repository，仓库 | 整个网站文件夹 | 网站的全部内容都在这里 |
| Clone | 第一次把线上网站完整下载到自己的电脑 | 第一次参与维护时 |
| Pull | 把她人已经上传的最新修改拉取到自己的电脑 | **每次开始编辑前** |
| Commit | 给当前修改拍一张快照，并写一句修改说明 | 预览确认后 |
| Push | 把自己的 Commit 上传到 GitHub | Commit 之后 |
| Branch，分支 | 临时开一条独立编辑线，避免多人同时修改时互相干扰 | 修改较多或需要审核时 |

需要特别注意：**Commit 不等于发布。** Commit 只是把修改保存在自己的电脑上；完成 Push 后，线上仓库才会收到更新。网站接入部署平台后，线上页面通常也会随之重新生成。

### 1.1.4 每次开始编辑前，先把她人的更新拉到本地

打开 GitHub Desktop，确认顶部显示的是这个网站仓库，然后：

1. 点击顶部的 **Fetch origin**。
2. 如果按钮随后变成 **Pull origin**，再点击一次 **Pull origin**。
3. 如果仍然显示 **Fetch origin**，说明本地已经是最新版本，可以开始编辑。

**不要先修改文件，最后才想起来 Pull。** 先同步再编辑，可以减少冲突。

### 1.1.5 多人如何同时协作？

如果只是分别发布不同文章，小型协作组可以直接在主分支工作，但要遵守三个规则：

1. 每次编辑前先 Pull。
2. 不要同时修改同一个 `.md` 文件。
3. 新文章的文件名、`slug` 和图片文件名不要与她人的重复。

如果要修改同一篇文章，或者一次修改很多文件，最好使用分支：

1. 在 GitHub Desktop 顶部点击 **Current Branch**。
2. 点击 **New Branch**。
3. 给分支取一个容易理解的名字，例如：

```text
post-xiaoming-new-article
fix-261001-typo
```

4. 在这个分支中编辑、Commit 和 Push。
5. 最终在 GitHub 网页中检查修改并合并。

可以把分支理解成“先在自己的草稿副本里改，确认后再合并进正式网站”。

### 1.1.6 改错了，怎样回退？

不用慌。GitHub 最大的优点之一，就是大部分误操作都能撤销。

| 情况 | 操作方式 |
| --- | --- |
| 文件改错了，但还没有 Commit | 在 GitHub Desktop 的 **Changes** 页面选中文件，右键点击 **Discard Changes** |
| 刚刚 Commit，但还没有 Push | 在 GitHub Desktop 的 **Changes** 页面底部点击 **Undo** |
| 已经 Push 到线上 | 打开左侧 **History**，右键点击需要撤销的 Commit，选择 **Revert Changes in Commit**，然后再 Push |
| 连续做了多个本地 Commit，但尚未 Push | 打开 **History**，右键点击想回到的版本，选择 **Reset to commit** |

已经 Push 的内容不要随便使用 Reset。多人协作时，优先使用 **Revert Changes in Commit**。它会新增一条“撤销修改”的记录，不会悄悄改写大家已经共享的历史。

## 1.2 创建 Markdown 文件

### 1.2.1 先确认自己位于网站项目最外层

在 VS Code 中打开网站文件夹。左侧文件列表中应该能看到：

```text
content
layouts
static
config
```

然后点击顶部菜单栏的 **终端 → 新建终端**。

### 1.2.2 根据内容类型创建文件

这个网站有三种主要内容：

| 内容类型 | 存放位置 | 创建命令 |
| --- | --- | --- |
| 普通文章 | `content/posts` | `hugo new content/posts/文件名.md` |
| 女性人物 | `content/figures` | `hugo new content/figures/文件名.md` |
| 新闻 | `content/news` | `hugo new content/news/文件名.md` |

例如，要创建一篇普通文章，可以输入：

```powershell
hugo new content/posts/20260608-example.md
```

创建女性人物页面：

```powershell
hugo new content/figures/20260608-example.md
```

创建新闻：

```powershell
hugo new content/news/20260608-example.md
```

建议文件名只使用英文字母、数字和短横线，不要使用空格。文件名只是电脑里的名称，网页链接可以通过后面介绍的 `slug` 单独设置。

命令运行后，VS Code 左侧对应的文件夹里会出现一个新的 `.md` 文件。点击打开它，就可以开始写文章。

### 1.2.3 图片放在哪里？

文章图片需要先保存到网站项目中。普通文章图片放在：

```text
static/images/posts/
```

新闻图片放在：

```text
static/images/news/
```

图片文件名也建议使用英文字母、数字和短横线，例如：

```text
static/images/posts/20260608-example-01.webp
```

正文中插入图片时写：

```md
![图片说明](/images/posts/20260608-example-01.webp)
```

方括号里的“图片说明”会显示为图片下方的说明文字。图片尽量先压缩，不要直接上传体积非常大的原图。

## 1.3 发布前预览

文章写完后，不要立刻 Push。先在自己的电脑上检查页面。

打开 VS Code 的终端，输入：

```powershell
hugo server
```

然后在浏览器中打开：

```text
http://localhost:1313/
```

只要终端没有关闭，网站就会保持运行。修改文章并保存后，浏览器通常会自动刷新。

如果文章设置了：

```yaml
draft: true
```

普通预览不会显示它。此时输入：

```powershell
hugo server -D
```

`-D` 表示预览草稿。

检查完毕后，在终端中按下：

```text
Ctrl + C
```

即可停止本地预览。

### 发布前至少检查这些内容

- 标题、简介和作者是否正确。
- 分类和标签是否合适。
- 网页链接是否能打开。
- 图片是否正常显示。
- 段落之间是否有空行。
- `slug` 是否唯一。
- 准备公开发布的文章是否设置为 `draft: false`。

## 1.4 文章发布

预览没有问题后，回到 GitHub Desktop。

1. 左侧 **Changes** 页面会列出你修改或新增的文件。
2. 检查列表，确认没有把无关文件一起上传。
3. 在左下角 **Summary** 中写一句说明，例如：

```text
post: 新增 20260608 文章标题
news: 新增 20260608 新闻
fix: 修订 261001 错别字
```

4. 点击 **Commit to main**。如果你正在使用分支，按钮会显示对应的分支名称。
5. 点击顶部的 **Push origin**。

完成 Push 后，修改会上传到 GitHub。网站接入部署平台后，线上页面通常会自动更新。

## 1.5 文章修订

修改已经发布的文章时，不需要重新创建文件。

1. 开始前，先在 GitHub Desktop 中 Fetch 和 Pull。
2. 在 VS Code 左侧打开 `content` 文件夹。
3. 普通文章在 `content/posts`，新闻在 `content/news`，女性人物在 `content/figures`。
4. 找到文章对应的 `.md` 文件，点击打开并编辑。
5. 保存后运行 `hugo server` 预览。
6. 确认无误后，回到 GitHub Desktop，Commit 并 Push。

文件太多、不知道文章在哪里时，可以在 VS Code 中按：

```text
Ctrl + Shift + F
```

搜索文章标题或 `slug`。

# 2. 文章属性设置

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

## 2.1 常用属性怎样填写？

| 属性 | 用途 | 怎样填写 |
| --- | --- | --- |
| `title` | 页面标题 | 必填。使用引号包起来最稳妥 |
| `description` | 首页卡片和搜索结果中的简介 | 建议填写一到两句话 |
| `date` | 网站中的发布日期和排序依据 | 通常保留创建文章时自动生成的日期 |
| `slug` | 网页地址最后一段 | 建议简短、唯一、发布后不要随意更改 |
| `draft` | 是否为草稿 | `true` 表示不公开；`false` 表示可发布 |
| `comments` | 是否显示页面底部的在线评论区 | `true` 开启；`false` 关闭 |
| `author` | 作者 | 可以填写普通文字，也可以填写 Markdown 链接 |
| `categories` | 大类 | 普通文章建议从网站现有分类中选择 |
| `tags` | 更细的关键词 | 可以填写多个 |
| `related_reading` | 手动添加相关文章 | 每行填写一篇站内文章的路径 |
| `original_url` | 原文链接 | 转载或归档文章建议填写 |
| `original_date` | 原文首次发布日期 | 与网站收录日期不同，可留空 |
| `license` | 版权说明 | 默认写“该作品版权归原作者所有。”，按实际授权情况调整 |

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

如果 `slug` 留空，网站会根据文件名生成链接。填写 `slug`是为了让链接简洁、稳定，也为了方便分享。

本网站中，所有的文章slug是这样组成的：年份+分类编号+文章编号。

分类编号：

| 序号 | 文章类型 |
| --- | --- |
| 1 | 普通文章 |
| 2 | 新闻文章 |
| 3 | 女性人物 |


比如，`261028`这篇文章的slug设置中，`26`意味着文章发表年份为2026年。`1`意味着这篇文章是一篇普通文章。`028`是这篇文章的顺序编号。

### 网站现有的普通文章分类

普通文章尽量从下面六个分类中选择：

```text
理论分野
结构辨析
语言回声
狩猎经验
女身优势
思考讨论
```

如果确实需要新增大类，先和网站管理员确认。标签可以更灵活，不需要拘泥于这六类。

## 2.2 多个分类、多个标签怎样写？

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

## 2.3 怎样填写作者链接和原文链接？

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

## 2.4 怎样设置相关文章？

希望文章末尾手动显示相关阅读时，可以填写：

```yaml
related_reading:
  - "/posts/261001/"
  - "/posts/261002/"
```

每一行放一篇站内文章链接。如果不需要手动推荐，可以删除整个 `related_reading` 区块，或者保持为空。

## 2.5 不想公开发布时，应该怎样设置？

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

那么页面仍然会生成，可以通过下面的链接直接访问：

```text
/posts/private-reading-note/
```

但它不会出现在普通文章列表、首页最近更新和站内搜索中。

这种设置只能算“未列出”，不是严格的隐私保护。任何得到链接的人仍然可以打开，也可能继续转发链接。真正不能公开的内容不要上传到公开仓库和网站。

## 2.6 文章属性最容易出错的地方

- 开头和结尾的 `---` 不要删除。
- 属性名后面使用英文冒号 `:`，不要误写成中文全角冒号 `：`。
- `draft: true` 和 `comments: false` 这类布尔值不要加引号。
- 分类和标签前面的缩进不要删掉。
- 已经发布的文章不要轻易修改 `slug`，否则旧链接可能失效。
- `date` 控制网站排序。归档旧文时，网站收录日期和原文日期可以分别写在 `date` 与 `original_date`。

# 3. Markdown 语法及本网站短代码

## 3.1 可以先在 Notion 中写文章

正文可以先在 Notion 中完成，再复制到 `.md` 文件。大部分普通段落、标题、加粗、引用和列表会比较顺利地保留下来。

复制后仍然建议在本地预览一次，尤其检查：

- 图片是否仍然能够显示。Notion 中的图片最好下载后，重新放进网站的 `static/images` 文件夹。
- 段落之间是否有空行。
- 标题层级是否合理。
- 外部链接是否完整。
- 脚注和特殊排版是否正确。

遇到排版问题时，也可以把 `.md` 文本交给 AI，让 AI 在不改动正文内容的前提下整理 Markdown 格式。

## 3.2 常用 Markdown 语法

### 标题

```md
# 一级标题
## 二级标题
### 三级标题
```

通常正文从 `#` 或 `##` 开始即可。不要为了让字体变大而随意打乱标题层级。

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

### 图片

```md
![图片说明](/images/posts/20260608-example-01.webp)
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

## 3.3 什么是短代码？

短代码是网站预先制作好的特殊排版组件。它们看起来有一点像特殊括号，但不需要理解背后的代码。把示例复制到正文中，再替换文字即可。



### 3.3.1 行内高亮：`hl`

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


### 3.3.2 普通卡片：`card`

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

### 3.3.3 回复卡片：`replycard`

适合归档讨论、回复或对话。

```md
{{</* replycard */>}}
这里填写回复内容。
{{</* /replycard */>}}
```

效果：
{{< card >}}
正文
{{< /card >}}
{{< replycard >}}
这里填写回复内容。
{{< /replycard >}}


### 3.3.4 正文中评论区标题：`commentsection`

如果有交流需要记录：

```md
{{</* commentsection title="豆瓣评论区" */>}}
```

不填写标题时，默认显示“评论区”：

```md
{{</* commentsection */>}}
```
效果：
{{< commentsection title="豆瓣评论区" >}}


这与文章属性中的 `comments: true` 不同。`comments: true` 控制的是页面底部供读者现场留言的在线评论组件；`commentsection` 和 `doubancomments` 只是正文中的排版标题。

### 3.3.5 引用卡片：`quote`

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

### 3.3.6 居中引用：`quote-center`

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

### 3.3.7 折叠内容：`detail`

适合放较长的补充材料。读者点击标题后才会展开。

```md
{{</* detail "点击展开补充内容" */>}}
这里填写默认折叠的内容。
{{</* /detail */>}}
```
{{< detail "点击展开补充内容" >}}
这里填写默认折叠的内容。
{{< /detail >}}


### 3.3.8 外部链接卡片：`linkcard`

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

其中 `url` 和 `title` 必须填写。`site`、`desc` 和 `image` 可以按需省略。

效果：

{{< linkcard
  url="https://example.com"
  site="网站名称"
  title="链接标题"
  desc="一句话说明"
  image="/images/posts/20260608-example-01.webp"
>}}


### 3.3.9 星级评分：`rating`

例如，总共显示 5 颗星，其中点亮 4 颗：

```md
{{</* rating 5 4 */>}}
```

第一个数字是总星数，第二个数字是点亮的星数。

效果：
{{< rating 5 4 >}}


# 4. 最简发帖流程速查

赶时间时，只看这一段即可：

1. 打开 GitHub Desktop，点击 **Fetch origin**；如果出现 **Pull origin**，继续点击。
2. 在 VS Code 中打开网站项目。
3. 打开终端，创建文章：

```powershell
hugo new content/posts/20260608-example.md
```

4. 在新建的 `.md` 文件中填写文章属性和正文。
5. 打开终端预览：

```powershell
hugo server
```

6. 浏览器打开：

```text
http://localhost:1313/
```

7. 检查无误后，在 GitHub Desktop 中填写 Summary，点击 **Commit to main**。
8. 点击 **Push origin**。

第一次操作可能会觉得按钮很多。熟悉之后，日常发一篇文章其实就是：**同步、写作、预览、保存版本、上传**。

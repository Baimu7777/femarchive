# 在线投稿接收端

文库投稿页（`/submission-guidelines/`）把投稿发到这个独立的 Cloudflare Worker。它只做三件事：验证、计数、暂存。论坛定时来取，成员在论坛里审核，采用后走原有的文库发布流程。

它单独部署，是为了隔离：有人刷爆它，只会让在线投稿当天不可用，文库（Vercel）和论坛（VPS）都碰不到这些流量，也不会产生费用。

没有配置之前，投稿页保持原样（邮箱 + 表单），论坛里也不出现投稿箱。

## 数据流向

1. 访客在文库投稿页写稿，点提交。
2. 浏览器通过 Turnstile 人机验证，换到一个 30 分钟有效的会话。
3. 图片逐张上传到本 Worker，存进私有 R2 桶；正文同样存进 R2。D1 里只记标题、摘要和计数。
4. 论坛每 10 分钟最多来问一次有没有新投稿（只在有人使用论坛时），只取标题和摘要。
5. 成员打开某一篇时，论坛才来取正文和图片；导入论坛后，这里的原件被删除。

Worker 没有论坛的任何凭据，也不会主动连接论坛。

## 部署

需要一个 Cloudflare 账号（免费计划即可）和 `wrangler` 命令行工具。在本目录操作：

```sh
npx wrangler login
npx wrangler d1 create archive-submissions        # 把输出的 database_id 填进 wrangler.toml
npx wrangler r2 bucket create archive-submissions
npx wrangler d1 execute archive-submissions --remote --file=schema.sql
```

在 `wrangler.toml` 里填写：

- `database_id`：上一步的输出。
- `ALLOWED_ORIGINS`：文库的正式地址，例如 `https://文库域名`，不带结尾斜杠。
- `TURNSTILE_HOSTNAMES`：文库域名，不带 `https://`。

设置四个密钥（逐条执行，按提示粘贴，不要写进任何文件或聊天）：

```sh
npx wrangler secret put ADMIN_TOKEN        # 论坛取稿用，32 位以上随机字符
npx wrangler secret put SOURCE_HASH_KEY    # 32 位以上随机字符；更换后所有拉黑失效
npx wrangler secret put SESSION_KEY        # 32 位以上随机字符
npx wrangler secret put TURNSTILE_SECRET   # Turnstile 小组件的密钥
npx wrangler deploy
```

随机字符可以用 `openssl rand -hex 32` 生成。Turnstile 可以沿用评论区已有的小组件（密钥在 Cloudflare 后台的 Turnstile 页面），也可以为投稿单独建一个；单独建时把它的 sitekey 填到文库 `hugo.toml` 的 `params.submission.turnstileKey`。小组件的域名列表里要有文库域名。

部署后得到 Worker 地址（`https://archive-submissions.<账号>.workers.dev`，也可以在 Cloudflare 后台绑定自己的子域名）。然后：

1. **文库**：把地址填进 `config/_default/hugo.toml` 的 `params.submission.endpoint`，并把同一地址加进 `vercel.json` 里 `Content-Security-Policy` 的 `connect-src`。两处不一致时 `npm test` 会失败。
2. **论坛**：在服务器的 `deploy/self-host/server.env` 里加 `ARCHIVE_SUBMISSIONS_ENDPOINT`（Worker 地址）和 `ARCHIVE_SUBMISSIONS_TOKEN`（与 `ADMIN_TOKEN` 相同），然后重新部署论坛。

未设置齐四个密钥时，Worker 对所有请求回答 503，投稿页显示“入口暂时关闭”。

## 上限

全部有默认值，可在 `wrangler.toml` 的 `[vars]` 里覆盖（变量名见 `worker.mjs` 的 `DEFAULT_LIMITS`）。

| 项目 | 默认 |
| --- | --- |
| 正文 | 20 万字 |
| 每篇图片 | 30 张，每张压缩后不超过 4 MB（浏览器会自动压缩 20 MB 以内的原图） |
| 每个来源每天 | 5 篇、图片 100 MB |
| 全站匿名每天 | 30 篇、图片 300 MB |
| 持投稿码每天 | 60 篇、图片 300 MB（独立名额） |
| 暂存总量 | 2 GB，其中 500 MB 只留给持投稿码的投稿 |
| 每个来源每小时开始投稿 | 12 次（投稿码输错也计入） |
| 未被取走的投稿 | 90 天后自动删除 |
| 上传后没有提交的图片 | 24 小时后自动删除 |

到达任何上限时只拒绝新的投稿或图片。清理由每天一次的定时任务完成。

R2 的免费额度是每个账号 10 GB。如果这个桶和论坛图片在同一个 Cloudflare 账号下，注意两边上限相加不要超过 10 GB：论坛默认 8 GB，这里 2 GB，正好顶满。实际用量远低于上限时不必改，否则调低 `LIMIT_TOTAL_MB`。R2 绑定了付款方式，建议在 Cloudflare 后台开启用量通知。

## 防护

- **请求按成本从低到高检查**：来源站点 → 入口是否开放（内存缓存）→ Turnstile → 拉黑 → 计数 → 写入。没通过 Turnstile 的请求不产生任何数据库或存储操作。
- **一次验证，一次投稿**：会话由服务器签名，30 分钟过期，只能提交一篇。
- **不保存 IP**：只保存用密钥加密后的标识（IPv6 按 /64 计），用于限流和拉黑，无法反推出地址。
- **图片只看文件头**：类型和尺寸从文件自身读取，声明的类型不可信；SVG 等一律拒绝。这里不解码图片，重新编码由论坛完成。
- **正文原样暂存**：Worker 不渲染投稿的 HTML，也不向浏览器返回它；论坛用自己的消毒规则处理后才显示。
- **管理接口**：`/admin/*` 需要 `ADMIN_TOKEN`，比较时不泄露长度和内容。

成员在论坛“投稿 → 入口与拉黑”里可以切换接收方式（开放 / 投稿码 / 关闭）、暂停图片、查看用量、解除拉黑，不需要登录 Cloudflare。

防不住的：真人换 IP 持续灌水（此时切到投稿码模式），以及针对 Worker 的流量攻击（后果是当天在线投稿不可用，次日恢复）。

## 本地运行与测试

```sh
npm test                                            # 含 test/submission-worker.test.mjs
node deploy/submission-worker/local/server.mjs      # 本机预览，端口 8788，人机验证恒通过
```

`local/` 下的文件只用于测试和本机预览，不会被部署。预览时用环境变量让 Hugo 指向它：

```sh
HUGO_PARAMS_SUBMISSION_ENDPOINT=http://localhost:8788 HUGO_PARAMS_COMMENTS_TURNSTILEKEY= hugo server
```

改动 `submission/` 下的编辑器源码后运行 `npm run build:submission`，并提交生成的 `static/js/submission.js`。

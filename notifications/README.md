# 文库站内通知：安装与验收

本实现包含：浏览器绑定的服务器收件箱、已读和分页、评论提交关联、签名回复事件、三类 Hugo 内容更新清单，以及顶部铃铛。文章正文继续保存在 Markdown。匿名昵称不是接收授权凭据。

## 当前状态

本地分支实现并以合成服务验收；不等于正式通知已启用。默认 `params.notifications.bridge = false`，普通评论和申报继续使用原 Waline 地址。新文章、词条、新闻的公开更新通知在本地可用；首次访问只记录基线。过往评论没有安全的浏览器关联，不能按昵称补认领。

## 网站服务器配置

使用独立私有 R2 桶与仅限该桶的凭据。不得复用发布收据桶、论坛图片桶或论坛数据库权限。桶禁止公开域名和 r2.dev。

| 环境变量 | 用途 |
|---|---|
| `NOTIFICATIONS_ENABLED` | 初始 `false`，验收准备完成后才设 `true` |
| `NOTIFICATIONS_ORIGIN` | 网站的规范 HTTPS origin，无路径或末尾斜杠 |
| `NOTIFICATIONS_SECRET` | 独立 32–256 位 URL 安全随机服务密钥，用于签名浏览器身份 |
| `NOTIFICATIONS_EVENT_SECRET` | 另一份独立随机密钥，用于 Waline 事件认证 |
| `NOTIFICATIONS_WALINE_ORIGIN` | 现有网站评论服务 HTTPS origin |
| `NOTIFICATIONS_R2_ENDPOINT` | 新桶账户的 HTTPS R2 根端点 |
| `NOTIFICATIONS_R2_BUCKET` | 通知专用私有桶 |
| `NOTIFICATIONS_R2_ACCESS_KEY_ID` | 仅限新桶的访问标识 |
| `NOTIFICATIONS_R2_SECRET_ACCESS_KEY` | 对应访问密钥 |

密钥只放服务器变量，不加 `NEXT_PUBLIC_`，不写进 Hugo 配置或 Git。桶内仅 `notifications/v1/limits/` 可设置短期生命周期，其余身份关联、去重和收件箱不得随意清理。当前收件箱最多保留 500 条：优先移除已读通知，全为未读时拒收并报告失败。不要把拒收算成成功。

## Waline 事件配置

把 `deploy/waline-notifications/index.cjs` 安装到现有 Waline 服务。保留它已有的 hooks，组合执行 `notifyPublished(comment)`：新评论在 `postSave` 调用，通过审核或修改公开评论在 `afterUpdate` 调用。具体 hook 名称以实际部署的 Waline 版本为准，安装前核对。

设置 `ARCHIVE_NOTIFICATIONS_ENABLED=false`、`ARCHIVE_NOTIFICATIONS_ENDPOINT=https://<网站>/api/notifications?operation=event`、`ARCHIVE_NOTIFICATIONS_EVENT_SECRET`（与网站事件密钥一致）。调好后再启用。事件只发已审核通过的回复；请求包含时间戳和 HMAC，固定 commentId 作为重复投递键。失效或认证失败不写收件箱。适配器失败时应在 Waline 内保存待处理事件并由维护者重放；本安装包不擅自修改现有 Waline 的任务/重试机制，尚未配置持久重放时不能承诺断线事件必达。不要让通知 hook 的异常诱导用户重复发布已经保存的评论。

先部署服务器和 hook，再将 `config/_default/hugo.toml` 的 `params.notifications.bridge` 改为 `true`，构建部署网站。桥接只改变创建评论的 POST 传输；Waline 原有登录、编辑、删除、审核、验证码仍由原评论服务执行。网络不确定时不会后台重发。

## 本地验证与正式验收

Node 24：`node --test test/notification-*.test.mjs test/notifications.test.mjs`。覆盖接收者隔离、签名与超时、去重、跨站写入、代理不转发 Cookie、失败不重发、三类更新基线与已读状态。

Hugo 0.148.1 构建验证 `/notifications.json` 只含公开内容。测试应使用独立桶、专用合成评论和受控目标。完整真实验收还需检查：两浏览器互相回复、申报回应、审核后才投递、单条/全部已读、并发新消息、跳转、清除身份和手机端触摸。真实服务没有通过这些检查前，不将互动通知描述为已正式可用。

本地完整回归还复现了未修改基线已有的 28 项图片发布相关失败；不在本次通知改动内修复。通知专项结果不能替代这些基线问题的单独处理。

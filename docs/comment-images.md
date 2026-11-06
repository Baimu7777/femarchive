# 评论验证码与图片附件部署

本地 Waline 3.16.2 适配包含评论提交传输、共享 Turnstile 加载器、独立图片附件卡片。文章与词条统一加载此版本。更新 Waline 时须保留这三处适配并运行测试；不要恢复 CDN 浮动版本。

## 开启安全上传

1. 在 Cloudinary 控制台禁用旧的 unsigned 上传预设 `waline_comments`。仅从网页删除预设名不能关闭旧接口。若其他应用共用该预设，先迁移再禁用。检查旧上传记录和用量，设置费用/额度告警。正式文库图片建议使用独立 Cloudinary 环境；目录分离不是权限隔离。
2. 在 Vercel 项目的服务端环境变量中设置（不要放入 Hugo 配置或浏览器代码，也不要粘贴到聊天）：
   - `COMMENT_IMAGES_TURNSTILE_SECRET`：页面所用 Turnstile sitekey 对应的密钥。
   - `COMMENT_IMAGES_CLOUD_NAME`、`COMMENT_IMAGES_API_KEY`、`COMMENT_IMAGES_API_SECRET`：图片存储环境的服务端凭据。
   - `COMMENT_IMAGES_ENABLED=true`。
3. 上传限流复用已配置的通知 R2 存储，要求现有 `NOTIFICATIONS_*` 配置有效且 `NOTIFICATIONS_ENABLED=true`。按通知存储现有隔离规则配置。为 `notifications/v1/image-limits/` 添加 7 天过期的对象生命周期规则，避免计数记录永久累积。
4. 部署后测试真实域名。端点仅信任 Vercel 注入的 `x-vercel-forwarded-for`；其他托管平台必须实现可信客户端 IP 适配，不能直接信任访客传入的请求头。代理可能使多个访客共用限额，不要未经验证改为信任 `CF-Connecting-IP`。

缺少配置时上传返回 503，文字评论仍可使用；没有公开直传或 Base64 上传回退。旧 unsigned 预设必须在后台关闭才能消除绕过新接口的路径。

## 行为与限制

- 每个编辑器最多附加 3 张图片，上传时显示验证和处理状态，成功后显示缩略图和移除按钮。正文保持纯文本编辑，提交时才拼接图片 Markdown。失败后可移除失败卡片并重新选择。
- 服务端每 IP 每小时最多 10 次尝试，全站每日最多 200 次；基于 UTC 时间桶，所有实例通过 R2 条件写入共享计数。失败验证也计数，额度耗尽返回 429。它限制图库写入，不替代边缘 WAF/请求限流，也不保证抵御 DDoS。
- 每次上传单独验证 Turnstile 的成功结果、hostname 和 `comment_image` action。发表评论使用另一个新 token。
- 输入最多 2MB、1600 万像素，仅 JPEG/PNG/WEBP/GIF。服务端实际解码并转为最长边 1600px 的 WebP，去除元数据；GIF 只保留第一帧。
- 服务端签名上传至随机 `comment-attachments/` ID，禁止覆盖。签名和密钥不返回浏览器。
- “移除图片”从待发表评论中移除引用，不删除图库资产；上传后未发表评论的图片仍占用空间。定期人工审核和清理未引用附件，删除前核对评论引用。
- 本次不更换 Waline 服务端的评论清洗/审核机制；要审计已部署 Waline 的版本、HTML 清洗规则和审核设置，不能把附件改造等同于整站安全审计。

## 上线验收

直接评论、先打开问题申报再评论、先评论再申报；验证失败/过期后重试。图片选择、粘贴、拖入、移除、仅图片提交、回复、提交失败保留附件、词条切换不带入前一条附件。验证无效 token / token 重放 / 错误 hostname 和 action 被拒绝；真实图片成功上传且旧 unsigned 预设拒绝上传。不使用真实垃圾内容做验证。

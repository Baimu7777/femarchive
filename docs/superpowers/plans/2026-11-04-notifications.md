# Library Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a browser-bound notification center for comment/report replies and new articles, terms and news.
**Architecture:** Hugo emits a public content catalog. A signed browser cookie scopes a private inbox stored in a separate R2 bucket. A same-origin comment submission bridge binds successful Waline writes to the browser; authenticated Waline events deliver replies, including moderated replies. No forum credentials or publishing receipts are used.
**Tech Stack:** Hugo 0.148.1, browser JavaScript, Node 24, existing AWS S3 SDK, Waline.
**Spec:** docs/superpowers/specs/2026-11-04-notifications-design.md

## Global Constraints
- Browser-bound identity; no cross-device recovery promises.
- Preserve Hugo Markdown article storage, existing comment authentication and Turnstile validation.
- Keep notification service disabled without explicit complete server configuration.
- Private inboxes and recipient bindings cannot appear in public build output.
- Existing unrelated working changes must remain untouched.

## Task 1: Private identity, inbox and signed event service
Files: notifications/service.mjs, notifications/storage.mjs, api/notifications.mjs, test/notifications.test.mjs.
Interface: createNotificationService({store,secret,eventSecret,origin,now}) returns handle(Request); store.read(key) returns {value,etag}|null; store.write(key,value,etag) conditionally writes and returns boolean.
- [x] Write tests rejecting missing configuration, forged cookies, cross-origin writes, forged/expired signed events, and cross-recipient inbox reads. Run `node --test test/notifications.test.mjs` and confirm initial failure.
- [x] Implement signed HttpOnly Secure SameSite cookie, immutable event id deduplication, recipient-scoped cursor pagination, bounded content, and conditional read-modify-write inbox storage.
- [x] Test duplicate event deliveries, concurrent inbox changes, read-through upper bounds and transient storage failures. Never return an empty success on storage failure.

## Task 2: Comment/report binding and event adapter
Files: notifications/comments.mjs, api/community.mjs, deploy/waline-notifications/index.cjs, static/js/waline-notification-client.js, static/vendor/waline.js.
Interface: POST /api/community forwards only validated comment creation to fixed configured Waline origin; successful response objectId binds to signed browser identity. Signed event endpoint accepts {id,commentId,parentId,path,title,text,publishedAt} and delivers only to a stored parent binding. No client-supplied recipient.
- [x] Test rejection before authentication/configuration and ensure no request is automatically replayed.
- [x] Validate comment path and fixed upstream; strip browser Cookie/Referer; preserve user Bearer authentication and captcha values; stop redirects.
- [x] Keep original direct comments when notifications are disabled; use explicit configured bridge when enabled. Save only successfully returned ids.
- [x] Provide Waline adapter installation documentation and synthetic signed-event tests; enabling the production hook requires deployment account configuration.

## Task 3: Public updates and notification UI
Files: layouts/partials/notification-center.html, layouts/index.notifications.json, config/_default/hugo.toml, static/js/notifications.js, static/css/notifications.css; integrate baseof/mobile-nav/header.
Interface: /notifications.json exposes {items:[{id,kind,title,url,publishedAt}]}; notification API returns {items,unread,through,nextCursor}. Browser cache and read state are namespaced by service identity.
- [x] Test content first-visit baseline, stable source ids, edited-title deduplication and URL validation.
- [x] Implement compact bell, accessible dialog, two tabs, unread badge, single/all-read, folded text, source jump and earlier-page loading.
- [x] Show cached content first; visible-page refresh has a minimum one-minute interval, stops when hidden, and never duplicates requests. Explicitly distinguish unavailable interactions from zero unread.

## Task 4: Integration and handoff
Files: notifications/README.md; plan checkboxes.
- [x] Run targeted Node tests and Hugo 0.148.1 build; inspect narrow-screen browser panel and synthetic event-to-inbox flow. Actual device verification remains outstanding.
- [x] Verify unconfigured service writes nothing and leaves normal commenting intact.
- [x] Record exact server variables, separate bucket permissions and Waline hook setup. Keep production disabled until configuration and actual-service acceptance are complete.
- [ ] Integrate only notification changes after review. Preserve unrelated image edits and do not deploy unconfigured integration as complete.

## Local completion record
22 notification-specific tests pass. Hugo 0.148.1 builds. Native Chrome narrow-window panel opens, switches tabs and distinguishes disabled interactions from no unread updates. Full existing suite has 28 image-publication failures reproducible on the unmodified baseline; these are not changed here. Private R2 credentials and Waline deployment access are not configured in this run, so no real-service notification acceptance or production enablement is claimed.

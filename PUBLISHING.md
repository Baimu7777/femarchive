# Website publishing receiver

The receiver writes reviewed content to `content/lexicon/<UUID>.md` and independent images to `static/images/articles/<UUID>.webp`. It is disabled unless explicitly configured and enabled. No article database is required.

## Deployment

Use the existing Vercel project and confirm its repository and production branch. Node 24.x is pinned in package.json. `npm ci` installs the lockfile; the existing build script uses Hugo 0.148.1. The function includes `publishing/**`, including its catalog.

First deploy with `WEBSITE_PUBLISHING_ENABLED=false` in every environment. The catalog endpoint `/api/publishing?operation=catalog` must return a generic 503 while disabled. Do not enable it merely to pass a health check.

Configure server-side variables in the deployment platform:

- `WEBSITE_PUBLISHING_ENABLED`: initially `false`.
- `WEBSITE_PUBLISHING_TOKEN`: independent shared publishing credential, 32–256 ASCII letters, digits, `_` or `-`.
- `WEBSITE_GITHUB_TOKEN`: Contents read/write for this website repository only.
- `WEBSITE_GITHUB_OWNER`, `WEBSITE_GITHUB_REPO`, `WEBSITE_GITHUB_BRANCH`: one fixed existing target.
- `WEBSITE_PUBLIC_ORIGIN`: canonical HTTPS origin, no trailing slash, path or port. The build script uses this for Hugo when set.
- `WEBSITE_R2_ENDPOINT`: dedicated account HTTPS S3 endpoint, no trailing slash.
- `WEBSITE_R2_BUCKET`: private receipt bucket; public access and public domains stay disabled.
- `WEBSITE_R2_ACCESS_KEY_ID`, `WEBSITE_R2_SECRET_ACCESS_KEY`: permissions scoped to this bucket.

The receipt bucket holds immutable deduplication records, not article bodies or public image storage. Do not expire receipts. Do not provide source-site database, login, member or private-image credentials. Do not use public/client environment variable prefixes.

Use independent credentials and targets for staging. An accepted publication means the Git branch was updated; it does not prove the resulting Vercel deployment is ready. Verify the exact deployment and final URL before treating it as live.

## Unlisted lexicon

`/lexicon/` remains directly accessible but has no home/navigation entry. Its local page collection, HTML-only section output and disabled sitemap prevent listing in global collections. Pages carry noindex/nofollow. This is discoverability control, not authentication. Keep private material out of this public section.

New publications always use the lexicon directory. Updates retain existing website-owned front matter, including stable URLs, and require the expected revision. Concurrent changes fail with a conflict instead of forcing an overwrite.

## Verification

`npm test` runs synthetic receiver/adapter tests with in-memory external services. No production credentials are needed. Local testing is separate from GitHub, R2 and Vercel deployment acceptance. Never copy private diagnostics into the Hugo output.

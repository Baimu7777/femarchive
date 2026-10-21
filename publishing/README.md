# Website-owned Hugo publisher — local installation

This is the website receiver. It defaults to **disabled** until separately
configured and explicitly enabled after deployment acceptance.
The forum sender, private-value context, publication UI and private association
records remain outside the website. Local acceptance evidence and private audit
inputs are retained locally and excluded from the published repository.

## Entry and configuration

The website root contains `api/publishing.mjs`, `publishing/`, pinned Node
dependencies and the npm lockfile. Run `npm ci --no-audit --no-fund` on Node 24+
and `npm test` for synthetic receiver tests. Do not copy tests, reports or private
records into Hugo's public output. The entry uses
Vercel's Web Standard `export default { fetch(request) }` interface and returns a
real `Response`; it does not use Next.js or a Node `(req, res)` shim.

Every variable below is website-specific and mandatory. Missing/invalid values,
or any enable value other than the exact string `true`, produce generic 503s
without issuing network requests. No dotenv loading, secret defaults or setup
writes occur.

| Variable | Meaning |
| --- | --- |
| `WEBSITE_PUBLISHING_ENABLED` | Exact `true` only after separate review/configuration |
| `WEBSITE_PUBLISHING_TOKEN` | Independent random service token; use 32–256 URL-safe letters/digits/`_`/`-` for compatibility with both ends, not ordinary Base64 `+`/`/`/`=` |
| `WEBSITE_GITHUB_TOKEN` | Fine-grained website-only repository credential with contents read/write |
| `WEBSITE_GITHUB_OWNER` | One fixed owner |
| `WEBSITE_GITHUB_REPO` | One fixed website repository; never the forum repository |
| `WEBSITE_GITHUB_BRANCH` | One existing fixed branch |
| `WEBSITE_PUBLIC_ORIGIN` | Canonical public HTTPS origin, without trailing slash, port, path or credentials |
| `WEBSITE_R2_ENDPOINT` | Account endpoint `https://<account>.r2.cloudflarestorage.com`, without trailing slash |
| `WEBSITE_R2_BUCKET` | Dedicated website-private receipt bucket |
| `WEBSITE_R2_ACCESS_KEY_ID` | Website bucket-only access key |
| `WEBSITE_R2_SECRET_ACCESS_KEY` | Corresponding secret; no access to forum images |

Restrict GitHub credentials to that single repository, keep branch governance in
the website, and keep R2 public access and public/custom domains disabled. The
receiver cannot inspect account permissions; isolation must be verified during
installation. It has no forum URL, database or forum-image configuration.

## Protocol v1

All operations use `/api/publishing?operation=...`, Bearer service authentication,
fixed JSON errors and `Cache-Control: no-store`. Responses never set cookies or
CORS authorization headers. Requests carrying Origin (including `null`), Cookie,
Referer, Sec-Fetch-Site/Dest/User are refused. Node's server `fetch` automatically
sends `Sec-Fetch-Mode: cors`, so that header alone is accepted. Browser CORS
preflight is not enabled; browser-facing authorization belongs elsewhere.

- `GET operation=catalog`: `{categories,sharedTags}` from website-owned
  `publishing/catalog.json`. Six agreed categories; shared tags initially empty.
- `GET operation=article&articleId=<website UUID>`: current `{articleId,revision,
  url,title,html,categories,tags,comments}`. `comments` is empty because previously
  confirmed excerpts are part of the returned body. Only private-marker-managed
  articles can be read, not arbitrary paths or legacy articles.
- `POST operation=asset`: raw `image/webp`, at most 4 MiB, with
  `X-Publishing-Confirmed: 1` and UUID-v4 `Idempotency-Key`. Returns `{receipt,path}`.
  The public path is exactly `/images/articles/<independent website UUID>.webp`;
  the repository path is `static/images/articles/<UUID>.webp`. Receipt, filename
  and request key are independently generated values. Files are re-encoded by
  sharp with metadata removed. Animation, invalid/non-WebP inputs and images
  above 16 million pixels are rejected. No asset storage or Git writes occur
  before explicit confirmation and successful image validation.
- `POST operation=publish`: `application/json` (optional UTF-8 charset), at most
  512 KiB, with UUID-v4 `Idempotency-Key`. Exact DTO: `version:1`,
  `confirmed:true`, `title`, `html`, `categories:string[]`, `tags:string[]`,
  `comments:string[]`, `assets:receipt UUID[]`, and optionally **both**
  `articleId` and `expectedRevision` (the GitHub Markdown blob SHA). Returns
  exactly `{articleId,revision,url}`. Unknown fields, structured comments and
  arbitrary asset URLs are refused. Requests do not accept source/identity keys.

No request URL, citation, image URL or redirect supplied by the caller is fetched.
Assets must have completed private records with exact safe website paths and an
unchanged remote blob SHA before those paths enter article content.

## Content and Markdown

New articles are `content/posts/<website UUID>.md`, with website-generated date
and explicit `/posts/<UUID>/` URL. Public categories/tags come from the website
catalog. Confirmed comment strings become escaped ordinary blockquotes, with no
identity, floor or reply metadata. Legitimate `<`/`>` comparisons remain text.

The narrow rich-text allowlist supports paragraphs, breaks, bold/emphasis,
strike, underline/highlight, headings, blockquotes, lists, pre/code, citations
and selected images. Links accept HTTPS citations including query, fragment and
percent encoding. They reject credentials, ports, IPs, known social/profile
locations and unsafe schemes; hrefs are rendered from normalized `URL.href` in
Markdown angle links. Optional `target="_blank"` and exact
`rel="noopener noreferrer nofollow"` are accepted and reduced to an ordinary
Markdown citation (no browser window behavior is imported).

Images accept only width `33|50|75|100` and alignment `left|center|right` through
`data-width`/`data-align`. The renderer emits fixed safe layout CSS, never caller
CSS. Ordered-list `start` accepts integers 1–999999. Underline, mark, code and
image layout use a small amount of generated HTML inside Markdown. The actual
Hugo installation must verify its Goldmark/render-hook handling of these
elements; this package changes no Hugo templates or renderer settings.

Updates replace only title and body. Original YAML bytes, comments, line endings,
categories, tags, date, author, URL, slug and arbitrary management fields are
preserved apart from the title scalar. A semantic comparison checks that
replacing a title did not change an anchor-dependent field. Unsupported or
ambiguous YAML is a conflict, never silently rewritten.

Known private receipt/request UUIDs are forbidden in public text, including
entity, percent, Unicode-escape, Base64/Base64url, nested encodings and
markup-split values. Bounded comparison views also check recognizable UUIDs in
binary Base64 and URL-wrapped standard Base64 without recursively interpreting
arbitrary binary as text. Earlier request keys are checked in the private store,
not just the current request key and selected receipts.
This check covers DTO fields and generated Markdown/frontmatter/path/URL before
Git writes; pasted existing receipt UUIDs are also checked against private
records even when unselected. It is not a replacement for the sender's local
forum-specific scan or human review of names, pictures and natural-language
identity. No forum-specific values are sent to this service as scan config.

## Durability and conflicts

R2 stores only website-private immutable records under `publishing/v1/`:
request digest/reservation (website path, version and base Git head/tree),
candidate commit/blob revisions, completed results, managed-article markers and
asset path/revision records. It never stores article HTML, Markdown, image bytes,
comments, forum source or member information. All inserts use conditional
`PutObject If-None-Match: *`. Do not expire/delete reservations: doing so would
invalidate the lifetime deduplication guarantee. They are not public web files.

A reservation fixes the path before Git writes. A candidate commit is privately
recorded **before** updating the branch. Explicit same-key/same-content retries
reuse the reservation/candidate/result. A changed payload conflicts. An uncertain
write returns 503 without background retries. After a lost branch-update response,
the next explicit retry checks that the candidate is the head or its ancestor,
then completes the original result without allocating another public path.

Git uses one fixed `https://api.github.com/repos/<owner>/<repo>/` prefix, no
redirect following or automatic retries, base-tree inheritance, one-parent
commits, and atomic `PATCH .../git/refs/heads/<branch>` with `force:false`. Public
author/committer are `Website Editor <editor@website.invalid>` and every message
is `Update website content`. They carry no service token, request key, receipt,
operator or forum metadata. A different concurrent branch head produces 409;
there is no silent rebase, force update or automatic resubmission.

Errors contain only `{error,message}` with fixed values for 400, 401, 403, 404,
405, 409, 413 or 503. No exception/config/body detail is returned or logged.

## Local verification and references

Run `npm test` (or `node --test test/*.test.mjs`) from this website checkout.
Local tests use this website's independently installed dependencies. The
included npm v3 lockfile pins six direct dependencies. Fresh installation and
sharp's native decoding are covered in the separately retained local acceptance
evidence.

Only remote HTTP/object-storage transports are replaced in tests. The real
receiver, validators, Markdown/YAML logic, sharp, Git graph/commit adapter and
immutable receipt state transitions run. All fixtures are synthetic.

- [Vercel Node Web Standard entry](https://vercel.com/docs/functions/runtimes/node-js)
- [GitHub non-forced reference updates](https://docs.github.com/en/rest/git/refs#update-a-reference)
- [R2 S3 compatibility and conditional operations](https://developers.cloudflare.com/r2/api/s3/api/)

Deployment acceptance must still verify the actual platform runtime, fixed Hugo
version, repository permissions, private receipt storage and disabled state before
any separately authorized live-service test.

## Local public-output and history audit

`scripts/audit-publication.mjs` is a developer-only read-only command. It is not
imported by the function entry, exposed as an endpoint, or copied into Hugo's
public output. Keep the forbidden-values JSON outside this repository and
outside the directory being published. The command does not load `.env`, fetch
remotes, follow filesystem links, rewrite history, or echo matching content.

```sh
node scripts/audit-publication.mjs \
  --directory /absolute/path/to/public-output \
  --forbidden-file /absolute/private/path/to/forbidden-values.json \
  --large-repository

node scripts/audit-publication.mjs \
  --git /absolute/path/to/read-only-website-repository \
  --forbidden-file /absolute/private/path/to/forbidden-values.json \
  --large-repository
```

The optional explicit large-repository profile permits 64 MiB per file/object,
3 GiB total input, 80 MiB per Git output, 4,096 decoded views, 16,384 queued views
and a 30-second timeout per Git process. This explicit profile uses a finite
decoded-character budget of `input.length * 128 + 1024`; the default remains
`input.length * 16 + 1024`. Direct local callers can choose a positive integer
`maxDecodeCharsMultiplier` up to 1,024. Actual exhaustion, unreadable inputs, changing files,
symlinks and unavailable history still produce `complete:false`. Without that
flag, the conservative original resource limits remain in effect. Neither
profile bypasses content checks. Long Base64 tokens are scanned iteratively
without truncation to avoid the regex engine's stack limit on legacy inline
images. A per-tokenizer necessary-condition guard also avoids Marked's long-line
setext-heading regex when no underline can match; real headings, nested lists
and blockquotes still use the original parser. No Markdown, binary, metadata or
UTF16 comparison view is skipped to obtain a passing scan.

Exit 0 requires both a complete scan and zero findings. A configured remote
always produces `REMOTE_HISTORY_UNVERIFIED`; verify its visible refs and object
reachability separately rather than removing its configuration to obtain green
output. A denylist scan cannot establish that unknown personal information or
image content is safe.

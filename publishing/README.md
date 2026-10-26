# Website publishing receiver and local audit tools

The current receiver and deployment instructions are documented in
[../PUBLISHING.md](../PUBLISHING.md). They use the website lexicon directory,
the static `catalog.mjs` module, the committed sanitizer bundle and lazy native
image loading. Keep the current deployment settings and never replace these
runtime fixes with an older installation package.

For full local verification on Node 24.x, install the pinned dependencies with
`npm ci --no-audit --no-fund` (including development dependencies), then run
`npm test`. The deployment intentionally installs production dependencies only;
see the root deployment instructions for the difference. Local acceptance
records, private audit inputs and diagnostics remain outside public commits and
Hugo output. A merge or successful local test does not establish live-service
acceptance or permission to enable publishing.

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

# Deployment asset optimization

`build.sh` runs `node scripts/optimize-deployment.mjs public` after Hugo.
This changes only generated output; archive source pages and original fonts remain intact.

- Archived JPEG, PNG, WebP and GIF data URLs become shared, SHA-256-named files under `/allsis/media/`. Image bytes are not re-encoded or resized. Unknown data formats stay inline.
- The site uses the full `static/fonts/lxgw-wenkai.woff2` font. No characters are removed. Two known identical TTF copies are omitted from the deployment output only after validating the WOFF2 file.
- Future imports receive the same optimization on the next production build.

Local build:

```sh
hugo --gc --cleanDestinationDir
node scripts/optimize-deployment.mjs public
node --test test/deployment-assets.test.mjs
```

The compressed font is checked in and does not require Python on Vercel. To regenerate it after a deliberate source-font update, install `fonttools` and `brotli`, then run `python scripts/compress-font.py`. That script verifies every decompressed font table. Also update the known source-font checksum in the deployment optimizer after reviewing a font change.

Verified on 2026-10-27: 116 archived pages, 2,721 extracted image references, 933 shared image files. Restoring each original data URL reproduced every source HTML file exactly. Output fell from 372,791,321 bytes (355.52 MiB, before adding WOFF2) to 229,695,219 bytes (219.05 MiB): about 38% smaller.

Deployment history still consumes storage. The existing one-day Vercel retention policy and batched publishing remain in place. This change does not create deployments, modify retention settings, or delete source content.

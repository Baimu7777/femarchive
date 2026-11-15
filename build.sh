#!/usr/bin/env bash
set -euo pipefail

DART_SASS_VERSION=1.98.0
GO_VERSION=1.26.1
HUGO_VERSION=0.148.1
NODE_VERSION=24.14.0

# Pinned SHA-256 digests of the four toolchain archives below. A download that
# does not match is refused, so a replaced release asset, a tampering proxy or
# a truncated transfer cannot run inside the build. Update these together with
# the versions above, from the vendors' own published checksums.
DART_SASS_SHA256=63340034916b39088e81008e77a93057f88013ea842821babdbb9979751de847
GO_SHA256=031f088e5d955bab8657ede27ad4e3bc5b7c1ba281f05f245bcc304f327c987a
HUGO_SHA256=7059e6037aacd7530482985db89420f22a554138a38b748c887873827a8447d5
NODE_SHA256=41cd79bb7877c81605a9e68ec4c91547774f46a40c67a17e34d7179ef11729df

export TZ=Asia/Kuala_Lumpur
mkdir -p "${HOME}/.local"

# Download to a filename we choose (never the remote Content-Disposition name)
# and verify the digest before anything is unpacked.
fetch() {
  local url="$1" file="$2" expected="$3"
  curl -sSL --proto '=https' --tlsv1.2 --fail --max-time 600 -o "${file}" "${url}"
  echo "${expected}  ${file}" | sha256sum -c -
}

# Install Dart Sass
fetch "https://github.com/sass/dart-sass/releases/download/${DART_SASS_VERSION}/dart-sass-${DART_SASS_VERSION}-linux-x64.tar.gz" \
  "dart-sass.tar.gz" "${DART_SASS_SHA256}"
tar -C "${HOME}/.local" -xf "dart-sass.tar.gz"
rm "dart-sass.tar.gz"
export PATH="${HOME}/.local/dart-sass:${PATH}"

# Install Go
fetch "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" "go.tar.gz" "${GO_SHA256}"
tar -C "${HOME}/.local" -xf "go.tar.gz"
rm "go.tar.gz"
export PATH="${HOME}/.local/go/bin:${PATH}"

# Install Hugo (match local version)
fetch "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz" \
  "hugo.tar.gz" "${HUGO_SHA256}"
mkdir -p "${HOME}/.local/hugo"
tar -C "${HOME}/.local/hugo" -xf "hugo.tar.gz"
rm "hugo.tar.gz"
export PATH="${HOME}/.local/hugo:${PATH}"

# Install Node.js
fetch "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" "node.tar.xz" "${NODE_SHA256}"
tar -C "${HOME}/.local" -xf "node.tar.xz"
rm "node.tar.xz"
export PATH="${HOME}/.local/node-v${NODE_VERSION}-linux-x64/bin:${PATH}"

# Refuse to build two pages under one public number, or a hand-numbered page
# the publishing receiver does not know about yet.
node scripts/check-slugs.mjs

# Resolve bare reference URLs before rendering; failures retain their original labels.
node scripts/link-titles.mjs

# Avoid build differences from minified HTML when localhost is normal but production is not.
hugo --gc --cleanDestinationDir --baseURL "${WEBSITE_PUBLIC_ORIGIN:-https://${VERCEL_PROJECT_PRODUCTION_URL:-example.com}}"

# Share byte-identical archived images and ship the compressed full font.
node scripts/optimize-deployment.mjs public

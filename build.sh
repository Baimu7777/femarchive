#!/usr/bin/env bash
set -euo pipefail

DART_SASS_VERSION=1.98.0
GO_VERSION=1.26.1
HUGO_VERSION=0.148.1
NODE_VERSION=24.14.0

export TZ=Asia/Kuala_Lumpur
mkdir -p "${HOME}/.local"

# Install Dart Sass
curl -sLJO "https://github.com/sass/dart-sass/releases/download/${DART_SASS_VERSION}/dart-sass-${DART_SASS_VERSION}-linux-x64.tar.gz"
tar -C "${HOME}/.local" -xf "dart-sass-${DART_SASS_VERSION}-linux-x64.tar.gz"
rm "dart-sass-${DART_SASS_VERSION}-linux-x64.tar.gz"
export PATH="${HOME}/.local/dart-sass:${PATH}"

# Install Go
curl -sLJO "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"
tar -C "${HOME}/.local" -xf "go${GO_VERSION}.linux-amd64.tar.gz"
rm "go${GO_VERSION}.linux-amd64.tar.gz"
export PATH="${HOME}/.local/go/bin:${PATH}"

# Install Hugo (match local version)
curl -sLJO "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz"
mkdir -p "${HOME}/.local/hugo"
tar -C "${HOME}/.local/hugo" -xf "hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz"
rm "hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz"
export PATH="${HOME}/.local/hugo:${PATH}"

# Install Node.js
curl -sLJO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
tar -C "${HOME}/.local" -xf "node-v${NODE_VERSION}-linux-x64.tar.xz"
rm "node-v${NODE_VERSION}-linux-x64.tar.xz"
export PATH="${HOME}/.local/node-v${NODE_VERSION}-linux-x64/bin:${PATH}"

# Avoid build differences from minified HTML when localhost is normal but production is not.
hugo --gc --cleanDestinationDir --baseURL "https://${VERCEL_PROJECT_PRODUCTION_URL:-example.com}"

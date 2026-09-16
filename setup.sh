#!/usr/bin/env sh
# DrawingBoard one-command setup for macOS and Linux.
#   ./setup.sh            start the editor
#   ./setup.sh --dev      also install the development dependencies
set -eu

cd "$(dirname "$0")"

DEV=0
FORWARD=""

usage() {
  cat <<'TEXT'
Usage: ./setup.sh [OPTIONS]

  Serve DrawingBoard and open it in your browser. Installs nothing by default.

Options:
  --dev          Also install the development dependencies for the test suites.
  --port PORT    Serve on PORT instead of 4173.
  --no-open      Start the server without opening a browser.
  --help, -h     Show this message and exit.
TEXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dev) DEV=1 ;;
    --help|-h) usage; exit 0 ;;
    *) FORWARD="$FORWARD $1" ;;
  esac
  shift
done

say() { printf '==> %s\n' "$1"; }
detail() { printf '    %s\n' "$1"; }

install_hint() {
  detail "Install Node.js 20.11 or newer, then run this script again:"
  case "$(uname -s)" in
    Darwin) detail "  brew install node    or    https://nodejs.org/en/download" ;;
    *)      detail "  https://nodejs.org/en/download   (your package manager's 'nodejs' is often too old)" ;;
  esac
}

say "Checking for Node.js"
if ! command -v node >/dev/null 2>&1; then
  detail "Node.js was not found."
  # Offer the one package manager we can reasonably drive, and only with consent.
  if [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    printf '    Install it now with Homebrew? [Y/n] '
    read -r reply || reply=n
    case "$reply" in
      [Nn]*) install_hint; exit 1 ;;
      *) say "Installing Node.js"; brew install node ;;
    esac
  else
    install_hint
    exit 1
  fi
fi

NODE_VERSION="$(node --version)"
detail "Found Node.js $NODE_VERSION"
NODE_MAJOR="$(printf '%s' "${NODE_VERSION#v}" | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  detail "Node.js 20.11 or newer is required."
  install_hint
  exit 1
fi

if [ "$DEV" -eq 1 ]; then
  say "Installing development dependencies"
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
  fi
  say "Installing the Chromium build used by the browser tests"
  npx playwright install chromium
  detail 'Run "npm test" and "npm run test:e2e" when you want the suites.'
fi

say "Starting DrawingBoard"
# shellcheck disable=SC2086
exec node scripts/serve.mjs $FORWARD

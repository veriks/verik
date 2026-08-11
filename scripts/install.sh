#!/usr/bin/env sh
set -e

REPO="veriks/verik"
INSTALL_DIR="${VERIK_INSTALL_DIR:-/usr/local/bin}"

# ─── detect platform ──────────────────────────────────────────────────────────

detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux"  ;;
    Darwin*) echo "macos"  ;;
    *)
      echo ""
      echo "  Windows detected."
      echo "  Install via npm instead:"
      echo ""
      echo "    npm install -g verik"
      echo ""
      exit 0
      ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)   echo "x64"   ;;
    arm64|aarch64)  echo "arm64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      echo "Install via npm: npm install -g verik" >&2
      exit 1
      ;;
  esac
}

OS=$(detect_os)
ARCH=$(detect_arch)
BINARY="verik-${OS}-${ARCH}"

# ─── get version ──────────────────────────────────────────────────────────────

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' \
    | sed -E 's/.*"([^"]+)".*/\1/')
fi

if [ -z "$VERSION" ]; then
  echo "Could not determine latest version. Pass a version explicitly:" >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh | sh -s v0.1.0" >&2
  exit 1
fi

# ─── download ─────────────────────────────────────────────────────────────────

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY}"
TMP=$(mktemp)

echo "Installing verik ${VERSION} (${OS}-${ARCH})..."
curl -fsSL --progress-bar "$DOWNLOAD_URL" -o "$TMP" || {
  echo "" >&2
  echo "Download failed. Binary may not exist for ${OS}-${ARCH}." >&2
  echo "Try: npm install -g verik" >&2
  exit 1
}

chmod +x "$TMP"

# ─── install ──────────────────────────────────────────────────────────────────

install_binary() {
  if [ -w "$INSTALL_DIR" ]; then
    mv "$TMP" "${INSTALL_DIR}/verik"
  else
    echo "Installing to ${INSTALL_DIR} (requires sudo)..."
    sudo mv "$TMP" "${INSTALL_DIR}/verik"
  fi
}

# Try /usr/local/bin first, fall back to ~/.local/bin
if install_binary 2>/dev/null; then
  INSTALLED="${INSTALL_DIR}/verik"
else
  FALLBACK="$HOME/.local/bin"
  mkdir -p "$FALLBACK"
  mv "$TMP" "${FALLBACK}/verik"
  INSTALLED="${FALLBACK}/verik"
  echo "Installed to ${FALLBACK}/verik"
  echo "Make sure ${FALLBACK} is in your PATH:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# ─── verify + done ────────────────────────────────────────────────────────────

echo ""
"$INSTALLED" --version && echo "" && echo "Run: verik init" || {
  echo "Binary installed but could not execute. Check your PATH." >&2
  exit 1
}

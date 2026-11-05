#!/bin/sh
# Installs the openstate binary for this machine from GitHub Releases:
#   curl -fsSL https://raw.githubusercontent.com/franlol/openstate/main/install.sh | sh
# OPENSTATE_INSTALL sets the folder (default ~/.local/bin), OPENSTATE_VERSION a version (default the latest),
# OPENSTATE_NO_DESKTOP=1 leaves the app launcher alone.
set -eu

repo="franlol/openstate"
dir="${OPENSTATE_INSTALL:-$HOME/.local/bin}"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "openstate: no build for $(uname -s); on Windows use: npm i -g @openstate/cli" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) cpu=x64 ;;
  arm64 | aarch64) cpu=arm64 ;;
  *) echo "openstate: no build for $(uname -m)" >&2; exit 1 ;;
esac

if [ -n "${OPENSTATE_VERSION:-}" ]; then
  url="https://github.com/$repo/releases/download/v${OPENSTATE_VERSION#v}/openstate-$os-$cpu.tar.gz"
else
  url="https://github.com/$repo/releases/latest/download/openstate-$os-$cpu.tar.gz"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "downloading openstate for $os-$cpu"
curl -fsSL "$url" | tar -xz -C "$tmp"
mkdir -p "$dir"
# Moved into place in one step, so a running openstate keeps its file until it restarts.
mv "$tmp/openstate" "$dir/openstate"
chmod +x "$dir/openstate"
echo "installed $("$dir/openstate" --version 2>/dev/null || echo openstate) to $dir/openstate"

# An entry in the app launcher (Spotlight, GNOME, KDE, rofi…); OPENSTATE_NO_DESKTOP=1 skips it.
if [ -z "${OPENSTATE_NO_DESKTOP:-}" ]; then
  "$dir/openstate" --desktop || true
fi

case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "add $dir to your PATH to run it as: openstate" ;;
esac

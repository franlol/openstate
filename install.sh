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
  base="https://github.com/$repo/releases/download/v${OPENSTATE_VERSION#v}"
else
  base="https://github.com/$repo/releases/latest/download"
fi
archive="openstate-$os-$cpu.tar.gz"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "downloading openstate for $os-$cpu"
curl -fsSL "$base/$archive" -o "$tmp/$archive"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"

# The archive must match the checksum published with it.
if command -v sha256sum >/dev/null; then
  sum="$(sha256sum "$tmp/$archive" | cut -d' ' -f1)"
else
  sum="$(shasum -a 256 "$tmp/$archive" | cut -d' ' -f1)"
fi
if ! grep -q "^$sum  $archive\$" "$tmp/SHA256SUMS"; then
  echo "openstate: $archive does not match its checksum; nothing was installed" >&2
  exit 1
fi
tar -xzf "$tmp/$archive" -C "$tmp"
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

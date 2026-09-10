#!/usr/bin/env bash
set -Eeuo pipefail

fecimus_project="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$(uname -s)" != Linux ]]; then
  echo 'Use scripts/install.ps1 on Windows 11 Pro. Only Ubuntu LTS-based Linux is supported here.' >&2
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo 'Install python3 before running Fecimus setup.' >&2; exit 1; }
python3 - <<'PY'
import pathlib, re, sys
values = {}
for line in pathlib.Path('/etc/os-release').read_text().splitlines():
    match = re.match(r'^([A-Z][A-Z0-9_]*)=(.*)$', line)
    if match:
        values[match[1]] = match[2].strip().strip('\"\'')
ubuntu = values.get('ID') == 'ubuntu'
derived = 'ubuntu' in values.get('ID_LIKE', '').split()
codename = values.get('UBUNTU_CODENAME') or (values.get('VERSION_CODENAME') if ubuntu else None)
versions = {'jammy': '22.04', 'noble': '24.04', 'resolute': '26.04'}
if not (ubuntu or derived) or codename not in versions or (ubuntu and values.get('VERSION_ID', versions[codename]) != versions[codename]):
    sys.exit('Fecimus requires Ubuntu 22.04/24.04/26.04 LTS or a derivative declaring that Ubuntu base.')
PY

# The Windows launcher stages a checked-out project on the Linux filesystem.
# All paths are positional arguments; no user path becomes executable shell text.
if [[ "${1:-}" == --copy-to ]]; then
  [[ $# -ge 2 && "$2" = /* ]] || { echo '--copy-to requires an absolute Linux path.' >&2; exit 1; }
  fecimus_target="$(realpath -m -- "$2")"
  case "$fecimus_target/" in "$fecimus_project/"*) echo 'Copy destination cannot be inside the source checkout.' >&2; exit 1;; esac
  [[ ! -e "$fecimus_target" ]] || { echo "Destination already exists: $fecimus_target" >&2; exit 1; }
  shift 2
  mkdir -p -- "$(dirname -- "$fecimus_target")"
  mkdir -- "$fecimus_target"
  tar -C "$fecimus_project" --exclude=.git --exclude=node_modules --exclude=.env --exclude='.env.*' \
    --exclude=.test-output --exclude=.test-state --exclude=coverage --exclude=dist --exclude=backups \
    --exclude=runtime --exclude=runtime-packages --exclude=verification.json --exclude=verification.log \
    --exclude=tool-catalog.json --exclude=settings.json --exclude=backends.json \
    --exclude=browser-output --exclude=browser-profiles --exclude=app-homes -cf - . | tar -C "$fecimus_target" -xf -
  exec bash "$fecimus_target/scripts/install.sh" "$@"
fi

# Keep an existing modern Node runtime; otherwise install a verified official
# Node 22 build privately. No shell profile edits or global Node replacement.
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  fecimus_node_root="${XDG_DATA_HOME:-${HOME}/.local/share}/fecimus/node"
  if [[ -x "$fecimus_node_root/bin/node" ]] && "$fecimus_node_root/bin/node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
    export PATH="$fecimus_node_root/bin:$PATH"
  else
    for fecimus_option in "$@"; do
      if [[ "$fecimus_option" == --check || "$fecimus_option" == --print-entry ]]; then
        echo 'Node.js 22+ is missing. Run bash scripts/install.sh to install a private runtime.' >&2
        exit 1
      fi
    done
    for fecimus_command in curl tar xz sha256sum; do
      command -v "$fecimus_command" >/dev/null 2>&1 || { echo "Missing $fecimus_command. Install curl xz-utils before retrying." >&2; exit 1; }
    done
    case "$(uname -m)" in
      x86_64) fecimus_arch=x64 ;;
      aarch64|arm64) fecimus_arch=arm64 ;;
      *) echo 'Fecimus requires x86-64 or ARM64.' >&2; exit 1 ;;
    esac
    fecimus_download="$(mktemp -d)"
    trap 'rm -rf -- "$fecimus_download"' EXIT
    curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt' -o "$fecimus_download/SHASUMS256.txt"
    fecimus_line="$(awk -v arch="$fecimus_arch" '$2 ~ ("^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") { print; count++ } END { if (count != 1) exit 1 }' "$fecimus_download/SHASUMS256.txt")"
    fecimus_archive="${fecimus_line##* }"
    fecimus_version="${fecimus_archive#node-}"
    fecimus_version="${fecimus_version%-linux-*}"
    curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/$fecimus_version/$fecimus_archive" -o "$fecimus_download/$fecimus_archive"
    (cd -- "$fecimus_download" && printf '%s\n' "$fecimus_line" | sha256sum --check --status)
    mkdir -p -- "$fecimus_node_root"
    tar -xJf "$fecimus_download/$fecimus_archive" --strip-components=1 -C "$fecimus_node_root"
    export PATH="$fecimus_node_root/bin:$PATH"
    rm -rf -- "$fecimus_download"
    trap - EXIT
  fi
fi
exec node "$fecimus_project/scripts/install.mjs" "$@"

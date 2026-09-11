#!/usr/bin/env bash
set -uo pipefail

# Works both at a release archive's root and in platform/Linux in a checkout.
fecimus_here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fecimus_root="$fecimus_here"
[[ -f "$fecimus_root/scripts/install.sh" ]] || fecimus_root="$(cd -- "$fecimus_here/../.." && pwd)"

fecimus_finish() {
  local fecimus_exit="$1"
  if (( fecimus_exit )); then
    echo "Fecimus setup failed (exit $fecimus_exit). Read the error above and START_HERE.md before retrying." >&2
  else
    echo 'Setup finished. Restart LM Studio and enable mcp/fecimus for a compatible model.'
  fi
  if [[ -t 0 && "${FECIMUS_NO_PAUSE:-0}" != 1 ]]; then
    read -r -p 'Press Enter to close this installer...' || true
  fi
  exit "$fecimus_exit"
}

if [[ "$(uname -s)" != Linux || "$EUID" == 0 ]]; then
  echo 'Run this launcher on Ubuntu LTS-based Linux as your ordinary user, not root.' >&2
  fecimus_finish 1
fi
if [[ ! -f "$fecimus_root/scripts/install.sh" || ! -f "$fecimus_root/package-lock.json" ]]; then
  echo 'Extract the complete Fecimus release before running this launcher.' >&2
  fecimus_finish 1
fi
for fecimus_command in python3 curl tar xz sha256sum; do
  if ! command -v "$fecimus_command" >/dev/null 2>&1; then
    echo "Missing prerequisite: $fecimus_command. Install python3 curl xz-utils before retrying." >&2
    fecimus_finish 1
  fi
done

if [[ "${1:-}" == --no-gui ]]; then
  shift
elif [[ $# == 0 && "${FECIMUS_NO_GUI:-0}" != 1 && -n "${DISPLAY:-}" ]] && python3 "$fecimus_root/scripts/setup-gui.py" --check >/dev/null 2>&1; then
  exec python3 "$fecimus_root/scripts/setup-gui.py"
fi

fecimus_target="$HOME/.local/share/fecimus/sources/release-$(date -u +%Y%m%d-%H%M%S)-$$"
echo "Installing a fresh Fecimus source copy in $fecimus_target"
bash "$fecimus_root/scripts/install.sh" --copy-to "$fecimus_target" --system-deps --replace-legacy "$@"
fecimus_finish "$?"

#!/usr/bin/env bash
# temphost.sh — overlay extra host entries onto the real /etc/hosts,
# system-wide, via a bind mount, until explicitly undone.
#
# Usage:
#   sudo ./temp-hosts.sh apply /path/to/extra-hosts-file
#   sudo ./temp-hosts.sh undo
#   sudo ./temp-hosts.sh status

set -euo pipefail

STATE_DIR="/run/temp-hosts"
MERGED="$STATE_DIR/merged"

usage() {
  echo "Usage:" >&2
  echo "  $0 apply /path/to/extra-hosts-file" >&2
  echo "  $0 undo" >&2
  echo "  $0 status" >&2
  exit 1
}

require_root() {
  if [[ $EUID -ne 0 ]]; then
    exec sudo "$0" "$@"
  fi
}

cmd_apply() {
  local extra_file="${1:-}"
  if [[ -z "$extra_file" || ! -f "$extra_file" ]]; then
    echo "apply requires a valid extra-hosts file path" >&2
    usage
  fi

  if mountpoint -q /etc/hosts; then
    echo "/etc/hosts already has an overlay mounted. Run '$0 undo' first." >&2
    exit 1
  fi

  mkdir -p "$STATE_DIR"

  # Real entries first, your additions appended after (first match wins
  # for most resolvers, so flip the order here if you want overrides
  # to take priority instead).
  cat /etc/hosts "$extra_file" > "$MERGED"
  chmod 644 "$MERGED"

  mount --bind "$MERGED" /etc/hosts
  echo "Applied: /etc/hosts now includes entries from $extra_file (system-wide)."
  echo "Run '$0 undo' to revert."
}

cmd_undo() {
  if ! mountpoint -q /etc/hosts; then
    echo "No overlay currently mounted on /etc/hosts." >&2
    exit 0
  fi
  umount /etc/hosts
  rm -f "$MERGED"
  echo "Reverted: /etc/hosts is back to the original."
}

cmd_status() {
  if mountpoint -q /etc/hosts; then
    echo "Overlay is ACTIVE."
  else
    echo "No overlay active. /etc/hosts is the original."
  fi
}

[[ $# -ge 1 ]] || usage

case "$1" in
  apply)
    require_root "$@"
    shift
    cmd_apply "$@"
    ;;
  undo)
    require_root "$@"
    cmd_undo
    ;;
  status)
    cmd_status
    ;;
  *)
    usage
    ;;
esac

# Shared by the scheduled jobs. Sourced, not run.
#
# Nothing here names a machine, a user or a version: the repository is found
# from this file's own location, and Node from the environment.

# The repository root: two levels above this file.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Prints the path of a Node binary, or fails with advice.
#
# A systemd user service gets a minimal PATH, which leaves out version managers,
# so after PATH this looks where they keep their default version.
# Set GIVEBACK_NODE to choose one explicitly.
find_node() {
  if [ -n "${GIVEBACK_NODE:-}" ]; then
    printf '%s\n' "$GIVEBACK_NODE"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  local candidate
  for candidate in \
    "${FNM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/fnm}/aliases/default/bin/node" \
    "$HOME/.volta/bin/node" \
    "$HOME/.local/bin/node"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  # nvm keeps one directory per version. Take the newest.
  candidate="$(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node 2>/dev/null | sort -V | tail -n 1)"
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  echo "giveback: cannot find Node. Set GIVEBACK_NODE to the path of a node binary (version 22.18 or later)." >&2
  return 1
}

# Runs scripts/giveback with the arguments given.
giveback() {
  local node
  node="$(find_node)" || return 1
  "$node" "$REPO/scripts/giveback" "$@"
}

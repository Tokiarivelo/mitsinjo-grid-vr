#!/usr/bin/env bash
# Stops the IWER MCP bridge (`@iwer/extension-bridge`, port 8723) started by another tool.
# Only one bridge can hold the port: when Antigravity IDE has started its own, Claude Code's `iwer`
# MCP server dies with EADDRINUSE (« Failed to reconnect to iwer: CONNECTION_CLOSED »).
# Default: stops the bridges launched by Antigravity and the orphaned ones (launcher gone). ALL=1 stops every bridge (Claude Code's too).
# Usage: scripts/iwer-bridge-stop.sh   then `/mcp` → reconnect iwer
port="${IWER_MCP_PORT:-8723}"

# True when one of the process's ancestors is Antigravity.
from_antigravity() {
  local p="$1" cmd
  while [ -n "$p" ] && [ "$p" != 0 ] && [ "$p" != 1 ]; do
    cmd=$(ps -o args= -p "$p" 2>/dev/null) || return 1
    case "$cmd" in *[Aa]ntigravity*) return 0 ;; esac
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
  return 1
}

# True when the bridge lost its launcher: its `npm exec` / `sh -c` wrappers were killed and it now hangs under
# init / `systemd --user`, still holding the port (a closed or reconnected session leaves one behind).
orphaned() {
  local p="$1" cmd
  while [ -n "$p" ] && [ "$p" != 0 ] && [ "$p" != 1 ]; do
    cmd=$(ps -o args= -p "$p" 2>/dev/null) || return 1
    case "$cmd" in
      *systemd*) return 0 ;;
      *iwer-bridge* | *@iwer/extension-bridge*) ;;
      *) return 1 ;;
    esac
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
  return 0
}

targets=""
# Anchored on the three real command lines (npm exec, its sh -c, the node bin): never this script, `make`,
# or a shell whose command text merely mentions the bridge.
for pid in $(pgrep -f '^(npm exec @iwer/extension-bridge|sh -c "?iwer-bridge"?|node [^ ]*/iwer-bridge) *$'); do
  if [ -n "$ALL" ] || from_antigravity "$pid" || orphaned "$pid"; then targets="$targets $pid"; fi
done

if [ -z "$targets" ]; then
  if [ -n "$ALL" ]; then echo "No IWER bridge is running."; else echo "No Antigravity or orphaned IWER bridge is running."; fi
  ss -ltnpH "sport = :$port" 2>/dev/null | grep -q . &&
    echo "Port $port is held by another bridge (this session's?): ALL=1 stops it too."
  exit 0
fi

echo "Stopping IWER bridge (pids:$targets)"
# shellcheck disable=SC2086
kill -TERM $targets 2>/dev/null || true
sleep 2
# shellcheck disable=SC2086
kill -KILL $targets 2>/dev/null || true

if ss -ltnH "sport = :$port" 2>/dev/null | grep -q .; then
  echo "Port $port is still held (another bridge: ALL=1 stops it too)."
else
  echo "Port $port is free: run /mcp and reconnect iwer."
fi

#!/usr/bin/env bash
# Stops the IWER MCP bridge (`@iwer/extension-bridge`, port 8723) started by another tool.
# Only one bridge can hold the port: when Antigravity IDE has started its own, Claude Code's `iwer`
# MCP server dies with EADDRINUSE (« Failed to reconnect to iwer: CONNECTION_CLOSED »).
# Default: stops only the bridges launched by Antigravity. ALL=1 stops every bridge (Claude Code's too).
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

targets=""
# `iwer-bridge` followed by a space, a quote or the end: never this script (`iwer-bridge-stop.sh`) or `make iwer-bridge-stop`.
for pid in $(pgrep -f '(iwer-bridge|@iwer/extension-bridge)("| |$)'); do
  if [ -n "$ALL" ] || from_antigravity "$pid"; then targets="$targets $pid"; fi
done

if [ -z "$targets" ]; then
  if [ -n "$ALL" ]; then echo "No IWER bridge is running."; else echo "No IWER bridge started by Antigravity is running."; fi
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

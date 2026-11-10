#!/usr/bin/env bash
# Stops the dev server on a port for good. Killing only `next-server` does not work:
# its parent `next dev` (under `pnpm` / `turbo run dev`) respawns it with a new PID.
# So walk up from the listener to the dev launcher and terminate every process group on the way.
# Usage: scripts/dev-stop.sh <port>
port="${1:?usage: dev-stop.sh <port>}"

pid=$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
if [ -z "$pid" ]; then
  echo "Nothing listens on port $port."
  exit 0
fi

groups=""
p="$pid"
while [ -n "$p" ] && [ "$p" != 1 ]; do
  cmd=$(ps -o args= -p "$p" 2>/dev/null) || break
  case "$cmd" in
    *next*|*pnpm*|*turbo*|*port.mjs*|"sh -c"*) ;;
    *) break ;; # reached the user's shell / terminal: stop climbing
  esac
  g=$(ps -o pgid= -p "$p" | tr -d ' ')
  case " $groups " in *" $g "*) ;; *) groups="$groups $g" ;; esac
  p=$(ps -o ppid= -p "$p" | tr -d ' ')
done

echo "Stopping dev server on :$port (process groups:$groups)"
for g in $groups; do kill -TERM -- "-$g" 2>/dev/null || true; done
sleep 2
if ss -ltnH "sport = :$port" | grep -q .; then
  for g in $groups; do kill -KILL -- "-$g" 2>/dev/null || true; done
  sleep 1
fi
if ss -ltnH "sport = :$port" | grep -q .; then
  echo "Port $port is still busy." >&2
  exit 1
fi
echo "Port $port is free."

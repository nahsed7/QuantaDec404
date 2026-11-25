#!/bin/sh
# Start the server in the background (keeps running after you close this shell).
# Restarts only the live server: a "node server.js" started from this folder with no PORT set, or PORT=8080.
# Test servers (other PORT values) are left alone.
cd "$(dirname "$0")"
here=$(pwd -P)
for p in $(pgrep -f "^node server.js"); do
  [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$here" ] || continue
  port=$(tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | sed -n 's/^PORT=//p')
  [ -z "$port" ] || [ "$port" = "8080" ] || continue
  kill "$p"
done
# Cap the JS heap so the research engine cannot grow without bound on the phone.
NODE_OPTIONS=--max-old-space-size=256 nohup node server.js > server.log 2>&1 &
sleep 1; cat server.log

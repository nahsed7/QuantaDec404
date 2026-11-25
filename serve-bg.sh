#!/bin/sh
# Start the server in the background (keeps running after you close this shell).
cd "$(dirname "$0")"
for p in $(pgrep -f "^node server.js"); do kill "$p"; done
# Cap the JS heap so the research engine cannot grow without bound on the phone.
NODE_OPTIONS=--max-old-space-size=256 nohup node server.js > server.log 2>&1 &
sleep 1; cat server.log

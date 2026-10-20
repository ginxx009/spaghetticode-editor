#!/bin/zsh
# Double-click to start spaghettiCode Studio, then it opens in your browser.
cd "$(dirname "$0")"
command -v node >/dev/null || source ~/.nvm/nvm.sh 2>/dev/null
pgrep -x ollama >/dev/null || (ollama serve >/dev/null 2>&1 &)
if ! lsof -iTCP:5757 -sTCP:LISTEN >/dev/null 2>&1; then
  node app/server.mjs &
  sleep 1
fi
open http://localhost:5757
wait

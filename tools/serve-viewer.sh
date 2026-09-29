#!/usr/bin/env bash
# Serves the Agora web viewer on localhost (the Agora Web SDK needs a secure
# context; localhost qualifies). Prefill credentials through the URL so they
# never live in this repository:
#   http://localhost:8765/?appId=<APP_ID>&channel=<CHANNEL>[&token=<TOKEN>]
set -euo pipefail

port="${1:-8765}"
script_dir="$(cd "$(dirname "$0")" && pwd)"

echo "Viewer: http://localhost:$port/?appId=<APP_ID>&channel=<CHANNEL>" >&2
cd "$script_dir/agora-viewer"
exec python3 -m http.server "$port" --bind 127.0.0.1

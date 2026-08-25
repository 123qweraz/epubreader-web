#!/usr/bin/env bash
# EPUB 阅读器一键启动: 本地静态服务 + 打开浏览器
# 用法: ./start.sh [--app] [端口]
#   --app   用 Chrome 应用窗口模式打开(无地址栏, 类似桌面应用)
#   端口    默认 8480, 被占用时自动顺延
set -euo pipefail
cd "$(dirname "$0")"

APP_MODE=0
PORT="${PORT:-8480}"
for arg in "$@"; do
  case "$arg" in
    --app) APP_MODE=1 ;;
    ''|*[!0-9]*) echo "未知参数: $arg (用法: ./start.sh [--app] [端口])" >&2; exit 1 ;;
    *) PORT="$arg" ;;
  esac
done

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&-; return 0; } || return 1; }
while port_busy "$PORT"; do PORT=$((PORT + 1)); done

URL="http://127.0.0.1:$PORT/"
SERVER_PID=""

cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER_PID=$!
else
  echo "未找到 python3, 回退 node 内置静态服务" >&2
  node -e '
    const http = require("http"), fs = require("fs"), path = require("path");
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
      ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
      ".ico": "image/x-icon", ".woff2": "font/woff2" };
    const root = process.cwd();
    http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      const f = path.join(root, path.normalize(p));
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404); return res.end();
      }
      res.writeHead(200, { "content-type": mime[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    }).listen(parseInt(process.argv[1]), "127.0.0.1");
  ' "$PORT" &
  SERVER_PID=$!
fi

for _ in $(seq 1 50); do
  port_busy "$PORT" && break
  sleep 0.1
done

echo "✓ 阅读器已启动: $URL  (Ctrl+C 停止)"
if [ "$APP_MODE" = 1 ] && command -v google-chrome >/dev/null 2>&1; then
  google-chrome --app="$URL" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

wait "$SERVER_PID"

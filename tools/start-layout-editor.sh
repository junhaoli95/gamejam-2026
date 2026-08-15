#!/usr/bin/env bash
# 一键启动布局编辑器:save-server(8899) + vite dev(5173) + 浏览器打开编辑器
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EDITOR_URL="http://localhost:5173/tools/layout-editor.html"

port_open() { lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

echo "▶ 布局编辑器启动器"

if port_open 8899; then
  echo "  ✓ save-server 已在跑(8899)"
else
  echo "  … 启动 save-server(8899)"
  (node tools/save-server.mjs >/tmp/layout-save-server.log 2>&1 &)
  for _ in $(seq 1 20); do
    port_open 8899 && break
    sleep 0.25
  done
  if port_open 8899; then
    echo "  ✓ save-server 已就绪"
  else
    echo "  ✗ save-server 启动失败,看 /tmp/layout-save-server.log"
    exit 1
  fi
fi

if port_open 5173; then
  echo "  ✓ vite dev 已在跑(5173)"
else
  echo "  … 启动 vite dev(5173)"
  (npm run dev >/tmp/layout-vite.log 2>&1 &)
  for _ in $(seq 1 60); do
    port_open 5173 && break
    sleep 0.25
  done
  if port_open 5173; then
    echo "  ✓ vite dev 已就绪"
  else
    echo "  ✗ vite dev 启动失败,看 /tmp/layout-vite.log"
    exit 1
  fi
fi

echo "  → 打开 $EDITOR_URL"
open "$EDITOR_URL"
echo "✔ 完成。游戏入口 http://localhost:5173/ · 编辑器日志 /tmp/layout-save-server.log"

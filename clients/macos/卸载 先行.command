#!/bin/bash
# 卸载「先行」：删除应用本体和本机数据。
# 服务器上的账号、待办、记录、附件不会被删除，重新安装后登录即可看到。
# 用法：双击运行；也可以在终端里执行 bash 这个文件。

set -u

NAME="先行"
BUNDLE="io.github.yraguo.firstmove"
TARGETS=(
  "/Applications/$NAME.app"
  "$HOME/Applications/$NAME.app"
  "$HOME/Library/Application Support/$NAME"
  "$HOME/Library/Caches/$NAME"
  "$HOME/Library/Logs/$NAME"
  "$HOME/Library/HTTPStorages/$BUNDLE"
  "$HOME/Library/WebKit/$BUNDLE"
  "$HOME/Library/Saved Application State/$BUNDLE.savedState"
  "$HOME/Library/Preferences/$BUNDLE.plist"
)

echo "先行 · 卸载程序"
echo "------------------------------------------------------------"
echo "将要删除以下内容："
found=0
for path in "${TARGETS[@]}"; do
  if [ -e "$path" ]; then
    found=$((found + 1))
    size=$(du -sh "$path" 2>/dev/null | cut -f1)
    echo "  · $path  (${size:-?})"
  fi
done

if [ "$found" -eq 0 ]; then
  echo "  （没有找到需要删除的内容）"
  echo
  echo "本机似乎已经清理干净。"
  read -r -n 1 -s -p "按任意键关闭窗口"
  exit 0
fi

echo
echo "服务器上的数据不受影响：重新安装并登录后，待办、记录、附件都还在。"
echo
read -r -p "确认删除以上 ${found} 项？输入 y 继续，其他任意键取消：" answer
case "$answer" in
  [yY]) ;;
  *) echo "已取消。"; read -r -n 1 -s -p "按任意键关闭窗口"; exit 0 ;;
esac

echo
echo "正在退出先行…"
osascript -e "tell application \"$NAME\" to quit" >/dev/null 2>&1 &
sleep 2
pkill -f "/Applications/$NAME.app/Contents/MacOS/$NAME" >/dev/null 2>&1

echo "正在删除…"
removed=0
for path in "${TARGETS[@]}"; do
  if [ -e "$path" ]; then
    if rm -rf "$path" 2>/dev/null; then
      echo "  已删除 $path"
      removed=$((removed + 1))
    else
      echo "  删除失败 $path（可能需要在「系统设置 → 隐私与安全性」里授权，或手动删除）"
    fi
  fi
done

echo
echo "完成，共删除 ${removed} 项。"
echo "服务器上的数据仍在，重新安装后登录即可继续使用。"
read -r -n 1 -s -p "按任意键关闭窗口"

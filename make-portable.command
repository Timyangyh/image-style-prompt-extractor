#!/bin/zsh
set -e

cd "$(dirname "$0")"

source "scripts/mac-env.zsh"

APP_NAME="图片复刻大师.app"
PORTABLE_DIR="portable/图片复刻大师-便携包"
APP_SOURCE="release/mac-arm64/$APP_NAME"
ZIP_PATH="portable/图片复刻大师-便携包.zip"
VERIFY_DIR=""

cleanup() {
  if [ -n "$VERIFY_DIR" ] && [ -d "$VERIFY_DIR" ]; then
    rm -rf "$VERIFY_DIR"
  fi
}

trap cleanup EXIT

verify_app_bundle() {
  local app_path="$1"
  local app_exec="$app_path/Contents/MacOS/图片复刻大师"
  local framework_dir="$app_path/Contents/Frameworks/Electron Framework.framework"
  local symlink_paths=(
    "$framework_dir/Electron Framework"
    "$framework_dir/Helpers"
    "$framework_dir/Libraries"
    "$framework_dir/Resources"
    "$framework_dir/Versions/Current"
  )

  if [ ! -x "$app_exec" ]; then
    fail "应用主程序没有可执行权限：$app_exec"
  fi

  for symlink_path in "${symlink_paths[@]}"; do
    if [ ! -L "$symlink_path" ]; then
      fail "应用 bundle 符号链接丢失或被复制成普通文件：$symlink_path"
    fi
  done

  codesign --verify --deep --strict --verbose=2 "$app_path"
}

prepare_project_runtime
ensure_packaging_tools

log_step "生成 M 系列 Mac 便携应用"
npm run pack

if [ ! -d "$APP_SOURCE" ]; then
  fail "未找到 M 系列 Mac 应用产物：$APP_SOURCE"
fi

log_step "补齐本地 ad-hoc 代码签名"
codesign --force --deep --sign - "$APP_SOURCE"
verify_app_bundle "$APP_SOURCE"

rm -rf "$PORTABLE_DIR"
mkdir -p "$PORTABLE_DIR"
ditto --rsrc --extattr --acl "$APP_SOURCE" "$PORTABLE_DIR/$APP_NAME"

cat > "$PORTABLE_DIR/使用说明.txt" <<EOF
图片复刻大师便携包

生成时间：$(date "+%Y-%m-%d %H:%M:%S %Z")

使用方式：
1. 跨电脑迁移时，请优先传输整个“图片复刻大师-便携包.zip”，不要直接上传或复制 .app 文件夹。
2. 在另一台 M 系列 Mac 上解压 zip 后，双击打开“图片复刻大师.app”。
3. 如果 macOS 阻止打开，请右键点击 App，选择“打开”。
4. 第一次使用需要在 App 内重新填写模型 API Base URL、模型名称和 API Key。

命令行解压方式：
ditto -x -k "图片复刻大师-便携包.zip" .

不要使用会把 macOS 符号链接转成普通文件、或丢失可执行权限的上传/下载/复制方式传输 .app。

如需重新生成最终便携包，请回到源码项目双击 make-portable.command，不要复用旧 zip。

注意：
- 当前便携包只面向 M 系列 Mac，不面向 Intel Mac。
- 这个便携包不包含当前电脑上的 API Key。
- 这个便携包不包含当前电脑上的图片分析历史。
- 模型配置和历史记录默认保存在每台 Mac 自己的应用数据目录中。
- 如需抹除当前 Mac 上保存的数据，请进入 App 的“模型配置”，使用“本机数据清理”。
EOF

rm -f "$ZIP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$PORTABLE_DIR" "$ZIP_PATH"

log_step "验证便携 zip 解压后的应用完整性"
VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/image-style-portable.XXXXXX")"
ditto -x -k "$ZIP_PATH" "$VERIFY_DIR"
verify_app_bundle "$VERIFY_DIR/图片复刻大师-便携包/$APP_NAME"

echo ""
echo "便携包已生成："
echo "$PORTABLE_DIR"
echo "$ZIP_PATH"

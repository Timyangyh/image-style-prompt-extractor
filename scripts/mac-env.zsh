#!/bin/zsh

set -e

MIN_NODE_MAJOR=20

log_step() {
  echo ""
  echo "==> $1"
}

fail() {
  echo ""
  echo "执行失败：$1"
  if [ -t 0 ]; then
    echo "按任意键关闭窗口。"
    read -k 1 -s || true
  fi
  exit 1
}

ensure_macos() {
  if [ "$(uname -s)" != "Darwin" ]; then
    fail "当前脚本只支持 macOS。"
  fi
}

ensure_apple_silicon() {
  local supports_arm64
  supports_arm64="$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)"
  if [ "$supports_arm64" != "1" ]; then
    fail "当前项目便携启动脚本只面向 M 系列 Mac。"
  fi

  if [ "$(uname -m)" != "arm64" ]; then
    fail "当前终端运行在 Rosetta/x64 环境下。请关闭 Rosetta 后重新双击脚本，确保使用 arm64 的 Node.js 和依赖。"
  fi
}

add_common_paths() {
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
}

node_major_version() {
  node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0
}

ensure_node() {
  add_common_paths

  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    local major
    major="$(node_major_version)"
    if [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
      echo "Node.js: $(node --version)"
      echo "npm: $(npm --version)"
      return
    fi
    echo "检测到 Node.js $(node --version)，需要 v${MIN_NODE_MAJOR} 或更高版本。"
  else
    echo "未检测到 Node.js/npm。"
  fi

  if command -v brew >/dev/null 2>&1; then
    log_step "通过 Homebrew 安装或更新 Node.js"
    brew install node || brew upgrade node
    add_common_paths
    hash -r

    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
      local major
      major="$(node_major_version)"
      if [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
        echo "Node.js: $(node --version)"
        echo "npm: $(npm --version)"
        return
      fi
    fi

    fail "Homebrew 已运行，但仍未检测到可用的 Node.js v${MIN_NODE_MAJOR}+。请重新打开终端或检查 PATH。"
  fi

  open "https://nodejs.org/en/download" >/dev/null 2>&1 || true
  fail "这台 Mac 没有 Node.js/npm，也没有 Homebrew。已尝试打开 Node.js 下载页；安装 Node.js v${MIN_NODE_MAJOR}+ 后再双击本脚本。"
}

project_platform_key() {
  local node_abi
  node_abi="$(node -p "process.versions.modules")"
  echo "$(uname -s)-$(uname -m)-nodeabi${node_abi}"
}

install_project_dependencies() {
  log_step "安装项目依赖"
  if [ -f "package-lock.json" ]; then
    npm ci
  else
    npm install
  fi
  mkdir -p node_modules
  project_platform_key > node_modules/.mac-env-platform
}

ensure_project_dependencies() {
  if [ ! -f "package.json" ]; then
    fail "未找到 package.json，请确认脚本位于项目根目录。"
  fi

  local current_platform
  current_platform="$(project_platform_key)"

  local installed_platform=""
  if [ -f "node_modules/.mac-env-platform" ]; then
    installed_platform="$(cat node_modules/.mac-env-platform)"
  fi

  local needs_install=0
  if [ ! -d "node_modules" ]; then
    needs_install=1
    echo "未检测到 node_modules。"
  elif [ "$installed_platform" != "$current_platform" ]; then
    needs_install=1
    echo "检测到依赖不是为当前 Mac 架构或 Node 版本安装的。"
  elif [ -f "package-lock.json" ] && [ ! -f "node_modules/.package-lock.json" ]; then
    needs_install=1
    echo "依赖状态不完整。"
  elif [ -f "package-lock.json" ] && [ "package-lock.json" -nt "node_modules/.mac-env-platform" ]; then
    needs_install=1
    echo "package-lock.json 已更新，需要重新安装依赖。"
  elif [ -f "package.json" ] && [ "package.json" -nt "node_modules/.mac-env-platform" ]; then
    needs_install=1
    echo "package.json 已更新，需要重新安装依赖。"
  fi

  if [ "$needs_install" -eq 1 ]; then
    install_project_dependencies
  else
    echo "项目依赖已就绪。"
  fi
}

ensure_packaging_tools() {
  local missing_tools=()
  for tool in codesign ditto lipo; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing_tools+=("$tool")
    fi
  done

  if [ "${#missing_tools[@]}" -eq 0 ]; then
    return
  fi

  echo "缺少 macOS 打包工具：${missing_tools[*]}"
  xcode-select --install >/dev/null 2>&1 || true
  fail "请先按系统弹窗安装 Command Line Tools，完成后重新双击脚本。"
}

prepare_project_runtime() {
  ensure_macos
  ensure_apple_silicon
  log_step "检查运行环境"
  ensure_node
  ensure_project_dependencies
}

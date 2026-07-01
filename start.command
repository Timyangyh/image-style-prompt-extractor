#!/bin/zsh
set -e

cd "$(dirname "$0")"

source "scripts/mac-env.zsh"

prepare_project_runtime

log_step "启动开发版应用"
npm run dev

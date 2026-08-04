#!/bin/zsh

set -u

script_dir=${0:A:h}
repo_root=${script_dir:h}

cd "$repo_root"

echo "Starting interview-forge..."
echo

node scripts/dev-launcher.mjs

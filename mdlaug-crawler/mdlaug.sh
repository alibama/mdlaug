#!/usr/bin/env bash
# mDLAUG crawler for Mac and Linux.   Usage:  bash mdlaug.sh <command>
# Start with:  bash mdlaug.sh setup      List of commands:  bash mdlaug.sh help
set -e
cd "$(dirname "$0")"
PY=.venv/bin/python

if [ "${1:-help}" = "setup" ]; then
  # uv installs Python and the libraries into a private folder (.venv) here.
  UV="$(command -v uv || true)"
  if [ -z "$UV" ] && [ -x "$HOME/.local/bin/uv" ]; then UV="$HOME/.local/bin/uv"; fi
  if [ -z "$UV" ]; then
    echo "== Installing uv (it installs Python for this project)"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    UV="$HOME/.local/bin/uv"
  fi
  if [ ! -x "$PY" ]; then
    echo "== Creating the Python environment"
    "$UV" venv --python 3.12 .venv
  fi
  echo "== Installing libraries (a minute or two the first time)"
  "$UV" pip install --python "$PY" -r requirements.txt -r requirements-analysis.txt pytest
fi

if [ ! -x "$PY" ]; then
  echo "Not set up yet. Run this first:   bash mdlaug.sh setup"
  exit 1
fi
exec "$PY" scripts/helper.py "$@"

#!/usr/bin/env bash
# Build and run the Worzel LVGL simulator.
#
# Prerequisites: sudo apt-get install libsdl2-dev cmake build-essential
#
# Usage: ./run.sh [--clean]

set -euo pipefail
cd "$(dirname "$0")"

BUILD_DIR="build"

if [[ "${1:-}" == "--clean" ]]; then
    echo "Cleaning build..."
    rm -rf "$BUILD_DIR"
fi

if [[ ! -d "$BUILD_DIR" ]]; then
    echo "Configuring CMake..."
    cmake -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Debug
fi

echo "Building..."
cmake --build "$BUILD_DIR" -j "$(nproc)" 2>&1

echo ""
echo "Launching simulator..."
exec "$BUILD_DIR/worzel_sim"

#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
manifest="$repo_root/crates/noteriv-git/Cargo.toml"
module="$repo_root/phone/modules/noteriv-git"
case "${1:-android}" in
  android)
    # Requires Android NDK, rustup targets and cargo-ndk (see docs/sync/native-git.md).
    cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -o "$module/android/src/main/jniLibs" build --manifest-path "$manifest" --release
    ;;
  ios)
    for target in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
      cargo build --manifest-path "$manifest" --release --target "$target"
    done
    output="$repo_root/crates/noteriv-git/target"
    mkdir -p "$output/ios-simulator" "$output/headers"
    printf 'char *noteriv_git_execute(const char *request);\nvoid noteriv_git_free(char *response);\n' > "$output/headers/noteriv_git.h"
    lipo -create "$output/aarch64-apple-ios-sim/release/libnoteriv_git.a" "$output/x86_64-apple-ios/release/libnoteriv_git.a" -output "$output/ios-simulator/libnoteriv_git.a"
    rm -rf "$module/ios/NoterivGit.xcframework"
    xcodebuild -create-xcframework -library "$output/aarch64-apple-ios/release/libnoteriv_git.a" -headers "$output/headers" -library "$output/ios-simulator/libnoteriv_git.a" -headers "$output/headers" -output "$module/ios/NoterivGit.xcframework"
    ;;
  *) echo 'Use android or ios' >&2; exit 1 ;;
esac

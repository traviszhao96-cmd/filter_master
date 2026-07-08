# Scene LUT Recommendation Product Package

Build: assembleFastUserRelease
Branch: codex/scene-lut-recommendation
Commit: f7f40891ae (f7f40891ae6b4c4e3878860b9b28debd1467d75d)
Base: origin/develop2 2c5e0687f9

Contents:
- apk/NTCamera-arm64-v8a-userRelease.apk: APK built from this branch.
- product_docs/: product debug guide, product AI playbook, ML Kit label map, and feature overview.
- scene_lut_recommend/: full default external debug package with rules.json and 20 LUT PNG files.
- examples/minimal-rules.json: minimal copy-ready rules.json example from the product AI playbook.

Quick push example:
adb shell mkdir -p /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/luts
adb push scene_lut_recommend/rules.json /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/rules.json
adb push scene_lut_recommend/luts /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/

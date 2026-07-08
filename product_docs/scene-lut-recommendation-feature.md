# Scene LUT Recommendation Feature

## 目标

场景 LUT 推荐首阶段只负责「识别场景 -> 推荐现有滤镜/LUT -> 用户选择套用」，不自动应用，也不生成新 LUT。为了方便产品在早期频繁调规则和 LUT 内容，Feature 支持优先读取手机存储中的临时配置，未找到或解析失败时回退到 assets 默认配置。

## 接入位置

- Feature：`main-module/src/main/java/com/nothing/camera/module/feature/local/scenelut/`
- 默认配置：`main-module/src/main/assets/scene_lut_recommend/rules.json`
- 默认 LUT：`main-module/src/main/assets/scene_lut_recommend/luts/`
- 产品调试指南：`docs/features/scene-lut-recommendation-debug-guide.md`
- 产品侧 AI 调试上下文：`docs/features/scene-lut-product-ai-playbook.md`
- 顶部栏临时入口：后置 `PHOTO` 模式的 `topbar_scene_lut_recommend`
- 临时选择 UI：点击入口后在底部展示 `AI 智拍` 推荐卡片面板，推荐卡复用滤镜列表实时小窗能力，用当前预览帧分别套用对应 LUT 展示预期效果；点选卡片后用预览区胶囊提示当前套用的风格；面板右上角提供刷新按钮，用于强制下一帧重新执行场景识别并刷新推荐卡。
- 滤镜套用：复用 `FilterDataManager`、`DataKeys.FILTER`、`DataKeys.FILTER_EFFECT_NAME`、`DataKeys.FILTER_INTENSITY`

## 外部调试目录

配置优先从 App external files 目录读取：

```text
/sdcard/Android/data/<package>/files/scene_lut_recommend/rules.json
```

外部 LUT 文件使用相对路径，根目录同上：

```text
/sdcard/Android/data/<package>/files/scene_lut_recommend/luts/cafe.png
```

示例：

```bash
adb push rules.json /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/rules.json
adb push cafe.png /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/luts/cafe.png
```

点击顶部栏 AI 入口时会强制重载外部配置，并用最近一次 ML Kit 标签重新计算推荐列表，便于不重启 App 调整规则。

## rules.json 结构

```json
{
  "schemaVersion": 1,
  "labelThreshold": 0.65,
  "detectIntervalMs": 2500,
  "maxRecommendations": 3,
  "filters": [
    {
      "id": "debug_cafe",
      "effectName": "9101",
      "displayName": "Cafe Debug",
      "lutFile": "luts/cafe.png",
      "defaultStrength": 80,
      "iqaStatus": "approved"
    }
  ],
  "scenes": [
    {
      "sceneId": "cafe",
      "displayName": "Cafe",
      "priority": 84,
      "labels": [
        { "index": 181, "minConfidence": 0.6, "weight": 110 }
      ],
      "recommendations": [ "debug_cafe" ]
    }
  ]
}
```

`effectName` 为数字字符串且处于自定义滤镜 ID 范围时，会被注册为 debug LUT，并复制到 App 内部 `files/<effectName>/filter.png`，后续预览和拍照继续走现有滤镜链路。`lutFile` 只能指向调试目录内的相对路径，避免误读其他外部文件。

assets 默认配置也支持 `lutFile`，路径同样写成相对 `scene_lut_recommend/` 的子路径。当前默认包内置了 20 个临时 LUT 和 20 个场景规则，effectName 使用 `9101` 到 `9120`，用于前期验证推荐链路和产品调试交互。后续产品调色确认后，可以直接替换同名 PNG 或通过手机存储目录覆盖规则与 LUT。

## 时序约束

- 配流阶段只声明需要后置 Photo 的 640x480 analysis YUV 流。
- ML Kit labeler、配置读取和外部 LUT 拷贝均延后到 `FIRST_FRAME_AVAILABLE` 之后，避免进入首帧前启动关键路径。
- `media.Image` 只在回调内同步拷贝成独立 NV21 byte array，ML Kit 异步处理不持有原始 Image。

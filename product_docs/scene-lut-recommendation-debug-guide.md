# Scene LUT Recommendation Debug Guide

## 适用范围

本文面向产品和调试同学，说明场景 LUT 推荐第一阶段如何在不重新打包的情况下，通过手机存储快速调整推荐规则和 LUT 文件。

当前调试入口只在后置 `PHOTO` 模式顶部栏展示。点击顶部栏 AI 入口时，App 会重新读取手机外部调试目录中的配置，并用最近一次识别到的 ML Kit 标签重新计算推荐结果。

如果产品侧使用 Codex 或其他 AI 工具反复调整规则，请先把 `docs/features/scene-lut-product-ai-playbook.md` 作为任务上下文提供给 AI。

## 调试目录

App 优先读取手机上的外部调试目录：

```text
/sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/
```

目录结构固定如下：

```text
scene_lut_recommend/
  rules.json
  luts/
    ai_portrait_soft.png
    ai_food_warm.png
```

如果外部目录中没有 `rules.json`，或外部配置解析失败，App 会回退到包内默认配置：

```text
main-module/src/main/assets/scene_lut_recommend/rules.json
main-module/src/main/assets/scene_lut_recommend/luts/
```

## 最短调试流程

1. 在电脑上准备一个调试目录，里面放 `rules.json` 和 `luts/`。
2. 通过 adb 推送到手机：

```bash
adb shell mkdir -p /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/luts
adb push rules.json /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/rules.json
adb push luts/ai_portrait_soft.png /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/luts/ai_portrait_soft.png
```

3. 打开 Camera，切到后置拍照模式。
4. 点击顶部栏 AI 入口。每次点击都会尝试重新加载外部配置。
5. 底部出现推荐卡后，点击某张卡即可套用对应滤镜效果；点击面板右上角刷新按钮可强制重新识别当前画面并刷新推荐卡。

如果只改了 `rules.json` 或某个 LUT PNG，不需要重启 App；重新 `adb push` 后再次点击顶部栏 AI 入口即可。

## 清空外部覆盖

需要回到包内默认配置时，删除手机外部调试目录：

```bash
adb shell rm -rf /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend
```

然后重新进入相机或再次点击 AI 入口，App 会使用 assets 默认配置。

## rules.json 示例

```json
{
  "schemaVersion": 1,
  "labelThreshold": 0.55,
  "detectIntervalMs": 2500,
  "maxRecommendations": 3,
  "filters": [
    {
      "id": "ai_food_warm",
      "effectName": "9102",
      "displayName": "AI Food Warm",
      "lutFile": "luts/ai_food_warm.png",
      "defaultStrength": 82,
      "iqaStatus": "approved"
    }
  ],
  "scenes": [
    {
      "sceneId": "food_closeup",
      "displayName": "Food",
      "priority": 96,
      "labels": [
        { "index": 184, "minConfidence": 0.55, "weight": 120 },
        { "index": 300, "minConfidence": 0.5, "weight": 100 }
      ],
      "recommendations": [ "ai_food_warm" ]
    }
  ]
}
```

## 全局字段

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 当前写 `1`。 |
| `labelThreshold` | 全局标签置信度过滤阈值。低于该值的 ML Kit 标签不会参与推荐。 |
| `detectIntervalMs` | 场景识别间隔，最小会被限制为 `500` ms。建议调试期保持 `2500`。 |
| `maxRecommendations` | 最多展示几张推荐卡，当前 UI 上限为 `3`。 |
| `filters` | 可推荐的 LUT 列表。 |
| `scenes` | 场景识别规则与推荐映射。 |

## filters 字段

| 字段 | 说明 |
| --- | --- |
| `id` | 规则内引用的滤镜 ID，必须唯一。 |
| `effectName` | 滤镜运行态 ID。调试期建议使用 `9101` 到 `9120`，也可以使用 `100` 到 `9999` 之间未冲突的数字字符串。 |
| `displayName` | 推荐卡和套用提示里展示的名称。 |
| `lutFile` | LUT 文件相对路径，只能写调试目录内的相对路径，例如 `luts/ai_food_warm.png`。 |
| `defaultStrength` | 默认强度，范围 `0` 到 `100`。 |
| `iqaStatus` | 只有 `approved` 会参与推荐；其他值会被跳过。 |

`effectName` 对应的 LUT 会被复制到 App 内部滤镜目录，后续实时预览、拍照和推荐小窗都复用现有滤镜链路。相同 `effectName` 再次加载时会覆盖旧 LUT，所以产品可以稳定复用同一批 `effectName` 反复调参。

## scenes 字段

| 字段 | 说明 |
| --- | --- |
| `sceneId` | 场景 ID，必须唯一。 |
| `displayName` | 推荐卡上的场景展示名。 |
| `priority` | 场景优先级，数值越大越优先。 |
| `labels` | 命中该场景需要关注的 ML Kit 标签。 |
| `recommendations` | 命中场景后推荐的滤镜 `id` 列表，最多展示会受 `maxRecommendations` 限制。 |

`labels` 里的单条规则包含：

| 字段 | 说明 |
| --- | --- |
| `index` | ML Kit 默认 Image Label 的标签 index。 |
| `minConfidence` | 该标签命中本场景所需的最低置信度。 |
| `weight` | 该标签对排序分数的权重。 |

完整 ML Kit 默认标签索引见 `docs/features/scene-lut-mlkit-label-map.md`。注意：`sceneId` 是产品自定义业务场景 ID，ML Kit 提供的是 `labels[].index` 标签索引，两者不需要一一对应。

## 推荐排序逻辑

推荐计算按以下规则执行：

1. 先丢弃低于全局 `labelThreshold` 的识别标签。
2. 每个场景只要有一个 `labels` 规则命中，就认为该场景可推荐。
3. 同一场景内取 `confidence * weight` 最高的命中标签作为该场景分数来源。
4. 最终分数约等于 `priority + confidence * weight`。
5. 同一个 `recommendations` 列表里，越靠前的滤镜优先级越高。
6. 多个场景推荐到同一个 `effectName` 时，只保留排序最高的一条。
7. 最终取前 `maxRecommendations` 个展示。

调试建议：

- 想让某个场景更容易出现：降低对应 `minConfidence`，或提高 `priority`。
- 想让某个 LUT 更靠前：把它放到 `recommendations` 更前面，或提高场景 `priority`。
- 想减少误触发：提高 `labelThreshold` 或该场景的 `minConfidence`。

## LUT 文件要求

调试 LUT 请使用与现有普通滤镜一致的 PNG LUT 格式：

- 推荐尺寸：`512x512`。
- 推荐参考：`lib-render/src/main/assets/filter_*.png`。
- 不要使用普通照片、预览图、压缩截图或通道顺序不明的图片直接当 LUT。
- 文件名和 `rules.json` 中的 `lutFile` 必须一致。
- `lutFile` 只能是相对路径，不能以 `/` 开头，也不能包含 `.` 或 `..` 路径段。

如果出现推荐小窗或主预览颜色明显反掉，优先检查 LUT PNG 的格式和通道布局是否与普通滤镜一致。

## 常用排查命令

查看外部调试目录：

```bash
adb shell ls -la /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend
adb shell ls -la /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/luts
```

查看场景推荐相关日志：

```bash
adb logcat -c
adb logcat | grep -i "SceneLut"
```

Windows 环境也可以使用：

```bash
adb logcat | findstr /i "SceneLut"
```

常见日志含义：

| 现象 | 可能原因 |
| --- | --- |
| `parse external config failed` | 外部 `rules.json` 不是合法 JSON，或字段类型错误。 |
| `skip unavailable filter` | `effectName` 不合法、LUT 文件不存在，或滤镜未能注册成功。 |
| `skip unsafe lut path` | `lutFile` 使用了绝对路径、空路径，或包含 `.` / `..`。 |
| `recommendations=0` | 当前识别标签没有命中任何场景，或命中的场景没有有效推荐滤镜。 |

## 常见问题

### 修改后没有变化

确认是否完成了三件事：

1. `rules.json` 已经 push 到手机外部调试目录。
2. 被引用的 LUT PNG 已经 push 到 `luts/` 目录。
3. 已经重新点击顶部栏 AI 入口触发重载。

### 推荐为空

优先检查：

1. 当前是否是后置拍照模式。
2. `filters` 里的 `iqaStatus` 是否为 `approved`。
3. `scenes.recommendations` 引用的是否是 `filters.id`，不是 `effectName`。
4. `labelThreshold` 和 `minConfidence` 是否过高。
5. 被推荐的 LUT 文件是否存在。

### 想临时下线某个 LUT

把对应 filter 的 `iqaStatus` 改成非 `approved`，或从场景的 `recommendations` 中移除对应 `id`。

### 想固定复用一批 LUT ID

调试期建议固定使用 `9101` 到 `9120`。同一个 `effectName` 每次加载都会覆盖内部 LUT 文件，适合产品反复替换同名 PNG 做效果对比。

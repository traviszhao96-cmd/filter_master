# Scene LUT Product AI Playbook

## 目标读者

本文面向产品侧使用 Codex 或其他 AI 工具调试场景 LUT 推荐规则的同学。目标是让 AI 在没有工程同学陪同的情况下，也能理解当前功能边界、正确修改 `rules.json` 和 LUT 包，并通过 adb 快速验证。

如果只是查看人工调试步骤，先读 `docs/features/scene-lut-recommendation-debug-guide.md`。如果需要选择 ML Kit 标签 index，查 `docs/features/scene-lut-mlkit-label-map.md`。

## 先给 AI 的一句话上下文

场景 LUT 推荐第一阶段是配置驱动功能：App 用 ML Kit 默认 Image Labeling 模型识别当前预览帧，得到一组 `ImageLabel.index + confidence`，再根据 `rules.json` 把这些 ML Kit 标签组合成产品自定义 `sceneId`，最后推荐 `filters` 中配置的 LUT。产品调试期通常只需要修改外部调试包里的 `rules.json` 和 `luts/*.png`，不需要改 Android 代码。

## 当前实现事实

| 项 | 当前事实 |
| --- | --- |
| 入口 | 后置 `PHOTO` 模式顶部栏 AI 入口。 |
| ML Kit 依赖 | `com.google.mlkit:image-labeling:17.0.9`。 |
| ML Kit 接入 | 使用默认 `ImageLabeling.getClient(ImageLabelerOptions.DEFAULT_OPTIONS)`。 |
| 标签来源 | `ImageLabel.index` 和 `ImageLabel.confidence`。 |
| 标签全集 | `docs/features/scene-lut-mlkit-label-map.md`。官方说明默认模型支持 400+ 标签。 |
| 外部配置优先级 | 手机外部调试目录优先，解析失败或不存在时回退 assets。 |
| 热重载方式 | 重新点击顶部栏 AI 入口。 |
| UI 展示上限 | 最多 3 张推荐卡。 |
| 套用方式 | 用户点击推荐卡后，复用现有滤镜三元组 `FILTER / FILTER_EFFECT_NAME / FILTER_INTENSITY`。 |
| LUT 存储 | 配置加载后复制到 App 内部 `files/<effectName>/filter.png`。 |

## 产品侧 AI 的默认工作边界

除非工程同学明确要求，否则产品侧 AI 调试只修改这些内容：

```text
scene_lut_recommend/
  rules.json
  luts/*.png
```

如果是在仓库里同步默认包内配置，只修改：

```text
main-module/src/main/assets/scene_lut_recommend/rules.json
main-module/src/main/assets/scene_lut_recommend/luts/*.png
docs/features/scene-lut-recommendation-debug-guide.md
docs/features/scene-lut-mlkit-label-map.md
docs/features/scene-lut-product-ai-playbook.md
```

不要让产品侧 AI 主动修改 Kotlin、Java、XML 或 Gradle 代码。需要代码改动时，应回到工程分支处理。

## 三个容易混淆的 ID

| 名称 | 谁维护 | 作用 | 示例 |
| --- | --- | --- | --- |
| ML Kit `index` | Google ML Kit | 模型输出标签 ID，用在 `labels[].index`。 | `184` 表示 `Food`。 |
| `sceneId` | 产品自定义 | 业务场景 ID，只要求在 `rules.json` 内唯一。 | `food_closeup`。 |
| filter `id` | 产品自定义 | `recommendations` 引用的滤镜 ID。 | `ai_food_warm`。 |
| `effectName` | 滤镜链路运行态 ID | App 内部识别 LUT 的稳定 ID。调试期建议 `9101` 到 `9120`。 | `9102`。 |

关键规则：

- `scenes[].recommendations` 写的是 `filters[].id`，不是 `effectName`。
- `labels[].index` 写的是 ML Kit label index，不是 `sceneId`。
- `sceneId` 不需要和 ML Kit label 名称一致，可以由产品按场景含义命名。
- 同一个 `effectName` 每次重新加载都会覆盖内部 LUT，适合反复替换同名 PNG 调效果。

## rules.json 最小接入示例

产品侧 AI 可以先复制下面内容到 `scene_lut_recommend/rules.json`，再把 `lutFile` 对应的 PNG 放到 `scene_lut_recommend/luts/`。后续调试只需要增删 `filters` 和 `scenes` 数组项。

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
    },
    {
      "id": "ai_portrait_soft",
      "effectName": "9101",
      "displayName": "AI Portrait Soft",
      "lutFile": "luts/ai_portrait_soft.png",
      "defaultStrength": 78,
      "iqaStatus": "approved"
    },
    {
      "id": "ai_mountain_crisp",
      "effectName": "9114",
      "displayName": "AI Mountain Crisp",
      "lutFile": "luts/ai_mountain_crisp.png",
      "defaultStrength": 80,
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
        { "index": 48, "minConfidence": 0.50, "weight": 90 },
        { "index": 276, "minConfidence": 0.50, "weight": 100 }
      ],
      "recommendations": [ "ai_food_warm", "ai_portrait_soft", "ai_mountain_crisp" ]
    },
    {
      "sceneId": "people_daily",
      "displayName": "People",
      "priority": 92,
      "labels": [
        { "index": 66, "minConfidence": 0.55, "weight": 120 },
        { "index": 386, "minConfidence": 0.50, "weight": 70 }
      ],
      "recommendations": [ "ai_portrait_soft", "ai_food_warm", "ai_mountain_crisp" ]
    },
    {
      "sceneId": "mountain_landscape",
      "displayName": "Mountain",
      "priority": 88,
      "labels": [
        { "index": 337, "minConfidence": 0.55, "weight": 120 }
      ],
      "recommendations": [ "ai_mountain_crisp", "ai_food_warm", "ai_portrait_soft" ]
    }
  ]
}
```

这个示例里的 ML Kit 标签含义是：`184 = Food`、`48 = Fast food`、`276 = Pizza`、`66 = Person`、`386 = Fun`、`337 = Mountain`。更多标签查 `docs/features/scene-lut-mlkit-label-map.md`。

## 一次调试循环

### 1. 明确目标

先让产品说清楚本轮只改哪类东西：

- 新增或删除场景。
- 调整某个场景的命中难度。
- 替换某个 LUT 文件。
- 调整推荐排序。
- 临时下线某个 LUT。
- 排查推荐为空或颜色异常。

### 2. 查标签

根据目标场景到 `docs/features/scene-lut-mlkit-label-map.md` 查 ML Kit 标签 index。一个业务场景可以绑定多个标签，例如食物场景可组合：

```json
[
  { "index": 184, "minConfidence": 0.55, "weight": 120 },
  { "index": 48, "minConfidence": 0.50, "weight": 90 },
  { "index": 276, "minConfidence": 0.50, "weight": 100 }
]
```

这表示 Food、Fast food、Pizza 任一标签命中都可以触发该业务场景。

### 3. 修改 `filters`

新增 LUT 时先加 `filters` 项：

```json
{
  "id": "ai_food_warm",
  "effectName": "9102",
  "displayName": "AI Food Warm",
  "lutFile": "luts/ai_food_warm.png",
  "defaultStrength": 82,
  "iqaStatus": "approved"
}
```

字段约束：

- `id` 必须唯一。
- `effectName` 建议固定复用 `9101` 到 `9120`。
- `lutFile` 必须是相对路径，推荐统一放在 `luts/` 下。
- `defaultStrength` 必须在 `0` 到 `100`。
- `iqaStatus` 只有 `approved` 会生效。

### 4. 修改 `scenes`

再把 filter `id` 写进某个场景的 `recommendations`：

```json
{
  "sceneId": "food_closeup",
  "displayName": "Food",
  "priority": 96,
  "labels": [
    { "index": 184, "minConfidence": 0.55, "weight": 120 },
    { "index": 48, "minConfidence": 0.50, "weight": 90 }
  ],
  "recommendations": [ "ai_food_warm", "ai_cafe_film", "ai_indoor_cozy" ]
}
```

字段约束：

- `sceneId` 必须唯一。
- `priority` 越大越优先。
- `recommendations` 最好按产品期望展示顺序排列。
- `recommendations` 引用不存在的 filter `id` 会被跳过。

### 5. 校验 JSON 和引用关系

AI 修改完后必须至少做这些检查：

- JSON 能被解析。
- 所有 `filters[].id` 唯一。
- 所有 `filters[].effectName` 唯一，且是数字字符串。
- 所有 `filters[].lutFile` 对应文件存在。
- 所有 `scenes[].sceneId` 唯一。
- 所有 `scenes[].recommendations` 都能在 `filters[].id` 中找到。
- 所有 `labels[].index` 都能在 ML Kit label map 中找到。
- `maxRecommendations` 不超过 `3`。

PowerShell 快速检查 JSON：

```powershell
Get-Content .\scene_lut_recommend\rules.json -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
```

Python 快速检查 JSON：

```bash
python -m json.tool scene_lut_recommend/rules.json > /dev/null
```

### 6. 推送到手机

```bash
adb shell mkdir -p /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/luts
adb push scene_lut_recommend/rules.json /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/rules.json
adb push scene_lut_recommend/luts /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/
```

如果只改了一个 LUT，也可以只 push 单个文件：

```bash
adb push scene_lut_recommend/luts/ai_food_warm.png /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/luts/ai_food_warm.png
```

### 7. 触发重载

在相机后置拍照模式下点击顶部栏 AI 入口。每次点击都会重新读取外部配置，并尝试用最近一次 ML Kit 标签重新计算推荐。

### 8. 看结果并继续迭代

如果推荐不符合预期，优先按以下顺序调整：

1. 推荐为空：降低 `labelThreshold` 或场景内 `minConfidence`。
2. 场景触发太宽：提高对应场景 `minConfidence`，或降低误触发场景 `priority`。
3. 推荐排序不对：调整 `priority` 或 `recommendations` 内部顺序。
4. LUT 效果不对：替换同名 PNG，保持 `effectName` 不变。
5. 小窗颜色异常：优先检查 LUT PNG 是否符合普通滤镜 LUT 格式。

## 推荐打分的 AI 解释版

当前推荐不是复杂模型，只是一层规则排序：

```text
候选场景分数 = scene.priority + 命中标签 confidence * 标签 weight
```

同一个场景里，如果多个 label 都命中，只取 `confidence * weight` 最高的那个。一个场景可以吐出多个推荐 LUT，但 `recommendations` 越靠前越优先。同一个 `effectName` 被多个场景推荐时，只保留分数最高的一条。

调参直觉：

- `priority` 控制场景之间谁更强。
- `weight` 控制同一场景里哪个 ML Kit 标签更能代表这个场景。
- `minConfidence` 控制某个标签触发这个场景的门槛。
- `labelThreshold` 是全局最低门槛，低于它的标签根本进不了规则层。

## LUT 规则

产品侧 AI 不应把普通照片当 LUT。当前滤镜链路期望的是普通滤镜同款 PNG LUT：

- 推荐 `512x512`。
- 推荐参考 `lib-render/src/main/assets/filter_*.png`。
- 文件扩展名使用 `.png`。
- 文件路径和 `lutFile` 完全一致。
- 替换 LUT 时优先复用原文件名和原 `effectName`，便于对比。

颜色反、色相错、明暗明显异常时，优先怀疑 LUT 文件格式或通道布局，而不是优先改 UV、renderer 或相机代码。

## 外部调试目录和回滚

查看当前手机外部调试包：

```bash
adb shell ls -la /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend
adb shell ls -la /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend/luts
```

清空外部调试包，回到 App 内置默认配置：

```bash
adb shell rm -rf /sdcard/Android/data/com.nothing.camera/files/scene_lut_recommend
```

## 日志排查

实时查看场景 LUT 日志：

```bash
adb logcat | grep -i "SceneLut"
```

Windows 环境：

```bash
adb logcat | findstr /i "SceneLut"
```

常见日志和判断：

| 日志片段 | 判断 |
| --- | --- |
| `parse external config success` | 外部 `rules.json` 解析成功。 |
| `parse external config failed` | 外部 JSON 格式或字段类型有问题。 |
| `skip filter id=` | 某个 filter 被跳过，重点查 `iqaStatus`、`effectName`、`lutFile`。 |
| `skip unavailable filter` | LUT 缺失、`effectName` 不合法或滤镜注册失败。 |
| `skip unsafe lut path` | `lutFile` 不是安全相对路径。 |
| `detect labels=` | ML Kit 有识别结果。 |
| `recommendations=0` | 有识别标签，但规则没有推荐出有效 LUT。 |

## 给产品侧 Codex 的提示词模板

### 新增或调整规则

```text
你是场景 LUT 推荐规则调试助手。请只修改 scene_lut_recommend/rules.json，不改 Android 代码。

先阅读：
1. docs/features/scene-lut-recommendation-debug-guide.md
2. docs/features/scene-lut-mlkit-label-map.md
3. docs/features/scene-lut-product-ai-playbook.md

本轮目标：
- 目标场景：
- 期望推荐 LUT：
- 希望更容易触发还是更保守：
- 需要保留/删除的旧规则：

完成后请检查：
- JSON 可解析
- recommendations 都引用 filters.id
- labels[].index 都在 ML Kit label map 里
- lutFile 文件存在
- 不修改代码
```

### 替换 LUT

```text
你是场景 LUT 推荐资源调试助手。请只替换 scene_lut_recommend/luts 下的 PNG，并保持 rules.json 里的 lutFile、effectName 和 filter id 不变。

替换后请检查：
- PNG 文件名与 rules.json 的 lutFile 一致
- 尺寸和格式尽量对齐 512x512 普通滤镜 LUT
- 不新增无用文件
- 不修改 Android 代码
```

### 根据日志排查

```text
你是场景 LUT 推荐问题排查助手。请根据下面 adb logcat 片段判断是 JSON、LUT 文件、ML Kit 标签命中、推荐排序还是 App 代码问题。

请优先给出不改代码的配置修复建议。如果必须改代码，明确说明原因和涉及文件。

日志：
<粘贴 SceneLut 相关日志>
```

## AI 常见误判

| 误判 | 正确做法 |
| --- | --- |
| 把 `sceneId` 当成 ML Kit 固定枚举。 | `sceneId` 是产品自定义，ML Kit 固定的是 `labels[].index`。 |
| 在 `recommendations` 里写 `effectName`。 | 应写 `filters[].id`。 |
| 新增 filter 后忘记放 LUT 文件。 | `lutFile` 指向的 PNG 必须同步存在。 |
| 为每次调试分配新的 `effectName`。 | 调试期优先复用稳定 `effectName`，便于覆盖和对比。 |
| 推荐为空时直接改代码。 | 先查日志、阈值、label index、filter 引用和 LUT 文件。 |
| 颜色异常时先改 renderer。 | 先确认 LUT PNG 格式是否与普通滤镜一致。 |
| 为了多展示推荐卡把 `maxRecommendations` 改大。 | 当前 UI 上限是 3，超过也会被限制或不符合交互预期。 |

## 什么时候需要工程介入

出现以下情况时，不建议产品侧 AI 继续只改配置：

- 需要新增顶部栏入口或调整 UI 布局。
- 需要展示超过 3 张推荐卡。
- 需要改 ML Kit 模型、换自定义模型或接入其他算法。
- 需要按画面局部位置推荐，而不是整帧标签推荐。
- 需要自动套用 LUT，而不是用户手动点击。
- 配置和 LUT 都正确，但 App 日志显示运行时异常或渲染崩溃。

## 参考文档

- `docs/features/scene-lut-recommendation-debug-guide.md`
- `docs/features/scene-lut-mlkit-label-map.md`
- `docs/features/scene-lut-recommendation-feature.md`
- Google ML Kit Android Image Labeling：`https://developers.google.com/ml-kit/vision/image-labeling/android`
- Google ML Kit default label map：`https://developers.google.com/ml-kit/vision/image-labeling/label-map`

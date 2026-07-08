# Scene LUT 推荐逻辑说明

日期：2026-07-01

本文说明当前评分台里的完整推荐链路：如何选择 ML Kit 标签、如何把 ML Kit 输出转换成业务场景分、如何根据场景拿到 LUT 推荐，以及评分结果目前怎样影响推荐。

当前可执行配置以 `scene_lut_recommend/rules.json` 为准；本文是给产品和客户端开发看的规则说明。

## 1. 总体流程

一张图片进入推荐流程后，当前逻辑分 5 步：

1. 读取图片的 sidecar metadata。
2. 从 metadata 中标准化 ML Kit labels。
3. 根据 labels、目录名、手工 metadata 计算业务场景分。
4. 取分数最高的业务场景，合并这些场景绑定的 LUT。
5. 前端根据当前图片的人工评分做一次低分降级、未知场景兜底，以及“5 个候选中随机 3 个置顶”。

简化伪代码：

```js
labels = normalizeLabels(imageMetadata)
tags = metadata.tags + metadata.scenes + metadata.sceneId + labels.label
sceneMatches = matchScenes(rules.scenes, metadata, labels, tags, imagePath)
recommendedFilterIds = unique(sceneMatches.flatMap(scene => scene.recommendations)).slice(0, 5)

// 前端补充逻辑
recommendedFilterIds = recommendedFilterIds.filter(id => imageAverageRating(id) > 0 || noRatingYet(id))
if (recommendedFilterIds.length === 0) recommendedFilterIds = unknownSceneFallback
recommendedFilterIds = promoteRandom3ToFront(recommendedFilterIds.slice(0, 5))
```

## 2. ML Kit 选择原则

当前使用的是 Google ML Kit 默认 Image Labeling 模型：

- Android 依赖：`com.google.mlkit:image-labeling:17.0.9`
- 参考标签表：`product_docs/scene-lut-mlkit-label-map.md`
- 推荐逻辑依赖 `ImageLabel.index` 和 `confidence`，不依赖 label 文案翻译。

为什么选 Image Labeling：

- 当前目标是粗粒度判断“什么场景适合什么滤镜”，不是做人脸识别、分割或精细物体框选。
- Image Labeling 已能覆盖人物、食物、夜景、植物、海边、建筑、宠物、车辆、室内等主要场景。
- Android 相机 App 侧可以直接端上运行，输入 Bitmap 后输出 `index / text / confidence`，与当前评分台规则一致。

业务场景不是直接等于 ML Kit label。我们用多个 ML Kit label 组合成一个业务 `sceneId`。选择 label 时遵循：

- 同一组 label 套滤镜的诉求相近，才归到同一业务场景。
- 样本不足或滤镜诉求接近时先合并，不提前拆细。
- 场景优先服务 LUT 选择，不按 LUT 名字做场景映射。
- 核心 label 使用更高权重和更高置信度门槛，辅助 label 使用较低权重和较低门槛。

例子：

- `Coffee`、`Cappuccino` 当前并入 `indoor_home`，不单独做 Cafe。
- `Party`、`Concert`、`Event`、`Fireworks` 当前并入 `night_neon`，不单独做 Party。
- `Person`、`Selfie`、`Baby` 组合成 `portrait_single`，因为核心滤镜诉求都是肤色、脸部自然度和柔和对比。

## 3. ML Kit 输出格式

评分台刷新场景库时，如果配置了 `MLKIT_LABEL_COMMAND`，会对每张没有标签的图片调用外部命令。当前本地 Android helper 是：

```bash
npm run start:mlkit
```

命令会收到图片绝对路径，并输出 JSON：

```json
{
  "labels": [
    { "index": 184, "label": "Food", "confidence": 0.86 },
    { "index": 181, "label": "Coffee", "confidence": 0.62 }
  ]
}
```

评分台会把结果写入图片旁边的 sidecar：

```text
image.jpg.json
```

写入字段包括：

```json
{
  "labels": [
    { "index": 184, "label": "Food", "confidence": 0.86 }
  ],
  "mlkitLabels": [
    { "index": 184, "label": "Food", "confidence": 0.86 }
  ],
  "mlkit": {
    "provider": "ML Kit",
    "generatedAt": "2026-07-01T00:00:00.000Z",
    "sourceImage": "subdir/image.jpg"
  }
}
```

兼容读取字段：

- `labels`
- `mlkitLabels`
- `imageLabels`
- `detectedLabels`
- `tags`

如果 label 是字符串，只会参与文本 tag 匹配；如果要参与 ML Kit 加权打分，必须有稳定的 `index`。

## 4. 场景打分公式

每个业务场景都有：

- `sceneId`
- `displayName`
- `priority`
- `labels[]`
- `recommendations[]`

单个场景的分数由三类信息相加：

### 4.1 手工 metadata 强匹配

如果 metadata 里有：

- `sceneId`
- `scene`
- `category`

并且它等于当前规则的 `sceneId` 或 `displayName`：

```text
score += 10000
reason = metadata
```

这个优先级最高，适合人工强制指定场景。

### 4.2 文本 tag / 路径匹配

系统会把以下信息组成文本 tags：

- `metadata.tags`
- `metadata.scenes`
- `metadata.sceneId`
- `metadata.scene`
- `metadata.category`
- ML Kit label 文案

如果 tag 或图片相对路径包含 `sceneId`：

```text
score += 5000
reason = tag
```

如果 tag 或路径包含 `displayName`：

```text
score += 4500
reason = tag
```

这主要用于人工整理过的目录或 metadata。

### 4.3 ML Kit label 加权匹配

每个场景的 `labels[]` 都是一个匹配要求：

```json
{
  "index": 184,
  "minConfidence": 0.55,
  "weight": 120
}
```

如果图片 ML Kit 输出里存在相同 `index`，并且：

```text
confidence >= minConfidence
```

则：

```text
score += weight * confidence
reason = mlkit
```

例子：

```text
Food #184, confidence = 0.86
food_closeup 中 #184 的 weight = 120
得分 = 120 * 0.86 = 103.2
```

如果同一张图同时命中多个 label，会累加多个 label 的分数。

## 5. 场景排序和截断

所有场景算完后：

1. 丢弃 `score <= 0` 的场景。
2. 按 `score` 从高到低排序。
3. 如果分数相同，按 `priority` 从高到低排序。
4. 只保留前 3 个场景。

排序公式：

```js
sortBy(score desc, priority desc).slice(0, 3)
```

`priority` 只用于平分或接近时的稳定排序，不会直接加到 `score` 里。

## 6. 当前业务场景与 ML Kit label

| sceneId | 业务含义 | priority | ML Kit labels |
| --- | --- | ---: | --- |
| `portrait_single` | 人像 / 自拍 / 婴儿 | 100 | #66 Person >=0.55 x120; #439 Selfie >=0.55 x110; #421 Baby >=0.50 x90; #46 Smile >=0.55 x95; #373 Model >=0.50 x85; #218 Crowd >=0.75 x85; #185 Standing >=0.70 x80; #230 Outerwear >=0.75 x70; #197 Jacket >=0.70 x60 |
| `food_closeup` | 食物 / 近景餐饮 | 96 | #184 Food >=0.55 x120; #300 Sushi >=0.50 x100; #276 Pizza >=0.50 x100; #48 Fast food >=0.50 x90; #117 Cuisine; #236 Tableware; #428 Meal; #388 Vegetable; #187 Fruit; #393 Cake; #162 Gelato; #90 Cookware and bakeware; #119 Juice; #126 Cookie; #134 Cutlery; #259 Tablecloth; #332 Bread; #415 Supper; #419 Lunch; #433 Pie |
| `sunset_sunrise` | 日落日出 | 94 | #49 Sunset >=0.55 x130 |
| `night_neon` | 夜景 / 霓虹 / 派对活动 | 90 | #104 Nightclub >=0.50 x110; #140 Neon >=0.50 x110; #398 Fireworks >=0.45 x90; #260 Party >=0.50 x105; #75 Concert >=0.45 x90; #319 Event >=0.45 x90; #76 Prom; #86 Casino; #170 Deejay; #237 Ballroom; #189 Sparkler; #347 Carnival; #430 Alcohol |
| `forest_greenery` | 植物 / 森林 / 绿植 | 88 | #193 Forest >=0.50 x120; #266 Plant >=0.50 x100; #357 Garden >=0.50 x90; #205 Flora >=0.50 x90; #22 Park; #355 Branch; #359 Field; #408 Prairie; #114 Jungle; #180 Trunk |
| `beach_sea` | 海边 / 沙滩 | 86 | #353 Beach >=0.50 x120; #333 Sand >=0.50 x90; #281 Surfing >=0.45 x90; #167 Vacation; #96 Pier |
| `street_vehicle` | 街道 / 车辆环境 | 84 | #287 Road >=0.50 x110; #316 Vehicle >=0.50 x90; #423 Car >=0.50 x90; #411 Asphalt; #52 Bus; #42 Bicycle |
| `architecture` | 建筑 / 桥 / 城市结构 | 82 | #366 Building >=0.50 x110; #365 Cathedral >=0.45 x100; #18 Bridge >=0.45 x90; #290 Roof; #308 Skyscraper; #123 Skyline; #63 Tower; #31 Infrastructure; #64 Brick; #88 Stairs; #110 Church; #371 Temple; #171 Monument; #235 Mosque; #270 Palace; #335 Museum; #377 Castle; #350 Wall; #77 Construction |
| `sky_cloud` | 天空 / 彩虹 / 极光 | 80 | #54 Sky >=0.55 x120; #354 Rainbow >=0.45 x90; #378 Aurora >=0.45 x90 |
| `pet` | 宠物 / 猫狗 | 78 | #277 Pet >=0.50 x110; #118 Cat >=0.50 x100; #360 Dog >=0.50 x100 |
| `flower_macro` | 花 / 花瓣 / 花盆 | 76 | #362 Flower >=0.50 x120; #28 Petal >=0.45 x90; #391 Flowerpot >=0.45 x90 |
| `auto_show` | 车 / 摩托 / 展车 | 74 | #423 Car >=0.50 x120; #316 Vehicle >=0.50 x90; #233 Motorcycle >=0.45 x90; #322 Wheel; #404 Van; #172 Bumper; #87 Windshield; #406 Tire; #420 Odometer |
| `mountain` | 山 / 峭壁 / 峡谷 | 72 | #337 Mountain >=0.50 x120; #39 Cliff >=0.45 x90; #427 Canyon >=0.45 x90 |
| `lake_river` | 湖泊 / 河流 / 船 | 70 | #241 Lake >=0.50 x120; #284 River >=0.50 x100; #45 Boat >=0.45 x80; #328 Fishing >=0.45 x80 |
| `waterfall` | 瀑布 / 水流 | 68 | #417 Waterfall >=0.50 x120; #284 River >=0.45 x90 |
| `snow` | 雪景 / 冰川 / 滑雪 | 66 | #348 Snowboarding >=0.45 x100; #304 Skiing >=0.45 x100; #4 Iceberg >=0.45 x90; #202 Glacier >=0.45 x90 |
| `document` | 纸张 / 票据 / 白板 / 菜单 | 62 | #273 Paper >=0.50 x110; #240 Receipt >=0.45 x90; #263 Newspaper >=0.45 x90; #160 Whiteboard >=0.45 x90; #135 Menu >=0.45 x80 |
| `indoor_home` | 室内 / 家居 / 咖啡饮品 | 60 | #289 Room >=0.50 x110; #154 Bedroom >=0.45 x90; #157 Couch >=0.45 x90; #92 Chair >=0.45 x80; #181 Coffee >=0.50 x90; #331 Cappuccino >=0.50 x80; #115 Desk; #101 Cabinetry; #352 Countertop; #89 Computer; #7 Sink; #127 Tile; #94 Bar; #72 Bathroom; #301 Loveseat; #310 Television; #318 Lampshade; #376 Kitchen; #392 Drawer; #394 Armrest; #401 Shelf |

## 7. LUT 推荐选择

场景排序完成后，推荐 LUT 的选择方式是：

```js
ruleRecommended = sceneMatches.flatMap(scene => scene.recommendations)
recommendedFilterIds = unique(ruleRecommended).slice(0, 5)
```

规则含义：

- 按场景分从高到低展开推荐。
- 同一个 LUT 如果被多个场景推荐，只保留第一次出现。
- 当前后端实际最多返回 5 个 LUT。
- `rules.json` 里的 `maxRecommendations` 已调整为 5。

展示层推荐策略：

1. 先保留 5 个候选。
2. 从 5 个候选中随机选 3 个作为前排推荐。
3. 剩下 2 个保留在推荐列表后半段，用于探索和兜底。

评分台使用“页面会话 + 用户 + 图片”的稳定随机种子，避免同一张图在评分按钮刷新后顺序跳动。

如果命中了场景，但这些场景没有配置 `recommendations`，后端会根据场景名做一个来源兜底：

- 风景类关键词：`sunset / forest / greenery / beach / sky / mountain / lake / river / waterfall / snow`
- 室内商品类关键词：`food / indoor / document`
- 当前都兜底到 `店主推荐` 来源，取前 12 个外部 LUT。

如果完全没有命中任何场景，后端返回空数组；前端再做未知场景兜底。

## 8. 未知场景 fallback

前端当前配置了未知场景 fallback。如果后端没有推荐，或者当前图片的推荐都被低评分降级，会展示：

1. `ai_portrait_soft` - AI Portrait Soft
2. `ai_forest_fresh` - AI Forest Fresh
3. `lut_店主推荐_709日系奶油低饱和_e882a24171`
4. `lut_filter-lut_自然11_1918e5af72`
5. `lut_filter-lut_质感11_d4e9593069`

这组是当前评分数据里相对更稳的通用候选。其中 `AI Portrait Soft` 是当前最接近“万金油”的滤镜：

- 评分数 `n = 84`
- 均分 `3.27`
- 覆盖 `11` 个场景
- 0 分率 `0.02`

建议 Android 端也实现同一组 `unknown_scene` fallback，避免网页和 App 表现不一致。

## 9. 人工评分怎样影响推荐

用户评分是 0-5 星，默认 0 星。

评分存储维度：

```text
imageId -> userId -> filterId -> rating
```

聚合时对每张图片、每个滤镜计算：

- `count`
- `sum`
- `average`
- `distribution[0..5]`

当前线上逻辑里，评分对推荐有两层影响。

### 9.1 当前图片即时降级

前端展示推荐列表时，会检查当前图片下每个推荐 LUT 的聚合评分：

```js
if (count > 0 && average <= 0) hideThisRecommendationForThisImage()
```

也就是说，如果某个推荐在某张图上已经有人打过分，并且均分是 0，它会从这张图的推荐列表里消失。

这解决了一个具体问题：某个场景规则推荐的 LUT，如果在特定图片上被证明完全不合适，就不继续强推给后续评审人。

### 9.2 离线质量审计

项目里有离线审计结果：

```text
rating_tool/data/recommendation_quality_20260701.json
```

当前审计阈值：

```text
low:  n >= 2 && avg <= 1.5
weak: n >= 2 && 1.5 < avg <= 2.2
```

我们已经按这个结果调整过 `rules.json`，当前报告里：

```text
lowRecommendations = 0
weakRecommendations = 0
invalidRefCount = 0
```

注意：离线审计不会自动改规则，它只是帮助人工发现“这个场景下这个 LUT 评分明显低”。规则仍然需要人工确认后修改。

## 10. 当前不使用的能力

以下能力目前没有进入实时推荐算法：

- 用户个性化推荐。
- 根据用户历史偏好改变排序。
- 根据 LUT 属性自动打分，例如高饱和、低对比、暖色、胶片。
- 根据图片主色、肤色、亮度、对比度等视觉统计打分。
- `allBad` 对场景规则的自动惩罚。

这些都可以作为下一阶段能力，但当前阶段的核心目标仍是：先把过多 LUT 收敛成一组可解释、可人工验证的候选。

## 11. Android 端落地建议

如果要把当前规则放进相机 App，建议客户端实现以下输入输出。

输入：

```kotlin
data class MlKitLabel(
  val index: Int,
  val text: String,
  val confidence: Float
)
```

输出：

```kotlin
data class SceneMatch(
  val sceneId: String,
  val displayName: String,
  val score: Float,
  val reason: String
)

data class LutRecommendation(
  val filterId: String,
  val effectName: String,
  val defaultStrength: Int,
  val reasonSceneId: String
)
```

端上推荐流程：

1. ML Kit Image Labeling 输出 labels。
2. 按 `rules.json.scenes[].labels[]` 计算每个业务场景分。
3. 取 top 3 场景。
4. 展开场景 `recommendations`，去重，保留 top 5 候选。
5. 从 5 个候选中随机选 3 个排到最前，剩下 2 个仍保留在后面。
6. 如果没有推荐，使用 `unknown_scene` fallback。

推荐随机置顶伪代码：

```kotlin
val candidates = sceneRecommendations.distinct().take(5)
val promoted = candidates.shuffled(sessionOrRequestRandom).take(3).toSet()
val ordered = candidates.filter { it in promoted } + candidates.filter { it !in promoted }
```

建议修正点：

- 当前 APK 反编译结果显示 `maxRecommendations` 会被限制在 1-3。要实现本轮需求，需要开发把上限改成 5，并在 5 -> 3 前排展示时加入随机置顶逻辑。
- 把未知场景 fallback 从前端迁移到统一推荐层。
- 同一个 ML Kit index 如果出现多次，端上建议取最高 confidence。
- 后续如果引入 LUT 属性，可以先作为 tie-breaker，不要直接替代人工评分沉淀出来的场景规则。

## 12. 关键文件

- 推荐规则：`scene_lut_recommend/rules.json`
- ML Kit 标签表：`product_docs/scene-lut-mlkit-label-map.md`
- Cafe / Party 合并说明：`product_docs/scene-lut-mlkit-merge-rule-20260701.md`
- 当前评分质量报告：`rating_tool/data/recommendation_quality_20260701.json`
- 后端实现：`rating_tool/server.mjs`
- 前端 fallback / 低分降级：`rating_tool/public/app.js`

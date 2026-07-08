# Scene LUT ML Kit 场景归并规则

日期：2026-07-01

## 目标

当前阶段不把 `Cafe` 和 `Party` 作为独立推荐场景，避免出现空推荐和过细场景分裂。

- `Cafe` 并入 `Indoor`
- `Party` 并入 `Night`

运行规则以 `scene_lut_recommend/rules.json` 为准。

## 归并规则

### Cafe -> Indoor

以下 ML Kit 标签不再生成独立 `cafe_drink` 场景，统一归入 `indoor_home`：

| ML Kit index | Label | minConfidence | weight |
| --- | --- | --- | --- |
| 181 | Coffee | 0.50 | 90 |
| 331 | Cappuccino | 0.50 | 80 |

原因：

- Cafe 更像 Food / Indoor 的交叉场景，而不是稳定独立场景。
- 当前滤镜评测阶段没有专门为咖啡店/饮品建立足够样本。
- 如果图片同时识别到 Food，仍可由 `food_closeup` 优先命中；如果只识别到 Coffee/Cappuccino，则走 `indoor_home`。

### Party -> Night

以下 ML Kit 标签不再生成独立 `party_event` 场景，统一归入 `night_neon`：

| ML Kit index | Label | minConfidence | weight |
| --- | --- | --- | --- |
| 260 | Party | 0.50 | 105 |
| 75 | Concert | 0.45 | 90 |
| 319 | Event | 0.45 | 90 |
| 398 | Fireworks | 0.45 | 90 |

原因：

- Party 的核心问题不是普通室内，而是彩灯、低光、高光点、复杂色温。
- 推荐逻辑更接近 Night / Neon，而不是普通 Portrait 或 Indoor。
- 如果后续补齐活动人像、演出、烟花样本，可以再拆出独立 `party_event`。

## 当前有效场景

已删除独立场景：

- `cafe_drink`
- `party_event`

保留并扩展：

- `indoor_home`
- `night_neon`

## 未知场景 fallback

前端当前有未知场景兜底推荐。如果后端没有推荐，或推荐都被当前图片的 0 分评分降级，会展示：

1. `ai_portrait_soft`
2. `ai_forest_fresh`
3. `lut_店主推荐_709日系奶油低饱和_e882a24171`
4. `lut_filter-lut_自然11_1918e5af72`
5. `lut_filter-lut_质感11_d4e9593069`

后端如果要实现同样逻辑，也建议使用这组作为 `unknown_scene` fallback。

## 当前建议

短期不要再细拆 Cafe。Party 可以保留业务概念，但先走 Night 推荐。等场景库补齐以下样本后再独立评估：

- 咖啡店饮品 + 食物 + 人像
- 室内暖光咖啡桌面
- 活动现场人像
- 演出/霓虹/舞台灯光
- 烟花/高光点夜景

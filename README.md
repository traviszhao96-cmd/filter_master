# Scene LUT 滤镜推荐系统

基于产品标签和多人评分的 Camera 场景自适应滤镜推荐引擎。

## 快速开始

```bash
git clone git@github.com:traviszhao96-cmd/filter_master.git
cd filter_master
npm start
```

默认打开 `http://localhost:4173`，内网使用 `http://<你的IP>:4173`。

## 评分台功能

- 飞书 Lark OAuth 登录（限 Nothing Tech 组织）
- 32 张场景图 × 32 个滤镜 × 多人独立评分（0-5★）
- 键盘快捷键：← → 切滤镜，0-5 打分，按住原图按钮对比
- 灯箱大图模式，支持 ← → 切换和原图/滤镜对比
- CSV/JSON 评分导出
- ML Kit 手机端自动打标签

## 启动选项

```bash
# 指定场景图片目录（必填，场景图片不包含在仓库中）
SCENE_LIBRARY_DIR=/path/to/your/scene-library npm start

# 飞书 OAuth 登录
PORT=4174 \
LARK_APP_ID=cli_xxx \
LARK_APP_SECRET=xxx \
LARK_CALLBACK_URL=http://your-ip:4174/auth/lark/callback \
npm start

# 完整启动（含 ML Kit 手机端打标签）
npm run start:lark
```

## 项目结构

```
├── rating_tool/          # 评分台（Node.js 前后端）
│   ├── server.mjs        # 服务端
│   ├── public/           # 前端 (app.js + styles.css)
│   ├── data/             # 评分数据 + 分析报告
│   └── scripts/          # ML Kit ADB 打标签脚本
├── lut_library/          # 32 个滤镜文件
│   ├── 店主推荐/         # 12 个 709 系列 LUT
│   └── filter_lut/       # 12 个 v3.1 官方 LUT
├── scene_lut_recommend/  # 推荐规则
│   ├── rules.json        # v3 产品标签推荐规则
│   └── luts/             # 8 个 AI 滤镜 PNG
├── mlkit_labeler_android/ # Android ML Kit 打标签工具
└── product_docs/         # 产品文档 + ML Kit 标签映射表
```

## 场景图片准备

仓库不包含场景图片。评分台需要一个 `scene_library/` 目录，结构如下：

```
scene_library/
├── filter_rating/        # 32 张打分场景图（由同事提供）
│   ├── pet_01.jpeg
│   ├── pet_01.jpeg.json  # ML Kit 标签 sidecar
│   ├── food_01.jpeg
│   └── ...
└── 验收场景/             # 217 张验收场景图（可选）
    └── 大版本场景库3.0/
```

每张图片需要配套的 ML Kit 标签 JSON（通过 `mlkit_labeler_android` 生成或直接使用评分台刷新功能）。

## 推荐引擎

### v3 产品标签架构

```
图片文件名 (3A: Lux/CCT/ADRC)  +  ML Kit 标签
              │
              ▼
      产品标签规则 (apply_product_tags.py)
              │
              ▼
      产品标签: "室外/人像/旅行风景"
              │
              ▼
      rules.json → byCombo / byTag 查找
              │
              ▼
      Top 3-5 推荐滤镜
```

### 推荐优先级

1. **精确组合匹配** — 完整标签组合命中 `byCombo`
2. **逐标签合并** — 合并所有标签的 `byTag` 推荐
3. **旧场景匹配** — 降级到 sceneId 匹配（兼容旧数据）

## 评分数据分析

`rating_tool/data/` 目录包含：
- `ratings.json` — 当前评分数据（7 人，4 人完整）
- `lut_attribute_analysis_riley_20260629.json` — 滤镜属性分析
- `recommendation_quality_20260701.json` — 推荐质量评估
- `filter_annotations.json` — 滤镜标注数据

分析脚本示例见 `tools/` 目录。

## 技术栈

- 后端：Node.js 内置模块（零依赖）
- 前端：Vanilla JS + CSS（零框架）
- 认证：飞书 Lark OAuth 2.0
- 标签：Google ML Kit Image Labeling

## License

Internal use only — Nothing Technology Limited.

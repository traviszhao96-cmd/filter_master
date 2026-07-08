# Scene LUT 评分台

## 启动

```bash
git clone git@github.com:traviszhao96-cmd/filter_master.git
cd filter_master
npm start
```

默认 `http://localhost:4173`。需要指定场景图片目录：

```bash
SCENE_LIBRARY_DIR=/path/to/scene-library npm start
```

## 飞书登录

```bash
npm run start:lark
```

需先配好飞书应用 `LARK_APP_ID` / `LARK_APP_SECRET` / `LARK_CALLBACK_URL`。

## 场景图片

仓库不带图片。自己准备好 `scene_library/` 目录，每条图片配一个同名 ML Kit 标签 JSON：

```
scene_library/
├── pet_01.jpeg
├── pet_01.jpeg.json   ← { "labels": [{"index":360,"label":"Dog","confidence":0.9}] }
├── food_01.jpeg
└── ...
```

## 评分

- 飞书登录 → 左侧选图 → 浏览滤镜
- 键盘 `← →` 切滤镜，`0-5` 打分
- 只给觉得合适的打分，不合适的跳过
- 切到「推荐」模式看数据投票出的 Top 滤镜

## 导出

页面右上角导出 CSV / JSON。

## 项目结构

```
rating_tool/      评分台代码
lut_library/      32 个滤镜文件
scene_lut_recommend/  推荐规则 (rules.json)
mlkit_labeler_android/  ML Kit 打标签工具
```

# Scene LUT 评分台

这个小工具用于在内网里让同事对本地场景库图片的 LUT 效果打星评分。后端只使用 Node.js 内置模块，不需要额外安装依赖。

## 启动

```bash
npm run start
```

默认地址：

```text
http://localhost:4173
```

如果要给内网同事访问，服务器已经监听 `0.0.0.0`。可以用机器的内网 IP 访问：

```text
http://<你的内网IP>:4173
```

## 指向场景库

默认读取仓库下的 `scene_library/`。也可以启动时指定任意本地目录：

```bash
SCENE_LIBRARY_DIR=/absolute/path/to/scene-library npm run start
```

支持图片格式：`jpg`、`jpeg`、`png`、`webp`、`gif`、`bmp`、`heic`、`heif`。其中 HEIC/HEIF 是否能预览取决于浏览器支持。

## 图片标签

每张图片可以配一个同名 JSON：

```text
food_001.jpg
food_001.jpg.json
```

也支持去掉扩展名的 sidecar：

```text
food_001.jpg
food_001.json
```

示例：

```json
{
  "sceneId": "food_closeup",
  "labels": [
    { "index": 184, "label": "Food", "confidence": 0.86 },
    { "index": 181, "label": "Coffee", "confidence": 0.62 }
  ],
  "tags": ["Food", "Cafe"]
}
```

工具会读取 `scene_lut_recommend/rules.json`，根据 `sceneId`、ML Kit `index/confidence`、标签文字或目录名匹配推荐滤镜。未匹配时仍可切到“全部”查看所有 LUT。

## 刷新时用 ML Kit 打标签

Google ML Kit 是 Android/iOS 移动 SDK，Web/Node 不能直接调用官方 ML Kit SDK。评分台的“刷新场景库”按钮已经预留为可插拔命令：配置 `MLKIT_LABEL_COMMAND` 后，刷新时会对没有标签的图片逐张调用该命令，并把标签写入同名 sidecar JSON。

启动示例：

```bash
MLKIT_LABEL_COMMAND="/path/to/mlkit-labeler" npm run start
```

当前仓库已经包含 Android 设备版 helper。连接手机并安装 helper 后，可以直接启动：

```bash
npm run start:mlkit
```

如果连接多台设备，先指定序列号：

```bash
ADB_SERIAL=00125364E000193 npm run start:mlkit
```

命令会收到图片路径作为第一个参数，同时也会拿到环境变量：

```text
MLKIT_IMAGE_PATH=/absolute/path/to/image.jpg
MLKIT_IMAGE_REL_PATH=subdir/image.jpg
```

命令需要向 stdout 输出 JSON：

```json
{
  "labels": [
    { "index": 184, "label": "Food", "confidence": 0.86 },
    { "index": 181, "label": "Coffee", "confidence": 0.62 }
  ]
}
```

评分台会写入：

```text
image.jpg.json
```

如果没有配置 `MLKIT_LABEL_COMMAND`，刷新按钮仍会刷新图片列表，但会提示“未配置 MLKIT_LABEL_COMMAND”。

## 指向 LUT 目录

工具会读取 `rating_tool/lut_sources.json` 里的候选 LUT 目录。当前已配置：

- `lut_library/店主推荐`
- `lut_library/filter_lut`

支持 `.cube` 和 PNG LUT。页面会把这些 LUT 加进“全部”滤镜，并可按来源筛选。

临时覆盖 LUT 目录：

```bash
LUT_SOURCE_DIRS="/path/to/luts-a;/path/to/luts-b" npm run start
```

## 评分数据

评分会保存到：

```text
rating_tool/data/ratings.json
```

页面右上角可以导出 CSV 或 JSON。每个用户每张图独立保存一份评分。

## 登录

默认是本地用户名登录。如果需要一个简单访问码：

```bash
ACCESS_CODE=your-code npm run start
```

## Lark / 飞书登录

配置以下环境变量后，登录页会显示 Lark 登录按钮：

```bash
LARK_APP_ID=cli_xxx \
LARK_APP_SECRET=xxx \
LARK_CALLBACK_URL=http://<你的内网IP>:4173/auth/lark/callback \
npm run start
```

如果使用中国区飞书，把 host 改成：

```bash
LARK_HOST=https://open.feishu.cn
```

需要在 Lark/飞书开放平台的应用安全设置里，把 `LARK_CALLBACK_URL` 加到 Redirect URLs 白名单。

# BabyMia 家庭照护交接

第三版是手机优先的家庭记录工作台：在日常交接和“成长与健康”页之外新增“伴读与互动”，提供官方媒体外链、合法资源收藏、原创中英逐段故事、浏览器语音 fallback、按月龄的轻量互动和用户确认后的 AI 交接摘要。生长参考使用随镜像发布的 WHO Child Growth Standards 0–730 日扩展 LMS 表；百分位只在档案性别和实际日龄均有参考时显示。服务端使用 Node.js 22 内置 HTTP 与 `node:sqlite`，没有第三方运行依赖。

## 本机运行

需要 Node.js 22.23.1 或更高版本；交付镜像固定使用 `node:22.23.1-bookworm-slim`：

```powershell
npm start
```

打开 <http://127.0.0.1:8185>。数据写入 `data/babymia.sqlite`，备份快照写入 `data/backups/` 并保留最近 7 份。更换端口可用 `$env:PORT=8285; npm start`，更换数据目录可用 `$env:DATA_DIR='D:\baby-data'; npm start`。Docker 部署仍显式使用容器端口 8095。

## SSS MP4 视频

伴读页的“SSS 视频库”直接播放 NAS 上的 MP4 文件。默认目录是 DATA_DIR/videos，本机运行时把文件放入 data/videos/，打开伴读页点击“刷新列表”即可。文件只通过网页按 Range 分段读取，不复制进 SQLite，也不需要 Emby；播放器支持拖动进度、全屏和播完自动播放下一条。

Docker / NAS 使用现有 ./data:/app/data 映射时，把 MP4 放入 NAS 数据目录的 videos/ 子目录。若希望把媒体单独放在另一个 NAS 共享目录，可设置 VIDEO_DIR=/app/videos，并增加 ./videos:/app/videos 映射。页面只列出目录顶层的 .mp4 文件；建议使用手机兼容性较好的 H.264 视频与 AAC 音频。视频文件不进入 JSON / SQLite 备份，NAS 需要另外备份媒体目录。

伴读页还提供“Live Photo 兼容性测试”。普通浏览器选择动态照片后，页面会显示浏览器实际交出的文件数量、类型，以及是否检测到 Android Motion Photo 的 XMP 标记和内嵌视频。检测文件只进入服务进程内存，不写入磁盘；一次最多 6 个文件，单个不超过 128 MB。

`android-app/` 是统一的 BabyMia Android 应用：界面仍使用当前网页，原生层通过 MediaStore 找到 vivo Live Photo 的原始 JPG + MP4，携带当前登录会话上传。服务端再次核对双方 28 位 Live Photo ID 和 `vivoMediaExtInfo`，然后将原件保存到 `DATA_DIR/live-photos/`。伴读页可以按住预览动态画面并分别下载未经转码的 JPG、MP4。媒体文件不进入 JSON 备份，应随整个 `DATA_DIR` 一起备份。构建和安装方法见 `android-app/README.md`。

## Docker / NAS

`docker-compose.yml` 默认通过 DaoCloud 国内代理拉取 Node 22 基础镜像，直接执行：

```bash
docker compose build
docker compose up -d
```

如需临时切回 Docker Hub，可在构建前设置 `NODE_IMAGE=node:22.23.1-bookworm-slim`。在有 Docker 的机器构建并导出镜像：

```powershell
docker build -t babymia:3.6.0 .
docker save babymia:3.6.0 -o babymia-3.6.0.tar
```

在 NAS Container Station 导入 `babymia-3.6.0.tar`，创建 `/app/data` 到 NAS 数据目录的持久化映射，并将 Compose 中的 `build` 配置替换为 `image: babymia:3.6.0` 后启动。映射 8095 端口后访问 NAS 地址。`reference/who-growth.json` 会随镜像复制到运行目录。外网访问请放在 HTTPS 或安全组网之后；当前服务适合家庭内网。

AI 摘要默认关闭。需要时在服务器环境变量配置兼容 Chat Completions 的 `AI_ENDPOINT`、`AI_API_KEY` 和 `AI_MODEL`；endpoint 只接受 HTTPS，HTTP 仅允许本机 mock。密钥只在服务端使用，页面只显示 endpoint 主机和模型。每次摘要都先由家庭成员选择范围和类型并预览，点击“手动生成”后才发送同一份脱敏快照；不自动外发、不发送姓名、署名、备注或成长/疫苗/辅食记录。未配置、超时或返回错误时显示明确状态，不伪造摘要。

## 数据与安全

口令使用 scrypt 加盐散列，登录会话为 HttpOnly、SameSite Cookie；写入接口检查同源来源并限制口令尝试。所有写入带请求标识，重复提交会返回原结果，复用同一标识提交不同内容会拒绝。编辑带版本号，发现其他设备已改动时提示刷新。进行中的计时写入 SQLite，可由另一位照护者结束；汇总按 Asia/Shanghai 自然日计算，跨午夜时长按日期拆分。

设置页支持验证旧口令后修改家庭访问口令，修改后会注销全部设备会话，家庭成员需用新口令重新登录。

设置页可以导出 JSON 备份。导出格式版本为 4，恢复兼容 v1–v4；第四版包含故事库，第三版起包含家庭共享收藏。恢复 v1–v3 时保留现有故事库，v4 则按备份完整恢复故事（包括空库）。旧版缺少收藏时按空列表恢复。恢复前先生成当前 SQLite 快照，快照成功后才覆盖，旧版备份没有健康记录时不会虚构数据。备份不包含口令和会话。NAS 数据卷仍需另做异机备份。

## 自检

自检会在临时目录启动真实 HTTP 服务，覆盖首次设置并发、登录、CRUD、幂等冲突、版本冲突、跨用户结束、跨日汇总、备份恢复、错误输入、静态路径 traversal，以及 vivo JPG+MP4 上传校验、列表、视频 Range 播放和原件下载：

```powershell
npm run check
```

第二版自检还覆盖三类健康记录、未来疫苗预约与未来已接种拒绝、出生日期和性别缺失、参考范围外日龄、食物反应时间、v1/v2 备份往返。第三版自检增加收藏 CRUD/重复链接/版本冲突、v3 导出恢复、AI 预览脱敏、空类型拒绝和本地 mock endpoint 的成功与并发幂等；不会连接真实供应商。健康记录不计入日常奶量、睡眠等汇总，也不生成个体接种日程或自动喂养建议。推送、离线写入队列和 PWA 安装能力仍不在范围内。

## 月龄活动与双语共读

伴读页按档案出生日期匹配 0–2、3–5、6–8、9–11、12–17、18–23 个月六个阶段，共 24 项活动。每项说明练习能力、开始条件、步骤、观察与安全注意；可浏览其他阶段并返回当前月龄。早产宝宝需与儿保医生确认矫正月龄；内容不用于发育达标评分，24 个月及以上明确提示超出当前内容范围。

两篇原创双语故事各含八段，支持选篇、逐段中英对照、朗读与共读提示。活动依据链接随阶段显示，内容集中在 public/companion-content.js，已加入服务器静态资源列表；升级时需重启 Node 服务后加载新资源。

## 更新故事

在“伴读”页选择“新增故事”，填写标题，按段配对中文和英文；可添加、删除、上移或下移段落。选择已有故事后使用“编辑本篇”“删除本篇”或“导出本篇”。编辑冲突会保留草稿并提示刷新，避免覆盖其他设备的修改。

批量添加时展开“从 JSON 文件导入故事”，先下载模板，填写后选取文件、检查待导入标题，再点“确认导入”。只追加，不覆盖；完全相同的故事会拒绝重复导入。每批 1–20 篇，文件不超过 4 MB，每篇 1–50 段，故事库最多 100 篇。

```json
{"format":"babymia-stories","version":1,"stories":[{"title":"故事标题","subtitle":"可选简介","segments":[{"zh":"第一段中文。","en":"The first paragraph.","prompt":"可选共读提示"}]}]}
```

故事实际存于 DATA_DIR 下的 babymia.sqlite，并纳入设置页的完整备份。reference/starter-stories.json 仅首次初始化两篇原有故事；之后升级不会覆盖修改，也不会重新添加已删除的故事。public/companion-content.js 仅保存月龄活动内容。

本次升级需要重启 Node 服务；Docker 部署需使用包含 story-store.mjs 和 reference/starter-stories.json 的新版镜像。数据卷路径保持原值。



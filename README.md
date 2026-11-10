# mytube

mytube 是免登录的个人 YouTube 内容库。首页和搜索合并你选择的频道、公开播放列表和单条收藏，按视频 ID 去重。频道、播放列表和观看链接可以直接打开。临时浏览和本地保存分别处理，播放列表保留原始位置和重复条目。

访问者的选择、隐藏状态、主题和播放进度存于本浏览器的 IndexedDB。设置页可导出和合并 mytube JSON 备份。公共元数据与同步游标共享于 D1。评论只读，按需加载，回复单独分页。封面后的 YouTube 隐私增强播放器由用户操作启动，播放器原有的控制条和可用性限制依然适用。

## 本地启动

使用 Node.js 24 和 npm。在项目根目录运行以下命令。现有 `.env.local` 会被 Cloudflare Vite 插件读取为 Worker 的本地绑定。

```sh
npm ci
npm run db:migrate
npm run dev
```

打开 [本地开发站点](http://127.0.0.1:5173/)。新浏览器看到空库，可用「添加内容」贴入频道、视频或公开播放列表链接。其他开发者可在没有本地配置时以 `.env.example` 为模板，填入已启用 YouTube Data API v3 的 `YOUTUBE_API_KEY`。仓库忽略本地环境文件。Cloudflare 的 Vite 构建会为本地预览在被忽略的 `dist/server/.dev.vars` 生成本地绑定文件。静态目录是 `dist/client`。生产使用 Workers Secret。 [Cloudflare 本地与生产密钥](https://developers.cloudflare.com/workers/configuration/secrets/)

### 本地 D1 和定时任务

D1 的开发和预览数据位于 `.wrangler/state/v3/d1`。SQL migrations 随仓库提供，空库初始化后首个来源来自用户操作。测试的虚构数据在 `tests/sync.test.ts` 中单独写入临时 D1。需要导出公共缓存时运行下方命令。个人库的备份在应用设置中导出。

```sh
npx wrangler d1 export mytube --local --output=mytube-cache.sql
npm run cron:local
# 生产构建预览运行时可将触发目标改到预览端口
MYTUBE_TEST_ORIGIN=http://127.0.0.1:4173 npm run cron:local
```

本地定时入口执行真实 Worker 的 `scheduled`。首次打开或加入来源会尝试同步首批，接下来的分页可以等待到期再触发 Cron。应用根据本地时区显示更新时间。生产触发器以 UTC 每分钟运行，每次最多领一个到期任务。普通来源检查默认相隔 6 小时，手动检查有 5 分钟冷却。离最近一次来源访问超过 30 天后停止定期更新，再次访问会恢复。 [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

## 构建与验证

```sh
npm run bindings
npm run typecheck
npm test
npm run build
npm run preview -- --port 4173
```

保持预览运行，在另一个终端执行验收。浏览器脚本使用本机 Chrome。

```sh
npm run test:browser
MYTUBE_LIVE=1 npm run test:browser
npm run test:security
npm run test:performance
npm run deploy:check
```

`npm test` 覆盖链接、备份、真实本地 D1 的批次与持久游标、并发和过期租约、跨来源范围、播放列表快照、配额和软容量阈值。浏览器 fixture 用受控 iframe 和 API 验证播放手势、队列、评论、进度、本地备份和移动端 Portal。启用 `MYTUBE_LIVE` 会另外调用 YouTube，使用 `@ETALENT-TV`、其中的公开播放列表和有回复的公开评论样例，并验证真实 iframe 的解码帧和媒体时钟。上游可能调整样例的公开状态或地区可用性。

## 本地验收记录

2026 年 11 月 10 日，类型检查、23 项单元与 D1 集成测试、4 项生产预览浏览器测试、生产构建、静态产物与响应密钥检查、Cron 入口、D1 迁移和部署 dry-run 均通过。实网浏览器验证了频道、单视频和公开列表的添加、深层刷新、评论与回复，以及 `EE_FNROtzQM` 的实际嵌入播放。受控浏览器用例覆盖重复项、不可用条目、继续播放、进度恢复、备份恢复和浅深主题的 Portal。

| 本地生产构建场景 | 实测 |
| --- | --- |
| 1440 × 900，本机 Chrome，无网络节流，三个独立冷浏览器上下文的空库首页 | 自有 JS gzip 174,723 字节，LCP 120–152 ms，CLS 0，内容库可操作 117–129 ms |
| 示例频道视频，在同一预览地址点击播放并从 10 秒处启动 | 点击到首个播放画面约 4.88 秒，IFrame Player API 确认播放时钟前进约 5.60 秒 |

首页测量不加载第三方播放器。视频时间是一次实网样本，通过 iframe 中的媒体帧回调观测。

## 未来部署到 Cloudflare

部署使用一个 Worker 和一个 D1 数据库，附带 Workers Static Assets、Cron 和 Workers Secrets。TanStack Start 在构建时预渲染页面外壳，页面和静态资源交由资产服务，Start 服务端路由接管 `/api/*`。Vite 插件生成 `dist/server/wrangler.json`，Wrangler 从项目根目录读取重定向后的配置。 [Cloudflare TanStack Start 指南](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)

1. 维护者登录 Cloudflare，然后用 `npx wrangler d1 create mytube` 创建数据库。把返回的 ID 填入 `wrangler.jsonc`，替换本地占位 UUID。
2. 用 `npx wrangler d1 migrations apply mytube --remote` 迁移远程库，然后运行 `npm run build` 和 `npm run deploy:check`。
3. 用 `npx wrangler secret put YOUTUBE_API_KEY` 配置 Worker Secret。首次运行时按 Wrangler 提示创建对应 Worker 草稿，或在 Cloudflare 控制台为同名 Worker 添加 Secret。
4. 用 `npx wrangler deploy` 发布生成的产物。在 Worker 的域名设置里绑定自有域名，确认 Cron、D1 绑定与实际页面。访问者仍无需登录。

本地验收使用本地 D1。远程账号、部署域名、线上 CPU 和真实流量下的额度消耗需在实际部署后验证。

## 免费额度与同步预算

2026 年 11 月 10 日核对的免费计划基线如下。Cloudflare 的账号额度由同账号资源共享。 [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/) [D1 定价](https://developers.cloudflare.com/d1/platform/pricing/) [D1 限制](https://developers.cloudflare.com/d1/platform/limits/) [静态资产计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)

| 资源 | 免费基线 | mytube 默认限制 |
| --- | --- | --- |
| Workers | 100,000 请求/日，HTTP 与 Cron 各 10 ms CPU，50 子请求/次 | 静态导航和资产绕过 Worker。API 每 IP 每分钟 100 次，冷缓存查找及手动同步每分钟 18 次 |
| D1 | 500 万行读/日，10 万行写/日，账号 5 GB，单库 500 MB | 220 MB 缓存软阈值，每次同步最多 24 个成员。分批删除过期视频、来源、评论缓存和退役快照 |
| YouTube Data API | 项目配额受 Google Cloud 配置约束 | 共享预算 3,500 次列表调用/日和 220 个同步批次/日。按美国太平洋时区计日 |

可在 Wrangler 的非秘密配置中设置 `SYNC_INTERVAL_SECONDS`、`API_DAILY_LIMIT`、`SYNC_DAILY_LIMIT` 和 `DB_SOFT_BYTES`。同步失败保留已提交页和上一个完整的 playlist 快照。任务使用到期租约、有限速的重试和退避。YouTube 配额错误在当天阻止新的上游调用，下一预算日可恢复。公共 API 元数据以 28 天为最长有效期，评论默认 5 分钟。选择源和个人进度由本地库独立保存。 [YouTube API 数据政策](https://developers.google.com/youtube/terms/developer-policies#handling-youtube-data-and-content)

粗略估算一个小规模场景。若有 3 个频道、2 个不超过 24 部视频的播放列表、约 2,500 条已缓存视频，每天 200 次库内页面请求、40 次冷评论分页和 5 次冷视频查找，日常上游调用约 90 次。每来源每天检查 4 次，新频道历史补齐另计。约 20 个常规同步批次与缓存清理通常对应数千次 D1 行写。库内包含式搜索会读取所选来源中的候选行，按每次几千行估算约几十万到两百万行读。该场景预留了余量，但大库搜索、较长播放列表、热点流量或同账号的其他 Worker 会改变用量。D1 的索引维护也计入行写。

## 来源和主题

界面使用 shadcn CLI 从 radix-shadcn.dev 安装的 Base UI 组件和 Theme，采用 plum 强调色与自动匹配的灰阶。组件和主题源码在仓库内，许可证和设计数据署名在 `src/lib/theme/NOTICE.txt`。播放页的封面优先交互参考 HackerTube，视频通过官方 YouTube IFrame Player API 播放。YouTube 的 `rel=0` 将嵌入内的相关推荐限制到同频道。 [组件 registry](https://radix-shadcn.dev/r/radix-base.json) [HackerTube](https://hackertube.org/) [YouTube 播放器参数](https://developers.google.com/youtube/player_parameters)

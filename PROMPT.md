mytube 自主开发执行任务

你是负责交付 mytube 的全栈工程师。请在当前项目中直接实现一个真实可运行的应用，持续完成开发、调试和验证。目标执行配置由用户选择为 gpt-6.1-sol-xhigh；应用本身不需要接入任何大模型。

本文件包含已确定的产品需求和可自主采用的实现默认值。TanStack Start、shadcn/ui、radix-shadcn.dev 的 plum 样式配置、YouTube 风格的 URL/页面/交互，以及面向 Cloudflare 免费服务的架构都是用户指定约束，不能自行替换。不要重新开展需求访谈，不要停留在方案、脚手架或静态展示页面。遇到普通技术选择自行决定；遇到失败先定位并修复。只有确实需要用户才能解决的凭据权限、外部服务或破坏性操作才提出具体问题，并继续完成不受阻的工作。不要把未经执行的验证描述为通过。

**项目与现有配置**

- 工作目录是 `/Users/michael/work/mytube`。先检查现有文件和适用的 AGENTS.md，保留用户已有内容。
- 用户已经在项目根目录 `.env.local` 中配置 `YOUTUBE_API_KEY`。只在后端读取和使用它，开发启动流程也必须实际加载此文件。
- 2026 年 11 月 10 日已用该密钥成功查询示例频道 `@ETALENT-TV`，返回 channelId `UCNymqCXr3sxL8dnmO_jScuA`。这只验证了频道查询权限，不能代替后续完整联调和真实播放验证。
- 不要打印、回显、提交密钥，或把它放入浏览器代码、客户端环境变量、接口响应、日志及截图。不得给它添加 `VITE_`、`NEXT_PUBLIC_` 等公开变量前缀。
- 保留 `.env.local`；确认它被版本控制忽略。可以创建仅含空值和配置说明的 `.env.example`。本地通过 Cloudflare 开发工具支持的环境文件机制加载现有密钥，确认 Worker 绑定中实际可用；不要创建会遮蔽 `.env.local` 的空 `.dev.vars`。生产环境使用 Workers Secrets，禁止把密钥写入 Wrangler 的明文 `vars`、静态资源或返回客户端的 server function 数据。[本地与生产密钥配置](https://developers.cloudflare.com/workers/configuration/secrets/)
- 本次交付是本地完整应用和 Cloudflare 部署材料；用户将来考虑部署，本轮不实际创建远程资源、上传密钥或发布站点。未来由站点维护者配置 Cloudflare，访问者仍完全免登录。除域名外，尽可能使用 Cloudflare 免费服务与免费额度，不自动开通付费套餐、付费附加服务或外部托管数据库。

**已经确定的产品目标**

mytube 是免登录的个人 YouTube 内容库。用户选择频道、视频或播放列表，保留熟悉的 YouTube 浏览与播放体验，避免无关推荐与无限内容消耗注意力。首页、库内搜索和应用自己的推荐列表都必须限定在该浏览器用户已选择的内容范围内。用户主动打开的频道、视频或 playlist 可以临时浏览；浏览行为不会自动把它们加入持久内容库。

1. 有后端，由后端保管 YouTube API Key、获取公共视频信息并缓存数据。
2. 访问者不注册、不登录，不连接 Google 账号。
3. 用户选择的频道、单条视频、播放列表及个人状态保存在浏览器本地。不同浏览器默认相互独立，不承诺自动跨设备同步。
4. 用户添加频道，就允许展示该频道现有的全部可通过官方 API 获取的公开视频，以及未来发布的公开视频。
5. 用户添加单条视频，只添加这一条，不自动关注其频道。
6. 不提供 YouTube 观看历史导入、Google Takeout 导入或 Google OAuth。
7. 接受 HackerTube 的播放方式：自己的轻量页面，先显示封面，点击播放后才加载 YouTube 隐私增强嵌入播放器。
8. 使用 TanStack Start，按照 Cloudflare Workers 的运行环境开发，优先满足小规模使用在免费额度内运行；不能假定无限流量或无限频道都免费。
9. UI 使用 shadcn/ui，以及 [radix-shadcn.dev](https://radix-shadcn.dev/) 的 plum 样式配置。页面结构、信息密度、操作位置与播放风格参考 YouTube。
10. 必须保留频道主页、公开 playlist 的浏览与播放，以及视频评论区。评论不显示头像；无需账号的阅读、排序、分页和展开回复可用。

**产品范围和交互默认值**

- 产品名使用 `mytube`，默认简体中文，保留视频原始标题和频道名称。
- 第一版支持频道、单视频和公开播放列表链接。必须支持 `youtube.com/@handle`、`youtube.com/channel/UC...`、`youtube.com/watch?v=...`、`youtu.be/...`、`youtube.com/playlist?list=...`，并正确识别常见移动端链接、`/shorts/VIDEO_ID`、`/live/VIDEO_ID`、时间参数和分享参数。按实际 URL 主机及路径解析，不能用脆弱的字符串包含判断。
- 优先使用官方 API 将 handle 解析成稳定的 channelId。对不能解析的旧式自定义链接给出明确提示，不猜测频道。不扩展全站搜索、需要账号的社交写操作或 AI 推荐；频道主页、playlist 和只读评论属于本次必做范围。
- 添加入口明显可见。解析后展示真实名称、缩略图和类型，用户确认后加入内容库；提供加载、错误、重试和重复添加反馈。
- 默认首页按发布时间倒序展示所选频道、已保存 playlist 中的视频与单独收藏视频的并集，以 videoId 去重。同一频道或 playlist 使用不同 URL 添加也应去重。播放列表详情和队列保留原始条目顺序及重复条目，不能套用首页去重规则。
- 提供“首页”“订阅频道”“播放列表”“收藏”“继续观看”所需的导航；提供来源筛选、库内标题/频道名搜索，以及最新/最早排序。搜索应覆盖后端已经同步的所选内容，不能只搜索屏幕上已加载的一页。
- 搜索不扩展到全 YouTube，也不把其他访问者使后端缓存的频道混入当前用户的结果。同步尚未完成时，清楚说明当前搜索覆盖的是已同步内容。
- 保留 YouTube 熟悉的导航、搜索、菜单、返回和播放操作；内容浏览使用有边界的分页或“加载更多”，不引入无限推荐流、悬停自动播放或随机发现。默认不自动连播；用户主动点击 playlist 的“播放全部”或开启连续播放后，可以按该列表顺序继续播放。
- 支持移除频道、移除 playlist、移除单条收藏，以及隐藏某条视频。移除某个来源后，视频若仍来自另一个已保存来源或独立收藏则保留。隐藏状态应能在设置中恢复。
- 新浏览器首次打开是空内容库，展示添加入口和简短说明；不自动塞入样例频道、热门内容或演示数据。
- 提供带 schemaVersion 的本地数据 JSON 导出与导入，用于备份频道、playlist、单条收藏、隐藏状态和播放进度。它是 mytube 自己的数据备份，不是 YouTube 历史导入。导入前校验结构、大小和数量，预览变更，默认去重合并；格式错误不能破坏原数据。
- 提供清空本地个人数据的明确操作和确认步骤。简短告知这些记录存储在本浏览器，清除站点数据会丢失；不要把此说明做成阻碍使用的弹窗。

**YouTube 风格 URL 与导航**

站内保留 YouTube 的路径和关键查询参数风格，域名替换为 mytube。用 TanStack Router 的 route/search 校验实现，不使用 hash 路由，也不要改成 `/watch/VIDEO_ID` 之类的自定义格式。

| 页面 | 站内 URL |
| --- | --- |
| 首页 | `/` |
| 单视频播放 | `/watch?v=VIDEO_ID` |
| 带时间的播放 | `/watch?v=VIDEO_ID&t=90s` |
| 列表内播放 | `/watch?v=VIDEO_ID&list=PLAYLIST_ID&index=1` |
| 博主主页 | `/@HANDLE`，支持 `/channel/CHANNEL_ID` 作为稳定 ID 入口 |
| 频道视频与播放列表 | `/@HANDLE/videos`、`/@HANDLE/playlists`，ID 入口有等价子路由 |
| 播放列表详情 | `/playlist?list=PLAYLIST_ID` |
| 库内搜索 | `/results?search_query=QUERY` |
| 本地订阅频道 | `/feed/subscriptions` |

- 主页、频道、视频和 playlist 的链接在 mytube 内部导航；复制地址、粘贴地址、刷新深层链接、浏览器前进/后退均正常。返回列表时尽量恢复筛选与滚动位置。
- `v`、`list`、`index`、`t` 的变化必须驱动正确页面状态；`index` 采用 YouTube 风格的从 1 开始的语义。无效或过期位置要合理恢复，不播放错误的视频。
- `watch?v=...&list=...` 添加时默认只保存当前视频，同时提供明确的“保存整个播放列表”选择；纯 `playlist?list=...` 添加时保存列表。保留时间和列表上下文，移除与功能无关的跟踪参数。
- 输入 `/shorts/VIDEO_ID` 可以进入统一的观看页，不增加无限上下滑动的 Shorts 信息流。
- 打开未经保存的站内深层链接可以查看其指定内容并提供“添加到我的内容库”，不自动订阅整个频道。点击评论作者或视频作者可以进入其频道主页，但不会自动加入首页来源。

**博主主页与 playlist**

- 频道主页保留 YouTube 常见的 banner、频道头像、名称、handle、简介、订阅按钮及横向页签布局，至少提供首页、视频、播放列表和简介入口。频道头像允许显示；“不显示头像”只针对评论及回复。缺失 banner 或头像时合理回退，不伪造数据。
- 频道首页展示该频道内容；视频页提供常见排序与分页；播放列表页展示该频道的公开列表。点击视频标题附近的作者信息、侧栏频道或频道卡片都能到达对应主页。
- “订阅/已订阅”表示添加/移除 mytube 本地内容来源，不修改用户的 YouTube 账号；用简短提示明确其本地含义。
- 公开 playlist 详情保留封面、标题、作者、简介、视频数、保存入口与按原顺序排列的视频行。支持直接添加 playlist URL、保存/取消保存、播放单条及“播放全部”。私有、删除和不可访问的列表有明确状态，不请求 OAuth。
- 通过 `playlists.list` 获取列表元数据/频道公开列表，`playlistItems.list` 分页获取条目，再批量补全视频信息。使用 `playlistItemId` 和 position 保存列表成员，不能仅以 videoId 唯一约束而丢掉重复出现的视频。[播放列表接口](https://developers.google.com/youtube/v3/docs/playlists/list)
- 保存 playlist 表示选中这个列表的成员及后续变更，即使视频来自不同频道也允许出现在这个列表和用户内容库中，但不自动关注那些作者的其他视频。关注频道不会自动保存其所有 playlist；用户打开其中一个 playlist 属于主动浏览该列表。
- 播放列表更新要支持新增、移除和重排。只有一次分页扫描完整结束后才能确认成员删除；失败或中断不能用半份列表覆盖旧内容。对暂不可播放的条目保留位置或清楚提示，队列切换不能错位。
- 列表内观看保留右侧可滚动的 playlist 面板、当前项高亮、条目位置和前后切换；手机上合理移至播放器下方。播放上下文和地址栏保持同步。
- 用户主动选择“播放全部”后，仅在当前 playlist 内继续；按用户设置在末尾停止或循环，不扩展到推荐视频。直接访问链接或恢复会话不自动开始播放。服务器同步时不抓取列表作者其他不相关频道。

**视频评论区**

- 播放页下方必须有真实的公开评论区，保持 YouTube 风格的作者名、发布时间、正文、展开全文、点赞数、“热门评论/最新优先”排序与回复展开。
- 所有评论和回复都不渲染头像、默认头像或首字母圆形占位，不保留无意义的头像空列；不发起评论头像图片请求。频道主页/视频作者区的频道头像不受此限制。
- 保持访问者免登录，因此评论按只读实现。展示来自 API 的点赞数，不提供无法生效的发表、回复、点赞、置顶或审核按钮，不伪造操作成功；可以提供用户主动打开原 YouTube 评论区的链接。
- 后端用 `commentThreads.list` 按视频、排序和 pageToken 获取公开顶层评论；使用 `comments.list(parentId=...)` 分页读取完整回复，不能把 thread 响应中附带的部分 replies 当作全部回复。[顶层评论接口](https://developers.google.com/youtube/v3/docs/commentThreads/list)和[回复接口](https://developers.google.com/youtube/v3/docs/comments/list)
- 评论区接近视口或用户展开时才按需请求，默认每页约 20 条；不阻塞播放器和首屏，不后台抓取所有评论。回复点击后再加载，列表使用“加载更多”。排序切换要重置游标并防止旧请求覆盖新排序。
- 使用 `textFormat=plainText` 或可靠的输出净化，保持换行；如转换链接，只允许安全协议，不能直接注入评论 HTML。使用 fields 投影和后端响应映射移除不需要的头像字段。
- 公共评论缓存按视频、排序、分页令牌/父评论区分，使用短 TTL 并遵守元数据缓存期限；限制缓存大小与上游请求，不加入每分钟的全量同步任务。
- 区分“暂无评论”“已关闭评论”“评论已不可用”“配额/网络异常”，支持适当重试；评论失败不妨碍播放。只展示 API 能可靠提供的信息，不猜测作者徽章、置顶状态或官方排名。

**频道获取和后端职责**

用 YouTube Data API 获取元数据，优先采用 `channels.list` 获取频道及 uploads playlist，再用 `playlistItems.list` 分页获取上传内容，使用 `videos.list` 批量补全需要的标题、发布时间、时长和可用性字段。不要用搜索接口枚举整个频道，也不要把获取的第一页冒充频道全部内容。依据执行时的[频道接口文档](https://developers.google.com/youtube/v3/docs/channels/list)和[分页接口文档](https://developers.google.com/youtube/v3/docs/playlistItems/list)核实实现。

- 添加频道后先显示最新的一批视频，历史视频通过受控后台任务逐页补齐。显示“已同步多少条、是否仍在同步、上次更新时间”，失败保留已有内容并允许重试。
- 同步状态、下一次执行时间和分页进度持久化到 D1。Worker 实例回收后能够继续；处理失效分页令牌时可重新扫描并去重，避免遗漏和重复。任务领取采用有到期时间的持久租约或等效方案，处理多实例、重复触发和中断重试，不能仅依赖进程内锁。
- 默认每个活跃频道和已登记 playlist 的内容检查间隔为 6 小时，可配置；提供有冷却时间的手动刷新。活跃默认指最近 30 天有访问请求的来源，不建立用户画像；不再活跃的来源暂停周期同步，再次访问时恢复，避免匿名用户曾添加的来源被永久抓取。
- 使用一个 Cloudflare Cron Trigger 定期领取少量到期任务，默认每分钟触发、空队列快速退出；触发频率不等于每分钟重新拉取频道。历史补齐可在多次触发中继续，频道新内容检查仍遵守自己的间隔。Cron 使用 UTC，界面展示用户本地时间。必须接入实际 `scheduled` handler，并提供本地触发验证方式。[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- 优先最新内容，依据 Workers Free 的 CPU、子请求及 D1 读写预算，把一次任务拆成可恢复的小批次；不得在一个请求或 Cron 调用中循环抓完整频道。历史补齐、元数据刷新都需要处理配额不足、网络错误和退避重试。不要无限重试，也不要让某个大频道阻塞其他频道。`waitUntil` 只用于平台允许的短任务，不得当作可靠队列或无限后台执行器。
- 相同频道或视频的公共元数据跨访问者复用缓存，通过持久任务去重减少重复上游请求；进程内请求合并仅作为额外优化。后端无需存储用户账号、个人收藏列表或播放历史；请求必要的来源 ID 不等于建立用户画像。
- 缓存和同步进度用持久存储保存。将用户自选 ID 与 API 元数据分开管理，并按官方要求刷新或删除过期 API 元数据，不能无限保留旧副本；公共 API 元数据缓存应在 30 天内刷新或删除。[缓存要求](https://developers.google.com/youtube/terms/developer-policies#handling-youtube-data-and-content)
- 私密、删除、地区限制、禁止嵌入等内容要有合理的不可用状态。公开视频列表并不保证每一条在每个地区都可播放，不要伪造可用性或删除用户收藏来掩盖失败。
- 所有匿名接口都需要输入校验、分页与批量上限、请求超时、合理频控和全局上游请求预算。只请求固定的官方 API 地址，不提供任意 URL 代理。
- 预算不足时保留进度并暂停新任务，展示同步暂停原因和后续恢复方式；不能把只完成一部分的频道标记为已完整同步。预算应同时考虑 YouTube 配额与 Cloudflare 免费额度。
- API 响应应区分输入错误、未配置、密钥无效/服务未启用、配额不足、上游网络异常及资源不存在，返回适合界面展示的信息，避免泄漏请求凭据。
- 如果真实密钥存在但 API 调用失败，先识别实际原因。需要用户开启 API 或修改密钥限制时，提供准确的最少操作，并完成其他开发和可执行验证；不能悄悄换成演示数据后宣称联网功能完成。

**播放方式与边界**

播放器的按需加载参考 [hackertube.org](https://hackertube.org/)。截至 2026 年 11 月 10 日核查，其默认播放页先显示封面，点击后创建 `youtube-nocookie.com/embed/...` iframe。播放器外的页面结构、交互和视觉布局以 YouTube 为参考，使用 plum 主题；不把 HackerTube 的信息架构或推荐系统当作产品要求。

- 首页和未点击播放的播放页，不加载 YouTube iframe 或 IFrame Player API 脚本。缩略图可以从图片域名按需加载。
- 用户点击播放后才加载播放器。为了保存/恢复进度，可按需加载官方 IFrame Player API，保持实际嵌入地址使用 `https://www.youtube-nocookie.com/embed/VIDEO_ID`。
- 正确处理 `origin`、`enablejsapi`、`playsinline`、iframe 权限和 referrer policy；参照[播放器 API](https://developers.google.com/youtube/iframe_api_reference)及[播放器参数](https://developers.google.com/youtube/player_parameters)。不要用导致嵌入身份校验失败的全局 `no-referrer` 设置。
- `autoplay=1` 只用于用户点击播放、播放全部，或用户已经明确启用的列表连续播放流程；直接打开页面、恢复会话或普通页面导航不能自动开始播放。浏览器阻止自动播放时，应保持可手动播放。
- 使用官方控制条，支持其原生的暂停、拖动、字幕、倍速、全屏等能力。不另做一套不完整的自定义视频控件，不代理或下载视频流。
- 设置 `rel=0`，但必须理解它只把结束相关推荐限制在同频道，不能保证播放器内部完全没有推荐。mytube 自己的页面不增加外部推荐；不覆盖、裁剪、修改官方播放器来伪造“完全无推荐/无广告”。
- 播放页保留 YouTube 的播放器、标题、作者区、操作行、可展开简介、评论区以及右侧列表的布局。普通观看时侧栏只展示已选择来源，playlist 观看时显示当前列表；默认关闭推荐式自动连播，用户主动开启的 playlist 连续播放按前述规则执行。
- 默认、影院和全屏的操作习惯尽量与 YouTube 一致。影院模式调整 mytube 布局，全屏/字幕/倍速/画质使用嵌入播放器已有能力；保留播放器原生快捷键，避免全局快捷键干扰输入框、评论正文选择或播放器焦点。跨域 iframe 内部样式由 YouTube 控制，不尝试注入 plum CSS。
- 将播放位置保存在浏览器本地，节流写入；离开路由时销毁播放器并释放事件和定时器，确保没有后台声音。再次播放时恢复合理的位置，接近结尾时提供从头播放。
- 处理常见嵌入错误和初始化超时，显示重试及用户主动点击的“在 YouTube 打开”。不得自动跳出站点，也不得把降级链接当作嵌入播放验收通过。

**界面与性能**

保留 YouTube 的布局和交互：顶部横向搜索栏、可折叠侧栏、筛选 chips、视频卡片网格、搜索结果列表、频道横幅与页签、playlist 行列表，以及观看页的主播放器/信息/评论与右侧列表。沿用熟悉的信息密度、间距比例、圆角、按钮位置和浏览器导航行为，并保留 mytube 品牌。plum 用于主题强调与交互状态，不把整个页面改成紫色底或仪表盘式大卡片。

UI 必须用 shadcn/ui 组件体系，实际组件与样式优先来自用户指定的 [radix-shadcn.dev registry](https://radix-shadcn.dev/r/radix-base.json)。已核实该项目采用 shadcn 的 Base UI 基础组件加 Radix Themes 风格 tokens；不能因为站名含 radix 就混用 Radix primitives 的组件 API。

- 执行时先检查当前 shadcn 与 registry 文档、项目 `components.json`、基础组件类型和别名；使用项目包管理器对应的 shadcn CLI 安装所需组件。按需安装，保留组件可编辑源码，不把整个 showcase 或所有组件依赖搬进产品。
- 正确安装 Theme 及其样式依赖，并配置 `Theme` 的 `config={{ ...defaultTheme, accentColor: 'plum', grayColor: 'auto' }}`。这是该站的主题配置，不能编造一个 `--preset plum` 命令。执行时核实当前 API，保留真实主题 tokens 与必要署名。
- 使用组件自身的 variants、语义颜色及布局组合实现 YouTube 风格。频道导航采用下划线式页签，视频网格不强制套带边框的 Card；弹层、输入、菜单、按钮、Toast、加载和空状态复用现有组件，不重复手写。
- Portal 中的菜单、Dialog、Tooltip 等要继承同一 Theme；正确使用 Base UI 的组合 API，不能混用 Radix 的 `asChild` 等不兼容用法。适配项目路径别名，核对第三方 registry 安装后的 imports。
- 若网站临时不可访问，可只读参考本机 `/Users/michael/work/radix-shadcn` 的 README、`docs/THEMING.md` 和 registry 配置；不得修改那个仓库，也不能让 mytube 构建依赖相邻目录。优先通过已验证的公开 registry 安装。

- 桌面和手机都能使用，处理侧栏收起、触摸操作、长标题、无图封面、空状态、错误状态和正在同步的状态。
- 保留浅色/深色主题与系统偏好选项，两种主题都使用 plum 配置及配套中性灰阶；在浏览器本地保存选择。验证主题切换后的菜单、评论文字、边框和焦点可读性。
- 所有关键操作有明确标签、键盘焦点及可用的点击范围。删除反馈、加载反馈和重试入口应可见。
- 页面先展示本地状态和已有缓存，刷新在后台进行，不因每次导航都等待上游 YouTube 请求。
- 个人库来自 IndexedDB，优先使用 TanStack Start 的 SPA 模式或静态预渲染页面外壳，服务端功能继续由 Start server functions/server routes 提供；不为每个匿名页面访问执行昂贵 SSR。浏览器存储只能在客户端访问，构建和预渲染不得依赖用户数据或真实 API Key。[Start SPA 模式](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)
- 图片按需加载并预留尺寸，播放器及其依赖延后加载。避免字体、图标库或前端框架的不必要体积。
- 性能目标以本地 production build 的固定测试条件衡量：不计第三方播放器，首屏自有 JS 尽量控制在 gzip 200 KB 内，CLS 不超过 0.1，桌面冷启动 LCP 争取小于 2 秒。记录测试条件及实际结果；目标未达时分析并优化，不能编造分数。
- 将页面可用时间与视频首帧时间分开报告；后者受 YouTube 和网络影响，不能用封面显示时间冒充播放启动时间。

**指定技术栈和 Cloudflare 部署设计**

必须使用 TypeScript + TanStack Start（React）+ shadcn/ui，采用当前官方支持的 Vite 与 `@cloudflare/vite-plugin` 集成，UI 使用 radix-shadcn.dev 的 plum 样式配置。路由使用 TanStack Router，后端使用 Start server functions/server routes；按需使用 TanStack Query 管理请求缓存。不要另起 Fastify/Express 服务，也不要换成普通 React SPA 或 Next.js。使用当前稳定且彼此兼容的版本，提交依赖锁文件。依据 [TanStack 托管文档](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)和 [Cloudflare Start 指南](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)实现，不照搬旧版本构建目录或过时适配器。

- **Cloudflare Workers**：运行 Start 的服务端功能和 `scheduled` handler。优先单个 Worker；自定义入口保留 Start 的 fetch handler，同时导出调度处理器。服务端密钥和绑定放在服务端模块，不能被客户端导入或序列化。
- **Workers Static Assets**：托管构建后的 JS、CSS、图片和页面外壳；尽量让静态请求直接由资产服务返回。正确区分页面导航、静态资源、`/api/*` 和 Start server function 路由，SPA fallback 不能吞掉动态接口或把错误接口变成 200 HTML。不要无故让所有静态请求先执行 Worker。[资产计费与限制](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- **Cloudflare D1**：保存公共频道/视频/playlist 元数据、有序列表成员、按需评论缓存、同步任务、分页游标、租约及必要预算状态，提供 SQL migrations 和本地开发数据。数据库规模目标按单个免费 D1 数据库规划，不能把账号总额度误当作单库容量。使用适当索引、有限分页和参数化 SQL，降低行扫描及重复写入；轻量 ORM 可选，优先简单可靠。
- **Workers Secrets**：生产时保存 `YOUTUBE_API_KEY`；本地复用 `.env.local`，不用新增访问者登录。通过生成的 Workers 类型和 bindings 访问 D1/Secret，不把全量环境对象返回客户端。
- **IndexedDB**：继续保存个人选择的频道/playlist、单条收藏、隐藏项、主题偏好和播放进度。服务端不持久化这些个人数据。
- 不依赖常驻 Node 进程、持久文件系统、本机 SQLite 驱动、`setInterval` 调度或 Docker 数据卷。Node 可以用于本地工具链，但业务代码必须在 Workers 的 workerd 运行时通过验证。
- 初版默认只需 Workers、Static Assets、D1、Cron Triggers 和 Secrets；不引入 R2、KV、Queues、Durable Objects、Stream、付费图片处理或其他数据库作为必需依赖。确有必要引入额外服务时，先核实免费计划可用性、计费条件和必要性，不为尚未出现的规模问题扩建架构。
- 提供 `wrangler.jsonc`、D1 migrations、Worker bindings 类型生成、开发/测试/build/preview、迁移和部署命令。配置合理的 `compatibility_date`，只启用实际需要的兼容标志。
- 本地使用 Cloudflare Vite 插件/Wrangler 的 workerd 与本地 D1，验证生产构建的预览。执行 `wrangler deploy --dry-run` 检查生成的部署产物，不实际部署；遵循插件生成的部署配置，不把源配置中的入口误当作最终构建入口。
- README 写明本地初始化与 migrations、复用 `.env.local`、D1 数据位置与导出、Cron 本地测试、未来创建远程 D1/应用迁移/配置 Secrets/部署/绑定域名的步骤。没有 Cloudflare 账号登录时也应尽量完成本地开发，不把未来部署凭据设为当前开发前置条件。

**免费额度和运行成本**

成本目标是除域名外，尽量在 Cloudflare 免费计划中运行小规模 mytube。不能用“免费额度”暗示无限资源，也不能自动升级套餐。本轮仅准备未来部署方案。

- 2026 年 11 月 10 日核查的基线：Workers Free 每日 100,000 次请求，HTTP 和 Cron 每次 CPU 时间均为 10 ms；等待网络 I/O 不等于 CPU 时间。执行时重新核实当前限制，特别注意 SSR、大 JSON 解析和任务批量大小，不能套用付费 Cron 的长执行额度。[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)
- D1 免费基线为每日 500 万行读取、10 万行写入、账号总计 5 GB 存储，单库最大 500 MB。读写额度按行计，不按 SQL 请求次数计；索引维护也可能增加写入量。执行时核实最新规则。[D1 定价](https://developers.cloudflare.com/d1/platform/pricing/)和[单库限制](https://developers.cloudflare.com/d1/platform/limits/)
- 只存储业务需要的公共元数据，不下载或代理视频，缩略图尽量直接使用来源图片 URL。通过缓存复用、活跃频道策略、分批同步、过期数据清理和请求限制控制成本。
- 记录预算消耗和同步错误所需的最少诊断信息，避免高频轮询、每次浏览都写统计记录或全表扫描。公共缓存键要包含实际查询条件，不把某个浏览器的个人结果作为所有用户共用的首页缓存。
- README 给出资源组成、各项免费限制、采用的应用预算，以及在一个明确的小规模场景下的粗略用量估算；将估算和实测分开。达到免费额度时，应暂停/限流并保留可恢复状态，不自动启用付费服务，也不通过分拆账号规避限额。
- 本地测试与 dry-run 不能证明线上免费额度一定够用。若用户尚未授权实际部署，明确线上 CPU 和真实流量验证待部署后进行；先在本地优化并记录可测部分，不虚构线上指标。

**执行顺序**

1. 检查项目，写一个简短的阶段计划。先建立 TanStack Start + Cloudflare Vite 插件 + 本地 D1 的最小可运行路径，之后直接推进，不等待用户批准常规实现选择。
2. 尽早验证真实 YouTube API 链路：使用已有服务端密钥解析 `https://www.youtube.com/@ETALENT-TV`，读取 uploads playlist 及一页真实视频元数据。这个频道只是验收输入，不能自动出现在所有新用户的首页。如果该频道本身已不可用，记录真实结果，再使用另一个明确记录的公开视频频道验证基础链路。
3. 安装所需 shadcn/registry 组件并配置 plum 主题，优先打通“添加频道/视频/playlist → 本地保存 → YouTube 风格 URL 与页面 → 点击后嵌入播放 → 刷新后仍保留”的完整路径。
4. 完成频道主页、playlist 详情和队列、无头像评论及回复、历史分页、定时更新、库内搜索、移除/隐藏、播放进度、备份恢复、错误处理和性能整理。
5. 使用真实浏览器对照 YouTube 检查桌面和手机的首页、搜索、频道、playlist、观看/评论页面，以及浅色/深色 plum 主题，修复发现的问题；执行核心测试和 production build。不要以截图漂亮代替功能验收。
6. 验证 Workers 生产构建预览、D1 migrations、真实的 scheduled 入口和部署 dry-run；不要实际发布或操作远程数据库。最后给出完成内容、运行命令、验证结果及剩余阻塞。持续任务的状态记录可以简短保存在项目中，方便中断后接续。

**必须验证的行为**

测试针对真实风险，避免大量只重复实现细节的测试。可使用 Vitest 和 Playwright，或项目已有工具。离线测试使用明确的 fixtures；真实网络验证单独报告。

- URL 解析与路由：正常链接、不同链接指向同一视频、无效 ID、伪造相似域名、恶意输入和分享参数；`/watch?v=`、`/@handle`、`/channel/ID`、`/playlist?list=`、`/results?search_query=` 的深层刷新、前进后退及 query 参数切换有效，保留列表和时间上下文。
- 数据范围：频道 A 与 B 都已存在后端缓存时，只选择 A 的浏览器在普通首页/搜索/侧栏中不会出现 B；若用户明确选择含 B 的 playlist，则只允许其列表成员出现，不自动添加 B 的其他内容；两个独立浏览器上下文的选择互不污染。
- 持久化：添加、刷新、关闭并重新打开后保留；首页同一视频跨来源去重；移除频道/playlist 不会误删仍由其他来源选中或独立收藏的条目。
- Playlist：超过一页、包含重复视频和不可用条目的 fixture 保持顺序、正确位置和当前项；重排/移除能正确同步，中断扫描不误删；“播放全部”只在明确选中的列表内继续，直接刷新链接不自动播放。
- 评论：真实公开评论可读；关闭评论、空评论及 API 错误状态不同；排序切换和分页不串数据；回复超过 thread 自带数量时能继续加载；正文不能注入脚本；评论和回复 DOM 无头像/头像占位且无评论头像网络请求。
- 视觉与交互：确认真实使用 shadcn/指定 registry 与 plum Theme，浅色、深色和 Portal 样式一致；频道头像正常而评论头像移除；频道/playlist/观看页保持 YouTube 布局和熟悉操作，键盘、输入框及官方播放器快捷键不冲突。
- 完整性：用超过一页的频道 fixture 验证分批执行、D1 持久进度、Worker 重建后的恢复、去重、搜索未加载到界面上的视频；不能只测首批数据。
- 更新：模拟频道发布新视频，通过本地 Cron 测试入口触发 scheduled handler 后可见；验证重复触发、任务租约过期和并发领取；同一频道的并发请求不会重复大量调用上游；配额错误会停止无效重试并保留可用缓存。
- 播放：点击前没有 YouTube iframe/API 脚本请求，点击后使用 nocookie iframe；路由离开停止播放；进度可恢复；失败反馈有效。网络自动化受限时，区分受控测试、实际观察和未验证部分。
- 安全与配置：客户端构建产物、预渲染 HTML 和 server function/API 响应不含真实 API Key；生产静态路由无法读取环境文件；匿名接口限制、非法输入和密钥/配额错误均有有效处理。检查时只输出检查结果，不输出密钥。
- 备份：合法导出可在空浏览器导入恢复；错误格式、超限文件和重复导入不会破坏原有库。
- 实际体验：至少完成一次真实频道添加、单视频添加和公开 playlist 添加，浏览真实频道主页与公开评论，展开一条有回复的评论；在网络允许时实际播放一个允许嵌入的视频，确认不是只显示了封面或 iframe 空壳。样例视频关闭评论时换一个可公开读取评论的测试视频，不伪造数据。
- Cloudflare 兼容：在 workerd + 本地 D1 中运行核心路径，migration 在空库和已有库上正确执行；静态页及深层链接刷新正常，API/server function 请求不会被 SPA fallback 吞掉，调度器不依赖浏览器保持打开或常驻进程。
- 成本退化：模拟预算耗尽、存储接近应用设定阈值及频道不再活跃，验证任务暂停、状态保留和恢复，不丢失本地个人库或误报同步完成。
- 交付：类型检查、核心测试和 production build 通过，Workers 构建预览可运行，部署 dry-run 通过，文档命令可执行。只将实际验证过的行为标记通过，区分本地验证与尚未执行的远程部署验证。

只有上述核心路径已实现并验证，才可宣称完整交付。如果确实存在需要用户解决的外部阻塞，应准确说明未完成范围，并交付其余已完成部分，不能把阻塞伪装为成功。最终回复简洁列出应用入口、启动方式、验证摘要和用户仍需完成的最少事项。现在开始执行。

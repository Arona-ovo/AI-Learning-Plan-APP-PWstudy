# PWstudy · GitHub 调研 + 功能提案（2026-10-09）

> 结论先看：真正能"直接拿进来用"的代码不多（大多是别的栈），**但有 3 类东西很值钱**：
> ① 几条能立刻抄的**实现思路**（JSON 修复、UsageStats 正确用法）；
> ② 一批**可借鉴的功能点**（AI 学习要点、难度加权排期、热力图、成就体系）；
> ③ 一批**现成组件/插件**（图表、日历、保活通知），但要你先定要不要引（体积/授权/坑）。
> 本文最后有 6 个需要你拍板的问题。

---

## 一、已经拿进来用了（本次已落地，可回退）

### 1. AI 输出 JSON 修复（已完成，40/40 测试通过）
- **来源思路**：`josdejong/jsonrepair`（ISC，2.4k★）与 `mangiucugna/json_repair`（MIT，5k★）——都是"修 LLM 吐出的坏 JSON"的成熟库。
- **做法**：**没有装依赖**（npm 包 519KB，塞进 uni-app 不划算），按它们的思路在 `services/plan-agent.js` 里自研了 ~70 行 `repairJSON()`：逐字符扫描、**只在字符串外面动手**。
- **能救的场**：输出被 `max_tokens` 截断、单引号/中文弯引号、`True/False/None`、行注释与块注释、对象/数组尾逗号、括号类型错配、断在字符串中间。
- **不能救/不会碰的**：字符串内部的 `//`（如 `https://` URL）和引号内容——专程写了用例守住这一点。
- **收益**：规划/追问的成功率直接上一个台阶，以前"AI 说了一堆但解析失败"会白白重试 3 轮。
- 新增测试：`extractJSON` 截断补全 / 单引号+Python 常量 / 注释+数组尾逗号 / 不破坏 URL。

---

## 二、GitHub 上找到的（按推荐度排序）

| # | 项目 | 许可 | 是什么 | 对 PWstudy 的价值 | 我的建议 |
|---|---|---|---|---|---|
| 1 | **google sample android-AppUsageStatistics** | Apache-2.0 | Google 官方 UsageStats 示范 | 用法权威参考 | 借鉴 |
| 2 | **Flutter `usage_stats`（Parassharmaa）** | 需核 | 把 UsageStatsManager 全包了，**文档写得极全** | 关键：它明确写了 `queryAndAggregateUsageStats` / `queryEvents` / Android 11+ `QUERY_ALL_PACKAGES` 的坑 | **强烈借鉴（见 A3）** |
| 3 | **Cap-go/capacitor-android-usagestatsmanager** | MPL-2.0 | 同上，Capacitor 版 | API 清单齐全（queryUsageStats/queryEvents/按包名过滤） | 借鉴 |
| 4 | **josdejong/jsonrepair** | ISC | 修坏 JSON（JS/TS） | 已借鉴自研 | ✅ 已用（思路） |
| 5 | **mangiucugna/json_repair** | MIT | 同上，Python 版 | 同上 | ✅ 已用（思路） |
| 6 | **uCharts / qiun-data-charts** | 官网标 Apache-2.0（另有资料写 MIT，**引入前核一眼 LICENSE**） | uni-app 全端 Canvas 图表，20+ 图表类型，完整版 ~170KB | 统计页的折线/占比环/仪表盘一步到位 | **观望**：我们现在纯 CSS 画图表（避开 Canvas 与 transform 冲突的坑），真要复杂图表再引 |
| 7 | **uni-calendar（uni-ui 官方）** | Apache-2.0 | 月历、打点、范围选择 | 做"日历视图/改期"省事 | **观望**：现在是列表 + 内联滚轮，够用 |
| 8 | **vue3-activity-calendar** / `@rsalianto/git-heatmap-vue` / vue3-calendar-heatmap | MIT | GitHub 风格贡献热力图，~2.5KB | 统计页"近 12 周专注热力图" | **只借鉴配色分档与数据结构**：这些是 SVG/DOM 组件，App 端不好用，自己用 `view` 画（和现有打卡折线同一路子） |
| 9 | **Moodist（remvze/moodist）** | 需核（多为 MIT） | 54+ 环境音白噪音站 | 专注白噪音的音源与分类方式 | 想加再说（见 B5） |
| 10 | **Noixer（abetusk/noixer）** | CC0 音源 | 环境音混音器，20+ 声音 | 音源明确 CC0，可商用 | 备选 |
| 11 | **yiGmMk/StayFocused** | 各音源自带许可 | 整理好的 freesound 白噪音清单（雨/森林/篝火…） | 挑音源方便 | **注意**：freesound 上每条音频许可不同，CC-BY 要署名，只挑 CC0 |
| 12 | **mkznc/AI-Study-Planner** | 需核 | LangChain + Pydantic schema 校验 + JSON 修复 + **确定性排程** + 修订 agent | **佐证我们架构是对的**（AI 只管解读，排期用确定性算法） | 借鉴其"排期不交给模型"的原则 |
| 13 | **akshay118R/AI-Study-Planner** | 需核 | Month→Week→Day→Task 四层 + **先审后落地** | 与我们的"强制预览"一致 | 借鉴层级 |
| 14 | **Anirudh0465/Study-helper** | 需核 | Ollama 本地模型；**难度加权排期**、**考前自动留复习日**、**每条任务 AI 生成学习要点（Guide）** | 三个很贴题的功能点 | **强烈借鉴（见 B2）** |
| 15 | **nsh07/Tomato** | 需核 | Material 3 极简番茄钟，Android 16 实时更新/状态栏进度 | 通知栏倒计时的 UX 参考 | 参考 |
| 16 | **Ygria/ctdp-pomodoro** | 需核 | ADHD 友好：预约启动、链条激励、**技能树** | 成就/技能树设计参考 | 参考（见 C1） |
| 17 | DCloud 插件市场：`cy-Keepalive` / `hans-keepalive` / `Ba-KeepAliveSuit` | 部分收费，**需自行确认** | Android 前台服务、常驻通知、电池优化白名单、厂商自启动 | 番茄钟后台不掉的唯一现实路径 | 见 A1（也可不用插件，自己写原生） |
| 18 | 各类 uni-app 番茄钟（liwanzhong/myfocus、tomato-clock-uniapp 等） | GPL / 需核 | 简单番茄钟 | **代码没价值**（比我们已有的简陋），GPL 还有传染性 | ❌ 不用 |

---

## 三、我建议加的功能 / 完善项（分档，等你勾）

### A 档 — 补"能用"的短板（建议先做）

- **A1 番茄钟前台服务 + 通知栏倒计时** ⭐最推荐
  现状：番茄按 `endAt` 走，切页/杀进程能恢复，但**切后台和息屏时没有任何常驻提示**，结束也没有通知/震动/音效——番茄钟最核心的一段体验是缺的。
  做法：前台服务 + 常驻通知（剩余时间、暂停/结束按钮），Android 8+ 必须走通知渠道；可用插件市场的保活插件，也可用 UTS 自己写。
  代价：需要 `FOREGROUND_SERVICE` / `POST_NOTIFICATIONS` 权限、一点耗电、需自定义基座才能测。

- **A2 数据导出 / 导入备份**
  现状：所有数据在 `fj_pw_data_v1` 本地 storage，**换机或清数据就全没了**，目标/番茄历史不可恢复。
  做法：导出成 JSON 文件（系统分享/保存到文件），支持导入合并。半天工作量，风险极低。

- **A3 学习 App 用时统计改用聚合接口** ⭐推荐
  现状：`apptime.js` 用 `queryEvents` 手动配对前后台事件算时长——事件多、边界情况多（跨天、异常退出、系统事件干扰）。
  做法：改用 `queryUsageStats(INTERVAL_DAILY, 今日 0 点, now)` + `getTotalTimeInForeground()`，系统直接给结果，更准更省电；`queryEvents` 只留作降级。
  顺带补：权限被用户收回时的明确提示与一键重开。

- **A4 每日复盘 / 周报（AI）**
  规划草案里写了"周报：一句 AI 总结 + 下周建议"但还没做。复用现有 `plan-agent` 与 `ai-cache` 即可。

### B 档 — 体验提升

- **B1 统计页升级**：近 12 周专注热力图（GitHub 风格，自己用 view 画）+ 时段分布（一天里哪几段最有效率，参考 nsh07/Tomato 的 productivity by hour）+ 目标进度曲线与"按当前速度预计完成日"。
- **B2 任务级 AI 学习要点** ⭐我很喜欢
  点任意任务 → AI 生成"这个任务具体学什么、怎么学、怎么自查是否学会"（Study-helper 的 Guide 思路）。比"再生成一遍计划"有用得多，也最能体现"AI 学习规划"的差异性。
- **B3 目标模板库**：内置几个可直接起步的模板（如"专升本英语 90 分""四级 500 分""考研英语二 70 分"），一键套用 + 自动填好里程碑骨架，降低首次使用门槛，也方便以后和"背单词 App"联动。
- **B4 日历 / 周视图 + 拖拽改期**：现在只有列表 + AI 重排建议，缺少"我自己挪一下"的直接操作。
- **B5 白噪音 / 专注音效**：雨声、咖啡馆、篝火等（CC0 音源）。**代价是 APK 体积**（每首 1–3MB），建议做成"在线播放或首次下载"，别打包进去。

### C 档 — 留存与游戏化（可后置）

- **C1 连续打卡 + 徽章成就 + 技能树**（ctdp-pomodoro 的技能树思路：条件解锁、进度追踪）。
- **C2 好友/排行榜一起学**（需要账号体系，重）。
- **C3 严格模式 / 专注锁**：检测到切到"娱乐"标记的 App 就提醒。**隐私敏感 + 耗电**（要轮询前台包名），建议观望，且必须做成默认关闭。
- **C4 桌面小组件（App Widget）**：uni-app 需原生插件，成本高，性价比一般。

### D 档 — 工程与合规

- **D1 校验脚本**：`_tools/` 里 59 个 check 脚本大多是背单词时代的，已过时；建议清理并补 PWstudy 相关断言（数据字段、AI schema、跳转白名单、主包体积护栏）。
- **D2 与"背单词 App"联动的接口预留**（你提过以后要联动）：现在就约定好 deep link（`pwstudy://goal/<id>?task=<id>`）和互相写入时长统计的字段格式，免得以后返工。
- **D3 设置页仍残留背单词条目**（你说先不动，等你发话）。
- **D4 隐私与统计口径说明页**：UsageStats 权限用途、数据只存本地不上传、可一键清空。**上架前一定要有**。
- **D5 已知遗留**：`page-agent` / `home-widgets` 资产还没接回新业务；`static/tabbar` 的 PNG 图标已不用（tabBar 现在是 CSS 画的），可清理。

---

## 四、如果全听我的，顺序是这样

1. **A1 + A3** —— 番茄钟能后台跑、统计更准（这是"能不能天天用"的关键）
2. **A2** —— 数据别丢（半天工作量，收益/成本比最高）
3. **B2 + B1** —— AI 学习要点 + 统计可视化（这两个最像"产品卖点"）
4. **B3 / B4 / B5** —— 按你的偏好挑
5. C 档等用户量起来再说

---

## 五、需要你拍板的 6 个问题

1. **番茄钟要不要上前台服务 + 常驻通知？**（A1）要多两个权限、多一点耗电，但这是番茄钟的核心体验。
2. **图表继续自己用 CSS 画，还是引入 uCharts？**（B1）自画：零体积、风格统一、图表类型少；uCharts：图表全，但 +170KB 且要处理 Canvas 与 transform 冲突的老坑。
3. **白噪音要不要？**（B5）体验加分，但 APK 会变大（建议做成在线/按需下载）。
4. **严格模式（检测切到娱乐 App 就提醒）要不要？**（C3）隐私敏感、耗电，我建议先不做或默认关闭。
5. **下一步先做 A 档，还是直接跳 B2（AI 学习要点）？**
6. **"背单词 App 联动"（D2）现在就定接口，还是等那边成型再说？**

> 你回一句"就按你的顺序来"我就开工；想挑着做，直接报编号（比如 "A1 A2 B2"）即可。

---

## 六、实施记录（2026-10-09 晚，你的 6 个答复之后）

| 你的答复 | 落地情况 |
|---|---|
| 1 前台服务 + 常驻通知 要 | ✅ `utils/notify.js` + focus.js 全流程：常驻倒计时通知、结束提醒、响铃、震动、可选 WakeLock |
| 2 图表方案 | ⏸ 待你定（见下方解释），本期统计页继续用 CSS 自画 |
| 3 白噪音 | ⏸ 后置（你说完善得差不多再来） |
| 4 严格模式 | ✅ `utils/strict.js`：可开关（默认关），**只在番茄进行中**每 8s 检查，先提醒、30s 不回来本次作废 |
| 5 A + B 全做，含"可预见节日" | ✅ 全部落地，节假日已接进规划与重排（见下） |
| 6 联动接口现在定 | ✅ `utils/link.js` + manifest 加了 `pwstudy://` scheme |

### 关于第 2 题：uCharts 是什么、我为什么不急引进来
**uCharts（秋云图表）** 是国产的 uni-app 跨平台图表库，用 Canvas 画图，支持折线/柱状/饼环/雷达/仪表盘等
20 多种图，官网标 Apache-2.0 开源，完整版约 170KB，可以只引需要的类型。

对比我们现在"纯 CSS（view + 宽高百分比）自己画"：
- 自画：零体积、风格跟主题色完全统一、不受 Canvas 在 App 端的层级/transform 老坑影响；
  缺点是图表类型少（柱状、条状、热力图这类够用，雷达/仪表盘做不了）。
- uCharts：图表全、交互好（缩放、tooltip）；代价是 +体积、要处理 Canvas 与页面 transform 冲突
  （我们之前做打卡折线时踩过，最后改成纯 view）。

**我的建议：先不引。** 统计页要的三种（柱状、热力图、时段条）自画已经够了，
真要做"目标进度曲线 + 多轴对比"或"环形仪表盘"时再引也不迟，改动面积很小。
统计页本期已升级成：近 12 周热力图 + 24 小时时段分布 + 最强时段提示 + 按近期速度外推的预计完成日。

### 节假日（你特别点名的那条）
- `data/holidays.js`：2026 年国务院安排（gov.cn 原文核对），含 **调休补班日**（周末要上班，按工作日排）
- 规划 prompt 里带上"这段时间有哪些假、哪天补班"，并要求模型排不满
- **落地前还有一道确定性减量**：假期 ×0.5、周末 ×0.8，最少保留 1 个番茄 —— 模型就算不听话也拦得住
- 结果页会标"国庆·已减量"，重排时也会提示"撞假期的先减量，别一股脑顺延"

### 本轮新增/改动的文件
新增：`utils/notify.js`、`utils/strict.js`、`utils/backup.js`、`utils/holiday.js`、
`data/holidays.js`、`utils/task-guide.js`、`utils/link.js`、`data/goal-templates.js`、
`pkgPlan/pages/calendar/calendar.vue`、`pkgManage/pages/backup/backup.vue`
改动：`focus.js`、`apptime.js`、`pwstore.js`、`settings.js`、`plan-agent.js`、
`wizard.vue`、`focus.vue`、`goal-detail.vue`、`stats.vue`、`goals.vue`、`home.vue`、
`profile.vue`、`App.vue`、`pages.json`、`manifest.json`

回归：check-vue **20/20** 页面语法通过，check-pwstudy **63/63** 断言通过。

### 还欠的（等你发话）
- 白噪音（B5）
- 真正的前台 Service：目前是"常驻通知 + endAt 补账"，息屏期间倒计时刷新可能被系统限制；
  要 100% 精准必须上原生插件/UTS + 自定义基座
- 设置页里残留的背单词条目（你说先不动）

---

# 第二轮调研（2026-10-10，围绕上面的"欠账"）

> 本轮专攻三件事：① 真正前台 Service 的现成答案；② 白噪音的音源与许可；
> ③ 新一批 AI 规划项目里可借鉴的思路。结论：**欠账 A1 有官方免费答案了**。

## 1. 前台 Service：官方 UTS 示例里就有完整答案 ⭐⭐⭐

**`dcloudio/hello-uts`**（DCloud 官方 UTS 示例仓库，Apache-2.0）
— `uni_modules/uts-nativepage/utssdk/app-android/index.uts` 里有**完整的 `ForeService` 实现**
（约 60 行）：

- 继承 Android `Service`，`onStartCommand` 里建通知 → `startForeground`
- Android 8+ 通知渠道的条件创建（渠道 id / importance）
- API 26+ 用 `startForegroundService()`、旧版走 `startService()` 的分支
- `onDestroy` 里 `stopForeground(true)` 收尾
- 同文件还有 `ScreenReceiver`（屏幕亮灭广播）——**严格模式想监听息屏的话也能抄**

**意义**：不用买插件市场的保活插件，也不用从头摸索——把官方示例的 ForeService
抄进我们自己的 `uni_modules/pwstudy-focus` UTS 插件，接上 `notify.js` 已有的通知文案即可。
（代价不变：仍需自定义调试基座才能真机验证。）

## 2. 插件市场免费保活插件（不想自己写 UTS 的备选）

| 插件 | 要点 | 状态 |
|---|---|---|
| **ly028-KeepLive** | 免费；Android 前台服务+WakeLock / iOS BGTaskScheduler / 鸿蒙长时任务；API 就 `register/unregister/isRunning` 三个 | 插件市场 id=28058，2026-04 更新 |
| **hans-keepalive** | 2026-09-21 新发布；前台服务 + **厂商后台设置识别与跳转**（小米/华为/荣耀/OPPO/vivo/三星）+ 后台就绪度诊断 + 事件历史 | 免费，id=29752 |
| lime-keep-alive | 一像素保活、无声音乐、崩溃重启等"全家桶" | 部分功能偏灰色手段，**不建议** |

**注意**：无论哪个插件都要自定义基座；且"一像素/无声音乐"这类激进保活容易被系统和商店嫌弃，
番茄钟场景只需要**前台服务 + 电池优化白名单引导**，够用且干净。
hans-keepalive 的"厂商自启设置页跳转"代码思路值得借鉴（可自己实现，不依赖插件）。

## 3. 番茄钟成熟项目的经验（看思路，不抄代码）

**`adrcotfas/Goodtime`**（GPL-3.0，1.7k+ commits，Kotlin 多平台，2026-01 仍活跃）
- ⚠️ GPL 有传染性，**代码不能抄**，但 README 里有一条宝贵经验：
  各厂商 ROM 会激进杀后台应用，解决办法是引导用户**关闭电池优化**，参考 dontkillmyapp.com
  → 建议：首次开始番茄时检测 `isIgnoringBatteryOptimizations()`，弹一次引导（跳系统设置页）
- 亮点功能可借鉴：**Count-up Flow 计时**（正计时累积"休息额度"，不是所有专注都适合 25 分钟切块）、
  免打扰模式联动（专注时自动开 DND）、每日提醒、"一天从几点算起"可配
  （我们算"今日"用的是自然日，夜猫子 0 点后的番茄会被记到第二天，可考虑）

**`nsh07/Tomato`**（已上 Google Play / F-Droid）
- Android 16 Live Updates / Now Bar 常驻倒计时——系统级趋势，我们的通知文案可以预留适配位
- 统计里"一天中哪个时段效率最高"我们已经做了（上一轮 B1 落地），方向被验证

## 4. 新一批 AI 规划项目：三个可借鉴点

| 项目 | 亮点 | 对我们的价值 |
|---|---|---|
| **Keerthanareddy17/StudyBrewX** | 多 agent 流水线：目标解读 → **资源抓取（YouTube/博客）** → 路径构建 → 周任务生成 | **给任务挂"学习资料链接"**：向导产出任务时让 AI 附 2~3 个精选资源链接，任务卡片可点跳转。低成本高感知，很配"AI 规划"定位 |
| **SAfsehEhsani/AI-AcademIQ-Planner** | 进度落后时**自动重排**（Adaptive Scheduler） | 我们的 drift 重排方向被独立验证，可再确认：它也是"进度滞后→压缩而非顺延"优先 |
| **rahma-a04/llm-scheduler**（MIT） | **LLM 与确定性贪心排程双轨**，可切换、可对比；**Google Calendar 导入导出** | ① 佐证"排期不交给模型"纪律；② 新想法：把生成的计划**导出为系统日历事件**（uni-app 可写系统日历，日历页/系统日历双向可见），换机迁移也受益 |

## 5. 白噪音：Moodist 许可已核实

`remvze/moodist`（**MIT**，2026-09 仍活跃，667 commits）：
- 代码 MIT 可自由借鉴（它的混音器 UI / 双耳节拍生成器值得学）
- **音源许可混合**：一部分 Pixabay Content License、一部分 **CC0**——**只能用标 CC0 的那部分**，
  Pixabay 的不许二次分发打包进 APK
- 结合上轮结论：CC0 音源走 Noixer / freesound 筛 CC0；**在线播放或按需下载，不打进包**

## 6. 本轮行动建议（按性价比排序）

1. **A1 收尾**：抄 hello-uts 的 ForeService 写自己的 UTS 插件（`uni_modules/pwstudy-focus`），
   顺带加"电池优化白名单"一次性引导（Goodtime 的教训）——这是息屏后倒计时 100% 准的唯一路径
2. **厂商自启设置跳转**：借鉴 hans-keepalive 的思路自己实现（小米/华为/OPPO/vivo 各自的设置页 intent），
   并进 `setup.js` 的权限清单
3. **任务挂资源链接**（StudyBrewX 思路）：向导 prompt 加一档"每任务附 2~3 个精选学习链接"
4. **计划导出系统日历**（llm-scheduler 思路）：里程碑/任务一键写系统日历，外部可见
5. 白噪音仍按原计划后置，音源只用 CC0

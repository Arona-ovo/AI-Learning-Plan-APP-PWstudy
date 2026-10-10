# PWstudy 学习规划 App —— 产品与技术规划（草案 v0.1）

> 目标：把现有的「AWword 背单词」骨架，改造成 **AI 学习规划 + 番茄专注 + 学习 App 时长统计** 的软件。
> 视觉风格、毛玻璃体系、AI 指令链路、首页卡片系统 **全部沿用**，只换业务内核。
> 主战场仍是 **Android APK**（包名 `com.pwstudy.app` 不变），小程序/H5 顺带支持。

---

## 一、产品定位

一句话：**输入一个远期目标，AI 帮你拆成能执行的日程；番茄钟负责当下专注；系统自动统计你在学习类 App 上花的时间，并据此动态修正计划。**

三类用户动作闭环：

| 层次 | 时间尺度 | 由谁驱动 | 产物 |
|---|---|---|---|
| 远景 | 月 / 学期 | AI 规划 | 目标 → 里程碑 → 周任务 |
| 近期 | 天 / 周 | 番茄钟 + AppDock | 今日任务、专注时长、App 时长 |
| 纠偏 | 每次复盘 | AI 重排 | 剩余任务重新分配、期限顺延/压缩 |

---

## 二、五大核心能力

### 1. 目标向导（Goal Wizard）—— AI 远期规划
- 输入：一句话远景（如「三个月内专升本英语从 60 分到 90 分」）+ 截止日期 + 每天可投入时长 + 当前水平（选填）+ 每周可用天数。
- AI 产出（严格 JSON 信封，白名单校验后方可落库）：
  - 3~6 个 **里程碑**（阶段名 / 起止周 / 目标产出）
  - 每个里程碑下 5~15 个 **任务**（标题 / 预估番茄数 / 建议截止日 / 依赖顺序 / 标签）
  - 一条「总体策略说明」和 2~3 条「风险提示」
- 用户可在结果页逐条勾选、拖动改期、改番茄数，再「确认落地」。
- 落地后自动生成今日任务队列与日历视图。

### 2. 番茄钟（Focus）
- 可配：专注时长（默认 25）、短休 5、长休 15、长休间隔 4 个、自动开始下一段开关。
- 每个番茄 **绑定一个任务**（也可绑定「无任务的自由专注」，事后补挂）。
- Android 端：前台服务 + 常驻通知（剩余时间、暂停/结束），切后台/锁屏不掉；结束用通知 + 震动 + 轻音效。
- 严格模式（可选）：切到被标记为「娱乐」的 App 时弹回提醒（依赖下面的 UsageStats 权限）。
- 中断记录：接电话/切走 → 标记 `interrupted`，不计入有效番茄，但计入时长。

### 3. AppDock —— 快捷访问 + 学习时长统计
这是本 App 最有辨识度的一块，也是**唯一需要系统级权限**的部分。

- **选 App**：列出已安装应用 → 用户勾选「学习相关」的 App，并设定用途标签
  （背单词 / 刷题 / 看课 / 阅读 / 笔记 / 查资料 / 休息娱乐）。
- **快捷访问**：首页一张 Dock 卡片，点图标直接拉起目标 App（按包名 `launchIntentForPackage`）。
- **计时（两条腿，权限缺失也能用）**：
  - **A 前台计时（无需权限）**：从本 App 发起的跳转 → 记录 `start`；回到本 App / 收到回到前台事件 → 记 `end`。
    准确、可打上「这次是为了哪个任务」，但只覆盖"从本 App 出发"的那部分。
  - **B UsageStats 统计（需授权）**：`UsageStatsManager` 查询当日各包前台总时长，
    覆盖所有打开路径，用作**总量校准**与「今日学习时长」主口径。
  - 融合规则：**展示值 = max(B 当日该包时长, A 累计时长)**；任务归因优先用 A。
- **权限引导页**：说清楚「只用来统计你自己选中的 App 的前台时长，不上传」，
  一键跳 `Settings.ACTION_USAGE_ACCESS_SETTINGS`；拒绝也能用，只是统计范围变小。

### 4. 动态重排（Replan）
- 触发：手动点「重新规划」/ 每周日复盘 / 连续 3 天完成率 < 50% 时提醒。
- AI 输入：目标原文 + 里程碑 + 剩余任务 + 近 14 天真实投入（番茄数 / 分钟 / 各 App 时长）+ 已偏离程度。
- AI 输出：**diff 而非全量覆盖**，三类操作：
  - `move`（改截止日）、`resize`（增减预估番茄数）、`split/merge`（拆任务/合并）、`drop`（砍掉低价值任务并说明原因）
- 用户可逐条接受/拒绝，接受后才写库。已完成任务永不改动。

### 5. 统计与回顾
- 今日：专注分钟数、有效番茄数、任务完成数、各 App 时长条。
- 趋势：近 30 天专注时长折线 + 「学习指数」（复用现有 `utils/checkin.js` 的指数思路与画法）。
- 目标视图：里程碑进度条 + 预计完成日（按近期真实速度外推）。
- 周报：一句 AI 总结 + 下周建议（可选，走同一套 LLM 服务）。

---

## 三、页面结构（改造现有 pages.json）

**tabBar 4 项改为：专注 / 目标 / 统计 / 我的**（图标沿用 `static/tabbar/` 风格重画 4 枚）

| tab | 页面 | 内容 |
|---|---|---|
| 专注 | `pages/home/home` | 今日任务队列 · 番茄钟入口 · AppDock · 目标进度卡 · AI 指令输入框（保留） |
| 目标 | `pages/goals/goals` | 远景目标列表 / 里程碑时间轴 / 今日任务清单 |
| 统计 | `pages/stats/stats` | 时长曲线 · App 时长占比 · 番茄分布 · 周报 |
| 我的 | `pages/profile/profile` | 设置 · AI 服务商 · 权限引导 · 主题画质 · 关于 |

分包调整：

- `pkgStudy` → 目标详情 / 任务详情 / 番茄钟全屏页 / Replan 预览 / App 选择与管理 / 趋势详情
- `pkgManage` → 设置 / 目标向导 Wizard / 权限引导 / 登录 / 关于
- 原背单词（词库详情、练习、刷单词、单词详情）**整体下沉到 `pkgLegacy` 分包**，
  作为「内置学习任务」类型：番茄钟可以绑定一个「背单词 30 分钟」的任务，点进去就是原来的练习页。
  这样番茄时长能记到同一个统计口径里，老代码不浪费。

---

## 四、数据模型（落 plus.sqlite，复用现有 Repository + UUID + 软删除）

```ts
Goal        { id, title, rawInput, deadline, dailyMinutes, level, strategy,
              status:'active'|'archived'|'done', createdAt }
Milestone   { id, goalId, title, order, startAt, endAt, targetMinutes, status }
Task        { id, goalId, milestoneId, title, estPomos, donePomos, dueAt,
              status:'todo'|'done'|'dropped', source:'ai'|'user', tags[] }
PomoSession { id, taskId|null, goalId, startAt, endAt, minutes,
              interrupted:boolean, launchedApp|null }
TrackedApp  { packageName, appName, purpose:'study'|'rest'|'neutral',
              defaultGoalId|null, sort }
AppUsage    { date, packageName, minutes, viaLaunch:boolean, taskId|null }
DailyStat   { date, focusMinutes, pomoCount, taskDone, byApp:{}, byGoal:{} }
Setting     { 沿用 settings.js（storage 层）}
```

新增 utils：
- `utils/goal.js`（目标/里程碑/任务的增删改查与进度计算）
- `utils/plan.js`（任务排程、今日队列生成、速度外推）
- `utils/focus.js`（番茄状态机：idle→running→paused→break，跨页常驻用模块级状态）
- `utils/apptime.js`（App 计时：前台计时 + UsageStats 融合 + 日聚合）
- `utils/replan.js`（构造重排 prompt 与 diff 应用）
- `utils/plan-schema.js` / `utils/plan-command.js`（**复用 page-command 的白名单 + 不可变执行 + 原子回退 思路**）
- `utils/usage-native.js`（原生桥接封装，H5/小程序端返回 null 走降级）

新增 services：
- `services/plan-agent.js`（远景规划 & 动态重排的 LLM 调用；复用 `llm.js` / `http.js` / `ai-cache.js`）

---

## 五、AI 链路设计（复用现有资产，不重造）

```
用户输入远景
  → services/plan-agent.js（system prompt 约束输出格式 + 最多 3 次重试）
  → utils/plan-schema.js（op 白名单 / 数值夹取 / 日期合法化）
  → utils/plan-command.js（不可变执行，失败整批回退）
  → Goal/Milestone/Task 落库 → Vue 渲染
```

沿用现有三条纪律：
1. **AI 只产出 JSON，绝不产出可执行代码**（无 eval / new Function / innerHTML）。
2. **失败返回原数据**，不留下半截计划。
3. **先给 diff 预览再落地**（与首页「直接执行」不同，计划是重资产，必须让用户过目）。

首页 AI 指令输入框保留，新增几类「活数据块」给 `app-card-blocks.vue`：
`今日专注分钟` / `目标进度` / `App 时长排行` / `今日任务列表` —— 让首页能被 AI 改成个人看板。

---

## 六、Android 原生能力清单

| 能力 | 实现方式 | 权限 | 缺失降级 |
|---|---|---|---|
| 番茄后台计时 | 前台服务 + 常驻通知 | `FOREGROUND_SERVICE`、`POST_NOTIFICATIONS` | App 内计时（切后台暂停） |
| 统计各 App 前台时长 | `UsageStatsManager` | `PACKAGE_USAGE_STATS`（**用户手动在系统设置开**） | 只用「从本 App 启动」的计时 |
| 拉起其他 App | `getLaunchIntentForPackage` | 无 | — |
| 读取已安装应用列表 | `PackageManager` + `<queries>` | Android 11+ 需声明可见性 | 只显示用户手动添加的 |
| 严格模式切走检测 | UsageStats 轮询最近前台包 | 同上 | 关闭该功能 |
| 结束提醒 | 通知 + 震动 + `sfx.js` | 无 | — |

**合规红线**：
- 使用时长数据 **只存本地**，不上传、不做画像；设置页有「清空时长记录」。
- 权限说明页必须写清楚用途；首次申请前先弹自己的说明弹窗，再跳系统页。
- 不申请 `AccessibilityService`（太敏感，且商店容易拒）。

**uni-app 落地方式**：用 **UTS 插件**（`uni_modules/pwstudy-usage`）写 Android 端，
`utils/usage-native.js` 做条件编译封装，H5 / 微信小程序端直接返回「不支持」。

---

## 七、视觉风格（沿用，不动）

- 主色 `#2E6BFF` / `#1D4FD8` / `#EBF1FF`；ink `#17201A/#5A6560/#98A19B`；bg `#F4F6F4`
- 背景层 `.app-root::before/::after` + `theme.rootStyle()` 下发变量（**别改成不透明**）
- 毛玻璃窗体 `rgba(var(--surface-rgb),α)` + `backdrop-filter: blur(12px) saturate(180%)`
- 卡片发丝边 `#eff2f5` + 极浅投影；英文/数字用 Georgia；字重只 400/500/600
- 番茄钟主界面：大号计时环（纯 CSS conic-gradient，不用 Canvas，理由同打卡折线）
- 专注涨/跌配色按 A 股习惯：学习指数 **涨=红、跌=绿**（与现有打卡一致）

---

## 八、实施阶段（建议顺序）

| 阶段 | 内容 | 产出 |
|---|---|---|
| P0 骨架 | 改名品牌文案、pages.json/tabBar 换血、老功能下沉 pkgLegacy、主题与图标 | 能跑的空壳 App |
| P1 规划 | `goal.js` / `plan.js` / `plan-agent.js` / 目标向导页 / 目标列表页 | 输入远景 → 出计划 |
| P2 专注 | `focus.js` / 番茄钟页 / 任务绑定 / 通知与前台服务 | 能真正计时并计入任务 |
| P3 Dock | `apptime.js` / App 选择与管理页 / UsageStats 插件 / 权限引导 | 能统计学习 App 时长 |
| P4 重排 | `replan.js` / diff 预览页 / 周报 | 计划能随真实进度变 |
| P5 打磨 | 首页活数据卡、统计页、AI 指令扩展、性能与画质档位验证 | 完整体验 |

每个阶段配一个 `_tools/check-*.js`（沿用现有 59 个脚本的写法），守住：
数据字段完整性、AI 输出 schema、原生调用条件编译、页面跳转白名单、主包体积护栏。

---

## 九、待你确认的几个关键点

1. **是否保留背单词功能**？我倾向「下沉为可选的内置学习任务」，而不是删掉。
2. **App 名**：继续用 `PWstudy`，还是起个中文名（如「学迹」「自修」「日课」）？
3. **UsageStats 权限**要不要上？上了统计准，但需要用户在系统设置里手动开一次；
   不上就只有「从本 App 启动」的那段时长。建议：**上，但做成可选**。
4. **AI 规划结果是否强制预览**？我建议强制（计划是重资产），首页卡片那种轻改动才直接执行。
5. **是否需要多目标并行**（同时追 2~3 个目标）？这会影响首页和统计页的信息密度，建议支持。

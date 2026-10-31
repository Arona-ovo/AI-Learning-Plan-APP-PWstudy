# 强制模式「离开就拉回」：失效定位与修复

> 2026-10-14。现象：**开启专注后退出 APP，切到任何别的 App 都没有被拦、没有被拉回，
> 也看不见任何提示** —— 从用户视角看等价于专注功能没做。
>
> 配套：`docs/a11y-trouble.md`（无障碍导致**死机**的应急处置，是另一件事）、
> `uni_modules/pwstudy-focus/utssdk/app-android/index.uts`（原生实现）。

---

## 一、先说结论：这不是一个 bug，是四层各坏一处

排查顺序是"从根到叶"，任何一层不满足，用户看到的结果**完全一样**（毫无反应）：

```
开关开没开 → 包里有没有原生能力 → 前台服务起不起得来
           → 看不看得见你在哪个 App → 拉不拉得动
```

| # | 层 | 坏在哪 | 严重度 |
|---|---|---|---|
| R1 | 产品/接线 | 「开启专注」≠「开启强制」。`settings.focus.forced` 默认 **false**，而它的开关只在**空闲态**的设置卡里；一点"开始专注"卡片就消失，用户根本不知道有这个功能 | **头号** |
| R2 | 原生探测 | `queryForeground()` 用 `queryEvents(now-5s, now)` 做事件配对。事件**只在切换那一刻产生**，用户切走停住 5 秒后窗口内一条事件都没有 → 返回空串 → `tick()` 直接 `return false` | **致命** |
| R3 | 原生探测 | `guardFresh()` 把"90 秒没新事件"当成包名过期。无障碍事件**变化才发**，用户停在微信本来就不会有新事件 → 明明正确的包名被判废弃 | **致命** |
| R4 | 拉回 | `moveTaskToFront` 返回 void，`pullSelf()` 却无条件 `return true` → 遮罩升级条件 `pullTries>=2` 几乎永不满足；且只死磕一条路，ROM 不认就永远拉不动 | 高 |
| R5 | 状态判定 | `tick()` 里 `fg.length == 0` 直接 `return false` —— 把"查不到"当成"合规" | 高 |
| R6 | 保活 | `pushWatch()` 只认模块内的 `active` 记账，前台服务被系统杀掉后 JS 仍以为有人盯着，于是 JS 兜底也让位 → **两头没人管** | 高 |
| R7 | 保活 | 「后台保活」或「通知提醒」任一关掉 → 服务根本起不来，界面却没有任何提示 | 中 |

R2 + R3 叠加是最阴的一处：两条探测路**同时**失灵，于是"拉回失败一次，之后永远不再拉"。

---

## 二、修复改动点

### 1. 探测层（R2 / R3 / R5）—— `index.uts`

- **新增 `queryForegroundByUsage()`**：改用 `queryUsageStats(INTERVAL_BEST, now-60s, now)`，
  取 `getLastTimeUsed()` 最大的包。它返回的是"这段时间用过哪些 App、最后一次用是什么时候"，
  **跟切没切换无关** —— 用户一直停在微信，微信就一直是最大的那个。
  ⚠️ 别改回 `queryEvents`：那就是 R2 本身。
- **`guardFresh()` 不再看时间**：只看"护卫在线 + 报过包名"。
- **新增 `guardStale()`**：静默超过 `GUARD_FRESH_SEC` 只触发"拿 UsageStats 交叉验证"，
  **不再触发丢弃**（这是 R3 的修法，常量名保留、语义变了）。
- **新增 `blindTicks` + `BLIND_MAX_TICKS`**：查不到前台时不再 `return false`，
  而是维持已有的逃逸状态继续重试（人还在别的 App 里，只是我们暂时看不清），
  连续失明 20 次才撤遮罩收手。

### 2. 拉回层（R4）—— `index.uts`

- `pullSelf(round)` 拆成 `pullByTask()` / `pullByLaunch()` 两条，**按 round 奇偶轮换**。
  有的 ROM 只认其中一条，死磕一条 = 永远拉不动。
- 遮罩升级判据从 `pullSelf()` 的返回值改成**再看一眼前台**：新增 `needOverlay()`，
  前台确实还是别人才盖（避免拉回已成功时把遮罩盖在自己 App 上闪一下）。

### 3. 保活层（R6 / R7）

- 原生新增 `serviceAlive()`（判据 `svcRef != null`：`onCreate` 赋值、`onDestroy` 清空；
  服务被杀时进程一起没了，新进程里自然是 null，不需要问 `getRunningServices`，
  那个 API 26 起对三方应用就关了）。
- `fgsvc.js`：新增 `serviceAlive()` / `ensureStarted()` / `serviceAllowed()`
  （后者由原私有 `allowed()` 改名导出）。
- `forced.js`：`nativeActive()` 增加 `fgsvc.serviceAlive()`；`pushConfig()` 里先
  `ensureStarted()` 自愈再下发。
- `capability()` 新增 `svc`（现在活着吗）与 `svcAllowed`（设置层让不让起），
  `effective` 改为要求 `svcAllowed` 也成立。

### 4. 产品闭环（R1）—— `pkgPlan/pages/focus/focus.vue`

- **专注中状态条常驻**（原条件是 `forcedOn && active`，开关关着就整行消失）。
  现在三态：`fs-off`（没开，灰）/ `fs-weak`（开了但能力不全，琥珀）/ 就绪（红），
  右侧给最短的那条路（开启 / 去开 / 去授权）。
- **首次开始专注时主动问一次**（`maybeAskForced()` → `askForced()`），
  选什么都记进 `settings.focus.forcedAsked`，不重复烦人。
- **开启后按"无障碍 → 使用情况访问 → 悬浮窗"顺序给路**（`guideNextStep()`），
  原来只 toast 一句"建议开无障碍"，用户看完还是不知道去哪开。
- **自动兜住载体**（`ensureServiceSetting()`）：强制模式依赖前台服务，
  「后台保活」/「通知提醒」关着就直接帮打开并说明原因，不弹"请去设置里打开"这种空提示。
- 能力盘点新增 `forceCap`，状态条 / 引导 / 补全路径**共读一份** ——
  各算一套必然分叉，分叉的表现就是"界面说已就绪，实际根本拉不动"。

---

## 二·补 响应速度：从 3~4 秒到 0.5 秒内（2026-10-31）

> 用户反馈原话：「开启专注以后它的强制拦截还是不够快……退出应用或者到其他应用，
> 系统拉回的弹窗需要等待 3 到 4 秒，有点慢。」
>
> 注意这是**第二轮**速度优化：第一轮（10-24）已经把 `ESC_TICKS` 和轮询节奏压过一轮，
> 所以这次不是"哪一项没做"，而是**链路上还留着四处整拍白等**，叠起来正好 3~4 秒。

### 延迟怎么攒出来的

| # | 位置 | 原来 | 白等多少 |
|---|---|---|---|
| L1 | `seen()` 首拍也过 `PULL_GAP_SEC`，且差值是 `nowSec()`（取整到秒） | 2 秒 | **0~3 秒**，整次逃逸被静默吞掉 |
| L2 | `setWatch()` 里 `lastPullSec = nowSec()` | 预置成当前时刻 | 刚开始专注就切走，再多等一轮 L1 |
| L3 | `INTERCEPT_GRACE_SEC` 静态灰期（拦不到时屏幕上什么都没有） | 2 秒 | 2 秒 |
| L4 | `WatchLoop` 正常态 | 600ms 一拍 | 0~0.6 秒 |
| L5 | `postPullNotify()` 排在 `pullSelf()` **之前**（build + notify + 可能建渠道） | — | 几十毫秒 |
| L6 | 无障碍 `notificationTimeout` | 100ms | 至多 100ms |
| L7 | 拦截页倒计时 | 3 秒 | 1 秒（感知） |

L1+L2 是最阴的：条件是"距上次拉回不足 2 秒"，而**"刚开始专注 → 立刻切走试试灵不灵"
恰好永远满足**（`lastPullSec` 刚被预置）。用户最容易做的那次验证，正好被节流吃掉。

### 改法（都在 `index.uts`）

1. **首拍零节流**：新的一次逃逸（`!inEpisode`）直接拉，不看任何闸门。同一次逃逸里的
   重复拉才节流。
2. **节流下沉到毫秒级**：新增 `pullGateOpen` 旗标 —— 拉一次关 1800ms，用
   `postDelayed` 打开。秒级常量 `PULL_GAP_SEC` 降到 1，只当兜底。
   1800ms 是**刻意不比旧值更快**：重复拉基本是无效功（拦截页已在倒计时），
   而"要不要盖遮罩"那条路（`needOverlay`）不受这个闸门限制，每拍都在跑。
   ⚠️ 不用时间戳做差：`System.currentTimeMillis()` 进 UTS 是 Number，与 Int 字面量
   在生成的 Kotlin 里没有 `compareTo`，云打包编不过（见 `nowSec()` 注释）。
3. **`setWatch()` 不再预置 `lastPullSec`**（置 0）。
4. **灰期 2 秒 → 420ms + 到点踢看门狗**：`interceptGrace` 旗标 + `GraceKickTask`
   （`postDelayed` 420ms）。窗口内不重复拉也不盖遮罩；窗口一结束立刻 `kickWanted = true`，
   遮罩在该拍就盖上，而不是等下一轮自然到来。
5. **看门狗节奏 600/300 → 200/100ms**，`BLIND_MAX_TICKS` 同步 50 → 150（仍是 30 秒）。
   代价守在"护卫新鲜时纯内存判断"上：`tick()` 只读 `guardPkg`，不查 UsageStats。
6. **UsageStats 加 1 秒结果缓存**（`usageCachePkg/At`）：节奏压到 200ms 后，
   每一跳都跨 system_server 查聚合库是白烧电，而那条路精度本来就是分钟级。
7. **通知挪到 `pullSelf()` 之后**。
8. **无障碍 `notificationTimeout` 100 → 30**（xml 与 `buildGuardInfo()` 两处同值）。
9. **拦截页倒计时 3 → 2 秒**（`PULL_INTERCEPT_SEC`），文案自动跟着变。

### 改完的预期时间线

```
t=0      按 HOME / 切到别的 App
t≈0~30   系统派发 windowStateChanged（notificationTimeout 30ms）
t≈30     onAccessibilityEvent → seen(fromEvent) → 首拍零节流 → pullSelf
t≈50~150 PWPullActivity 起来（黑屏 + "2 秒后自动回到计时"）
t≈150    遮罩接管窗口开 420ms；若拦截页被 ROM 拦掉 → 420ms 后遮罩盖上
t≈2.0s   拦截页倒计时到点 → moveTaskToFront 回专注页（计时状态原样）
```

即"切走 → 屏幕被占住"≤ 0.5 秒（原来 3~4 秒），"切走 → 回到计时页"约 2 秒。

### 怎么验

真机（云打包 APK）：
1. 开始专注 → **马上**按 HOME —— 这是原来看起来最慢的一步，现在应"桌面几乎没露脸"。
2. 反复切走 3 次以上，确认每次都是首拍就动（不再有"第一次快、第二次慢"）。
3. 关掉悬浮窗权限再试：拦截页起不来时，420ms 后应看到遮罩（而不是等 2 秒）。
4. 看 `watchDiag()` 的 `pulls` 计数：连续切走时它应该几乎 1:1 增长。
5. 无无障碍、只开「使用情况访问」时，最坏延迟约 1 秒（UsageStats 缓存上限），属预期。

静态：
```bash
node _tools/uts-to-kotlin.js    # 类型坑（改了 uts 必跑，几秒出结果）
node _tools/check-uts.js
node _tools/check-forced.js
node _tools/_scratch/neg-forced.js
```

⚠️ 动了 `uni_modules/**/utssdk/**` 必须重新云打包 —— wgt 包不住 UTS。

---

## 三、状态管理、白名单、退出策略

### 状态管理

| 状态 | 存在哪 | 谁写 | 谁读 |
|---|---|---|---|
| 强制模式开关 | `settings.focus.forced` | 专注页 `toggleForced()` | `forced.enabled()` |
| "问过了" | `settings.focus.forcedAsked` | `markForcedAsked()` | `maybeAskForced()` |
| 看门狗配置 | 原生 `PWFocusService` 字段 | `forced.pushConfig()` → Intent | 看门狗线程 |
| 看门狗到点 | 原生 `watchUntilSec` | 下发时算（剩余秒 +5） | `tick()` 自己掐表 |
| 逃逸/拉回战绩 | 原生 `watchEscapeCount` / `watchPullCount` | `seen()` | `forced.mergeNative()` |
| 服务活着吗 | 原生 `svcRef` | `onCreate` / `onDestroy` | `fgsvc.serviceAlive()` |
| 保险丝 | SharedPreferences `pw_a11y` | `bumpBind()` / `clearBind()` | `a11ySafe()` |

**生效三条件**（`forced.sync()`）：设置里开了强制模式 **且** 正在 focus 阶段 **且** 没暂停。
休息阶段不拦。

### 白名单（放行 = 不算跑偏）

`apptime.allowList()` 三块，原生侧再补两道：

1. 本 App 自己
2. `NEUTRAL` 中性包：桌面（国产 ROM 列全）、系统界面、设置、电话、安装器、输入法
3. dock 里 `purpose !== 'rest'` 的 App

原生 `setWatch` 再补：
- `homePackage()` —— 直接问系统"谁是 Home"，第三方桌面（Nova 之类）也能认出来。
  遮罩盖全屏，桌面被判成跑偏的话用户按 Home 之后连桌面都点不动。
- `imePackages()` —— 系统实际启用的输入法。用户每打一个字都被拉回就是漏了这个。

### 主动退出 / 紧急退出

| 场景 | 处理 |
|---|---|
| 专注跑完 / 放弃 | `focus.giveUp()` → `forced.sync()` → `fgsvc.setWatch({on:false})`，撤遮罩撤通知停线程 |
| 暂停 | `focus.pause()` → `pauseWatch()`，看门狗收手；恢复时重推（endAt 变了必须重推） |
| 连续逃逸 3 次 | `breakNow()`：本次专注作废，按中断记账（满 1 分钟才落账） |
| 返回键 | `onBackPress`：强制模式 + 正在专注 + 没暂停 → 不放行；暂停/休息照常放行 |
| 用户想硬退 | 只能先暂停再退。**故意不做"紧急出口"**：有出口的话强制模式等于没有 |
| 拉回真的卡住 | `OVERLAY_MAX_TRIES = 24`（1.8 秒一次，约 45 秒）后自动撤遮罩，不会把人锁在屏幕外 |
| 无障碍导致死机 | 保险丝：60 秒内被 bind 超过 2 次 → 服务变空壳；界面给「再试一次」。详见 `docs/a11y-trouble.md` |

---

## 四、验证路径（照着做一遍）

前置：云打包 APK（标准基座没有 UTS 原生代码，整条链会静默降级）。

```
① 开权限
   设置/专注页 → 开「强制模式」→ 弹窗点「去开无障碍」
   → 系统无障碍页找「PWstudy 专注护卫」打开
   （安卓 13+ 侧载安装：应用信息 → 右上角 ⋮ → 允许受限设置，列表里才勾得上）
   可选：再授「显示在其他应用上层」做遮罩兜底

② 看状态条（这一步就能提前发现 90% 的问题）
   开始专注 → 状态条应显示「已就绪 · 离开立刻拉回」
   显示别的字（灰的"离开不会被拉回" / 琥珀的"看不出你在哪个 App"）
   → 点状态条，它会自动指出下一步

③ 切走
   按 Home 或切到微信，停在那儿别动
   （旧版"停 5 秒以后"会彻底失明，所以要**停够时间**再判断；现在也要停一会儿，
    确认不是"只拦了切走那一下"）

④ 确认被拉回
   预期：**0.5 秒内**屏幕就被拦截页 / 遮罩占住（2026-10-31 之前是 3~4 秒），
   拦截页 2 秒倒数后自动回到计时页

⑤ 确认状态不丢
   回来后倒计时继续走、没有从头开始、没有变成"准备开始"
   （拉回走 REORDER_TO_FRONT + SINGLE_TOP，不重建 Activity）

⑥ 战绩
   状态条显示「已拉回 N 次」；连续强行离开 3 次 → 本次专注作废

⑦ 收手
   专注结束 / 放弃 / 暂停 → 遮罩与拉回通知立刻消失，不再拦人
```

抓日志定位用：

```bash
adb logcat -d > d:\logcat.txt
# 看 AndroidRuntime / AccessibilityManagerService / am_proc_died
adb shell dumpsys accessibility | grep -A3 pwstudy     # 服务在不在系统列表里
aapt2 dump resources <your.apk> | grep -i pw_accessibility   # res/xml 打进去了没
```

---

## 五、回归要点

| 项 | 怎么验 |
|---|---|
| 探测不再失明 | 切到别的应用**停 10 秒以上**，仍会被拉回（这是本次修的核心） |
| 首拍就动（2026-10-31） | 开始专注后**立刻**切走 → 0.5 秒内被占屏；连切三次都要一样快 |
| 节流还在 | 连点遮罩 / 连续逃逸不要出现"反复 startActivity 打架"（看门狗一拍最多拉一次） |
| 灰期收敛 | 关掉悬浮窗 → 拦截页起不来 → 420ms 后遮罩盖上，不留 2 秒全裸窗口 |
| 遮罩不误盖 | 拉回成功后自己 App 上不会闪一下黑（靠 `needOverlay()` 再看一眼前台） |
| 两条拉回路轮换 | 在只认 `startActivity` 的 ROM 上也能拉回（靠 `pullSelf(round)` 轮换） |
| 服务自愈 | 前台服务被杀后（开发者选项"不保留活动"可模拟）下一个对账周期能自己起来 |
| 载体冲突 | 关掉「后台保活」再开强制模式 → 自动帮你打开并说明原因 |
| 状态条三态 | 没开（灰）/ 开了但缺权限（琥珀）/ 就绪（红），文案与能力一致 |
| 只问一次 | 选"这次不用"之后，下一轮专注不再弹 |
| 编译 | `node _tools/uts-to-kotlin.js`（本地转 Kotlin 扫类型坑，几秒出结果，别傻等云打包） |
| 静态护栏 | `node _tools/check-uts.js` / `_tools/check-vue.js` / `_tools/check-pwstudy.js` / `_tools/_scratch/run-all.js` |

⚠️ **改了 `uni_modules/**/utssdk/**` 必须重新云打包 APK** —— wgt 包不住 UTS
（wgt 里那份 `src/index.kt` 只是产物拷贝，运行时用的是编译进基座的那份）。

---

## 六、还没做的

- 无障碍服务被系统回收后没有"重新拉起"的手段（只能靠系统在下次窗口变化时重 bind）。
- 「使用情况访问」这条路仍有分钟级聚合误差，只能当无障碍的退路。
- 保险丝跳闸后（这台机子起不来）只能退到"提醒"，不会硬拦 —— 这是刻意的安全让步。

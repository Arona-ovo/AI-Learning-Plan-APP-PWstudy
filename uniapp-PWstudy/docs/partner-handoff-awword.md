# 交接给 AWword（背单词 App）侧：PWstudy ↔ AWword 联动对接说明

> 本文自包含，可直接整篇转给负责 AWword 的 AI。
> 设计全文（含取舍理由）见 PWstudy 仓库 `uniapp-PWstudy/docs/partner-link.md`。
> 协议为**双端分别发布**，请按"加字段只能加可选"的规矩改。

---

## 1. 背景与定位（先对齐，不然会做歪）

两边是同源 uni-app + Vue3 工程（appid 相同，都是 `__UNI__53285BF`），现在是两个独立 App、两个图标。

分工：

- **PWstudy** = 番茄钟 + AI 学习规划 + 学习 App 用时统计 + 动态重排
- **AWword** = 背单词（记忆曲线复习、三关练习、词书）

联动的定位一句话：

> **AWword 不是 PWstudy 内置的背单词模块，PWstudy 也不是用户唯一的背单词入口。**
> 「关联」只是用户的一份**本地意愿**：关联了就互相跳转并交换数据；
> 不关联时两个 App 各自功能一条都不少。

因此**硬要求**（这是用户明确提的，不可打折）：

- ✅ 可跳过（首次提示有「以后再说」）
- ✅ 可关闭（有「不用了」，选了就永不再自动弹）
- ✅ 设置页有常驻入口，随时能重新添加 / 取消 / 恢复
- ❌ 不做强制、不做独占、不绑架流程、不阻断用户继续用别的背单词方式

---

## 2. 当前状态（截至 2026-10-12，两边都已推送）

### 2.1 AWword 侧已完成 ✅

| 项 | 状态 |
|---|---|
| `manifest.json` 声明 `"schemes": ["awword"]` | ✅ |
| `utils/link.js`（parse / mergeQuery / openUrl / hasCtx / getCtx / clearCtx / consume / elapsedMin / finish） | ✅ |
| `App.vue` 接 `plus.runtime.arguments` + `newintent` → `link.consume()` | ✅ |
| `pkgStudy/pages/practice/practice.vue` 的来路横幅 + `backToPartner()` + `onUnload` 自动回跳 | ✅ |
| 回传 `min` 用真实停留时长、`words` 用 `correctCount` | ✅ |
| `_tools/check-link.js` 契约护栏 | ✅ |

这一层**不用动**，下面的需求是在它之上加"用户意愿"这一层。

### 2.2 PWstudy 侧已完成 ✅

| 项 | 文件 |
|---|---|
| 双向协议 `parse/handle/toPartner/openPartner/recordExternal` | `utils/link.js` |
| `pwstudy://` scheme 声明 + App.vue 的 newintent 接线 | `manifest.json` / `App.vue` |
| 词数按天落账 `addVocabWords()` / `vocabWords()` | `utils/pwstore.js` |
| 关联状态机 + 防骚扰 | `utils/partner.js`（新增） |
| 状态落库 `settings.partner` | `utils/settings.js` |
| 首次询问（三选一） | `pages/home/home.vue` |
| 设置页常驻入口（四态四动作） | `pkgManage/pages/settings/settings.vue` |
| 契约护栏 40 条断言 | `_tools/check-partner.js`（新增） |

---

## 3. PWstudy 侧的需求（请 AWword 配合）

> **必须** 6 条：11.1 / 11.2 / 11.3 / 11.6 / 11.7 / 11.8
> **增强** 2 条：11.4 / 11.5

### 11.1 【必须】固定并告知 Android 包名

PWstudy 靠包名检测 AWword 是否已安装：

```js
plus.runtime.isApplicationExist({ pname: 'com.AWword' })
```

2026-10-12 已从 AWword 的 debug APK 的 AndroidManifest 里读到真包名并确认：**`com.AWword`**（发布后不再改）。
⚠️ **一旦发布就不要再改** —— 包名变了，老用户本地存的关联状态会全部失效（检测不到 = 变回"未安装"）。

### 11.2 【必须】若 `targetSdk >= 30`，manifest 必须补 `<queries>`

Android 11（API 30）起有包可见性限制：`targetSdk >= 30` 的应用默认**看不到**其它已安装应用，
`isApplicationExist` 会一律返回 false。必须在 manifest 里声明：

```xml
<queries>
  <package android:name="com.PWstudy" />
</queries>
```

（PWstudy 侧 `targetSdk = 28`，当前不受限，但建议也补上，免得将来升级踩坑。）

### 11.3 【必须】保持 scheme 与协议字段

已完成部分：

- `awword://study?minutes=&v=&linked=&task=&back=` 的解析
- 回跳 `pwstudy://vocab-done?min=&words=&task=`

⚠️ **字段改名请提前说**。两端分别发布，改名会造成"新 PWstudy + 旧 AWword"期间的
**静默失效**：不报错、不崩，就是数据没了。

### 11.6 【必须】对称的首次询问

用户需求原文是"安装并打开**其中任一 App**"时都要问，所以 AWword 侧也要有同一套：

**检测**

```js
plus.runtime.isApplicationExist({ pname: 'com.PWstudy' })
```

**五个条件缺一不可**（照抄 PWstudy `utils/partner.js` 的 `shouldAsk()`）

| # | 条件 | 值 |
|---|---|---|
| 1 | 对方已安装 | `installed === true` |
| 2 | 状态仍是未决定 | `state === 'undecided'` |
| 3 | 没问够次数 | `askedCount < 3` |
| 4 | 距上次够久 | `now - lastAskAt >= 2 天` |
| 5 | **当前不在练习中** | `!focusing` |

第 5 条是硬规矩：一个可选增强不配打断一次学习会话。

**弹窗**（三选一菜单）

> **要和 PWstudy 打通吗？**
>
> 检测到这台设备上装了 PWstudy（番茄钟 · 学习规划）。打通之后：学完这一组自动把时长和词数记回它今天的统计里，也方便它帮你排后面的任务。
>
> 不打通也不影响背单词 —— 这一组该怎么背还怎么背。

| 选项 | 落点 | 后续 |
|---|---|---|
| **打通（推荐）** | `state: 'linked'` | 设置页显示"已关联" |
| **以后再说** | `askedCount += 1` | 还能再问，累计 3 次后自动闭嘴 |
| **不用了，我就专心背** | `state: 'declined'` | **永不再自动弹** |

**两个实现细节**

1. **弹之前先记账**（`markAsked()`）—— 否则用户关掉弹窗、切走再回来会立刻再弹一次
2. **弹窗要延迟 1.2 秒** —— 首页刚渲染完就糊一张卡片上来，用户还没看清自己在哪
3. **已有其他弹窗时让路** —— 权限引导优先，别互相覆盖

**状态存储**（各自存各自的，不需要同步）

```js
partner: {
  v: 1,                 // 协议版本
  state: 'undecided',   // undecided（未决定）/ linked（已关联）/ declined（已关闭）
  askedCount: 0,        // 已自动询问过几次
  lastAskAt: 0,         // 上次询问时间戳
  linkedAt: 0,          // 关联时间
  lastSyncAt: 0,        // 上次真正收到数据的时间
  lastWords: 0          // 上次同步到的词数
}
```

⚠️ 三条重要判定：
- `unlink()`（取消关联）**必须落 `declined`，不许退回 `undecided`** —— 否则下次启动又会重新问一遍，用户刚明确取消、转头又被问，最招人烦
- 取消关联**不许删任何数据**（见 5.3）
- **两边意愿各自存**，刻意不做"双方都同意才生效"——否则任一侧卸载重装/清数据，另一侧就成了谁也解不开的死结

### 11.7 【必须】对称的设置入口

AWword 设置页放一栏「关联 PWstudy」，**四种展示形态**：

| 形态 | 判据 | 标题 | 说明文案 | 可用动作 |
|---|---|---|---|---|
| 未安装 | `!installed` | 未检测到 PWstudy | 装上之后再回到这一页，关联入口会自动出现 | 重新检测 |
| 未决定 | `undecided` | 尚未关联 | 设备上检测到 PWstudy，要不要打通？ | 关联 · 不用了 |
| 已关联 | `linked` | 已关联 | 今天 25 分钟 · 30 词 · 3 分钟前同步 | 去专注 · 取消关联 |
| 已关闭 | `declined` | 已关闭 | 之前选过不用这个功能，随时可以重新打开 | 重新关联 |

流程要点：

- 顶部常驻一行说明块（标签「可选」+ 一句解释），**视觉做轻** —— 它的作用是降低决策压力，不是第二个任务
- 已关联时**必须显示「上次同步多久之前」**。只写"已关联"的话，通道断了用户根本发现不了（他会以为"今天没背"）
- 未安装时**一个按钮都不给**，只留"重新检测"；给了也是点了没反应
- 每次进页面都重新查系统（可能刚在后台装完/卸掉）
- 主按钮用 tint 模式（淡色底 + 深色字 + 描边），不要大块实心色

### 11.8 【必须】已关闭时怎么对待 `back`

PWstudy 跳转时会带 `linked=0|1`，建议规则：

| linked | AWword 的行为 |
|---|---|
| `1` | 顶部显示来路横幅「从 PWstudy 过来」，学完**自动**带 `min`/`words` 回跳 |
| `0` | 横幅降级为一行提示 + 一个「回去」按钮，**不自动跳**（用户点了才回） |
| 无此参数 | 按 `1` 处理（兼容旧版 PWstudy） |

⚠️ `linked=0` 时**仍然要让用户回得去** —— 用户是点了 PWstudy 里的入口才过来的，
学完回不去跟绑架没区别。区别只在于"自动"还是"手动"。

---

### 11.4 【增强】回跳时补扩展字段

现有回跳：

```
pwstudy://vocab-done?min=<真实分钟>&words=<correctCount>&task=<taskId>
```

建议按性价比排序补充（**全部可选**，老版本忽略即可）：

| 字段 | 含义 | 优先级 | 用途 |
|---|---|---|---|
| `due` | 当前待复习（到期）的词数 | **最高** | PWstudy 的「今日紧迫度」卡会用 —— 这是联动唯一能产出额外价值的数据点 |
| `streak` | 连续打卡天数 | 高 | 首页汇报 / 重排时的士气信号 |
| `todayWords` | 今天累计背了多少词 | 中 | 避免重复计算 |
| `book` | 当前词书 id | 低 | 任务命名 |

⚠️ 再次强调：**字段只能加、不能改名；未知字段一律忽略，不许因为多一个字段就把整条链接判死。**

### 11.5 【增强】反向入口 `awword://sync`

目前数据流是单向的（PWstudy → AWword → 回跳）。建议 AWword 也提供反向入口：
用户在 AWword 学完一批后点「同步到 PWstudy」，跳一次把 `todayWords / streak / due` 带过去。

⚠️ **必须是用户主动触发**，不要在 AWword 里自动跳到 PWstudy —— 那会把人从学习状态里拽出来。

---

## 4. 完整协议规范

### 4.1 方向一：PWstudy → AWword（去学）

```
awword://study?minutes=<建议时长>&v=1&linked=<0|1>&task=<任务id>&back=<urlencoded 回跳地址>
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `minutes` | 是 | 建议时长（分钟）。**保持在第一个参数位**，老版本解析器依赖它 |
| `v` | 否 | 协议版本，当前 `1` |
| `linked` | 否 | PWstudy 当前是否已关联：`1` / `0` |
| `task` | 否 | PWstudy 的任务 id，回跳时原样带回用于对账 |
| `back` | 是 | 回跳地址，做了 urlencode |

`back` 的实际内容：

```
pwstudy://vocab-done?min=<minutes>&task=<taskId>
```

### 4.2 方向二：AWword → PWstudy（学完回来）

```
pwstudy://vocab-done?min=<真实停留分钟>&words=<correctCount>&task=<taskId>
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `min` | 是 | **真实停留时长**（分钟，整数）。⚠️ **不能**把对方给的 `minutes` 建议值转手还回去 |
| `words` | 否 | 本次学会的词数。用 `correctCount`（确认通过 = 真学会），**不用** `answerCount`（做过几道题） |
| `task` | 否 | 去程带的任务 id |

### 4.3 通用字段规则

- 字段名一律小写
- 时间统一**分钟**
- id 用各自 App 自己的
- **任何一端加字段都只能加可选的**
- 未知字段一律忽略，不做校验
- 任一侧不认识对方的新版本时，**按旧版本处理，绝不报错、绝不静默丢弃整条链接**

### 4.4 端点

- PWstudy scheme：`pwstudy`
- AWword scheme：`awword`
- PWstudy 包名：**`com.PWstudy`**（2026-10-12 用 `aapt2 dump badging` 从实际 APK 读出）
- AWword 包名：`com.AWword`（**已确认**，2026-10-12）

⚠️ **以 APK 实测为准，不要照抄 manifest.json 里的字面值。**
PWstudy 的 `manifest.json` 里曾写成 `"packageName": "com.PWstudy"`（驼峰 N），
但 uni-app 的规范字段是全小写的 `"packagename"` —— 驼峰那行**不生效**，
打出来的其实是 DCloud 默认包名 `com.PWstudy`(= `com.` + App 名)。
已按"保持现状"处理：manifest 改成全小写字段、值固定为 `com.PWstudy`，与实测一致。
**如果哪天要改包名，两边文档和 `<queries>` 必须同一天改**，否则检测静默失效。

---

## 5. 数据落账口径（PWstudy 侧已实现，AWword 只需给对值）

### 5.1 时长

`min` → `daily[date].byApp['app:awword']`

**与 AppDock 同一张表**。这样：

- 首页「今日学习 App 用时」那张卡直接可见
- 统计页「学习 App 用时」那张表直接可见
- 不会出现两套数字

⚠️ **不许再另记一份 external 总账** —— 同一笔时长记两处，早晚对不上，而且没人读第二份。

### 5.2 词数

`words` → `daily[date].vocabWords`（按天累加）

为什么必须回传：**UsageStats 只测得到"你在那个 App 待了多久"，测不到你过了几个词。**
为什么按天记：记成全局累计就永远答不出"今天背了多少"。

### 5.3 取消关联时的数据

**只改意愿，不碰任何已记录的数据。**

`daily` 里那些时长与词数是真实发生过的学习，不能因为用户取消了一个关联就被抹掉。
（`partner.js` 刻意**不引入** `pwreset` —— 清数据的唯一入口；并有断言把这条钉死。）

---

## 6. 已知坑（省得你再踩一遍）

### 6.1 这套联动失效是**完全静默**的

四种情况都不报错、不崩、界面照常，只是功能没了：

1. manifest 少了 `schemes` → 对方回跳被系统丢掉
2. 没接 `newintent` → 冷启动能收，App 在后台时再被唤起就收不到
3. 字段名改了 → 双端分别发布期间静默失效
4. 少了 ctx 短路 → 用户自己点开 App 时行为异常

**所以两端各有一道 `_tools/check-link.js` 静态钉契约**，建议你加字段后跑一遍。

### 6.2 平台

- URL scheme 检测安装、跳转**只在 App 端有效**。H5 / 小程序没有"检测已安装应用"这回事，一律返回 false
- 所有联动代码要包在 `// #ifdef APP-PLUS` 里

### 6.3 Android 版本

- 包可见性（11.2）只对 `targetSdk >= 30` 生效
- 如果 AWword 的 `targetSdk` 低于 30 就不用管，但**升上去那天必须补**

### 6.4 沙箱

两个 APK 的本地存储**互相看不见**。不能共享数据库、不能共享文件，只能靠跳转参数传快照。
所以设计上只传**聚合值**（几分钟、几个词），不传明细。

---

## 7. 验收清单（真机，两个 App 都要重新打包）

**PWstudy 侧**

- [ ] 只装 PWstudy：设置页显示"未检测到"，无弹窗，功能全在
- [ ] 装上 AWword 后首次打开 PWstudy：弹三选一弹窗
- [ ] 点「打通」：设置页变"已关联"
- [ ] 点「以后再说」：退出再进不重复弹；累计 3 次后不再自动弹
- [ ] 点「不用了」：永不再弹，设置页显示"已关闭"
- [ ] 设置页「取消关联」：有二次确认，文案说明数据保留
- [ ] 取消后：不再跳转、不再提示，今日统计里已有数据仍在
- [ ] 取消后「重新关联」：恢复，且能看到上次同步时间
- [ ] **专注中不弹窗**：番茄跑着的时候进首页，不应出现任何关联提示

**AWword 侧（待实现）**

- [ ] 只装 AWword 不装 PWstudy：一切正常，联动完全不可见
- [ ] 装上 PWstudy 后首次打开 AWword：弹三选一弹窗
- [ ] 从 PWstudy 跳过来：顶部出现来路横幅
- [ ] `linked=1`：学完自动回跳并带上 `min` / `words`
- [ ] `linked=0`：不自动跳，但横幅上的「回去」按钮能用
- [ ] 设置页四态显示正确，取消/恢复都生效
- [ ] **练习中不弹窗**

**端到端**

- [ ] 跳过去学完回来：PWstudy 统计页出现「背单词 N 分 · M 词」
- [ ] 回到 PWstudy 设置页：能看到"上次同步 X 分钟前"

---

## 8. 如果需要参考实现

PWstudy 侧这些文件可直接对照：

- `uniapp-PWstudy/utils/partner.js` —— 状态机 + 防骚扰（约 150 行，可整体平移）
- `uniapp-PWstudy/utils/link.js` —— 协议收发
- `uniapp-PWstudy/pages/home/home.vue` 的 `maybePartnerAsk()` —— 首次询问的触发与分支
- `uniapp-PWstudy/pkgManage/pages/settings/settings.vue` 的「伙伴 App」胶囊 —— 四态四动作
- `_tools/check-partner.js` —— 40 条契约断言，可直接改名复用

AWword 侧只需把 `PARTNERS.awword` 换成 `PARTNERS.pwstudy`（`pkg: 'com.PWstudy'`、`scheme: 'pwstudy'`），
其余逻辑对称。

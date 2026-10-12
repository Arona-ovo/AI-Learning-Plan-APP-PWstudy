# 横向对比 AWword（同一套模板）：值得借鉴的点

> 2026-10-12 实读两边代码后的结论。
> AWword 仓库：`git@github.com:Arona-ovo/Study-word-APP-AWword.git`，
> 本地 `C:/Users/33156/WorkBuddy/2026-10-06-17-27-44`。
> 两边同源（appid 都是 `__UNI__53285BF`），`home-layout.ts` 几乎逐行相同（132 / 135 行）。

---

## 0. 先纠一个错

之前的项目记忆把这条记成了 PWstudy 的能力，**是错的**：

> ~~AI 指令链：`intent.js` → `page-agent.js` → `page-schema.js`(19 op) → `page-command.js` → pageDoc~~

**PWstudy 一个都没有。** `intent.js` / `page-schema.js` / `page-command.js` /
`page-doc.js` / `card-spec.js` / `card-canvas.vue` / `app-card-blocks.vue` **全在 AWword 侧**。
PWstudy 的 `components/` 只有 5 个：app-dialog、coach-box、float-navbar、float-tabbar、urgency-meter。

唯一残留是 `services/image-gen.js` 注释里那句"生成的图同样走 pageDoc"——过时注释，描述的
是不存在的东西。已更正项目记忆。

---

## 1. 两边的能力差集

| | AWword 独有 | PWstudy 独有 |
|---|---|---|
| 界面 | `card-spec.js`(761 行) + `card-canvas.vue` + `app-card-blocks.vue`（13 种块）<br>`intent` / `page-schema` / `page-command` / `page-doc`（AI 指令链）<br>`onboarding.js` + `onboarding-mask.vue` | 番茄钟全套 `focus` `strict` `forced` `fgsvc` `pacing`<br>用时统计 `apptime` `usage`<br>规划重排 `plan-task` `dailylog` `coach` `urgency` |
| 工程 | `backup-io.js`、`chat-store.js` | `ambient` `mascot` `notify` `setup` `holiday` `insets` `task-guide` |
| 领域 | `dict` `engine` `iplus1` `judge` `srs` `store` `wordbook` `quiz-plan` `search` …（背单词专属） | — |

一句话：**AWword 强在"AI 造界面"，PWstudy 强在"番茄钟 + 用时统计 + 规划"。**
`home-layout.ts` 两边几乎一样 —— 差别只在 UI 有没有接。

---

## 2. 重点①：首页卡片编辑（用户点名的这块）

**AWword 有完整实现，PWstudy 数据层齐、只缺 UI。** 这是最值得搬的一块。

### 2.1 AWword 的实现，九个值得照抄的细节

1. **编辑态把手**：每张卡顶部加一条 `.mod-bar`（三条线 grip + 模块名 + 「收纳」），
   只在 `editing` 时出现。
2. **编辑态遮罩 `.mod-shield`**：盖住卡片本体，**屏蔽卡内点击** ——
   否则拖的时候会误触卡里的按钮（换词书、主按钮、小组件链接）。
3. **拖拽是纯函数**：`createSelectorQuery().selectAll('.mod-wrap')` 量出各模块真实高度，
   再喂给 `homeLayout.dropIndex(from, dy, heights)`。这个函数**不碰 DOM、可单测**，
   页面只负责把 `touchmove` 的位移喂进来。
4. **触摸 + 鼠标两条路共用一个入口**：`beginDrag(i, clientY)`；
   鼠标路径（H5 桌面）用 `document.addEventListener` 补，**App 端没有 document 自动跳过**。
5. **收纳区不单独存**：`stashed = 所有模块 − 当前布局`。避免两份状态对不上。
   （PWstudy 的 home-layout 里也有同样注释，这部分是两边一致的。）
6. **至少保留一个组件**的保护，收最后一个时给 toast 拦住。
7. **内置卡只能收纳、不可删除**（永远能加回来）；AI 卡可彻底删除，但**先确认**。
8. **离开首页自动退出编辑态**，保证回来时界面是简洁的。
9. **返回键顺序**：抽屉 → 编辑 → 搜索（按覆盖层级从内到外）。

两个小但关键的手感细节：
- 把手区加 `touch-action: none` —— 拖动时页面不会跟着滚；`cursor: grab / grabbing`
- 底部操作行**非编辑态只留一个「编辑首页」入口**，保持简洁

### 2.2 PWstudy 移植的唯一改造点

首页卡片现在是**平铺的 v-if**：

```
<view class="card focus-card"  v-if="show('focus')"   …>
<view class="card urg-card"    v-if="show('urgency')" …>
<view class="card"             v-if="show('task')"    …>
<view class="card coach-card"  v-if="show('coach')"   …>
<view class="card"             v-if="show('goal')"    …>
<view class="card"             v-if="show('dock')"    …>
```

**没有 index，拖不了。** 要改成 `v-for` 数组循环才能接拖拽。
数据层已经齐了（`show(id)` / `layoutIds` / `syncLayout()` / `home-layout.MODULES`），
要动的只有模板结构 + 加一层编辑 UI。

⚠️ 两处要小心：
- 首页有"硬控"（`cur.phase` 有值时只剩倒计时），编辑态必须在硬控期间**让位**
- `urgency` 卡还带 `v-if="!u.empty"`，这类"自己会消失"的卡在编辑态里要**强制显示**，
  否则用户在收纳区里找不到它

---

## 3. 重点②：card-spec 的思路（比代码值钱）

不是要搬 761 行代码，而是学它**怎么给 AI 划边界**。

**AI 能自由决定的**：布局（分区/横竖/网格/间距/对齐/伸缩）、样式（底色/渐变/圆角/描边/
投影/字号字重/字体/斜体/透明度/宽高）、数据（自定义字段 + 绑定真实学习数据 + 条件显示）、
交互（跳转/开始练习/朗读/复制/弹提示/改卡内状态）、内容（任意文案/清单/标签/倒计时/图片）。

**七条红线 —— 硬编码上限，指令绕不过去**（不是"不推荐"，是**做不到**）：

| | 红线 |
|---|---|
| R1 | 不执行代码：全链路无 eval / 函数构造 / 模板求值 / 原始 HTML 注入；`{{...}}` 只按白名单键做值替换，**绝不是表达式求值** |
| R2 | 不碰系统：读不到文件/数据库/剪贴板/设备信息；写只能写自己这张卡的 doc |
| R3 | 不碰凭据：数据目录里没有 token / 密钥 / 手机号，也拿不到 AI 的 API Key |
| R4 | 不越权跳转：`navigate` 的 page 必须在 `PAGE_ROUTES` 白名单里，没有任何"打开任意 URL" |
| R5 | 不泄漏：图片只放行 https 与本地文件，**禁 `data:image/svg`**（SVG 能夹脚本） |
| R6 | 不崩溃：层数/节点数/文本长度/列表长度全有硬上限，渲染是"展平后一层循环"，不存在深递归 |
| R7 | 不阻塞：规格里没有网络请求、没有同步大写入、没有定时器 |

**归一化的性格：能救就救。** AI 给 oversized / 非法 / 拼错的值，一律夹取、截断、取默认值，
而不是让整张卡失败 —— **只有"一个可渲染的节点都没有"才算失败**。
这样模型自由度很高，但产物永远可渲染。

这套"自由度 + 硬红线 + 能救就救"的组合，是 PWstudy 将来要做任何"让 AI 产界面"的功能时
最值得先抄的框架。

---

## 4. 其它可借鉴

- **`onboarding.js` + `onboarding-mask.vue`**（新手引导）
  PWstudy 的引导当初随背单词一起撤掉了（步骤全是查词 / 开始背单词 / AI 指令），
  遮罩组件也在 pivot 时挪走。AWword 这套是活的，等 PWstudy 自己的步骤写好了可以照着接回来。
- **`backup-io.js`**：PWstudy 只有 `backup.js`，AWword 多了一个 io 层（导出/导入的读写分离）。
- **护栏规模**：AWword `_tools` 74 个 check 脚本，PWstudy 48 个。
  其中 AWword 有一批针对 card-spec / page-command 的，是将来搬那套时要一起搬的。

---

## 5. 不建议搬的

`dict` / `engine` / `iplus1` / `judge` / `srs` / `store` / `wordbook` / `quiz-plan` /
`search` / `sentence-*` / `confusion` / `known-filter` / `word-*` —— 全是背单词领域专属，
PWstudy 没有对应的数据模型，搬过来就是死代码。

---

## 6. 建议的移植顺序

| 优先级 | 内容 | 说明 |
|---|---|---|
| **1** | 首页卡片编辑（编辑态 + 拖拽 + 收纳 + 添加组件） | 数据层已齐，只补 UI。补掉欠账② |
| 2 | card-spec 的**红线表与归一化性格** | 先只搬思路，等真要做"AI 造卡"时再搬代码 |
| 3 | 新手引导 | 等 PWstudy 自己的引导步骤写好 |
| 4 | backup-io | 备份功能要改时顺手 |

其中第 1 项是**纯 UI 补齐、风险低、用户马上能感知**，建议先做。

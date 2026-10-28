// _tools/check-home-hero.js - 首页分层（首屏三卡 + 下面一摞可排模块）静态校验（只读）
//
// 回归点（对应需求：主页只显示今天要用的东西 —— 开始专注 / 任务 / 紧迫度，
//   这三张要做首页适配、突出焦点、简洁；其余模块**跟在首屏后面正常滚动**）：
//  1) 首屏 = 三张精简卡（homeOrder / HOME_IDS），每张一个焦点
//  2) 首屏自己撑满一屏 —— 下面那摞卡静止时**结构性**落在折叠线之下，不靠 opacity 藏
//  3) 下面那摞卡是页面流的一部分（不是 fixed 抽屉）：不用学手势、不会误触
//  4) 滚动进度只认 onPageScroll 的 scrollTop（App 端没有 document，量节点那条路会静默失效）
//  5) 编辑入口压在最后一卡下面（滑到底才够得着）
//  6) 起表仍然只有准备页那颗确认键（首页不带任何 auto 参数）
//
// ⚠️ 2026-10-23 这版把"底部抽屉"整块拆了：
//    以前那是一层 fixed 面板 + 一套上滑手势，手势在屏幕**任何位置**划 12px 就接管
//    （页面本身还被 touch-action:none 禁了滚动），想点卡片却把面板拽出来 ——
//    "首页很乱"的直接来源；而且没有任何常驻提示，不滑就不知道下面还有东西。
//    现在规则只有一条：**它就是页面流**。下面这些断言有一半是守"别退回去"。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const home = R('pages/home/home.vue');
const en = R('utils/i18n-en.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
// 模板先后关系：本需求里"顺序"本身就是验收项（首屏 → 一摞卡 → 编辑）
const at = (s) => home.indexOf(s);
const block = (re) => { const m = home.match(re); return m ? m[0] : ''; };
// ★ 硬约束 12：先剥注释再扫。这些 CSS 块里我写了大段"为什么**不能**这么写"的注释，
//   注释里**必然出现**被禁的那个属性名（touch-action / opacity …），不剥就假红。
const blocks = (re) => {
  const out = [];
  const r = new RegExp(re.source, 'g');
  let m;
  while ((m = r.exec(home))) out.push(m[0]);
  return out;
};
const cssBlocks = (re) => blocks(re).map(s => s.replace(/\/\*[\s\S]*?\*\//g, ''));
// 同名选择器可能有多处（.mod-list 在"编辑"与"滚动流"两节各一条），取**最后**一条
const cssBlock = (re) => { const a = cssBlocks(re); return a.length ? a[a.length - 1] : ''; };

console.log('== 1. 首屏只放今天要用的（合成一张「今天」面板）==');
assert(/class="home-hero"/.test(home), '有首屏容器 .home-hero（撑满一屏，位移/渐隐都挂在它身上）');
assert(/class="today-panel"/.test(home) && at('class="today-panel"') > at('class="home-hero"'),
  '「今天」面板 .today-panel 在 .home-hero 内');
assert(/const HOME_IDS = \['focus', 'task', 'urgency'\]/.test(home),
  'HOME_IDS = 专注 / 今日任务 / 紧迫度');
// ★ 2026-10-27：④ 紧迫度**提到最顶**（用户要求：短屏手机底部那条轴容易被推到
//   折叠线之下看不见，放到日期正下方、大圆之上保底先看见）。
//   板内次序变成 urg → focus → task；引导仍按 focus → task 走，所以"这两块的相对
//   次序"必须守住（顺序错了高亮会指错地方）。
//   ⚠️ 锚点用「tp-block xxx-card」片段而不是完整 class 属性：给某区套上 .card
//      （"card tp-block task-card"）时类名属性值会变，完整属性锚会消失 →
//      顺序断言误伤、真正该红的"不各自套 card"反而不响。
assert(at('tp-block urg-card') < at('tp-block focus-card') &&
  at('tp-block focus-card') < at('tp-block task-card'),
  '板内顺序：今日紧迫度 → 开始专注 → 今日任务（紧迫度置顶，短屏先看见）');
const bHome = block(/homeOrder\(\)\s*\{[\s\S]*?\n    \}/);
assert(/HOME_IDS\.indexOf\(id\) >= 0/.test(bHome), 'homeOrder 只留三件套');
const bHomeOrder = block(/homeOrder\(\)\s*\{[\s\S]*?\n    \}/);
assert(/ids\.length \? ids : \['focus'\]/.test(bHomeOrder), '主卡全被收纳时兜底回「开始专注」（主页不开天窗）');
const bRest = block(/restOrder\(\)\s*\{[\s\S]*?\n    \}/);
assert(/HOME_IDS\.indexOf\(id\) < 0/.test(bRest), 'restOrder 是"首屏下面那一摞"');
// ★ 编辑态也必须排除：以前编辑态返回**全部**，于是首屏与下面各渲染一份
//   focus / task / urgency —— 同一模块两套样式并存（"乱"的一条来源）。
assert(!/if \(this\.editing\) return ids/.test(bRest),
  '编辑态**也**排除首屏三块（不与首屏双份渲染、两套样式并存）');

console.log('== 2. 「今天」面板：一张整板，大圆即开始键，任务与收工同组 ==');
// ★ 2026-10-25 重构（用户拍板，两轮）：
//   ① 三张并列小卡：割裂 + 上下 36rpx 内边距 ×6 把整组撑高，「今日收工」被底部胶囊压住；
//   ② 只删外壳不重排：字直接压在背景上"飘"，可点区域丢了暗示；
//   ③ 合成整板但还穿 .card 皮肤（边框/投影/毛玻璃）：用户原话"本质并没有脱离卡片设计"。
//   现在：一块实色淡底（无浮起三件套），三区发丝线分区；
//   设计理念：一处凸显（大圆）、其余淡化、只留关键文字，解释收进「?」。
assert(/class="today-panel"/.test(home), '首屏是一张整板（class="today-panel"）');
assert(/class="tp-sep"/.test(home), '三区之间用发丝线分区（tp-sep）');
// ① 大圆本身就是开始键：没有独立开始按钮，点圆框任意处直接进专注页准备态
assert(/<view class="tp-block focus-card" @tap="quickStart\(\)">/.test(home),
  '① 大圆即开始键（点圆框 = quickStart，不再单设按钮）');
assert(/class="hc-ring"/.test(home) && /class="hc-ring-num"/.test(home), '① 圈内是默认时段读数');
assert(/class="hc-ring-task"/.test(home), '① 圈内写默认任务名（与时段同一圈）');
assert(!/class="hc-go"/.test(home), '① 没有独立的开始按钮（hc-go 已删）');
// 圆框尺寸与专注页同款（480rpx）—— 用户明确要求"跟专注页里那个圆一样大"
const bRingCss = cssBlock(/\.tp-block\.focus-card \.hc-ring \{[^}]*\}/);
assert(/width:\s*480rpx/.test(bRingCss) && /height:\s*480rpx/.test(bRingCss),
  '① 圆框 480rpx（与专注页 .ring 同尺寸）');
// ⚠️ 这里用类名片段（不用完整 class 属性锚）：某区被套上 .card 或加上 @tap 时
//    类名属性值会变，完整锚会失配 → 误伤本条、真正该红的断言反而不响。
assert(/tp-block task-card/.test(home), '② 任务区（task-card 类名保留，引导靠它定位）');
assert(/v-for="\(item, ti\) in homeQueue"/.test(home), '② 焦点：只列最该做的三条');
assert(/v-if="hasMoreTask"[\s\S]{0,160}goCalendar/.test(home), '② 其余的去日历页看（不再假装有个抽屉能拉开）');
// ③ 收工与任务同组：home-cta 必须紧跟 task-card（中间不再有 tp-sep 分线），
//   不单独占面板底部一层。⚠️ 2026-10-27 紧迫度提到最顶后，urg-card 不再是"收工后面
//   那块"，原来的 `< at('tp-block urg-card')` 上界失效 —— 改判"任务区与收工之间没有分线"。
const iTaskBlk = at('tp-block task-card');
const iCta = at('class="home-cta"');
assert(iCta > iTaskBlk && !/tp-sep/.test(home.slice(iTaskBlk, iCta)),
  '③ 收工与每日任务同组（home-cta 紧随任务区、中间不再分线）');
assert(/tp-block urg-card/.test(home), '④ 紧迫度区');
assert(/class="hc-axis"/.test(home) && /hc-axis-need/.test(home), '④ 焦点：一条 24 小时时间轴');
// 紧迫度简化成纯进度条：标题行 / 档位胶囊 / 两行读数全砍（⚠️ 只扫模板段）
// 只留关键文字：收工按钮下方不放解释小字
const tplOnly = home.slice(0, home.indexOf('\n<script'));
assert(!/hc-lv|hc-foot-row|uLevelName/.test(tplOnly), '④ 紧迫度砍成纯进度条（无标题/档位/读数）');
assert(!/cta-tip/.test(tplOnly), '按钮下方无解释小字（只留关键文字）');
// 读数不是交互目标：整块不可点，解释收进轴旁的「?」（明确 affordance）
assert(/class="hc-q"[^>]*@tap\.stop="explainUrgency/.test(home),
  '紧迫度读数整块不可点，解释收进「?」（不再整块误触）');
assert(!/<view class="tp-block urg-card" @tap/.test(home), '紧迫度区没有整块 @tap（读数不可点）');
// 面板皮肤：实色淡底，**不要** .card 的浮起三件套（边框 / 投影 / backdrop-filter）
assert(!/class="card today-panel"/.test(home), '面板不穿 .card 皮肤（边框/投影/毛玻璃 = 卡片感本身）');
const bPanelCss = cssBlock(/\.today-panel \{[^}]*\}/);
assert(/background:\s*rgba\(var\(--surface-rgb/.test(bPanelCss) &&
  !/border:/.test(bPanelCss) && !/box-shadow/.test(bPanelCss) && !/backdrop-filter/.test(bPanelCss),
  '面板只要实色淡底（无边框 / 投影 / 毛玻璃）');
// 面板内边距节奏：左右 36rpx 与下面那摞卡同竖线，上下收窄（比三卡时代矮一截）
assert(/padding:\s*26rpx\s+36rpx\s+30rpx/.test(bPanelCss),
  '「今天」面板内边距 26/36/30（左右与那摞卡同竖线，上下比三卡时代收窄）');
// 板内三区**不各自成卡**：任何一区再套 .card 就退回了三卡并列
assert(!/<view class="card tp-block/.test(home), '板内三区不各自套 .card（否则退回三卡并列）');

console.log('== 3. 下面那摞卡 = 页面正常滚动（★ 不再是 fixed 抽屉）==');
// 抽屉时代的四个标识：任何一个回来都说明退版本了
assert(!/dr-mask|dr-panel|dr-body|dr-grip|dr-throw|dr-title/.test(home),
  '抽屉那层 fixed 面板已拆干净（dr-mask / dr-panel / dr-body / dr-grip）');
assert(!/drawerOn|panelDrag|openProg|homeShift|panelStyle|measurePanel|panelHpx/.test(home),
  '抽屉那套状态量已拆干净（drawerOn / panelDrag / openProg / homeShift）');
assert(!/homeSwipeStart|homeSwipeMove|homeSwipeEnd/.test(home),
  '屏幕任意位置劫持上滑的手势已删除（那是"想点卡片却拽出面板"的根因）');
// ★ 承载首屏的元素绝不能再禁触摸：那行是为手势加的，手势一去就得放开，
//   否则整个首页滚不动，下面那摞卡永远够不着。
const bSlideCss = cssBlock(/\.home-slide \{[^}]*\}/);
assert(!/touch-action:\s*none/.test(bSlideCss),
  '.home-slide 不再 touch-action:none（页面要能正常滚到下面那摞卡）');
assert(/class="mod-sheet"[^>]*:style="sheetRevealStyle"/.test(home), '玻璃底板层 .mod-sheet 存在');
assert(/class="mod-list"[^>]*:style="listRevealStyle"/.test(home), '卡片层 .mod-list 存在');
assert(at('class="mod-list"') > at('class="mod-sheet"'), '卡片层在底板层之内（底板能一路糊到首屏内容）');
// 玻璃底板：整摞卡共用一张，卡片之间的缝隙露出被模糊的首屏内容
const bSheetCss = cssBlock(/\.mod-sheet::before \{[^}]*\}/);
assert(bSheetCss !== '', '底板挂在 ::before 上（不占一个真实节点）');
assert(/border-radius:\s*36rpx/.test(bSheetCss), '底板有圆角（边缘才像"抽屉的边"）');
assert(/backdrop-filter:\s*var\(--glass-lg/.test(bSheetCss), '底板有毛玻璃（不是实色白板）');
assert(/background:\s*rgba\(var\(--surface-rgb/.test(bSheetCss), '底板半透明（透得出底下的首屏）');
assert(/box-shadow/.test(bSheetCss), '底板有上沿阴影（浮在上面的层次）');
// ★ 两层分工：底板只吃 transform（带 opacity 会自成 backdrop root，玻璃感全废），
//   卡片只吃 opacity。
const bSheetStyle = block(/sheetRevealStyle\(\)\s*\{[\s\S]*?\n    \}/);
assert(/transform/.test(bSheetStyle) && !/opacity/.test(bSheetStyle),
  'sheetRevealStyle 只给 transform（★ 带 opacity 会把 backdrop 隔离在层内 = 糊了个寂寞）');
const bListStyle = block(/listRevealStyle\(\)\s*\{[\s\S]*?\n    \}/);
assert(/opacity/.test(bListStyle) && !/transform/.test(bListStyle), 'listRevealStyle 只给 opacity（位移在上层）');
// ★ 静态兜底：JS 没跑时卡片必须完全显现。把初值写成"藏在下面"，脚本一环没跑就永久不见。
const bSheetStatic = cssBlock(/\.mod-sheet \{[^}]*\}/);
assert(/transform:\s*none/.test(bSheetStatic), '.mod-sheet 静态兜底 transform:none（脚本没跑不藏卡片）');
const bListStatic = cssBlock(/\.mod-list \{[^}]*\}/);
assert(/opacity:\s*1/.test(bListStatic), '.mod-list 静态兜底 opacity:1');
// 首屏撑满一屏：这是"卡片静止时在折叠线之下"的**结构**保证
const bHeroCss = cssBlock(/\.home-hero \{[^}]*\}/);
assert(/min-height:\s*calc\(100vh/.test(bHeroCss), '.home-hero 自己撑满一屏（结构保证卡片在折叠线之下）');
// ★ 初值必须与 syncReveal 的"0 = 顶部"同口径。写成 1 会在 revealOn 先亮、
//   进度还没算出来的那一帧把首屏 fade 成 0（首页一片空白，2026-10-24 实锤）。
assert(/revealP: 0/.test(home), 'revealP 初值 0（= 停在顶部；给 1 会把首屏 fade 成空白）');
assert(/revealOn: false/.test(home), 'revealOn 初值 false（静态兜底生效）');

console.log('== 3b. 滚动进度怎么算出来的（★ 只认 onPageScroll）==');
assert(/onPageScroll\(e\)/.test(home) && /this\.syncReveal\(/.test(home), 'onPageScroll 把滚动位置喂给 syncReveal');
const bSync = block(/syncReveal\(scrollTop\)\s*\{[\s\S]*?\n    \}/);
assert(bSync !== '', '存在 syncReveal');
assert(/e && typeof e\.scrollTop === 'number'/.test(home), '进度来自 scrollTop（唯一不依赖 DOM 的滚动数据源）');
assert(!/getBoundingClientRect|document\./.test(bSync), 'syncReveal 不量节点 / 不碰 document（App 端会静默失效）');
// 唯一的数据入口也不许自己去摸 DOM：App 端逻辑层没有 document，量节点那条路
// 拿不到东西且不报错 —— 表现就是"上滑什么都没发生"。
const bScrollHook = block(/onPageScroll\(e\)\s*\{[\s\S]*?\n {2}\}/);
assert(bScrollHook !== '', '存在 onPageScroll');
assert(!/document\.|getBoundingClientRect|createSelectorQuery/.test(bScrollHook),
  'onPageScroll 自己也不碰 DOM（只把 e.scrollTop 递给 syncReveal）');
assert(/Math\.round\(p \* 20\) \/ 20/.test(bSync), '进度量化到 0.05 一档（滑一次最多 20 次赋值，不按帧重渲染）');
assert(/this\._scrollTop - dead|this\._scrollTop - /.test(bSync), '有死区（刚起手的抖动不让卡片先闪一下）');
assert(/const on = !this\.locked && this\.restCount > 0/.test(bSync),
  '硬控屏 / 下面没有卡时不参与淡入（revealOn=false，页面走 CSS 默认值）');
// ★ 首屏"整片空白"的另一个入口：_scrollTop 还没被 onPageScroll 喂过（undefined）
//   就算出 NaN —— `p<0 / p>1` 两道夹逼拦不住 NaN，进度会卡死在初值上。
assert(/typeof this\._scrollTop !== 'number'/.test(bSync), '_scrollTop 没来过时按 0 兜底（undefined 会算出 NaN）');
assert(/!isFinite\(p\)/.test(bSync), '进度算式有 isFinite 兜底（NaN 骗过全部夹逼）');
assert(/try \{ this\.syncReveal\(this\._scrollTop\) \} catch/.test(home),
  'onShow 回首页先对齐一次进度（别等用户先滑一下，那一帧像空的）');
assert(/const REVEAL_SPAN_RPX = 520/.test(home), '淡入距离常量存在（520rpx）');
assert(/const REVEAL_DEAD_RPX = 16/.test(home), '死区常量存在（16rpx）');
assert(/const SHEET_PARALLAX_RPX = 220/.test(home), '卡片视差常量存在（220rpx，落后于滚动）');
assert(/const HERO_LIFT_RPX = 56/.test(home), '首屏上抬常量存在（56rpx）');
assert(/const HERO_DEPTH_SCALE = 0\.05/.test(home), '首屏缩放常量存在（0.05）');
// rpx → px 必须自己换：uni-app 只转换 CSS 文件里的 rpx，内联样式里的不转
const bUpx = block(/upx\(v\)\s*\{[\s\S]*?\n    \}/);
assert(/uni\.upx2px/.test(bUpx), 'upx() 走 uni.upx2px（内联里写 rpx 不会被转换）');
assert(/v \* w \/ 750/.test(bUpx) || /return v \/ 2/.test(bUpx), 'upx() 有拿不到屏宽时的兜底');
const bRemeasure = block(/remeasure\(\)\s*\{[\s\S]*?\n    \}/);
assert(/this\._spanPx = /.test(bRemeasure) && /this\._parallaxPx = /.test(bRemeasure),
  'remeasure() 一次性重算四个距离（屏宽变了要重算，否则幅度不对）');
// ★ 淡入距离必须按"一屏"算：给固定 520rpx 的话，大屏上走完进度时首屏还占着
//   上半屏、却已经透明了 → 中间空一片。
assert(/this\.winH/.test(bRemeasure) && /insets\.statusBar\(\)/.test(bRemeasure),
  '淡入距离按首屏可视高度算（winH 去掉顶栏 / 底栏留白）');
assert(/Math\.max\(this\.upx\(REVEAL_SPAN_RPX\)/.test(bRemeasure),
  '按屏算的同时保留 520rpx 下限（横屏 / 折叠小窗也要走完）');
assert(/const PAGE_NAV_RPX = 136/.test(home) && /const PAGE_TAB_RPX = 220/.test(home),
  '顶栏 / 底栏留白常量与 App.vue 的 .page-nav / .page-tabbar 同值');
assert(/try \{ this\.remeasure\(\) \} catch/.test(home), 'onShow 里 remeasure 自带 try（不许打断 refresh / startTick）');

// ===== 可滚行程 ÷ 淡入距离（2026-10-26：两张卡时滑不到进度 1）=====
// 症结：p = (scrollTop - dead) / span，span 按"一屏"给，可页面能滚多远是文档
// 说了算的。下面只有两张卡时文档没那么高，划到底也凑不满一屏的行程 →
// p 停在 0.5 上下 → 卡片半透明、底板还往下偏着（看着就是"没滑出来、缺一块"）。
// 所以：① 分母要被实测行程收敛；② 划到尽头一律当拉到位；③ 行程只能在一个地方量。
const bMeas = block(/measureScrollable\(tryN, force\)\s*\{[\s\S]*?\n    \},/);
assert(bMeas !== '', '存在 measureScrollable（实测能滚多远）');
assert(/select\('\.container'\)\.boundingClientRect/.test(bMeas), '量根容器高度（= 文档总高）');
assert(/box\.height - win/.test(bMeas), '可滚行程 = 文档高 - 视口高');
assert(/max < 0 \|\| max > 20000/.test(bMeas), '量出来的行程要过合理性夹逼（离谱值退回重试）');
// ⚠️ 两个 / 一行：这文件混着 CRLF，含换行的锚点写 \n 会在 CRLF 段落上落空（老坑）
assert(/\.exec\(\(res\) => \{[\s\S]*?catch/.test(bMeas) && /try \{\r?\n\s*let q/.test(bMeas),
  '整段（select + exec）都包 try —— 抛点在 exec 里，只包 .in(this) 等于没兜');
assert(/n \+ 1/.test(bMeas) && /n > 4/.test(bMeas), '量不到就退一拍重试，且有次数上限');
assert(/if \(changed\)[\s\S]{0,340}?syncReveal\(-1\)/.test(bMeas),
  '行程变了要立刻按新分母对齐进度（不然要等用户再滑一下才纠正）');
assert(/gap < 900/.test(bMeas), '重复测量有节流（tick / 刷新会反复来叫）');
// ⚠️ 这条最要紧：App 端在 syncReveal / onPageScroll 里量不到东西，会静默失效成
//    "上滑什么都没发生"。所以 DOM 只允许出现在 measureScrollable 这一个地方。
assert(/createSelectorQuery|getBoundingClientRect|document\./.test(bMeas),
  'measureScrollable 是唯一允许碰尺寸的地方');
assert(!/getBoundingClientRect|document\.|createSelectorQuery/.test(bSync),
  'syncReveal 仍然不碰 DOM（它只读 _scrollablePx 这个量好的数）');
assert(!/getBoundingClientRect|document\.|createSelectorQuery/.test(bScrollHook),
  'onPageScroll 仍然不碰 DOM');
assert(/this\._scrollablePx/.test(bRemeasure), 'remeasure 用实测行程收敛分母');
assert(/Math\.min\([\s\S]*?capped\)/.test(bRemeasure), 'span = min(按屏算的距离, 实测可滚行程)');
// 拉伸回弹 / 取整误差会让最后几 px 报不上来 —— 少了这一句又会停在 0.9x
assert(/this\._scrollTop >= avail - 6/.test(bSync), '已经划到页面尽头就判满（不靠最后几像素）');
assert(/try \{ this\.measureScrollable\(\) \} catch/.test(home.slice(home.indexOf('onShow()'))),
  'onShow 里 measureScrollable 自带 try（不许打断 refresh / startTick）');
assert(/clearTimeout\(this\.__scrollableT\)/.test(block(/onUnload\(\)\s*\{[\s\S]*?\n  \}/)),
  'onUnload 清掉待跑的测量计时器');
// 拉到位的震动 + Q 弹：一次来回只响一声
const bBuzz = block(/buzzDrawer\(\)\s*\{[\s\S]*?\n    \}/);
assert(bBuzz !== '' && /haptic\.tick\('drawer'\)/.test(bBuzz) && /catch/.test(bBuzz), 'buzzDrawer 震 drawer 档且包 catch');
assert(/this\._buzzed/.test(bSync) && /this\.buzzDrawer\(\)/.test(bSync) && /this\.playPop\(\)/.test(bSync),
  '拉到位才震 + Q 弹（一次来回只响一声，滑回去再拉才会再响）');
assert(/p < 0\.55/.test(bSync), '滑回一半以上才解除"已响过"，避免来回抖时狂震');

console.log('== 3c. 首屏怎么退场 ==');
const bHeroStyle = block(/heroCardStyle\(\)\s*\{[\s\S]*?\n    \}/);
assert(/transform/.test(bHeroStyle) && !/opacity/.test(bHeroStyle),
  'heroCardStyle 只给 transform（★ 带 opacity 会让背景毛玻璃糊不到 App 背景）');
assert(/HERO_DEPTH_SCALE/.test(bHeroStyle) && /scale\(/.test(bHeroStyle), '首屏轻微缩小（后退一层的景深）');
const bBodyStyle = block(/heroBodyStyle\(\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.revealP \* 1\.2/.test(bBodyStyle), '内容渐隐比卡片淡入早一点到位（×1.2）');
assert(/pointerEvents/.test(bBodyStyle), '淡到看不见就别再吃点击（否则透明首屏挡住下面那摞卡）');
assert(/hero-glass/.test(home) && /heroGlassStyle/.test(home), '背景毛玻璃层还在（随进度五档长出模糊）');
const bGlass = block(/heroGlassStyle\(\)\s*\{[\s\S]*?\n    \},/);
assert(/if \(!this\.revealOn\) return \{ opacity: '0' \}/.test(bGlass), '静止时 hero-glass 透明（背景必须高清）');
assert(/const blur = \[6, 12, 18, 20\]\[tier - 1\]/.test(bGlass), 'hero-glass 五档模糊（不过渡 blur 半径）');

console.log('== 4. 编辑入口在最后一卡下面 ==');
assert(at('class="mod-list"') > 0 && at('class="home-foot"') > at('class="mod-list"'),
  '编辑入口排在卡片列表之后（滑到底才够得着）');
assert(at('class="home-cta"') > 0 && at('class="home-cta"') < at('class="mod-list"'),
  '收工留在首屏（在「今天」面板内、下面那摞卡之前）');

console.log('== 5. 两处联动 ==');
const bToggle = block(/toggleEdit\(\)\s*\{[\s\S]*?\n    \}/);
assert(/if \(this\.editing\) this\.scrollToModules\(\)/.test(bToggle),
  '进编辑态把那一摞卡滚到眼前（把手/收纳/排序全在卡片上）');
assert(!/this\.drawerOn = true/.test(bToggle), '进编辑态不再"拉开抽屉"（抽屉已拆）');
const bScrollTo = block(/scrollToModules\(\)\s*\{[\s\S]*?\n    \}/);
assert(/uni\.pageScrollTo/.test(bScrollTo) && /catch/.test(bScrollTo), 'scrollToModules 走 pageScrollTo 且包 catch');
// 引导要挖 .focus-card / .task-card，它们在首屏 —— 用户滑到下面就量不到了
const bGuide = block(/maybeGuide\(\)\s*\{[\s\S]*?\n {4}\}/);
assert(/pageScrollTo\(\{ scrollTop: 0/.test(bGuide), '放引导前先滚回顶（目标卡在首屏，滑走了就量不到）');
const bWatch = block(/watch: \{[\s\S]*?\n  \},/);
// ⚠️ 必须按**函数体**判，不能用 "restOrder() 之后 N 个字符内出现 xxx" 那种写法：
//    窗口一宽就跨到紧挨着的 locked() 那条上 —— 把 restOrder 改成空函数照样绿
//    （反向测试抓出来过一次，2026-10-26）。
// ⚠️ 再谨慎一层：全文件里有**两个** restOrder —— computed 里还有一个（那一摞卡的
//    顺序），从头往后的第一次 match 会抠到它上面去，断言就地失灵。必须先在 watch
//    块里搜。
const bRestWatch = (bWatch.match(/ {4}restOrder\(\) \{[\s\S]*?\n {4}\}/) || [''])[0];
assert(bRestWatch !== '', '能抠出 restOrder 的 watcher 函数体（真判前置）');
assert(/this\.syncReveal\(-1\)/.test(bRestWatch), '卡片增减要重新对齐进度（否则最后一张收掉后整摞透明）');
// ★ 2026-10-26：张数一变文档高度就变，"能滚多远"必须重量 —— 分母停留在旧行程上，
//    四张减到两张之后的观感和没修一样（票数不够，滑不到进度 1，卡片半透明）。
assert(/measureScrollable\(\)/.test(bRestWatch), '卡片增减要重测可滚行程（分母跟着收敛；不重测 = 张数一变又复发）');
assert(/locked\(\) \{ this\.syncReveal\(-1\) \}/.test(bWatch), '进出硬控要重新对齐进度');

console.log('== 6. 层级归属（真跑标签栈）==');
// 只比"谁写在前面"是假绿 —— 标签忘了闭合时，照样是兄弟/子节点。
// ★ 与抽屉时代相反：下面那摞卡**必须**在 .page-slide 内（它就是页面流的一部分）；
//   只有"添加组件"这类 fixed 浮层才留在 .page-slide 外（记忆约束 3）。
const VOID = { image: 1, input: 1, icon: 1, br: 1 };
const ancestorsOf = (cls) => {
  // ★ 先剥 HTML 注释：模板里那几段"为什么这么排"的长注释带尖括号，不剥会被
  //   当成标签压进栈里，祖先链整条错位（页面本身是配平的，错的只是这一把扫描）。
  const tm = home.slice(home.indexOf('<template>'), home.indexOf('</template>'))
    .replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  let hit = null;
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(tm))) {
    const close = m[1], tag = m[2], attrs = m[3], self = m[4];
    if (tag === 'template') continue;
    if (self === '/' || VOID[tag]) continue;
    if (close) { if (stack.length) stack.pop(); continue; }
    const cm = attrs.match(/class="([^"]*)"/);
    const cl = cm ? cm[1] : '';
    stack.push(cl);
    if (hit === null && cl.split(/\s+/).indexOf(cls) >= 0) hit = stack.slice(0, -1);
  }
  return hit;
};
const ancMod = ancestorsOf('mod-list');
assert(ancMod !== null, '找得到卡片列表 .mod-list');
assert(ancMod !== null && ancMod.join(' | ').indexOf('page-slide') >= 0,
  '下面那摞卡 (.mod-list) **在** .page-slide 内（它就是页面流，不是浮层）');
// 它还得落在 .home-slide（不是 .page-slide 的直接兄弟）：那一层是切 tab 时整块滑动的
//   容器，落在它外面时首页只有首屏在动、下面那摞卡钉在原地。
const ancSheetHost = ancestorsOf('mod-sheet');
assert(ancSheetHost !== null && ancSheetHost.join(' | ').indexOf('home-slide') >= 0,
  '底板 .mod-sheet 在 .home-slide 内（切 tab 时跟着首屏一起滑）');
const ancPanel = ancestorsOf('today-panel');
assert(ancPanel !== null && ancPanel.join(' | ').indexOf('page-slide') >= 0,
  '「今天」面板仍留在 .page-slide 内（跟着切 tab 动画走）');
const ancSheet = ancestorsOf('sheet-mask');
assert(ancSheet !== null && ancSheet.join(' | ').indexOf('page-slide') < 0,
  '「添加组件」浮层 (.sheet-mask) 在 .page-slide 外（fixed 参照不受切 tab 动画影响）');
const ancFoot = ancestorsOf('home-foot');
assert(ancFoot !== null && ancFoot.join(' | ').indexOf('mod-list') >= 0,
  '编辑入口 (.home-foot) 在 .mod-list 内（跟着那一摞卡一起滚）');

console.log('== 7. 起表仍然只能从准备页进 ==');
// 先剥注释再扫 —— 注释里要写清楚"为什么没有 auto=1"，不剥会被自己的注释命中
const heroCode = home.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
assert(!/auto=1/.test(heroCode), '首页不带 auto=1 起表参数（只扫代码，不扫注释）');

console.log('== 8. 新文案都进了英文表 ==');
[
  '今天先做这个', '今天还没有安排', '剩 {n} 分钟', '段专注', '项待办',
  '开始专注', '说一句', '更多组件', '开始',
  '查看全部 ›', '还剩 {n} 段专注', '还要 {n} 分钟',
  '自由专注', '点这里先看清时长与设置', '休息中', '专注中'
].forEach(k => assert(en.indexOf("'" + k + "'") >= 0, 'i18n-en 含 key「' + k + '」'));

console.log('== 9. Q 弹：拉到位播一次过冲 ==');
assert(/<view class="mod-throw" :class="popCls">/.test(home), 'mod-throw 包裹层存在（动画不冲掉底板的跟手位移）');
const bPopCls = block(/popCls\(\)\s*\{[\s\S]*?\n    \},/);
assert(/return this\.popSeq % 2 \? 'pop-b' : 'pop-a'/.test(bPopCls), 'popCls 按奇偶交替 pop-a/pop-b 重触发');
const bPlayPop = block(/playPop\(\)\s*\{[\s\S]*?\n    \},/);
assert(/this\.popSeq\+\+/.test(bPlayPop) && /this\.popOn = false/.test(bPlayPop) && /this\.popOn = true/.test(bPlayPop),
  'playPop 先关后开 + 自增序号以重触发');
const popKeyA = block(/@keyframes sheet-pop-a \{[\s\S]*?\n\}/);
assert(/26%.*translateY\(-16rpx\) scale\(1\.026\)/.test(popKeyA), 'sheet-pop 冲过头 -16rpx/1.026');
assert(/54%.*translateY\(5rpx\) scale\(0\.995\)/.test(popKeyA), 'sheet-pop 回落 +5rpx/0.995');
assert(/78%.*translateY\(-2rpx\) scale\(1\.003\)/.test(popKeyA), 'sheet-pop 二段余震 -2rpx');
const popKeyB = block(/@keyframes sheet-pop-b \{[\s\S]*?\n\}/);
assert(popKeyB !== '' && /translateY\(-16rpx\) scale\(1\.026\)/.test(popKeyB), 'sheet-pop-b 与 a 内容一致（交替挂用）');

console.log('== 10. 真跑 syncReveal（静态断言说"算对了"不算数）==');
// 把 syncReveal 抠出来真跑：喂 0 / 中间 / 超出 / 没卡 / 硬控 五种输入，
// 看 revealP 与 revealOn 是不是照着走的。
{
  const m = home.match(/ {4}syncReveal\(scrollTop\) \{[\s\S]*?\n {4}\},/);
  assert(m !== '', '能抠出 syncReveal 函数体（真跑前置）');
  if (m) {
    const make = () => {
      const src = 'return { _scrollTop: 0, locked: false, restCount: 4,' +
        ' _spanPx: 260, _deadPx: 8, revealP: 0, revealOn: false, _buzzed: false,' +
        ' buzz: 0, pop: 0, remeasure: function () {},' +
        ' buzzDrawer: function () { this.buzz++ }, playPop: function () { this.pop++ },' +
        m[0].trim() + '}';
      return new Function(src)();
    };
    // A. 停在顶部：卡片透明、首屏全亮
    const a = make(); a.syncReveal(0);
    assert(a.revealOn === true && a.revealP === 0, '顶部：revealOn=true 且 revealP=0（卡片透明）' +
      ' [on=' + a.revealOn + ' p=' + a.revealP + ']');
    assert(a.buzz === 0 && a.pop === 0, '顶部不震（震只在拉到位那一下）');
    // B. 滑到一半
    const b = make(); b.syncReveal(0); b.syncReveal(138);
    assert(b.revealP > 0.4 && b.revealP < 0.6, '滑到一半：进度约 0.5（实际 ' + b.revealP + '）');
    // C. 拉到底：进度满、震一下 + Q 弹一次
    const c = make(); c.syncReveal(0); c.syncReveal(9999);
    assert(c.revealP === 1, '拉到底：进度满');
    assert(c.buzz === 1 && c.pop === 1, '拉到底震一下 + 弹一次（buzz=' + c.buzz + ' pop=' + c.pop + '）');
    // 一次来回只响一声：继续上报"到底"不该再震
    c.syncReveal(9999); c.syncReveal(9999);
    assert(c.buzz === 1 && c.pop === 1, '停在同一处来回上报不重复震（一次来回只响一声）');
    // 滑回一半以上再拉，才允许再响
    c.syncReveal(0); c.syncReveal(9999);
    assert(c.buzz === 2, '滑回去再拉可以再响一声（buzz=' + c.buzz + '）');
    // D. 下面一张卡都没有：卡片必须常显，否则会出现"整摞不见了"
    const d = make(); d.restCount = 0; d.syncReveal(0);
    assert(d.revealOn === false && d.revealP === 0, '没有卡时卡片常显、进度归 0（revealOn=false, p=' + d.revealP + '）');
    assert(d.buzz === 0, '没有卡时不震');
    // E. 正在专注（硬控屏）：同样不该有淡入动画
    const e = make(); e.locked = true; e.syncReveal(0);
    assert(e.revealOn === false && e.revealP === 0, '硬控屏卡片常显（那一屏没有可淡入的东西）');
    // F. 死区：起手那点抖动不该让进度动
    const f = make(); f.syncReveal(6);
    assert(f.revealP === 0, '死区内的抖动不推进度（p=' + f.revealP + '）');
    // G. 传 -1（重新对齐）时不能把已有的滚动位置冲掉
    const g = make(); g.syncReveal(200); const keep = g.revealP; g.syncReveal(-1);
    assert(g.revealP === keep, 'syncReveal(-1) 只重新对齐、不覆盖已有滚动位置');
    // H. ★ onPageScroll 一次都没来过（_scrollTop 未定义）→ 必须当顶部，不能算出 NaN 卡在初值。
    //    真机上这就是"进首页一片空白，动一下屏幕才回来"。
    const h = make(); delete h._scrollTop; h.syncReveal(-1);
    assert(h.revealOn === true && h.revealP === 0,
      '_scrollTop 未初始化时当顶部（revealOn=true, p=' + h.revealP + '；NaN 会让首屏淡成 0）');
    const h2 = make(); h2._scrollTop = NaN; h2.syncReveal(-1);
    assert(h2.revealP === 0, '_scrollTop 是 NaN 时同样归 0（p=' + h2.revealP + '）');

    // I. ★ 2026-10-26 真机反馈的那一枪：下面只有两张卡时滑不到进度 1。
    //    remeasure 之后分母已按实测行程收敛（300 - dead 8 = 292），这里验证
    //    在这种情况下滑到尽头必须是满的 —— 这就是"不再半透明"的直接凭据。
    const i = make(); i._spanPx = 292; i._scrollablePx = 300;
    i.syncReveal(0); i.syncReveal(300);
    assert(i.revealP === 1, '两张卡（行程 300 / 分母收敛到 292）：滑到尽头进度满（实际 ' + i.revealP + '）');
    assert(i.buzz === 1 && i.pop === 1, '两张卡拉到底同样震一下 + 弹一次（buzz=' + i.buzz + ' pop=' + i.pop + '）');
    // ★ 对照：分母**没有**跟着收敛（老写法，四张卡时量出来的 491）会怎样 ——
    //   同样的 300px 行程只能喂出 0.59，卡片停在六成透明度：真机上"看不全"就是它。
    //   这条盯着 remeasure 里那个 min，也顺带证明上面的 1 不是蒙出来的。
    const i2 = make(); i2._spanPx = 491; i2._scrollablePx = 0;
    i2.syncReveal(0); i2.syncReveal(300);
    assert(i2.revealP > 0.4 && i2.revealP < 0.75,
      '对照：分母不收敛时 300px 只能到半透明（实际 ' + i2.revealP + '）');
    // 还差一截时不许提前判满（否则四张卡会变成"没拉到位就全显"）
    const i3 = make(); i3._spanPx = 292; i3._scrollablePx = 300;
    i3.syncReveal(0); i3.syncReveal(240);
    assert(i3.revealP < 1, '没滑到尽头不判满（240/300，实际 ' + i3.revealP + '）');
    // 判满那条容差：最后一帧少报几 px（回弹 / 取整）时兜住它。
    //   span 还停在旧值 340（remeasure 还没跑到），不判满就是 0.85 —— 又是半透明。
    const i4 = make(); i4._spanPx = 340; i4._scrollablePx = 300;
    i4.syncReveal(0); i4.syncReveal(296);
    assert(i4.revealP === 1, '到底最后几 px 报不上来时靠判满兜住（296/300，实际 ' + i4.revealP + '）');
  }
}

console.log(fail ? '\n首页分层校验失败 ' + fail + ' 项 ✗' : '\n首页分层校验全部通过 ✓');
process.exit(fail ? 1 : 0);

// _tools/check-home-focus.js - 首页「专注设置」卡片（顶栏右上角胶囊 → 弹出卡片）静态校验（只读）
//
// 回归点（对应需求：拦截通知 / 强制模式 / 自动进休息 全部收进顶栏右上角胶囊点开的卡片，
//   不再单独留一个底部胶囊）：
//  1) 顶栏 float-navbar 暴露 focusBtn / focusOn 两个 prop，并 emit open-focus
//  2) 首页模板：float-navbar 接了 :focus-btn 与 @open-focus；弹出层有 fs-mask / fs-card
//  3) 首页脚本：toggleFocusSheet / tapForced / tapBlockNotif / tapAutoRest
//               / saveFocus / openOverlayHome 齐全；且 goto-notif 弹窗有出口
//  4) i18n：6 个新 key 全部落进英文表（漏译会在 check-i18n 第 5 节另外报错，这里顺手守一遍）
//  5) fgsvc 仍提供 notifGranted / openNotifSettings（拦截开关的授权判定与跳转依赖它们）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const home = R('pages/home/home.vue');
const navbar = R('components/float-navbar/float-navbar.vue');
const en = R('utils/i18n-en.js');
const fgsvc = R('utils/fgsvc.js');
const focusPage = R('pkgPlan/pages/focus/focus.vue');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
// 先切出函数体 / CSS 块再匹配：跨段正则 /x[\s\S]*?y/ 会一路吃到后面的匹配 → 假绿
const block = (src, re) => { const m = src.match(re); return m ? m[0] : ''; };
// CSS 块先剥注释：注释里写着"为什么不能这么写"，**必然出现**被禁的属性名
const blockCss = (src, re) => {
  const m = src.match(re);
  return m ? m[0].replace(/\/\*[\s\S]*?\*\//g, '') : '';
};

console.log('== 1. 顶栏 float-navbar 暴露「专注设置」入口 ==');
assert(/focusBtn:\s*\{/.test(navbar), 'float-navbar 有 prop focusBtn');
assert(/focusOn:\s*\{/.test(navbar), 'float-navbar 有 prop focusOn');
assert(/open-focus/.test(navbar), 'float-navbar emit 事件名 open-focus');
assert(/onFocusTap/.test(navbar), 'float-navbar 有 onFocusTap（发射 open-focus）');
assert(/fnb-side-focus/.test(navbar), 'float-navbar 渲染了专注设置入口槽位');
// 旧的内联拦截开关已退役：不能还留着，否则卡片与内联开关双重入口
assert(!/notifToggle/.test(navbar), 'float-navbar 已移除旧的 notifToggle');
assert(!/onNotifTap/.test(navbar), 'float-navbar 已移除旧的 onNotifTap');

console.log('== 2. 首页模板：顶栏接线 + 弹出卡片 ==');
assert(/:focus-btn="!locked"/.test(home), '首页把 !locked 传给顶栏 :focus-btn');
// ⚠️ 顶栏那颗键现在是「管理」面板的入口（2026-10-24 收拢）：所有管理项共用一颗键，
//    否则每加一个入口顶栏就多一颗、标题还会被挤偏。专注设置在面板第一行就地展开。
assert(/@open-focus="toggleManage"/.test(home), '首页接住 open-focus → toggleManage（管理面板）');
assert(/toggleManage\(\)\s*\{[\s\S]{0,200}?this\.manageOn = !this\.manageOn/.test(home),
  'toggleManage 开的是 manageOn（不是直接开专注设置卡）');
// 专注设置必须还在第一层可达：面板第一行点了就地展开 focusSheet，不能只剩跳转
const bManageGo = (home.match(/manageGo\(k\)\s*\{[\s\S]*?\n    \}/) || [''])[0];
assert(/k === 'focus'/.test(bManageGo) && /this\.focusSheet = true/.test(bManageGo),
  '管理面板里「专注设置」点了就地展开 focusSheet（不是二次跳转）');
assert(/manageGo\('focus'\)/.test(home) && /manageGo\('apps'\)/.test(home) && /manageGo\('range'\)/.test(home),
  '管理面板收纳了专注 / 学习 App / 学习范围等同类入口');
assert(/class="fs-mask"/.test(home), '首页有遮罩层 fs-mask');
assert(/class="fs-card"/.test(home), '首页有弹出卡片 fs-card');
assert(/focusSheet/.test(home), '首页有 focusSheet（卡片展开状态）');
assert(/tapForced/.test(home) && /tapBlockNotif/.test(home) && /tapAutoRest/.test(home),
  '卡片三行开关接 tapForced / tapBlockNotif / tapAutoRest');

console.log('== 3. 首页脚本：方法齐全 + goto-notif 有出口 ==');
[ 'toggleFocusSheet', 'tapForced', 'tapBlockNotif', 'tapAutoRest',
  'saveFocus', 'openOverlayHome' ].forEach(fn => {
  assert(new RegExp('\\b' + fn + '\\s*\\(').test(home), 'method ' + fn);
});
assert(!/onNotifToggle/.test(home), '首页已移除旧的内联 onNotifToggle');
assert(/act === 'goto-notif'/.test(home), 'onDlgYes 处理了 goto-notif（跳通知使用权设置）');
assert(/fgsvc\.openNotifSettings\(\)/.test(home), 'goto-notif 出口调用 fgsvc.openNotifSettings');

console.log('== 3b. 收拢后的四组（★ 跟专注有关的都在这张卡里，不散在首页各处）==');
// 需求原文："将跟专注设置有关的都弄在首页右上角的专注设置里面"。
// 以前卡片只有三项（强制 / 拦截 / 自动休息），时长、响铃、白噪音还得进专注页改 ——
// 那就是"设置散在两处"，跟收拢的初衷相反。
const sheet = home.slice(home.indexOf('class="fs-mask"'), home.indexOf('<float-tabbar ref="tabbar"'));
assert(sheet !== '', '能切出「专注设置」卡片整块');
['时长', '结束提醒', '白噪音', '管住自己'].forEach(g => {
  assert(sheet.indexOf("$t('" + g + "')") >= 0, '卡片有分组「' + g + '」');
});
// ① 时长：两个档位排 —— 一段专注 / 一段休息
assert(/setFocusMin\(m\)/.test(sheet) && /setRestMin\(m\)/.test(sheet), '时长两排接 setFocusMin / setRestMin');
const bSetMin = block(home, /setFocusMin\(m\)\s*\{[\s\S]*?\n    \}/);
assert(/focus\.setCfg\(\{\s*focus: m\s*\}\)/.test(bSetMin),
  '★ 专注时长写进 focus.setCfg（pomoCfg）—— 不另存一份，否则首页改了专注页还是旧值');
const bSetRest = block(home, /setRestMin\(m\)\s*\{[\s\S]*?\n    \}/);
assert(/focus\.setCfg\(\{\s*rest: m\s*\}\)/.test(bSetRest), '休息时长同样写进 focus.setCfg');
assert(/pc\.focus \|\| 25/.test(home) && /pc\.rest \|\| 5/.test(home),
  '刷新时从 pomoCfg 读回时长（离开设置页回来要同步）');
// ★ 档位两处必须逐项一致：首页写一套、专注页写另一套的话，
//   在专注页选了 20 分钟再回首页，会变成"没有一个档位亮着"（看着像设置没生效）。
const optsOf = (src, key) => {
  const m = src.match(new RegExp(key + ':\\s*\\[([^\\]]*)\\]'));
  return m ? m[1].replace(/\s/g, '') : '';
};
const homeOpts = optsOf(home, 'focusMinOpts');
const focusOpts = optsOf(focusPage, 'minutesOptions');
assert(homeOpts !== '' && focusOpts !== '', '两边都取得到时长档位（' + homeOpts + ' / ' + focusOpts + '）');
assert(homeOpts === focusOpts, '首页档位与专注页 minutesOptions 逐项一致（不许分叉）');
// ② 结束提醒
assert(/tapSound/.test(sheet) && /tapVibe/.test(sheet), '结束响铃 / 结束震动接 tapSound / tapVibe');
assert(/saveFocus\('sound'/.test(home) && /saveFocus\('vibe'/.test(home), '响铃 / 震动落盘走 saveFocus');
// ③ 白噪音：关 = 空串（与专注页同口径），音色只在开着时出现
assert(/tapNoise/.test(sheet) && /pickNoise\(n\.k\)/.test(sheet), '白噪音开关与音色接 tapNoise / pickNoise');
const bNoise = block(home, /tapNoise\(\)\s*\{[\s\S]*?\n    \}/);
assert(/next \? \(this\.noiseKind \|\| 'rain'\) : ''/.test(bNoise),
  '白噪音关 = 写空串（空串就是关，与专注页同口径）');
assert(/v-if="noiseOn"/.test(sheet), '音色排在开关之下、只在开着时出现（关着不多占一行）');
// ④ 管住自己
assert(/tapStrict/.test(sheet) && /saveFocus\('strict'/.test(home), '严格模式接 tapStrict 且落盘');
const bStrict = block(home, /tapStrict\(\)\s*\{[\s\S]*?\n    \}/);
assert(/strict\.sync\(\)/.test(bStrict), '改完严格模式立刻 strict.sync()（不然开关与真实状态分叉）');

console.log('== 3c. 卡片装得下（内容从 3 项扩到 10 项）==');
// 十行塞在一张卡里，不滚的话小屏上下面几行永远点不到 —— 这是"能用到"的底线，不是美观。
assert(/<scroll-view class="fs-body" scroll-y>/.test(sheet), '卡片内容装在 scroll-view 里（可滚）');
const bBody = blockCss(home, /\.fs-body \{[^}]*\}/);
assert(/max-height/.test(bBody), '.fs-body 限高（不然十行撑满整屏、遮罩点不到）');
// 分组插进来后 :last-child 不再是最后一行，最后那条分隔线要显式收掉
assert(/\.fc-row\.is-last \{ border-bottom: none/.test(home), '最后一行显式去掉分隔线（is-last）');
// 更深的几项留在专注页，首页面板只给出口
assert(/goFocusSet/.test(sheet) && /@tap="goFocusSet"/.test(sheet), '底部有「更多专注设置」出口');
const bGoSet = block(home, /goFocusSet\(\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.focusSheet = false/.test(bGoSet) && /this\.goFocus\(\)/.test(bGoSet),
  '出口先收卡片再跳专注页（不收的话跳回来卡片还浮在脸上）');
// 顶栏那颗入口的高亮要跟着"有没有开着"走 —— 新增三组后不能再只数原来三项
const bFocusOn = block(home, /focusSetOn\(\)\s*\{[\s\S]*?\n    \}/);
assert(/forcedOn \|\| this\.blockNotifOn \|\| this\.autoRestOn/.test(bFocusOn) &&
  /this\.strictOn \|\| this\.noiseOn/.test(bFocusOn),
  'focusSetOn 覆盖严格模式与白噪音（新增项也算"正在被管着"）');
assert(/:focus-on="focusSetOn"/.test(home), '顶栏 :focus-on 接 focusSetOn');
// 音色的中文名必须走 $t：字面量数组在 i18n init 前求值，切英文不重算，还会被算成漏网文案
const bKinds = block(home, /noiseKinds\(\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.\$t\('白噪'\)/.test(bKinds) && /this\.\$t\('雨声'\)/.test(bKinds),
  '音色名走 $t()（字面量数组会被算成漏网的静态中文）');

console.log('== 4. 新文案全部进入英文表（漏译会被 check-i18n 第 5 节抓，这里先守一遍） ==');
const newKeys = [
  '专注设置', '强制模式', '离开学习 App 立刻拉回',
  '专注时收起别家通知', '专注结束自动休息', '强制模式需开启「显示在其他应用上层」',
  '时长', '一段专注', '一段休息', '结束提醒', '结束响铃', '结束震动',
  '白噪音', '管住自己', '严格模式', '更多专注设置 ›',
  '白噪', '粉噪', '棕噪', '雨声'
];
newKeys.forEach(k => assert(en.indexOf("'" + k + "'") >= 0, 'i18n-en 含 key「' + k + '」'));

console.log('== 5. fgsvc 仍提供拦截授权依赖 ==');
assert(/notifGranted/.test(fgsvc), 'fgsvc 提供 notifGranted（授权判定）');
assert(/openNotifSettings/.test(fgsvc), 'fgsvc 提供 openNotifSettings（跳设置页）');

console.log('== 6. 圆圈衔接转场（点首页大圆 → 专注页，两个圆对齐不错位）==');
// 2026-10-25 用户拍板："点击圆圈，到专注那个页面最好有一个动画，两个圆圈之间并且要对齐。"
// 实现是共享元素思路：首页圆放大盖住全屏 → 跳转 → 专注页圆从同一放大态缩回就位。
// ① 首页侧：先播动画再跳，且倍数实测
const bQuick = block(home, /quickStart\(\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.launchRing = true/.test(bQuick), '点圆先置 launchRing（播放大动画，不裸跳页）');
assert(/setTimeout/.test(bQuick) && /this\.focusUrl\(true\)/.test(bQuick), '动画后带 zoom=1 跳专注页');
assert(/if \(this\.launchRing\) return/.test(bQuick), '转场播放中连点不重复跳');
assert(/if \(zoom\) q\.push\('zoom=1'\)/.test(home), 'focusUrl 支持 zoom 参数');
assert(/this\.launchRing = false/.test(home), '回首页复位 launchRing（下次点圆还能再播）');
// ② 模板接线
assert(/class="hero-main" :class="\{ 'ring-launch': launchRing \}"/.test(home),
  'hero-main 挂 ring-launch（首屏其余内容同步淡出）');
assert(/hc-ring-run': running, 'ring-launch': launchRing/.test(home), '大圆挂 ring-launch');
assert(/:style="ringVars"/.test(home), '大圆绑 ringVars（--launch-scale）');
// ③ 放大倍数必须实测：480rpx 只等于屏宽 64%，写死 750/480 盖不满屏高，
//   转场中间态上下露一圈底色，两个圆就"对不齐"了（用户原话就是要对齐）
const bScale = block(home, /launchScale\(\)\s*\{[\s\S]*?\n    \}/);
assert(/Math\.max\(w, h\) \/ ringPx/.test(bScale) && /480 \* w \/ 750/.test(bScale),
  'launchScale 实测：480rpx 圆放大到盖住屏宽/屏高的较大者（不写死）');
// ④ CSS：过渡要在，且规则顺序必须排在按压态之后（特异性打平，位置定胜负）
assert(/\.tp-block\.focus-card \.hc-ring\.ring-launch \{[\s\S]*?transition: transform 260ms/.test(home),
  '放大带 260ms transition（没过渡就是硬切，没有"动画"）');
// ⚠️ 必须先剥注释再比位置：CSS 注释里写着"必须排在 :active 之后"，不剥的话
//    indexOf 永远先命中注释里的 :active —— 断言恒真，排反了也抓不到（假绿实锤）。
const cssNoCmt = home.replace(/\/\*[\s\S]*?\*\//g, '');
assert(cssNoCmt.indexOf('.tp-block.focus-card:active .hc-ring {') <
  cssNoCmt.indexOf('.tp-block.focus-card .hc-ring.ring-launch {'),
  '转场规则排在按压态之后（排前面会被 :active 的 scale(0.965) 压住，圆停在原地直接跳页）');
assert(/\.hero-main\.ring-launch [\s\S]*?opacity: 0/.test(home), '首屏其余内容同步淡出（只剩圆）');
// ⑤ 专注页侧：从同一放大态缩回就位
assert(/query && query\.zoom/.test(focusPage), 'focus onLoad 认 zoom=1');
const bLoad = block(focusPage, /onLoad\(query\)\s*\{[\s\S]*?\n  \}/);
assert(/this\.ringIntro = true/.test(bLoad), 'zoom 进来先置 ringIntro（初始就是放大态）');
assert(/480 \* w \/ 750/.test(bLoad), 'coverScale 与首页同一算法（两边倍数不一致，收缩终点对不上）');
const bShow = block(focusPage, /onShow\(\)\s*\{[\s\S]*?\n  \}/);
assert(/try \{ this\.armIntro\(\) \} catch \(e\) \{ this\.ringIntro = false \}/.test(bShow),
  'onShow 调 armIntro 且自带 try（armIntro 炸了也不能拖垮后面的 refresh）');
// ★ 2026-10-26 真机反馈："安卓基座上进专注页动画有问题，电脑端正常"。
//   当时的修法是三条 JS 信号摘 intro；2026-10-27 用户真机录屏逐帧核对：
//   圆放大后**定格一秒多**、专注页整个直接弹出（收缩动画全被吞）—— 根因是
//   App 端"渲染先行、上屏在后"，rAF/exec 在人看见页面之前就回调了。
//   10-27 修法：收缩改 CSS animation **自播放**（起跑点焊在首帧），armIntro
//   只挂 animationend 收口 + 600ms 兜底定时器。
//   ⚠️ 下面每条都必须从 armIntro 的**函数体**里取：跨段正则会吃到后面的对其他断言 → 假绿。
const bArm = block(focusPage, /    armIntro\(\)\s*\{[\s\S]*?\n    \}/);
assert(bArm !== '', 'armIntro 方法存在（intro 收尾独占一个方法，不散在 onShow 里）');
// ★ 这两条是 10-27 那一枪的"不许复发"：rAF / selectQuery 都会在页面还没显示
//   给人看时回调，拿它们摘 intro = 收缩动画播完人才看见 = 白做。
assert(!/requestAnimationFrame/.test(bArm),
  'armIntro 里不许出现 rAF（渲染先行上屏在后，提前摘 intro 会吞掉收缩动画）');
assert(!/createSelectorQuery/.test(bArm),
  'armIntro 里不许出现 selectQuery.exec 当上屏信号（同样会提前于"人看见"）');
assert(/setTimeout\(this\._introDone, 600\)/.test(bArm),
  '兜底定时器 600ms（老内核不认 keyframes 时退回 transition 收缩，不许永久盖屏）');
assert(/if \(!self\.ringIntro || !self\._introDone\) return/.test(bArm),
  '收口只摘一次（intro 被摘两遍 = 在已就位的圆上重放一次收缩）');
assert(/clearTimeout\(self\._introProbeT\)/.test(bArm), '收口立刻清掉兜底定时器');
assert(/@animationend="onIntroEnd"/.test(focusPage),
  '.ring 绑 @animationend（收缩动画播完的收口主路径）');
assert(/    onIntroEnd\(\w*\)\s*\{[\s\S]*?if \(this\._introDone\) this\._introDone\(\)/.test(focusPage),
  'onIntroEnd 存在且只做一件事：intro 在播就收口（ring-pulse 的 end 也会进来，得防误摘）');
assert(/clearTimeout\(this\._introProbeT\)/.test(block(focusPage, /onHide\(\)\s*\{[\s\S]*?\n  \}/)),
  'onHide 收掉 probe（页面都切走了，不该还留着去摘 intro）');
assert(/clearTimeout\(this\._introProbeT\)/.test(block(focusPage, /onUnload\(\)\s*\{[\s\S]*?\n  \}/)),
  'onUnload 收掉 probe');
// App 端新页面自带 slide-in-right，与"圆从放大态缩回"同时各跑各的 → 抖一下
assert(/animationType: 'none'/.test(bQuick),
  '这一跳关掉 App 系统窗口动画（H5 本来没有这层，所以电脑端正常、安卓不对劲）');
// intro 的起点同时写行内：CSS 变量要过一轮 resolve，个别 App 内核上不稳
const bRingStyle = block(focusPage, /ringStyle\(\)\s*\{[\s\S]*?\n    \}/);
assert(/if \(this\.ringIntro\) st\.transform = 'scale\(' \+ this\.coverScale \+ '\)'/.test(bRingStyle),
  'intro 的放大起点写成行内值（变量那份留着兜底，行内是硬承诺）');
assert(/backgroundColor: 'rgba\(23,32,26,0\.08\)'/.test(bRingStyle),
  'conic-gradient 有纯色兜底（老安卓认不出会整条丢掉 background，圆环当场消失）');
assert(/'fr-intro': ringIntro/.test(focusPage), 'focus 根节点挂 fr-intro');
assert(/:style="\[appBgStyle, introVars\]"/.test(focusPage), 'focus 根绑 introVars（--cover-scale）');
// ⑥ 收缩过程不跳色：intro 期 ring-inner 换成首页大圆的皮肤，渐变回玻璃盘
const cssRingInner = blockCss(focusPage, /\.fr-intro \.ring-inner \{[\s\S]*?\n\}/);
// ⚠️ 断言要精确到属性：块里 border-color 也写着 brand-rgb，只查"块内有没有
//    brand-rgb"的话，删掉 background 那行照样算过（假绿）。
assert(/background: rgba\(var\(--brand-rgb/.test(cssRingInner) &&
  /border-color: rgba\(var\(--brand-rgb/.test(cssRingInner),
  'intro 期 ring-inner 换首页大圆皮肤（淡红底 + 红边，收缩中渐变回玻璃）');
// ★ intro 态必须关毛玻璃：backdrop-filter 每帧把身后整个屏幕重新模糊一遍，
//   intro 态圆盖住全屏 = 每帧全屏重模糊 —— 安卓上收缩动画直接掉成幻灯片
assert(/backdrop-filter: none/.test(cssRingInner),
  'intro 期关掉 backdrop-filter（全屏逐帧重模糊会把收缩拖成幻灯片）');
const cssRing = blockCss(focusPage, /\.fr-intro \.ring \{[\s\S]*?\n\}/);
assert(/scale\(var\(--cover-scale/.test(cssRing), 'intro 态 ring 放大到全屏');
assert(/animation: fr-ring-drop 260ms/.test(cssRing),
  '收缩走 CSS animation 自播放（起跑点焊在首帧，不靠 JS 信号 —— 10-27 实锤）');
assert(/@keyframes fr-ring-drop \{[\s\S]*?scale\(var\(--cover-scale[\s\S]*?scale\(1\)/.test(focusPage),
  'fr-ring-drop keyframes 在（从 cover-scale 缩到 1）');
assert(/@keyframes fr-skin-back \{/.test(focusPage) && /@keyframes fr-fade-in \{/.test(focusPage),
  '皮肤回玻璃 / 文字淡入各有自播放 keyframes（与收缩同一首帧起跑点）');
// ★ 基态必须显式 scale(1)：从 none 起算到 scale(N) 的插值，部分安卓 WebView 不补
//   中间帧、直接跳到终点 —— 症状就是"手机没动画、电脑上有"。
const cssRingBase = blockCss(focusPage, /\.ring \{[\s\S]*?\n\}/);
assert(/transform: scale\(1\)/.test(cssRingBase),
  'ring 基态显式 transform: scale(1)（none↔scale 的插值各家实现松紧不一）');
assert(/will-change: transform/.test(cssRingBase),
  'ring 提合成层（will-change：不提前提层，缩放每帧都在重绘含投影）');
assert(/\.fr-intro \.focus-body > \*:not\(\.ring-wrap\) \{ opacity: 0/.test(focusPage),
  '圆外内容 intro 期让位（随圆收缩一起淡入）');
// ⑦ 首页大圆同样要提合成层：放大到盖满全屏的动画不能逐帧重绘
assert(/will-change: transform/.test(blockCss(home, /\.tp-block\.focus-card \.hc-ring \{[\s\S]*?\n\}/)),
  '首页大圆提合成层（will-change：放大动画整个走 GPU）');
// ⑧ 转场期间 onShow 只做轻活：原生权限实测/图标读取延到 deferredChecks
assert(/_deferT = setTimeout/.test(bShow), 'onShow 把重活挂到 _deferT 定时器（intro 别被拖住）');
assert(!/hasUsagePermission\(\)/.test(bShow) && !/refreshLearnApps\(\)/.test(bShow),
  'onShow 里不许直接跑原生实测/图标读取（首帧被拖住 = 定格一秒再弹出）');
const bDef = block(focusPage, /    deferredChecks\(\)\s*\{[\s\S]*?\n    \}/);
assert(bDef !== '' &&
  /hasUsagePermission/.test(bDef) && /canDrawOverlays/.test(bDef) &&
  /refreshLearnApps/.test(bDef) && /refreshForceCap/.test(bDef),
  'deferredChecks 收齐那批重体检（usage/overlay/图标/强制能力，晚 320ms 补跑）');

console.log('== 6b. 点出（专注页返回）也要有动画，且是同一条的正反两遍 ==');
// 2026-10-29 用户录屏："点进和点出的动画都还有问题"。逐帧核对出三处：
//  ① 点进时圈内读数先做 140ms 淡出，圆那时已经放大 3 倍多 → 一屏巨字（两侧都有）
//  ② 专注页 intro 期圈内文字 60ms 就淡入 → 半透明巨字横穿屏幕
//  ③ 点出**根本没有动画**：系统窗口动画送走，首页那一帧是一整块盖满屏的粉色再弹回
// ①③ 的修法：文字当帧消失；点出由专注页"圆放大盖屏 → navigateBack(none)"、
//   首页"同一颗圆缩回就位"接力完成。
assert(/'fr-intro': ringIntro[\s\S]{0,90}'fr-exit': ringExit/.test(focusPage) &&
  /'fr-hide': ringHide/.test(focusPage),
  'focus 根节点挂 fr-intro / fr-exit / fr-hide（两个方向 + 转场期内容让位）');
assert(/this\.zoomIn = true/.test(block(focusPage, /onLoad\(query\)\s*\{[\s\S]*?\n  \}/)),
  'onLoad 记下"是从首页大圆点进来的"（zoomIn）');
const bExit = block(focusPage, /    playExit\(\)\s*\{[\s\S]*?\n    \}/);
assert(bExit !== '', 'playExit 方法存在（点出转场独占一个方法）');
assert(/if \(!this\.zoomIn\) \{/.test(bExit),
  '不是从大圆进来的入口不播点出动画（没有同一个圆可衔接，会从圆的原地炸开）');
assert(/this\.ringExit = true/.test(bExit), 'playExit 置 ringExit（圆开始放大）');
assert(/if \(this\._exitT\) return/.test(bExit), '连点只退一次（不重复放大 / 重复导航）');
assert(/if \(this\.ringIntro\) \{[\s\S]*?this\.leaveNow\(\)/.test(bExit),
  'intro 还没播完就返回：不再放大一遍（否则 fr-intro / fr-exit 抢同一条动画，圆先弹回再放大）');
const bLeave = block(focusPage, /    leaveNow\(\)\s*\{[\s\S]*?\n    \}/);
assert(bLeave !== '' && /navigateBack\(\{ delta: 1, animationType: 'none' \}\)/.test(bLeave),
  '点出这一跳关掉系统窗口动画（否则平移和缩放各跑各的）');
assert(/pages\.length > 1[\s\S]*?switchTab\(\{ url: '\/pages\/home\/home' \}\)/.test(bLeave),
  '栈底时退回首页（不然人被困在一块盖满屏的粉色上）');
const bNavBack = block(focusPage, /    onNavBack\(veto\)\s*\{[\s\S]*?\n    \}/);
assert(/this\.playExit\(\)/.test(bNavBack) && /veto\(\)/.test(bNavBack),
  '顶栏返回键也走 playExit，并否决导航栏自己的 navigateBack（两条入口一套动画）');
const bBackPress = block(focusPage, /onBackPress\(\)\s*\{[\s\S]*?\n  \}/);
assert(/this\.playExit\(\)/.test(bBackPress) && /return true/.test(bBackPress),
  '物理返回键由本页接管（return true + playExit，不裸退）');
assert(/this\.backBlocked\(\)[\s\S]*?return true/.test(bBackPress),
  '强制模式按住那一条仍排在接管之前（拦截优先级不许被动画抢走）');
const cssExitRing = blockCss(focusPage, /\.fr-exit \.ring \{[\s\S]*?\n\}/);
assert(/animation: fr-ring-rise 240ms/.test(cssExitRing),
  '点出放大走 CSS animation 自播放（同 intro，不靠 JS 信号）');
assert(/@keyframes fr-ring-rise \{[\s\S]*?scale\(1\)[\s\S]*?scale\(var\(--cover-scale/.test(focusPage),
  'fr-ring-rise 从 1 放大到 cover-scale（终态与首页那颗圆的放大态一致）');
const cssExitInner = blockCss(focusPage, /\.fr-exit \.ring-inner \{[\s\S]*?\n\}/);
assert(/background: rgba\(var\(--brand-rgb/.test(cssExitInner) && /backdrop-filter: none/.test(cssExitInner),
  '放大期间换首页大圆皮肤并关毛玻璃（navigateBack 那一帧不许跳色 / 逐帧重模糊）');
const cssExitTxt = blockCss(focusPage, /\.fr-exit \.ring-inner \.time,\s*\.fr-exit \.ring-inner \.task-title \{[^}]*\}/);
assert(/opacity: 0/.test(cssExitTxt) && /transition: none/.test(cssExitTxt),
  '点出时圈内读数**当帧**消失（淡出就是跟着圆放大的巨字）');
assert(/\.fr-exit \.focus-body > \*:not\(\.ring-wrap\) \{ opacity: 0; transition: none; \}/.test(focusPage),
  '圆外内容点出时也不许留在屏上（圆盖满之前必须让位）');
// ★ 2026-10-30：不再用"固定延时淡入"（200ms 那条在华为系 WebView 上会露出巨字 ——
//   fr-ring-drop 被整条丢弃时圆定格 600ms）。改成 .fr-hide 由 JS 量到落位再摘。
assert(/\.fr-hide \.ring-inner \.time[\s\S]{0,220}opacity: 0/.test(focusPage),
  'intro 期内容让位改由 .fr-hide 控制（等圆真落位再淡入，不再赌固定延时）');
assert(!/\.fr-intro \.ring-inner \.time[\s\S]{0,90}animation: fr-fade-in/.test(focusPage),
  '不许再给圈内文字挂固定延时的 fr-fade-in（正是巨字的来处）');
// ---- 首页侧：接力缩回 ----
assert(/'ring-return': ringReturn/.test(home), '首页大圆挂 ring-return（点出的收缩段）');
assert(/this\.launchRing = false/.test(home), '回首页复位 launchRing（下次点圆还能再播）');
const bRet = block(home, /    startRingReturn\(\)\s*\{[\s\S]*?\n    \}/);
assert(bRet !== '', 'startRingReturn 存在（点出接力段独占一个方法）');
assert(/this\.ringReturn = true/.test(bRet) && /this\.launchRing = false/.test(bRet),
  '接力：摘 launchRing（内容让位交给 ring-return）并起圆');
assert(/setTimeout\(\(\) => \{[\s\S]*?\}, 60\)/.test(bRet),
  '延 60ms 再起跑（onShow 早于上屏，当场挂 class = 播给看不见的页面）');
assert(/this\.ringReturn = false/.test(bRet), '动画播完摘 ring-return（终点 == 静止态，不跳）');
assert(/if \(this\.launchRing\) \{\s*this\.startRingReturn\(\)/.test(block(home, /onShow\(\)\s*\{[\s\S]*?\n  \},/)),
  'onShow 里 launchRing 还在 → 走接力缩回（不是当场弹回去）');
const cssRet = blockCss(home, /\.tp-block\.focus-card \.hc-ring\.ring-return \{[\s\S]*?\n\}/);
assert(/animation: hc-ring-land 260ms/.test(cssRet), 'ring-return 走 animation 自播放');
assert(/@keyframes hc-ring-land \{[\s\S]*?scale\(var\(--launch-scale[\s\S]*?scale\(1\)/.test(home),
  'hc-ring-land 从 launch-scale 缩到 1（与专注页放大终态同一个倍数）');
// ⚠️ hc-breath 是 infinite：声明排在 ring-return 之后就会压掉缩放（圆停在 1 倍不动）
const cssHomeNoCmt = home.replace(/\/\*[\s\S]*?\*\//g, '');
assert(cssHomeNoCmt.indexOf('.hc-ring-run {') < cssHomeNoCmt.indexOf('.hc-ring.ring-return {'),
  'ring-return 规则排在 .hc-ring-run 之后（否则正在专注时 hc-breath 把收缩动画压掉）');
assert(/\.tp-block\.focus-card \.hc-ring\.ring-launch \{ animation: none; \}/.test(cssHomeNoCmt),
  'ring-launch 期关掉 hc-breath（呼吸动画会把 coverScale 顶掉，圆缩在半路）');
const cssLaunchTxt = blockCss(home, /\.tp-block\.focus-card \.hc-ring\.ring-launch \.hc-ring-num,[\s\S]*?\n\}/);
assert(/transition: none/.test(cssLaunchTxt),
  '点进时圈内读数当帧消失（原来是 140ms 淡出 → 一屏巨字）');
const cssRetFade = blockCss(home, /\.today-panel\.ring-return \.tp-head,[\s\S]*?\n\}/);
assert(/animation: hc-fade-in/.test(cssRetFade), '首屏其余内容跟着圆落位淡回来');

console.log('== 7. 圆盘即开始键（2026-10-25 用户拍板：删掉「开始专注 N 分钟」按钮）==');
// 用户："把开始专注融入到圆圈里面，不需要单独的 Button 按钮。直接点击中间那个圆圈就可以了，
//       并且同样要有跳动（略微的放大缩小）的动画，有震动。"
// ① 开始按钮必须彻底消失 —— 它纯粹是多余的一层（页面里已经有时长选择）
assert(!/start-btn/.test(focusPage) && !/class="start-wrap"/.test(focusPage),
  '开始按钮整体删除（无 start-wrap / start-btn）');
assert(!/开始专注 \{\{ minutes/.test(focusPage), '模板里不再有「开始专注 N 分钟」按钮文案');
// ② 圆盘承接点击：ring-wrap 直接 @tap 到 onRingTap
assert(/class="ring-wrap" @tap="onRingTap"/.test(focusPage), 'ring-wrap 接 @tap="onRingTap"（点圆任意处起表）');
const bRingTap = block(focusPage, /onRingTap\(\)\s*\{[\s\S]*?\n    \}/);
assert(bRingTap !== '', 'onRingTap 方法存在');
assert(/if \(this\.active\) return/.test(bRingTap), '跑起来之后点圆不起表也不放弃（防误触）');
assert(/hapticTick\(/.test(bRingTap), '点圆有震动反馈（hapticTick）');
assert(/this\.beginFocus\(\)/.test(bRingTap), '点圆直接起表（调 beginFocus）');
// ③ 跳动动画：ring-pulse keyframes（1 → 1.045 → 1，不能用 transition，否则变大不回）
const cssPulse = blockCss(focusPage, /\.ring-pulse \{[\s\S]*?\n\}/);
assert(/\.ring-pulse \{ animation: ring-pulse/.test(focusPage) &&
  /@keyframes ring-pulse \{[\s\S]*?scale\(1\.045\)[\s\S]*?scale\(1\)/.test(focusPage),
  '点圆有跳动动画（ring-pulse：略微放大缩小一跳，keyframes 而非 transition）');
assert(/:class="\{ 'ring-pulse': ringPulse \}"/.test(focusPage), 'ring 挂 ring-pulse（onRingTap 置位）');
// ④ 圆盘内任务名点开不误触发起表：toggleTitle 必须 .stop，否则冒泡到 ring-wrap 起表
assert(/@tap\.stop="toggleTitle"/.test(focusPage), '圆盘内任务名点开用 .stop（不冒泡误起表）');

console.log('== 8. 两个圆的读数字体同源（2026-10-26 真机反馈）==');
// 用户："首页圆盘里面的字体和专注页面里面的字体不一样，统一一下，不然影响观感。"
// 这两个圆是**同一个视觉主体的两个状态**（首页大圆 → 点开 → 专注页圆盘），
// 字体不同，转场中间那一下就看得出"换了一个东西"。
// ⚠️ blockCss 先剥注释：注释里在讨论 font-family 这几个字，不剥就永远查不出问题。
const cssTime = blockCss(focusPage, /\.time \{[\s\S]*?\n\}/);
const cssRingNum = blockCss(home, /\.tp-block\.focus-card \.hc-ring-num \{[\s\S]*?\n\}/);
assert(cssTime !== '' && cssRingNum !== '', '取出两个圆的读数样式块');
// ★ 断言精确到"不许出现 font-family"：只要谁给其中一个加了具体族名就立刻红。
//   安卓上一套衬线字体都没有，写了 Georgia 的那边会退到 Noto Serif，两个圆当场分家。
assert(!/font-family/.test(cssTime),
  '专注页 .time 不写具体族名（走 App.vue 的 --app-font 继承链）');
assert(!/font-family/.test(cssRingNum),
  '首页 .hc-ring-num 不写具体族名（两边同源；用户换过的字体也跟得上）');
assert(!/Georgia/.test(cssTime) && !/Georgia/.test(cssRingNum),
  '两个圆都不许出现 Georgia（安卓没有，会退到 Noto Serif）');
assert(/font-weight: 600/.test(cssTime) && /font-weight: 600/.test(cssRingNum),
  '两个圆的字重一致（衬线换无衬线后视觉轻一档，大号要补回来）');
assert(/letter-spacing: 2rpx/.test(cssTime) && /letter-spacing: 2rpx/.test(cssRingNum),
  '两个圆的字间距一致（同一串 "25:00"）');
assert(/text-indent: 2rpx/.test(cssTime) && /text-indent: 2rpx/.test(cssRingNum),
  '两个圆都补了等量缩进（letter-spacing 会在最后一个字符后留一份，整串看着偏左）');
// 同一份约束力要覆盖到"别的画面里的同一个读数"：硬控遮罩的大计时、结算卡的小读数，
// 展示的都是同一串 MM:SS —— 只盯着两个圆，别处照样分家。
const cssLockTime = blockCss(home, /\.lock-time \{[\s\S]*?\n\}/);
const cssFcTime = blockCss(home, /\.fc-time \{[\s\S]*?\n\}/);
assert(cssLockTime !== '' && cssFcTime !== '', '取出硬控遮罩 / 结算卡的计时读数样式块');
assert(!/font-family|Georgia/.test(cssLockTime), '硬控遮罩大计时不写具体族名（同源）');
assert(!/font-family|Georgia/.test(cssFcTime), '结算卡计时读数不写具体族名（同源）');

console.log('== 9. intro 收尾真跑（2026-10-30 三定时器：看门狗 / 兜底 / 内容释放）==');
// 静态断言只能证明"字写上了"；这段是纯粹的时序逻辑，必须跑。
// ⚠️ 从源码里抠函数体来跑，而不是复写一遍 —— 复写的那份和源码分叉了照样全绿。
{
  const src = block(focusPage, /    armIntro\(\)\s*\{[\s\S]*?\n    \}/);
  const srcEnd = block(focusPage, /    onIntroEnd\(\w*\)\s*\{[\s\S]*?\n    \}/);
  const srcStart = block(focusPage, /    onIntroStart\(\w*\)\s*\{[\s\S]*?\n    \}/);
  // ⚠️ 抠不到就必须**报红**，不许往下跑到 ReferenceError —— 护栏崩掉在批量回归里
  //    会被当成"这节跑完了"，是最典型的假绿。
  assert(src !== '', '抠得出 armIntro（抠不到 = 这一节整个没跑，等于没有护栏）');
  assert(srcEnd !== '', '抠得出 onIntroEnd（animationend 收口那个方法）');
  assert(srcStart !== '', '抠得出 onIntroStart（关键帧起跑信号）');
  if (src !== '' && srcEnd !== '' && srcStart !== '') {
    const toBody = (s) => {
      const b = s.slice(s.indexOf('{') + 1, s.lastIndexOf('}'));
      return 'const self = HOST;\n' + b.replace('const self = this', '').split('this.').join('self.');
    };
    const arm = new Function('HOST', 'setTimeout', 'clearTimeout', toBody(src));
    const fin = new Function('HOST', 'setTimeout', 'clearTimeout', 'e', toBody(srcEnd));
    const startFn = new Function('HOST', 'clearTimeout', 'e', toBody(srcStart));

    /** 造一个宿主 + 一组可控替身：定时器按 ms 记账，按需手工触发。 */
    const mk = () => {
      let ri = true; let sets = 0; let id = 0;
      const timers = [];
      const host = {
        ringHide: true, _ringKfStarted: false,
        _introProbeT: null, _introFadeT: null, _ringKfT: null, _ringHideT: null, _introDone: null,
        get ringIntro() { return ri; },
        set ringIntro(v) { ri = v; sets++; }
      };
      const st = (fn, ms) => { const t = { fn, ms, id: ++id, cleared: false }; timers.push(t); return t.id; };
      const ct = (tid) => { const t = timers.find((x) => x.id === tid); if (t) t.cleared = true; };
      return {
        host, timers,
        get sets() { return sets; },
        run: () => arm(host, st, ct),
        end: () => fin(host, st, ct, { animationName: 'fr-ring-drop' }),
        start: () => startFn(host, ct, { animationName: 'fr-ring-drop' }),
        pending: (ms) => timers.find((t) => t.ms === ms && !t.cleared)
      };
    };
    const fire = (t) => { if (t && !t.cleared) { t.cleared = true; t.fn(); } };

    // ① zoom 进来：挂看门狗(150) + 兜底(600)，当场不摘
    const a = mk(); a.run();
    assert(!!a.pending(150), '挂 150ms 关键帧看门狗（ms=' + a.timers.map((t) => t.ms) + '）');
    assert(!!a.pending(600), '挂 600ms 兜底定时器');
    assert(a.sets === 0, 'armIntro 自己不摘 intro（抢在首帧前摘 = 收缩被吞，sets=' + a.sets + '）');

    // ② 关键帧真跑了：animationstart 收掉看门狗
    const b = mk(); b.run(); b.start();
    assert(!b.pending(150), 'animationstart 到了就收掉看门狗（关键帧已起跑，不再走 transition 兜底）');
    assert(b.host._ringKfStarted === true, 'onIntroStart 记下"关键帧已起跑"');

    // ③ 关键帧路径：animationend → 40ms → 摘 intro；内容再 40ms 后放（圆已落位）
    const c = mk(); c.run(); c.start(); c.end();
    assert(c.sets === 0, 'animationend 到了也不当场摘（sets=' + c.sets + '）');
    const cFade = c.pending(40);
    assert(!!cFade, 'animationend 排了一颗 40ms 收尾');
    if (cFade) fire(cFade);
    assert(c.sets === 1, '收尾到点才摘 intro（sets=' + c.sets + '）');
    assert(c.host.ringHide === true, '摘 intro 当场不放内容（必须等圆落位再淡入）');
    const cHide = c.pending(40);
    assert(!!cHide, '关键帧路径：摘完再排 40ms 放内容');
    if (cHide) fire(cHide);
    assert(c.host.ringHide === false, '关键帧路径 40ms 后内容淡入');

    // ④ 关键帧没跑（华为系把 fr-ring-drop 丢包）：看门狗 150ms 救场 → transition 收缩 → 300ms 后放内容
    const d = mk(); d.run();
    const dKf = d.pending(150);
    assert(!!dKf, '看门狗挂着（关键帧不来时它是唯一的路，别干等 600ms）');
    if (dKf) fire(dKf);
    assert(d.sets === 1, '看门狗到点摘 intro，让 transition 接管收缩（sets=' + d.sets + '）');
    assert(d.host.ringHide === true, '兜底路径也不当场放内容（还要等 transition 收缩完）');
    const dHide = d.pending(260);
    assert(!!dHide, '兜底路径排 260ms 再放内容（贴着 transition 260ms 收缩，落位即出数字、不空等）');
    if (dHide) fire(dHide);
    assert(d.host.ringHide === false, '兜底路径 300ms 后内容淡入');

    // ⑤ 不是 zoom 进来的（ringIntro=false）：什么都不许发生
    const e = mk(); e.host.ringIntro = false; e.run();
    assert(e.timers.length === 0, '非 zoom 进来不挂任何定时器（' + e.timers.length + '）');
    assert(e.host._introDone === null, '非 zoom 进来不留收口钩子（ring-pulse 的 end 无处可误摘）');

    // ⑥ 两条路重复到达也只摘一次（两次收缩会重影）
    const f = mk(); f.run(); f.start(); f.end();
    const fFade = f.pending(40); if (fFade) fire(fFade);
    const before = f.sets;
    f.end();                            // ring-pulse 那类 end 后到：_introDone 已置空，必须 no-op
    const fFade2 = f.pending(40); if (fFade2) fire(fFade2);
    assert(f.sets === before, '两条路重复到达也只摘一次（sets=' + f.sets + '）');
  }
}

console.log('');
console.log(fail === 0 ? '首页专注设置卡片校验全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);

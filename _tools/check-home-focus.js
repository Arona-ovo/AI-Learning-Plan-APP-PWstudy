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
assert(/@open-focus="toggleFocusSheet"/.test(home), '首页接住 open-focus → toggleFocusSheet');
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

console.log('');
console.log(fail === 0 ? '首页专注设置卡片校验全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);

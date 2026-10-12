// _tools/check-home-edit.js - 「首页卡片编辑（拖拽排序 / 收纳 / 加回）」契约校验（只读，不改源码）
//
// 为什么单独立一个：
//   这套交互是从 AWword 移植过来的，坏法全是**静默**的 —— 不报错、不崩、界面照常，
//   只是"点了没反应"或者"再也找不回来"：
//     · 番茄一跑起来首页被硬控，编辑态没收掉   → 把手浮在倒计时上面，点不动
//     · 条件卡（紧迫度 / 目标）编辑态不显形    → 平时又正好是空的，收纳后永远捞不回来
//     · 允许把卡全收干净                       → 首页变白板，用户以为 App 坏了
//     · 拖拽量的是 .card 而不是 .mod-wrap      → dragHeights 全 0，拖了不换位
//     · 抽屉写在 .page-slide 里面              → 切 tab 的滑动动画把抽屉一起带走
//     · 新增了模块却没加 v-if 分支             → 页面空白（uni 模板引用不存在的分支不报错）
//   这六条以前都只能通过"用一遍才发现"来兜，现在钉在这儿。
//
// 运行：node _tools/check-home-edit.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

/**
 * 剥注释后再匹配 —— 说明性注释会被自己的正则命中（本项目第 4 次踩）。
 *   · 整块 /* *\/ 注释
 *   · 整行 // 或 * 开头
 *   · 行尾 // 注释（排除 :// —— scheme 字符串里那个不是注释）
 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .filter((l) => !/^\s*(\*|\/\/)/.test(l))
    .join('\n');
}

const rawHome = R('pages/home/home.vue');
const home = strip(rawHome);
const lay = strip(R('utils/home-layout.ts'));
const tpl = home.slice(0, home.indexOf('\n<script'));
const sc = home.slice(home.indexOf('\n<script'), home.indexOf('\n<style'));
const css = home.slice(home.indexOf('\n<style'));

/**
 * 取一个方法 / 钩子的函数体（到它自己的收尾 `}` 为止）。
 *
 * ⚠️ 别用 /key[\s\S]*?xxx/ 这种无界写法：它会跨到后面别的方法里去，
 *    于是"这段删了"也照样命中同名代码 —— 反向测试第 7、10 条就是这么漏的。
 *    close = 收尾 `}` 前面的缩进（生命周期 2 空格，methods 里 4 空格）。
 */
function block(key, close) {
  const i = sc.indexOf(key);
  if (i < 0) return '';
  const j = sc.indexOf('\n' + close + '}', i);
  return j < 0 ? '' : sc.slice(i, j);
}

/** 模板里某个 class 出现处的 <view> 嵌套深度（用来判断"在不在 .page-slide 里"） */
function depthAt(needle) {
  const idx = tpl.indexOf(needle);
  if (idx < 0) return -1;
  const head = tpl.slice(0, idx);
  const open = (head.match(/<view\b[^>]*[^/]>/g) || []).length;
  const close = (head.match(/<\/view>/g) || []).length;
  return open - close;
}

/* ---------- 1. 编辑态与硬控互斥 ---------- */
console.log('== 1. 硬控让位（番茄一跑起来编辑态必须收掉） ==');
// 计时中整屏只剩倒计时，卡片区整个不渲染。编辑态若留在硬控屏上，
// 把手会浮在倒计时上面：看得见、点不动，而且没有任何报错。
assert(/if\s*\(v\)\s*this\.finishEdit\(\)/.test(block('locked(v) {', '    ')),
  'watch.locked 为真时 finishEdit()（硬控起 → 编辑态收）');
assert(/this\.finishEdit\(\)/.test(block('onHide() {', '  ')),
  'onHide 退出编辑态（回来时界面是简洁的）');
const back = block('onBackPress() {', '  ');
assert(/sheetShow[\s\S]*?editing[\s\S]*?finishEdit\(\)/.test(back),
  'onBackPress 先收抽屉、再退编辑态、最后才谈硬控拦截');
// 编辑 UI 必须住在 v-else（空闲态）那一支里，不能挂在硬控屏上
const dSlide = depthAt('class="page-slide');
const dFoot = depthAt('class="home-foot"');
const dList = depthAt('class="mod-list"');
assert(dSlide >= 0 && dList > dSlide && dFoot > dSlide,
  '编辑 UI（.mod-list / .home-foot）在 .page-slide 内部（跟着 v-else 一起被硬控换掉）');

/* ---------- 2. 条件卡编辑态必须显形 ---------- */
console.log('== 2. 条件卡编辑态显形（否则收纳后捞不回来） ==');
// 紧迫度 / 目标这两张卡平时是有条件才显示的（今天没任务 = 空环，没目标 = 空列表）。
// 如果编辑态也按这个口径过滤，用户一旦把它们收起来，它们就同时满足
// "不在布局里" 和 "平时不显示" —— 收纳区里根本不会出现，等于永久丢失。
assert(/cardOrder\(\)\s*\{[\s\S]*?if\s*\(this\.editing\)\s*return ids/.test(sc),
  'cardOrder 编辑态返回全部注册表卡片');
assert(/cardVisible\(id\)\s*\{[\s\S]*?id === 'urgency'[\s\S]*?!\s*this\.u\.empty/.test(sc),
  '浏览态紧迫度卡：u.empty（今天一个番茄都没排）时不显示');
assert(/cardVisible\(id\)\s*\{[\s\S]*?id === 'goal'[\s\S]*?goals\.length/.test(sc),
  '浏览态目标卡：没有进行中的目标时不显示');

/* ---------- 3. 不能把首页收成白板 ---------- */
console.log('== 3. 至少留一个组件 ==');
const stashBody = block('stashModule(id) {', '    ');
assert(/cardOrder\.length\s*<=\s*1[\s\S]{0,160}showToast/.test(stashBody),
  '只剩一张时拒绝收纳并给提示');
assert(/至少保留一个组件/.test(stashBody), '提示文案存在（英文表由 check-i18n 兜）');

/* ---------- 4. 拖拽：测量口径、落点口径、位移口径必须是同一套下标 ---------- */
console.log('== 4. 拖拽三处口径一致 ==');
// 量错了对象 → dragHeights 全 0 → dropIndex 永远返回 from → 拖了不换位，且不报错
assert(/selectAll\('\.mod-wrap'\)\.boundingClientRect/.test(block('beginDrag(i, clientY) {', '    ')),
  'beginDrag 量的是 .mod-wrap（不是 .card —— 卡片已不是 .page-slide 的直接子节点）');
assert(/layout\.dropIndex\(from,\s*this\.dragDy,\s*this\.dragHeights\)/.test(block('dragEnd() {', '    ')),
  'dragEnd 用纯函数 dropIndex(from, dy, heights) 算落点');
assert(/this\.dragIndex !== i/.test(block('wrapStyle(i) {', '    ')),
  'wrapStyle 只位移 dragIndex 那一张');
assert(/@touchmove="dragMove"[\s\S]*?@touchend="dragEnd"/.test(tpl),
  '.mod-list 上挂了 touchmove / touchend（手指抬起才落位）');
assert(/@touchstart="dragStart\(i, \$event\)"/.test(tpl) && /@mousedown="dragStartMouse\(i, \$event\)"/.test(tpl),
  '把手同时接触摸与鼠标（H5 桌面可拖）');
assert(/if\s*\(!this\.editing\)\s*return/.test(block('dragStart(i, e) {', '    ')),
  '非编辑态不响应拖拽（浏览时划卡片不该乱序）');

/* ---------- 5. 收纳 / 加回：只改布局，不动数据 ---------- */
console.log('== 5. 收纳与加回 ==');
assert(/layout\.stash\(id\)/.test(stashBody), '收纳走 layout.stash(id)');
assert(/this\.syncLayout\(\)/.test(stashBody), '收纳后立刻 syncLayout（不用重进页面）');
const restoreBody = block('restoreModule(id) {', '    ');
assert(/layout\.restore\(id\)/.test(restoreBody), '加回走 layout.restore(id)');
assert(/this\.syncLayout\(\)/.test(restoreBody), '加回后立刻 syncLayout');
assert(/layout\.stashed\(\)/.test(block('openSheet() {', '    ')),
  '抽屉列出 layout.stashed()（收纳区是派生的，不是另一份状态）');
// 收纳只是"从首页移除"，删除学习数据是另一回事，两者不能混
assert(!/removeStorage|removeItem|clear\(\)/.test(stashBody),
  '收纳不删任何存储（只是移出首页）');

/* ---------- 6. 抽屉必须浮在页面外层 ---------- */
console.log('== 6. 抽屉不在 .page-slide 里 ==');
// fixed 参照不能受切 tab 的滑动 transform 影响，否则抽屉会跟着页面一起滑走
const dMask = depthAt('class="sheet-mask"');
assert(dSlide >= 0 && dMask >= 0 && dMask === dSlide,
  '.sheet-mask 与 .page-slide 同级（在其之外，切 tab 不会被带走）');
assert(/\.sheet-mask\s*\{[^}]*position:\s*fixed/.test(css), '.sheet-mask 是 fixed');

/* ---------- 7. 遮罩与把手的层级 ---------- */
console.log('== 7. 编辑态遮罩 / 把手层级 ==');
// 遮罩挡住卡内点击（防止拖动时误触跳页），把手必须比它高，否则把手也被挡住 = 拖不动
const zShield = /\.mod-shield\s*\{[^}]*z-index:\s*(\d+)/.exec(css);
const zBar = /\.mod-bar\s*\{[^}]*z-index:\s*(\d+)/.exec(css);
assert(zShield && zBar && Number(zBar[1]) > Number(zShield[1]),
  '.mod-bar 的 z-index 高于 .mod-shield（遮罩挡卡片、不挡把手）');
assert(/\.mod-bar\s*\{[^}]*touch-action:\s*none/.test(css),
  '.mod-bar 禁掉滚动手势（拖动时页面不跟着滚）');
assert(/@tap\.stop="noop"|@touchstart\.stop="noop"/.test(tpl),
  '抽屉本体阻止冒泡（点抽屉内部不会关掉抽屉）');

/* ---------- 8. 注册表与模板分支一一对应 ---------- */
console.log('== 8. 模块注册表 ↔ 模板分支 ==');
// uni 模板里引用不存在的分支**不报错、只空白**（本项目记忆约束 10），
// 所以"新增了模块却忘了加分支"只能靠静态扫。
const ids = [];
for (const m of lay.matchAll(/\{\s*id:\s*'([a-z0-9_]+)'/g)) ids.push(m[1]);
assert(ids.length > 0, 'home-layout.ts 里解析到模块 id');
ids.forEach((id) => {
  assert(tpl.indexOf("id === '" + id + "'") >= 0, "模板有 v-if=\"id === '" + id + "'\" 分支");
});
// 反向：模板里的分支 id 必须都在注册表里（写错名字 = 永远渲染不出来）
const tplIds = [];
for (const m of tpl.matchAll(/id === '([a-z0-9_]+)'/g)) tplIds.push(m[1]);
tplIds.forEach((id) => {
  assert(ids.indexOf(id) >= 0, "模板分支 '" + id + "' 在注册表里存在");
});

/* ---------- 9. 临时卡不进注册表 ---------- */
console.log('== 9. 条件横幅不可收纳 ==');
// 权限没开真的会让计时断掉，不该被用户收起来
['setup-card', 'resume-card'].forEach((c) => {
  const iCard = tpl.indexOf('class="card ' + c + '"');
  const iList = tpl.indexOf('class="mod-list"');
  assert(iCard >= 0 && iCard < iList, '.' + c + ' 排在 .mod-list 之外（不是组件、不可收纳）');
});

/* ---------- 10. 模板引用的成员在脚本里都存在 ---------- */
console.log('== 10. 模板 ↔ 脚本 绑定齐全 ==');
// 模板里引用不存在的 data / method 同样"不报错只空白"
const need = ['editing', 'dragIndex', 'cardOrder', 'moduleName', 'sheetShow', 'sheetList',
  'toggleEdit', 'finishEdit', 'openSheet', 'closeSheet', 'stashModule', 'restoreModule',
  'dragStart', 'dragStartMouse', 'dragMove', 'dragEnd', 'wrapStyle', 'noop'];
need.forEach((n) => {
  // data 字段（xxx: 值）或 method（xxx(）
  assert(new RegExp('(^|[\\s,{])' + n + '\\s*[:,(\\(]').test(sc) ||
    new RegExp('\\b' + n + '\\s*\\(').test(sc), '脚本里有 ' + n);
});

console.log('');
if (fail) { console.error('失败 ' + fail + ' 项 ✗'); process.exit(1); }
console.log('首页卡片编辑校验全部通过 ✓');

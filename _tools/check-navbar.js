// _tools/check-navbar.js - 首页搜索胶囊「铺满 / 收缩」状态机 + 样式契约校验（只读）
//
// 回归点：
//  1) 未聚焦且无关键词 → 左右槽收起（width 0），输入框铺满整个胶囊
//  2) 聚焦 → 槽展开，输入框只横向收缩、上下不动、两侧等宽（居中）
//  3) 失焦且没词 → 还原成铺满；失焦但有词 → 保持收缩（× 要有位置）
//  4) 点放大镜 = 执行搜索；非搜索模式左槽仍是返回键；右槽 × 行为不变
//  5) 收缩 / 还原必须走 width 过渡（有动画）
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'uniapp-PWstudy', 'components', 'float-navbar', 'float-navbar.vue');
const src = fs.readFileSync(FILE, 'utf8');
const script = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'))
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '');
const code = script.replace('export default', 'const COMP =') + '\n; return { COMP: COMP };';

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}
function yes(v, label) { if (v) ok(label); else bad(label); }

const uniCalls = [];
const uniMock = {
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  hideKeyboard: () => uniCalls.push('hideKeyboard'),
  navigateBack: () => uniCalls.push('navigateBack'),
  switchTab: (o) => uniCalls.push('switchTab:' + (o && o.url))
};
const backPages = [];
global.getCurrentPages = () => backPages;

// t 来自全局 mixin 的 $t（页面里是 $t，脚本里直接用 t）；这里用恒等桩 = 中文态行为
const api = new Function('uni', 't', code)(uniMock, (s) => String(s));

// 造一个组件实例：data + methods + computed（$emit 记下来）
function mount(props, keep) {
  const emits = [];
  const ctx = Object.assign({}, api.COMP.data(), api.COMP.methods, props, keep || {});
  ctx.$emit = (n, v) => emits.push({ n: n, v: v });
  Object.keys(api.COMP.computed).forEach((k) => {
    Object.defineProperty(ctx, k, { get: () => api.COMP.computed[k].call(ctx), configurable: true });
  });
  ctx.emits = emits;
  return ctx;
}

console.log('== 1. 未使用 / 未点击：铺满整个胶囊 ==');
const idle = mount({ search: true, value: '', title: '' });
eq(idle.focused, false, '初始未聚焦');
eq(idle.active, false, 'active');
eq(idle.isFlat, true, 'isFlat（左右槽收起 → 输入框铺满）');

console.log('== 2. 点击输入框：收缩为内嵌尺寸 ==');
idle.onFocus();
eq(idle.focused, true, '已聚焦');
eq(idle.active, true, 'active');
eq(idle.isFlat, false, 'isFlat（槽展开 → 输入框横向收缩）');
eq(idle.emits[0].n, 'focus', '向页面抛出 focus');

console.log('== 3. 失焦且没有关键词：动画还原成铺满 ==');
idle.onBlur({ detail: { value: '' } });
eq(idle.focused, false, '失焦');
eq(idle.isFlat, true, 'isFlat 回到铺满');

console.log('== 4. 失焦但有关键词：保持收缩（× 要有落脚点） ==');
const typed = mount({ search: true, value: 'apple' });
eq(typed.isFlat, false, '有关键词时即便失焦也不铺满');
typed.onBlur({ detail: { value: 'apple' } });
eq(typed.isFlat, false, '失焦后仍保持收缩');
eq(typed.emits[typed.emits.length - 1].v, 'apple', 'blur 事件带上当前词');

console.log('== 5. 页面主动收起（点「收起」/清空）：失焦 + 收键盘 ==');
uniCalls.length = 0;
typed.blurInput();
eq(typed.focused, false, 'force 失焦');
yes(uniCalls.indexOf('hideKeyboard') >= 0, '调用了 hideKeyboard');

console.log('== 6. 左边放大镜：点击执行搜索 ==');
const withWord = mount({ search: true, value: 'apple' });
withWord.onLeftTap();
eq(withWord.emits.length, 1, '只发一个事件');
eq(withWord.emits[0].n, 'search', '事件名');
eq(withWord.emits[0].v, 'apple', '带上当前关键词');

console.log('== 7. 非搜索页：左槽仍是返回键，且不误触搜索 ==');
backPages.length = 0;
backPages.push({}, {});   // 栈深 2 → 显示返回键
uniCalls.length = 0;
const titleBar = mount({ search: false, value: '', title: '词库' });
eq(titleBar.isFlat, false, '非搜索模式不收起（返回键槽保持 72rpx）');
eq(titleBar.showBack, true, '栈深 > 1 显示返回键');
titleBar.onLeftTap();
yes(uniCalls.indexOf('navigateBack') >= 0, '点击走 navigateBack');
// 返回键现在会先问一次页面（before-back，给强制模式留否决口），
// 要守的是"没把这次点击当成搜索"，不是"什么都不抛"
const leftEmits = titleBar.emits.map(e => e.n);
eq(leftEmits.indexOf('search'), -1, '没有抛出 search');
yes(leftEmits.indexOf('before-back') >= 0, '返回前先问页面（before-back）');
uniCalls.length = 0;
backPages.length = 0;      // 栈深 1
const rootBar = mount({ search: false, value: '', title: '词库' });
rootBar.onLeftTap();
eq(uniCalls.length, 0, '栈深 1 且无返回键时点击不触发导航');

console.log('== 8. 右边 ×：行为与原来一致 ==');
const clearBar = mount({ search: true, value: 'apple' });
clearBar.onClear();
eq(clearBar.emits.length, 2, '两个事件（input + clear）');
eq(clearBar.emits[0].n + '=' + clearBar.emits[0].v, 'input=', '先清空输入');
eq(clearBar.emits[1].n, 'clear', '再抛 clear');

console.log('== 9. 样式契约：只缩左右、上下不变、有过渡 ==');
const style = src.slice(src.lastIndexOf('<style'));
const sideRule = style.match(/\.fnb-search-mode\s+\.fnb-side\s*\{([^}]*)\}/);
yes(!!sideRule, '存在 .fnb-search-mode .fnb-side 规则');
if (sideRule) {
  const body = sideRule[1];
  yes(/transition:[^;]*width\s+\d+ms/.test(body), '槽位有 width 过渡（收缩/放大都有动画）');
  const w = body.match(/width:\s*(\d+)rpx/);
  eq(w && w[1], '76', '展开态槽宽（rpx）');
  yes(/height:\s*100%/.test(body), '槽位与胶囊同高');
  yes(/overflow:\s*hidden/.test(body), '收起时裁掉图标');
}
const flatRule = style.match(/\.fnb-search-mode\s+\.fnb-side\.fnb-side-flat\s*\{([^}]*)\}/);
yes(!!flatRule && /width:\s*0/.test(flatRule[1]), '收起态槽宽 = 0（输入框铺满）');
yes(!!flatRule && /opacity:\s*0/.test(flatRule[1]), '收起态图标淡出');
const searchRule = style.match(/\.fnb-search\s*\{([^}]*)\}/);
yes(!!searchRule && /height:\s*100%/.test(searchRule[1]), '输入框上下与胶囊同高（只缩左右）');
yes(!!searchRule && /box-sizing:\s*border-box/.test(searchRule[1]), '输入框 border-box（不会撑出胶囊）');
yes(!!searchRule && /flex:\s*1/.test(searchRule[1]), '输入框 flex 1（随槽宽自动收缩、始终居中）');
yes(/\.fnb-search-mode\s*\{\s*padding:\s*0/.test(style), '搜索模式胶囊零内边距（才能真正铺满）');
yes(/\.mag-ring/.test(style) && /\.mag-handle/.test(style), '放大镜是 CSS 画的（不依赖图片资源）');
// 两侧槽共用同一条 width → 必然等宽 → 输入框居中
const allSideWidths = (style.match(/\.fnb-search-mode\s+\.fnb-side[^{]*\{[^}]*width:\s*(\d+)rpx/g) || []);
eq(allSideWidths.length, 1, '左右槽共用一条宽度规则（等宽 → 居中）');

console.log('== 10. 模式键（搜 / AI）常驻：收起态也要能切换 ==');
// 回归点：模式键以前也挂 fnb-side-flat —— 收起态是 width:0 + pointer-events:none，
// "没打字按了下回车 → 走到清空 → 顶栏失焦 → 胶囊收起"，这颗键就成了"看得见点不动"。
// 而且锁定态被藏起来更危险：用户以为自己没锁，随手打个单词却被当成指令真的改了首页。
const tpl = src.slice(0, src.indexOf('<script'));
// 只数真正绑定收起类的槽位（注释里也会提到这个类名，不能按裸字符串数）
const flatCount = (tpl.match(/fnb-side-flat': isFlat/g) || []).length;
eq(flatCount, 2, '模板里只有左右两个图标槽会收起');
const modeBlock = tpl.slice(tpl.indexOf('v-if="search && switchable"'), tpl.indexOf('@tap="onModeTap"'));
yes(!!modeBlock && !/fnb-side-flat/.test(modeBlock), '模式键不参与收起（常驻）');
yes(!/\.fnb-side-mode[^{]*\{[^}]*width:\s*0/.test(style), '模式键槽没有被样式写成 0 宽');

const idleMode = mount({ search: true, switchable: true, value: '', mode: 'search' });
eq(idleMode.isFlat, true, '空闲态左右槽确实收起（输入框铺满）');
idleMode.onModeTap();
eq(idleMode.emits.length, 1, '空闲态点模式键仍然有响应');
eq(idleMode.emits[0].n, 'mode-toggle', '事件名');
eq(idleMode.emits[0].v, 'command', '搜 → AI');
const cmdMode = mount({ search: true, switchable: true, value: '', mode: 'command' });
cmdMode.onModeTap();
eq(cmdMode.emits[0].v, 'search', 'AI → 搜');
const noSwitch = mount({ search: true, switchable: false, value: '', mode: 'command' });
noSwitch.onModeTap();
eq(noSwitch.emits.length, 0, 'switchable=false 的页面没有这颗键，点击不响应');

console.log('== 11. 标题必须相对整颗胶囊居中（不被右边那颗键挤偏）==');
// 回归：标题原来是 flex:1 + text-align:center，只在"剩下的那块空间"里居中 ——
// 首页右侧多一颗管理键，左右槽不等宽，"PWstudy" 就整体偏左（2026-10-24）。
const titleRule = style.match(/\.fnb-title\s*\{([^}]*)\}/);
yes(!!titleRule && /position:\s*absolute/.test(titleRule[1]), '标题绝对定位（不占 flex 流）');
yes(!!titleRule && /left:\s*0/.test(titleRule[1]) && /right:\s*0/.test(titleRule[1]),
  '标题左右都归零（居中基准是整颗胶囊，不是剩余空间）');
yes(!!titleRule && /text-align:\s*center/.test(titleRule[1]), '标题 text-align:center');
// ⚠️ 绝对定位的标题盖在左槽之上：不穿透会把返回键点死
yes(!!titleRule && /pointer-events:\s*none/.test(titleRule[1]), '标题 pointer-events:none（不挡住左槽点击）');
// 标题脱离流之后，剩下的槽会一齐挤到左边 —— 必须有东西把它们撑开
const fnbRule = style.match(/\.fnb\s*\{([^}]*)\}/);
yes(!!fnbRule && /justify-content:\s*space-between/.test(fnbRule[1]),
  '胶囊 space-between（标题脱流后右槽不会串到左边）');

/* ---------- 12. 返回键：页面必须显式声明，不许靠"页面栈深度"自动判断 ---------- */
// 回归点（2026-10-26）：只有 7 个页面写了 :back="true"，其余全靠组件里
// "getCurrentPages().length > 1" 自动判断 —— 而页面组件**创建时**拿到的栈里常常
// 还没算上自己，于是"从底栏页直接点进来的页面"全被判成栈深 1 = 没有返回键。
// 结果就是同一个 App 里有的页面左上角有 ‹ 有的没有，用户只能靠猜。
// 规矩：tabBar 那 4 个根页写 :back="false"，其余一律 :back="true"（各写各的，
// 谁也不许省 —— 省了就退回看运气的自动判定）。
console.log('== 12. 返回键：每个页面显式声明 ==');
const APP = path.join(__dirname, '..', 'uniapp-PWstudy');
// pages.json 有 JSON5 注释，先剥（CRLF 按 /\r?\n/ 断行，理由见 check-pages-json.js）
const pjText = fs.readFileSync(path.join(APP, 'pages.json'), 'utf8')
  .split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');
let pj = null;
try { pj = JSON.parse(pjText); } catch (e) { bad('pages.json 解析失败：' + e.message); }

if (pj) {
  const tabSet = {};
  ((pj.tabBar && pj.tabBar.list) || []).forEach(it => { if (it && it.pagePath) tabSet[it.pagePath] = true; });
  eq(Object.keys(tabSet).length, 4, 'tabBar 4 个根页');

  // 收集所有用到 <float-navbar> 的页面（主包 + 分包，跟着 pages.json 走）
  const pagePaths = (pj.pages || []).map(p => p.path);
  (pj.subPackages || []).forEach(sp => {
    (sp.pages || []).forEach(p => pagePaths.push(String(sp.root || '').replace(/^\//, '') + '/' + p.path));
  });
  const noBack = [], wrongBack = [], missNav = [];
  // cover 是启动图落下去之后的全屏门面，刻意不挂顶栏（压一道白条反而毁了开屏）
  const NO_BAR = { 'pages/cover/cover': 1 };
  pagePaths.forEach(p => {
    if (NO_BAR[p]) return;
    const f = path.join(APP, p + '.vue');
    if (!fs.existsSync(f)) return;
    const src = fs.readFileSync(f, 'utf8');
    // 只取模板里的用法（脚本里的 import / components 声明不算）
    const tpl = src.slice(0, src.indexOf('\n</template>') > 0 ? src.indexOf('\n</template>') : src.length);
    const m = /<float-navbar\b[^>]*\/?>/.exec(tpl);
    if (!m) { missNav.push(p); return; }
    const tag = m[0];
    const isTab = !!tabSet[p];
    if (!/:back="true"|:back="false"/.test(tag)) { noBack.push(p + (isTab ? '(tab)' : '')); return; }
    if (isTab && !/:back="false"/.test(tag)) wrongBack.push(p + ' 写了 true（tab 根页不该有返回键）');
    if (!isTab && !/:back="true"/.test(tag)) wrongBack.push(p + ' 写了 false（子页必须有返回键）');
  });
  eq(missNav.length, 0, '每个页面都挂了顶栏' + (missNav.length ? '（缺：' + missNav.join(', ') + '）' : ''));
  eq(noBack.length, 0, '每个页面都显式声明了 :back' + (noBack.length ? '（漏：' + noBack.join(', ') + '）' : ''));
  eq(wrongBack.length, 0, 'tab 页 = false、子页 = true' + (wrongBack.length ? '（' + wrongBack.join('；') + '）' : ''));
}

console.log('== 12b. 忙碌时返回键仍要在（转圈挪去右槽）==');
// 回归点：转圈原来挤在左槽且优先级排在返回键之前 —— replan / wizard 在跑 AI 时
// 左槽变成转圈，"加载完才冒出返回键"，正是"时有时无"的另一个来源。
yes(/v-if="!search && showBack"[^>]*class="fnb-back"/.test(tpl), '非搜索页左槽第一优先是返回键');
yes(!/v-else-if="busy"/.test(tpl), '忙碌不再顶掉左槽（左槽恒为返回键）');
yes(/v-else-if="search && busy"/.test(tpl), '搜索态的忙碌指示仍在左槽（首页没有返回键，槽不冲突）');
yes(/v-else-if="!search && busy"/.test(tpl), '非搜索态的忙碌指示挂在右槽');

console.log('== 12c. 返回前先问页面（强制模式能按住人）==');
// 回归点：顶栏返回走的是 uni.navigateBack，**绕不开页面的 onBackPress** ——
// 专注页正是靠 onBackPress 在强制模式下把人按住的，少了这层顶栏就成了后门。
function mountAt(props, emit) {
  const ctx = Object.assign({}, api.COMP.data(), api.COMP.methods, props);
  ctx.$emit = emit;
  Object.keys(api.COMP.computed).forEach((k) => {
    Object.defineProperty(ctx, k, { get: () => api.COMP.computed[k].call(ctx), configurable: true });
  });
  return ctx;
}
backPages.length = 0;
backPages.push({}, {});
uniCalls.length = 0;
const asked = [];
// 页面否决（模拟专注页强制模式）
const blocked = mountAt({ search: false, back: true, title: '专注' }, (n, cb) => {
  asked.push(n);
  if (n === 'before-back' && typeof cb === 'function') cb();
});
blocked.onBack();
eq(asked.length, 1, '点击返回先问页面（只问这一次）');
eq(asked[0], 'before-back', '问的是 before-back');
eq(uniCalls.length, 0, '页面否决 → 不导航（人被按住）');
// 页面不否决 → 正常返回
uniCalls.length = 0;
const allowed = mountAt({ search: false, back: true, title: '设置' }, (n) => asked.push(n));
allowed.onBack();
yes(uniCalls.indexOf('navigateBack') >= 0, '页面不拦 → 正常 navigateBack');
// 栈深测量：创建时量到 1（页面还没进栈），挂载后再量 → 2，返回键跟着出现
backPages.length = 0;
const late = mountAt({ search: false, back: null, title: '设置' }, () => {});
late.measureStack();            // 模拟 created：这时当前页还没进栈
eq(late.showBack, false, '创建时量到栈深 1 → 暂时没有返回键');
backPages.push({}, {});         // 页面进栈
late.measureStack();            // 模拟 mounted：再量一次
eq(late.showBack, true, '挂载后重新量到栈深 2 → 返回键出现（不靠创建时机）');
// 行为对了还不够：那次"再量一次"必须是 mounted 里真的调了，不是碰巧
const mountedSrc = /mounted\(\)\s*\{([\s\S]*?)\n  \}/.exec(script);
yes(mountedSrc && /this\.measureStack\(\)/.test(mountedSrc[1]), 'mounted 里确实会再量一次栈深');

console.log('');
console.log(fail === 0 ? '顶栏搜索胶囊全部通过' : '失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;

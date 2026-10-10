// _tools/check-tabbar.js - 悬浮底栏的滑动过渡校验（只读，把 .vue 的 script 抽出来跑）
//
// 回归点：
//  1) sync() 会被调用两次（mounted + 页面 onShow），第二次不能把正在跑的滑动掐断
//  2) tab 页常驻 → 起点必须取模块级 lastIndex，否则第二次进入动画直接消失（没反馈）
//  3) 跳到起点时必须关掉过渡，否则会先朝反方向滑一下（指示器错位）
//  4) 缓存实例里残留的 pending 会让高亮与页面不同步
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'uniapp', 'components', 'float-tabbar', 'float-tabbar.vue');
const src = fs.readFileSync(FILE, 'utf8');
// 去掉 import（new Function 不支持），依赖改为注入
const script = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'))
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '');

// export default {...} → const COMP = {...}；再暴露模块级 lastIndex 便于跨"页面"复用同一个闭包
const code = script.replace('export default', 'const COMP =') +
  '\n; return { COMP: COMP, getLast: function () { return lastIndex; } };';

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}

// 受控定时器：手动决定"下一帧"什么时候到
let timers = [];
const fakeSetTimeout = (fn, ms) => { timers.push(fn); return timers.length; };
const fakeClear = () => {};
function flush() { const list = timers; timers = []; list.forEach((f) => f()); }

const navCalls = [];
const uniMock = { switchTab: (o) => navCalls.push(o && o.url) };

// 注入 utils/tab-slide.js 的真实次序，并记下 markSwitch 的方向
const { load } = require('./lib/load');
const tabSlide = load('utils/tab-slide.js');
const switchCalls = [];
const slideMock = Object.assign({}, tabSlide, {
  markSwitch: (from, to) => { const d = tabSlide.markSwitch(from, to); switchCalls.push({ from, to, dir: d }); return d; }
});

const api = new Function(
  'uni', 'setTimeout', 'clearTimeout', 'TABS', 'tabIndex', 'markSwitch',
  code
)(uniMock, fakeSetTimeout, fakeClear, tabSlide.TABS, tabSlide.tabIndex, slideMock.markSwitch);

// 模拟一个页面里的组件实例：模拟 cached 时保留上次 data（indIndex 等）
function mount(curIndex, keep) {
  const ctx = Object.assign({}, api.COMP.data(), api.COMP.methods, {
    __sliding: -1,
    __timer: 0,
    __navLock: false
  }, keep || {});
  ctx.current = tabSlide.TABS[curIndex].key;
  // curIndex / activeKey 在真实组件里是 computed，这里用等价的 getter 补上
  Object.defineProperty(ctx, 'indX', { get: () => api.COMP.computed.indX.call(ctx), configurable: true });
  Object.defineProperty(ctx, 'curIndex', { get: () => api.COMP.computed.curIndex.call(ctx), configurable: true });
  Object.defineProperty(ctx, 'activeKey', { get: () => api.COMP.computed.activeKey.call(ctx), configurable: true });
  return ctx;
}

// tab 次序的真身在 pages.json 的 tabBar（TABS 只是它的镜像）：期望值从那里算，
// 以后换 tab 测试自动跟上（以前这里硬写 library/review，改成 goals/stats 后假失败一片）
const ROOT = path.join(__dirname, '..', 'uniapp');
const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1'));
const K = ((pj.tabBar && pj.tabBar.list) || [])
  .map(x => String(x.pagePath || '').split('/').slice(-1)[0]);

console.log('== 1. tab 次序与页面路径 ==');
eq(tabSlide.TABS.map(t => t.key).join(','), K.join(','), 'tab 次序与 pages.json 一致');
eq(tabSlide.tabIndex(K[2]), 2, K[2] + ' 下标');
eq(tabSlide.tabAt(9), null, '越界返回 null');

console.log('== 2. 冷启动：没有上一个 tab，直接就位不播动画 ==');
const home = mount(0);
home.sync();
eq(home.indIndex, 0, '首页指示胶囊位置');
eq(api.getLast(), 0, '模块级 lastIndex');
eq(timers.length, 0, '不应排定时器（无需滑动）');
eq(home.indAnim, true, '过渡是开着的');

console.log('== 3. 切到第 2 个 tab：先无过渡落到上一个位置，再滑到目标 ==');
const lib = mount(1);
lib.sync();
eq(lib.indIndex, 0, '首帧停在起点（首页位置）');
eq(lib.indAnim, false, '起点跳转时关掉过渡（不会朝反方向滑一下）');
eq(lib.__sliding, 1, '记录正在滑向的目标');
eq(timers.length, 1, '排了一帧后切换的定时器');

console.log('== 4. 回归点：动画还没跑完时再次 sync（页面 onShow）不能掐断 ==');
lib.sync();          // 旧实现这里会把 indIndex 直接置成目标，滑动被吃掉
eq(lib.indIndex, 0, '二次 sync 后仍停在起点（动画未被打断）');
eq(lib.__sliding, 1, '仍记录滑向 1');
eq(timers.length, 1, '没有重复排定时器');
flush();
eq(lib.indIndex, 1, '定时器到点后滑到目标');
eq(lib.indAnim, true, '重新打开过渡');
eq(lib.__sliding, -1, '滑动标记已清除');
eq(api.getLast(), 1, 'lastIndex 已更新');

console.log('== 5. 动画结束后重复 sync：幂等，不再重播 ==');
lib.sync();
eq(lib.indIndex, 1, '位置不变');
eq(timers.length, 0, '没有新定时器');

console.log('== 6. 回到缓存页面：起点取 lastIndex，不能"本来就位"而吃掉动画 ==');
// 先切到「我的」(3)，把 lastIndex 推到 3
const me0 = mount(3);
me0.sync();
flush();
eq(api.getLast(), 3, '先切到「我的」，lastIndex = 3');
// 模拟：当前停在最后一个 tab(3)，回到常驻的第 2 个 tab 页（实例里 indIndex 还是 1）
const libCached = mount(1, { indIndex: 1 });
libCached.sync();
eq(libCached.indIndex, 3, '先无动画落到「我的」位置');
eq(libCached.indAnim, false, '落起点时关掉过渡');
flush();
eq(libCached.indIndex, 1, '再滑回 ' + K[1]);
eq(libCached.indAnim, true, '过渡已恢复（真正可见的这一段有动画）');
eq(api.getLast(), 1, 'lastIndex 回到 ' + K[1]);

console.log('== 7. 残留 pending 必须清掉（选中态与页面同步） ==');
const stale = mount(0, { pending: K[2] });
stale.sync();
eq(stale.pending, '', '回到缓存页面时残留的 pending 已清空');
const fresh = mount(0, { pending: K[2], __navLock: true });
fresh.sync();
eq(fresh.pending, K[2], '导航在途时的 pending 保留（点击反馈不被 sync 吃掉）');

console.log('== 8. 点击：即时高亮 + 记录方向 + 只导航一次 ==');
navCalls.length = 0;
switchCalls.length = 0;
const me = mount(3);
me.go({ currentTarget: { dataset: { k: K[0] } } });
eq(me.pending, K[0], '点击瞬间 pending 已切换（不等页面挂载）');
eq(navCalls.length, 1, '触发了一次 switchTab');
eq(navCalls[0], '/pages/home/home', '目标路径');
eq(switchCalls.length, 1, '记录了一次切换方向');
eq(switchCalls[0].dir, 'left', '索引变小 → 从左滑入');
me.go({ currentTarget: { dataset: { k: K[1] } } });   // 连点保护
eq(navCalls.length, 1, '350ms 内的连点被拦掉');
me.__navLock = false;
me.pending = '';                                    // 回到"当前就在 profile"的真实状态
me.go({ currentTarget: { dataset: { k: K[3] } } });
eq(navCalls.length, 1, '点击当前 tab 不重复导航');
me.go({ currentTarget: { dataset: { k: 'nope' } } });
eq(navCalls.length, 1, '未知 key 不导航');

console.log('== 9. activeKey：pending 优先于页面传入的 current ==');
const comp = api.COMP;
const vm = { pending: K[2], current: K[0], tabs: tabSlide.TABS };
eq(comp.computed.activeKey.call(vm), K[2], 'pending 生效');

console.log('== 10. 指示器用 transform 平移，时长落在"跟手"区间 ==');
const style = src.slice(src.lastIndexOf('<style'));
const m = style.match(/transition:\s*transform\s+(\d+)ms/);
if (m) {
  const ms = Number(m[1]);
  if (ms <= 260) ok('指示胶囊滑动 ' + ms + 'ms（transform，≤260ms）');
  else bad('滑动 ' + ms + 'ms 偏慢');
} else {
  bad('未找到指示胶囊的 transform transition');
}
if (/\.ftb-ind\s*\{[^}]*width:\s*25%/s.test(style)) ok('指示层宽度 25%（与 flex:1 的 item 对齐）');
else bad('指示层宽度不是 25%，滑到后面的 tab 会错位');
if (/\.ftb-ind\.no-anim\s*\{[^}]*transition:\s*none/s.test(style)) ok('存在 .no-anim（落起点不播过渡）');
else bad('缺少 .no-anim');
if (/left:\s*calc\(/.test(style)) bad('仍在用 left + calc 定位（应改 transform）');
else ok('不再用 left + calc（避免每帧重排）');

// ---------------------------------------------------------------------------
// 11. 可见性锚点：「底部导航不见了」回归防线
//     本脚本原先只验送检的逻辑（指示器动画 / 切换），组件其实根本渲染不出来也照样全绿 ——
//     这起 bug 复发过一次，所以把「能不能显示在屏幕底部」也钉死。
//     根因：App 端原生 tabBar 隐藏后 webview 不重排，fixed bottom:0 跟着沉到屏幕外。
console.log('== 11. 可见性锚点（防「底栏不见了」复发）==');
const wrapCss = style.slice(style.indexOf('.ftb-wrap'), style.indexOf('}', style.indexOf('.ftb-wrap')));
if (/position:\s*fixed/.test(wrapCss)) ok('外层 .ftb-wrap 是 fixed（贴视口底部）');
else bad('外层 .ftb-wrap 不是 fixed —— 底栏会随页面滚走');
if (/bottom:\s*0/.test(wrapCss)) ok('贴底 bottom: 0');
else bad('缺少 bottom: 0');
const mz = wrapCss.match(/z-index:\s*(\d+)/);
if (mz && Number(mz[1]) >= 500) ok('z-index ' + mz[1] + '（压过页面内容，不低于浮比较高的层）');
else bad('z-index 过低或缺失 —— 会被其它浮层盖住');
// App 端「hide 之后重排」的兜底，抽在 utils/nav.js
const navSrc = fs.readFileSync(path.join(__dirname, '..', 'uniapp', 'utils', 'nav.js'), 'utf8');
if (/plus\.webview\.currentWebview\(\)/.test(navSrc) && /setStyle\(\{\s*bottom/.test(navSrc)) {
  ok('App 端 hide 之后强制 webview 重排（plus.webview.setStyle bottom）');
} else bad('缺少 webview 重排兜底 —— 原生 tabBar 隐藏后底栏会沉底');
// 补刀是「一个 setTimeout 跑多次」的循环写法，所以要数时间点而不是数 setTimeout 个数
const shotList = navSrc.match(/\[\s*\d+\s*(?:,\s*\d+\s*){2,}\]/g) || [];
const shots = shotList.reduce((n, s) => n + (s.match(/\d+/g) || []).length, 0);
if (shots >= 4) ok('补了 ' + shots + ' 个时间点的幂等 hide（冷启动 / switchTab / 回前台都不漏）');
else bad('补刀时间点不足（' + shots + ' 个）');
if (/probeVisible/.test(src)) ok('App 端有可见性自检日志（inspect 时直接看 lost 数值定性）');
else bad('缺少可见性自检 —— 下次再消失只能靠猜');

console.log('');
console.log(fail === 0 ? '底栏过渡全部通过' : '失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;

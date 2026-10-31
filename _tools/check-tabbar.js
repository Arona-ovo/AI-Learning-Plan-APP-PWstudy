// _tools/check-tabbar.js - 悬浮底栏的选中态校验（只读，把 .vue 的 script 抽出来跑）
//
// 2026-10-31 重构后的架构：红色选中态与淡红胶囊**同源**——都由页面写死的
// current prop 派生（computed activeKey / indX），组件不再持有任何会残留的
// 可见状态（无 pending / indIndex / lastIndex / 滑动状态机）。
//
// 为什么这么钉：真机 scrcpy 60fps 逐帧取证（tabbar-probe），旧架构
// "pending 即时高亮 + 实例缓存的 indIndex + onShow 时 sync() 纠偏"在 App 端
// 必然产生首帧脏状态 —— 页面内容已切换、红色还挂在历史 pending 上，
// 胶囊停在上次离开的位置，然后红色才跳过来（用户观感：框先动、红后跟）。
// sync() 纠偏永远赶不赢首帧渲染管线（App 端渲染先行、上屏在后），所以
// 唯一出路是让脏状态无处生存。详见组件文件头注释。
//
// 回归点：
//  1) activeKey 只读 current：往实例上塞残留 pending 也必须输出 current
//     （钉死"pending 优先"那条旧路不许回来）
//  2) 胶囊位置由 current 派生：indX = tabIndex(current) * 100，无效 key 归 0
//  3) 点击行为：只导航一次 / 连点锁 / 点当前 tab 不动 / 未知 key 不动
//  4) switchTab 被路由锁静默拒绝（快速连点）时：歇一拍重试一次
//  5) sync()：页面可见 ⇒ 清掉残留连点锁（否则切回后第一次点 tab 被吞）
//  6) 源码级锚点：不许再出现实例缓存的可见状态（this.pending 等）
//  7) 样式锚点：transform 平移 + 25% 宽；可见性锚点（防「底栏不见了」复发）
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'uniapp-PWstudy', 'components', 'float-tabbar', 'float-tabbar.vue');
const src = fs.readFileSync(FILE, 'utf8');
// 去掉 import（new Function 不支持），依赖改为注入
const script = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'))
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '');

// export default {...} → const COMP = {...}
const code = script.replace('export default', 'const COMP =') +
  '\n; return { COMP: COMP };';

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
// failNext > 0 时接下来 N 次 switchTab 走 fail（模拟路由锁拒绝）——
// 快速连点时上一次导航没落地，uni 会静默拒掉本次跳转，组件必须自己兜
let failNext = 0;
const uniMock = {
  switchTab: (o) => {
    if (failNext > 0) { failNext--; if (o && o.fail) o.fail(); return; }
    navCalls.push(o && o.url);
  }
};

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

// 模拟一个页面里的组件实例
function mount(key, keep) {
  const ctx = Object.assign({}, api.COMP.data(), api.COMP.methods, {
    __navLock: false,
    __navLockT: 0
  }, keep || {});
  ctx.current = key;
  // computed 在真实组件里由 Vue 接管，这里用等价的 getter 补上
  ['activeKey', 'curIndex', 'indX'].forEach((k) => {
    Object.defineProperty(ctx, k, { get: () => api.COMP.computed[k].call(ctx), configurable: true });
  });
  return ctx;
}

// tab 次序的真身在 pages.json 的 tabBar（TABS 只是它的镜像）：期望值从那里算，
// 以后换 tab 测试自动跟上
const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1'));
const K = ((pj.tabBar && pj.tabBar.list) || [])
  .map(x => String(x.pagePath || '').split('/').slice(-1)[0]);

console.log('== 1. tab 次序与页面路径 ==');
eq(tabSlide.TABS.map(t => t.key).join(','), K.join(','), 'tab 次序与 pages.json 一致');
eq(tabSlide.tabIndex(K[2]), 2, K[2] + ' 下标');
eq(tabSlide.tabAt(9), null, '越界返回 null');

console.log('== 2. 选中态唯一来源：current（红色与胶囊同源，分裂不可能发生） ==');
const comp = api.COMP;
// 塞一个历史残留的 pending 进去：activeKey 也必须只看 current
// —— 旧架构的病根就是"pending 优先于 current"，首帧脏状态由此而来
const dirty = { pending: K[2], current: K[0], tabs: tabSlide.TABS };
eq(comp.computed.activeKey.call(dirty), K[0], '残留 pending 不影响 activeKey（只读 current）');
const vm = { current: K[2], tabs: tabSlide.TABS };
eq(comp.computed.activeKey.call(vm), K[2], 'activeKey 跟随 current');
// indX 内部走 this.curIndex（computed），裸对象要补同款 getter
function capsule(key) {
  const o = { current: key };
  Object.defineProperty(o, 'curIndex', { get: () => comp.computed.curIndex.call(o) });
  return o;
}
eq(comp.computed.indX.call(capsule(K[2])), 200, '胶囊位置 = tabIndex × 100');
eq(comp.computed.indX.call(capsule(K[0])), 0, '首页胶囊在原点');
eq(comp.computed.indX.call(capsule('nope')), 0, '无效 key 归 0（不许滑出底栏）');

console.log('== 3. 点击：只导航一次 + 连点锁 + 点当前 tab 不动 ==');
navCalls.length = 0;
switchCalls.length = 0;
const me = mount(K[3]);
me.go({ currentTarget: { dataset: { k: K[0] } } });
eq(navCalls.length, 1, '触发了一次 switchTab');
eq(navCalls[0], '/pages/home/home', '目标路径');
eq(switchCalls.length, 1, '记录了一次切换方向');
eq(switchCalls[0].dir, 'left', '索引变小 → 从左滑入');
eq(me.__navLock, true, '导航在途上连点锁');
me.go({ currentTarget: { dataset: { k: K[1] } } });   // 连点保护
eq(navCalls.length, 1, '350ms 内的连点被拦掉');
me.__navLock = false;
me.go({ currentTarget: { dataset: { k: K[3] } } });
eq(navCalls.length, 1, '点击当前 tab 不重复导航');
me.go({ currentTarget: { dataset: { k: 'nope' } } });
eq(navCalls.length, 1, '未知 key 不导航');
flush();  // 350ms 锁定时器到点
eq(me.__navLock, false, '锁超时自动解除');
eq(me.__navLockT, 0, '锁定时器 id 已清');

console.log('== 4. switchTab 被路由锁拒绝：歇一拍重试一次 ==');
// 场景：快速连点时上一次导航未落地 → uni 静默 fail → 用户点了没反应。
// 组件必须自己兜：350ms 后重试（markSwitch 方向 TTL 1500ms 之内，落地动画照播）
navCalls.length = 0; failNext = 1;
const r1 = mount(K[3]);
r1.go({ currentTarget: { dataset: { k: K[0] } } });
eq(navCalls.length, 0, '第一次 switchTab 被路由锁拒绝（fail，不导航）');
flush();                                                // 350ms 重试定时器到点
eq(navCalls.length, 1, '歇一拍自动重试成功（用户意图明确，不必让手指再点一次）');
eq(navCalls[0], '/pages/home/home', '重试目标路径不变');
failNext = 0;

console.log('== 5. sync()：页面可见 ⇒ 残留连点锁必清（否则切回后第一次点 tab 被吞） ==');
const locked = mount(K[0], { __navLock: true, __navLockT: 5 });
locked.sync();
eq(locked.__navLock, false, '过期锁已解除');
eq(locked.__navLockT, 0, '锁定时器已清');

console.log('== 6. 源码级锚点：不许再有"实例缓存的可见状态"（防回退） ==');
// 旧架构的三件套（pending 即时高亮 / indIndex 实例缓存 / lastIndex+__sliding
// 滑动状态机）任何一个回来，首帧脏状态就会回来 —— 红与胶囊重新开始分裂
const staleState = script.match(/this\.(pending|indIndex|__sliding|indAnim|lastIndex)\b/);
if (staleState) bad('组件又把可见状态存进实例了：this.' + staleState[1] + '（首帧脏状态 = 红与胶囊分裂）');
else ok('组件不持有任何实例缓存的可见状态（全由 current 派生）');
if (/this\.__navLock/.test(script)) ok('连点锁保留（go 拦连点，sync 清残留）');
else bad('连点锁丢了 —— 快速连点会连续触发 switchTab');
if (/fail:\s*\(\)\s*=>\s*\{\s*setTimeout\(retry/.test(script) || /fail:\s*\(\)\s*=>\s*\{\s*setTimeout/.test(script)) {
  ok('switchTab 接了 fail → 350ms 重试（路由锁静默拒绝的兜底）');
} else bad('switchTab 没接 fail —— 快速连点时点击会被静默吞掉');

console.log('== 7. 样式锚点：transform 平移 + 对齐 ==');
const style = src.slice(src.lastIndexOf('<style'));
const m = style.match(/transition:\s*transform\s+(\d+)ms/);
if (m) {
  const ms = Number(m[1]);
  if (ms <= 260) ok('指示胶囊过渡 ' + ms + 'ms（transform，≤260ms）');
  else bad('过渡 ' + ms + 'ms 偏慢');
} else {
  bad('未找到指示胶囊的 transform transition');
}
if (/\.ftb-ind\s*\{[^}]*width:\s*25%/s.test(style)) ok('指示层宽度 25%（与 flex:1 的 item 对齐）');
else bad('指示层宽度不是 25%，胶囊会错位');
if (/left:\s*calc\(/.test(style)) bad('仍在用 left + calc 定位（应改 transform）');
else ok('不再用 left + calc（避免每帧重排）');

// ---------------------------------------------------------------------------
// 8. 可见性锚点：「底部导航不见了」回归防线
//     本脚本原先只验送检的逻辑（指示器动画 / 切换），组件其实根本渲染不出来也照样全绿 ——
//     这起 bug 复发过一次，所以把「能不能显示在屏幕底部」也钉死。
//     根因：App 端原生 tabBar 隐藏后 webview 不重排，fixed bottom:0 跟着沉到屏幕外。
console.log('== 8. 可见性锚点（防「底栏不见了」复发）==');
const wrapCss = style.slice(style.indexOf('.ftb-wrap'), style.indexOf('}', style.indexOf('.ftb-wrap')));
if (/position:\s*fixed/.test(wrapCss)) ok('外层 .ftb-wrap 是 fixed（贴视口底部）');
else bad('外层 .ftb-wrap 不是 fixed —— 底栏会随页面滚走');
if (/bottom:\s*0/.test(wrapCss)) ok('贴底 bottom: 0');
else bad('缺少 bottom: 0');
const mz = wrapCss.match(/z-index:\s*(\d+)/);
if (mz && Number(mz[1]) >= 500) ok('z-index ' + mz[1] + '（压过页面内容，不低于浮比较高的层）');
else bad('z-index 过低或缺失 —— 会被其它浮层盖住');
// App 端「hide 之后重排」的兜底，抽在 utils/nav.js
const navSrc = fs.readFileSync(path.join(ROOT, 'utils', 'nav.js'), 'utf8');
if (/plus\.webview\.currentWebview\(\)/.test(navSrc) && /setStyle\(\{\s*bottom/.test(navSrc)) {
  ok('App 端 hide 之后强制 webview 重排（plus.webview.setStyle bottom）');
} else bad('缺少 webview 重排兜底 —— 原生 tabBar 隐藏后底栏会沉底');
// 补刀是「一个 setTimeout 跑多次」的循环写法，所以要数时间点而不是数 setTimeout 个数
const shotList = navSrc.match(/\[\s*\d+\s*(?:,\s*\d+\s*){2,}\]/g) || [];
const shots = shotList.reduce((n, s) => n + (s.match(/\d+/g) || []).length, 0);
if (shots >= 4) ok('补了 ' + shots + ' 个时间点的幂等 hide（冷启动 / switchTab / 回前台都不漏）');
else bad('补刀时间点不足（' + shots + ' 个）');
if (/probeVisible/.test(script)) ok('App 端有可见性自检日志（inspect 时直接看 lost 数值定性）');
else bad('缺少可见性自检 —— 下次再消失只能靠猜');

console.log('');
console.log(fail === 0 ? '底栏选中态全部通过' : '失败 ' + fail + ' 项');
process.exitCode = fail ? 1 : 0;

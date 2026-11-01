// utils/scroll-lock.js - 浮层打开时锁住页面滚动（禁止"滑弹窗、背后页面跟着动"）
//
// 为什么必须锁：`position: fixed` 只是视觉上盖住页面，触摸的**默认滚动行为**仍作用
// 在页面上。项目里的老办法是遮罩写 @touchmove.stop.prevent + 内容区
// overscroll-behavior: contain，这两招 H5 够用，但 App 端（主战场）的页面滚动是
// **原生 webview 滚动**——它不被 body/uni-page-body 的 overflow:hidden 影响，也不吃
// 内层元素的 @touchmove.prevent（uni-app 把那条监听编译成了 passive）。
// 真机实测（2026-11-01，首页「管理」面板）：面板开着手指一划，底下的首页照样被拉走。
//
// 真正能锁住 App 原生页面滚动的，是在 document 上挂一个 **非 passive 的 touchmove**
// 监听并 preventDefault()——这直接掐掉 webview 的默认滚动，不管滚动容器到底是哪个元素。
//
// 两种锁：
//   - 软锁（scrollable:true / 默认）：只把 overflow 改成 hidden（H5 兜底），不挂全局监听。
//     留给"内部还需要自己滚"的浮层（操作菜单很长、专注设置卡很长）。
//   - 硬锁（scrollable:false）：额外挂 document 级 non-passive touchmove → preventDefault，
//     从根上禁止页面滚动。留给"纯点击、内容短、自己不该滚也不该透传"的浮层
//     （现在就是首页「管理」面板）。
//
// ★ 用「按 key 持有」而不是引用计数：计数一旦漏减一次，页面就永久锁死（滚不动了），
//   而这种 bug 只在真机上发现；按 key 持有则天然幂等 —— 同一个浮层开两次锁两次
//   也只是一条记录，关掉就释放。

const holders = {};
const hardKeys = {};        // 走硬锁的 key：打开时需要 document 级拦 touchmove
let applied = false;
let saved = [];
let hardOn = false;
let docHandler = null;

function scrollHosts() {
  const out = [];
  // #ifdef APP-PLUS || H5
  try {
    if (typeof document !== 'undefined') {
      if (document.body) out.push(document.body);
      // uni-app 页面真正的滚动容器（两层都试，机型/基座版本不同会有差异）
      const body = document.querySelector('uni-page-body');
      if (body && body !== document.body) out.push(body);
      const wrap = document.querySelector('uni-page-wrapper');
      if (wrap && wrap !== document.body) out.push(wrap);
    }
  } catch (e) {}
  // #endif
  return out;
}

// document 级：非 passive 的 touchmove → preventDefault。
// 必须是 non-passive，否则浏览器/uni-app 会忽略 preventDefault，页面照样滚。
function onDocTouchMove(e) {
  if (!hardOn) return;
  // 只拦 touch（鼠标拖拽不在考虑范围）；多点触控也拦
  if (e && e.cancelable) {
    try { e.preventDefault(); } catch (err) {}
  }
}

function ensureHard() {
  if (hardOn) return;
  try {
    if (typeof document !== 'undefined' && document.addEventListener) {
      // ⚠️ 必须 { passive: false }：浏览器/WebView 对 document 上的 touchstart/touchmove
      // 默认 passive:true（Chrome 56+ 的默认行为），写成 addEventListener(.., false)
      // 只设了 capture:false，passive 仍是 true → preventDefault 会被静默忽略，页面照滚。
      docHandler = onDocTouchMove;
      document.addEventListener('touchmove', docHandler, { passive: false });
      hardOn = true;
    }
  } catch (e) { hardOn = false; }
}

function dropHard() {
  if (!hardOn) return;
  try {
    if (docHandler) document.removeEventListener('touchmove', docHandler, { passive: false });
  } catch (e) {}
  docHandler = null;
  hardOn = false;
}

function applyHosts() {
  const want = Object.keys(holders).length > 0;
  if (want === applied) return;
  try {
    if (want) {
      saved = scrollHosts().map((el) => ({ el: el, v: el.style.overflow }));
      saved.forEach((it) => { it.el.style.overflow = 'hidden'; });
      applied = true;
    } else {
      saved.forEach((it) => { it.el.style.overflow = it.v || ''; });
      saved = [];
      applied = false;
    }
  } catch (e) {
    saved = [];
    applied = false;
  }
}

/** 持有锁
 * @param {string} key 页面级浮层用固定字符串；通用组件用 uid，避免多实例互相顶掉
 * @param {{scrollable?: boolean}} [opts] scrollable=false → 硬锁（document 级拦 touchmove）
 */
export function holdScroll(key, opts) {
  if (!key) return;
  holders[key] = 1;
  const hard = !!(opts && opts.scrollable === false);
  if (hard) hardKeys[key] = 1;
  applyHosts();
  if (Object.keys(hardKeys).length > 0) ensureHard();
}

export function releaseScroll(key) {
  if (!key || !holders[key]) return;
  delete holders[key];
  if (hardKeys[key]) delete hardKeys[key];
  applyHosts();
  if (Object.keys(hardKeys).length === 0) dropHard();
}

/** 兜底复位：页面卸载时调用，防止某个浮层没走到关闭逻辑就把页面锁死 */
export function resetScrollLock() {
  Object.keys(holders).forEach((k) => { delete holders[k]; });
  Object.keys(hardKeys).forEach((k) => { delete hardKeys[k]; });
  applyHosts();
  dropHard();
}

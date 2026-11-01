// utils/scroll-lock.js - 浮层打开时锁住页面滚动（禁止"滑弹窗、背后页面跟着动"）
//
// 为什么必须锁：`position: fixed` 只是视觉上盖住页面，触摸的**默认滚动行为**仍作用
// 在页面上。项目里的老办法是遮罩写 @touchmove.stop.prevent + 内容区
// overscroll-behavior: contain，这两招 H5 够用，但 App 端（主战场）的 scroll-view
// 是原生滚动，overscroll-behavior 不生效 —— 内容滚到边界后余量会"链"给背后的页面。
// 真机实测（2026-11-01，首页「管理」面板）：面板开着手指一划，底下的首页照样被拉走。
//
// 所以这里直接锁滚动容器：把 overflow 改成 hidden。
//
// ★ 用「按 key 持有」而不是引用计数：计数一旦漏减一次，页面就永久锁死（滚不动了），
//   而这种 bug 只在真机上发现；按 key 持有则天然幂等 —— 同一个浮层开两次锁两次
//   也只是一条记录，关掉就释放。
//
// ⚠️ 只在有 document 的端生效（App / H5）。小程序端没有 document，那边本来就靠
//    catchtouchmove，不走这条路。

const holders = {};
let applied = false;
let saved = [];

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

function apply() {
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

/** 持有锁：key 用固定字符串（页面级浮层）或组件 uid（通用组件，避免多实例互相顶掉） */
export function holdScroll(key) {
  if (!key) return;
  holders[key] = 1;
  apply();
}

export function releaseScroll(key) {
  if (!key || !holders[key]) return;
  delete holders[key];
  apply();
}

/** 兜底复位：页面卸载时调用，防止某个浮层没走到关闭逻辑就把页面锁死 */
export function resetScrollLock() {
  Object.keys(holders).forEach((k) => { delete holders[k]; });
  apply();
}

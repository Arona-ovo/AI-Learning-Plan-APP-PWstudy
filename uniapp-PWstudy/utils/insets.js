// utils/insets.js - 系统栏（状态栏 / 手势条）尺寸
//
// 背景：App 端页面是 navigationStyle:"custom"，也就是沉浸式 —— 状态栏是**盖在页面上**
// 的一层系统 UI，页面必须自己让出这块高度。uni 给的 CSS 变量 --status-bar-height
// 在部分机型 / 部分打包基座上拿不到值（变量未定义 → calc 里当 0 算），
// 表现就是：内容顶到状态栏底下、和时钟电量叠在一起，而且那一带点不动
// （手指落在状态栏区域，点击被系统吃了）。
//
// 所以在逻辑层算一次，再由 theme.rootStyle() 当 inline 变量下发到页面根节点
// （App 端逻辑层没有 document，写不了全局 CSS 变量，只能走 inline）。
//
// 关键判断：是否沉浸式。非沉浸式时 webview 本来就画在状态栏之下，
// 再让一次高度就变成顶部一条多余的白边 —— plus.navigator.isImmersedStatusbar() 直接问系统。

let _status = -1;
let _bottom = -1;

function num(v) {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : -1;
}

function sysInfo() {
  try { return uni.getSystemInfoSync() || {}; } catch (e) { return {}; }
}

/** 状态栏高度（px）。非沉浸式时返回 0 —— 此时再让一次就变成顶部一条多余白边。 */
export function statusBar() {
  if (_status >= 0) return _status;
  let h = -1;
  // 只有 App 端才谈得上"沉浸式"：plus 在就是 App（默认按沉浸式算，
  // 少让一截会压住状态栏、多让一截只是留白，两害相权取后者）；
  // H5 / 小程序没有这层系统 UI，默认不让位，靠 statusBarHeight 自己说话。
  let immersive = typeof plus !== 'undefined' && !!plus;
  // #ifdef APP-PLUS
  try {
    if (typeof plus !== 'undefined' && plus.navigator) {
      if (typeof plus.navigator.isImmersedStatusbar === 'function') {
        immersive = !!plus.navigator.isImmersedStatusbar();
      }
      if (!immersive) { _status = 0; return 0; }
      if (typeof plus.navigator.getStatusbarHeight === 'function') {
        h = num(plus.navigator.getStatusbarHeight());
      }
      if (h <= 0 && typeof plus.navigator.getSafeAreaInsets === 'function') {
        const i = plus.navigator.getSafeAreaInsets();
        if (i) h = num(i.top);
      }
    }
  } catch (e) { /* 桥不可用 → 走下面的系统信息 */ }
  // #endif
  const info = sysInfo();
  if (h <= 0) h = num(info.statusBarHeight);
  if (h <= 0 && info.safeAreaInsets) h = num(info.safeAreaInsets.top);
  if (h <= 0 && info.safeArea) h = num(info.safeArea.top);
  // 沉浸式但所有来源都给了 0：宁可多让一点也别把内容压在时钟底下
  if (h <= 0 && immersive) h = 24;
  // 上限 60：刘海屏状态栏也不会超过这个数，防止某些端返回的是整屏高度之类的离谱值
  if (h > 60) h = 60;
  if (!(h > 0)) h = 0;   // -1 / NaN 一律归零：绝不能让 padding 出现负值
  _status = h;
  return h;
}

/** 底部手势条 / 导航条高度（px）。 */
export function safeBottom() {
  if (_bottom >= 0) return _bottom;
  let b = -1;
  // #ifdef APP-PLUS
  try {
    if (typeof plus !== 'undefined' && plus.navigator &&
        typeof plus.navigator.getSafeAreaInsets === 'function') {
      const i = plus.navigator.getSafeAreaInsets();
      if (i) b = num(i.bottom);
    }
  } catch (e) {}
  // #endif
  const info = sysInfo();
  if (b < 0 && info.safeAreaInsets) b = num(info.safeAreaInsets.bottom);
  if (b < 0) b = 0;
  if (b > 60) b = 0;   // 明显不合理 → 当没有
  _bottom = b;
  return b;
}

/** 横竖屏切换 / 换基座后重算 */
export function reset() {
  _status = -1;
  _bottom = -1;
}

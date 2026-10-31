// utils/tab-slide.js - 底部 tab 的次序、切换方向与"内容左右滑动"
import * as i18n from './i18n.js';
//
// 两个职责：
//  1) 记录"从哪个 tab 切到哪个 tab"，让目标页进场时知道该从左还是从右滑入
//     （索引变大 → 从右滑入；索引变小 → 从左滑入）
//  2) 手势拖拽的参数与阻尼：内容跟手位移，松手超过阈值才切页，否则弹回
//
// tab 页在 uni-app 里是常驻的（switchTab 不销毁）；App 端每页还是**独立 webview**，
// 模块级变量不跨页共享 —— "上一次停留的 tab / 切换方向"这类跨页状态不能只放模块级
// （切换方向同时落 storage，见下面切换意图一节；底栏实例则一律由 current prop 派生）。

// 唯一的 tab 次序来源：底栏组件、切换方向、手势都读它
export const TABS = [
  { key: 'home', text: '专注', path: '/pages/home/home', icon: '/static/tabbar/focus.png', active: '/static/tabbar/focus-active.png' },
  { key: 'goals', text: '目标', path: '/pages/goals/goals', icon: '/static/tabbar/goals.png', active: '/static/tabbar/goals-active.png' },
  { key: 'stats', text: '统计', path: '/pages/stats/stats', icon: '/static/tabbar/stats.png', active: '/static/tabbar/stats-active.png' },
  { key: 'profile', text: '我的', path: '/pages/profile/profile', icon: '/static/tabbar/profile.png', active: '/static/tabbar/profile-active.png' }
];

export const TAB_TEXT_EN = {
  home: 'Focus',
  goals: 'Goals',
  stats: 'Stats',
  profile: 'Me'
};

export function tabIndex(key) {
  for (let i = 0; i < TABS.length; i++) if (TABS[i].key === key) return i;
  return -1;
}

// 底栏文案：zh 用 TABS 里的中文，en 用 TAB_TEXT_EN（底栏空间小，英文要短）
export function tabText(key) {
  const t = TABS.filter(x => x.key === key)[0];
  if (!t) return '';
  try {
    if (typeof i18n !== 'undefined' && i18n.isEn && i18n.isEn()) return TAB_TEXT_EN[key] || t.text;
  } catch (e) {}
  return t.text;
}

export function tabAt(i) {
  return i >= 0 && i < TABS.length ? TABS[i] : null;
}

// ---------- 切换意图 ----------
// 点击底栏或手势松手都会先写这里，目标页 onShow 时取走（取走即失效，只播一次）
// ⚠️ App 端每个 tab 页是**独立 webview**，模块级变量不共享（2026-10-31 scrcpy 逐帧
//    实锤：底栏胶囊跨页切换从来没有滑动中间帧 = 旧页面写的模块级状态新页面读不到）。
//    所以意图必须同时落一份 storage：模块级给 H5（单上下文）用，storage 给 App 端
//    跨 webview 用。takeEnter 消费后两边都清（一次性，防止重复播 / 冷启动误播）。
let pending = null;
const PENDING_TTL = 1500;   // 超过这个时间没被取走就当废弃（防止误播）
const INTENT_KEY = 'tab_slide_intent';

function saveIntent(intent) {
  pending = intent;
  try {
    if (typeof uni !== 'undefined' && uni.setStorageSync) uni.setStorageSync(INTENT_KEY, intent);
  } catch (e) { /* storage 不可用：H5 模块级那条路仍有效 */ }
}

function loadIntent() {
  if (pending) return pending;                     // H5：同上下文直接命中
  try {
    if (typeof uni !== 'undefined' && uni.getStorageSync) {
      return uni.getStorageSync(INTENT_KEY) || null;
    }
  } catch (e) { /* 退化到无方向 */ }
  return null;
}

function dropIntent() {
  pending = null;
  try {
    if (typeof uni !== 'undefined' && uni.removeStorageSync) uni.removeStorageSync(INTENT_KEY);
  } catch (e) { /* 同上 */ }
}

export function markSwitch(fromKey, toKey) {
  const from = tabIndex(fromKey);
  const to = tabIndex(toKey);
  if (from < 0 || to < 0 || from === to) return '';
  saveIntent({ from: from, to: to, at: Date.now() });
  return to > from ? 'right' : 'left';
}

// 目标页调用：返回 'left' | 'right' | ''
export function takeEnter(key) {
  const p = loadIntent();
  dropIntent();                                    // 一次性消费
  if (!p) return '';
  if (tabIndex(key) !== p.to) return '';           // 不是这次的目标页
  if (Date.now() - p.at > PENDING_TTL) return '';  // 过期（比如中间隔了别的导航）
  return p.to > p.from ? 'right' : 'left';
}

export function clearPending() {
  dropIntent();
}

// ---------- 手势参数 ----------
export const DRAG = {
  AXIS: 8,       // 判定方向所需的最小位移(px)
  RATIO: 1.2,    // 横向要明显大于纵向才认作横滑（否则让页面正常上下滚）
  MAX: 120,      // 跟手位移上限(px)，超过部分加阻尼
  TRIGGER: 60    // 松手触发切页的阈值(px)
};

// 阻尼：越界后位移增速降到 1/4，手指拖再远也不会把内容甩出屏幕
export function dampOffset(dx) {
  const sign = dx < 0 ? -1 : 1;
  const a = Math.abs(dx);
  if (a <= DRAG.MAX) return dx;
  return sign * (DRAG.MAX + (a - DRAG.MAX) * 0.25);
}

// 相邻 tab：step = -1 上一个，+1 下一个；没有就返回 null（边缘）
export function neighbor(key, step) {
  return tabAt(tabIndex(key) + step);
}

// utils/tab-slide.js - 底部 tab 的次序、切换方向与"内容左右滑动"
import * as i18n from './i18n.js';
//
// 两个职责：
//  1) 记录"从哪个 tab 切到哪个 tab"，让目标页进场时知道该从左还是从右滑入
//     （索引变大 → 从右滑入；索引变小 → 从左滑入）
//  2) 手势拖拽的参数与阻尼：内容跟手位移，松手超过阈值才切页，否则弹回
//
// tab 页在 uni-app 里是常驻的（switchTab 不销毁），所以"上一次停留的 tab"
// 这类跨页状态必须放模块级，不能放组件实例里。

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
let pending = null;
const PENDING_TTL = 1500;   // 超过这个时间没被取走就当废弃（防止误播）

export function markSwitch(fromKey, toKey) {
  const from = tabIndex(fromKey);
  const to = tabIndex(toKey);
  if (from < 0 || to < 0 || from === to) return '';
  pending = { from: from, to: to, at: Date.now() };
  return to > from ? 'right' : 'left';
}

// 目标页调用：返回 'left' | 'right' | ''
export function takeEnter(key) {
  if (!pending) return '';
  const p = pending;
  pending = null;                                  // 一次性消费
  if (tabIndex(key) !== p.to) return '';           // 不是这次的目标页
  if (Date.now() - p.at > PENDING_TTL) return '';  // 过期（比如中间隔了别的导航）
  return p.to > p.from ? 'right' : 'left';
}

export function clearPending() {
  pending = null;
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

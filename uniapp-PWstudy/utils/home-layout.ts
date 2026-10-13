// utils/home-layout.ts - 首页模块（桌面式小组件）的顺序与收纳
//
// 职责：
//   · 维护一张「模块注册表」：首页能放的组件就这些，加新组件只改这里
//   · 读写用户的首页布局（顺序）与收纳区（未放进首页的模块）
//   · 持久化挂在 settings 里（utils/settings.js），与学习进度互不干扰
//
// 收纳区不单独存：stashed = 所有模块 - 当前布局，避免两份状态对不上。
import * as settings from './settings.js';

export interface HomeModule {
  id: string;
  name: string;
  desc: string;
  /** 是否默认就在首页里 */
  def: boolean;
}

/**
 * 首页可选组件（顺序 = 首次进入的默认顺序）
 *
 * 默认留四张：番茄专注 · 今日紧迫程度 · 今日任务 · 进行中的目标。
 * 紧迫度紧跟在番茄钟后面：它是"今天到底有多赶"的一眼判断，
 * 排在任务列表之前——先看紧不紧张，再看具体做什么。
 * 其余（学习 App、AI 对话）默认收进收纳区 —— 首页是"要开始专注"的地方，
 * 不是信息看板；需要的话在「首页自定义」里加回来即可。
 */
export const MODULES: HomeModule[] = [
  { id: 'focus', name: '番茄专注', desc: '当前番茄的倒计时，点一下进入全屏专注页', def: true },
  { id: 'urgency', name: '今日紧迫程度', desc: '还剩多少时间、活有多重、有多赶：环 / 方块 / 时间条一眼看完', def: true },
  { id: 'task', name: '今日任务', desc: '今天要做的任务队列，点行直接开始专注', def: true },
  { id: 'goal', name: '进行中的目标', desc: '里程碑进度与剩余天数', def: true },
  // 日程表：与日历页共用 components/schedule-list（同一套字段与样式），
  // 只是首页默认只显示今天的前几条，点「查看全部」再进完整日历。
  { id: 'schedule', name: '日程表', desc: '某一天的日程安排，可就地前移 / 后移一天', def: true },
  { id: 'dock', name: '学习 App', desc: '登记的学习类 App，点图标直达并统计用时', def: false },
  { id: 'coach', name: 'AI 今日对话', desc: '一句话汇报今天，AI 判断要不要重排后面', def: false }
];

const IDS: string[] = MODULES.map(m => m.id);

export function defaultLayout(): string[] {
  return MODULES.filter(m => m.def).map(m => m.id);
}

export function moduleOf(id: string): HomeModule | null {
  for (const m of MODULES) {
    if (m.id === id) return m;
  }
  return null;
}

export function normalize(list: any): string[] {
  const arr = Array.isArray(list) ? list : [];
  const out: string[] = [];
  for (const id of arr) {
    const key = String(id || '');
    if (IDS.indexOf(key) >= 0 && out.indexOf(key) < 0) out.push(key);
  }
  // 兜底：被清空或全是非法值时，恢复默认布局，避免首页变成空白
  return out.length ? out : defaultLayout();
}

/**
 * 布局版本：注册表新增模块时用它把新模块**补一次**进老用户的布局。
 * 不做这件事的话，老用户升级后永远看不到新模块（他的 layout 是旧的四项），
 * 只能自己发现"添加组件"里有 —— 那跟没做一样。
 */
const LAYOUT_VER = 2;   // 2 = 2026-10-12 新增「日程表」

/** 当前布局（已归一） */
export function layout(): string[] {
  const st: any = settings.get() || {};
  const home = st.home || {};
  const cur = normalize(home.layout);
  if ((home.layoutVer || 0) >= LAYOUT_VER) return cur;
  // 只补"出厂该在、但还没在"的；用户后来自己收纳掉的不会被再加回来
  // （这次迁移只跑一次，跑完就置版本号）
  const add = MODULES.filter(m => m.def && cur.indexOf(m.id) < 0).map(m => m.id);
  const next = add.length ? cur.concat(add) : cur;
  settings.set({ home: { layoutVer: LAYOUT_VER, layout: next } });
  return next;
}

/** 保存布局，返回归一后的结果 */
export function saveLayout(list: string[]): string[] {
  const next = normalize(list);
  settings.set({ home: { layout: next } });
  return next;
}

/** 收纳区：没被放进首页的模块 */
export function stashed(): HomeModule[] {
  const cur = layout();
  return MODULES.filter(m => cur.indexOf(m.id) < 0);
}

/** 把模块移出首页（收纳） */
export function stash(id: string): string[] {
  const cur = layout().filter(x => x !== id);
  return saveLayout(cur);
}

/** 从收纳区加回首页（追加到末尾） */
export function restore(id: string): string[] {
  const cur = layout();
  if (cur.indexOf(id) >= 0) return cur;
  cur.push(id);
  return saveLayout(cur);
}

/**
 * 拖拽落点：根据手指位移 dy（px，正=向下）与各模块实际高度，算出松手后应落在第几位。
 * 纯函数，不碰 DOM，方便单测；页面只需把 touchmove 的位移喂进来。
 */
export function dropIndex(from: number, dy: number, heights: number[]): number {
  const hs = Array.isArray(heights) ? heights : [];
  const n = hs.length;
  if (!n || from < 0 || from >= n || !dy) return from;
  let to = from;
  if (dy > 0) {
    let s = 0;
    for (let i = from + 1; i < n; i++) {
      s += hs[i - 1];
      // 越过目标一半高度即认为该换位
      if (dy > s - hs[from] / 2 + hs[i] / 2) to = i;
      else break;
    }
  } else {
    let s = 0;
    for (let i = from - 1; i >= 0; i--) {
      s += hs[i + 1];
      if (-dy > s - hs[from] / 2 + hs[i] / 2) to = i;
      else break;
    }
  }
  return to;
}

/** 拖拽换位：把 from 位置移动到 to 位置 */
export function move(from: number, to: number): string[] {
  const cur = layout();
  if (from < 0 || from >= cur.length) return cur;
  if (to < 0) to = 0;
  if (to >= cur.length) to = cur.length - 1;
  if (from === to) return cur;
  const item = cur.splice(from, 1)[0];
  cur.splice(to, 0, item);
  return saveLayout(cur);
}

export { settings };

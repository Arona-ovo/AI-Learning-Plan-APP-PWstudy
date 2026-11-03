// utils/calmark.js - 日历标注（补习日 / 节日·无法学习日 / 普通标注）
//
// 为什么要独立一条存储线（不塞进 settings，也不塞进某个 goal）：
//   · 这些是「日历上的标记」，和「学习进度（pwstore）」「偏好（settings）」都不是一回事；
//   · 来源有两条：① AI 重排时识别出的固定安排（补习班 / 上课）② 用户自己在日历里手标的；
//   · 标记是 app 级的（补习日不该只挂在某个目标下，日历是全局视图），所以单开一个 key。
//
// 颜色约束（用户 2026-11-03 明示）：一律**淡色 / 低饱和**的粉彩，
//   像日历原本那种浅黄 / 浅蓝 / 浅绿 —— 不能上多巴胺亮色，否则和整体磨砂观感打架。
//   所以色板 PASTEL 全是低饱和淡色，DEFAULT_COLORS 也是粉彩；用户只能在这套里挑。

const KEY = 'fj_calmark_v1';
let cache = null;

// 三种语义（日历图例 + 设置页都按这个口径）
export const MARKER_TYPES = {
  tutor: { key: 'tutor', name: '补习 / 固定安排' },
  blocked: { key: 'blocked', name: '节日 / 无法学习' },
  event: { key: 'event', name: '普通标注' }
};

// 淡色色板：低饱和、像日历原本那种浅色调。禁多巴胺亮色。
// 每种语义一个默认色（tutor=浅蓝 / blocked=浅红 / event=浅紫），其余给「改色」用。
export const PASTEL = [
  '#bcd0f7', // 淡蓝
  '#f6c2cf', // 淡红
  '#c4e6c8', // 淡绿
  '#e7d4f2', // 淡紫
  '#f7e1b8', // 淡橙
  '#bfe6e2', // 淡青
  '#f3e0a8', // 淡黄
  '#d6dbe0'  // 淡灰
];

export const DEFAULT_COLORS = {
  tutor: '#bcd0f7',
  blocked: '#f6c2cf',
  event: '#e7d4f2'
};

function uid() {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function validType(t) {
  return MARKER_TYPES[t] ? t : 'event';
}

// 颜色必须落在 PASTEL 里（或至少是个合法淡 hex）。AI 给的色若不在色板内，
// 按色相最近归一到色板，避免亮色混进来。非法色回退到该语义的默认淡色。
function safeColor(hex, type) {
  const c = normalizeHex(hex);
  if (!c) return DEFAULT_COLORS[type] || PASTEL[0];
  if (PASTEL.indexOf(c) >= 0) return c;
  // 不在色板：按色相找最近的一个淡色，保证观感统一（不引入亮色）
  return nearestPastel(c);
}

function normalizeHex(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return '';
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return '#' + h.toLowerCase();
}

function hslOf(hex) {
  const c = normalizeHex(hex);
  if (!c) return { h: 0, s: 0, l: 0 };
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function nearestPastel(hex) {
  const a = hslOf(hex);
  let best = PASTEL[0], bestD = 1e9;
  PASTEL.forEach(p => {
    const b = hslOf(p);
    const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
    const ds = Math.abs(a.s - b.s);
    const dl = Math.abs(a.l - b.l);
    const d = dh * 1.0 + ds * 1.6 + dl * 1.2;   // 饱和度 / 明度差权重大一点（淡色之间主要是这俩在分）
    if (d < bestD) { bestD = d; best = p; }
  });
  return best;
}

function load() {
  try {
    const v = uni.getStorageSync(KEY);
    if (v && Array.isArray(v.markers)) return v;
  } catch (e) {}
  return { markers: [] };
}

function get() {
  if (!cache) cache = load();
  return cache;
}

function save() {
  try { uni.setStorageSync(KEY, cache); } catch (e) {}
}

/** 全部标注（副本，按创建时间升序） */
export function list() {
  return (get().markers || []).slice();
}

/** 新增一条（返回创建的对象） */
export function add(marker) {
  const g = get();
  if (!Array.isArray(g.markers)) g.markers = [];
  const m = normalizeMarker(marker);
  g.markers.push(m);
  save();
  return m;
}

/** 局部更新（patch），返回更新后的对象 */
export function update(id, patch) {
  const g = get();
  const m = (g.markers || []).filter(x => x.id === id)[0];
  if (!m) return null;
  const merged = Object.assign({}, m, patch);
  // 颜色 / 类型重新走安全口径，别让非法值混进来
  if ('color' in patch) merged.color = safeColor(patch.color, merged.type);
  if ('type' in patch) merged.type = validType(patch.type);
  const idx = g.markers.indexOf(m);
  g.markers[idx] = merged;
  save();
  return merged;
}

/** 删除（按 id） */
export function remove(id) {
  const g = get();
  const before = (g.markers || []).length;
  g.markers = (g.markers || []).filter(x => x.id !== id);
  if (g.markers.length !== before) { save(); return true; }
  return false;
}

/** 把一条规范成存储形状（缺省兜底，非法值过滤） */
function normalizeMarker(m) {
  m = m || {};
  const type = validType(m.type);
  let weekdays = Array.isArray(m.weekdays) ? m.weekdays.filter(n => n >= 0 && n <= 6).map(n => Number(n)) : [];
  let dates = Array.isArray(m.dates) ? m.dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(d => d) : [];
  let rule = m.rule === 'dates' ? 'dates' : 'weekly';
  if (rule === 'dates' && !dates.length) rule = 'weekly';
  if (rule === 'weekly' && !weekdays.length) weekdays = (m.weekdays && m.weekdays.length) ? weekdays : [];
  return {
    id: m.id || uid(),
    type: type,
    label: String(m.label || MARKER_TYPES[type].name).slice(0, 20),
    color: safeColor(m.color, type),
    rule: rule,
    weekdays: weekdays.slice(0, 7),
    dates: dates.slice(0, 366),
    time: String(m.time || '').slice(0, 40),
    createdAt: m.createdAt || Date.now(),
    auto: !!m.auto
  };
}

/**
 * 从 AI 识别出的固定安排造标注。
 * fixedItem: { name, when, place, weekdays?, dates?, type?, color? }
 * 返回新建的标注数组（已落库）；数组上额外挂 `skipped`（读不出时间的名字）。
 */
export function addFromFixed(fixedItems, defaultColors) {
  const out = [];
  const skipped = [];
  (Array.isArray(fixedItems) ? fixedItems : []).forEach(f => {
    if (!f || !f.name) return;
    const type = inferType(f.type, f.name, f.when);
    const color = safeColor(f.color, type);
    // ① 模型直接给了结构化日期 / 周几 → 优先用
    let dates = Array.isArray(f.dates) ? f.dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
    let weekdays = Array.isArray(f.weekdays)
      ? f.weekdays.map(n => Number(n)).filter(n => n >= 0 && n <= 6)
      : [];
    // ② 否则从 when 里读：先找具体日期（2026-11-26 / 11月26日），再找周几
    if (!dates.length && !weekdays.length) {
      dates = parseDates(f.when);
      if (!dates.length) weekdays = parseWeekdays(f.when);
    }
    // ③ 两样都读不出来 → 这条标注永远不在任何一天命中（rule=weekly + 空 weekdays
    //    的隐形数据）。宁可跳过并回报，让页面提示用户去日历手动标，
    //    也不要塞一条"看不见的标注"骗自己已经记上了。
    if (!dates.length && !weekdays.length) {
      skipped.push(f.name);
      return;
    }
    // 同名已存在（上一次识别过）→ 只补空的 weekdays / dates / time，不重复建
    const exist = (get().markers || []).filter(m => m.label === f.name)[0];
    if (exist) {
      const patch = {};
      if (weekdays.length && (!exist.weekdays || !exist.weekdays.length)) patch.weekdays = weekdays;
      if (dates.length && (!exist.dates || !exist.dates.length)) patch.dates = dates;
      if (f.when && !exist.time) patch.time = f.when;
      if (Object.keys(patch).length) update(exist.id, patch);
      out.push(exist);
      return;
    }
    out.push(add({
      type: type,
      label: f.name,
      color: color,
      rule: dates.length ? 'dates' : 'weekly',
      weekdays: weekdays,
      dates: dates,
      time: f.when || '',
      auto: true
    }));
  });
  // 挂在数组上而不是改返回形状：调用方 `added.length` 的老写法保持有效
  out.skipped = skipped;
  return out;
}

/** 按内容推断语义：补习 / 上课 / 辅导 / 班 → tutor；节 / 假 / 旅行 / 休息 / 无法 → blocked；其余 event */
function inferType(explicit, name, when) {
  if (MARKER_TYPES[explicit]) return explicit;
  const s = String(name || '') + ' ' + String(when || '');
  if (/补习|补课|上课|辅导|课程|培训|班|兴趣班|晚托/.test(s)) return 'tutor';
  if (/节|假|旅行|旅游|休息|无法学习|休学|军训|实习|考试|考研|竞赛|闭馆/.test(s)) {
    // 考试 / 竞赛这类"占用且不能排常规学习"也算 blocked（无法学习日）
    return 'blocked';
  }
  return 'event';
}

/**
 * 解析「周几」文本 → JS getDay 数字数组（0=周日 … 6=周六）。
 * 支持：周一~周日 / 一二三四五六日 / Mon..Sun / 每天 / 工作日 / 周末 /
 *       范围"周一至周三"；附带的时间（9:00-12:00）忽略。
 * 解析不出返回 []（调用方据此退化为「没排定周期」，让用户自己补）。
 */
export function parseWeekdays(text) {
  // ⚠️ 先把日期片段整段剔掉再找"周几"：否则「11月26日」里的「日」会被
  //    当成周日 —— 一条具体日期的补习安排会被错误铺到每个月所有周日上。
  const s = String(text || '')
    .replace(/\d{4}\s*[-\/.]\s*\d{1,2}\s*[-\/.]\s*\d{1,2}/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ')
    .replace(/\d{1,2}\s*\/\s*\d{1,2}/g, ' ')
    .replace(/[0-9:：\-\s]+/g, ' ')
    .trim();
  const out = [];
  const add = (n) => { if (out.indexOf(n) < 0) out.push(n); };
  // 每天
  if (/每天|每日|全周|一周/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  // 工作日（周一~周五）
  if (/工作日|周中|上班|上学\(非周末\)/.test(s)) return [1, 2, 3, 4, 5];
  // 周末
  if (/周末/.test(s) && !/工作日/.test(s)) return [0, 6];
  // 范围：周一至周三 / 周一到周三 / 一二三
  const range = s.match(/周?([一二三四五六日天])\s*(?:至|到|—|-)\s*周?([一二三四五六日天])/);
  if (range) {
    const a = cnDay(range[1]); const b = cnDay(range[2]);
    if (a >= 0 && b >= 0) {
      let i = a; const step = a <= b ? 1 : -1;
      while (true) { add(i); if (i === b) break; i = (i + step + 7) % 7; if (out.length > 7) break; }
      return out;
    }
  }
  // 单个或并列：周一、三、五 / 二三
  const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0, 'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6 };
  const re = /周?([一二三四五六日天])|mon|tue|wed|thu|fri|sat|sun/gi;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1] ? m[1] : m[0].toLowerCase();
    if (k in map) add(map[k]);
  }
  return out;
}

/**
 * 从文字里抽具体日期 → ['YYYY-MM-DD']。
 * 支持：2026-11-26 / 2026/11/26 / 11月26日 / 11月26号 / 11/26 / 11月26日-28日
 * 没写年份按今年算；已过去超过 60 天的往后滚一年
 * （补习班通知里的"11月26日"更可能是下一次，而不是半年前的）。
 */
export function parseDates(text, ref) {
  const s = String(text || '');
  if (!s) return [];
  const base = (ref instanceof Date) ? ref : new Date();
  const y0 = base.getFullYear();
  const out = [];
  const push = (y, mo, d) => {
    mo = Number(mo); d = Number(d);
    if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return;
    const dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return;   // 2月30日这类非法日期
    const iso = y + '-' + pad(mo) + '-' + pad(d);
    if (out.indexOf(iso) < 0) out.push(iso);
  };
  const yearRoll = (mo, d) => {
    let y = y0;
    const dt = new Date(y, mo - 1, d);
    if (base.getTime() - dt.getTime() > 60 * 86400000) y += 1;
    return y;
  };
  let m;
  // 带年份：2026-11-26 / 2026/11/26 / 2026.11.26
  const reY = /(\d{4})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{1,2})/g;
  while ((m = reY.exec(s))) push(Number(m[1]), m[2], m[3]);
  // 中文月日：11月26日 / 11月26号 / 11月26
  const reCN = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g;
  while ((m = reCN.exec(s))) {
    const mo = Number(m[1]); const d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) push(yearRoll(mo, d), mo, d);
  }
  // 斜杠：11/26（9:00 这类时间不会被吃进来）
  const reSlash = /(?:^|[^\d\/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d\/])/g;
  while ((m = reSlash.exec(s))) {
    const mo = Number(m[1]); const d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) push(yearRoll(mo, d), mo, d);
  }
  // 同月区间：11月26日-28日（上一轮只补到首尾，这里把中间几天补齐）
  const reRange = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*(?:至|到|-|~|—)\s*(\d{1,2})\s*[日号]/g;
  while ((m = reRange.exec(s))) {
    const mo = Number(m[1]); const a = Number(m[2]); const b = Number(m[3]);
    if (!(mo >= 1 && mo <= 12) || !(a >= 1 && b >= 1 && b >= a)) continue;
    for (let d = a; d <= b && d - a < 31; d++) push(yearRoll(mo, d), mo, d);
  }
  return out;
}

function cnDay(c) {
  const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 };
  return c in map ? map[c] : -1;
}

/**
 * 某条标注在指定年月覆盖哪些日期（'YYYY-MM-DD'）。
 * weekly：该月所有命中 weekday 的日期；dates：落在那个月里的具体日期。
 */
export function datesFor(marker, year, month) {
  const m = marker;
  if (!m) return [];
  const y = Number(year), mo = Number(month);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const out = [];
  if (m.rule === 'dates' && Array.isArray(m.dates)) {
    m.dates.forEach(d => {
      const p = String(d || '').split('-');
      if (Number(p[0]) === y && Number(p[1]) === mo) out.push(d);
    });
    return out;
  }
  // weekly
  const wd = (Array.isArray(m.weekdays) && m.weekdays.length) ? m.weekdays : [];
  if (!wd.length) return [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(y, mo - 1, d);
    if (wd.indexOf(dt.getDay()) >= 0) out.push(y + '-' + pad(mo) + '-' + pad(d));
  }
  return out;
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

/**
 * 给定年月，返回日期→标注数组的映射（只算那个月，避免跨月膨胀）。
 * 同一条标注可能覆盖多天（weekly），所以同一天可能有多个标注。
 */
export function byMonth(year, month) {
  const map = {};
  list().forEach(m => {
    datesFor(m, year, month).forEach(d => {
      if (!map[d]) map[d] = [];
      map[d].push(m);
    });
  });
  return map;
}

/** 取某语义的默认色（来自 settings.calendar，回退内置） */
export function defaultColorForType(type, settings) {
  const c = (settings && settings.calendar && settings.calendar[type + 'Color']) || DEFAULT_COLORS[type];
  return normalizeHex(c) || DEFAULT_COLORS[type];
}

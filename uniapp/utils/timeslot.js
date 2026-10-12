// utils/timeslot.js - 任务的时段安排（早 / 中 / 晚）
//
// 为什么单独一个模块：
//   时段是任务的一个维度，产生点在 AI 规划（模型给）+ 本地兜底（轮转分），
//   消费点有三处（向导结果页 / 目标详情 / 首页今日任务）。两边必须用同一套词汇
//   （'am' 'noon' 'pm'）和同一套兜底规则，散在页面里各写一份必然对不上，
//   而且"模型没给时段"这种情况总得有人兜 —— 兜的地方也只能有一个。
//
// ⚠️ 总开关在 settings.plan.slot（默认开）。**关掉之后是纯回退，不是清空**：
//   · 规划不再追问时段、提示词不下发 slot 字段、normalizePlan / localPlan 不产出 slot
//   · 已有任务身上的 slot 字段**原样留着**（不删数据），只是界面不显示
//   · 提交逻辑一行都不改 —— plan.tasks 少带一个字段而已，pwstore / 重排全不受影响
//   这样用户随时关随时开，开了原来那批任务的时间安排还在。

import * as settings from './settings.js';

/** 顺序固定：早上 → 中午 → 晚上（界面分组与排序都按这个来） */
export const KEYS = ['am', 'noon', 'pm'];

// start = 这个时段"开始"的时间点：到点了就发一条"该开始了"的提醒（见 reminder.checkSlot）。
// 取的是多数人真正能坐下来的点，不是段位的边界（早上 6 点没人起得来学）。
export const SLOTS = [
  { key: 'am',   name: '早上', hint: '6:00-12:00',  start: '08:00' },
  { key: 'noon', name: '中午', hint: '12:00-18:00', start: '13:00' },
  { key: 'pm',   name: '晚上', hint: '18:00-24:00', start: '19:30' }
];

/** 太晚就不打扰：过了这个点，今天再催也只会让人烦 */
const LATEST_MIN = 23 * 60;

/** 认哪些说法：模型可能写英文、中文、甚至是"晚上 8 点"这种 */
const HIT = [
  ['am',   ['am', 'a.m.', 'morning', '早上', '早晨', '清晨', '上午', '一早', '早']],
  ['noon', ['noon', 'midday', 'afternoon', '中午', '晌午', '午后', '下午']],
  ['pm',   ['pm', 'p.m.', 'evening', 'night', '晚上', '傍晚', '夜里', '夜间', '深夜', '晚']]
];

/** 时段安排的开关（settings.plan.slot）。老数据没有这个字段 → 按开算 */
export function enabled() {
  try {
    const p = (settings.get() || {}).plan || {};
    return p.slot !== false;
  } catch (e) {
    return true;
  }
}

/** 开关写回设置。返回写完的状态 */
export function setEnabled(on) {
  try {
    settings.set({ plan: { slot: !!on } });
  } catch (e) {}
  return enabled();
}

/**
 * 时段到点提醒的开关（settings.plan.slotNotify，默认开）。
 * 时段安排本身关着时这里必然是关 —— 没有时段就没有"到点"可言。
 */
export function notifyOn() {
  if (!enabled()) return false;
  try {
    const p = (settings.get() || {}).plan || {};
    return p.slotNotify !== false;
  } catch (e) {
    return true;
  }
}

export function setNotifyOn(on) {
  try {
    settings.set({ plan: { slotNotify: !!on } });
  } catch (e) {}
  return notifyOn();
}

/**
 * 任意说法 → 'am' | 'noon' | 'pm'，认不出来返回 ''。
 * 数字时间也认（'20:00' / '20点' / 20），模型偶尔会这么给。
 */
export function normalize(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  if (/^[0-9]/.test(s)) {
    const h = Number((/^(\d{1,2})/.exec(s) || [])[1]);
    if (!isNaN(h) && h >= 0 && h <= 23) return h < 12 ? 'am' : (h < 18 ? 'noon' : 'pm');
  }
  for (let i = 0; i < HIT.length; i++) {
    for (let j = 0; j < HIT[i][1].length; j++) {
      if (s.indexOf(HIT[i][1][j]) >= 0) return HIT[i][0];
    }
  }
  return '';
}

export function indexOf(key) {
  const i = KEYS.indexOf(normalize(key));
  return i < 0 ? KEYS.length : i;   // 没有时段的排在最后，不会被挤到前面
}

export function itemOf(key) {
  const k = normalize(key);
  return SLOTS.filter(x => x.key === k)[0] || null;
}

/** 界面上显示的那两个字（'晚上'）；认不出来给空串，别显示个 undefined */
export function labelOf(key) {
  const it = itemOf(key);
  return it ? it.name : '';
}

export function hintOf(key) {
  const it = itemOf(key);
  return it ? it.hint : '';
}

/** 可用时段（用户勾选的那几个）洗净；一个都没勾 / 勾了认不出的 → 全开 */
export function availOf(keys) {
  const list = (Array.isArray(keys) ? keys : []).map(normalize).filter(Boolean);
  const out = [];
  KEYS.forEach(k => { if (list.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k); });
  return out.length ? out : KEYS.slice();
}

/** '早上、晚上' —— 给提示词与界面摘要用 */
export function namesOf(keys) {
  return availOf(keys).map(labelOf).join('、');
}

/** 这个时段几点开始（'08:00'） */
export function startOf(key) {
  const it = itemOf(key);
  return it ? it.start : '';
}

function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 这个时段起点 = 当天第几分钟；认不出来返回 null */
export function startMinutesOf(key) {
  const v = hhmmToMin(startOf(key));
  return (v == null || !normalize(key)) ? null : v;
}

/**
 * 现在该提醒哪个时段：取"最后一个已经到点"的段。
 *
 * 为什么不一次把所有过点的段都补发：早上没催到、中午才打开 App，
 * 最有用的是"中午该做什么"，补早上的那条只会让人莫名其妙。
 * 太晚（23 点后）一律不打扰。没到第一个时段也返回 ''。
 */
export function keyNow(now) {
  const d = now || new Date();
  const cur = d.getHours() * 60 + d.getMinutes();
  if (cur >= LATEST_MIN) return '';
  for (let i = KEYS.length - 1; i >= 0; i--) {
    const s = startMinutesOf(KEYS[i]);
    if (s != null && cur >= s) return KEYS[i];
  }
  return '';
}

/**
 * 把任务的时段规整到用户勾选的可用时段里。
 *
 * 为什么必须做（两件事一起办）：
 *  ① 模型漏给 slot 是常态（任务一多就漏），结果页要按早/中/晚三组排布，
 *     缺一组就成了两组的怪样子 —— 所以空的要补；
 *  ② 模型也会**无视用户勾选**（只勾了晚上，它照样给你排到早上），
 *     所以不在可用范围内的值也要拉回来 —— 用户说晚上才有空，早上那条等于没排。
 *
 * 补的时候接着上一个已定的时段往后轮（不是从头再来），这样时段分布是匀的；
 * 顺手把中文说法归一成代号写回，库里只存 am/noon/pm。
 */
export function spread(tasks, keys) {
  const list = Array.isArray(tasks) ? tasks : [];
  const pool = availOf(keys);
  let i = 0;
  list.forEach(t => {
    if (!t || typeof t !== 'object') return;
    const cur = normalize(t.slot);
    const at = cur ? pool.indexOf(cur) : -1;
    if (at >= 0) {
      t.slot = cur;
      i = at + 1;               // 下一个从它后面接，分布才匀
    } else {
      t.slot = pool[i % pool.length];
      i++;
    }
  });
  return list;
}

/**
 * 按早 / 中 / 晚分组（只返回非空的组，组内保持传入顺序）。
 * 没有时段的（老数据 / 关掉开关时生成的）兜在最后一组，不显示小标题。
 */
export function groupOf(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const buckets = {};
  const rest = [];
  list.forEach(t => {
    const k = normalize(t && t.slot);
    if (!k) { rest.push(t); return; }
    (buckets[k] = buckets[k] || []).push(t);
  });
  const out = [];
  KEYS.forEach(k => {
    if (buckets[k] && buckets[k].length) {
      out.push({ key: k, name: labelOf(k), hint: hintOf(k), tasks: buckets[k] });
    }
  });
  if (rest.length) out.push({ key: '', name: '', hint: '', tasks: rest });
  return out;
}

/** '早上 3 个 · 晚上 4 个' —— 结果页概览那一行 */
export function brief(tasks) {
  return groupOf(tasks)
    .filter(g => g.key)
    .map(g => g.name + ' ' + g.tasks.length + ' 个')
    .join(' · ');
}

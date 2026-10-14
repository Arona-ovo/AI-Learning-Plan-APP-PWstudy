// utils/reminder.js - 每日提醒：到点催一句"今天该做的事"
//
// 为什么需要它：目标一旦落地，最难的不是排计划而是**每天都想起来**。
// 专注计时管的是"开始了之后别跑掉"，这个管的是"今天还没开始"。
//
// 时间存在 goal.remindAt（'HH:mm'，空串 = 不提醒），跟着目标走 —— 不同目标可以
// 定不同的时间（早上背单词、晚上刷阅读），全局一个开关反而没法这么用。
//
// ⚠️ 触发方式的边界（说清楚，别让人以为它是系统闹钟）：
//   这是**前台到点 + 进 App 补发**的方案。App 没在前台时系统不会替我们弹通知，
//   所以"没打开 App 也能准点响"要靠原生 AlarmManager（得进 UTS 插件）。
//   现在的做法保证：只要 App 开着，到点就弹；没开着，下次进来会补一句（当天只补一次）。
//
// 提醒过没过记在 goal.lastRemindDate（'YYYY-MM-DD'），一天最多一次。

import * as pw from './pwstore.js';
import * as notify from './notify.js';
import * as pacing from './pacing.js';
import * as timeslot from './timeslot.js';

/** 可选的时间点（够用就好；真要选任意分钟再说） */
export const TIMES = ['07:00', '08:00', '09:00', '12:30', '14:00', '18:00', '19:30', '20:00', '21:30', '22:00'];

/** 默认时间：晚上 —— 白天各有各的事，晚上才是大多数人真正能坐下来的时候 */
export const DEFAULT = '20:00';

/** 太晚就不打扰：过了这个点，今天再提醒也只会让人烦 */
const LATEST_MIN = 23 * 60;

/** 'HH:mm' → 当天第几分钟；解析不出来返回 null */
export function minutesOf(hhmm) {
  const s = String(hhmm || '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

/** 是不是一个可用的提醒时间 */
export function valid(hhmm) {
  return minutesOf(hhmm) != null;
}

/** 今天该做、还没做的（按 day 排） */
function todoList(g) {
  if (!g) return [];
  const start = g.createdAt ? pw.dateStr(new Date(g.createdAt)) : pw.today();
  const elapsed = pw.dayDiff(start, pw.today()) + 1;
  return (g.tasks || [])
    .filter(t => t.status === 'todo' && (t.day || 1) <= elapsed)
    .sort((a, b) => (a.day || 1) - (b.day || 1));
}

/** 这个目标接下来该做的那件事（今天的、还没做的、最早的一天） */
export function nextTask(g) {
  return todoList(g)[0] || null;
}

/** 今天某个时段里该做的事（空 = 这个时段不用打扰） */
export function tasksInSlot(g, key) {
  const k = timeslot.normalize(key);
  if (!k) return [];
  return todoList(g).filter(t => timeslot.normalize(t.slot) === k);
}

/** 给这个目标写提醒时间（空串 = 不提醒） */
export function setRemind(goalId, hhmm) {
  const g = pw.goalOf(goalId);
  if (!g) return null;
  g.remindAt = valid(hhmm) ? String(hhmm).trim() : '';
  pw.touch();
  return g;
}

/** 界面上显示的那句（'每天 20:00' / '不提醒'） */
export function labelOf(g) {
  if (!g || !valid(g.remindAt)) return '不提醒';
  return '每天 ' + g.remindAt;
}

/**
 * 检查并发提醒。
 * @param {{now?:Date}} opt
 * @returns {number} 这次提醒了几个目标
 */
export function check(opt) {
  const o = opt || {};
  const now = o.now || new Date();
  const today = pw.today();
  const cur = now.getHours() * 60 + now.getMinutes();
  if (cur >= LATEST_MIN) return 0;   // 太晚了，今天不打扰

  let n = 0;
  pw.activeGoals().forEach((g, i) => {
    if (!valid(g.remindAt)) return;
    if (g.lastRemindDate === today) return;      // 今天已经催过了
    const at = minutesOf(g.remindAt);
    if (at == null || cur < at) return;          // 还没到点
    const t = nextTask(g);
    // 今天没有待办就不打扰 —— 提醒"你今天没事"没有意义
    if (!t) return;
    const pomos = Math.max(1, t.pomos || 1);
    const ok = notify.remind(
      '该开始了：' + g.title,
      '今天「' + t.title + '」' + pomos + ' 段专注，约 ' + (pomos * pacing.focusLen()) + ' 分钟',
      i
    );
    if (!ok) return;
    g.lastRemindDate = today;
    pw.touch();
    n++;
  });
  return n;
}

/** 有多少个目标设了提醒（设置页 / 详情页用） */
export function countOn() {
  return pw.activeGoals().filter(g => valid(g.remindAt)).length;
}

/**
 * 时段到点提醒：任务被排进早 / 中 / 晚哪一段，那段开始就催一句。
 *
 * 与上面 check() 的区别：那边是"用户自己定的一个点，今天该做什么"，
 * 这里是"计划自己排出来的时段，这个时段该做什么" —— 一天最多三次（8:00 / 13:00 / 19:30）。
 *
 * ⚠️ 同样是**前台到点 + 进 App 补发**：没开 App 时系统不会替我们弹。
 * 补发只补"最近一个已经到点"的段（早上没催到、中午才打开，催中午那条才有用）。
 * 催过记在 goal.slotNotified = { date, keys }，一个时段一天只催一次。
 *
 * @param {{now?:Date}} opt
 * @returns {number} 这次提醒了几个目标
 */
export function checkSlot(opt) {
  const o = opt || {};
  if (!timeslot.notifyOn()) return 0;
  const now = o.now || new Date();
  const key = timeslot.keyNow(now);
  if (!key) return 0;
  const today = pw.today();
  const si = timeslot.indexOf(key);
  let n = 0;
  pw.activeGoals().forEach((g, i) => {
    const log = g.slotNotified || {};
    const done = log.date === today ? (log.keys || []) : [];
    if (done.indexOf(key) >= 0) return;             // 这个时段今天催过了
    const list = tasksInSlot(g, key);
    // 这个时段没安排事就不打扰 —— 提醒"你今早没事"没有意义
    if (!list.length) return;
    const t = list[0];
    const pomos = Math.max(1, t.pomos || 1);
    const tail = list.length > 1 ? ('等 ' + list.length + ' 件') : (pomos + ' 段专注');
    const ok = notify.slotNotify(
      timeslot.labelOf(key) + '该开始了：' + g.title,
      '「' + t.title + '」' + tail + '，约 ' + (pomos * pacing.focusLen()) + ' 分钟',
      i * 3 + si
    );
    if (!ok) return;
    g.slotNotified = { date: today, keys: done.concat([key]) };
    pw.touch();
    n++;
  });
  return n;
}

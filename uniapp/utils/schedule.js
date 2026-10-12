// utils/schedule.js - 日程表的**数据层**（日历页与首页「日程表」卡共用）
//
// 为什么抽出来：日程表原先只写在 calendar.vue 里（构造 byDate、算 overdue、
// 前移/后移），首页要加同一张表时最省事的做法是复制一份 —— 那样必然长出两套样式、
// 两套口径（比如"哪些算超期"两边不一致，用户就会看到首页说超期、日历页说不超期）。
// 抽成纯数据 + 一个组件之后，两边共用同一份口径，改一处两边都跟着变。
//
// 只算不算画：渲染交给 components/schedule-list。

import * as pw from './pwstore.js';
import * as holiday from './holiday.js';

/**
 * 反查「每个日期有哪些任务」。
 * task.day 是相对目标开始日的第几天（第 1 天 = createdAt 那天），
 * 所以要把它加回开始日，才得到真实日历日期。
 * @returns {Object} { 'YYYY-MM-DD': [row] }
 */
export function byDate() {
  const map = {};
  pw.activeGoals().forEach(g => {
    const start = g.createdAt ? pw.dateStr(new Date(g.createdAt)) : pw.today();
    (g.tasks || []).forEach(t => {
      if (t.status === 'dropped') return;   // 砍掉的任务不该占日历格子
      const date = holiday.addDays(start, (t.day || 1) - 1);
      const row = {
        key: g.id + '#' + t.id,
        goalId: g.id,
        id: t.id,
        title: t.title,
        goalTitle: g.title,
        pomos: t.pomos,
        donePomos: t.donePomos || 0,
        status: t.status || 'todo',
        startDay: t.day
      };
      if (!map[date]) map[date] = [];
      map[date].push(row);
    });
  });
  return map;
}

/**
 * 某一天的日程行（带 overdue 标记）。
 * @param {string} date 'YYYY-MM-DD'
 * @param {Object} map byDate() 的结果；不传就自己算（单天查询时省一次遍历）
 */
export function rowsOf(date, map) {
  const today = pw.today();
  const rows = ((map || byDate())[date] || []);
  return rows.map(t => {
    const g = pw.goalOf(t.goalId);
    const start = g && g.createdAt ? pw.dateStr(new Date(g.createdAt)) : today;
    const elapsed = pw.dayDiff(start, today) + 1;
    return Object.assign({}, t, {
      // 计划的那天已经过去、且还没做完 → 超期
      overdue: (t.startDay || 1) < elapsed && t.status === 'todo'
    });
  });
}

/** 某天有没有安排 */
export function countOf(date, map) {
  return ((map || byDate())[date] || []).length;
}

/**
 * 日期显示文案（含节假日 / 周末 / 调休）。
 * 首页卡与日历页都要显示"这是哪天"，口径一致才不会一边写"国庆"一边不写。
 */
export function dateLabel(date) {
  const d = String(date || '');
  if (!d) return '';
  let tag = '';
  try {
    const t = holiday.dayType(d);
    if (t === 'holiday') tag = '（' + holiday.holidayName(d) + '）';
    else if (t === 'weekend') tag = '（周末）';
    else if (t === 'makeup') tag = '（调休补班）';
  } catch (e) {}
  return d.slice(5).replace('-', ' 月 ') + ' 日' + tag;
}

/**
 * 勾选 / 取消完成（首页日程卡与日历页共用）。
 *
 * 记番茄数那一步在 pw.setTaskStatus 里：勾完成会**把差的那几个番茄补上**
 * （走 creditPomo，不是直接改字段）—— 否则状态是"已完成"而进度还是 0%，
 * 和番茄钟路径两套口径。取消完成不回滚已记的番茄（做过就是做过）。
 *
 * @returns {{ok:boolean, done:boolean, msg:string}}
 */
export function toggleDone(row) {
  if (!row) return { ok: false, done: false, msg: '没有可勾选的任务' };
  const was = row.status === 'done';
  const g = pw.goalOf(row.goalId);
  if (!g) return { ok: false, done: was, msg: '这个任务所属的目标已经不在了' };
  const t = (g.tasks || []).filter(x => x.id === row.id)[0];
  if (!t) return { ok: false, done: was, msg: '这个任务已经不在了' };
  pw.setTaskStatus(row.goalId, row.id, was ? 'todo' : 'done');
  return {
    ok: true,
    done: !was,
    msg: was ? '已取消完成' : '做完了 ✓（差的那几个番茄已补记）'
  };
}

/**
 * 前移 / 后移一天（直接改任务日期，不走 AI —— 小改动自己动手更快）。
 * @param {Object} row rowsOf() 里的某一行
 * @param {number} delta -1 / 1
 * @returns {{ok:boolean, date?:string, msg:string}}
 */
export function move(row, delta) {
  if (!row) return { ok: false, msg: '没有可移动的任务' };
  const g = pw.goalOf(row.goalId);
  if (!g) return { ok: false, msg: '这个任务所属的目标已经不在了' };
  const start = g.createdAt ? pw.dateStr(new Date(g.createdAt)) : pw.today();
  const oldDate = holiday.addDays(start, (row.startDay || 1) - 1);
  const newDate = holiday.addDays(oldDate, delta);
  const newDay = pw.dayDiff(start, newDate) + 1;
  if (newDay < 1) return { ok: false, msg: '不能再往前了' };
  pw.moveTaskDay(row.goalId, row.id, newDay);
  return { ok: true, date: newDate, msg: '已改到 ' + newDate.slice(5) };
}

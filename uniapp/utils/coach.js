// utils/coach.js - 首页「跟 AI 说说今天」的对话
//
// 为什么不把它做成"今日收工"里的一个输入框：填表适合逐项勾选，但人真正想说的
// 往往是"我今天一个单词没背，跑去刷了两套阅读"—— 一句话里既有事实又有原因，
// 还得用户自己先拆成"少做了几项 / 做了什么计划外的"才填得进去，太别扭。
// 所以让 AI 直接听这句原话：它自己提炼事实、自己判断算不算偏离计划，
// 判定为偏离的那部分再写回收工记录（dailylog.appendFacts）——
// 这样后面 replan?from=log 拿到的还是同一份真相，不存在两套口径。
//
// 对话按天存（pwstore 的 daily[date].coach），跟着备份一起走。

import * as pw from './pwstore.js';
import * as dailylog from './dailylog.js';

// 一天最多留这么多条：防止聊嗨了把 storage 撑大，且重排时也不会拿太长的历史去喂模型
const MAX_KEEP = 40;

// 快捷短语：填表是"先想清楚再勾"，这里是"先说一句再想" —— 给个起头最省事
export const CHIPS = [
  '今天只做了一半',
  '提前做了后面的',
  '临时改学别的了',
  '状态不好，没怎么学'
];

function dayRec(date) {
  const st = pw.get();
  const key = date || pw.today();
  if (!st.daily[key]) st.daily[key] = { focusMin: 0, pomo: 0, byApp: {}, byHour: {} };
  const d = st.daily[key];
  if (!d.byHour) d.byHour = {};      // 老数据补字段
  if (!d.coach) d.coach = { messages: [], drift: false };
  if (!d.coach.messages) d.coach.messages = [];
  return d;
}

/** 某天的对话（副本，改它不影响存储） */
export function messages(date) {
  const d = pw.get().daily[date || pw.today()];
  const c = d && d.coach;
  return c ? c.messages.slice() : [];
}

/** 那天 AI 判定"和计划有出入"（决定要不要显示重排入口） */
export function driftFlag(date) {
  const d = pw.get().daily[date || pw.today()];
  return !!(d && d.coach && d.coach.drift);
}

export function push(date, role, content) {
  const d = dayRec(date);
  const c = d.coach;
  c.messages.push({
    role: role === 'user' ? 'user' : 'assistant',
    content: String(content || ''),
    at: Date.now()
  });
  if (c.messages.length > MAX_KEEP) c.messages = c.messages.slice(-MAX_KEEP);
  pw.touch();
  return c.messages.slice();
}

export function setDrift(date, on) {
  const d = dayRec(date);
  d.coach.drift = !!on;
  pw.touch();
}

export function clear(date) {
  const d = dayRec(date);
  d.coach = { messages: [], drift: false };
  pw.touch();
}

/**
 * 给 AI 的"今日底稿"：今天该做什么、已经填报了什么、最近真实投入。
 * 没有这些，模型就只能接话茬，说不出"你这是提前做了后面第 8 天"这种判断。
 */
export function context(date) {
  const key = date || pw.today();
  const lines = [];
  // 可被"记功"的任务：今天的 + 后面几天可能被提前做的（与收工表同一份口径）
  const dd = dailylog.buildDraft();
  const tasks = (dd.items || []).concat(dd.ahead || []).map(i => ({
    id: i.taskId, title: i.title, day: i.day, pomos: i.planned, done: i.actual
  }));
  const q = pw.todayQueue(8);
  if (q.length) {
    lines.push('今天计划要做的：');
    q.forEach(x => {
      const t = x.task;
      lines.push('- 「' + t.title + '」（' + x.goal.title + '，第 ' + t.day + ' 天，已做 ' +
        (t.donePomos || 0) + '/' + (t.pomos || 1) + ' 番茄' + (x.overdue ? '，已超期' : '') + '）');
    });
  } else {
    lines.push('今天计划里没有任务。');
  }
  const gs = pw.activeGoals();
  if (gs.length) {
    lines.push('进行中的目标：' + gs.map(g => g.title + '（截止 ' + g.deadline + '）').join('；'));
  }
  const log = dailylog.logOf(key);
  if (log) lines.push(dailylog.summaryFor(log));
  lines.push('近 7 天每天专注分钟（旧→新）：' + pw.recentDays(7).map(d => d.focusMin).join(','));
  if (tasks.length) {
    lines.push('可记功的任务（说过"做完了"就按 id 记番茄）：' +
      tasks.map(t => t.id + '=「' + t.title + '」第' + t.day + '天 ' + (t.done || 0) + '/' + t.pomos).join('；'));
  }
  return { text: lines.join('\n'), goalIds: gs.map(g => g.id), taskIds: tasks.map(t => t.id) };
}

/** AI 提炼出的事实写回收工记录 —— 后面重排读的就是这一份 */
export function applyFacts(date, facts) {
  return dailylog.appendFacts(date, facts);
}

/** "我把 X 做完了" → 真把番茄记到任务上（只增不减） */
export function applyCredits(credits) {
  return dailylog.creditPomos(credits);
}

/**
 * 该拿哪个目标去重排：先看今天这条记录里涉及的目标，
 * 没有就用今日队列里的，再没有就用第一个进行中的。
 */
export function targetGoalId(date) {
  const log = dailylog.logOf(date || pw.today());
  const ids = [];
  ((log && log.items) || []).concat((log && log.ahead) || []).forEach(i => {
    if (i.goalId && ids.indexOf(i.goalId) < 0) ids.push(i.goalId);
  });
  const alive = ids.filter(id => !!pw.goalOf(id));
  if (alive.length) return alive[0];
  const q = pw.todayQueue(1);
  if (q.length) return q[0].goal.id;
  const gs = pw.activeGoals();
  return gs.length ? gs[0].id : '';
}

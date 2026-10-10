// utils/dailylog.js - 每日收工：今天实际做了什么，和计划差在哪
//
// 为什么要有这一步：AI 排出来的是"预测"，人每天真正做的是"事实"。
// 只把番茄总数喂回去，AI 分不清这两种情况 ——
//   A：今天安排 2 个番茄背单词，结果 1 个都没做 → 任务太重 / 状态不行 → 该减量
//   B：今天没背单词，但把后面第 8 天的阅读提前做了 → 节奏变了 → 该把后面的往前提
// 两者该给的建议完全相反，光看时长永远分不出来。所以让用户在收工时花十几秒勾一遍，
// AI 拿着「计划 vs 实际」的差集去重排后面 —— 这才是真的"动态安排"。
//
// 数据落在 pwstore 的 daily[YYYY-MM-DD].log，跟着备份一起走。

import * as pw from './pwstore.js';

// 今天状态：AI 拿它区分"任务太重"和"今天就是不行"，后者不该顺延期限
export const MOODS = [
  { key: 'great', label: '状态很好' },
  { key: 'ok', label: '正常' },
  { key: 'tired', label: '有点累' },
  { key: 'busy', label: '被别的事占了' },
  { key: 'stuck', label: '卡住了做不动' }
];

function dayRec(date) {
  const st = pw.get();
  const key = date || pw.today();
  if (!st.daily[key]) st.daily[key] = { focusMin: 0, pomo: 0, byApp: {}, byHour: {} };
  const d = st.daily[key];
  if (!d.byHour) d.byHour = {};   // 老数据补字段
  return d;
}

export function logOf(date) {
  const d = pw.get().daily[date || pw.today()];
  return (d && d.log) || null;
}

/** 今天收工了没 */
export function doneToday() {
  return !!logOf(pw.today());
}

/** 收工表里"后面几天、但还没到日子"的任务（用户很可能提前做了） */
const AHEAD_DAYS = 7;

/**
 * 生成收工草稿：今天该做的（items）+ 后面几天可能被提前做的（ahead）。
 * actual 默认取任务已记的番茄数，用户可以再改。
 */
export function buildDraft() {
  const today = pw.today();
  const seen = {};
  const items = pw.todayQueue(20).map(q => {
    seen[q.task.id] = 1;
    return {
      goalId: q.goal.id,
      taskId: q.task.id,
      title: q.task.title,
      goalTitle: q.goal.title,
      day: q.task.day,
      planned: q.task.pomos || 1,
      actual: Math.min(q.task.pomos || 1, q.task.donePomos || 0)
    };
  });

  const ahead = [];
  pw.activeGoals().forEach(g => {
    const elapsed = pw.dayDiff(pw.dateStr(new Date(g.createdAt)), today) + 1;
    g.tasks
      .filter(t => t.status === 'todo' && t.day > elapsed && t.day <= elapsed + AHEAD_DAYS && !seen[t.id])
      .sort((a, b) => a.day - b.day)
      .forEach(t => {
        if (ahead.length >= 8) return;
        seen[t.id] = 1;
        ahead.push({
          goalId: g.id,
          taskId: t.id,
          title: t.title,
          goalTitle: g.title,
          day: t.day,
          planned: t.pomos || 1,
          actual: 0
        });
      });
  });

  const old = logOf(today);
  return {
    date: today,
    items: items,
    ahead: ahead,
    extras: old ? (old.extras || '') : '',
    mood: old ? (old.mood || '') : '',
    note: old ? (old.note || '') : ''
  };
}

function clampActual(v, planned) {
  const n = Math.max(0, Math.floor(Number(v) || 0));
  return Math.min(n, Math.max(1, planned || 1));
}

/** 存下这次收工，返回落库后的 log（drift 已算好） */
export function save(draft) {
  const d = dayRec(draft.date || pw.today());
  const log = {
    at: Date.now(),
    items: (draft.items || []).map(i => ({
      goalId: i.goalId, taskId: i.taskId, title: i.title, goalTitle: i.goalTitle,
      day: i.day, planned: i.planned || 1, actual: clampActual(i.actual, i.planned)
    })),
    // 只留"确实做了"的那几条，没做的不用占地方
    ahead: (draft.ahead || [])
      .filter(i => clampActual(i.actual, i.planned) > 0)
      .map(i => ({
        goalId: i.goalId, taskId: i.taskId, title: i.title, goalTitle: i.goalTitle,
        day: i.day, planned: i.planned || 1, actual: clampActual(i.actual, i.planned)
      })),
    extras: String(draft.extras || '').trim(),
    mood: String(draft.mood || ''),
    note: String(draft.note || '').trim()
  };
  log.drift = driftOf(log);
  d.log = log;
  // 把"实际做了几个"真正记到任务上：否则任务还是 0 番茄，
  // AI 拿到的剩余任务里看不出他已经做过了，会让他重做一遍。
  credit(log);
  pw.touch();
  return log;
}

/**
 * 回填番茄数。只增不减 —— 用户少填了不会把已有的进度抹掉。
 * 做满即自动完成（与 addPomoToTask 同一口径）。
 */
function credit(log) {
  (log.items || []).concat(log.ahead || []).forEach(i => {
    if (!(i.actual > 0)) return;
    const g = pw.goalOf(i.goalId);
    if (!g) return;
    const t = g.tasks.filter(x => x.id === i.taskId)[0];
    if (!t) return;
    if ((t.donePomos || 0) >= i.actual) return;
    t.donePomos = i.actual;
    if (t.donePomos >= (t.pomos || 1) && t.status === 'todo') {
      t.status = 'done';
      t.doneAt = Date.now();
    }
  });
}

/**
 * 有没有"和规定不一样"。
 * 三种都算偏：少做了、提前做了后面的、做了计划外的。
 * 完全照计划走完才是 false —— 那时没必要惊动 AI。
 */
export function driftOf(log) {
  if (!log) return false;
  const short = (log.items || []).some(i => (i.actual || 0) < (i.planned || 0));
  if (short) return true;
  if ((log.ahead || []).length) return true;
  if (log.extras) return true;
  return false;
}

/**
 * 补记事实：把"AI 从对话里听出来的事实"写进今日收工记录（extras）。
 *
 * 为什么走 extras 而不是 note：extras 参与 driftOf，AI 说过"这算和计划不一样"
 * 的那部分就应该真的变成偏差，后面 replan?from=log 才拿得到；
 * 而 note 只是给人看的备注，不会影响重排判断。
 * 他说"今天按计划做完了"时 Coach 不会调这里 —— 那时没有事实可记。
 */
export function appendFacts(date, facts) {
  const list = (facts || []).map(x => String(x || '').trim()).filter(Boolean);
  if (!list.length) return null;
  const d = dayRec(date || pw.today());
  const line = list.join('；');
  if (!d.log) {
    // 还没填过收工表：建一条只带事实的壳子（items 为空 = 今天没有逐项填报）
    d.log = { at: Date.now(), items: [], ahead: [], extras: line, mood: '', note: '' };
  } else {
    d.log.extras = (d.log.extras ? d.log.extras + '；' : '') + line;
  }
  d.log.at = Date.now();
  d.log.drift = driftOf(d.log);
  pw.touch();
  return d.log;
}

/**
 * 对话里"我把 X 做完了" → 真的把番茄记到任务上。
 *
 * 为什么必须记：不记的话任务还是 0 番茄，AI 下次重排时看到的仍是"没做过"，
 * 会让他重做一遍 —— 这和收工填报的 credit() 是同一个坑，只是入口换成了自然语言。
 * 口径与 credit() 一致：只增不减，做满即自动完成。
 * list: [{ taskId, add }]，add = 这次新做的番茄数（不是累计）。
 */
export function creditPomos(list) {
  let n = 0;
  (list || []).forEach(i => {
    if (!i || !i.taskId) return;
    const add = Math.floor(Number(i.add) || 0);
    if (add <= 0) return;
    const gs = pw.get().goals;
    let hit = null;
    for (let k = 0; k < gs.length; k++) {
      const t = (gs[k].tasks || []).filter(x => x.id === i.taskId)[0];
      if (t) { hit = t; break; }
    }
    if (!hit) return;
    const cap = Math.max(1, hit.pomos || 1);
    const next = Math.min(cap, (hit.donePomos || 0) + add);
    if (next <= (hit.donePomos || 0)) return;   // 只增不减
    hit.donePomos = next;
    if (next >= cap && hit.status === 'todo') { hit.status = 'done'; hit.doneAt = Date.now(); }
    n++;
  });
  if (n) pw.touch();
  return n;
}

export function moodLabel(key) {
  const m = MOODS.filter(x => x.key === key)[0];
  return m ? m.label : '';
}

/** 偏差的一句话概括（首页提示条用） */
export function driftText(log) {
  if (!log) return '';
  const bits = [];
  const miss = (log.items || []).filter(i => (i.actual || 0) < (i.planned || 0)).length;
  if (miss) bits.push(miss + ' 项没做完');
  if ((log.ahead || []).length) bits.push('提前做了 ' + log.ahead.length + ' 项后面的');
  if (log.extras) bits.push('还做了计划外的事');
  return bits.join(' · ');
}

/**
 * 给 AI 看的那段「计划 vs 实际」。
 * 写成自然语言而不是 JSON：模型的指令遵循在"看得懂的事实"上更稳，
 * 而这一段的重点恰恰是让它自己判断该怎么调。
 */
export function summaryFor(log) {
  if (!log) return '';
  const lines = [];
  lines.push('【今日收工填报：计划 vs 实际】');
  (log.items || []).forEach(i => {
    const p = i.planned || 1;
    const a = i.actual || 0;
    const tag = a >= p ? '完成' : (a > 0 ? '做了一部分（' + a + '/' + p + '）' : '完全没做');
    lines.push('- 第' + i.day + '天「' + i.title + '」计划 ' + p + ' 番茄，实际 ' + a + ' → ' + tag);
  });
  (log.ahead || []).forEach(i => {
    lines.push('- 提前做了后面第' + i.day + '天的「' + i.title + '」' + (i.actual || 0) + ' 个番茄');
  });
  if (log.extras) lines.push('- 计划之外还做了：' + log.extras);
  if (log.mood) lines.push('- 今天状态：' + moodLabel(log.mood));
  if (log.note) lines.push('- 本人备注：' + log.note);
  return lines.join('\n');
}

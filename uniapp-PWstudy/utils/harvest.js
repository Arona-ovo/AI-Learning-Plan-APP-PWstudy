// utils/harvest.js - 「完成反馈 → 每日任务动态重排」的编排层
//
// 这一层管四件事（数据本身在 utils/pwstore.js，AI 在 services/plan-agent.js）：
//   ① 额外收获：完成任务后用户随口说的那几句 → AI 总结成带时间的记录 → 落台账
//   ② 全部完成：当天任务全做完 → 综合当天完成数据 + 历史反馈 → 自动重排（不用确认）
//   ③ 跨天兜底：过了 00:00 昨天还有没做完的 → 同样自动重排（不用确认）
//   ④ 信息不足：数据不够判断 → 先问本人一句最新意见，再拿这句话去重排
//
// 三条硬边界（改动前先读）：
//   · **自动只落地"可逆的日常调整"**（move 改期 / resize 改量 / note 建议）。
//     砍任务（drop）与顺延截止日（defer）是"事后想反悔都难的"动作，一律进
//     pending 等人点头 —— 用户要的是"别再来烦我确认"，不是"悄悄把我的任务删了"。
//   · **一天最多自动重排一次**（全部完成那条线记 lastAllDone，兜底那条线记
//     lastSweepDate）。否则勾一个任务跑一次模型，一晚上能烧掉几十次调用。
//   · **AI 不可用必须照样重排**（localRoll 本地铺开）。没配 AI / 关了开关 / 断网
//     都不是"今天就不重排了"的理由 —— 欠账不会因为连不上网而消失。
//
// 完整的数据结构与边界条件见 uniapp-PWstudy/docs/task-feedback-replan.md

import * as pw from './pwstore.js';
import * as schedule from './schedule.js';
import * as dailylog from './dailylog.js';
import { replanGoal, replanFromToday, summarizeHarvest } from '../services/plan-agent.js';
import { featureOn } from '../services/ai-gate.js';
import { isAIEnabled } from '../services/config.js';

/** 历史反馈回溯多少天（给 AI 的"过去他怎么说"） */
const HISTORY_DAYS = 14;
/** 待确认队列最多留几条（堆太多就变成没人看的垃圾堆） */
const MAX_PENDING = 8;
/** 自动重排时允许"顺延截止日"的门槛：连续这么多天没做完才开门（与 replan 页同口径） */
const DEFER_STREAK = 2;

/* ---------- ① 台账读写与摘要 ---------- */

/** 某天完成的项（副本） */
export function listOf(date) {
  return pw.ledgerList(date || pw.today());
}

/** 某天完成了几项 */
export function countOf(date) {
  return listOf(date).length;
}

/** 某天有没有填过额外收获 */
export function harvestCount(date) {
  return listOf(date).filter(x => x.harvest && x.harvest.summary).length;
}

/**
 * 存额外收获。
 * AI 可用 → 让它总结成一句带时间的记录；不可用 → 原话直存（不因为连不上网就丢掉用户说的话）。
 *
 * @returns {Promise<{ok:boolean, harvest:Object, src:'ai'|'local'}>}
 */
export async function saveHarvest(date, taskId, texts) {
  const key = date || pw.today();
  const it = listOf(key).filter(x => x.taskId === taskId)[0];
  if (!it) return { ok: false, harvest: null, src: 'none' };
  const lines = (Array.isArray(texts) ? texts : [texts])
    .map(s => String(s == null ? '' : s).trim()).filter(Boolean);
  if (!lines.length) return { ok: false, harvest: null, src: 'none' };
  const raw = lines.join('\n');
  const at = Date.now();
  const base = {
    at: at,
    atText: pw.clockText(at),
    date: key,
    raw: raw
  };
  let summary = '';
  let tags = [];
  let src = 'local';
  if (aiReady('harvest')) {
    try {
      const r = await summarizeHarvest({
        taskTitle: it.title,
        goalTitle: it.goalTitle,
        pomos: it.pomos,
        date: key,
        atText: base.atText,
        texts: lines
      });
      summary = String(r.summary || '').trim();
      tags = (r.tags || []).slice(0, 3);
      src = 'ai';
    } catch (e) {
      // 总结失败不丢东西：原话直存，照样能进重排上下文
      summary = '';
      src = 'local';
    }
  }
  // 本地兜底的那句话也要带时间 —— "哪天几点、说了什么"才回看得出东西
  if (!summary) summary = localSummary(key, base.atText, it.title, raw);
  const harvest = Object.assign({}, base, { summary: summary, tags: tags, src: src });
  pw.setHarvest(key, taskId, harvest);
  pw.flush();
  return { ok: true, harvest: harvest, src: src };
}

/** 本地兜底的那句总结：日期 + 时刻 + 任务 + 原话（截到 60 字） */
function localSummary(date, atText, title, raw) {
  const one = String(raw || '').replace(/\s+/g, ' ').trim();
  const short = one.length > 60 ? one.slice(0, 60) + '…' : one;
  return date + ' ' + atText + ' 完成「' + title + '」，本人补充：' + short;
}

/** AI 这项能不能用（总开关 + 分项开关，两层都要过） */
function aiReady(key) {
  try {
    if (!isAIEnabled()) return false;
    if (key && !featureOn(key)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 近 n 天里所有额外收获（旧 → 新），给 AI 当"过去他怎么说"。
 * 只取有总结的那些 —— 空壳不占地方也不提供信息。
 */
export function recentHarvest(days) {
  const n = Math.max(1, Math.floor(Number(days) || HISTORY_DAYS));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = pw.addDays(pw.today(), -i);
    listOf(key).forEach(it => {
      const h = it.harvest;
      if (!h || !h.summary) return;
      out.push({
        date: key, atText: h.atText || '', task: it.title, goal: it.goalTitle,
        summary: h.summary, tags: (h.tags || []).slice(), src: h.src || ''
      });
    });
  }
  return out;
}

/** 给 AI 看的「今天完成了什么 + 本人怎么说」（重排的输入之一） */
export function summaryFor(date) {
  const key = date || pw.today();
  const items = listOf(key);
  if (!items.length) return '';
  const lines = ['【今日完成台账：做完了什么、本人怎么说】'];
  items.forEach(it => {
    const h = it.harvest;
    lines.push('- ' + (it.atText || '') + ' 完成「' + it.title + '」（' + it.goalTitle +
      '，第' + it.day + '天，' + it.pomos + ' 番茄，来源 ' + srcText(it.src) + '）');
    if (h && h.summary) {
      lines.push('  本人补充（' + (h.atText || '') + '）：' + h.summary +
        ((h.tags && h.tags.length) ? '｜标签：' + h.tags.join('、') : ''));
    }
  });
  const log = dailylog.logOf(key);
  if (log) lines.push(dailylog.summaryFor(log));
  return lines.join('\n');
}

/** 给 AI 看的「历史上他怎么说」（只给有内容的，最多 12 条，防止 prompt 无限长） */
export function historyBlock(days) {
  const all = recentHarvest(days || HISTORY_DAYS);
  if (!all.length) return '';
  const pick = all.slice(-12);
  const lines = ['【本人过去 ' + (days || HISTORY_DAYS) + ' 天的反馈（后面排量时对齐这些）】'];
  pick.forEach(h => {
    lines.push('- ' + h.date + ' ' + h.atText + '「' + h.task + '」：' + h.summary +
      ((h.tags && h.tags.length) ? '｜' + h.tags.join('、') : ''));
  });
  return lines.join('\n');
}

/** 上次自动重排的结果（让下一次别来回横跳） */
export function lastBlock() {
  const r = pw.replanState();
  const l = r.last;
  if (!l || !l.at) return '';
  const d = new Date(l.at);
  const when = pw.dateStr(d) + ' ' + pw.clockText(l.at);
  const kind = l.kind === 'sweep' ? '跨天兜底重排' : '全部完成自动重排';
  return ['【上次自动重排（' + when + '，' + kind + '）】',
    '- 判断：' + String(l.summary || '（没给）'),
    '- 落地了 ' + (l.applied || 0) + ' 条：' + String(l.detail || '（无）'),
    '- 下面不要重复已经做过的调整，也不要在没新证据时把它改回去。'
  ].join('\n');
}

/** 完成来源（给人看） */
function srcText(src) {
  return { manual: '手工勾完成', pomo: '番茄跑满', log: '收工填报', chat: '对话记功' }[src] || src || '完成';
}

/* ---------- ② 判定：今天是不是"全做完了" ---------- */

/**
 * 当天任务**全部完成**（自动重排的触发条件）。
 *
 * 四个条件缺一不可：
 *   ① 今天确实有安排（rowsOf(今天) 非空）—— 今天本来就没任务，谈不上"全做完"；
 *   ② 今天的安排里没有待办（done / dropped 都算"了结"）；
 *   ③ 没有历史欠账（todayQueue 里 overdue 为 0）—— 有欠账走的是"跨天兜底"那条线，
 *      两条线不重合，否则会被重排两次；
 *   ④ 今天至少真的完成了一项（台账非空）—— 防止"今天所有任务都是以前勾完的"
 *      这种静止状态每天都被判成"全部完成"从而天天去重排。
 */
export function allDoneOn(date) {
  const key = date || pw.today();
  const rows = schedule.rowsOf(key);
  if (!rows.length) return false;
  if (rows.some(r => r.status === 'todo')) return false;
  const overdue = pw.todayQueue(30).filter(q => q.overdue);
  if (overdue.length) return false;
  return listOf(key).length > 0;
}

/**
 * 昨天（或最近一个有安排的日子）有没有没做完的 —— 跨天兜底的触发条件。
 * 最多回溯 3 天：用户一周没开 App，不该在打开那一刻连补 7 次重排。
 */
export function leftBehind() {
  const t0 = pw.today();
  for (let k = 1; k <= 3; k++) {
    const key = pw.addDays(t0, -k);
    const rows = schedule.rowsOf(key);
    if (!rows.length) continue;              // 那天本来就没安排
    const todo = rows.filter(r => r.status === 'todo');
    if (!todo.length) return { date: key, todo: [], found: false };
    return { date: key, todo: todo, found: true };
  }
  return { date: '', todo: [], found: false };
}

/* ---------- ③ 信息不足：要不要先问本人一句 ---------- */

/**
 * 判断"AI 掌握的数据够不够排出最优方案"。不够就先问，别拿半截数据硬排。
 *
 * 三条判据（都是本地能算的，不用去问模型）：
 *   ① 从没跑出速度基线：完成的番茄 < 3 —— 只有"排了什么"没有"做得动多少"，
 *      模型减量减到多少全是猜；
 *   ② 近 7 天一分没学：连真实投入都没有，任何"按你的速度"都无从谈起；
 *   ③ 有欠账但没人说过原因：连续没做完，却既没有收工填报也没有额外收获 ——
 *      这时候最缺的不是重排算法，是"到底为什么没做"。
 *
 * @returns {{need:boolean, why:string, ask:string}} ask 是弹给用户看的那句话
 */
export function needsAsk(goal) {
  const st = pw.get();
  const donePomo = (st.sessions || []).filter(s => s && s.done).length;
  if (donePomo < 3) {
    return {
      need: true,
      why: 'completed-pomo-lt-3',
      ask: '你才刚开始，我还没看出你一天做得动多少。这次想怎么安排？（比如"每天最多 2 个番茄""先啃阅读"）'
    };
  }
  const week = pw.recentDays(7).reduce((n, d) => n + (d.focusMin || 0), 0);
  if (week <= 0) {
    return {
      need: true,
      why: 'no-focus-in-7d',
      ask: '近 7 天没有专注记录，我判断不了你的真实速度。最近的学习时间大概是什么样？（比如"只有晚上 1 小时""周末才能学"）'
    };
  }
  const gid = goal && goal.id;
  const hasLog = !!dailylog.logOf(pw.today());
  const hasHarvest = harvestCount(pw.today()) > 0;
  if (gid && dailylog.shortStreak(gid) >= 1 && !hasLog && !hasHarvest) {
    return {
      need: true,
      why: 'short-without-reason',
      ask: '有任务没做完，但我还不知道卡在哪。方便说一句吗？（比如"晚上被占掉了""这部分太难想放慢"）'
    };
  }
  return { need: false, why: '', ask: '' };
}

/** 记下本人最新意见（重排时会作为最高优先级的上下文喂给模型） */
export function saveNote(text) {
  const v = String(text || '').trim();
  if (!v) return '';
  pw.setReplan({ lastNote: v.slice(0, 200) });
  return v.slice(0, 200);
}

/** 本人最新意见（读一次就还在，直到被新的覆盖） */
export function lastNote() {
  return String(pw.replanState().lastNote || '');
}

/** 拼给模型的"额外上下文"：历史反馈 + 上次重排 + 本人最新意见 */
function extraBlock() {
  const parts = [];
  const note = lastNote();
  if (note) parts.push('【本人最新意见（最高优先级）】' + note);
  const hb = historyBlock();
  if (hb) parts.push(hb);
  const lb = lastBlock();
  if (lb) parts.push(lb);
  const today = summaryFor(pw.today());
  if (today) parts.push(today);
  return parts.join('\n');
}

/* ---------- ④ 应用重排建议 ---------- */

/** 哪些 op 允许自动落地（其余进 pending） */
const AUTO_OPS = { move: 1, resize: 1, note: 1 };

/**
 * 应用一批 op。
 * @param {boolean} auto true = 只落地 AUTO_OPS，其余进 pending；false = 全落地（用户已确认）
 * @returns {{applied:number, pending:Array, detail:string}}
 */
export function applyOps(goal, ops, auto) {
  const g = goal;
  const out = { applied: 0, pending: [], detail: '' };
  if (!g || !Array.isArray(ops) || !ops.length) return out;
  const bits = [];
  const maxDay = maxDayOf(g);
  (ops || []).forEach(op => {
    if (!op || !op.op) return;
    if (op.op === 'note') return;                 // 建议文字不落库（只展示）
    if (auto && !AUTO_OPS[op.op]) {
      // 砍任务 / 顺延期限：不自动落地，记下来等人点头
      if (out.pending.length < MAX_PENDING) {
        out.pending.push({
          op: op.op,
          goalId: g.id,
          goalTitle: g.title,
          taskId: op.taskId || '',
          title: op.op === 'defer' ? g.title : taskTitle(g, op.taskId),
          days: op.days || 0,
          pomos: op.pomos || 0,
          reason: String(op.reason || op.text || '').slice(0, 120),
          at: Date.now()
        });
      }
      return;
    }
    if (op.op === 'defer') { out.applied += applyDefer(g, op); bits.push('顺延截止日'); return; }
    const t = (g.tasks || []).filter(x => x.id === op.taskId)[0];
    if (!t) return;
    if (op.op === 'move') {
      const d = Math.min(Math.max(1, Math.floor(Number(op.day) || t.day)), maxDay);
      if (d !== t.day) { t.day = d; t.movedAt = Date.now(); out.applied++; }
      bits.push('「' + t.title + '」改到第 ' + d + ' 天');
    } else if (op.op === 'resize') {
      const p = Math.min(Math.max(1, Math.floor(Number(op.pomos) || t.pomos)), 20);
      if (p !== t.pomos) { t.pomos = p; out.applied++; }
      bits.push('「' + t.title + '」改成 ' + p + ' 个番茄');
    } else if (op.op === 'drop') {
      t.status = 'dropped';
      t.droppedAt = Date.now();
      out.applied++;
      bits.push('砍掉「' + t.title + '」');
    }
  });
  // ⚠️ 自动模式下进 pending 的必须**当时就落进队列**，不能只回给调用方：
  //   调用方（首页）拿 out.pending 弹窗，队列（pendingList）负责去重与出队 ——
  //   两处不同源就会出现"弹了窗、队列里却没有"，于是每次进首页都重复问同一条。
  if (auto && out.pending.length) {
    const cur = (pw.replanState().pending || []).concat(out.pending);
    pw.setReplan({ pending: cur.slice(-MAX_PENDING) });
  }
  pw.touch();
  pw.flush();
  out.detail = bits.slice(0, 6).join('；');
  return out;
}

function taskTitle(g, id) {
  const t = (g.tasks || []).filter(x => x.id === id)[0];
  return t ? t.title : '';
}

function maxDayOf(g) {
  // 夹到目标期限内：排到截止日之后的任务永远不会出现在"今天该做"里
  const start = g.createdAt ? new Date(g.createdAt).getTime() : Date.now();
  const end = g.deadline ? new Date(g.deadline).getTime() : start;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function applyDefer(g, op) {
  const days = Math.max(1, Math.min(90, Math.floor(Number(op.days) || 0)));
  if (!days) return 0;
  const total = (g.deferred || 0) + days;
  if (total > 90) return 0;                     // 再多就不是"调整计划"而是"换个目标"
  if (!g.origDeadline) g.origDeadline = g.deadline;
  g.deadline = pw.addDays(g.deadline, days);
  g.deferred = total;
  g.deferredAt = Date.now();
  return 1;
}

/* ---------- ⑤ 本地兜底重排（AI 不可用也要排） ---------- */

/**
 * 把"今天及以后还没做的事"按剩余天数重新铺开。
 *
 * 为什么必须有这一条：跨天兜底是"每天都要发生"的事，而 AI 可能没配、被关、
 * 断网、或者模型抽风。不能因为连不上网就让欠账一直堆着 —— 那正是这个功能
 * 要解决的问题本身。
 *
 * 做法（不猜能力、不算速度，只做几何上的重新分配）：
 *   剩余任务按原顺序排好 → 从今天起到截止日，按"每天 cap 个番茄"一段段铺进去，
 *   cap = ceil(剩余总番茄 / 剩余天数)。原顺序与相对先后一律保留 ——
 *   本地规则不负责判断"哪件事更重要"，那是模型的事。
 *
 * @returns {number} 实际改了几项
 */
export function localRoll(goal) {
  const g = goal;
  if (!g) return 0;
  const t0 = pw.today();
  const start = g.createdAt ? pw.dateStr(new Date(g.createdAt)) : t0;
  const elapsed = Math.max(1, pw.dayDiff(start, t0) + 1);
  const maxDay = maxDayOf(g);
  const todos = (g.tasks || [])
    .filter(t => t.status === 'todo')
    .sort((a, b) => (a.day - b.day) || ((a.createdAt || 0) - (b.createdAt || 0)));
  if (!todos.length) return 0;
  let total = 0;
  todos.forEach(t => { total += Math.max(1, t.pomos || 1); });
  const span = Math.max(1, maxDay - elapsed + 1);
  const cap = Math.max(1, Math.ceil(total / span));
  let day = elapsed;
  let used = 0;
  let n = 0;
  todos.forEach(t => {
    const p = Math.max(1, t.pomos || 1);
    // 单任务本身就超过一天的量时不再切分（一个任务 = 一天的最小单位）
    if (used > 0 && used + p > cap) { day++; used = 0; }
    const d = Math.min(day, maxDay);
    if (d !== t.day) { t.day = d; t.movedAt = Date.now(); n++; }
    used += p;
  });
  if (n) { pw.touch(); pw.flush(); }
  return n;
}

/* ---------- ⑥ 两条自动重排主线 ---------- */

/** 该重排哪个目标：今天台账里的 > 今日队列里的 > 第一个进行中的 */
export function targetGoalId() {
  const items = listOf(pw.today());
  const ids = [];
  items.forEach(i => { if (i.goalId && ids.indexOf(i.goalId) < 0) ids.push(i.goalId); });
  const alive = ids.filter(id => !!pw.goalOf(id));
  if (alive.length) return alive[0];
  const q = pw.todayQueue(1);
  if (q.length) return q[0].goal.id;
  const gs = pw.activeGoals();
  return gs.length ? gs[0].id : '';
}

/** 构造 reality（与 replan.vue 同一口径：模型数不出来的东西都在这算好） */
function realityOf(goal) {
  const week = pw.recentDays(7).map(d => d.focusMin).join(', ');
  const elapsed = pw.dayDiff(pw.dateStr(new Date(goal.createdAt)), pw.today()) + 1;
  const overdue = (goal.tasks || []).filter(t => t.status === 'todo' && t.day < elapsed);
  const streak = dailylog.shortStreak(goal.id);
  const remainDays = pw.dayDiff(pw.today(), goal.deadline);
  const maxDeferDays = streak >= DEFER_STREAK
    ? Math.max(3, Math.min(30, Math.round(remainDays * 0.5)))
    : 0;
  return {
    reality: {
      days: week,
      overdue: overdue.length,
      overdueIds: overdue.map(t => t.id),
      streak: streak
    },
    opt: { maxDeferDays: maxDeferDays }
  };
}

/**
 * 主线 A：当天任务**全部完成** → 自动重排（一天一次，不用用户确认）。
 *
 * @param {{force?:boolean}} o force = 忽略"今天跑过没有"的限制（设置页手动触发用）
 * @returns {Promise<{ok:boolean, skipped?:string, applied?:number, pending?:Array, summary?:string, ask?:Object}>}
 */
export async function autoReplan(o) {
  const opt = o || {};
  const t0 = pw.today();
  const st = pw.replanState();
  if (!opt.force && st.lastAllDone && st.lastAllDone.date === t0) {
    return { ok: true, skipped: 'already-today' };
  }
  if (!allDoneOn(t0)) return { ok: true, skipped: 'not-all-done' };
  const gid = targetGoalId();
  const g = pw.goalOf(gid);
  if (!g) return { ok: true, skipped: 'no-goal' };
  if (!(g.tasks || []).filter(t => t.status === 'todo').length) {
    // 全部做完了，没有"后面"可排 —— 记一笔免得明天开局再判一次
    pw.setReplan({ lastAllDone: { date: t0, at: Date.now() } });
    return { ok: true, skipped: 'nothing-left' };
  }
  // 先记"今天跑过了"再跑：模型跑到一半用户切走，不该在回来时又跑一遍
  pw.setReplan({ lastAllDone: { date: t0, at: Date.now() } });
  return runReplanOnce(g, 'alldone');
}

/**
 * 主线 B：跨天兜底 —— 过了 00:00，昨天（或更早）还有没做完的。
 *
 * 一天最多一次；第一次启动（没有 lastSweepDate）不跑 —— 刚装 App 的人
 * 没有"昨天"，凭空重排一份还没开始执行的计划没有意义。
 */
export async function sweep(o) {
  const opt = o || {};
  const t0 = pw.today();
  const st = pw.replanState();
  if (!opt.force && st.lastSweepDate === t0) return { ok: true, skipped: 'already-today' };
  const first = !st.lastSweepDate;
  pw.setReplan({ lastSweepDate: t0 });
  if (first && !opt.force) return { ok: true, skipped: 'first-run' };
  const lb = leftBehind();
  if (!lb.found) return { ok: true, skipped: 'nothing-left' };
  const gid = targetGoalId();
  const g = pw.goalOf(gid);
  if (!g) return { ok: true, skipped: 'no-goal' };
  return runReplanOnce(g, 'sweep');
}

/** 真正跑一次重排（两条主线共用） */
async function runReplanOnce(goal, kind) {
  const out = { ok: true, kind: kind, applied: 0, pending: [], summary: '', ask: null, src: 'ai' };
  // ④ 信息不足 → 不硬排，先把问题抛给调用方去问（问完再带 note 回来重跑）
  const need = needsAsk(goal);
  if (need.need && !lastNote()) {
    out.ok = false;
    out.ask = need;
    return out;
  }
  const r = realityOf(goal);
  const extra = extraBlock();
  const log = dailylog.logOf(pw.today());
  const useAI = aiReady('replan');
  let ops = [];
  let summary = '';
  let aiFailed = false;
  if (useAI) {
    try {
      const res = log
        ? await replanFromToday(goal, log, r.reality, r.opt, extra)
        : await replanGoal(goal, r.reality, r.opt, extra);
      ops = (res && res.ops) || [];
      summary = String((res && res.summary) || '');
    } catch (e) {
      // AI 这条路走不通 → 本地兜底，不把"重排"这件事一起丢掉。
      // ⚠️ 要和"AI 跑通了但一条建议都没给"区分开：前者是连不上，后者是它觉得不用动，
      //    给用户的话不能一样（说"没给出调整"等于把故障瞒报成"一切正常"）。
      ops = [];
      summary = '';
      aiFailed = true;
    }
  }
  if (useAI && ops.length) {
    const a = applyOps(goal, ops, true);
    out.applied = a.applied;
    out.pending = a.pending;
    out.detail = a.detail;
    out.summary = summary;
  } else {
    // 没 AI / AI 没给建议 / AI 报错 → 本地按剩余天数重新铺开
    const n = localRoll(goal);
    out.applied = n;
    out.src = !useAI ? 'local' : (aiFailed ? 'ai-error' : 'ai-empty');
    out.summary = !useAI
      ? '没用 AI，按剩余天数把剩下的任务重新铺了一遍。'
      : (aiFailed
        ? '这次没连上 AI，先按剩余天数把剩下的任务重新铺了一遍。'
        : 'AI 这次没给出调整，已按剩余天数把任务重新铺了一遍。');
    out.detail = '重新铺开 ' + n + ' 项';
  }
  // 闭环：把这次的结果记下来，下次重排会读到（lastBlock）。
  // ⚠️ pending 已经由 applyOps 落进队列，这里别再拼一次（一条会问两遍）。
  pw.setReplan({
    last: {
      at: Date.now(), kind: kind, goalId: goal.id, applied: out.applied,
      summary: out.summary, detail: out.detail || '', src: out.src
    },
    pending: (pw.replanState().pending || []).slice(-MAX_PENDING)
  });
  return out;
}

/* ---------- ⑦ 待确认队列（砍任务 / 顺延期限） ---------- */

export function pendingList() {
  return (pw.replanState().pending || []).slice();
}

/** 处理一条待确认：yes = 落地，no = 丢弃 */
export function resolvePending(index, yes) {
  const list = pendingList();
  const it = list[index];
  if (!it) return { ok: false, msg: '这条已经处理过了' };
  const rest = list.filter((x, i) => i !== index);
  let msg = '好，先不动';
  if (yes) {
    const g = pw.goalOf(it.goalId);
    if (!g) msg = '这个目标已经不在了';
    else if (it.op === 'drop') {
      const t = (g.tasks || []).filter(x => x.id === it.taskId)[0];
      if (t) { t.status = 'dropped'; t.droppedAt = Date.now(); pw.touch(); pw.flush(); msg = '已砍掉「' + t.title + '」' }
      else msg = '这个任务已经不在了';
    } else if (it.op === 'defer') {
      const n = applyDefer(g, { days: it.days });
      pw.touch(); pw.flush();
      msg = n ? ('截止日已顺延 ' + it.days + ' 天') : '顺延天数不合法';
    }
  }
  pw.setReplan({ pending: rest });
  return { ok: true, msg: msg };
}

/** 待确认项的一句话（弹窗标题用） */
export function pendingText(it) {
  if (!it) return '';
  if (it.op === 'drop') return '砍掉「' + it.title + '」？' + (it.reason ? '（' + it.reason + '）' : '');
  if (it.op === 'defer') return '把「' + it.title + '」的截止日往后 ' + it.days + ' 天？' + (it.reason ? '（' + it.reason + '）' : '');
  return it.title || '';
}

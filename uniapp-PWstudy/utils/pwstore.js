// utils/pwstore.js - PWstudy 核心数据：目标 / 任务 / 专注记录 / 学习 App 时长
// 全部本地存储（storage key: fj_pw_data_v1），无后端。
// 落盘策略与老 store.js 相同：改内存立即生效，节流 800ms 合并写盘；
// 切后台（App.vue onHide）时 flush，最坏只丢最后一秒。

const KEY = 'fj_pw_data_v1';
const SAVE_GAP = 800;

let cache = null;
let dirty = false;
let timer = 0;
let lastWriteAt = Date.now();

// ---------- 日期工具 ----------
export function pad2(n) { return n < 10 ? '0' + n : '' + n; }

export function dateStr(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function today() { return dateStr(new Date()); }

export function addDays(str, n) {
  const p = String(str || today()).split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

/** 两个 YYYY-MM-DD 之间的天数差（b - a） */
export function dayDiff(a, b) {
  const pa = String(a).split('-');
  const pb = String(b).split('-');
  const da = new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
  const db = new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
  return Math.round((db - da) / 86400000);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- 状态 ----------
function blank() {
  return {
    goals: [],        // Goal
    sessions: [],     // 已完成/中断的专注 {id,goalId,taskId,startAt,endAt,min,done}
    daily: {},        // 'YYYY-MM-DD' -> {focusMin, pomo, byApp:{pkg:min}, done:{…完成台账…}}
    dock: [],         // 学习 App {pkg, name, purpose:'study'|'rest', task, sort}
    pomoCfg: { focus: 25, rest: 5, long: 15, every: 4 },
    runtime: null,    // 专注进行中的现场（focus.js 读写）
    // 动态重排的"状态机记忆"（见 utils/harvest.js）：
    //   lastSweepDate 上次跑过「跨天兜底重排」的日期 —— 一天只跑一次
    //   lastAllDone   上次跑过「全部完成自动重排」的 {date, at}
    //   last          最近一次重排的结果摘要（下次重排要读它，闭环用）
    //   pending       不敢自动落地的"大动作"（砍任务 / 顺延期限），等人确认
    //   lastNote      信息不足时问来的用户最新意见（下次重排接着用）
    replan: {
      lastSweepDate: '',
      lastAllDone: { date: '', at: 0 },
      last: null,
      pending: [],
      lastNote: ''
    }
  };
}

function load() {
  try {
    const v = uni.getStorageSync(KEY);
    if (v && typeof v === 'object' && v.goals) return Object.assign(blank(), v);
  } catch (e) {
    console.error('读取 PWstudy 数据失败', e);
  }
  return blank();
}

export function init() { if (!cache) cache = load(); return cache; }

export function get() {
  if (!cache) cache = load();
  return cache;
}

function writeNow() {
  if (!dirty || !cache) return;
  dirty = false;
  lastWriteAt = Date.now();
  try { uni.setStorageSync(KEY, cache); } catch (e) { console.error('保存 PWstudy 数据失败', e); }
}

function schedule() {
  if (timer) return;
  const wait = Math.max(0, SAVE_GAP - (Date.now() - lastWriteAt));
  timer = setTimeout(() => { timer = 0; writeNow(); }, wait);
}

/** 直接改内存（调用方持有引用改完再调 touch() 也行）；touch 负责排队落盘 */
export function touch() {
  dirty = true;
  schedule();
}

export function flush() {
  if (timer) { clearTimeout(timer); timer = 0; }
  writeNow();
}

/**
 * 清空全部学习数据（设置页「清除学习数据」）。
 * 只清数据，不动 pomoCfg —— 专注时长是偏好（和主题色、昵称一样），
 * 没人想因为清了一次数据就被打回 25/5。
 * 调用方负责先让 focus 停下（见 utils/pwreset.js）：否则在跑的专注
 * 下一秒 persist() 又把现场写回来，清了等于没清。
 */
export function reset() {
  if (timer) { clearTimeout(timer); timer = 0; }
  const cfg = (cache && cache.pomoCfg) ? cache.pomoCfg : null;
  cache = blank();
  if (cfg) cache.pomoCfg = cfg;
  dirty = false;
  lastWriteAt = Date.now();
  try { uni.setStorageSync(KEY, cache); } catch (e) { console.error('清除 PWstudy 数据失败', e); }
  return cache;
}

// ---------- 目标 ----------
export function activeGoals() {
  return get().goals.filter(g => g.status === 'active');
}

export function goalOf(id) {
  return get().goals.filter(g => g.id === id)[0] || null;
}

/**
 * 落地一份 AI 规划。
 * input: { title, deadline, dailyMin, level }
 * plan:  plan-agent 产物（已校验）{ strategy, risks, milestones:[{title,days}], tasks:[{title,ms,day,pomos,tags}] }
 */
export function addGoal(input, plan) {
  const st = get();
  const gid = uid();
  const milestones = (plan.milestones || []).map(m => ({ id: uid(), title: m.title, days: m.days || 0 }));
  const msIds = milestones.map(m => m.id);
  const tasks = (plan.tasks || []).map(t => ({
    id: uid(),
    msId: msIds[Math.max(0, Math.min(msIds.length - 1, (t.ms || 1) - 1))] || '',
    title: t.title,
    day: t.day || 1,
    pomos: t.pomos || 1,
    donePomos: 0,
    tags: t.tags || [],
    res: (t.res && t.res.length) ? t.res : [],   // AI 附的学习资料建议（可选增强，可为空）
    slot: t.slot || '',                          // 执行时段 am|noon|pm（关掉时段安排时为空串）
    status: 'todo',
    createdAt: Date.now()
  }));
  const goal = {
    id: gid,
    title: input.title,
    raw: input.raw || input.title,
    deadline: input.deadline,
    dailyMin: input.dailyMin || 60,
    level: input.level || '',
    strategy: plan.strategy || '',
    risks: plan.risks || [],
    milestones, tasks,
    status: 'active',
    createdAt: Date.now()
  };
  st.goals.unshift(goal);
  touch();
  return goal;
}

export function archiveGoal(id) {
  const g = goalOf(id);
  if (g) { g.status = 'archived'; g.archivedAt = Date.now(); touch(); }
  return g;
}

export function removeGoal(id) {
  const st = get();
  st.goals = st.goals.filter(g => g.id !== id);
  touch();
}

/* ---------- 当日完成台账（daily[date].done） ----------
 *
 * 为什么单独一本账：任务身上只有"最后状态"（done + doneAt），看不出
 *   · 这项是**哪天**完成的（跨天补记会把账记错天）
 *   · 那天一共完成了几项、分别几点完成的
 *   · 完成那一刻用户自己说了什么（额外收获）
 * 这三件事是"当天完成情况 + 反馈 → 后续重排"这条闭环的唯一输入，
 * 所以必须在完成发生的那一刻就地记一笔，不能靠事后反推任务状态。
 *
 * ⚠️ 台账只在这里（数据层）写：三条完成路径（手工勾 / 专注做满 / 补记）
 *    全部收敛到 markTaskDone，漏一条就会出现"任务已完成但台账没有"，
 *    于是"今天全部完成"永远判不出来、自动重排永远不触发。
 */
function ledgerRec(date) {
  const key = date || today();
  const d = dayOf(get(), key);
  if (!d.done || typeof d.done !== 'object') d.done = { items: [], updatedAt: 0 };
  if (!Array.isArray(d.done.items)) d.done.items = [];
  return d.done;
}

/** 'HH:MM'（台账里的"几点完成的"，给人看） */
export function clockText(ts) {
  const d = new Date(ts || Date.now());
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 某天的完成台账（原对象；没有返回 null） */
export function ledgerOf(date) {
  const d = get().daily[date || today()];
  return (d && d.done && Array.isArray(d.done.items)) ? d.done : null;
}

/** 某天完成的项（副本，改它不影响存储） */
export function ledgerList(date) {
  const l = ledgerOf(date);
  return l ? l.items.slice() : [];
}

/**
 * 记一笔完成。
 * ⚠️ 同一天同一任务只留一条，且**保留首次完成时间**：勾了又取消又勾上，
 *    台账里不该堆两份，"几点做完的"也不该被最后一次覆盖。
 */
function ledgerAdd(goalId, taskId, src, date) {
  const g = goalOf(goalId);
  if (!g) return null;
  const t = (g.tasks || []).filter(x => x.id === taskId)[0];
  if (!t) return null;
  const key = date || today();
  const l = ledgerRec(key);
  const old = l.items.filter(x => x.taskId === taskId)[0];
  const now = Date.now();
  if (old) {
    // 补记路径（src=log/chat）进来时只更新来源，不动首次完成时间
    if (src && old.src === 'manual') old.src = src;
    return old;
  }
  const rec = {
    goalId: goalId,
    taskId: taskId,
    title: t.title,
    goalTitle: g.title,
    day: t.day || 1,
    pomos: t.pomos || 1,
    at: now,               // 完成时刻（毫秒）
    atText: clockText(now),// 完成时刻（人看的 HH:MM）
    src: src || 'manual',  // manual 手工勾 / pomo 专注做满 / log 收工填报 / chat 对话记功
    harvest: null          // 额外收获（见 utils/harvest.js）
  };
  l.items.push(rec);
  l.updatedAt = now;
  touch();
  return rec;
}

/* ---------- 动态重排的状态机记忆（st.replan） ----------
 * 只存"跑到哪一步了"和"上次的结果"，判断逻辑全在 utils/harvest.js。
 * 放数据层是因为它跟学习进度同生共死（清数据要一起清、备份要一起走），
 * 而 settings 那条线是"偏好"，不该掺进进度状态。
 */
export function replanState() {
  const st = get();
  if (!st.replan || typeof st.replan !== 'object') st.replan = blank().replan;
  const r = st.replan;
  if (!r.lastAllDone || typeof r.lastAllDone !== 'object') r.lastAllDone = { date: '', at: 0 };
  if (!Array.isArray(r.pending)) r.pending = [];
  return r;
}

/** 局部更新重排状态并落盘 */
export function setReplan(patch) {
  const r = replanState();
  Object.keys(patch || {}).forEach(k => { r[k] = patch[k]; });
  touch();
  return r;
}

/** 给某一项挂上额外收获（AI 总结 + 原话）。台账里没有这项就返回 null */
export function setHarvest(date, taskId, h) {
  const l = ledgerOf(date);
  if (!l) return null;
  const it = l.items.filter(x => x.taskId === taskId)[0];
  if (!it) return null;
  it.harvest = Object.assign({ at: Date.now() }, it.harvest || {}, h || {});
  it.harvest.atText = clockText(it.harvest.at);
  l.updatedAt = Date.now();
  touch();
  return it.harvest;
}

/**
 * 把任务置为完成 —— **所有完成路径的唯一出口**。
 * 先改状态再记台账，保证"任务显示已完成"和"台账里有一条"永远同时成立。
 */
function markTaskDone(g, t, src, date) {
  if (!g || !t) return;
  const first = t.status !== 'done';
  t.status = 'done';
  t.doneAt = Date.now();
  // 只有第一次置完成才记台账（creditPomo 已记过的，setTaskStatus 再来一次不会重复）
  if (first) ledgerAdd(g.id, t.id, src || 'manual', date);
}

/**
 * 取消完成时，回滚**手工勾**补记的那笔专注（2026-10-25 真机反馈）：
 * 手滑点到打勾又取消，紧迫度却回不来 —— 因为勾的时候 creditPomo 把差的专注
 * 全补齐了（donePomos、当日 focusMin/pomo、台账、合成 session 四处都记了账），
 * 取消时只把 status 拨回去，账还挂着 → 首页"还剩 0 段专注 · 还要 0 分钟"。
 *
 * 回滚口径（只退"勾出来的"，真坐过的不动）：
 *   · 只认 src='manual' 的合成 session（creditPomo 落的）—— 真实专注（pomo 路径）
 *     和收工补记（log/chat）一律不退，做过就是做过；
 *   · session 删掉，当日 focusMin / pomo 按这笔减回去；
 *   · 台账 done.items 撤掉该任务那一条（重新勾上会再记，符合"同天同任务只留一条"）；
 *   · donePomos 减回去 —— 紧迫度 / 今日队列立刻恢复"还有活"。
 * 返回回滚的专注数（0 = 没有"勾出来的"账可退）。
 */
function revertManualCredit(g, t) {
  const st = get();
  let idx = -1;
  for (let i = st.sessions.length - 1; i >= 0; i--) {
    const s = st.sessions[i];
    if (s && s.src === 'manual' && s.done && s.goalId === g.id && s.taskId === t.id) { idx = i; break; }
  }
  if (idx < 0) return 0;   // 没有"勾出来的"专注 —— 真做过的不动
  const s = st.sessions[idx];
  st.sessions.splice(idx, 1);
  // 勾的时候 min = 补记段数 × 单段时长；按当时落账那天减
  const add = Math.max(1, Math.round((s.min || 0) / Math.max(1, focusLen())));
  const key = s.startAt ? dateStr(new Date(s.startAt)) : today();
  const d = st.daily[key];
  if (d) {
    d.focusMin = Math.max(0, (d.focusMin || 0) - (s.min || 0));
    d.pomo = Math.max(0, (d.pomo || 0) - add);
  }
  const l = ledgerOf(key);
  if (l && Array.isArray(l.items)) {
    const before = l.items.length;
    l.items = l.items.filter(x => x.taskId !== t.id);
    if (l.items.length !== before) l.updatedAt = Date.now();
  }
  t.donePomos = Math.max(0, (t.donePomos || 0) - add);
  return add;
}

/** 任务状态流转 */
export function setTaskStatus(goalId, taskId, status) {
  const g = goalOf(goalId);
  if (!g) return;
  const t = g.tasks.filter(x => x.id === taskId)[0];
  if (!t) return;
  if (status === 'done') {
    // 手工勾完成要把专注数补齐：进度条 / 统计只认 donePomos（见 goalProgress），
    // 不补的话勾完状态是"已完成"但进度仍是 0%，和专注计时路径两套口径。
    // 差额走 creditPomo（而不是直接改字段）—— 补的这些也要进 sessions / daily，
    // 否则"勾一下完成"在热力图和 forecast 里等于没学过。
    // ⚠️ creditPomo 做满时自己会走 markTaskDone 记台账，下面那句是兜底
    //   （专注本来就够、补 0 个的情况不会触发 creditPomo 里的完成分支）。
    creditPomo(goalId, taskId, Math.max(1, t.pomos || 1) - (t.donePomos || 0), { src: 'manual' });
    t.donePomos = Math.max(t.donePomos || 0, t.pomos || 1);
    markTaskDone(g, t, 'manual');
    touch();
    return;
  }
  // done → todo（取消完成）：把"手工勾"补记的那笔账退回去，紧迫度才能恢复。
  // 真实专注（计时路径）不受影响 —— 见 revertManualCredit 的口径说明。
  if (t.status === 'done' && status === 'todo') {
    revertManualCredit(g, t);
    t.doneAt = 0;
  }
  t.status = status;
  touch();
}

/** 改期：把任务挪到第 day 天（日历页前移/后移一天用） */
export function moveTaskDay(goalId, taskId, day) {
  const g = goalOf(goalId);
  if (!g) return false;
  const t = g.tasks.filter(x => x.id === taskId)[0];
  if (!t) return false;
  const d = Math.max(1, Math.floor(Number(day) || 1));
  if (d === t.day) return false;
  t.day = d;
  t.movedAt = Date.now();
  touch();
  return true;
}

/** 专注完成：给任务 +1 */
export function addPomoToTask(goalId, taskId) {
  const g = goalOf(goalId);
  if (!g) return;
  const t = g.tasks.filter(x => x.id === taskId)[0];
  if (!t) return;
  t.donePomos = (t.donePomos || 0) + 1;
  // 专注数做满即自动完成（走 markTaskDone：台账要记一笔，否则"今天全部完成"判不出来）
  if (t.donePomos >= t.pomos && t.status === 'todo') markTaskDone(g, t, 'pomo');
  touch();
}

// ---------- 今日任务队列 ----------
// 取 active 目标中"该做还没做"的任务：day <= 已进行天数+1（含轻微超期），按 day 排序
export function todayQueue(limit) {
  const cap = limit || 8;
  const out = [];
  const t0 = today();
  const gs = activeGoals();
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i];
    const elapsed = dayDiff(dateStr(new Date(g.createdAt)), t0) + 1;
    const todos = g.tasks.filter(t => t.status === 'todo' && t.day <= elapsed);
    todos.sort((a, b) => a.day - b.day);
    for (let j = 0; j < todos.length && out.length < cap; j++) {
      out.push({ goal: g, task: todos[j], overdue: todos[j].day < elapsed });
    }
  }
  return out;
}

// ---------- 专注记录 / 每日统计 ----------
function dayOf(st, key) {
  if (!st.daily[key]) st.daily[key] = { focusMin: 0, pomo: 0, byApp: {}, byHour: {} };
  const d = st.daily[key];
  if (!d.byHour) d.byHour = {};   // 老数据补字段
  return d;
}

/** 记一个完整专注 */
export function recordPomo(session) {
  const st = get();
  st.sessions.push(session);
  if (st.sessions.length > 500) st.sessions = st.sessions.slice(-400);
  // 按"专注开始那天"记账，而不是"落账这一刻"。跨零点跑完的专注（23:50 → 00:10）
  // 以前会整个记到新的一天，昨天那 10 分钟凭空消失，今天又多出一笔没坐过的时长。
  // 不拆成两天：一个完整的专注不该在统计里变成 0.4 + 0.6 两个。
  // 与下面的 byHour 口径一致（它也是按 startAt 的小时记的）。
  const d = dayOf(st, session.startAt ? dateStr(new Date(session.startAt)) : today());
  // 分钟照记（中断的那段也是真坐下来的时间），但"完成专注数"只统计跑完的 ——
  // 否则中断会话会把今日专注数与 forecast 的速度算虚高
  d.focusMin += session.min;
  if (session.done) d.pomo += 1;
  // 按小时分布：用来看"一天里哪几段真的学得进去"（统计页的时段条）
  const h = new Date(session.startAt || session.endAt || Date.now()).getHours();
  d.byHour[h] = (d.byHour[h] || 0) + session.min;
  touch();
}

/* ---------- 严格 / 强制模式的「退出配额」 ---------- */

// 每月允许中途退出几次。参考番茄ToDo 严格模式（视频里"本月已退出 1 次，还可退出 1 次"
// = 每月 2 次）。配额是给"真有急事"留的门：一次都不给，人只能划掉 App 或干脆关掉
// 强制模式；给太多，强制模式又等于没有。要调松紧改这一个常量。
const EXIT_QUOTA_MAX = 2;

function monthOf(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

/** 本月还剩几次中途退出的额度 */
export function exitQuotaLeft() {
  const q = get().exitQuota;
  if (!q || q.month !== monthOf(Date.now())) return EXIT_QUOTA_MAX;
  return Math.max(0, EXIT_QUOTA_MAX - (Number(q.used) || 0));
}

/** 本月已经用掉几次 */
export function exitQuotaUsed() {
  const q = get().exitQuota;
  if (!q || q.month !== monthOf(Date.now())) return 0;
  return Math.max(0, Number(q.used) || 0);
}

export function exitQuotaMax() { return EXIT_QUOTA_MAX; }

/**
 * 用掉一次配额。没额度了返回 false —— 调用方据此把「放弃」这条路堵上
 * （番茄ToDo 的做法：严格模式下"放弃当前计时"是灰的）。
 * 跨月自动重置：只认 month 字段等于当前月的那条记录。
 */
export function useExitQuota() {
  const st = get();
  const m = monthOf(Date.now());
  if (!st.exitQuota || st.exitQuota.month !== m) st.exitQuota = { month: m, used: 0 };
  if (st.exitQuota.used >= EXIT_QUOTA_MAX) return false;
  st.exitQuota.used += 1;
  touch();
  return true;
}

/**
 * 给刚落账的那段专注补一句心得（休息页上填的）。
 * 存会话本身而不是另开一份"心得表"：它本来就是这一段专注的附属信息，
 * 跟着 session 走才不会出现"休息页显示的心得和统计对不上号"。
 */
export function setPomoNote(id, note) {
  if (!id) return false;
  const s = (get().sessions || []).filter(x => x.id === id)[0];
  if (!s) return false;
  s.note = String(note == null ? '' : note).slice(0, 200);
  touch();
  return true;
}

/** 某天的心得（休息页回填显示用） */
export function pomoNote(id) {
  if (!id) return '';
  const s = (get().sessions || []).filter(x => x.id === id)[0];
  return s ? (s.note || '') : '';
}

/**
 * 连续专注天数：连着几天有"跑完的专注"（pomo >= 1）。
 * 今天还没跑就从昨天往前数 —— 今天没结束，不能算人家断了。
 */
export function focusStreak() {
  const daily = get().daily || {};
  let n = 0;
  let d = today();
  if (!(daily[d] && (daily[d].pomo || 0) > 0)) d = addDays(d, -1);
  while (daily[d] && (daily[d].pomo || 0) > 0) { n += 1; d = addDays(d, -1); }
  return n;
}

/** 累计有专注的天数（"共专注 N 天"） */
export function focusDays() {
  const daily = get().daily || {};
  let n = 0;
  Object.keys(daily).forEach(k => { if ((daily[k].pomo || 0) > 0) n += 1; });
  return n;
}

/** 一段专注算多少分钟：补记时按设置里的专注时长折算 */
function focusLen() {
  const c = get().pomoCfg || {};
  const n = Number(c.focus) || 0;
  return n > 0 ? n : 25;
}

/**
 * 补记专注 —— 收工填报 / 对话记功 / 手工勾完成，三条路都走这里。
 *
 * 为什么不能只改 task.donePomos：统计口径只认 sessions 与 daily.pomo|focusMin。
 * 只改任务字段的话，热力图那天仍是一片空白、forecast 算出的速度不含这些专注、
 * 重排拿到的 reality.days 也少一截 —— 结果是"任务显示已完成，但这个人今天像没学过，
 * AI 下次重排还以为他进度落后"。
 *
 * 与 recordPomo 的区别：这是事后补记，没有真实起止时间，所以
 *   ① 分钟数按"专注时长 × 个数"折算；
 *   ② 不写 byHour —— 凭空塞一个时段会污染"一天里哪几段真学得进去"的分析；
 *   ③ session 带 src 标记（log / chat / manual），需要时能单独区分。
 *
 * 只补到任务上限（1 段专注的任务不会因为填了 3 就补成 3），返回实际补了几个。
 */
export function creditPomo(goalId, taskId, n, opt) {
  const o = opt || {};
  // 补记落到哪一天（"填的是昨天的表"时记昨天）—— 完成台账要跟它同一天，
  // 所以这两个都得在置完成之前算好
  const key = o.date || today();
  const g = goalOf(goalId);
  if (!g) return 0;
  const t = g.tasks.filter(x => x.id === taskId)[0];
  if (!t) return 0;
  const cap = Math.max(1, t.pomos || 1);
  const add = Math.min(Math.floor(Number(n) || 0), Math.max(0, cap - (t.donePomos || 0)));
  if (add <= 0) return 0;
  t.donePomos = (t.donePomos || 0) + add;
  // 做满即完成 —— 同样走 markTaskDone 记台账
  if (t.donePomos >= cap && t.status === 'todo') markTaskDone(g, t, o.src || 'log', key);

  const st = get();
  const min = add * focusLen();
  st.sessions.push({
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    goalId: goalId,
    taskId: taskId,
    startAt: Date.now(),
    endAt: Date.now(),
    min: min,
    done: true,
    src: o.src || 'log'
  });
  if (st.sessions.length > 500) st.sessions = st.sessions.slice(-400);
  const d = dayOf(st, key);
  d.focusMin += min;
  d.pomo += add;
  touch();
  return add;
}

/** 累加某天某 App 的使用分钟（前台计时 / 系统统计融合） */
export function addAppMinutes(key, pkg, minutes) {
  if (!(minutes > 0)) return;
  const st = get();
  const d = dayOf(st, key || today());
  d.byApp[pkg] = (d.byApp[pkg] || 0) + minutes;
  touch();
}

/**
 * 记"今天背了多少词"—— 来自伙伴 App（AWword）回传。
 * 为什么必须由它回传：系统的 UsageStats 只知道"你在那个 App 待了 25 分钟"，
 * 永远测不出"这 25 分钟里你过了几个词"。这两个数是两件事。
 * 按天记（不是全局累计），否则"今天背了多少"算不出来。
 */
export function addVocabWords(key, n) {
  const c = Math.round(Number(n));
  if (!(c > 0)) return;
  const d = dayOf(get(), key || today());
  d.vocabWords = (d.vocabWords || 0) + c;
  touch();
}

/** 某天背词数（缺省今天）；没有记录返回 0 */
export function vocabWords(key) {
  const d = get().daily[key || today()];
  return d && d.vocabWords ? d.vocabWords : 0;
}

/**
 * 记一条**外部学习明细**（伙伴 App 回传 / 我们自己记的一来一回）。
 *
 * 为什么要在 byApp 之外再存一份明细：byApp 只答得出"今天在那个 App 里待了 30 分钟"，
 * 答不出"他几点学的、一次学多久、一天分几次" —— 而这正是排期要知道的：
 * 一个人固定在 19:00-19:30 背单词，排期就该把那半小时让出来，别再往里塞任务。
 *
 * ⚠️ 这份是**明细**，不是第二份总账：分钟总数仍然只认 byApp['app:awword']，
 *    下面的 extStudySummary 只把它按小时重新摊一遍，不重复累加
 *    —— 同一笔时长记两处，早晚对不上，而且没人读第二份。
 *
 * @param {string} key 日期
 * @param {{min?:number,words?:number,from?:number,to?:number,at?:number,taskId?:string,src?:string}} rec
 */
export function addExtStudy(key, rec) {
  const r = rec || {};
  const min = Math.max(0, Math.round(Number(r.min) || 0));
  const words = Math.max(0, Math.round(Number(r.words) || 0));
  if (!(min > 0) && !(words > 0)) return null;
  const d = dayOf(get(), key || today());
  if (!Array.isArray(d.ext)) d.ext = [];
  const to = Number(r.to) > 0 ? Number(r.to) : (Number(r.at) > 0 ? Number(r.at) : Date.now());
  // 起点：对方给了就用；否则由"完成时刻往前推时长"倒推 ——
  // 完成时刻与时长都是硬数据，倒推出来的范围比"没有范围"有用得多，
  // 也比拿一个几小时前的出发时间去凑一个离谱的范围靠谱。
  let from = Number(r.from) > 0 ? Number(r.from) : to - min * 60000;
  // 起点晚于终点（对面给了个怪值 / 出发时间记岔了）→ 一律退回"按时长倒推"。
  // 宁可给一个保守的范围，也不能让"从某时刻开始"框出一个比时长还长的空壳 ——
  // 那种范围喂给排期，会把一整段根本没在学习的时间当成"已经被占住"。
  if (from > to) from = to - min * 60000;
  const item = {
    at: to,
    from: from,
    to: to,
    min: min,
    words: words,
    taskId: String(r.taskId || ''),
    src: String(r.src || 'awword')
  };
  d.ext.push(item);
  if (d.ext.length > 80) d.ext = d.ext.slice(-60);   // 只留最近 60 条，别让老数据无限长
  touch();
  return item;
}

/** 某天的外部学习明细（副本） */
export function extStudyOf(key) {
  const d = get().daily[key || today()];
  return d && Array.isArray(d.ext) ? d.ext.slice() : [];
}

/**
 * 外部学习的**节奏摘要**（近 n 天，缺省 7 天）。
 *
 * 只做分布与节奏，不重算总分钟（总数认 byApp）。回答三个排期真会用到的问题：
 *   ① 他通常几点在学（topHours）→ 别把任务排到那会儿
 *   ② 一次学多久（avgMin）→ 决定"一段"该排多少量
 *   ③ 一天分几次（times）→ 判断他是集中型还是碎片型
 */
export function extStudySummary(key, days) {
  const n = Math.max(1, Math.floor(Number(days) || 7));
  const items = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = addDays(key || today(), -i);
    extStudyOf(k).forEach(it => items.push(Object.assign({ date: k }, it)));
  }
  if (!items.length) return null;
  let min = 0;
  let words = 0;
  let lastAt = 0;
  const byHour = {};
  const spans = [];
  items.forEach(it => {
    min += it.min || 0;
    words += it.words || 0;
    const h = new Date(it.at || Date.now()).getHours();
    byHour[h] = (byHour[h] || 0) + (it.min || 0);
    if (it.to && it.from && it.to > it.from) {
      spans.push({ date: it.date, from: it.from, to: it.to, min: it.min, words: it.words });
    }
    if ((it.at || 0) > lastAt) lastAt = it.at;
  });
  const topHours = Object.keys(byHour)
    .sort((a, b) => byHour[b] - byHour[a])
    .slice(0, 3)
    .map(Number);
  return {
    days: n,
    times: items.length,
    min: min,
    words: words,
    avgMin: items.length ? Math.round(min / items.length) : 0,
    byHour: byHour,
    topHours: topHours,
    spans: spans,
    firstAt: items[0].at || 0,
    lastAt: lastAt
  };
}

/* ---------- 学习范围：在 / 不在学习地点 ---------- */
/*
 * 用户自己圈几个学习地点（家、图书馆、自习室…），App 在几个固定时刻取一次定位，
 * 记下"这会儿在不在范围内"。这批数据只有一个用途：**告诉 AI 那段时间人客观不在场**，
 * 别把"没学"一律判成偷懒或能力下降。
 *
 * ⚠️ 三条红线（改这块前先读）：
 *   ① 落库的只有 inside 布尔 + 时刻，**经纬度一个字节都不存** ——
 *      定位拿到即用即弃；用户圈了哪些地点、在哪儿，都不属于统计层。
 *   ② 只记**状态翻转**：全天没动过就一条都没有，不会攒成一串心跳日志。
 *      取定位是耗电动作，这条约束同时也决定了"多久取一次"不能太密。
 *   ③ 喂给 AI 的只有时段与分钟数（见 harvest.rangeBlock），地点名同样不外传。
 */

/**
 * 记一次"在不在学习范围"的判定结果。
 *
 * 只在**翻转**时落一条：上一次也是同样的状态就什么都不做。
 * 这样"在家坐了一下午"只会有 1 条记录，而不是几百条采样。
 *
 * @param {string} key 日期
 * @param {boolean} inside 在学习范围内
 * @param {number} [at] 判定时刻（缺省现在）
 * @returns {{at:number,inside:boolean}|null} null = 没翻转，没落库
 */
export function addRangeSample(key, inside, at) {
  const d = dayOf(get(), key || today());
  if (!Array.isArray(d.range)) d.range = [];
  const ts = Number(at) > 0 ? Number(at) : Date.now();
  const last = d.range[d.range.length - 1];
  if (last && !!last.inside === !!inside) return null;
  const rec = { at: ts, inside: !!inside };
  d.range.push(rec);
  if (d.range.length > 60) d.range = d.range.slice(-40);   // 老数据不无限长
  touch();
  return rec;
}

/** 某天的翻转序列（副本，按时刻升序） */
export function rangeOf(key) {
  const d = get().daily[key || today()];
  if (!d || !Array.isArray(d.range) || !d.range.length) return [];
  return d.range.slice().sort((a, b) => (a.at || 0) - (b.at || 0));
}

/** 最后一条判定（当前大概在不在范围内）；没记过返回 null */
export function rangeLast(key) {
  const r = rangeOf(key || today());
  return r.length ? r[r.length - 1] : null;
}

/** 把一段时长按整小时摊进 byHour（一段跨了 12:40-13:20 就两边各摊一半） */
function spreadHours(byHour, from, to, min) {
  const a = Number(from) || 0;
  const b = Number(to) || 0;
  if (!(b > a) || !(min > 0)) return;
  let cur = a;
  let left = min;
  while (cur < b && left > 0) {
    const nd = new Date(cur);
    nd.setMinutes(0, 0, 0);
    nd.setHours(nd.getHours() + 1);
    const edge = Math.min(nd.getTime(), b);
    const part = Math.round(min * (edge - cur) / (b - a));
    byHour[new Date(cur).getHours()] = (byHour[new Date(cur).getHours()] || 0) + part;
    left = left - part;
    cur = edge;
  }
}

/**
 * 「在 / 不在学习范围」的节奏摘要（近 n 天，缺省 7 天）。
 *
 * 签名与风格照抄 extStudySummary：给排期回答三个问题 ——
 *   ① 他通常几点不在学习地点（topHours）→ 别把任务排到那会儿
 *   ② 一次出去多久（avgMin）→ 别把一整段活儿塞进一个注定被打断的下午
 *   ③ 有几天压根不在（outDays）→ 判断"这几天进度慢"是能力问题还是人不在
 *
 * ⚠️ 时长只认**能确定首尾**的那几段：
 *    第一次采样就已经在外面（不知道什么时候走的）、或那天之后再没消息
 *    （不知道什么时候回来的），这两段时长不可知，**一律不计** ——
 *    宁可少报，也不能拿一个拼出来的时长去让 AI 少排任务。
 */
export function rangeSummary(key, days) {
  const n = Math.max(1, Math.floor(Number(days) || 7));
  const now = Date.now();
  const tk = today();
  const spans = [];
  const byHour = {};
  let outDays = 0;
  let openEnds = 0;
  for (let i = n - 1; i >= 0; i--) {
    const k = addDays(key || tk, -i);
    const evs = rangeOf(k);
    if (!evs.length) continue;
    let daySpans = 0;
    let outStart = 0;
    evs.forEach(e => {
      if (!e.inside) { if (!outStart) outStart = e.at; return; }
      if (outStart) {
        const min = Math.round((e.at - outStart) / 60000);
        if (min > 0) {
          spans.push({ date: k, from: outStart, to: e.at, min: min });
          spreadHours(byHour, outStart, e.at, min);
          daySpans++;
        }
        outStart = 0;
      }
    });
    // 最后一次采样还是"在外面"：只有当天能补上"到现在"这个尾巴
    // （人就在此刻不在场，这是事实）；过去的日子再没消息就是不可知，不计。
    if (outStart) {
      if (k === tk && now > outStart) {
        const min = Math.round((now - outStart) / 60000);
        if (min > 0) {
          spans.push({ date: k, from: outStart, to: now, min: min, open: true });
          spreadHours(byHour, outStart, now, min);
          daySpans++;
        }
      } else {
        openEnds++;
      }
    }
    if (daySpans) outDays++;
  }
  if (!spans.length && !openEnds) return null;
  let outMin = 0;
  spans.forEach(sp => { outMin += sp.min; });
  const topHours = Object.keys(byHour)
    .sort((a, b) => byHour[b] - byHour[a])
    .slice(0, 3)
    .map(Number);
  return {
    days: n,
    times: spans.length,
    outMin: outMin,
    outDays: outDays,
    avgMin: spans.length ? Math.round(outMin / spans.length) : 0,
    byHour: byHour,
    topHours: topHours,
    spans: spans,
    openEnds: openEnds   // 有多少天"最后一次看到他时还在外面、之后没消息"
  };
}

/** 一段时间范围的人话（08:30-09:00）；只有起点没有终点时给"08:30 起" */
export function spanText(from, to) {
  const a = Number(from) || 0;
  const b = Number(to) || 0;
  if (!a) return '';
  if (!b || b <= a) return clockText(a) + ' 起';
  return clockText(a) + '-' + clockText(b);
}

/** 系统级 UsageStats 拉平：直接覆盖某天各 App 分钟数（仅统计 dock 里登记的包） */
export function setAppMinutes(key, byApp) {
  const st = get();
  const d = dayOf(st, key || today());
  const known = {};
  st.dock.forEach(a => { known[a.pkg] = 1; });
  Object.keys(byApp).forEach(pkg => {
    if (known[pkg]) d.byApp[pkg] = byApp[pkg];
  });
  touch();
}

// ---------- AppDock ----------
export function dock() { return get().dock; }

export function dockAdd(pkg, name, purpose, task) {
  const st = get();
  pkg = String(pkg || '').trim();
  // 拦掉脏数据：之前真机上出现过 name/pkg 为 undefined 的死行
  if (!pkg) return st.dock;
  if (st.dock.some(a => a.pkg === pkg)) return st.dock;
  st.dock.push({
    pkg,
    name: String(name || pkg),
    purpose: purpose || 'study',
    task: String(task || '').trim(),
    sort: st.dock.length
  });
  touch();
  return st.dock;
}

export function dockRemove(pkg) {
  const st = get();
  st.dock = st.dock.filter(a => a.pkg !== pkg);
  touch();
}

export function dockSetPurpose(pkg, purpose) {
  const a = get().dock.filter(x => x.pkg === pkg)[0];
  if (a) { a.purpose = purpose; touch(); }
}

export function dockSetTask(pkg, task) {
  const a = get().dock.filter(x => x.pkg === pkg)[0];
  if (a) { a.task = String(task || '').trim(); touch(); }
}

// ---------- 汇总 ----------
export function overview() {
  const st = get();
  const d = st.daily[today()] || { focusMin: 0, pomo: 0 };
  return {
    todayMin: d.focusMin,
    pomo: d.pomo,
    activeGoals: st.goals.filter(g => g.status === 'active').length
  };
}

/** 近 n 天的专注分钟（旧 → 新），画柱状图用 */
export function recentDays(n) {
  const st = get();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = addDays(today(), -i);
    const d = st.daily[key] || { focusMin: 0, pomo: 0 };
    out.push({ date: key, focusMin: d.focusMin, pomo: d.pomo, byApp: d.byApp || {} });
  }
  return out;
}

/** 近 n 天按小时的专注分钟分布（0-23），画"一天里哪几段学得进去" */
export function hourProfile(n) {
  const st = get();
  const out = [];
  for (let h = 0; h < 24; h++) out.push(0);
  for (let i = 0; i < (n || 30); i++) {
    const key = addDays(today(), -i);
    const d = st.daily[key];
    if (!d || !d.byHour) continue;
    Object.keys(d.byHour).forEach(h => {
      const idx = Number(h);
      if (idx >= 0 && idx < 24) out[idx] += d.byHour[h];
    });
  }
  return out;
}

/** 近 n 天里最好的三个时段：返回 [{h, min}] */
export function bestHours(n) {
  const prof = hourProfile(n || 30);
  const arr = prof.map((min, h) => ({ h, min })).filter(x => x.min > 0);
  arr.sort((a, b) => b.min - a.min);
  return arr.slice(0, 3);
}

/**
 * 按近期真实速度外推：这个目标大概哪天做完。
 * 只看有记录的日子（没学就是 0，会把平均拉低——这正是我们想要的"诚实"）。
 * 返回 { days, date, perDay, ok }
 */
export function forecast(g, windowDays) {
  const win = windowDays || 7;
  const recent = recentDays(win);
  const active = recent.filter(d => d.pomo > 0 || d.focusMin > 0);
  const prog = goalProgress(g);
  const left = Math.max(0, prog.total - prog.done);
  if (!left) return { days: 0, date: today(), perDay: 0, ok: true, done: true };
  if (!active.length) return { days: 0, date: '', perDay: 0, ok: false };
  // 每段专注 25 分钟：用专注数做口径，跟任务量同一单位
  const pomos = recent.reduce((n, d) => n + d.pomo, 0);
  const perDay = pomos / win;
  if (perDay <= 0.05) return { days: 0, date: '', perDay: 0, ok: false };
  const days = Math.ceil(left / perDay);
  return { days, date: addDays(today(), days), perDay: Math.round(perDay * 10) / 10, ok: true };
}

/** 目标进度：已完成专注 / 总专注 */
export function goalProgress(g) {
  let total = 0, done = 0;
  (g.tasks || []).forEach(t => {
    if (t.status === 'dropped') return;
    total += t.pomos;
    done += Math.min(t.donePomos || 0, t.pomos);
  });
  return { total, done, pct: total ? Math.round(done * 100 / total) : 0 };
}

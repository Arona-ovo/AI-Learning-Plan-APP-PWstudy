// utils/pwstore.js - PWstudy 核心数据：目标 / 任务 / 番茄记录 / 学习 App 时长
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
    sessions: [],     // 已完成/中断的番茄 {id,goalId,taskId,startAt,endAt,min,done}
    daily: {},        // 'YYYY-MM-DD' -> {focusMin, pomo, byApp:{pkg:min}}
    dock: [],         // 学习 App {pkg, name, purpose:'study'|'rest', task, sort}
    pomoCfg: { focus: 25, rest: 5, long: 15, every: 4 },
    runtime: null     // 番茄进行中的现场（focus.js 读写）
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
 * 只清数据，不动 pomoCfg —— 番茄时长是偏好（和主题色、昵称一样），
 * 没人想因为清了一次数据就被打回 25/5。
 * 调用方负责先让 focus 停下（见 utils/pwreset.js）：否则在跑的番茄
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

/** 任务状态流转 */
export function setTaskStatus(goalId, taskId, status) {
  const g = goalOf(goalId);
  if (!g) return;
  const t = g.tasks.filter(x => x.id === taskId)[0];
  if (!t) return;
  t.status = status;
  if (status === 'done') {
    t.doneAt = Date.now();
    // 手工勾完成要把番茄数补齐：进度条 / 统计只认 donePomos（见 goalProgress），
    // 不补的话勾完状态是"已完成"但进度仍是 0%，和番茄钟路径两套口径。
    // 差额走 creditPomo（而不是直接改字段）—— 补的这些也要进 sessions / daily，
    // 否则"勾一下完成"在热力图和 forecast 里等于没学过
    creditPomo(goalId, taskId, Math.max(1, t.pomos || 1) - (t.donePomos || 0), { src: 'manual' });
    t.donePomos = Math.max(t.donePomos || 0, t.pomos || 1);
  }
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

/** 番茄完成：给任务 +1 */
export function addPomoToTask(goalId, taskId) {
  const g = goalOf(goalId);
  if (!g) return;
  const t = g.tasks.filter(x => x.id === taskId)[0];
  if (!t) return;
  t.donePomos = (t.donePomos || 0) + 1;
  // 番茄数做满即自动完成
  if (t.donePomos >= t.pomos && t.status === 'todo') t.status = 'done';
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

// ---------- 番茄记录 / 每日统计 ----------
function dayOf(st, key) {
  if (!st.daily[key]) st.daily[key] = { focusMin: 0, pomo: 0, byApp: {}, byHour: {} };
  const d = st.daily[key];
  if (!d.byHour) d.byHour = {};   // 老数据补字段
  return d;
}

/** 记一个完整番茄 */
export function recordPomo(session) {
  const st = get();
  st.sessions.push(session);
  if (st.sessions.length > 500) st.sessions = st.sessions.slice(-400);
  // 按"番茄开始那天"记账，而不是"落账这一刻"。跨零点跑完的番茄（23:50 → 00:10）
  // 以前会整个记到新的一天，昨天那 10 分钟凭空消失，今天又多出一笔没坐过的时长。
  // 不拆成两天：一个完整的番茄不该在统计里变成 0.4 + 0.6 两个。
  // 与下面的 byHour 口径一致（它也是按 startAt 的小时记的）。
  const d = dayOf(st, session.startAt ? dateStr(new Date(session.startAt)) : today());
  // 分钟照记（中断的那段也是真坐下来的时间），但"完成番茄数"只统计跑完的 ——
  // 否则中断会话会把今日番茄数与 forecast 的速度算虚高
  d.focusMin += session.min;
  if (session.done) d.pomo += 1;
  // 按小时分布：用来看"一天里哪几段真的学得进去"（统计页的时段条）
  const h = new Date(session.startAt || session.endAt || Date.now()).getHours();
  d.byHour[h] = (d.byHour[h] || 0) + session.min;
  touch();
}

/** 一个番茄算多少分钟：补记时按设置里的专注时长折算 */
function focusLen() {
  const c = get().pomoCfg || {};
  const n = Number(c.focus) || 0;
  return n > 0 ? n : 25;
}

/**
 * 补记番茄 —— 收工填报 / 对话记功 / 手工勾完成，三条路都走这里。
 *
 * 为什么不能只改 task.donePomos：统计口径只认 sessions 与 daily.pomo|focusMin。
 * 只改任务字段的话，热力图那天仍是一片空白、forecast 算出的速度不含这些番茄、
 * 重排拿到的 reality.days 也少一截 —— 结果是"任务显示已完成，但这个人今天像没学过，
 * AI 下次重排还以为他进度落后"。
 *
 * 与 recordPomo 的区别：这是事后补记，没有真实起止时间，所以
 *   ① 分钟数按"番茄时长 × 个数"折算；
 *   ② 不写 byHour —— 凭空塞一个时段会污染"一天里哪几段真学得进去"的分析；
 *   ③ session 带 src 标记（log / chat / manual），需要时能单独区分。
 *
 * 只补到任务上限（1 个番茄的任务不会因为填了 3 就补成 3），返回实际补了几个。
 */
export function creditPomo(goalId, taskId, n, opt) {
  const o = opt || {};
  const g = goalOf(goalId);
  if (!g) return 0;
  const t = g.tasks.filter(x => x.id === taskId)[0];
  if (!t) return 0;
  const cap = Math.max(1, t.pomos || 1);
  const add = Math.min(Math.floor(Number(n) || 0), Math.max(0, cap - (t.donePomos || 0)));
  if (add <= 0) return 0;
  t.donePomos = (t.donePomos || 0) + add;
  if (t.donePomos >= cap && t.status === 'todo') { t.status = 'done'; t.doneAt = Date.now(); }

  const st = get();
  const key = o.date || today();
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
  // 每个番茄 25 分钟：用番茄数做口径，跟任务量同一单位
  const pomos = recent.reduce((n, d) => n + d.pomo, 0);
  const perDay = pomos / win;
  if (perDay <= 0.05) return { days: 0, date: '', perDay: 0, ok: false };
  const days = Math.ceil(left / perDay);
  return { days, date: addDays(today(), days), perDay: Math.round(perDay * 10) / 10, ok: true };
}

/** 目标进度：已完成番茄 / 总番茄 */
export function goalProgress(g) {
  let total = 0, done = 0;
  (g.tasks || []).forEach(t => {
    if (t.status === 'dropped') return;
    total += t.pomos;
    done += Math.min(t.donePomos || 0, t.pomos);
  });
  return { total, done, pct: total ? Math.round(done * 100 / total) : 0 };
}

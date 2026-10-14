// _tools/check-harvest.js - 「任务完成反馈 + 每日任务动态重排」的校验
// 运行：node _tools/check-harvest.js
//
// 真跑 utils/harvest.js（不是只看源码），AI 那一层用假替身 —— 替身只把
// "传了什么进去、回了什么出来"记下来给我们断言。守的是需求里的六条边界：
//   1) 数据结构：当天完成情况（任务内容 / 完成时间 / 额外收获）真的落在本地
//   2) 三条完成路径（手工勾 / 专注跑满 / 收工补记）都收敛到同一个出口 ——
//      漏一条就会出现"任务显示已完成但台账没有"，于是"今天全部完成"永远判不出来、
//      自动重排永远不触发（这是整套功能最脆的一环）
//   3) 「全部完成」四个条件缺一不可（今天有安排 / 无待办 / 无欠账 / 台账非空）
//   4) 自动重排**只落地可逆动作**（move/resize），砍任务与顺延期限必须进 pending ——
//      "不用我确认"不等于"你可以悄悄删我的任务"
//   5) 一天只自动重排一次 + AI 挂了也要排（localRoll）
//   6) 信息不足先问本人，问来的意见进上下文、结果记回来（闭环）
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { load } = require('./lib/load.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  const s1 = JSON.stringify(a), s2 = JSON.stringify(b);
  if (s1 === s2) ok(label + ' = ' + s2);
  else bad(label + ' 期望 ' + s2 + '，实际 ' + s1);
}

/**
 * 切出某个方法的函数体（配大括号）。
 * ⚠️ 别写 `fn\(\)[\s\S]{0,240}x` 这种有界窗口 —— 多插两行就假红（第 22 条硬约束）。
 * ⚠️ 两种形态顺序不能反：先 `export function name(`（模块顶层），再缩进 `    name() {`
 *    —— 先试缩进形态会命中"缩进的调用处"，切出二十几个字符，后面断言全静默落空（已踩）。
 */
function fnBody(src, name) {
  let m = new RegExp('^[ \\t]*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + name + '\\s*\\(', 'm').exec(src);
  if (!m) m = new RegExp('^[ \\t]{2,6}' + name + '\\s*\\(', 'm').exec(src);
  if (!m) return '';
  const j = src.indexOf('{', m.index + m[0].length);
  if (j < 0) return '';
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j);
}

/* ---------------- mock ---------------- */
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {}
};

const pw = load('utils/pwstore.js');
// schedule / dailylog 自己也 import 了 pwstore：依赖袋必须带上（load 按标识符注入，
// 漏了就是运行时 ReferenceError —— 而且只在真调用时才炸，静态看不出来）
const holiday = load('utils/holiday.js');
const schedule = load('utils/schedule.js', { pw, holiday });
const dailylog = load('utils/dailylog.js', { pw });

/* AI 替身：把"喂进去什么、吐出来什么"都记下来 */
let aiOn = true;
let featureSet = { harvest: true, replan: true };
let calls = [];
let nextOps = [];
let nextSummary = '';
let aiThrows = false;
const deps = {
  pw, schedule, dailylog,
  isAIEnabled: () => aiOn,
  featureOn: (k) => !!featureSet[k],
  summarizeHarvest: async (ctx) => {
    calls.push({ fn: 'summarizeHarvest', ctx });
    if (aiThrows) throw new Error('AI 挂了');
    return { summary: '总结：' + (ctx.texts || []).join('/'), tags: ['效率', '速度'] };
  },
  replanGoal: async (goal, reality, opt, extra) => {
    calls.push({ fn: 'replanGoal', goal, reality, opt, extra });
    if (aiThrows) throw new Error('AI 挂了');
    return { summary: nextSummary || 'AI 的判断', ops: nextOps };
  },
  replanFromToday: async (goal, log, reality, opt, extra) => {
    calls.push({ fn: 'replanFromToday', goal, log, reality, opt, extra });
    if (aiThrows) throw new Error('AI 挂了');
    return { summary: nextSummary || 'AI 的判断', ops: nextOps };
  }
};
const harvest = load('utils/harvest.js', deps);

/* ---------------- 造数据的小工具 ---------------- */
const T0 = pw.today();
const DAY = 86400000;

/** 全新开局：清库 + 一个今天有安排的目标 */
function fresh(tasks) {
  pw.reset();
  kv['fj_pw_data_v1'] = pw.get();
  calls = []; nextOps = []; nextSummary = ''; aiThrows = false;
  aiOn = true; featureSet = { harvest: true, replan: true };
  const g = pw.addGoal(
    { title: '考研英语', deadline: pw.addDays(T0, 14), dailyMin: 60 },
    { tasks: tasks || [{ title: '背单词', day: 1, pomos: 2 }, { title: '做阅读', day: 1, pomos: 2 }] }
  );
  return pw.goalOf(g.id);
}

/** 把目标的创建时间往前挪 n 天（造"昨天 / 前天"的安排） */
function backdate(g, n) {
  g.createdAt = Date.now() - n * DAY;
  return g;
}

/** 造出"数据够了"的假象：3 个以上完成专注 + 近 7 天有专注 */
function enoughData(o) {
  const opt = o || {};
  const st = pw.get();
  for (let i = 0; i < 4; i++) {
    st.sessions.push({ id: 's' + i + Math.random(), goalId: '', taskId: '',
      startAt: Date.now(), endAt: Date.now(), min: 25, done: true });
  }
  st.daily[T0] = Object.assign(st.daily[T0] || {},
    { focusMin: opt.todayMin == null ? 100 : opt.todayMin, pomo: 4 });
  if (opt.yesterdayMin != null) {
    st.daily[pw.addDays(T0, -1)] = { focusMin: opt.yesterdayMin, pomo: 2, byApp: {}, byHour: {} };
  }
  pw.touch();
}

/**
 * 只把"今天该做的"做完 —— **后面几天必须留着**。
 * 全勾完的话 autoReplan 会走 'nothing-left' 提前返回（没有"后续"可排），
 * 断言就会静默落空（已踩）。
 */
function doneToday(g) {
  const start = pw.dateStr(new Date(g.createdAt || Date.now()));
  const elapsed = pw.dayDiff(start, pw.today()) + 1;
  (g.tasks || []).filter(t => (t.day || 1) <= elapsed)
    .forEach(t => pw.setTaskStatus(g.id, t.id, 'done'));
}

function allDone(g) {
  (g.tasks || []).forEach(t => pw.setTaskStatus(g.id, t.id, 'done'));
}

// ⚠️ 这个文件里要用 await 调真函数，而 CJS 没有顶层 await —— 整段包在 async IIFE 里。
//    别把 process.exit 留在 IIFE 外面：那里会比断言先跑，永远绿。
// ⚠️ 整个断言段要套 try：反向测试会故意把源码改坏，改坏之后很可能在某条断言里抛出
//    （比如台账没了 → rec 是 undefined）。不接住的话进程直接崩、一条红都不打，
//    反向测试会把"崩了"读成"没被抓到"，看的人还以为是自己写错了护栏。
(async () => {
try {

/* ================= 1. 数据结构（需求 3） ================= */
console.log('== 1. 当天完成情况存到本地（数据结构）==');
{
  const g = fresh();
  const t1 = g.tasks[0];
  pw.setTaskStatus(g.id, t1.id, 'done');

  const day = pw.get().daily[T0];
  assert(!!day, '完成一项后 daily[今天] 存在');
  assert(day.done && Array.isArray(day.done.items), '台账挂在 daily[今天].done.items 上');
  // 原有字段没被挤掉（台账是"加在每天上"，不是"替换每天"）
  assert(typeof day.byHour === 'object' && typeof day.byApp === 'object',
    '同一天原有的 focusMin / byHour / byApp 还在（台账是加进去，不是替换）');

  const items = pw.ledgerList(T0);
  eq(items.length, 1, '今天完成 1 项 → 台账 1 条');
  const rec = items[0];
  ['goalId', 'taskId', 'title', 'goalTitle', 'day', 'pomos', 'at', 'atText', 'src', 'harvest']
    .forEach(k => assert(k in rec, '记录含字段 ' + k));
  eq(rec.title, '背单词', '任务内容（title）');
  eq(rec.goalTitle, '考研英语', '所属目标（goalTitle）');
  eq(rec.src, 'manual', '完成来源（src = 手工勾）');
  assert(/^\d{2}:\d{2}$/.test(rec.atText), '完成时间是给人看的 HH:MM（' + rec.atText + '）');
  assert(rec.at > 0 && Math.abs(rec.at - Date.now()) < DAY, '完成时刻 at 是毫秒时间戳');
  eq(rec.harvest, null, '还没填额外收获时 harvest 是 null');

  // 同一天同一任务只留一条，且保留首次完成时间
  const firstAt = rec.at;
  pw.setTaskStatus(g.id, t1.id, 'done');
  eq(pw.ledgerList(T0).length, 1, '重复勾完成不堆第二条');
  eq(pw.ledgerList(T0)[0].at, firstAt, '保留首次完成时间（不是最后一次）');
}

/* ================= 2. 三条完成路径都进台账 ================= */
console.log('');
console.log('== 2. 三条完成路径都收敛到同一个出口 ==');
{
  // 路径 A：手工勾完成
  const ga = fresh();
  pw.setTaskStatus(ga.id, ga.tasks[0].id, 'done');
  const a = pw.ledgerList(T0)[0];
  assert(!!a, '手工勾完成 → 台账有记录');
  eq(a && a.src, 'manual', '  来源 = manual');

  // 路径 B：专注跑满自动完成
  const gb = fresh([{ title: '背单词', day: 1, pomos: 2 }]);
  pw.addPomoToTask(gb.id, gb.tasks[0].id);
  assert(gb.tasks[0].donePomos === 1 && gb.tasks[0].status === 'todo', '  第 1 段专注：还没做满');
  pw.addPomoToTask(gb.id, gb.tasks[0].id);
  const b = pw.ledgerList(T0)[0];
  assert(!!b, '专注跑满 → 台账有记录');
  eq(b && b.src, 'pomo', '  来源 = pomo');

  // 路径 C：收工填报 / 对话补记
  const gc = fresh([{ title: '背单词', day: 1, pomos: 2 }]);
  pw.creditPomo(gc.id, gc.tasks[0].id, 2, { src: 'log' });
  const c = pw.ledgerList(T0)[0];
  assert(!!c, '收工补记 → 台账有记录');
  eq(c && c.src, 'log', '  来源 = log');
}

{
  // 静态：置完成只能有一个出口。多一个直接改 status 的地方，台账就会漏
  const src = R('utils/pwstore.js');
  const hits = src.match(/status\s*=\s*'done'/g) || [];
  eq(hits.length, 1, "pwstore 里 `status = 'done'` 只出现 1 次（唯一出口）");
  const body = fnBody(src, 'markTaskDone');
  assert(body.length > 0, '能切到 markTaskDone() 的函数体');
  assert(/status\s*=\s*'done'/.test(body), "那唯一一处就在 markTaskDone 里");
  assert(/ledgerAdd\(/.test(body), 'markTaskDone 会记台账（状态和台账同时成立）');
  assert(/const first = t\.status !== 'done'/.test(body), '只有第一次置完成才记（重复调用不堆）');
  // 三个入口确实都调了它
  ['setTaskStatus', 'addPomoToTask', 'creditPomo'].forEach(name => {
    const b = fnBody(src, name);
    assert(/markTaskDone\(/.test(b), name + '() 走 markTaskDone（不是自己改状态）');
  });
}

/* ================= 3. 「全部完成」四个条件缺一不可 ================= */
console.log('');
console.log('== 3. 「今天全部完成」四个条件缺一不可 ==');
{
  const g = fresh();
  assert(schedule.rowsOf(T0).length === 2, '今天有安排（前置：rowsOf(今天) 非空）');
  assert(!harvest.allDoneOn(T0), '有 todo → 不算全部完成');

  // 条件② 还有待办
  pw.setTaskStatus(g.id, g.tasks[0].id, 'done');
  assert(!harvest.allDoneOn(T0), '只做完一半 → 不算');

  // 四个条件都满足
  pw.setTaskStatus(g.id, g.tasks[1].id, 'done');
  assert(harvest.allDoneOn(T0), '全做完 + 台账非空 + 无欠账 → 全部完成');

  // 条件① 今天本来就没安排
  const g2 = fresh([{ title: '第 5 天的事', day: 5, pomos: 1 }]);
  assert(schedule.rowsOf(T0).length === 0, '（造一个今天没安排的目标）');
  pw.creditPomo(g2.id, g2.tasks[0].id, 1, { src: 'log' });
  assert(pw.ledgerList(T0).length === 1, '  台账里确实有一条（提前做完了）');
  assert(!harvest.allDoneOn(T0), '今天没安排 → 不算全部完成（没东西可"全做完"）');

  // 条件③ 有历史欠账
  const g3 = fresh();
  allDone(g3);
  assert(harvest.allDoneOn(T0), '（先造出"确实全做完了"）');
  const old = pw.addGoal({ title: '旧目标', deadline: pw.addDays(T0, 10), dailyMin: 60 },
    { tasks: [{ title: '欠着的', day: 1, pomos: 1 }] });
  backdate(pw.goalOf(old.id), 3);
  assert(pw.todayQueue(30).filter(q => q.overdue).length === 1, '  造出一条欠账');
  assert(!harvest.allDoneOn(T0), '有欠账 → 不算（欠账走"跨天兜底"那条线，两条线不重合）');

  // 条件④ 台账空（任务都显示完成，但一条台账都没有 —— 老数据 / 别处改的状态）
  const g4 = fresh();
  g4.tasks.forEach(t => { t.status = 'done'; });
  pw.flush();
  assert(schedule.rowsOf(T0).filter(r => r.status === 'todo').length === 0, '（造出"没有待办"）');
  assert(pw.ledgerList(T0).length === 0, '  台账是空的');
  assert(!harvest.allDoneOn(T0), '台账空 → 不算（否则静止状态每天都被判"全做完"、天天重排）');
}

/* ================= 4. 跨天兜底的触发条件 ================= */
console.log('');
console.log('== 4. 跨天兜底（过了 00:00 还有没做完的）==');
{
  const g = fresh([{ title: '昨天的任务', day: 1, pomos: 1 }, { title: '今天的任务', day: 2, pomos: 1 }]);
  backdate(g, 1);                                     // 目标从昨天开始 → 第 1 天 = 昨天
  const lb = harvest.leftBehind();
  eq(lb.date, pw.addDays(T0, -1), 'leftBehind 找到昨天');
  assert(lb.found && lb.todo.length === 1, '昨天有 1 项没做完 → found');

  pw.setTaskStatus(g.id, g.tasks[0].id, 'done');
  const lb2 = harvest.leftBehind();
  assert(!lb2.found, '昨天做完了 → 不触发兜底');
  eq(lb2.date, pw.addDays(T0, -1), '  （仍然报出"查到哪天"，便于排查）');

  // 回溯上限 3 天：一周没开 App 不该在打开那一刻连补 7 次重排
  const g2 = fresh([{ title: '很久以前的', day: 1, pomos: 1 }]);
  backdate(g2, 10);
  const lb3 = harvest.leftBehind();
  assert(!lb3.found && lb3.date === '', '回溯只到 3 天（更早的欠账不补，date 为空）');
  const b = fnBody(R('utils/harvest.js'), 'leftBehind');
  assert(/k <= 3/.test(b), 'leftBehind 的回溯上限写死 3 天');
}

/* ================= 5. 自动重排只落地可逆动作 ================= */
console.log('');
console.log('== 5. 自动重排只落地可逆动作（砍任务 / 顺延必须等人点头）==');
{
  const g = fresh([{ title: '背单词', day: 1, pomos: 4 }, { title: '做阅读', day: 2, pomos: 3 }]);
  const t1 = g.tasks[0], t2 = g.tasks[1];
  const deadline0 = g.deadline;
  nextOps = [
    { op: 'move', taskId: t1.id, day: 3, reason: '挪后一点' },
    { op: 'resize', taskId: t1.id, pomos: 2, reason: '减量' },
    { op: 'drop', taskId: t2.id, reason: '太难了' },
    { op: 'defer', days: 7, reason: '来不及' },
    { op: 'note', text: '建议晚上做' }
  ];
  const r = harvest.applyOps(g, nextOps, true);
  eq(r.applied, 2, '自动模式落地 2 条（move + resize）');
  eq(r.pending.length, 2, '砍任务与顺延各进 1 条 pending');
  assert(r.pending.every(p => p.op === 'drop' || p.op === 'defer'), '进 pending 的只有 drop / defer');
  eq(t1.day, 3, 'move 真落地了（改期）');
  eq(t1.pomos, 2, 'resize 真落地了（改量）');
  eq(t2.status, 'todo', 'drop **没有**落地 —— 任务还在（不许悄悄删）');
  eq(g.deadline, deadline0, 'defer **没有**落地 —— 截止日没变');
  assert(/note/.test(JSON.stringify(r.pending)) === false, 'note 不进 pending（只是建议，不落库）');
  // ⚠️ 光"回给调用方"不够：队列（pendingList）负责去重与出队，不同源就会每次进首页重复问同一条
  eq(harvest.pendingList().length, 2, 'pending 当时就落进队列了（不只是回给调用方）');

  // 用户点头之后才真做
  const r2 = harvest.applyOps(g, [{ op: 'drop', taskId: t2.id }, { op: 'defer', days: 7 }], false);
  eq(r2.applied, 2, '确认模式：drop + defer 都落地');
  eq(t2.status, 'dropped', '  任务真被砍了');
  eq(g.deadline, pw.addDays(deadline0, 7), '  截止日真顺延了 7 天');

  // 数值夹取：模型给离谱值也不能把计划搞坏
  const g3 = fresh([{ title: 'A', day: 1, pomos: 3 }]);
  harvest.applyOps(g3, [{ op: 'move', taskId: g3.tasks[0].id, day: 999 },
                        { op: 'resize', taskId: g3.tasks[0].id, pomos: -5 }], true);
  assert(g3.tasks[0].day <= 15 && g3.tasks[0].day >= 1, 'move 的 day 夹在 [1, 期限内]（实际 ' + g3.tasks[0].day + '）');
  assert(g3.tasks[0].pomos >= 1, 'resize 的 pomos 至少 1（实际 ' + g3.tasks[0].pomos + '）');
  const g4 = fresh([{ title: 'A', day: 1, pomos: 1 }]);
  harvest.applyOps(g4, [{ op: 'defer', days: 500 }], false);
  eq(g4.deferred, 90, 'defer 单次夹到 90 天');
  harvest.applyOps(g4, [{ op: 'defer', days: 5 }], false);
  eq(g4.deferred, 90, '累计顺延封顶 90 天（再多就是换目标不是调整计划）');
}

/* ================= 6. 一天只自动重排一次 ================= */
console.log('');
console.log('== 6. 一天只自动重排一次（别一晚上烧几十次模型）==');
{
  const g = fresh([{ title: 'A', day: 1, pomos: 2 }, { title: 'B', day: 2, pomos: 2 }, { title: 'C', day: 3, pomos: 2 }]);
  enoughData();
  doneToday(g);
  nextOps = [{ op: 'move', taskId: g.tasks[1].id, day: 4, reason: '往后挪' }];
  const c0 = calls.length;
  const r1 = await harvest.autoReplan();
  assert(!r1.skipped, '第一次：真跑了' + (r1.skipped ? '（却是 ' + r1.skipped + '）' : ''));
  assert(calls.length > c0, '  确实调了模型');
  const r2 = await harvest.autoReplan();
  eq(r2.skipped, 'already-today', '第二次：跳过（今天已经排过）');
  eq(calls.length, c0 + 1, '  没有再调模型');
  const r3 = await harvest.autoReplan({ force: true });
  assert(!r3.skipped, 'force（设置页手动触发）可以再跑');

  // 兜底那条线：首次启动不跑（刚装 App 没有"昨天"，排一份还没开始的计划没意义）
  pw.reset();
  const g2 = fresh();
  enoughData();
  backdate(g2, 1);
  nextOps = [{ op: 'move', taskId: g2.tasks[0].id, day: 2, reason: '顺延' }];
  const s1 = await harvest.sweep();
  eq(s1.skipped, 'first-run', '首次启动：不跑兜底重排');
  pw.setReplan({ lastSweepDate: pw.addDays(T0, -1) });
  const s2 = await harvest.sweep();
  assert(!s2.skipped, '有"昨天"之后：真跑了');
  const s3 = await harvest.sweep();
  eq(s3.skipped, 'already-today', '再跑：跳过（一天一次）');
}

/* ================= 7. AI 挂了也要排 ================= */
console.log('');
console.log('== 7. AI 不可用也要重排（localRoll 兜底）==');
{
  const g = fresh([{ title: 'A', day: 1, pomos: 2 }, { title: 'B', day: 2, pomos: 2 },
                   { title: 'C', day: 3, pomos: 2 }]);
  enoughData();
  doneToday(g);
  aiOn = false;                                        // 总开关关了
  const r = await harvest.autoReplan();
  eq(r.src, 'local', 'AI 关掉 → 走本地兜底' + (r.skipped ? '（却是 ' + r.skipped + '）' : ''));
  assert(r.applied > 0, '  仍然改了 ' + r.applied + ' 项（不是"今天就不排了"）');

  // 模型抽风（抛异常）同理
  pw.reset();
  const g2 = fresh([{ title: 'A', day: 1, pomos: 2 }, { title: 'B', day: 2, pomos: 2 }]);
  enoughData();
  doneToday(g2);
  aiOn = true; aiThrows = true;
  const r2 = await harvest.autoReplan();
  eq(r2.src, 'ai-error', '模型报错 → 走本地兜底' + (r2.skipped ? '（却是 ' + r2.skipped + '）' : ''));
  assert(r2.applied > 0, '  仍然改了 ' + r2.applied + ' 项');
  assert(r2.summary.indexOf('没连上') > 0, '  给用户的说法是"没连上"，不是"它觉得不用改"（不瞒报故障）');

  // 模型跑通了但一条建议都没给（ops 空）也要本地铺一遍
  pw.reset();
  const g3 = fresh([{ title: 'A', day: 1, pomos: 2 }, { title: 'B', day: 2, pomos: 2 }]);
  enoughData();
  doneToday(g3);
  aiThrows = false; nextOps = [];
  const r3 = await harvest.autoReplan();
  eq(r3.src, 'ai-empty', 'AI 没给建议 → 本地铺开' + (r3.skipped ? '（却是 ' + r3.skipped + '）' : ''));
  assert(r3.applied > 0, '  仍然改了 ' + r3.applied + ' 项');

  // localRoll 本身：保留原顺序、不凭空改量
  pw.reset();
  const g4 = fresh([{ title: 'A', day: 1, pomos: 2 }, { title: 'B', day: 1, pomos: 2 },
                    { title: 'C', day: 1, pomos: 2 }]);
  backdate(g4, 2);
  g4.tasks[0].status = 'done';                          // 只剩 B / C
  const order0 = g4.tasks.filter(t => t.status === 'todo').map(t => t.title).join(',');
  const n = harvest.localRoll(pw.goalOf(g4.id));
  assert(n > 0, 'localRoll 改了 ' + n + ' 项');
  const order1 = g4.tasks.filter(t => t.status === 'todo').map(t => t.title).join(',');
  eq(order1, order0, '  原顺序保留（本地规则不判断谁更重要）');
  eq(g4.tasks[1].pomos, 2, '  不动专注量（只重排日子）');
}

/* ================= 8. 信息不足先问本人（需求 6） ================= */
console.log('');
console.log('== 8. 信息不足 → 先问本人，不拿半截数据硬排 ==');
{
  // ① 从没跑出速度基线
  const g = fresh();
  eq(harvest.needsAsk(g).why, 'completed-pomo-lt-3', '完成专注 < 3 → 要问');
  assert(harvest.needsAsk(g).ask.length > 10, '  给了具体的问题（不是空的"你说呢"）');

  // ② 近 7 天一分没学
  const st = pw.get();
  for (let i = 0; i < 4; i++) st.sessions.push({ id: 'x' + i, min: 25, done: true });
  eq(harvest.needsAsk(g).why, 'no-focus-in-7d', '近 7 天 0 分钟 → 要问');

  // ③ 有欠账但没人说过原因
  //    ⚠️ 造"今天一分没学、但近 7 天有学"：前者让 shortStreak ≥ 1、后者让②不先命中。
  //    写成"今天有收工记录且少做了"是自相矛盾的 —— 有 log 就满足 !hasLog 不成立（已踩）
  enoughData({ todayMin: 0, yesterdayMin: 50 });
  eq(harvest.needsAsk(g).why, 'short-without-reason', '连续没做完 + 没说过原因 → 要问');

  // 有额外收获 = 说过原因了 → 不问
  pw.setTaskStatus(g.id, g.tasks[0].id, 'done');
  pw.setHarvest(T0, g.tasks[0].id, { summary: '晚上被占掉了' });
  assert(!harvest.needsAsk(g).need, '有额外收获（说过原因）→ 不问了');

  // 问来的意见会拦住重排，直到有 note
  pw.reset();
  const g2 = fresh([{ title: 'A', day: 1, pomos: 2 }, { title: 'B', day: 2, pomos: 2 }]);
  doneToday(g2);
  const r = await harvest.autoReplan();
  assert(r.ok === false && !!r.ask,
    '信息不足时**不硬排**，把问题抛给调用方' + (r.skipped ? '（却是 ' + r.skipped + '）' : ''));
  eq(calls.length, 0, '  没有去调模型');
  harvest.saveNote('每天最多 2 段专注');
  eq(harvest.lastNote(), '每天最多 2 段专注', '记下本人最新意见');
  harvest.saveNote('   ');
  eq(harvest.lastNote(), '每天最多 2 段专注', '空意见不覆盖（手滑清空不会丢）');
  const r2 = await harvest.autoReplan({ force: true });
  assert(calls.length > 0, '有了意见才去排');
  assert(calls[calls.length - 1].extra.indexOf('每天最多 2 段专注') >= 0,
    '意见进了模型上下文');
  assert(calls[calls.length - 1].extra.indexOf('【本人最新意见（最高优先级）】') >= 0,
    '  且标成最高优先级');
}

/* ================= 9. 闭环：结果记回来，下次别横跳 ================= */
console.log('');
console.log('== 9. 重排结果记回来（闭环，防来回横跳）==');
{
  const g = fresh([{ title: 'A', day: 1, pomos: 2 }, { title: 'B', day: 2, pomos: 2 }]);
  enoughData();
  doneToday(g);
  nextSummary = '你连着两天没做完，后面的量往下压一档';
  nextOps = [{ op: 'resize', taskId: g.tasks[1].id, pomos: 1, reason: '减量' }];
  await harvest.autoReplan();
  const last = pw.replanState().last;
  assert(!!last && last.applied === 1, '记下了这次重排的结果（applied=1）');
  eq(last.summary, nextSummary, '  AI 的判断原文存下来了');
  assert(last.kind === 'alldone', '  标了是哪条线（alldone / sweep）');
  const blk = harvest.lastBlock();
  assert(blk.indexOf('上次自动重排') >= 0, 'lastBlock 会讲"上次做了什么"');
  assert(blk.indexOf('不要重复已经做过的调整') >= 0, '  并明确要求别改回去');

  // 第二次重排时这段会喂进去
  calls = [];
  await harvest.autoReplan({ force: true });
  assert(calls[calls.length - 1].extra.indexOf('上次自动重排') >= 0,
    '下一次重排读到了上次的结果（防来回横跳）');
}

/* ================= 10. 额外收获：AI 总结 + 时间 + 兜底 ================= */
console.log('');
console.log('== 10. 额外收获（AI 总结 + 带时间 + 存不下也要存）==');
{
  const g = fresh();
  pw.setTaskStatus(g.id, g.tasks[0].id, 'done');
  calls = [];
  const r = await harvest.saveHarvest(T0, g.tasks[0].id, ['今天状态好', '阅读比想象中快']);
  assert(r.ok && r.src === 'ai', 'AI 可用 → 走 AI 总结');
  eq(calls[0].fn, 'summarizeHarvest', '  调的是 summarizeHarvest');
  eq(calls[0].ctx.texts.length, 2, '  多轮说的几句话都传进去了');
  eq(calls[0].ctx.taskTitle, '背单词', '  带上了"刚完成的是哪项任务"');
  const h = pw.ledgerList(T0)[0].harvest;
  assert(!!h && !!h.summary, '总结落到台账上');
  assert(/^\d{2}:\d{2}$/.test(h.atText), '  带时间（' + h.atText + '）');
  eq(h.date, T0, '  带日期');
  assert(h.raw.indexOf('今天状态好') >= 0, '  原话也留着（总结丢了还能回看）');
  assert(Array.isArray(h.tags) && h.tags.length <= 3, '  标签最多 3 个');

  // AI 挂了 → 原话直存（不因为连不上网就丢掉用户说的话）
  aiThrows = true;
  const r2 = await harvest.saveHarvest(T0, g.tasks[0].id, ['这次卡在长难句']);
  eq(r2.src, 'local', 'AI 挂了 → 本地兜底');
  const h2 = pw.ledgerList(T0)[0].harvest;
  assert(h2.summary.indexOf('长难句') >= 0, '  原话没丢');
  assert(h2.summary.indexOf(T0) >= 0, '  兜底那句也带日期');

  // 没填内容 / 任务不在台账里 → 不写脏数据
  aiThrows = false;
  eq((await harvest.saveHarvest(T0, g.tasks[0].id, ['', '  '])).ok, false, '空内容不存');
  eq((await harvest.saveHarvest(T0, '不存在的任务', ['x'])).ok, false, '任务不在台账里 → 不存');

  // 历史反馈给 AI 看
  eq(harvest.harvestCount(T0), 1, 'harvestCount 统计"填过额外收获的项数"');
  assert(harvest.historyBlock(14).indexOf('本人过去 14 天的反馈') >= 0, 'historyBlock 给模型看历史反馈');
  assert(harvest.summaryFor(T0).indexOf('今日完成台账') >= 0, 'summaryFor 给模型看"今天做了什么"');
}

/* ================= 11. 待确认队列 ================= */
console.log('');
console.log('== 11. 待确认队列（砍任务 / 顺延期限）==');
{
  // 走真链路：自动重排跑完 → 两条大动作进队列（不是直接调 applyOps）
  const g = fresh([{ title: 'A', day: 1, pomos: 1 }, { title: 'B', day: 2, pomos: 1 }, { title: 'C', day: 3, pomos: 1 }]);
  enoughData();
  doneToday(g);
  nextOps = [{ op: 'drop', taskId: g.tasks[1].id, reason: '太难' },
             { op: 'defer', days: 5, reason: '来不及' }];
  await harvest.autoReplan();
  eq(g.tasks[1].status, 'todo', '  自动重排没有真砍（等人点头）');
  const list = harvest.pendingList();
  eq(list.length, 2, '两条待确认');
  assert(harvest.pendingText(list[0]).indexOf('砍掉「B」') === 0, '砍任务问法：砍掉「B」？+ 理由');
  assert(harvest.pendingText(list[1]).indexOf('往后 5 天') > 0, '顺延问法：往后 N 天？+ 理由');

  const r = harvest.resolvePending(0, true);
  assert(r.ok && r.msg.indexOf('已砍掉') === 0, '点头 → 真砍了（' + r.msg + '）');
  eq(pw.goalOf(g.id).tasks[1].status, 'dropped', '  状态真的改了');
  eq(harvest.pendingList().length, 1, '  出队了');

  const r2 = harvest.resolvePending(0, false);
  eq(r2.msg, '好，先不动', '摇头 → 不动');
  eq(harvest.pendingList().length, 0, '  也得出队（否则每次进首页都弹同一条）');
  eq(harvest.resolvePending(0, true).ok, false, '重复处理同一条 → 拒绝（不会误伤下一条）');

  // 目标已经被删了也不能炸
  const a2 = harvest.applyOps(g, [{ op: 'drop', taskId: g.tasks[2].id, reason: '太难' }], true);
  const gone = Object.assign({}, a2.pending[0], { goalId: '不存在的目标' });
  pw.setReplan({ pending: [gone] });
  const r3 = harvest.resolvePending(0, true);
  assert(r3.ok && r3.msg.indexOf('已经不在了') > 0, '目标没了 → 出队并说明，不崩（' + r3.msg + '）');
  eq(harvest.pendingList().length, 0, '  也不留在队列里');
}

/* ================= 12. UI 接线（静态） ================= */
console.log('');
console.log('== 12. 完成弹窗与额外收获页的接线 ==');
{
  const home = R('pages/home/home.vue');
  const cal = R('pkgPlan/pages/calendar/calendar.vue');
  const dlg = R('components/task-done-dialog/task-done-dialog.vue');
  const sl = R('components/schedule-list/schedule-list.vue');
  const hv = R('pkgPlan/pages/harvest/harvest.vue');
  // ⚠️ HBuilderX 会往 pages.json 里写 JSON5 注释，而且有行内注释（"key" : { //xxx）
  //    —— 只剥行首的那种会在 parse 时炸（已踩）
  const pages = JSON.parse(R('pages.json')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1'));

  assert(/恭喜你完成任务/.test(dlg), '弹窗文案是「恭喜你完成任务」');
  assert(/cancel-text="取消"/.test(dlg) || /cancelText:\s*'取消'/.test(dlg), '底部有「取消」');
  assert(/confirm-text="额外收获"/.test(dlg) || /confirmText:\s*'额外收获'/.test(dlg), '底部有「额外收获」');
  assert(/app-dialog/.test(dlg), '复用 app-dialog（页面不许自己写弹窗）');
  assert(/pages\/harvest\/harvest/.test(dlg), '「额外收获」跳 harvest 页');

  // 系统返回键要先收弹窗
  ['home', 'calendar'].forEach((n, i) => {
    const src = i ? cal : home;
    const b = fnBody(src, 'onBackPress');
    assert(b.length > 0, n + '.vue 有 onBackPress');
    assert(/doneDlg/.test(b) && /close\(\)/.test(b), '  ' + n + '：返回键先收完成弹窗');
    assert(/<task-done-dialog/.test(src), '  ' + n + '：挂了 task-done-dialog');
  });

  // 勾选完成要抛出来（取消完成不抛 —— 那是撤销，不是完成）
  // ⚠️ 匹配 `if (r.done)` 这条**语句**而不是 `r.done` 这个词：toggle() 上面那行注释里
  //    就写着"取消完成（r.done=false）不抛"，只测词的话注释会替坏代码挡住断言（已踩）
  const tb = fnBody(sl, 'toggle');
  assert(/if \(r\.done\)/.test(tb) && /\$emit\('done'/.test(tb), 'schedule-list 只在"勾完成"时抛 done');
  assert(/@done="onTaskDone"/.test(cal), '日历页接了 done 事件');

  // harvest 页注册在分包里
  const pkg = pages.subPackages.filter(p => p.root === 'pkgPlan')[0];
  assert(pkg.pages.some(p => p.path === 'pages/harvest/harvest'), 'pages.json 注册了 harvest 页');
  assert(/harvest\.saveHarvest\(/.test(hv), 'harvest 页存额外收获走 harvest.saveHarvest');
  assert(/harvest\.listOf\(|harvest\.summaryFor\(/.test(hv), 'harvest 页读的是当天台账（知道"刚完成的是哪项"）');
  // ⚠️ 开场白必须本地拼：没配 AI 也要能开口，不然点了「额外收获」进来是个空页面
  const openBody = fnBody(hv, 'start');
  assert(openBody.length > 0, '能切到 harvest.vue 的 start()');
  assert(/await /.test(openBody) === false, '开场白本地拼（不先去问模型 —— 没配 AI 也要能开口）');
  assert(/atText/.test(openBody) && /title/.test(openBody),
    '开场那句里带着"刚做完的是哪一项、几点做的"（不是一句空的"说说你的收获"）');
  assert(/catch/.test(hv), 'AI 总结失败有兜底（不能把页面卡死）');
}

/* ================= 13. AI 分项开关 ================= */
console.log('');
console.log('== 13. AI 分项开关（额外收获总结这一项可关）==');
{
  const gate = R('services/ai-gate.js');
  assert(/key:\s*'harvest'/.test(gate), 'ai-gate 登记了 harvest 项');
  const hsrc = R('utils/harvest.js');
  assert(/aiReady\('harvest'\)/.test(hsrc), '总结额外收获前先过这道闸');
  assert(/featureOn\(key\)/.test(fnBody(hsrc, 'aiReady')), 'aiReady 同时看总开关与分项开关');
}

} catch (e) {
  bad('断言执行过程中崩了：' + (e && e.message ? e.message : e));
}

console.log('');
console.log(fail === 0 ? '任务完成反馈与动态重排校验全部通过' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);

})();

// _tools/check-plan-agent.js - AI 目标规划的服务端纪律校验（services/plan-agent.js）
// 运行：node _tools/check-plan-agent.js
//
// 2026-10-14 真机反馈三件事，这里守的是前两件的服务端半边：
//  ① 追问必须问出"有没有报班 / 补习"这类固定安排（还能发课表截图）；
//  ② 规划以「天」为单位（早/中/晚只是天内时段），且必须铺满用户设的整个时间范围
//     —— 100 天的目标排到 80 天就停 = 少规划，normalizePlan 里用等比拉伸确定性兜底；
//  ③ 页面半边（预览折叠 / 提醒即时生效）也在这份里一起守（wizard + goal-detail 源码）。
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

/* ---------------- mock（与 check-timeslot 同一套依赖袋） ---------------- */
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {}
};

const settings = load('utils/settings.js');
settings.init();
const timeslot = load('utils/timeslot.js', { settings });
const pw = load('utils/pwstore.js');
const dailylog = load('utils/dailylog.js', { pw });
const pacing = load('utils/pacing.js', { pw, dailylog });
const holiday = load('utils/holiday.js');
const agent = load('services/plan-agent.js', {
  chatCompletion: async () => ({ content: '{}' }),
  LLMError: class LLMError extends Error {},
  isAIEnabled: () => true,
  holiday, dailylog, pacing, timeslot
});

const today = pw.today();
const inDays = (n) => pw.addDays(today, n);

/* ---------- 1. 铺满全程：提前收工的排期被等比拉伸 ---------- */
console.log('== 1. 排期必须铺满整个时间范围（等比拉伸兜底） ==');
const raw = {
  strategy: 's', risks: [],
  milestones: [{ title: '阶段一', days: 10 }, { title: '阶段二', days: 20 }],
  tasks: [
    { title: '摸底', ms: 1, day: 1, pomos: 2 },
    { title: '推进', ms: 2, day: 5, pomos: 3 },
    { title: '冲刺', ms: 2, day: 10, pomos: 2 }
  ]
};
const short = agent.normalizePlan(JSON.parse(JSON.stringify(raw)), { deadline: inDays(30), slotOn: false });
// 30 天目标只排到第 10 天 → ×3 拉伸：1→3、5→15、10→30
assert(short.tasks[0].day >= 2 && short.tasks[0].day <= 4, '第 1 天的任务拉伸到 3 天附近（实际 ' + short.tasks[0].day + '）');
assert(short.tasks[1].day >= 14 && short.tasks[1].day <= 16, '第 5 天的任务拉伸到 15 天附近（实际 ' + short.tasks[1].day + '）');
assert(short.tasks[2].day >= 28, '最后一条要铺到截止日附近（实际第 ' + short.tasks[2].day + ' 天）');
assert(short.risks.some(r => /拉伸/.test(r)), '拉伸要写进 risks，让用户知道排期被铺满了');
const days1 = short.tasks.map(t => t.day);
assert(days1.every((d, i) => i === 0 || d >= days1[i - 1]), '拉伸后 day 仍按时间有序');
// 拉伸是乘法，末尾那条必须夹回末天 —— 越界的 day 会让最后几天没东西做，等于白拉伸
assert(days1.every(d => d >= 1 && d <= short.totalDays),
  '拉伸后 day 不越界（1 ~ ' + short.totalDays + '）');
// 里程碑没被动（拉伸只动 day）
eq(short.milestones.map(m => m.days), [10, 20], '里程碑的天数跨度不被拉伸改掉');

// 已经排满 → 不动
const raw2 = {
  strategy: 's', risks: [],
  milestones: [{ title: '全程', days: 29 }],
  tasks: [
    { title: '起步', ms: 1, day: 1, pomos: 2 },
    { title: '中段', ms: 1, day: 15, pomos: 3 },
    { title: '收尾', ms: 1, day: 29, pomos: 2 }
  ]
};
const full = agent.normalizePlan(JSON.parse(JSON.stringify(raw2)), { deadline: inDays(30), slotOn: false });
eq(full.tasks.map(t => t.day), [1, 15, 29], '排满 30 天里的 29 天（差 1 天 ≤ 缓冲）就不拉伸');
eq(full.risks.length, 0, '没拉伸就不添风险提示');

// 长目标：100 天只给 60 天 → 拉到 100
const raw3 = {
  strategy: 's', risks: [],
  milestones: [{ title: '前半', days: 30 }, { title: '后半', days: 30 }],
  tasks: [{ title: 'a', ms: 1, day: 1, pomos: 2 }, { title: 'b', ms: 2, day: 60, pomos: 2 }]
};
const long = agent.normalizePlan(JSON.parse(JSON.stringify(raw3)), { deadline: inDays(100), slotOn: false });
assert(long.tasks[1].day >= 96, '100 天目标排到 60 天 → 拉到截止附近（实际第 ' + long.tasks[1].day + ' 天）');

// 同一套兜底也管着没接 AI 时的本地模板（localPlan 绕开了 normalizePlan）
[30, 100, 137, 365].forEach(n => {
  const lp = agent.localPlan({ title: 't', deadline: inDays(n), dailyMin: 120 });
  let mx = 0;
  lp.tasks.forEach(t => { if (t.day > mx) mx = t.day; });
  assert(mx >= lp.totalDays - 2,
    '本地兜底 ' + n + ' 天也要排到截止日（最远第 ' + mx + ' / ' + lp.totalDays + ' 天）');
});

/* ---------- 2. 提示词：天为单位 + 铺满全程 + 任务数随长度 ---------- */
console.log('== 2. planSystemPrompt 的硬约束 ==');
const src = R('services/plan-agent.js');
// 剥注释再断言（第 12 条硬约束：注释里也写过这些词，不剥会假绿）
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert(/任务以「天」为单位/.test(code), '提示词写明任务以「天」为单位');
assert(/不是独立的日程单位/.test(code), '提示词写明早/中/晚不是日程单位');
assert(/不许提前收工/.test(code), '提示词写明不许提前收工');
assert(!/任务总数 6-30/.test(code), '旧的「任务总数 6-30」上限已删（长目标排不满的根源）');
assert(/taskCap\s*=\s*Math\.min\(150/.test(code), '任务数上限随天数缩放（上限 150）');
assert(/maxDay >= totalDays - 2/.test(code), '拉伸判据：maxDay 距截止留 2 天缓冲');
assert(/normalizePlan[\s\S]*?stretchToCover\(tasks, totalDays\)/.test(code), 'AI 结果走的是同一份拉伸函数');
assert(/localPlan[\s\S]*?stretchToCover\(tasks, totalDays\)/.test(code), '本地模板也走同一份拉伸函数');
// 追问必问"报班 / 补习"，并提示可以发课表截图
assert(/固定安排是必问项/.test(code), '追问规则里有"固定安排是必问项"');
assert(/报班\s*\/\s*补习/.test(code), '必问项点名报班 / 补习');
assert(/发截图/.test(code), '追问里提示用户可以发课表截图');

/* ---------- 3. 预览折叠（wizard.vue） ---------- */
console.log('== 3. 结果预览可折叠（wizard.vue） ==');
const wiz = R('pkgPlan/pages/wizard/wizard.vue');
assert(/@tap="toggleFold\(gi\)"/.test(wiz), '阶段卡头部可以点（toggleFold）');
assert(/v-if="!folded\(gi\)"/.test(wiz), '折叠真的藏起任务列表（v-if，不是只变样式）');
assert(/folded\(gi\)\s*\?\s*'展开'\s*:\s*'收起'/.test(wiz), '头部有展开 / 收起的字样');
assert(/gi === 0 \? !!this\.fold\[gi\] : this\.fold\[gi\] !== false/.test(wiz),
  '默认只展开第一个阶段（fold 不预填，靠缺省值）');
assert(/this\.fold = \{\}/.test(wiz), '新一轮生成的计划要重置折叠状态');
assert(/group\.count .*group\.from .*group\.to|第 \{\{ group\.from \}\}-\{\{ group\.to \}\} 天/.test(wiz),
  '折叠头上能看到"几个任务 · 第几天到第几天"');

/* ---------- 4. 每日提醒即时生效（goal-detail.vue） ---------- */
console.log('== 4. 改提醒时间立刻重渲染（goal-detail.vue） ==');
const gd = R('pkgPlan/pages/goal-detail/goal-detail.vue');
assert(!/this\.g = pw\.goalOf\(this\.id\)\s*$/.test(gd.replace(/\r?\n[^\n]*/g, '\n')),
  'refresh 不再直接赋 goalOf 的同引用');
assert(/Object\.assign\(\{\}, g\)/.test(gd), 'refresh 里浅拷贝目标对象（同引用赋值 Vue 不重渲染）');
assert(/this\.g = g \? Object\.assign\(\{\}, g\) : null/.test(gd), '空目标也要落到 this.g（关掉后卡片随之消失）');

console.log('');
console.log(fail === 0 ? '全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);

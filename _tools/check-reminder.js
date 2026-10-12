// _tools/check-reminder.js - 每日提醒（目标规划里定时间）校验
// 运行：node _tools/check-reminder.js
//
// 守的是三件事：
//  1) 时间解析与"到点才提醒"的判据（早于设定时间不打扰、当天只提醒一次、太晚不打扰）
//  2) 提醒内容真的是"今天该做的那件事"（不是一句空的"该学习了"）
//  3) 三处入口都在：向导页设定、详情页可改、首页到点触发
//
// notify 用假的替身：这里是 node，没有真通知；替身只把"发了什么"记下来给我们断言。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
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

/* ---------------- mock ---------------- */
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {}
};

const pw = load('utils/pwstore.js');
// pacing 自己也 import 了 pwstore：依赖袋必须带上（load 是按标识符注入的，漏了就是
// 运行时 ReferenceError —— 而且这个错只在真调用 focusLen() 时才炸，静态看不出来）
const pacing = load('utils/pacing.js', { pw });
const sent = [];
const notify = {
  remind: (title, text, slot) => { sent.push({ title, text, slot }); return true; }
};
const reminder = load('utils/reminder.js', { pw, notify, pacing });

/** 今天这个时刻 */
function at(hh, mm) {
  const t = pw.today().split('-');
  return new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]), hh, mm);
}

/* ---------- 1. 时间解析 ---------- */
console.log('== 1. 提醒时间解析 ==');
eq(reminder.minutesOf('20:00'), 1200, "minutesOf('20:00')");
eq(reminder.minutesOf('07:30'), 450, "minutesOf('07:30')");
eq(reminder.minutesOf(''), null, '空串 = 不提醒');
eq(reminder.minutesOf('25:00'), null, '25 点不成立');
eq(reminder.minutesOf('9:5'), null, '分钟必须两位');
eq(reminder.minutesOf('abc'), null, '乱输不炸');
assert(reminder.valid('20:00') && !reminder.valid(''), 'valid() 只认 HH:mm');

/* ---------- 2. 到点才提醒 ---------- */
console.log('== 2. 到点才提醒，且一天只催一次 ==');
const g = pw.addGoal({ title: '考研英语', dailyMin: 60 }, {
  tasks: [{ title: '背单词', day: 1, pomos: 2 }]
});
reminder.setRemind(g.id, '20:00');
eq(pw.goalOf(g.id).remindAt, '20:00', '提醒时间落在目标上（跟着备份走）');
eq(reminder.labelOf(pw.goalOf(g.id)), '每天 20:00', '界面文案');
reminder.setRemind(g.id, '乱写');
eq(pw.goalOf(g.id).remindAt, '', '非法时间 = 关掉（不会存个解析不出来的值）');
reminder.setRemind(g.id, '20:00');

sent.length = 0;
eq(reminder.check({ now: at(19, 0) }), 0, '19:00 还没到点 → 不打扰');
eq(sent.length, 0, '没到点一条都不发');

eq(reminder.check({ now: at(20, 30) }), 1, '20:30 到点 → 提醒 1 个目标');
eq(sent.length, 1, '只发一条');
assert(/^该开始了：考研英语$/.test(sent[0].title), '通知标题带上目标名（' + sent[0].title + '）');
assert(/背单词/.test(sent[0].text) && /2 个番茄/.test(sent[0].text),
  '正文说清"今天做哪件事、几个番茄"（' + sent[0].text + '）');
assert(/分钟/.test(sent[0].text), '正文带上预计时长');

eq(reminder.check({ now: at(21, 0) }), 0, '同一天再查 → 不重复催');
eq(sent.length, 1, '没有多发');

// 太晚不打扰
const g2 = pw.addGoal({ title: '晚间的目标', dailyMin: 60 }, {
  tasks: [{ title: '夜读', day: 1, pomos: 1 }]
});
reminder.setRemind(g2.id, '20:00');
eq(reminder.check({ now: at(23, 30) }), 0, '23:30 太晚 → 今天不再打扰');
eq(sent.length, 1, '深夜没有弹出提醒');

// 没设提醒的目标不提醒
// （先把 g2 那条到点的消费掉，否则它会混进下一条断言里）
reminder.check({ now: at(22, 0) });
sent.length = 0;
pw.addGoal({ title: '没设提醒', dailyMin: 60 }, {
  tasks: [{ title: '随缘', day: 1, pomos: 1 }]
});
reminder.check({ now: at(22, 0) });
eq(sent.filter(s => s.title.indexOf('没设提醒') >= 0).length, 0, '没设提醒时间的目标不参与');

// 今天没有待办 → 不打扰（提醒"你今天没事"没有意义）
const g4 = pw.addGoal({ title: '今天没有安排', dailyMin: 60 }, {
  tasks: [{ title: '很久以后', day: 40, pomos: 1 }]
});
reminder.setRemind(g4.id, '08:00');
eq(reminder.check({ now: at(10, 0) }), 0, '今天没有待办 → 不提醒');
eq(reminder.countOn(), 3, 'countOn 只数"设了提醒"的目标（' + reminder.countOn() + '）');

/* ---------- 3. 三处入口 ---------- */
console.log('== 3. 入口：向导页设定 / 详情页可改 / 首页触发 ==');
const wiz = R('pkgPlan/pages/wizard/wizard.vue');
const det = R('pkgPlan/pages/goal-detail/goal-detail.vue');
const home = R('pages/home/home.vue');
[['向导页', wiz], ['目标详情页', det]].forEach(([name, src]) => {
  const tpl = src.slice(0, src.indexOf('\n<script')).replace(/<!--[\s\S]*?-->/g, '');
  assert(/每日提醒/.test(tpl), name + '有「每日提醒」卡片');
  assert(/@tap="pickRemind\((?:t|'')\)"/.test(tpl), name + '时间点可点选（含关掉）');
  assert(/remindTimes/.test(tpl), name + '列出可选时间点');
  assert(/utils\/reminder\.js/.test(src), name + '走 utils/reminder.js');
});
// 向导页：落地目标时把提醒时间写上去
const wizSc = wiz.slice(wiz.indexOf('\n<script'), wiz.indexOf('\n<style'));
assert(/reminder\.setRemind\(g\.id/.test(wizSc), '向导落地目标时写入提醒时间');
assert(/remindAt:\s*reminder\.DEFAULT/.test(wizSc), '默认给一个时间（默认关等于没做）');
// 详情页：改完立刻回写
const detSc = det.slice(det.indexOf('\n<script'), det.indexOf('\n<style'));
assert(/reminder\.setRemind\(this\.id/.test(detSc), '详情页改提醒会真的写回目标');
// 首页：到点触发（tick 与 onShow 各一次，进 App 能补上错过的那个点）
const homeSc = home.slice(home.indexOf('\n<script'), home.indexOf('\n<style'));
assert(/checkRemind\s*\(\)\s*\{[\s\S]{0,200}reminder\.check\(\)/.test(homeSc), '首页有到点检查');
assert(/this\.tick\(\)/.test(homeSc) && /checkRemind\(\)/.test(homeSc.slice(homeSc.indexOf('    tick() {'))),
  '每秒 tick 里带着提醒检查（内部按分钟节流）');
assert(/__remindMin\s*=\s*-1/.test(homeSc), '进 App 时强制补查一次（当天只补一次）');
assert(/if \(this\.locked\) return/.test(homeSc), '正在专注时不打扰（提醒的是"还没开始"）');

console.log(fail === 0 ? '\n每日提醒校验全部通过' : '\n失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);

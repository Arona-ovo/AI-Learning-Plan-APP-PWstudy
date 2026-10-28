// _tools/check-timeslot.js - 任务的时间维度（早 / 中 / 晚）校验
// 运行：node _tools/check-timeslot.js
//
// 守的是四件事：
//  1) 时段词汇只有一套（am/noon/pm），中文、英文、'20:00' 这种都能归到同一个段
//  2) 规划链路真的产出时段：AI 给的模型值要认，模型漏给的要轮转补，本地兜底也要有
//  3) **关掉开关是纯回退**：不再产出时段、不再追问、已落库的时段数据一个都不删，
//     提交（addGoal）与重排的字段不受影响
//  4) 时段到了要真发一条通知，且一个时段一天只催一次、该时段没事做就不打扰
//
// 发出去的通知用假替身接住：这里是 node，没有真通知。
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

/* ---------------- mock ---------------- */
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {}
};

const settings = load('utils/settings.js');
const timeslot = load('utils/timeslot.js', { settings });
const pw = load('utils/pwstore.js');
const dailylog = load('utils/dailylog.js', { pw });
const pacing = load('utils/pacing.js', { pw, dailylog });
const holiday = load('utils/holiday.js');
const sent = [];
const notify = {
  remind: (title, text, slot) => { sent.push({ kind: 'remind', title, text, slot }); return true; },
  slotNotify: (title, text, slot) => { sent.push({ kind: 'slot', title, text, slot }); return true; }
};
const reminder = load('utils/reminder.js', { pw, notify, pacing, timeslot });
const agent = load('services/plan-agent.js', {
  chatCompletion: async () => ({ content: '{}' }),
  LLMError: class LLMError extends Error {},
  isAIEnabled: () => true,
  holiday, dailylog, pacing, timeslot
});

/** 今天的某个时刻 */
function at(hh, mm) {
  const t = pw.today().split('-');
  return new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]), hh, mm);
}

/* ---------- 1. 时段词汇：只有一套说法 ---------- */
console.log('== 1. 时段归一化（中文 / 英文 / 时间点都归到 am|noon|pm） ==');
eq(timeslot.normalize('早上'), 'am', "normalize('早上')");
eq(timeslot.normalize('上午'), 'am', "normalize('上午')");
eq(timeslot.normalize('AM'), 'am', "normalize('AM')");
eq(timeslot.normalize('morning'), 'am', "normalize('morning')");
eq(timeslot.normalize('中午'), 'noon', "normalize('中午')");
eq(timeslot.normalize('下午'), 'noon', "normalize('下午')");
eq(timeslot.normalize('afternoon'), 'noon', "normalize('afternoon')");
eq(timeslot.normalize('晚上'), 'pm', "normalize('晚上')");
eq(timeslot.normalize('傍晚'), 'pm', "normalize('傍晚')");
eq(timeslot.normalize('pm'), 'pm', "normalize('pm')");
// 模型偶尔给时间点而不是时段代号
eq(timeslot.normalize('08:30'), 'am', "normalize('08:30')");
eq(timeslot.normalize('15:00'), 'noon', "normalize('15:00')");
eq(timeslot.normalize('20:00'), 'pm', "normalize('20:00')");
eq(timeslot.normalize(''), '', '空串不认');
eq(timeslot.normalize(null), '', 'null 不认');
eq(timeslot.normalize('随时'), '', '认不出来给空串（不猜）');
eq(timeslot.labelOf('pm'), '晚上', "labelOf('pm')");
eq(timeslot.labelOf(''), '', '没有时段就不显示文字（不显示 undefined）');
eq(timeslot.indexOf('am'), 0, "indexOf('am')");
eq(timeslot.indexOf('pm'), 2, "indexOf('pm')");
eq(timeslot.indexOf(''), 3, '没有时段排在最后');

/* ---------- 2. 时段起点与"现在该催哪一段" ---------- */
console.log('== 2. 时段起点与到点判定 ==');
eq(timeslot.startMinutesOf('am'), 8 * 60, '早上 08:00 起');
eq(timeslot.startMinutesOf('noon'), 13 * 60, '中午 13:00 起');
eq(timeslot.startMinutesOf('pm'), 19 * 60 + 30, '晚上 19:30 起');
eq(timeslot.keyNow(at(7, 0)), '', '早上 8 点前不催');
eq(timeslot.keyNow(at(8, 0)), 'am', '8:00 催早上');
eq(timeslot.keyNow(at(12, 59)), 'am', '12:59 还在早上这一段（补发口径）');
eq(timeslot.keyNow(at(13, 0)), 'noon', '13:00 催中午');
eq(timeslot.keyNow(at(19, 29)), 'noon', '19:29 还在中午这一段');
eq(timeslot.keyNow(at(19, 30)), 'pm', '19:30 催晚上');
eq(timeslot.keyNow(at(22, 59)), 'pm', '22:59 还在晚上这一段');
eq(timeslot.keyNow(at(23, 0)), '', '23 点后不再打扰');

/* ---------- 3. 开关：默认开，关掉是纯回退 ---------- */
console.log('== 3. 开关（settings.plan.slot / slotNotify） ==');
eq(timeslot.enabled(), true, '时段安排默认开');
eq(timeslot.notifyOn(), true, '时段提醒默认开');
eq(timeslot.setEnabled(false), false, '关掉时段安排');
eq(timeslot.notifyOn(), false, '时段安排关着 → 时段提醒自然不起作用');
eq(timeslot.setEnabled(true), true, '再开回来');
eq(timeslot.setNotifyOn(false), false, '单独关掉时段提醒');
eq(timeslot.enabled(), true, '关时段提醒不动时段安排本身');
eq(timeslot.setNotifyOn(true), true, '再开回来');
// 老数据没有这两个字段 → 按开算（不能因为升级就把功能悄悄关了）
eq(settings.defaults().plan.slot, true, '出厂默认 slot=true');
eq(settings.defaults().plan.slotNotify, true, '出厂默认 slotNotify=true');

/* ---------- 4. 轮转兜底与分组 ---------- */
console.log('== 4. 轮转兜底 / 分组排布 ==');
const rows = [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }];
timeslot.spread(rows, ['am', 'pm']);
eq(rows.map(r => r.slot), ['am', 'pm', 'am', 'pm'], '只剩两个可用时段时在两个之间轮转');
const keep = [{ title: 'x', slot: '晚上' }, { title: 'y' }, { title: 'z' }];
timeslot.spread(keep, ['am', 'noon', 'pm']);
eq(keep[0].slot, 'pm', '模型给过的时段保留（归一成代号，不改成别的值）');
eq(keep[1].slot, 'am', '漏给的接着上一个往后轮（晚上之后绕回早上）');
eq(keep[2].slot, 'noon', '再往后一个');
// 模型无视勾选也要拉回来：用户说只有晚上有空，早上那条等于没排
const off = [{ title: 'a', slot: 'am' }, { title: 'b', slot: 'noon' }];
timeslot.spread(off, ['pm']);
eq(off.map(t => t.slot), ['pm', 'pm'], '只勾了晚上 → 模型排到早/中的也被拉回晚上');
const grouped = timeslot.groupOf([
  { title: '1', slot: 'pm' }, { title: '2', slot: 'am' }, { title: '3', slot: 'pm' }, { title: '4' }
]);
eq(grouped.map(g => g.key), ['am', 'pm', ''], '分组顺序固定 早→中→晚，没有时段的兜最后');
eq(grouped[0].tasks.length, 1, '早上那组');
eq(grouped[1].tasks.length, 2, '晚上那组');
eq(grouped[2].tasks.length, 1, '老数据（无时段）不会被丢掉');
eq(timeslot.brief([{ slot: 'am' }, { slot: 'am' }, { slot: 'pm' }]), '早上 2 个 · 晚上 1 个', '摘要文案');
eq(timeslot.availOf([]), ['am', 'noon', 'pm'], '一个时段都没勾 → 按全开算（不排不出东西）');
eq(timeslot.availOf(['pm', '乱写', 'am']), ['am', 'pm'], '可用时段洗净并按固定顺序排');

/* ---------- 5. 规划链路：真的产出时段 ---------- */
console.log('== 5. 规划产出时段（AI 值 / 漏给轮转 / 本地兜底） ==');
const rawPlan = {
  strategy: 's', risks: [],
  milestones: [{ title: '起步', days: 5 }],
  tasks: [
    { title: '背单词', ms: 1, day: 1, pomos: 2, slot: '晚上' },
    { title: '做卷子', ms: 1, day: 2, pomos: 3, slot: 'morning' },
    { title: '整理错题', ms: 1, day: 3, pomos: 2, slot: '乱写' },
    { title: '复习', ms: 1, day: 4, pomos: 1 }
  ]
};
const p1 = agent.normalizePlan(JSON.parse(JSON.stringify(rawPlan)), {
  deadline: pw.addDays(pw.today(), 30), slotOn: true, slots: ['am', 'noon', 'pm']
});
eq(p1.tasks.map(t => t.slot), ['pm', 'am', 'noon', 'pm'], '模型值认得出来，漏给的轮转补齐');
assert(p1.tasks.every(t => timeslot.normalize(t.slot)), '每个任务都有时段（结果页才分得出三组）');

// 只勾了「晚上」→ 不许排到别的时段
const p2 = agent.normalizePlan(JSON.parse(JSON.stringify(rawPlan)), {
  deadline: pw.addDays(pw.today(), 30), slotOn: true, slots: ['pm']
});
assert(p2.tasks.every(t => t.slot === 'pm'), '用户只勾了晚上 → 全部排在晚上');

// 关掉开关 → 纯回退
const p3 = agent.normalizePlan(JSON.parse(JSON.stringify(rawPlan)), {
  deadline: pw.addDays(pw.today(), 30), slotOn: false, slots: ['am']
});
assert(p3.tasks.every(t => !('slot' in t)), '关掉时段安排：任务身上根本没有 slot 字段（纯原模式）');
eq(p3.tasks.length, 4, '关掉开关不影响任务条数与提交逻辑');

// 本地兜底（没接 AI）也要有时段
const lp = agent.localPlan({ title: '考研英语', deadline: pw.addDays(pw.today(), 60), dailyMin: 60, slotOn: true, slots: ['am', 'noon', 'pm'] });
assert(lp.tasks.length > 0 && lp.tasks.every(t => timeslot.normalize(t.slot)), '本地模板也带时段');
const lp2 = agent.localPlan({ title: '考研英语', deadline: pw.addDays(pw.today(), 60), dailyMin: 60, slotOn: false });
assert(lp2.tasks.every(t => !('slot' in t)), '关掉后本地模板也不带时段');

/* ---------- 6. 提示词与追问：问了、也只问一次 ---------- */
console.log('== 6. AI 追问时段 / 提示词下发时段 ==');
const agentSrc = R('services/plan-agent.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
assert(/input\.slotOn\s*\?\s*',"slot":"am\|noon\|pm"'/.test(agentSrc), '提示词的格式串里带 slot 字段');
assert(/if \(input\.slotOn\) row\.slot = timeslot\.normalize/.test(agentSrc), '开启时才夹取 slot');
assert(/if \(input\.slotOn\) timeslot\.spread\(tasks, input\.slots\)/.test(agentSrc), '漏给的按可用时段轮转补');
assert(/timeslot\.namesOf\(input\.slots\)/.test(agentSrc), '把用户勾选的可用时段告诉模型');
assert(/if \(seed\.slotOn\)/.test(agentSrc), '追问阶段按需下发时段规则');
assert(/大概说就行/.test(agentSrc), '明确告诉用户"大概说就行"（不是逼人填表）');
assert(/想细说也行/.test(agentSrc), '也接得住详细说法（工作日晚上 8-10 点这种）');
assert(/执行时段是必问项/.test(agentSrc), '时段升级成必问项');
const taskSrc = R('utils/plan-task.js');
assert(/input\.slotOn = timeslot\.enabled\(\)/.test(taskSrc), '生成阶段读当下开关（中途关掉就不排时段）');
assert(/input\.slots = \(st\.seed && st\.seed\.slots\)/.test(taskSrc), '用户勾的可用时段一路带到生成器');
assert(/Object\.assign\(\{\}, st\.seed, \{ slotOn: timeslot\.enabled\(\) \}\)/.test(taskSrc), '追问同样读当下开关');

/* ---------- 7. 落库：多带一个字段，别的都不动 ---------- */
console.log('== 7. 落地与展示 ==');
const g = pw.addGoal({ title: '考研英语', dailyMin: 60, deadline: pw.addDays(pw.today(), 30) }, {
  strategy: '', risks: [], milestones: [{ title: '起步', days: 5 }],
  tasks: [{ title: '背单词', ms: 1, day: 1, pomos: 2, slot: 'pm' }, { title: '刷阅读', ms: 1, day: 2, pomos: 3 }]
});
eq(pw.goalOf(g.id).tasks[0].slot, 'pm', '时段跟着任务落库');
eq(pw.goalOf(g.id).tasks[1].slot, '', '没时段的任务留空串（不写 undefined）');
assert(pw.goalOf(g.id).tasks[0].status === 'todo' && pw.goalOf(g.id).tasks[0].donePomos === 0,
  '落库其它字段一个没动（提交逻辑不受影响）');

/* ---------- 8. 时段到点提醒 ---------- */
console.log('== 8. 时段到了发通知 ==');
// 第 7 节那个目标也有 pm 任务，会把这里的计数搅乱 —— 归档掉再测
pw.archiveGoal(g.id);
const gs = pw.addGoal({ title: '四级', dailyMin: 60, deadline: pw.addDays(pw.today(), 30) }, {
  strategy: '', risks: [], milestones: [{ title: '起步', days: 3 }],
  tasks: [
    { title: '早读', ms: 1, day: 1, pomos: 1, slot: 'am' },
    { title: '午间复盘', ms: 1, day: 1, pomos: 2, slot: 'noon' },
    { title: '晚间刷题', ms: 1, day: 1, pomos: 3, slot: 'pm' }
  ]
});
sent.length = 0;
eq(reminder.checkSlot({ now: at(7, 30) }), 0, '8 点前不打扰');
eq(sent.length, 0, '一条都没发');

eq(reminder.checkSlot({ now: at(8, 5) }), 1, '8:05 → 早上那条发出去');
eq(sent.length, 1, '只发一条');
eq(sent[0].kind, 'slot', '走的是时段提醒（不与每日提醒互相覆盖）');
assert(/^早上该开始了：四级$/.test(sent[0].title), '标题带上时段和目标（' + sent[0].title + '）');
assert(/早读/.test(sent[0].text) && /分钟/.test(sent[0].text), '正文说清做哪件事、多久（' + sent[0].text + '）');
assert(/早读/.test(sent[0].text) && !/午间复盘/.test(sent[0].text), '只说这个时段的事，不把一天的都倒出来');

eq(reminder.checkSlot({ now: at(9, 0) }), 0, '同一个时段再查 → 不重复催');
eq(sent.length, 1, '没有多发');

eq(reminder.checkSlot({ now: at(14, 0) }), 1, '14:00 进 App → 补中午那条');
assert(/中午该开始了/.test(sent[1].title), '补的是中午（' + sent[1].title + '）');
eq(reminder.checkSlot({ now: at(20, 0) }), 1, '20:00 → 晚上那条');
assert(/晚上该开始了/.test(sent[2].title), '晚上那条');
eq(sent.length, 3, '一天最多三次');

// 该时段没安排事 → 不打扰
const gNo = pw.addGoal({ title: '只有晚上', dailyMin: 60, deadline: pw.addDays(pw.today(), 30) }, {
  strategy: '', risks: [], milestones: [{ title: '起步', days: 3 }],
  tasks: [{ title: '夜读', ms: 1, day: 1, pomos: 1, slot: 'pm' }]
});
sent.length = 0;
eq(reminder.checkSlot({ now: at(8, 10) }), 0, '早上没安排的目标 → 早上不催它');
eq(sent.filter(s => /只有晚上/.test(s.title)).length, 0, '没安排就不打扰');

// 太晚不打扰
eq(reminder.checkSlot({ now: at(23, 30) }), 0, '23:30 太晚 → 不打扰');

// 开关关掉 → 完全静默（挑一个还没催过的时段：gNo 的晚上那条从没催过）
timeslot.setNotifyOn(false);
sent.length = 0;
eq(reminder.checkSlot({ now: at(20, 0) }), 0, '关掉时段提醒 → 一条都不发');
eq(sent.length, 0, '静默');
timeslot.setEnabled(false);
eq(reminder.checkSlot({ now: at(20, 0) }), 0, '关掉时段安排 → 时段提醒也不存在');
timeslot.setEnabled(true);
timeslot.setNotifyOn(true);

/* ---------- 9. 页面入口 ---------- */
console.log('== 9. 入口：向导设定 / 结果分组 / 详情展示 / 设置开关 / 首页触发 ==');
const wiz = R('pkgPlan/pages/wizard/wizard.vue');
const wizTpl = wiz.slice(0, wiz.indexOf('\n<script')).replace(/<!--[\s\S]*?-->/g, '');
const wizSc = wiz.slice(wiz.indexOf('\n<script'), wiz.indexOf('\n<style'));
assert(/执行时段/.test(wizTpl), '向导页有「执行时段」卡');
assert(/@tap="toggleSlot"/.test(wizTpl), '可随时开 / 关时段安排');
assert(/v-for="s in slotList"/.test(wizTpl), '列出早 / 中 / 晚三个时段');
assert(/slotPicked\(s\.key\)/.test(wizTpl), '时段可勾选（大概说 = 勾一下）');
assert(/pv-slot-head/.test(wizTpl), '结果页按早 / 中 / 晚分组排布');
assert(/v-for="\(sg, si\) in group\.groups"/.test(wizTpl), '阶段内再按时段分');
assert(/p-slots/.test(wizTpl), '概览有一行时段摘要');
assert(/slots: \(this\.draft\.slots \|\| \[\]\)\.slice\(\)/.test(wizSc), '勾选的时段传给规划会话');
assert(/至少留一个时段/.test(wizSc), '不允许把时段全取消（任务没处放）');
assert(/timeslot\.setEnabled/.test(wizSc), '开关写在 settings 上（设置页那边同步）');
assert(/this\.slotOn = timeslot\.enabled\(\)/.test(wizSc), '从设置页回来会重新读开关');
// 提交逻辑一行没改
assert(/const g = pw\.addGoal\(/.test(wizSc) && /reminder\.setRemind\(g\.id/.test(wizSc), '落地入口还是 addGoal（提交流程不变）');
assert(!/slots/.test(wizSc.slice(wizSc.indexOf('    commit() {'), wizSc.indexOf('    commit() {') + 900)) ||
  /tasks/.test(wizSc.slice(wizSc.indexOf('    commit() {'))), 'commit 没被时段逻辑污染');

const det = R('pkgPlan/pages/goal-detail/goal-detail.vue');
const detTpl = det.slice(0, det.indexOf('\n<script')).replace(/<!--[\s\S]*?-->/g, '');
const detSc = det.slice(det.indexOf('\n<script'), det.indexOf('\n<style'));
assert(/slotOf\(t\)/.test(detTpl), '详情页任务行显示时段');
assert(/if \(!this\.slotOn \|\| !t\) return ''/.test(detSc), '开关关着就一律不显示（纯任务模式）');
assert(/slotStarts/.test(detSc), '详情页说清三个时段几点催');

const set = R('pkgManage/pages/settings/settings.vue');
const setTpl = set.slice(0, set.indexOf('\n<script')).replace(/<!--[\s\S]*?-->/g, '');
const setSc = set.slice(set.indexOf('\n<script'), set.indexOf('\n<style'));
assert(/规划时安排执行时段/.test(setTpl), '设置页有「是否启用时段安排」');
assert(/时段到了提醒我/.test(setTpl), '设置页有「时段提醒」开关');
assert(/setPlanSlot\(on\)/.test(setSc) && /timeslot\.setEnabled\(on\)/.test(setSc), '时段安排开关真的写回');
assert(/setPlanSlotNotify\(on\)/.test(setSc) && /timeslot\.setNotifyOn\(on\)/.test(setSc), '时段提醒开关真的写回');

const home = R('pages/home/home.vue');
const homeSc = home.slice(home.indexOf('\n<script'), home.indexOf('\n<style'));
assert(/reminder\.checkSlot\(\)/.test(homeSc), '首页到点触发时段提醒');
assert(homeSc.indexOf('reminder.checkSlot()') > homeSc.indexOf('reminder.check()'), '跟每日提醒同一个节流里（不另起轮询）');

/* ---------- 10. 结果页真跑一遍 ---------- */
// 光看模板字符串不够：grouped 从"任务数组"改成"任务数组 + 时段分组"，
// 得真把它跑起来，确认分组顺序、小标题、以及勾选用的 idx 没被分组搞错位。
console.log('== 10. 向导结果页真跑（阶段内按时段分组） ==');
const { loadCode } = require('./lib/load.js');
const sOpen = wiz.indexOf('<script');
const wizBody = wiz.slice(wiz.indexOf('>', sOpen) + 1, wiz.indexOf('\n</script>'));
const comp = loadCode(wizBody, {
  pw, pacing, holiday, reminder, timeslot,
  planTask: {
    CHANGE_EVENT: 'x', snapshot: () => ({}), reset: () => {}, startSession: () => {},
    send: () => {}, generate: () => {}, regenerate: () => {}, backToChat: () => {},
    abandon: () => {}, pause: () => {}, resume: () => {}
  },
  TEMPLATES: [],
  seedOf: () => ({ title: '', spanDays: 90, dailyMin: 60, level: '' }),
  aiGateReason: () => null,
  FloatNavbar: {},
  // 依赖袋按标识符注入：wizard 页现在注册了统一弹窗组件、按钮缺省文案走 t()
  AppDialog: {},
  t: (s) => s,
  // wizard 的 data() 会读 settings.plan.startFrom（「从哪天开始」默认值），
  // 桩里不给的话 data() 直接 ReferenceError，整个 harness 崩在构造阶段。
  settings: { get: () => ({ plan: { startFrom: 'today' } }) }
}).default;
const st = Object.assign({}, comp.data.call({}));
Object.keys(comp.computed || {}).forEach(k =>
  Object.defineProperty(st, k, { get: comp.computed[k].bind(st), configurable: true }));
Object.keys(comp.methods || {}).forEach(k => { st[k] = comp.methods[k].bind(st); });
st.plan = {
  strategy: '', risks: [], milestones: [{ title: '起步', days: 5 }, { title: '推进', days: 10 }], totalDays: 30,
  tasks: [
    { title: '背单词', ms: 1, day: 1, pomos: 2, slot: 'pm' },
    { title: '早读', ms: 1, day: 2, pomos: 1, slot: 'am' },
    { title: '刷题', ms: 1, day: 3, pomos: 3, slot: 'pm' },
    { title: '复盘', ms: 2, day: 5, pomos: 1, slot: 'noon' }
  ]
};
st.slotOn = true;
const gg = st.grouped;
eq(gg.length, 2, '两个阶段各一张卡');
eq(gg[0].groups.map(x => x.key), ['am', 'pm'], '阶段内按早 → 晚排（顺序固定）');
eq(gg[0].groups[0].name, '早上', '小标题是中文时段名');
eq(gg[0].groups[0].tasks.map(t => t.title), ['早读'], '早上那组');
eq(gg[0].groups[1].tasks.map(t => t.title), ['背单词', '刷题'], '晚上那组内按 day 排');
eq(gg[1].groups.map(x => x.key), ['noon'], '第二个阶段');
eq(gg[0].groups.map(x => x.tasks.map(t => t.idx)), [[1], [0, 2]], 'idx 仍是全局下标（分组不会让勾选错位）');
eq(st.slotBrief, '早上 1 个 · 中午 1 个 · 晚上 2 个', '概览的时段摘要');
st.slotOn = false;
eq(st.grouped[0].groups.length, 1, '关掉时段 → 只有一组');
eq(st.grouped[0].groups[0].name, '', '关掉后没有小标题（跟原来的列表一模一样）');
eq(st.slotBrief, '', '关掉后不显示时段摘要');
eq(st.grouped[0].groups[0].tasks.length, 3, '关掉后任务一条不少（提交逻辑不受影响）');

console.log(fail === 0 ? '\n时段安排校验全部通过' : '\n失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);

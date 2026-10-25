// _tools/check-schedule.js - 日程表（首页卡 + 日历页复用）与收工对话落库校验
// 运行：node _tools/check-schedule.js
//
// 为什么要单开一个：日程表原先只写在日历页里，首页加同一张表时最容易长成
// "两份 rowsOf / 两份 .ct-row" —— 那时首页说超期、日历页说不超期，谁也不知道信谁。
// 这里守的就是"只有一份"：数据层一份、组件一份、样式一份。
//
// 覆盖：
//  1) utils/schedule.js：反查、超期口径、日期文案、前移/后移（含"不能早于第 1 天"）
//  2) 复用契约：日历页与首页都引用同一个组件；日历页里不再留一份 .ct-* 样式
//  3) 首页改版：没有「AI 规划目标」按钮；收工是首页底部的主按钮
//  4) 收工对话：脚本化提问的状态机齐全、能选图；dailylog 落 photos（去重 / 截断）
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const P = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  const s1 = JSON.stringify(a), s2 = JSON.stringify(b);
  if (s1 === s2) ok(label + ' = ' + s2);
  else bad(label + ' 期望 ' + s2 + '，实际 ' + s1);
}

/* ---------------- mock：uni 存储 ---------------- */
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {}
};

(async () => {
const pw = await import(P('utils/pwstore.js'));
const schedule = await import(P('utils/schedule.js'));
const dailylog = await import(P('utils/dailylog.js'));

/* ---------- 1. 数据层 ---------- */
console.log('== 1. utils/schedule.js（日历页与首页同一份口径）==');
const g = pw.addGoal(
  { title: '考研英语', dailyMin: 60 },
  {
    tasks: [
      { title: '背单词', day: 1, pomos: 2 },
      { title: '阅读精读', day: 3, pomos: 1 },
      { title: '砍掉的', day: 2, pomos: 1 }
    ]
  }
);
const dropped = g.tasks.filter(t => t.title === '砍掉的')[0];
pw.setTaskStatus(g.id, dropped.id, 'dropped');

const today = pw.today();
const d3 = pw.addDays(today, 2);
const map = schedule.byDate();
assert((map[today] || []).length === 1, '今天只有第 1 天那一项（' + (map[today] || []).length + '）');
assert((map[d3] || []).length === 1, '第 3 天那一项落在今天 +2 天');
assert(!map[pw.addDays(today, 1)], '砍掉的任务不占日历格子');

const rows = schedule.rowsOf(today, map);
eq(rows.length, 1, 'rowsOf(今天) 条数');
assert(rows[0].overdue === false, '第 1 天就是今天 → 不算超期');
assert(rows[0].title === '背单词' && rows[0].startDay === 1, '行里带着标题与原始 day（前后移要用）');

// 日期文案：与日历页同一个函数，免得一边写节假日一边不写
assert(/^\d{2} 月 \d{2} 日/.test(schedule.dateLabel(today)), '日期文案格式 = ' + schedule.dateLabel(today));
eq(schedule.dateLabel(''), '', '空日期不炸');

// 前移：第 1 天再往前就是第 0 天，必须被拦住
const back = schedule.move(rows[0], -1);
assert(back.ok === false, '第 1 天不能再往前（' + back.msg + '）');
const fwd = schedule.move(rows[0], 1);
assert(fwd.ok === true && fwd.date === pw.addDays(today, 1), '后移一天 = ' + (fwd.date || '-'));
const after = schedule.byDate();
assert(!(after[today] || []).length, '移走之后今天空了（日历格子跟着变）');
assert((after[pw.addDays(today, 1)] || []).length === 1, '任务出现在明天');

/* ---------- 2. 复用契约（不许长出两套） ---------- */
console.log('== 2. 一套样式：日历页与首页共用 components/schedule-list ==');
const COM = 'components/schedule-list/schedule-list.vue';
assert(fs.existsSync(path.join(ROOT, COM)), '组件存在：' + COM);
const com = R(COM);
assert(/\.ct-row\s*\{/.test(com), '.ct-row 样式定义在组件里');

const cal = R('pkgPlan/pages/calendar/calendar.vue');
const home = R('pages/home/home.vue');
assert(/components\/schedule-list\/schedule-list\.vue/.test(cal), '日历页引用 ScheduleList');
assert(/components\/schedule-list\/schedule-list\.vue/.test(home), '首页引用同一个 ScheduleList');
assert(/<schedule-list/.test(cal) && /<schedule-list/.test(home), '两边都真正渲染了它');
// 日历页里如果还留着 .ct-*，改样式时就会只改一边 → 直接判失败
const calStyle = cal.slice(cal.indexOf('\n<style'));
assert(!/\.ct-row\s*\{/.test(calStyle), '日历页不再自带一份 .ct-row 样式');
assert(/utils\/schedule\.js/.test(cal) && /utils\/schedule\.js/.test(home), '两边都用 utils/schedule.js 取数');
const hl = R('utils/home-layout.ts');
assert(/id:\s*'schedule'/.test(hl), '首页注册表里有 schedule 模块');

/* ---------- 3. 首页改版 ---------- */
console.log('== 3. 首页：规划入口收起、收工升为核心操作 ==');
// ⚠️ 先剥注释再扫：注释里提到"AI 规划目标"（说明它为什么被删）会把自己命中（已踩多次）
const homeTpl = home.slice(0, home.indexOf('\n<script')).replace(/<!--[\s\S]*?-->/g, '');
assert(!/AI 规划目标/.test(homeTpl), '首页已移除「AI 规划目标」按钮');
assert(/class="btn-primary cta-btn"[^>]*@tap="goDaily\(\)"/.test(homeTpl), '收工是首页底部的主按钮（btn-primary 尺寸）');
assert(/class="home-cta"/.test(homeTpl), '收工按钮包在自己的区块里（不与编辑按钮抢位）');
assert(/v-if="!editing"/.test(homeTpl.slice(homeTpl.indexOf('home-cta') - 60)), '编辑首页时收工按钮让位');
// 原来那个小链接必须真的没了，否则两个入口并存
assert(!/class="card-more"[^>]*@tap="goDaily\(\)"/.test(homeTpl), '任务卡右上角那个小链接已撤掉');
assert(/id === 'schedule'/.test(homeTpl), '首页有日程表卡片分支');
const homeSc = home.slice(home.indexOf('\n<script'), home.indexOf('\n<style'));
assert(/refreshSchedule\s*\(\)\s*\{[\s\S]{0,120}schedule\.rowsOf/.test(homeSc), '首页日程数据走 schedule.rowsOf');

/* ---------- 4. 收工对话 ---------- */
console.log('== 4. 收工：对话式 + 图片 ==');
const daily = R('pkgPlan/pages/daily/daily.vue');
assert(/uni\.chooseImage/.test(daily), '能从相册 / 相机选图');
assert(/uni\.saveFile/.test(daily), '选完转成本地持久文件（临时路径重启就失效）');
assert(/uni\.previewImage/.test(daily), '缩略图可点开看大图');
assert(/class="thumb"/.test(daily) && /th-del/.test(daily), '有缩略图预览与删除');
// 一问一答的状态机：这几个 step 少一个，对话就会卡在某一步不往下走
['mood', 'item', 'ahead', 'extras', 'note', 'done'].forEach(s => {
  assert(daily.indexOf("'" + s + "'") >= 0, '对话步骤 step = ' + s);
});
// ⚠️ 同名方法这条是真踩过的坑：methods 里 ask 重复定义时后者覆盖前者，
//    于是"AI 说一句话"变成了"弹一个空对话框"
const askDefs = (daily.match(/\n\s{4}ask\s*\(/g) || []).length;
eq(askDefs, 1, 'daily.vue 里 ask 只定义一次（弹窗那个已改名 openDlg）');
assert(/\n\s{4}openDlg\s*\(/.test(daily), '弹窗方法叫 openDlg');
assert(!/dl-input|class="step"/.test(daily), '旧的一次性表单已移除（不再有专注步进器）');

// photos 落库
const draft = dailylog.buildDraft();
assert(Array.isArray(draft.photos), 'buildDraft 带 photos 数组');
const lg = dailylog.save(Object.assign({}, draft, {
  items: [], ahead: [], extras: '', mood: 'ok', note: '',
  photos: ['a.png', 'b.png', 'a.png', '  ', '']
}));
eq(lg.photos, ['a.png', 'b.png'], 'photos 去重去空后落库');
const many = [];
for (let i = 0; i < dailylog.MAX_PHOTOS + 4; i++) many.push('p' + i + '.png');
const lg2 = dailylog.save(Object.assign({}, dailylog.buildDraft(), {
  items: [], ahead: [], extras: '', mood: '', note: '', photos: many
}));
eq(lg2.photos.length, dailylog.MAX_PHOTOS, 'photos 按上限截断');
assert(dailylog.summaryFor(lg2).indexOf('成果图') >= 0, '给 AI 的摘要里提到今天贴了图');
// 老数据没有 photos 字段时不能炸
const lg3 = dailylog.save({ date: pw.today(), items: [], ahead: [], extras: '', mood: '', note: '' });
eq(lg3.photos, [], '不传 photos 也落空数组（老数据兼容）');

/* ---------- 5. 主流程：把整段对话真跑一遍 ---------- */
console.log('== 5. 收工对话主流程（真跑，不是静态扫）==');
const { loadCode } = require('./lib/load.js');
// 造一个今天有事、后面几天也有事的目标，让每一问都有内容可问
pw.addGoal({ title: '主流程目标', dailyMin: 60 }, {
  tasks: [
    { title: '背单词', day: 1, pomos: 2 },
    { title: '阅读精读', day: 5, pomos: 1 }
  ]
});
const dlSrc = R('pkgPlan/pages/daily/daily.vue');
// .vue 的 <script> 块：从开标签的 ">" 之后切，别把 '>' 也切进来（会直接 SyntaxError）
const sOpen = dlSrc.indexOf('\n<script');
const dlScript = dlSrc.slice(dlSrc.indexOf('>', sOpen) + 1, dlSrc.lastIndexOf('</script>'));
const def = loadCode(dlScript, { pw, dailylog, FloatNavbar: {}, AppDialog: {} }).default;
assert(!!(def && def.methods), 'daily.vue 的 script 能被独立装载（可单测）');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const st = Object.assign({}, def.data(), def.methods);
// 页面实例才有的东西：这里只测逻辑，给个同步版就行
st.$nextTick = (f) => { f(); };
st.$forceUpdate = () => {};
st.draft = dailylog.buildDraft();
assert((st.draft.items || []).length === 1, '草稿里今天有 1 项（对话才有得问）');
assert((st.draft.ahead || []).length >= 1, '草稿里有"提前做了"的候选（' + (st.draft.ahead || []).length + ' 项）');

st.start();
assert(st.step === 'mood' && st.msgs.length === 1, '开场后停在"今天状态"这一问');

// 一问一答往下走：每一步按当前 step 给一个答案，直到收尾
let guard = 0;
while (st.step !== 'done' && guard++ < 40) {
  if (st.step === 'mood') st.answerMood(st.moods[2]);            // 有点累
  else if (st.step === 'item') st.answerItem(2);                 // 做完了
  else if (st.step === 'ahead') { st.toggleAhead(st.draft.ahead[0]); st.finishAhead(); }
  else if (st.step === 'extras') { st.text = '临时刷了 30 道阅读题'; st.sendText(); }
  else if (st.step === 'note') { st.text = '明天想早点开始'; st.sendText(); }
  await sleep(620);   // 每一步都有"打字"停顿，等它落下来
}
assert(st.step === 'done', '对话能一问一答走到收尾（step = ' + st.step + '）');
await sleep(600);   // 收尾那句是"打字"后进场的，等它落下来再看结尾
eq(st.draft.mood, 'tired', '状态被记进草稿');
eq(st.draft.items[0].actual, 2, '「做完了」= 按计划记满（不是替用户虚报）');
assert((st.draft.ahead[0].actual || 0) > 0, '点过的"提前做了"记上了');
eq(st.draft.extras, '临时刷了 30 道阅读题', '计划外的内容记上了');
eq(st.draft.note, '明天想早点开始', '备注记上了');
assert(st.msgs.filter(m => m.role === 'user').length >= 4, '用户的每句回答都进了对话');
assert(st.msgs.filter(m => m.role === 'assistant').length >= 5, 'AI 每一问都在对话里');
assert(/记下了/.test(st.msgs[st.msgs.length - 1].text), '最后一句是收尾小结');

// 图片：选两张 → 转持久路径 → 进缩略图
global.uni.chooseImage = (o) => o.success({ tempFilePaths: ['a.png', 'b.png'] });
global.uni.saveFile = (o) => o.success({ savedFilePath: o.tempFilePath });
st.step = 'extras';
st.draft.photos = [];
st.pickPhoto();
await sleep(60);
eq(st.draft.photos, ['a.png', 'b.png'], '选的图进了缩略图列表');
st.delPhoto(0);
eq(st.draft.photos, ['b.png'], '删除缩略图生效');
// 落库后仍带着图（今天记录里能翻到）
const saved = dailylog.save(st.draft);
eq(saved.photos, ['b.png'], '提交后图留在今天的记录里');

/* ---------- 6. 新模块要能进老用户的首页 ---------- */
console.log('== 6. 老布局迁移：新模块补一次，之后收纳不再回来 ==');
const settings = await import(P('utils/settings.js'));
settings.init();
settings.set({ home: { layout: ['focus', 'urgency', 'task', 'goal'] } });   // 老用户存的旧四项
const layout = await import(P('utils/home-layout.ts'));
assert(layout.layout().indexOf('schedule') >= 0, '旧布局里没有日程表 → 自动补上（否则用户以为没做）');
const pos = layout.layout().indexOf('schedule');
eq(pos, 4, '补在末尾（不打乱用户自己排的顺序）');
// 用户后来把它收纳掉 → 不该被反复加回来（迁移只跑一次）
settings.set({ home: { layout: ['focus', 'urgency', 'task', 'goal'] } });
assert(layout.layout().indexOf('schedule') < 0, '收纳掉之后不会被反复加回来');

/* ---------- 7. 就地勾选完成 ---------- */
console.log('== 7. 当天的事项可以就地勾掉 ==');
const gc = pw.addGoal({ title: '勾选目标', dailyMin: 60 }, {
  tasks: [{ title: '勾我', day: 1, pomos: 3 }]
});
const mineRow = schedule.rowsOf(pw.today()).filter(r => r.goalId === gc.id)[0];
assert(!!mineRow && mineRow.status === 'todo', '今天的事项默认待办');
// 当日账的前后差值（前面章节已经往今天记过账，这里只能比差值不能比绝对值）
const minBefore = ((pw.get().daily[pw.today()] || {}).focusMin) || 0;
const r1 = schedule.toggleDone(mineRow);
assert(r1.ok === true && r1.done === true, '勾一下 → 已完成（' + r1.msg + '）');
const tc = () => pw.goalOf(gc.id).tasks.filter(x => x.id === mineRow.id)[0];
assert(tc().status === 'done', '状态真的落库了');
eq(tc().donePomos, 3, '勾完成把差的那 3 段专注补齐（进度条/热力图认这笔账）');
const r2 = schedule.toggleDone({ goalId: gc.id, id: mineRow.id, status: 'done' });
assert(r2.done === false, '再点一下 → 取消完成');
assert(tc().status === 'todo', '状态回到待办');
// 2026-10-25 真机反馈改的口径：手工勾补记的专注要跟着退回去，紧迫度才能恢复
// （手滑点到打勾又取消，首页却显示"还剩 0 段专注"）。真坐过的（计时路径）不退。
eq(tc().donePomos, 0, '取消完成回滚手工勾补记的专注（紧迫度立刻恢复）');
const d7 = pw.get().daily[pw.today()] || {};
eq((d7.focusMin || 0) - minBefore, 0, '当日统计也跟着退（不然热力图记一笔没坐过的时长）');
// 台账也要撤：重新勾上时"同天同任务只留一条"才成立（不然收工页把同一件事列两遍）
const led7 = (pw.ledgerOf(pw.today()).items || []).filter(x => x.taskId === mineRow.id).length;
eq(led7, 0, '取消完成同时撤掉台账那条（重新勾上只记一条）');
assert(schedule.toggleDone(null).ok === false, '空行不炸');

// UI：两张卡都要有勾选圈，且点击不会顺带触发"整行"的跳转
assert(/class="ct-check"/.test(com) && /\n\s{4}toggle\s*\(/.test(com), '日程表组件有勾选圈与 toggle');
assert(/@tap\.stop="toggle\(t\)"/.test(com), '勾选 stop 掉冒泡（不会顺带触发行上的其它动作）');
assert(/checkable/.test(com), '勾选可关（有些场合只要看不要勾）');
const homeTpl7 = home.slice(0, home.indexOf('\n<script')).replace(/<!--[\s\S]*?-->/g, '');
assert(/class="tk-check"/.test(homeTpl7), '首页「今日任务」卡也有勾选圈');
assert(/@tap\.stop="toggleTaskDone\(item\)"/.test(homeTpl7), '首页勾选 stop 掉冒泡（点勾 ≠ 开始专注）');
const homeSc7 = home.slice(home.indexOf('\n<script'), home.indexOf('\n<style'));
assert(/toggleTaskDone\s*\(item\)\s*\{[\s\S]{0,140}schedule\.toggleDone/.test(homeSc7),
  '首页勾选与日程表同一个 toggleDone 口径');
// 2026-10-25 真机反馈："取消完以后要退出 app 重进，今日任务才会刷新" ——
// pwstore 是裸对象，App 端不保证 refresh 换了新数组就重渲染（goal-detail 早已
// 踩过并靠 $forceUpdate 治住）。三个挂勾选的地方都要补这一刀。
const comSc = com.slice(com.indexOf('\n<script'), com.indexOf('\n<style'));
const calSc = cal.slice(cal.indexOf('\n<script'), cal.indexOf('\n<style'));
assert(/toggleTaskDone\s*\(item\)\s*\{[\s\S]{0,900}\$forceUpdate/.test(homeSc7),
  '⚠️ 首页勾选后强刷（不然取消完要退出重进才刷新）');
assert(/toggle\s*\(row\)\s*\{[\s\S]{0,1100}\$forceUpdate/.test(comSc || ''),
  '⚠️ 日程表组件勾选后自己也要强刷（props 重建不保证子组件重渲染）');
assert(/onListChanged\s*\(\)\s*\{[\s\S]{0,300}\$forceUpdate/.test(calSc || ''),
  '⚠️ 日历页 changed 后强刷（同上）');
assert(cal.indexOf('<schedule-list') >= 0 && !/:checkable="false"/.test(cal), '日历页也开着勾选');

console.log(fail === 0 ? '\n日程表与收工校验全部通过' : '\n失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
})();

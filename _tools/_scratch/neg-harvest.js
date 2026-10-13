// 反向测试：故意把「任务完成反馈 + 动态重排」改坏，确认 check-harvest.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 同进程 require 而不是起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
// ⚠️ check-harvest.js 的收尾在 async IIFE 里（CJS 没有顶层 await）。**async 函数体里的
//    throw 一律变成 promise rejection** —— 就算那段代码实际是同步跑完的（断言在第一个
//    await 之前就抛了），外面的 try/catch 也接不到，只会变成 unhandledRejection 崩进程
//    （已踩）。所以这里 process.exit **绝不 throw**，只记码，靠 exited 标志 + 轮询判断跑完。
// ⚠️ 会临时改坏源文件 —— 别跟 run-all 或其他护栏并发跑（第 23 条）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const U = path.join(ROOT, 'uniapp-PWstudy');
const CHECK = path.join(ROOT, '_tools', 'check-harvest.js');
const PW = path.join(U, 'utils', 'pwstore.js');
const HV = path.join(U, 'utils', 'harvest.js');
const DLG = path.join(U, 'components', 'task-done-dialog', 'task-done-dialog.vue');
const HOME = path.join(U, 'pages', 'home', 'home.vue');
const SL = path.join(U, 'components', 'schedule-list', 'schedule-list.vue');
const GATE = path.join(U, 'services', 'ai-gate.js');

const FILES = [PW, HV, DLG, HOME, SL, GATE];
const backup = {};
FILES.forEach(f => { backup[f] = fs.readFileSync(f); });
function restore() {
  Object.keys(backup).forEach(f => fs.writeFileSync(f, backup[f]));
}

/** 跑一次 check，收退出码 + 输出。 exit 与 exitCode 两条口径都要收 */
async function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realLog = console.log;
  const realErr = console.error;
  const realWarn = console.warn;
  const realExit = process.exit;
  const buf = [];
  let code = 0;
  let exited = false;
  process.exitCode = 0;
  process.exit = (c) => { code = (c == null ? 0 : c); exited = true; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  console.warn = (...a) => buf.push(a.join(' '));
  let crash = null;
  try { require(CHECK); } catch (e) { crash = e; }
  // 断言都在 async IIFE 里，同步 require 返回时一条都还没跑 —— 不等就恒绿
  await new Promise(r => setImmediate(r));
  await new Promise(r => setTimeout(r, 0));
  const t0 = Date.now();
  while (!exited && !process.exitCode && Date.now() - t0 < 8000) {
    await new Promise(r => setTimeout(r, 50));
  }
  process.exit = realExit;
  console.log = realLog;
  console.error = realErr;
  console.warn = realWarn;
  const c = crash ? 99 : (code || process.exitCode || 0);
  process.exitCode = 0;
  return { code: c, buf: buf, crash: crash };
}

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

/** 改坏 → 跑 → 断言"被抓到"。红条数必须 > 0：一条都没有说明是脚本崩了，不是断言命中 */
async function shouldCatch(label, mutate, expect) {
  restore();
  const cur = {};
  FILES.forEach(f => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    // 锚点失效（源码改过了）必须当成失败，不能让它把整个脚本崩掉然后看都不看
    bad(label + ' —— 注入失败：' + e.message);
    restore();
    return;
  }
  FILES.forEach(f => fs.writeFileSync(f, cur[f]));
  const r = await runCheck();
  const reds = r.buf.filter(l => l.indexOf('✗') >= 0);
  const hit = r.code !== 0 && reds.length > 0
    && (!expect || r.buf.join('\n').indexOf(expect) >= 0);
  if (hit) ok(label + '（红 ' + reds.length + ' 条）');
  else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
    + (expect ? ' 期望看到「' + expect + '」' : '')
    + (r.crash ? '\n      崩了：' + r.crash.message : '')
    + (reds.length === 0 ? '\n      输出尾巴：' + r.buf.slice(-4).join(' | ') : ''));
  restore();
}

/**
 * 锚点替换：换了必须真的生效，否则抛错。
 * from 可以是字符串（只换第一处）也可以是正则（要跨行就只能用正则 ——
 * ⚠️ 字符串里的 \r\n 不会被解析，写多行锚点必然落空，已踩）。
 */
function swap(cur, file, from, to) {
  const before = cur[file];
  cur[file] = before.replace(from, to);
  if (cur[file] === before) throw new Error('锚点没命中：' + String(from).slice(0, 70));
}

(async () => {

console.log('反向测试：check-harvest.js 应该抓到下面这些坏法');
console.log('');

/* ---------- 需求 3：本地留存 ---------- */

// 1. 手工勾完成不记台账（三条路径里最容易漏的一条）
await shouldCatch('手工勾完成不记台账', (c) => {
  swap(c, PW, "    markTaskDone(g, t, 'manual');", "    /* 忘了记台账 */");
}, '手工勾完成 → 台账有记录');

// 2. 番茄跑满不记台账
await shouldCatch('番茄跑满不记台账', (c) => {
  swap(c, PW, "  if (t.donePomos >= t.pomos && t.status === 'todo') markTaskDone(g, t, 'pomo');",
    "  if (t.donePomos >= t.pomos && t.status === 'todo') t.status = 'done';");
}, '番茄跑满 → 台账有记录');

// 3. 收工补记不记台账
await shouldCatch('收工补记不记台账', (c) => {
  swap(c, PW, "  if (t.donePomos >= cap && t.status === 'todo') markTaskDone(g, t, o.src || 'log', key);",
    "  /* 补记不算完成 */");
}, '收工补记 → 台账有记录');

// 4. 唯一出口本身不记台账 —— "任务显示已完成但台账没有"，于是自动重排永远不触发
await shouldCatch('markTaskDone 不记台账', (c) => {
  swap(c, PW, "  if (first) ledgerAdd(g.id, t.id, src || 'manual', date);", "  /* 不记台账 */");
}, '台账');

// 5. 重复勾完成堆第二条（"几点做完的"被最后一次覆盖）
//    ⚠️ 这里有两把锁（markTaskDone 的 first 判断 + ledgerAdd 的去重），**任一**单着就够挡住，
//    所以只拆一把不会红 —— 反向测试必须两把一起拆，否则会误判成"护栏没抓到"
await shouldCatch('同一任务重复完成堆两条（两道锁一起拆）', (c) => {
  swap(c, PW, "  const first = t.status !== 'done';", "  const first = true;");
  swap(c, PW, "  const old = l.items.filter(x => x.taskId === taskId)[0];", "  const old = null;");
}, '重复勾完成不堆第二条');

// 6. 兜底那句总结不带日期 —— 回看时只剩一句没头没尾的话
await shouldCatch('兜底总结不带日期', (c) => {
  swap(c, HV, "  return date + ' ' + atText + ' 完成「' + title + '」，本人补充：' + short;",
    "  return '本人补充：' + short;");
}, '兜底那句也带日期');

// 7. AI 挂了就把用户说的话丢了
await shouldCatch('AI 挂了就把原话丢了', (c) => {
  swap(c, HV, "  if (!summary) summary = localSummary(key, base.atText, it.title, raw);",
    "  /* 总结不出来就算了 */");
}, '原话没丢');

/* ---------- 需求 4：全部完成 → 自动重排 ---------- */

// 8~11. 「全部完成」四个条件，少一个都会误判
await shouldCatch('漏掉"今天有安排"', (c) => {
  swap(c, HV, "  if (!rows.length) return false;", "  /* 没安排也算全做完了 */");
}, '今天没安排 → 不算全部完成');

await shouldCatch('漏掉"无待办"', (c) => {
  swap(c, HV, "  if (rows.some(r => r.status === 'todo')) return false;", "  /* 有待办也算 */");
}, '有 todo → 不算全部完成');

await shouldCatch('漏掉"无欠账"（会每天重排两次）', (c) => {
  swap(c, HV, /  const overdue = pw\.todayQueue\(30\)\.filter\(q => q\.overdue\);\r?\n  if \(overdue\.length\) return false;\r?\n/, "");
}, '有欠账 → 不算');

await shouldCatch('漏掉"台账非空"（静止状态天天被判全做完）', (c) => {
  swap(c, HV, "  return listOf(key).length > 0;", "  return true;");
}, '台账空 → 不算');

// 12. 一天重排多次 —— 勾一个任务跑一次模型，一晚上烧几十次调用
await shouldCatch('一天可以重排多次', (c) => {
  swap(c, HV, "  if (!opt.force && st.lastAllDone && st.lastAllDone.date === t0) {", "  if (false) {");
}, '第二次：跳过');

// 13. AI 走不通就干脆不排 —— 欠账不会因为连不上网而消失
await shouldCatch('AI 走通不了就不排了', (c) => {
  swap(c, HV, "    const n = localRoll(goal);", "    const n = 0;");
}, '仍然改了');

/* ---------- "无需确认" ≠ "悄悄删我任务" ---------- */

await shouldCatch('自动模式把砍任务也落地了', (c) => {
  swap(c, HV, "const AUTO_OPS = { move: 1, resize: 1, note: 1 };",
    "const AUTO_OPS = { move: 1, resize: 1, note: 1, drop: 1 };");
}, '没有**落地');

await shouldCatch('自动模式把顺延期限也落地了', (c) => {
  swap(c, HV, "const AUTO_OPS = { move: 1, resize: 1, note: 1 };",
    "const AUTO_OPS = { move: 1, resize: 1, note: 1, defer: 1 };");
}, '截止日没变');

// 进 pending 的没落进队列 → 弹了窗、队列里却没有 → 每次进首页重复问同一条
await shouldCatch('pending 只回给调用方，不进队列', (c) => {
  swap(c, HV, "    pw.setReplan({ pending: cur.slice(-MAX_PENDING) });", "    /* 不进队列 */");
}, 'pending 当时就落进队列了');

await shouldCatch('顺延天数不封顶', (c) => {
  swap(c, HV, "  if (total > 90) return 0;", "  if (false) return 0;");
}, '累计顺延封顶 90 天');

/* ---------- 需求 5：跨天兜底 ---------- */

await shouldCatch('首次启动也跑兜底重排（刚装 App 没有"昨天"）', (c) => {
  swap(c, HV, "  if (first && !opt.force) return { ok: true, skipped: 'first-run' };", "  /* 首启也排 */");
}, '首次启动：不跑兜底重排');

await shouldCatch('兜底回溯不限天数（一周没开就连补 7 次）', (c) => {
  swap(c, HV, "  for (let k = 1; k <= 3; k++) {", "  for (let k = 1; k <= 30; k++) {");
}, '回溯只到 3 天');

/* ---------- 需求 6：信息不足先问 ---------- */

await shouldCatch('不分"有没有速度基线"', (c) => {
  swap(c, HV, "  if (donePomo < 3) {", "  if (false) {");
}, '完成番茄 < 3 → 要问');

await shouldCatch('不分"近 7 天有没有真学"', (c) => {
  swap(c, HV, "  if (week <= 0) {", "  if (false) {");
}, '近 7 天 0 分钟 → 要问');

await shouldCatch('不分"有没有人说过原因"', (c) => {
  swap(c, HV, "dailylog.shortStreak(gid) >= 1", "dailylog.shortStreak(gid) >= 99");
}, '连续没做完 + 没说过原因');

// 信息不足还硬排 —— 拿半截数据排出来的东西只会更离谱
await shouldCatch('信息不足也硬排', (c) => {
  swap(c, HV, "  if (need.need && !lastNote()) {", "  if (false) {");
}, '信息不足时**不硬排**');

await shouldCatch('问来的意见没进上下文（白问）', (c) => {
  swap(c, HV, "  if (note) parts.push('【本人最新意见（最高优先级）】' + note);", "  /* 不用他的意见 */");
}, '意见进了模型上下文');

await shouldCatch('不记上次重排结果（闭环断，会来回横跳）', (c) => {
  swap(c, HV, "  const lb = lastBlock();", "  const lb = '';");
}, '下一次重排读到了上次的结果');

await shouldCatch('空意见也会覆盖掉上一条', (c) => {
  swap(c, HV, "  if (!v) return '';", "  /* 空的也存 */");
}, '空意见不覆盖');

/* ---------- 需求 1：完成弹窗 ---------- */

await shouldCatch('弹窗文案被改掉', (c) => {
  swap(c, DLG, "      title: '恭喜你完成任务',", "      title: '已完成',");
}, '恭喜你完成任务');

await shouldCatch('返回键不收弹窗（点了返回直接退页面）', (c) => {
  swap(c, HOME, "    if (this.doneDlgOn && this.$refs.doneDlg) { this.$refs.doneDlg.close(); return true }",
    "    /* 不拦返回键 */");
}, '返回键先收完成弹窗');

await shouldCatch('取消完成也抛"完成了"（撤销变成完成）', (c) => {
  swap(c, SL, "      if (r.done) this.$emit('done', row)", "      this.$emit('done', row)");
}, '只在"勾完成"时抛 done');

/* ---------- AI 分项开关 ---------- */

await shouldCatch('额外收获总结不受分项开关管', (c) => {
  swap(c, GATE, "    key: 'harvest',", "    key: 'harvestX',");
}, 'ai-gate 登记了 harvest 项');

restore();
console.log('');
console.log(fail === 0 ? '反向测试全部通过（护栏真的会红）' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);

})();

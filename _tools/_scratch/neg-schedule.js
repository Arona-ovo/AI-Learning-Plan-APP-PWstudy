// 反向测试：故意把「取消勾选回滚」改坏，确认 check-schedule.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ check-schedule.js 的收尾在 async IIFE 里（CJS 没有顶层 await）：同步 require
//    返回时一条断言都还没跑 —— 不等就恒绿（假绿）。所以这里等"两拍"还不够，
//    得轮询等 exited / exitCode（链里夹了 setTimeout 宏任务，走完六步收工对话要 3.7s）。
// ⚠️ async IIFE 里的 throw 会变成 promise rejection，外面的 try/catch 接不到 →
//    进程带着未捕获 rejection 崩掉。所以 process.exit 桩**绝不 throw**，只记码。
// ⚠️ 护栏崩了 ≠ 报红（崩溃会被误判成"抓到"）→ 断言退出码与红条数都要看。
// ⚠️ 会临时改坏源文件 —— 别跟 run-all 或其他护栏并发跑（第 23 条）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const U = (rel) => path.join(ROOT, 'uniapp-PWstudy', rel);
const CHECK = path.join(ROOT, '_tools', 'check-schedule.js');

const FILES = [
  'utils/pwstore.js',
  'utils/schedule.js',
  'pages/home/home.vue',
  'components/schedule-list/schedule-list.vue',
  'pkgPlan/pages/calendar/calendar.vue'
];
const orig = {};
FILES.forEach(f => { orig[f] = fs.readFileSync(U(f), 'utf8'); });

/** 跑一次 check，收退出码 + 输出。exit 与 exitCode 两条口径都要收 */
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
  while (!exited && !process.exitCode && Date.now() - t0 < 12000) {
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
  const cur = {};
  FILES.forEach(f => { cur[f] = fs.readFileSync(U(f), 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    // 锚点失效（源码改过了）必须当成失败，不能让它把整个脚本崩掉然后看都不看
    bad(label + ' —— 注入失败：' + e.message);
    return;
  }
  FILES.forEach(f => fs.writeFileSync(U(f), cur[f], 'utf8'));
  let r;
  try { r = await runCheck(); } finally {
    FILES.forEach(f => fs.writeFileSync(U(f), orig[f], 'utf8'));
  }
  const reds = r.buf.filter(l => l.indexOf('✗') >= 0);
  const hit = r.code !== 0 && reds.length > 0
    && (!expect || r.buf.join('\n').indexOf(expect) >= 0);
  if (hit) ok(label + '（红 ' + reds.length + ' 条）');
  else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
    + (expect ? ' 期望看到「' + expect + '」' : '')
    + (r.crash ? '\n      崩了：' + r.crash.message : '')
    + (reds.length === 0 ? '\n      输出尾巴：' + r.buf.slice(-4).join(' | ') : ''));
}

/**
 * 锚点替换：换了必须真的生效，否则抛错。
 * from 可以是字符串（只换第一处）—— 单行锚点别带换行（CRLF 文件里 \n 落空）。
 */
function swap(cur, file, from, to) {
  const before = cur[file];
  cur[file] = before.replace(from, to);
  if (cur[file] === before) throw new Error('锚点没命中：' + String(from).slice(0, 70));
}

(async () => {
  /* ---------- 取消勾选回滚（2026-10-25 真机反馈） ---------- */
  // 手滑点到打勾又取消 → 紧迫度必须立刻恢复。回滚四处：donePomos / 当日统计 /
  // 台账 / 合成 session。拆哪一处都有对应的护栏断言盯着。
  await shouldCatch('取消完成完全不回滚（手滑勾一下又取消，紧迫度永远回不来）',
    c => swap(c, 'utils/pwstore.js', '    revertManualCredit(g, t);',
      '    if (false) revertManualCredit(g, t);'),
    '取消完成回滚手工勾补记的专注');

  await shouldCatch('回滚不减 donePomos（首页仍显示"还剩 0 段专注"）',
    c => swap(c, 'utils/pwstore.js', '  t.donePomos = Math.max(0, (t.donePomos || 0) - add);',
      '  t.donePomos = t.donePomos || 0;'),
    '取消完成回滚手工勾补记的专注');

  await shouldCatch('回滚不动当日统计（热力图记一笔没坐过的时长）',
    c => swap(c, 'utils/pwstore.js', '    d.focusMin = Math.max(0, (d.focusMin || 0) - (s.min || 0));',
      '    d.focusMin = d.focusMin || 0;'),
    '当日统计也跟着退');

  await shouldCatch('回滚不撤台账（重新勾上时同天同任务记两条，收工页列两遍）',
    c => swap(c, 'utils/pwstore.js', '    l.items = l.items.filter(x => x.taskId !== t.id);',
      '    if (false) l.items = l.items.filter(x => x.taskId !== t.id);'),
    '取消完成同时撤掉台账那条');

  /* ---------- 只退"勾出来的"，真坐过的不动 ---------- */
  // 回滚要认 src='manual'：不认的话真实专注（计时路径）也会被退掉 —— "做过就是做过"。
  // 这条变异在 check-schedule 里没有直接断言（那里只造了手工勾的场景），
  // 靠的是 revertManualCredit 的口径注释 + creditPomo 的 src 传参；
  // 真正守它的是 check-harvest / neg-harvest 那侧，这里只验证函数还在被调用。
  await shouldCatch('回滚入口整个被摘掉（setTaskStatus 的 done→todo 分支只剩拨状态）',
    c => swap(c, 'utils/pwstore.js',
      "  if (t.status === 'done' && status === 'todo') {",
      "  if (false) {"),
    '取消完成回滚手工勾补记的专注');

  /* ---------- 勾选后要强刷（2026-10-25 真机反馈：取消完要退出重进才刷新） ---------- */
  // pwstore 是裸对象，App 端 refresh 换新数组不保证重渲染 —— 三个挂勾选的
  // 地方都靠 $forceUpdate 治住（goal-detail 的老坑，首页/日程表/日历同款）。
  await shouldCatch('首页勾选后不强刷（取消完要退出 app 重进才刷新）',
    c => swap(c, 'pages/home/home.vue', '      this.$forceUpdate && this.$forceUpdate()', '      void 0'),
    '首页勾选后强刷');

  await shouldCatch('日程表组件勾选后自己不强刷（props 重建子组件不重渲染）',
    c => swap(c, 'components/schedule-list/schedule-list.vue',
      '      this.$forceUpdate && this.$forceUpdate()', '      void 0'),
    '日程表组件勾选后自己也要强刷');

  await shouldCatch('日历页 changed 后不强刷',
    c => swap(c, 'pkgPlan/pages/calendar/calendar.vue',
      '      this.$forceUpdate && this.$forceUpdate()', '      void 0'),
    '日历页 changed 后强刷');

  console.log(fail === 0 ? '\n反向测试全部通过（护栏不是假绿）' : '\n反向测试失败 ' + fail + ' 项 ✗');
  process.exit(fail ? 1 : 0);
})();

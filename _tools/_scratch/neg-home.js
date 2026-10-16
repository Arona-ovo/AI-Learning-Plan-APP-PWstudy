// 反向测试：故意把首页（布局驱动渲染 / 硬控屏 / 起表入口）改坏，
// 确认 check-home.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 必须**每个用例一个子进程**，不能同进程反复 require：
//    check-home.js 里 `await import(home-layout.ts)` 走的是 ESM 缓存，删 require.cache 清不掉；
//    而它依赖的 utils/settings.js 有模块级 `let cache`，于是第二次跑守卫时
//    「首次读取 = 默认」就会变成上一次残留的布局 —— 每条用例都"被抓到"，全是假绿（已踩）。
// ⚠️ spawnSync 在这个沙箱里 EBUSY，只能用异步 spawn（run-all 是同进程，不适用）。
// ⚠️ 别跟 run-all 并发跑：本脚本会临时改坏源码（第 23 条硬约束）。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(ROOT, '_tools', 'check-home.js');
const HV = path.join(ROOT, 'uniapp-PWstudy', 'pages', 'home', 'home.vue');

const backup = fs.readFileSync(HV);
function restore() { fs.writeFileSync(HV, backup); }

/** 跑一次守卫，返回 { code, buf } */
function runCheck() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath,
      ['--experimental-strip-types', CHECK],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code, buf: (out + err).split('\n') }));
  });
}

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

/** 改坏 → 跑 → 断言"被抓到"。红条数必须 > 0：一条都没有说明是脚本崩了，不是断言命中 */
async function shouldCatch(label, mutate, expect) {
  const cur = fs.readFileSync(HV, 'utf8');
  let next;
  try {
    next = mutate(cur);
  } catch (e) {
    // 锚点失效（源码改过了）必须当成失败 —— 只当警告的话会出现"什么都没测还打通过"（已踩）
    bad(label + ' —— 注入失败：' + e.message);
    return;
  }
  if (next === cur) { bad(label + ' —— 注入没生效'); return; }
  try {
    fs.writeFileSync(HV, next);
    const r = await runCheck();
    const reds = r.buf.filter(l => l.indexOf('✗') >= 0);
    const hit = r.code !== 0 && reds.length > 0
      && (!expect || r.buf.join('\n').indexOf(expect) >= 0);
    if (hit) ok(label + '（红 ' + reds.length + ' 条）');
    else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
      + (expect ? ' 期望看到「' + expect + '」' : '')
      + (reds.length === 0 ? '\n      输出尾巴：' + r.buf.slice(-4).join(' | ') : ''));
  } finally {
    restore();   // 无论如何都还原，别把改坏的源码留在工作区
  }
}

const swapIn = (s, from, to) => {
  const crlf = s.indexOf('\r\n') >= 0;
  const f = crlf ? from.split('\n').join('\r\n') : from;
  const t = crlf ? to.split('\n').join('\r\n') : to;
  const next = s.replace(f, t);
  if (next === s) throw new Error('锚点没命中：' + from.slice(0, 70));
  return next;
};

(async () => {
  console.log('反向测试：check-home.js 应该抓到下面这些坏法');
  console.log('');

  // ---- 0. 元测试：基线必须是绿的（不然下面的"红"可能是别的东西弄红的）----
  {
    restore();
    const r = await runCheck();
    if (r.code === 0) ok('基线：没改坏时 check-home.js 全绿');
    else bad('基线就不是绿的（code=' + r.code + '），下面的结果不可信：'
      + r.buf.filter(l => l.indexOf('✗') >= 0).slice(0, 5).join(' | '));
  }

  // ---- 1. 硬控屏 ----
  await shouldCatch('不再硬控（计时中还能刷任务列表分心）', (s) =>
    swapIn(s, '<view v-if="locked" class="lock">', '<view v-if="false" class="lock">'),
  '计时中走硬控分支 locked');

  await shouldCatch('空闲态不再收在 v-else 里', (s) =>
    swapIn(s, '<block v-else>', '<block>'),
  '空闲态整块收在 v-else 里');

  await shouldCatch('硬控屏改回直吃 remainSec（正计时卡在 00:00）', (s) =>
    swapIn(s, 'class="lock-time">{{ lockTime }}', 'class="lock-time">{{ fmtMMSS(cur.remainSec) }}'),
  '硬控屏显示剩余时间');

  await shouldCatch('点计时环不再进全屏专注页', (s) =>
    swapIn(s, 'class="lock-ring" :class="{ \'lock-ring-run\': running }" @tap="goFocus()"',
      'class="lock-ring" :class="{ \'lock-ring-run\': running }"'),
  '点计时环进全屏专注页');

  await shouldCatch('硬控屏丢了「放弃」出口', (s) =>
    swapIn(s, '@tap="confirmGiveUp"', '@tap="noop"'),
  '硬控屏有放弃');

  // ---- 2. 布局驱动渲染 ----
  await shouldCatch('抽屉卡片区改回遍历 cardOrder（卡片重复渲染）', (s) =>
    swapIn(s, 'v-for="(id, i) in restOrder"', 'v-for="(id, i) in cardOrder"'),
  '抽屉卡片区按 restOrder 遍历渲染');

  await shouldCatch('.mod-list 改名（拖拽测量与位移全落空）', (s) =>
    swapIn(s, 'class="mod-list"', 'class="mod-list2"'),
  '卡片区包在 .mod-list 里');

  await shouldCatch('删掉 goal 卡片分支（模块还在但渲染不出来）', (s) =>
    swapIn(s, `v-else-if="id === 'goal'"`, `v-else-if="id === 'goalx'"`),
  '卡片分支');

  await shouldCatch('紧迫度卡不再渲染 urgency-meter', (s) =>
    swapIn(s, '<urgency-meter :u="u" @help="explainUrgency" />', ''),
  '紧迫度卡渲染 urgency-meter 组件');

  await shouldCatch('丢掉自定义顶栏', (s) =>
    swapIn(s, '<float-navbar title="PWstudy"', '<float-navbar-x title="PWstudy"'),
  '有自定义顶栏');

  // ---- 3. 起表入口收窄 ----
  await shouldCatch('focusUrl 里塞回 auto 起表参数', (s) =>
    swapIn(s, "      return '/pkgPlan/pages/focus/focus'",
      "      q.push('auto=1')\n      return '/pkgPlan/pages/focus/focus'"),
  'focusUrl 不带任何 auto 起表参数');

  await shouldCatch('goFocus 直接起表（带 auto=1）', (s) =>
    swapIn(s, 'uni.navigateTo({ url: this.focusUrl() })',
      "uni.navigateTo({ url: this.focusUrl() + '&auto=1' })"),
  'home.vue 里没有任何 auto=1 跳转');

  await shouldCatch('quickStart 不再与卡片同一落点', (s) =>
    swapIn(s, '    quickStart() {\n      this.goFocus()\n    },',
      '    quickStart() {\n      this.startFor(this.focusTask)\n    },'),
  'quickStart 与点卡片同一落点');

  // ---- 4. 脚本口径 ----
  await shouldCatch('不再导入 home-layout.ts（显隐没了唯一来源）', (s) =>
    swapIn(s, "import * as layout from '../../utils/home-layout.ts'",
      "import * as layout from '../../utils/home-layout-x.ts'"),
  '导入 utils/home-layout.ts');

  await shouldCatch('cardOrder 不再由 layoutIds 派生', (s) =>
    swapIn(s, '      const ids = this.layoutIds || []\n      if (this.editing) return ids',
      '      const ids = []\n      if (this.editing) return ids'),
  'cardOrder 由当前布局派生');

  await shouldCatch('refresh 里不同步布局（收纳后要重进才生效）', (s) =>
    swapIn(s, '      this.syncLayout()\n', ''),
  'refresh 里同步一次模块');

  await shouldCatch('卡片间距从 .mod-wrap 上拿掉（整页卡片贴一起）', (s) =>
    swapIn(s, '.mod-wrap { position: relative; margin-bottom: 20rpx; }',
      '.mod-wrap { position: relative; }'),
  '卡片间距 20rpx（.mod-wrap）');

  restore();
  const back = await runCheck();
  console.log(back.code === 0 ? '还原后仍是绿 ✓'
    : '还原后不绿 ✗ ' + back.buf.filter(l => l.indexOf('✗') >= 0).join(' | '));
  if (back.code !== 0) fail++;
  console.log(fail ? '\n反向测试有问题 ' + fail + ' 项 ✗'
    : '\n反向测试全部通过 ✓（每条坏法都被抓到了）');
  process.exit(fail ? 1 : 0);
})();

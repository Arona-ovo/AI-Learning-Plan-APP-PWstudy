// 反向测试：故意把弹窗配坏，确认 check-dialog.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 同进程 require 而不是起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
// ⚠️ 最后一条用例改的是**护栏自己**（PAGES_DIRS），那是"漏扫目录"的元测试：
//    pkgPlan 以前就漏在那儿，专注页 / 目标详情 / 向导页三处 showModal 长期没人管。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const U = (rel) => path.join(ROOT, 'uniapp-PWstudy', rel);
const CHECK = path.join(ROOT, '_tools', 'check-dialog.js');
const APP = U('App.vue');
const DLG = U('components/app-dialog/app-dialog.vue');
const FOCUS = U('pkgPlan/pages/focus/focus.vue');
const GD = U('pkgPlan/pages/goal-detail/goal-detail.vue');
const WIZ = U('pkgPlan/pages/wizard/wizard.vue');

// 注入的坏代码会在 check-dialog 第 11 段"真实执行 customMinutes"时真跑 uni.showModal。
// 沙箱里没有 uni，不塞桩会 TypeError —— 那是脚本崩，不是断言命中，会假绿。
global.uni = Object.assign(global.uni || {}, {
  showModal: () => {},
  showActionSheet: () => {},
  showToast: () => {}
});

const FILES = [CHECK, APP, DLG, FOCUS, GD, WIZ];
const backup = {};
FILES.forEach(f => { backup[f] = fs.readFileSync(f); });
function restore() {
  Object.keys(backup).forEach(f => fs.writeFileSync(f, backup[f]));
}

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  delete require.cache[require.resolve(path.join(ROOT, '_tools', 'lib', 'load.js'))];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const buf = [];
  let code = 0, exited = false;
  process.exitCode = 0;
  process.exit = (c) => { code = (c == null ? 0 : c); exited = true; const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) { restore(); throw e; } }
  process.exit = realExit;
  console.log = realLog;
  console.error = realErr;
  const c = code || process.exitCode || 0;
  process.exitCode = 0;
  return { code: c, exited: exited, buf: buf };
}

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

/** 改坏 → 跑 → 断言"被抓到"。红条数必须 > 0：一条都没有说明是脚本崩了，不是断言命中 */
function shouldCatch(label, mutate, expect) {
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
  const r = runCheck();
  const reds = r.buf.filter(l => l.indexOf('✗') >= 0);
  const hit = r.code !== 0 && reds.length > 0
    && (!expect || r.buf.join('\n').indexOf(expect) >= 0);
  if (hit) ok(label + '（红 ' + reds.length + ' 条）');
  else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
    + (expect ? ' 期望看到「' + expect + '」' : '')
    + (reds.length === 0 ? '\n      输出尾巴：' + r.buf.slice(-4).join(' | ') : ''));
  restore();
}

/** 反向的反向：确认"某个目录被漏扫时护栏会真的看不见"（证明那条目录是承重墙） */
function shouldMiss(label, mutate) {
  restore();
  const cur = {};
  FILES.forEach(f => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    bad(label + ' —— 注入失败：' + e.message);
    restore();
    return;
  }
  FILES.forEach(f => fs.writeFileSync(f, cur[f]));
  const r = runCheck();
  if (r.code === 0) ok(label + '（漏扫后确实查不出来 —— 说明这条目录必须留着）');
  else bad(label + ' —— 漏扫了居然还能抓到：code=' + r.code);
  restore();
}

/**
 * 锚点替换：换了必须真的生效，否则抛错
 * ⚠️ 工作区里混着 CRLF 与 LF —— 多行锚点写 \n 会在 CRLF 上全部落空（已踩过两次）。
 *    按目标文件自动转换。
 */
function swap(cur, file, from, to) {
  const before = cur[file];
  const crlf = before.indexOf('\r\n') >= 0;
  const f = crlf ? from.split('\n').join('\r\n') : from;
  const t = crlf ? to.split('\n').join('\r\n') : to;
  const next = before.replace(f, t);
  if (next === before) throw new Error('锚点没命中：' + from.slice(0, 60));
  cur[file] = next;
}

const SHOW_MODAL = "      uni.showModal({ title: 'x', content: 'y' });";

console.log('反向测试：check-dialog.js 应该抓到下面这些坏法');
console.log('');

// ---- 1. 页面又开始用系统弹窗 ----
shouldCatch('专注页「自定义时长」退回系统 showModal', (c) => {
  swap(c, FOCUS, '    customMinutes() {', '    customMinutes() {\n' + SHOW_MODAL);
}, 'focus.vue 未调用系统弹窗');

shouldCatch('专注页切音色退回系统 showActionSheet', (c) => {
  swap(c, FOCUS, '    cycleNoise() {', '    cycleNoise() {\n      uni.showActionSheet({ itemList: [] });');
}, 'focus.vue 未调用系统弹窗');

shouldCatch('专注页「放弃专注」退回系统 showModal', (c) => {
  swap(c, FOCUS, '    confirmGiveUp() {', '    confirmGiveUp() {\n' + SHOW_MODAL);
}, 'focus.vue 未调用系统弹窗');

shouldCatch('目标详情「砍掉任务」退回系统 showModal', (c) => {
  swap(c, GD, '    askDrop(t) {', '    askDrop(t) {\n' + SHOW_MODAL);
}, 'goal-detail.vue 未调用系统弹窗');

shouldCatch('规划向导「放弃规划」退回系统 showModal', (c) => {
  swap(c, WIZ, '    doAbandon() {', '    doAbandon() {\n' + SHOW_MODAL);
}, 'wizard.vue 未调用系统弹窗');

// ---- 2. 自定义时长的校验行为 ----
shouldCatch('自定义时长不用 input 模式（输入框根本不出现）', (c) => {
  swap(c, FOCUS, "        mode: 'input',", "        mode: 'confirm',");
}, 'input 模式');

shouldCatch('越界时把弹窗关掉（用户得重填一遍）', (c) => {
  swap(c, FOCUS,
    "          this.dlg.error = '请输入 10-120 的整数'\n          return",
    "          this.dlg.show = false\n          return");
}, '弹窗不关');

shouldCatch('越界不校验（7 分钟也能起表）', (c) => {
  swap(c, FOCUS, '        if (!(n >= 10 && n <= 120)) {', '        if (false) {');
}, '越界不改 minutes');

shouldCatch('越界不给提示（静默失败）', (c) => {
  swap(c, FOCUS, "          this.dlg.error = '请输入 10-120 的整数'", "          this.dlg.error = ''");
}, 'dlg.error 就地提示');

shouldCatch('非法值照样写进时长选项', (c) => {
  swap(c, FOCUS, '        this.minutes = n\n        return', '        return');
}, 'minutes = 50');

// ---- 3. 尺寸 / 安全区适配被拆掉 ----
shouldCatch('.pop-card 去掉高度上限（矮屏/横屏顶出屏幕）', (c) => {
  swap(c, APP, '  max-height: 100%;\n', '');
}, '高度上限');

shouldCatch('.pop-card 去掉宽度上限（平板被拉成横幅）', (c) => {
  swap(c, APP, '  max-width: 640rpx;\n', '');
}, '宽度上限');

shouldCatch('.pop-card 超高时不滚（确认按钮被挤出屏幕）', (c) => {
  swap(c, APP, '  overflow-y: auto;\n  overflow-x: hidden;', '  overflow-x: hidden;');
}, '自己滚');

shouldCatch('.pop-mask 不叠 --safe-bottom（安卓 env 常为 0，等于没留）', (c) => {
  swap(c, APP,
    '  padding: 24rpx 24rpx calc(24rpx + var(--safe-bottom, 0px) + constant(safe-area-inset-bottom));\n' +
    '  padding: 24rpx 24rpx calc(24rpx + var(--safe-bottom, 0px) + env(safe-area-inset-bottom));',
    '  padding: 24rpx 24rpx calc(24rpx + constant(safe-area-inset-bottom));\n' +
    '  padding: 24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));');
}, '--safe-bottom');

shouldCatch('.pop-mask 不认安全区（手势条压住弹窗底部）', (c) => {
  swap(c, APP,
    '  padding: 24rpx 24rpx calc(24rpx + var(--safe-bottom, 0px) + constant(safe-area-inset-bottom));\n' +
    '  padding: 24rpx 24rpx calc(24rpx + var(--safe-bottom, 0px) + env(safe-area-inset-bottom));',
    '  padding: 24rpx 24rpx 24rpx;');
}, '安全区');

shouldCatch('.dlg-sheet 菜单项多了不夹高度', (c) => {
  swap(c, DLG, '  max-height: 540rpx;\n', '');
}, '高度上限');

shouldCatch('.dlg-sheet 项多了不滚', (c) => {
  swap(c, DLG, '  overflow-x: hidden;\n  overflow-y: auto;', '  overflow-x: hidden;');
}, '自己滚');

// ---- 4. 元测试：目录漏扫 ----
shouldMiss('PAGES_DIRS 漏掉 pkgPlan（专注页的系统弹窗就没人管了）', (c) => {
  swap(c, CHECK,
    "['pages', 'pkgPlan/pages', 'pkgStudy/pages', 'pkgManage/pages']",
    "['pages', 'pkgStudy/pages', 'pkgManage/pages']");
  swap(c, FOCUS, '    customMinutes() {', '    customMinutes() {\n' + SHOW_MODAL);
});

restore();
console.log('');
console.log(fail === 0 ? '反向测试全部通过（护栏真的会红）' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);

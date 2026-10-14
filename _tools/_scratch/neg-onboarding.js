// 反向测试：故意把新手引导配坏，确认 check-onboarding.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 同进程 require 而不是起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
// ⚠️ process.exit() 与 process.exitCode 两条退出口径都要收（有的守卫只写后者）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(ROOT, '_tools', 'check-onboarding.js');
const ONB = path.join(ROOT, 'uniapp-PWstudy', 'utils', 'onboarding.js');
const HOME = path.join(ROOT, 'uniapp-PWstudy', 'pages', 'home', 'home.vue');
const MASK = path.join(ROOT, 'uniapp-PWstudy', 'components', 'onboarding-mask', 'onboarding-mask.vue');
const SETTINGS = path.join(ROOT, 'uniapp-PWstudy', 'pkgManage', 'pages', 'settings', 'settings.vue');
const EN = path.join(ROOT, 'uniapp-PWstudy', 'utils', 'i18n-en.js');

const FILES = [ONB, HOME, SETTINGS, EN, MASK];
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

/**
 * 锚点替换：换了必须真的生效，否则抛错
 * ⚠️ 工作区里 home.vue 是 CRLF、别的文件是 LF —— 多行锚点写 \n 会在 CRLF 上全部落空
 *    （已踩过：stopGuide / 返回键两条用例长期"注入失败"）。按目标文件自动转换。
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

console.log('反向测试：check-onboarding.js 应该抓到下面这些坏法');
console.log('');

// 1. 步骤表里混回背单词内容
shouldCatch('步骤文案里出现「查词」', (c) => {
  swap(c, ONB, "title: '番茄钟：计时从这里开始',", "title: '番茄钟：查词与计时',");
}, '查词');

// 2. 页面内锚点被改名（量不到 → 那一步会静默消失）
// ⚠️ 锚点别带 \n：工作区里的文件可能是 CRLF，写 \n 会全部落空（已踩过）
shouldCatch('首页的 class 改了（.focus-card 不再存在）', (c) => {
  swap(c, ONB, "target: { sel: '.focus-card' }", "target: { sel: '.focus-card-x' }");
}, 'focus');

// 3. 子组件内的锚点：ref 名改了
shouldCatch('ref 名改了（ref="tabbar" 不存在）', (c) => {
  swap(c, ONB, "target: { ref: 'tabbar', sel: '.ftb' }", "target: { ref: 'tabbarX', sel: '.ftb' }");
}, 'tabbar');

// 4. 量不到时不再自动跳过 —— 用户会被永远卡在遮罩里
shouldCatch('量不到矩形时不跳过（会卡死）', (c) => {
  swap(c, HOME,
    "if (!rect || !rect.width || !rect.height) { this.guideAdvance(); return }",
    "if (!rect || !rect.width || !rect.height) { this.gdStep = step; return }");
}, '自动跳过');

// 5. stopGuide 里落盘 —— 番茄一起表把引导顶掉，就再也不会重放了
shouldCatch('stopGuide 也记了完成', (c) => {
  swap(c, HOME,
    "    stopGuide() {\n      this.gdOn = false",
    "    stopGuide() {\n      try { onboarding.finish() } catch (e) {}\n      this.gdOn = false");
}, '不记完成');

// 6. endGuide 忘了落盘 —— 每次进首页都重放
shouldCatch('endGuide 忘了落盘', (c) => {
  swap(c, HOME, "try { onboarding.finish() } catch (e) {}", "/* 忘了落盘 */");
}, '落盘');

// 7. 返回键没收引导 —— 按返回会直接退出 App
shouldCatch('返回键不收引导', (c) => {
  swap(c, HOME, "if (this.gdOn) { this.endGuide(); return true }\n", "");
}, '返回键');

// 8. 首页压根没渲染遮罩
shouldCatch('首页没渲染 onboarding-mask', (c) => {
  swap(c, HOME, "<onboarding-mask", "<view class=\"ob-mask-x\"");
}, 'onboarding-mask');

// 9. 设置页「重看」不跳回首页 —— 点了像没反应
shouldCatch('设置页重看不跳回首页', (c) => {
  swap(c, SETTINGS,
    "try { uni.switchTab({ url: '/pages/home/home' }) } catch (e) {}",
    "/* 忘了跳回去 */");
}, '跳回首页');

// 10. 少一条英文译文（遮罩是 $t(step.title) 动态取键，check-i18n 扫不到这类）
shouldCatch('步骤文案缺英文', (c) => {
  swap(c, EN, "'欢迎使用 PWstudy':", "'欢迎使用 PWstudy ':");
}, '英文译文');

// ---- 屏幕尺寸 / 横竖屏 / 箭头（2026-10-14 补的那批）----
// 11. 步骤数超上限：用户明确要求 3-5 步
shouldCatch('步骤加到 6 步（超出 3-5 步）', (c) => {
  swap(c, ONB, "  {\n    id: 'tabbar',", "  {\n    id: 'edit',\n    title: '编辑首页：卡片自己排',\n    body: '点「编辑首页」可以拖动卡片。',\n    target: { sel: '.foot-link' }\n  },\n  {\n    id: 'tabbar',");
}, '3-5 步');

// 12. 转屏后不重排：尺寸只在 created 读一次
shouldCatch('遮罩不订阅窗口尺寸变化', (c) => {
  swap(c, MASK, "      uni.onWindowResize(this._onResize);", "      /* 忘了订阅 */");
}, '窗口尺寸');

// 13. 订阅了不卸载解绑 —— 页面走了还在收事件
shouldCatch('尺寸监听不解绑', (c) => {
  swap(c, MASK, "      uni.offWindowResize(this._onResize);", "      /* 忘了解绑 */");
}, '解绑');

// 14. 挖洞不夹回视口：目标半露在外时洞跑到屏幕外
shouldCatch('挖洞不夹回视口', (c) => {
  swap(c, MASK,
    "      const l = Math.max(0, Math.min(b.left, this.sw - 1));\n      const t = Math.max(0, Math.min(b.top, this.sh - 1));",
    "      const l = b.left;\n      const t = b.top;");
}, '夹回视口');

// 15. 上下都放不下时不居中 —— 气泡飞出屏幕
shouldCatch('放不下时不居中兜底', (c) => {
  swap(c, MASK,
    "        side = 'center';",
    "        side = 'below';");
}, '居中');

// 16. 箭头删掉
shouldCatch('删掉指示箭头', (c) => {
  swap(c, MASK, 'class="gd-arrow"', 'class="gd-arrow-x"');
}, '指示箭头');

// 17. 目标滚出视口不滚回来 —— 那一步被整步吞掉
shouldCatch('目标不在视口时不滚进视口', (c) => {
  swap(c, HOME, "uni.pageScrollTo({ selector: t.sel, duration: 200 })", "/* 忘了滚 */");
}, '滚进视口');

// 18. 转屏后页面不重测
shouldCatch('resize 后不重新量目标', (c) => {
  swap(c, HOME, 'setTimeout(() => { if (this.gdOn) this.measureStep() }, 160)', '/* 不重测 */');
}, '重新量目标矩形');

restore();
console.log('');
console.log(fail === 0 ? '反向测试全部通过（护栏真的会红）' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);

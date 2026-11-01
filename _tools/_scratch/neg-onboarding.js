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
  swap(c, ONB, "title: '开始专注：点这个大圆',", "title: '专注计时：查词与计时',");
}, '查词');

// 2. 页面内锚点被改名（量不到 → 那一步会静默消失）
// ⚠️ 锚点别带 \n：工作区里的文件可能是 CRLF，写 \n 会全部落空（已踩过）
shouldCatch('首页的 class 改了（.focus-card 不再存在）', (c) => {
  swap(c, ONB, "target: { sel: '.focus-card' }", "target: { sel: '.focus-card-x' }");
}, 'focus');

// 3. 子组件内的锚点：ref 名改了
//    ⚠️ 2026-11-01 重做引导后，步骤表里已经没有 ref 锚点了（底部导航那步换成了填 API，
//    AI 那步现在指向首页的 .ai-card），但"ref 指向的子组件里量不到"这条通路还活着。
//    所以这里把欢迎步的居中目标改成"指向一个不存在的 ref"来测这条通路，
//    真实场景就是"哪天给某一步加了 ref 高亮、ref 名却写错了"。
shouldCatch('ref 名改了（ref="tabbar" 不存在）', (c) => {
  swap(c, ONB, "    target: null,\n    art: 'flow'", "    target: { ref: 'tabbarX', sel: '.ftb' },\n    art: 'flow'");
}, 'tabbarX');

// 4. 量不到时既不再跳过、也不居中 —— 用户会被永远卡在遮罩里
//    （现在的出口在 guideMiss()：有图就居中讲，没图才跳过。两样都不做就是死路）
shouldCatch('量不到目标时既不跳过也不居中（会卡死）', (c) => {
  swap(c, HOME,
    "      if (step && step.art) { this.guideShow(step, null); return }\n      this.guideAdvance()",
    "      if (step && step.art) { this.guideShow(step, null); return }\n      this.gdStep = step");
}, '自动跳到下一步');

// 5. stopGuide 里落盘 —— 专注一起表把引导顶掉，就再也不会重放了
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
  swap(c, ONB, "  {\n    id: 'ai',", "  {\n    id: 'edit',\n    title: '编辑首页：卡片自己排',\n    body: '点「编辑首页」可以拖动卡片。',\n    target: { sel: '.foot-link' }\n  },\n  {\n    id: 'ai',");
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

// 17. 目标不在位不挪过去 —— 那一步要么整步被吞，要么洞落在错的地方
//     现在滚动走 _solve()，一轮挪不准还会继续收敛
shouldCatch('目标不在位时不滚动', (c) => {
  swap(c, HOME,
    "try { uni.pageScrollTo({ scrollTop: want, duration: 180 }) } catch (e) {}",
    "void want");
}, '先滚过去');

// 18. 转屏后页面不重测
shouldCatch('resize 后不重新量目标', (c) => {
  swap(c, HOME, 'setTimeout(() => { if (this.gdOn) this.measureStep() }, 160)', '/* 不重测 */');
}, '重新量目标矩形');

// 19. 末步的行动按钮没接线 —— 「现在去填」点了没反应（那一步白讲）
shouldCatch('遮罩的 action 没接到首页', (c) => {
  swap(c, HOME, '@action="guideAction"', '/* 没接 */');
}, 'guideAction');

// 20. 行动按钮的文案没有英文（遮罩里是 $t(step.actionText)，check-i18n 扫不到）
shouldCatch('行动按钮文案缺英文', (c) => {
  swap(c, EN, "'现在去填': 'Fill it in now',", "'现在去填X': 'Fill it in now',");
}, '英文译文');

restore();

// ---- 每步都有画面 / 能回退（2026-11-01 补的那批）----
// 21. 某一步的 art 写了组件不认识的类型 —— 那一步退成居中时只剩一个空图框
shouldCatch('art 写了遮罩不认识的类型', (c) => {
  swap(c, ONB, "art: 'key'", "art: 'none'");
}, '示意图');

// 22. 上一步没接线 —— 按钮点了没反应，用户还是回不去
shouldCatch('「上一步」没接到首页', (c) => {
  swap(c, HOME, '@prev="guidePrev"', '/* 没接 */');
}, '首页接了 prev');

// 23. 兜底锚点被删 —— 收工键被底栏压住时那一步又退成纯文字
shouldCatch('收工那步的兜底锚点被删', (c) => {
  swap(c, ONB, "    fallback: '.task-card',\n", "");
}, '兜底锚点');

// 24. 判"看得见"又退回"必须整块在屏内" —— 底部那步永远退成纯文字
shouldCatch('_inView 又要求整块可见', (c) => {
  swap(c, HOME,
    "return seen >= Math.min(rect.height, 88) && seen / rect.height >= 0.6",
    "return rect.top >= 8 && rect.top + rect.height <= vh - 8");
}, '纯文字');

// 25. 落位线不躲悬浮顶栏 —— 洞挖到顶栏底下，用户透过洞看到的还是顶栏
shouldCatch('落位线不躲悬浮顶栏', (c) => {
  swap(c, HOME, "return Math.min(Math.max(this._navBottom() + 24, 96), cap)", "return 96");
}, '顶栏');

console.log('');
console.log(fail === 0 ? '反向测试全部通过（护栏真的会红）' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);

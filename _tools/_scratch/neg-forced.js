// 反向测试：故意把「强制模式」改坏，确认 check-forced.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 同进程 require 而不是起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
// ⚠️ process.exit() 与 process.exitCode 两条退出口径都要收（有的守卫只写后者）。
// ⚠️ 别跟 run-all 并发跑：本脚本会临时改坏源码（第 23 条硬约束）。
// ⚠️ 注入一律用**正则**：String.replace 的 from 里 \r\n 是字面量不是换行（第 24 条），
//    而这个仓库里有的文件 CRLF、有的 LF，同一个 harness 会各踩一半。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(ROOT, '_tools', 'check-forced.js');
const U = path.join(ROOT, 'uniapp-PWstudy');
const FORCED = path.join(U, 'utils', 'forced.js');
const FGSVC = path.join(U, 'utils', 'fgsvc.js');
const UTS = path.join(U, 'uni_modules', 'pwstudy-focus', 'utssdk', 'app-android', 'index.uts');
const IFACE = path.join(U, 'uni_modules', 'pwstudy-focus', 'utssdk', 'interface.uts');
const FV = path.join(U, 'pkgPlan', 'pages', 'focus', 'focus.vue');

const FILES = [FORCED, FGSVC, UTS, IFACE, FV];
const backup = {};
FILES.forEach(f => { backup[f] = fs.readFileSync(f); });
function restore() { Object.keys(backup).forEach(f => fs.writeFileSync(f, backup[f])); }

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const buf = [];
  let code = 0;
  process.exitCode = 0;
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  let crash = null;
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) crash = e; }
  process.exit = realExit;
  console.log = realLog;
  console.error = realErr;
  const c = crash ? 99 : (code || process.exitCode || 0);
  process.exitCode = 0;
  return { code: c, buf: buf, crash: crash };
}

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

/**
 * 改坏 → 跑 → 断言"被抓到"。
 * 红条数必须 > 0：一条都没有说明是脚本崩了，不是断言命中。
 * @param {(cur:Object)=>void} mutate 直接改 cur[file] 这个字符串字典
 */
function shouldCatch(label, mutate, expect) {
  restore();
  const cur = {};
  FILES.forEach(f => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    // 锚点失效（源码改过了）必须当成失败 —— 只当警告会出现"什么都没测还打通过"（已踩）
    bad(label + ' —— 注入失败：' + e.message);
    restore();
    return;
  }
  FILES.forEach(f => fs.writeFileSync(f, cur[f]));
  let r;
  try {
    r = runCheck();
  } finally {
    restore();   // 无论如何都还原，别把改坏的源码留在工作区
  }
  const reds = r.buf.filter(l => l.indexOf('✗') >= 0);
  const joined = r.buf.join('\n');
  const hit = r.code !== 0 && reds.length > 0 && (!expect || joined.indexOf(expect) >= 0);
  if (hit) ok(label + '（红 ' + reds.length + ' 条）');
  else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
    + (expect ? ' 期望看到「' + expect + '」' : '')
    + (r.crash ? ' 崩溃=' + r.crash.message : '')
    + (reds.length === 0 ? ' 输出尾巴：' + joined.slice(-260) : ''));
}

/** 按正则替换；替换**没有发生**就抛错（锚点失效 = 这条用例没测到东西） */
function sub(cur, file, re, to) {
  const before = cur[file];
  const after = before.replace(re, to);
  if (after === before) throw new Error('锚点没命中：' + re + ' @ ' + path.basename(file));
  cur[file] = after;
}

console.log('反向测试（强制模式）：故意改坏，确认 check-forced.js 抓得到');
console.log('');

/* ---------- 第 1 节：判据不许退回"或" ---------- */

shouldCatch('判据退回 (a11y || overlay) → effective 谎报已就绪', (cur) => {
  sub(cur, FORCED, /effective:\s*native\s*&&\s*svcAllowed\s*&&\s*overlay\s*&&\s*canDetect/,
    'effective: native && svcAllowed && (a11y || overlay) && canDetect');
}, '开了无障碍但没开悬浮窗');

shouldCatch('canPullBack 退回 (a11y || overlay)', (cur) => {
  sub(cur, FORCED, /canPullBack:\s*native\s*&&\s*overlay/, 'canPullBack: native && (a11y || overlay)');
}, 'canPullBack');

shouldCatch('去掉 overlay 这一项（effective 只留三项）', (cur) => {
  sub(cur, FORCED, /effective:\s*native\s*&&\s*svcAllowed\s*&&\s*overlay\s*&&\s*canDetect/,
    'effective: native && svcAllowed && canDetect');
}, 'effective');

/* ---------- 第 2 节：遮罩该盖时得盖、不该盖时别死锁 ---------- */

shouldCatch('needOverlay 失明时改回 return false（"完全没反应"的原写法）', (cur) => {
  sub(cur, UTS, /if \(fg\.length == 0\) return this\.inEpisode;/, 'if (fg.length == 0) return false;');
}, 'needOverlay');

shouldCatch('中性名单去掉系统设置页（会把用户锁在授权页外）', (cur) => {
  sub(cur, UTS, /'com\.android\.settings,' \+/, "'' +");
}, '中性名单含系统设置页');

shouldCatch('setWatch 不再并进中性名单', (cur) => {
  sub(cur, UTS, /let neutrals = NEUTRAL_CSV\.split\(','\);/, "let neutrals = ''.split(',');");
}, '中性名单并进了白名单');

shouldCatch('onTaskRemoved 不撤遮罩（划掉卡片后黑布还挂着）', (cur) => {
  sub(cur, UTS, /(override onTaskRemoved[\s\S]{0,400}?)postOverlay\(false\);/, '$1');
}, 'onTaskRemoved 第一件事必须是撤遮罩');

shouldCatch('allowCsv 改回 private（watchDiag 在顶层访问不到）', (cur) => {
  sub(cur, UTS, /^([ \t]*)allowCsv = '';/m, '$1private allowCsv = "";');
}, 'allowCsv 不能是 private');

shouldCatch('inEpisode 改回 private', (cur) => {
  sub(cur, UTS, /^([ \t]*)inEpisode = false;/m, '$1private inEpisode = false;');
}, 'inEpisode 不能是 private');

shouldCatch('interface 里丢掉"被另一个可见应用绑定"这句纠正（下一轮会走回老路）', (cur) => {
  sub(cur, IFACE, /另一个可见应用/g, '被系统绑定的服务');
}, '另一个可见应用');

shouldCatch('fgsvc 里丢掉同一句纠正', (cur) => {
  sub(cur, FGSVC, /另一个可见应用/g, '被系统绑定的服务');
}, '另一个可见应用');

/* ---------- 第 3 节：自检面板 ---------- */

// ⚠️ 字段名前带 `,"`（拼接是从第二个字段起才带逗号），锚点别写漏
// 2026-10-15：源码判空修 UTS 编译错后，ovGrant 变成 ctx != null && canDrawOverlays(ctx!)，
// 锚点跟着改（不跟 = 注入不命中 = 反向测试假"抓到不了"）
shouldCatch('watchDiag 少输出 ovGrant（看不出有没有悬浮窗权限）', (cur) => {
  sub(cur, UTS, /"ovGrant":' \+ \(ctx != null && canDrawOverlays\(ctx!\) \? '1' : '0'\) \+/, '"ovGrantX":\' + (ctx != null && canDrawOverlays(ctx!) ? \'1\' : \'0\') + ');
}, '输出字段含 ovGrant');

shouldCatch('watchDiag 少输出 ovOn（看不出遮罩挂没挂上）', (cur) => {
  sub(cur, UTS, /"ovOn":' \+ \(overlayView != null \? '1' : '0'\) \+/, '"ovOnX":\' + (overlayView != null ? \'1\' : \'0\') + ');
}, '输出字段含 ovOn');

shouldCatch('fgsvc 的布尔解析改成恒 false（诊断全是 N，等于没诊断）', (cur) => {
  sub(cur, FGSVC, /const b = \(v\) => v === 1 \|\| v === '1' \|\| v === true;/, 'const b = (v) => false;');
}, '解析成 true');

shouldCatch('interface.uts 不再声明 watchDiag', (cur) => {
  sub(cur, IFACE, /export function watchDiag\(\): string/, 'export function watchDiagX(): string');
}, 'interface.uts 声明了 watchDiag');

/* ---------- 第 4 节：引导与状态行 ---------- */

shouldCatch('forceLine 删掉"一次都没拉回来"这一档（界面继续谎报已就绪）', (cur) => {
  sub(cur, FV, /else if \(this\.forcedEscapes > 0 && this\.forcedPulls === 0\) s = '[^']*'\n/, '');
}, '一次都没拉回来');

shouldCatch('状态行又把人支去开无障碍', (cur) => {
  sub(cur, FV, /去开「显示在其他应用上层」'/, "去开「无障碍」'");
}, '指路去开悬浮窗');

shouldCatch('forceAct 不再给自检入口', (cur) => {
  sub(cur, FV, /return '自检'/, "return ''");
}, '自检');

shouldCatch('guideNextStep 又只看 c.a11y 就报已就绪', (cur) => {
  sub(cur, FV, /if \(c\.effective\) \{/, 'if (c.a11y) {');
}, '判"已就绪"看 effective');

shouldCatch('toggleForced 把悬浮窗分支挪回最后（又说成"可选"）', (cur) => {
  sub(cur, FV, /if \(!this\.overlayOk\) \{/, 'if (false) {');
}, '悬浮窗分支必须排在 a11ySafe 之前');

// 这句 toast 在 guideNextStep 与 toggleForced 里**各有一处**，必须 /g 全换 ——
// 只换第一处的话另一处还在，护栏照样绿（第 24 条："同一字符串 replace 只换第一处"）
shouldCatch('又把悬浮窗说成"可选兜底"', (cur) => {
  sub(cur, FV, /'还差「显示在其他应用上层」，不开拉不回来'/g, "'可选：再开「显示在其他应用上层」做兜底'");
}, '可选兜底');

console.log('');
if (fail === 0) console.log('反向测试全部通过：每一条都被 check-forced.js 抓住了 ✓');
else console.log('反向测试失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);

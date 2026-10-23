// _tools/check-haptic.js - 触感反馈（震动）
//
// 2026-10-16 用户要求："滑出来要有震动，然后设置里面可以加个震动开关，
// 底部的悬浮导航栏也可以加上震动。参考背单词的（AWword）。"
//
// 落在三处：底部悬浮导航栏点击、首页抽屉滑出到位、设置 › 触感反馈（总开关 + 试一下）。
// 实现在 utils/haptic.js（从 AWword 同名模块移植），开关存 settings.haptic（默认 开）。
//
// ⚠️ 一条平台硬事实：Android 的震动要 android.permission.VIBRATE。
//    它是安装时权限（不用运行时弹框），但**写在 manifest 里 → 必须重新打包 / 重打基座**，
//    老包没这个权限时 plus.device.vibrate 会抛 SecurityException。
//    所以模块里所有原生调用都 try/catch + console.warn，并把失败原因留在 lastError()
//    —— 设置页据此提示"多半要重新打包"，而不是谎报"这台设备不支持震动"。
//
// 断言分三层：源码契约（剥注释后扫）+ 行为（plus / uni 桩真跑）+ 错误形态（抛异常 / 没 API 都不炸）。
// （与 AWword 同款取舍：行为测试已覆盖"模块写错"的主要形态，不另设反向 mutate 套件。）
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
// 剥两种注释再扫：注释里提到 plus.device.vibrate 也会被正则扫到（假绿 / 假红）
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
// 取某个方法的函数体（从方法名起，到 methods 缩进级别的 "}," 止）
const block = (src, re) => { const m = src.match(re); return m ? m[0] : ''; };

const hap = R('utils/haptic.js');
const code = strip(hap);

console.log('== 1. utils/haptic.js 源码契约 ==');
assert(/export function isEnabled/.test(code), '导出 isEnabled（总开关）');
assert(/export function tick/.test(code), '导出 tick（震一下）');
assert(/export function msOf/.test(code), '导出 msOf（场景时长）');
assert(/export function setOn/.test(code), '导出 setOn（开关落盘）');
assert(/export function lastError/.test(code) && /export function hasApi/.test(code),
  '导出 lastError / hasApi（设置页据此提示"没震成"的原因）');
// 开关是一切的前提：关掉必须一次都不震，连 API 都不碰
assert(/if \(!isEnabled\(\)\) return false/.test(code), '总开关关掉直接返回（不碰任何原生 API）');
// 连点保护：滑一次抽屉能路过多次触发点，不挡就是一窝蜂；
// 而且 Android 上连续 vibrate() 会把短震叠成长震，手感全毁。
assert(/MIN_GAP/.test(code) && /now - lastAt < MIN_GAP/.test(code), '有连点保护（MIN_GAP 之内直接丢掉）');
assert(/lastAt = now/.test(code), '占位在调用之前（就算这次没震成也不该在窗口里重试）');
// 平台能力先验再调：App 走 plus.device.vibrate（能给毫秒），其余退 uni.vibrateShort
assert(/plus\.device && typeof plus\.device\.vibrate === 'function'/.test(code),
  'App 端先判 plus.device.vibrate 存在再调（拿不到就退 uni.vibrateShort）');
assert(/uni\.vibrateShort/.test(code), '非 App / 没有 plus 时退 uni.vibrateShort');
assert(/typeof uni !== 'undefined' && typeof uni\.vibrateShort === 'function'/.test(code),
  '退路也先验能力（没有就安静返回 false）');
// 原生调用的 catch 不许完全静默：真机"没震动"时控制台得有线索
assert(/catch \(e\)/.test(code) && /console\.warn\(/.test(code), '原生调用失败要 console.warn（真机"没震动"得有线索）');
// 三档场景时长：底栏点击最轻（点得频繁）、抽屉到位稍重（一次滑动只响一声）
assert(/tap: 12/.test(code) && /switch: 18/.test(code) && /drawer: 26/.test(code),
  '三档场景 12 / 18 / 26 ms（再长就不是反馈而是骚扰）');
assert(/ms < 8 \? 8 : ms/.test(code), '算出来的时长有下限（不许算出 0ms）');

console.log('== 2. 设置默认值与权限声明 ==');
const st = R('utils/settings.js');
assert(/haptic: \{ on: true \}/.test(st),
  'settings 默认值带 haptic = { on: true }（深合并，老用户自动拿到）');
// 权限只声明在 manifest（打包时生效），settings 里不重复
const mf = R('manifest.json');
assert(/android\.permission\.VIBRATE/.test(mf),
  'manifest.json 声明 android.permission.VIBRATE（没有它 Android 上根本震不动）');

console.log('== 3. 接入点 ==');
const ftb = R('components/float-tabbar/float-tabbar.vue');
assert(/import \* as haptic from '\.\.\/\.\.\/utils\/haptic\.js'/.test(ftb),
  '底部导航栏引入 haptic');
{
  const i = ftb.indexOf('go(e) {');
  const body = i > 0 ? ftb.slice(i, ftb.indexOf('\n    },', i)) : '';
  assert(body !== '' && /haptic\.tick\('tap'\)/.test(body), '点底栏震一下（tap 档）');
  // 位置：必须在"点当前 tab 直接 return"和连点保护之后 —— 那两种情况不该有反馈
  const iRet = body.indexOf('t.key === this.activeKey) return');
  const iLock = body.indexOf('this.__navLock = true');
  const iTick = body.indexOf("haptic.tick('tap')");
  assert(iRet >= 0 && iTick > iRet, '震动在"点当前 tab 已拦掉"之后（点当前页不该震）');
  assert(iLock >= 0 && iTick > iLock, '震动在连点保护之后（连点不叠震）');
  assert(/catch/.test(body), '震动包了 catch（震不动也要把页切了）');
}
const home = R('pages/home/home.vue');
assert(/import \* as haptic from '\.\.\/\.\.\/utils\/haptic\.js'/.test(home), '首页引入 haptic');
const bBuzz = block(home, /buzzDrawer\(\)\s*\{[\s\S]*?\n    \}/);
assert(bBuzz !== '' && /haptic\.tick\('drawer'\)/.test(bBuzz) && /catch/.test(bBuzz),
  'buzzDrawer 震 drawer 档且包 catch（震不动也要把抽屉拉开）');
// ⚠️ 抽屉那套上滑手势已拆（2026-10-23）：现在下面那摞卡是**页面流**，
//    震的时机从"松手提交"变成"滚到拉到位那一刻"，去抖靠 _buzzed + 滑回 0.55 才解锁。
//    语义没变：**一次来回只响一声**，拖动/滚动途中绝不每帧震。
const bSync = block(home, /syncReveal\(scrollTop\)\s*\{[\s\S]*?\n    \}/);
assert(bSync !== '', '找得到 syncReveal（抽屉拆掉后震动改由它触发）');
assert(/if \(!this\._buzzed\)[\s\S]{0,120}buzzDrawer\(\)/.test(bSync),
  '拉到位才震，且带 _buzzed 去抖（滚动途中每帧路过不会震成一窝蜂）');
assert(/p < 0\.55[\s\S]{0,80}_buzzed = false/.test(bSync),
  '滑回一半以上才解锁"已响过"（一次来回只响一声）');
assert(/revealOn === false|_buzzed = false/.test(bSync), '没有可淡入的东西时不去震');
const set = R('pkgManage/pages/settings/settings.vue');
assert(/import \* as haptic from '\.\.\/\.\.\/\.\.\/utils\/haptic\.js'/.test(set), '设置页引入 haptic');
assert(/data-k="haptic"/.test(set) && /openSec === 'haptic'/.test(set), '设置页有「触感反馈」分组');
assert(/:checked="hapticOn"/.test(set) && /setHapticOn\(e\.detail\.value\)/.test(set), '设置页有总开关');
assert(/@tap="previewHaptic"/.test(set), '设置页有「试一下」');
assert(/hapticFail/.test(set), '没震成时设置页有提示（多半是包里没打震动权限）');
assert(/haptic\.setOn\(/.test(set), '开关改动走 haptic.setOn 落盘（不自己写 settings）');

console.log('== 4. 行为：开关 / 连点 / 场景时长 / 降级 ==');
const mem = {};
const vibes = [];      // plus.device.vibrate 收到的毫秒数
const shorts = [];     // uni.vibrateShort 收到的档位
let throwNext = false;
let warnCount = 0;

const plusStub = {
  device: {
    vibrate: (ms) => {
      if (throwNext) throw new Error('android.permission.VIBRATE denied');
      vibes.push(ms);
    }
  }
};
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  vibrateShort: (o) => { shorts.push(o && o.type); }
};
const realWarn = console.warn;
console.warn = (...a) => { warnCount++; };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const settings = load('utils/settings.js');
  settings.init();
  const haptic = load('utils/haptic.js', { settings, plus: plusStub });

  assert(haptic.isEnabled() === true, '默认开着');
  assert(haptic.msOf('tap') === 12 && haptic.msOf('drawer') === 26, '场景时长 12 / 26');
  assert(haptic.msOf('bogus') === 18, '脏场景名回落 switch 档（18）');

  vibes.length = 0;
  const r1 = haptic.tick('tap');
  assert(r1 === true && vibes.length === 1, '开着 → 真的震了（返回 true，vibrate 被调用一次）');
  assert(vibes[0] === 12, 'tap → 12ms（实际 ' + vibes[0] + '）');

  // 连点：连着两次调用，第二次必须被挡掉（不是"隔一会儿再调"——那是正常应该震的）
  await sleep(90);
  vibes.length = 0;
  const r2a = haptic.tick('tap');
  const r2b = haptic.tick('tap');
  assert(r2a === true && r2b === false && vibes.length === 1,
    '连点被 MIN_GAP 挡掉（只震了 ' + vibes.length + ' 次，不叠成长震）');

  await sleep(90);
  vibes.length = 0;
  haptic.tick('drawer');
  assert(vibes[0] === 26, '抽屉档比点击重（' + vibes[0] + 'ms）');

  // ---- 错误形态 1：关掉开关 ----
  await sleep(90);
  haptic.setOn(false);
  vibes.length = 0;
  const rOff = haptic.tick('tap');
  assert(rOff === false && vibes.length === 0, '开关关掉 → 一次都不震');
  assert(settings.get().haptic.on === false, '开关改动已落盘');
  // ⚠️ 光测"关掉后没调用"不够：崩了也是没调用。所以下面必须看到"打开后又震了"
  haptic.setOn(true);
  await sleep(90);
  vibes.length = 0;
  assert(haptic.tick('tap') === true && vibes.length === 1, '重新打开 → 又震了（证明上面不是崩了）');

  // ---- 错误形态 2：原生抛异常（老包没 VIBRATE 权限就是这个）----
  await sleep(90);
  throwNext = true;
  vibes.length = 0;
  warnCount = 0;
  const rThrow = haptic.tick('tap');
  throwNext = false;
  assert(rThrow === false, '原生抛异常 → 返回 false，不把异常抛给调用方');
  assert(warnCount === 1, '原生失败要 console.warn 一条（真机控制台得有线索）');
  assert(!!haptic.lastError(), '失败原因留在 lastError（设置页据此提示需重新打包）');

  // ---- 错误形态 3：没有 plus.device，退 uni.vibrateShort ----
  await sleep(90);
  const noPlus = load('utils/haptic.js', { settings, plus: {} });
  shorts.length = 0;
  const rShort = noPlus.tick('tap');
  assert(rShort === true && shorts.length === 1, '没有 plus.device 时退 uni.vibrateShort');
  assert(shorts[0] === 'light', '12ms 映射到 light 档（实际 ' + shorts[0] + '）');

  // ---- 错误形态 4：什么都没有 → 安静 false，不炸 ----
  await sleep(90);
  const none = load('utils/haptic.js', {
    settings,
    plus: undefined,
    uni: { getStorageSync: () => undefined }
  });
  let threw = false;
  let rNone = null;
  try { rNone = none.tick('tap') } catch (e) { threw = true }
  assert(!threw && rNone === false, '两端都没有震动 API → 安静返回 false，不抛异常');
  assert(none.lastError() === 'no-api', '没有 API 时 lastError = no-api');
  assert(none.hasApi() === false, 'hasApi 如实回答"调不动"');

  console.warn = realWarn;
  console.log(fail === 0 ? '\n触感反馈全部通过' : '\n失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();

// _tools/check-forced.js - 强制模式（离开就拉回）的校验
// 运行：node _tools/check-forced.js
//
// ⚠️ 这个文件的存在理由：强制模式"看着完全没反应"已经来回好几轮了，
//    而根因一直没被发现 —— 因为我们**信了一条错的结论**：
//
//      "安卓 10 起限制后台启动 Activity，官方豁免给'由系统绑定的服务'，
//       无障碍服务正属此类，所以从服务内部 startActivity 才拉得动。"
//
//    官方《Activity security》里后台启动的豁免其实是这几条：
//      有可见窗口 / 是输入法 / **有 SYSTEM_ALERT_WINDOW** / 有系统特权 /
//      **被"另一个可见应用"的服务绑定** / 系统发的 PendingIntent。
//    无障碍服务是**我们自己这个 App** 的组件，不是"另一个可见应用" ——
//    它内部 startActivity 一样被 AMS 静默拦掉（**不抛异常**，所以 pullSelf 永远
//    返回 true、界面永远显示"已就绪"，实际一动不动）。
//
//    纠正后的定位：
//      ・悬浮窗（SYSTEM_ALERT_WINDOW）是**唯一的"手"**，也是强制模式的准入条件。
//      ・无障碍服务只剩"眼睛"的作用（系统直推前台包名，比轮询准、不用额外授权）。
//
// 守的东西：
//   1) 判据不许再退回 `(a11y || overlay)` —— 那等于"开了无障碍就不用悬浮窗"，
//      界面就会在拉不动的情况下报"已就绪"（第 1 节真跑）
//   2) 遮罩该盖的时候必须盖：失明（查不出前台是谁）≠ 合规（第 2 节）
//   3) 遮罩绝不能盖在设置 / 授权页上 —— 用户正要去开悬浮窗权限，盖上去就是死锁（第 2 节）
//   4) 用户划掉卡片后遮罩必须撤 —— 它是挂在**别的 App** 上的系统窗口（第 2 节）
//   5) 自检面板要能把每一环的实测值交出来（第 3 节真跑解析）
//   6) 引导顺序：悬浮窗排第一，不再是"可选兜底"（第 4 节）
//   7) 状态行不许谎报"已就绪"（第 4 节）
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./lib/load');

const UTS = path.join(ROOT, 'uni_modules', 'pwstudy-focus', 'utssdk', 'app-android', 'index.uts');
const UTS_IFACE = path.join(ROOT, 'uni_modules', 'pwstudy-focus', 'utssdk', 'interface.uts');
const FORCED = path.join(ROOT, 'utils', 'forced.js');
const FGSVC = path.join(ROOT, 'utils', 'fgsvc.js');
const FOCUS_VUE = path.join(ROOT, 'pkgPlan', 'pages', 'focus', 'focus.vue');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const uts = fs.readFileSync(UTS, 'utf8');
const iface = fs.readFileSync(UTS_IFACE, 'utf8');
const fd = fs.readFileSync(FORCED, 'utf8');
const fg = fs.readFileSync(FGSVC, 'utf8');
const fv = fs.readFileSync(FOCUS_VUE, 'utf8');

/** 先剥注释再扫 —— 自己的正则会命中注释（第 12 条硬约束） */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * 按**签名**切方法体（配大括号）。
 * ⚠️ 别只按函数名切：这个文件里 `setWatch` 有**两个** —— 服务类的成员方法（真正干活、
 *    里面才是白名单拼装）和外面导出的包装函数。`fnBody` 会先命中 export 那个，
 *    于是"白名单里有没有桌面"这种断言一直验的是包装函数 —— 假绿（2026-10-24 已踩）。
 */
function sigBody(src, sigRe) {
  const m = sigRe.exec(src);
  if (!m) return '';
  const j = src.indexOf('{', m.index + m[0].length);
  if (j < 0) return '';
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return '';
}

/**
 * 切出函数体（配大括号）。
 * ⚠️ 别写有界窗口（第 22 条硬约束，多插两行就假红）。
 * ⚠️ 两种形态顺序不能反（第 25 条）：先 `export function name(`，再缩进 `    name() {`。
 */
function fnBody(src, name) {
  let m = new RegExp('^[ \\t]*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + name + '\\s*\\(', 'm').exec(src);
  // UTS 的重写方法长这样： `  override onTaskRemoved(rootIntent: Intent): void {`
  // —— 带 override 的一定是**声明**，不带的多半是调用处（第 25 条的那两种形态之外）
  if (!m) m = new RegExp('^[ \\t]{2,6}override\\s+' + name + '\\s*\\(', 'm').exec(src);
  if (!m) m = new RegExp('^[ \\t]{2,6}' + name + '\\s*\\(', 'm').exec(src);
  if (!m) return '';
  const j = src.indexOf('{', m.index + m[0].length);
  if (j < 0) return '';
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return '';
}

/* ==================== 依赖袋 ====================
 * load() 按**标识符名**注入：模块新增 import 必须补这里（第 19 条硬约束）。
 */
function depsWith(over) {
  const base = {
    focus: { current: () => null, giveUp: () => null },
    apptime: {
      allowList: () => ['com.pwstudy'],
      hasA11yPermission: () => true,
      canDrawOverlays: () => true,
      hasUsagePermission: () => true,
      supported: () => true,
      foregroundPackage: () => '',
      isAllowedPkg: () => true,
      bringSelfFront: () => false
    },
    notify: { alert: () => {}, requestPermission: () => {} },
    settings: { get: () => ({ focus: { forced: true, fgservice: true, notify: true } }), save: () => {} },
    fgsvc: {
      bringToFrontSupported: () => true,
      serviceAllowed: () => true,
      serviceAlive: () => true,
      setWatch: () => true,
      watchStats: () => ({ pulls: 0, escapes: 0 }),
      resetWatchStats: () => true,
      ensureStarted: () => true,
      watchDiag: () => null,
      overlayGranted: () => false
    }
  };
  return Object.assign(base, over || {});
}

console.log('== 1. 判据：悬浮窗是准入条件，不是"或" ==');

// 真跑，不是正则 —— 这条判据被改错过整整好几轮，正则证明不了"返回结果对不对"
{
  const forced = load('utils/forced.js', depsWith());
  const noOverlay = forced.capability({ a11y: true, overlay: false });
  assert(noOverlay.effective === false,
    '开了无障碍但没开悬浮窗 → effective 必须为 false（曾经是 true，界面谎报"已就绪"）');
  assert(noOverlay.canPullBack === false, '没悬浮窗 → canPullBack 必须为 false');
  assert(noOverlay.canDetect === true, '有"眼睛"（无障碍）→ canDetect 为 true');

  const withOverlay = forced.capability({ a11y: true, overlay: true });
  assert(withOverlay.effective === true, '无障碍 + 悬浮窗 → effective 为 true');
  assert(withOverlay.canPullBack === true, '有悬浮窗 → canPullBack 为 true');

  const onlyOverlay = forced.capability({ a11y: false, overlay: true });
  assert(onlyOverlay.effective === true, '只开悬浮窗（靠 UsageStats 当眼睛）→ 也该算能拦住');
  assert(onlyOverlay.canDetect === true, 'usage 那条"眼睛"也要算进 canDetect');

  const neither = forced.capability({ a11y: false, overlay: false });
  assert(neither.effective === false, '两个都没开 → effective 为 false');

  // 判据本身必须是"与"不是"或"：抓"||"写进 canPullBack / effective 的写法
  const s = strip(fd);
  const body = fnBody(s, 'capability');
  assert(body.length > 0, '抽得到 capability 的方法体');
  assert(/canPullBack:\s*native\s*&&\s*overlay/.test(body),
    'canPullBack 必须写成 native && overlay（不许出现 a11y || overlay）');
  assert(/effective:\s*native\s*&&\s*svcAllowed\s*&&\s*overlay\s*&&\s*canDetect/.test(body),
    'effective 必须四层全中（native && svcAllowed && overlay && canDetect）');

  // 缺啥补啥的顺序：native → svcAllowed → overlay → detect
  const m = (forced.missingHint ? forced.missingHint(noOverlay) : '');
  assert(m.indexOf('显示在其他应用上层') >= 0, '缺悬浮窗时 missingHint 要指名说"显示在其他应用上层"');
  assert(Array.isArray(noOverlay.missing) && noOverlay.missing.indexOf('overlay') >= 0,
    'missing 里要列出 overlay');
}

console.log('== 2. 原生：遮罩该盖时得盖、不该盖时别死锁 ==');

{
  const s = strip(uts);

  // ① 失明 ≠ 合规：已判跑偏就继续盖（原来是 return false，于是"完全没反应"）
  const nb = fnBody(s, 'needOverlay');
  assert(nb.length > 0, '抽得到 needOverlay 的方法体');
  assert(/fg\.length\s*==\s*0\)\s*return\s+this\.inEpisode/.test(nb.replace(/\s+/g, ' ').replace(/ /g, ' ')) ||
    /fg\.length == 0\) return this\.inEpisode/.test(nb),
    'needOverlay 失明时必须延续 inEpisode（不许 return false）');

  // ② 中性界面白名单：设置 / 授权页绝对不能盖（盖了用户就永远开不了悬浮窗）
  assert(/const NEUTRAL_CSV/.test(uts), '定义了 NEUTRAL_CSV 中性界面名单');
  assert(/com\.android\.settings/.test(uts), '中性名单含系统设置页 com.android.settings');
  assert(/com\.android\.permissioncontroller/.test(uts), '中性名单含权限授权页');
  assert(/com\.android\.systemui/.test(uts), '中性名单含系统界面（按最近任务那一下的前台是它）');
  // ⚠️ 必须按签名切到**类里那个** setWatch（同名的还有个 export 包装）
  const sw = sigBody(s, /^[ \t]{2,6}setWatch\(on: boolean/m);
  assert(sw.length > 0, '抽得到服务类里的 setWatch 方法体（别抽成外面的 export 包装）');
  assert(/NEUTRAL_CSV\.split/.test(sw), 'setWatch 里真的把中性名单并进了白名单');
  // ★ 桌面不许被放行：以前这里会 `homePackage()` 把系统 Home 并进 allow，
  //   于是按 HOME 回桌面 = 合规 = 强制模式一动不动（用户反馈"退出去没拦截"）。
  // ⚠️ 断言必须是"setWatch 里一个 homePackage 都不能有"，不能只盯着 `let home = ...`
  //    那种老写法 —— 换个写法（`.concat([homePackage(ctx!)])`）就绕过去了（已踩）
  assert(!/homePackage\s*\(/.test(sw),
    '★ setWatch 不许把系统桌面并进白名单（那等于"回桌面不拦"，强制模式最该响的一下就没了）');
  assert(/homePackage\(ctx!\)/.test(uts), '桌面包名只留给诊断（watchDiag 的 home=）');
  // ⚠️ 别写成 /atHome/：改成 atHomeX 也照样命中，断言就成了摆设（已踩）
  assert(/"atHome":/.test(uts) || /'atHome'/.test(uts),
    '诊断里带 atHome（一眼看出"前台是桌面"）');

  // ③ 划掉卡片必须先撤遮罩
  const tr = fnBody(s, 'onTaskRemoved');
  assert(tr.length > 0, '有 onTaskRemoved 钩子');
  assert(/postOverlay\(false\)/.test(tr), 'onTaskRemoved 第一件事必须是撤遮罩');
  assert(/cancelPullNotify/.test(tr), 'onTaskRemoved 顺带撤掉拉回通知');

  // ④ 私有字段：watchDiag 是顶层函数，Kotlin 的 private 是**类私有**，访问不到
  const cls = /class PWFocusService extends Service \{[\s\S]*?\n\}/.exec(uts);
  const cl = cls ? cls[0] : '';
  assert(cl.length > 0, '抽得到 PWFocusService 类声明区');
  assert(/^[ \t]*allowCsv = '';/m.test(cl), 'allowCsv 不能是 private（顶层 watchDiag 要读）');
  assert(/^[ \t]*inEpisode = false;/m.test(cl), 'inEpisode 不能是 private');
  assert(/^[ \t]*pullTries: Int = 0;/m.test(cl), 'pullTries 不能是 private');
  assert(/^[ \t]*blindTicks: Int = 0;/m.test(cl), 'blindTicks 不能是 private');

  // ⑤ 错误结论不许回潮。
  //    ⚠️ 判据必须是**正面**的（"必须写着正确的说明"），不能写成
  //    "不许出现某句话" —— 那句话只存在于注释里，而这里要先剥注释，
  //    于是反向判据恒为真，是条假绿（第 12 条硬约束的又一面）。
  //    所以用原始文本（含注释）断言"纠正说明还在"。
  assert(/SYSTEM_ALERT_WINDOW/.test(iface), 'interface.uts 要说清 SYSTEM_ALERT_WINDOW 才是那把钥匙');
  assert(/另一个可见应用/.test(iface),
    'interface.uts 要说清豁免是"被**另一个可见应用**绑定"（无障碍是我们自己的服务，不算）');
  assert(/另一个可见应用/.test(fg),
    'fgsvc.js 也要写清这一点（它是页面唯一问得到原生能力的地方，写漏了下一轮又会走回老路）');
  assert(/SYSTEM_ALERT_WINDOW/.test(uts), 'index.uts 也要写明 SYSTEM_ALERT_WINDOW');
}

console.log('== 3. 自检面板：每一环都要能交出实测值 ==');

{
  assert(/export function watchDiag\(\): string/.test(uts), '原生导出 watchDiag');
  assert(/export function overlayGranted\(\): boolean/.test(uts), '原生导出 overlayGranted');
  assert(/export function watchDiag\(\): string/.test(iface), 'interface.uts 声明了 watchDiag');
  assert(/export function overlayGranted\(\): boolean/.test(iface), 'interface.uts 声明了 overlayGranted');

  // 字段要齐：少一个就看不出断在哪
  ['svc', 'watch', 'fg', 'src', 'episode', 'tries', 'blind', 'allowN',
    'pulls', 'escapes', 'ovGrant', 'ovWanted', 'ovOn', 'a11y', 'a11yEv', 'tripped'
  ].forEach((k) => {
    assert(new RegExp('"' + k + '":').test(uts), 'watchDiag 输出字段含 ' + k);
  });

  // 分层真跑，别只测一层：
  //   fgsvc 那一层负责**把原生 JSON 串解析成对象**（'1'/'0' → 布尔，转错就等于没诊断）；
  //   forced 那一层只负责**转发**（桩错位一级就会测了个寂寞 —— 已踩）。
  const raw = '{"svc":1,"watch":1,"fg":"com.tencent.mm","src":"a11y","episode":1,"tries":3,' +
    '"blind":0,"allowN":4,"pulls":0,"escapes":2,"ovGrant":1,"ovWanted":1,"ovOn":0,' +
    '"a11y":1,"a11yEv":128,"tripped":0}';

  // ① fgsvc 层：桩的是**插件句柄** fgs（它返回原生口中的 JSON 串）
  const fgsvcMod = load('utils/fgsvc.js', {
    fgs: { isAvailable: () => true, watchDiag: () => raw, overlayGranted: () => true },
    settings: { get: () => ({ focus: { fgservice: true, notify: true } }) }
  });
  const d = fgsvcMod.watchDiag();
  assert(!!d, 'fgsvc.watchDiag() 拿得到快照');
  assert(d.svc === true && d.watch === true, '"1" 要解析成 true');
  assert(d.fg === 'com.tencent.mm', 'fg 原样带出包名（实际 ' + d.fg + '）');
  assert(d.src === 'a11y', 'src 带出探测来源（实际 ' + d.src + '）');
  assert(d.tries === 3 && d.escapes === 2, '计数类字段是数字（tries=' + d.tries + '，escapes=' + d.escapes + '）');
  assert(d.ovOn === false, '"0" 要解析成 false');
  assert(d.a11yEv === 128, '事件数是数字（实际 ' + d.a11yEv + '）');
  assert(d.pulls === 0 && d.escapes === 2, '"发现你切走了但一次都没拉回来"这组读数要能看出来');

  // ② forced 层：桩的是 fgsvc（它返回已解析的对象），验证只是转发
  const forced = load('utils/forced.js', depsWith({
    fgsvc: {
      bringToFrontSupported: () => true, serviceAllowed: () => true, serviceAlive: () => true,
      setWatch: () => true, watchStats: () => ({ pulls: 0, escapes: 0 }),
      resetWatchStats: () => true, ensureStarted: () => true,
      watchDiag: () => d, overlayGranted: () => true
    }
  }));
  const d2 = forced.diag();
  assert(d2 === d, 'forced.diag() 原样转发 fgsvc 的快照（别在两层各解析一遍）');

  // ③ 插件不在 / 解析失败：给空壳而不是抛异常（界面要能照常显示）
  const dead = load('utils/fgsvc.js', {
    fgs: { isAvailable: () => true },     // 有插件但没有 watchDiag（老基座）
    settings: { get: () => ({ focus: { fgservice: true, notify: true } }) }
  });
  const dz = dead.watchDiag();
  assert(dz && dz.svc === false && dz.pulls === 0, '插件缺这个函数时返回空壳而不是抛异常');
  const junk = load('utils/fgsvc.js', {
    fgs: { isAvailable: () => true, watchDiag: () => 'not-json' },
    settings: { get: () => ({ focus: { fgservice: true, notify: true } }) }
  });
  const dj = junk.watchDiag();
  assert(dj && dj.svc === false, '原生返回了坏串也要兜住（JSON.parse 抛出不能冒出去）');
}

console.log('== 4. 引导与状态行：不许谎报、不许把兜底说成可选 ==');

{
  const s = strip(fv);

  // ① 状态行：全都配好却一次都没拉回来 —— 这档必须存在，否则界面永远说好话
  assert(/forcedEscapes\s*>\s*0\s*&&\s*this\.forcedPulls\s*===\s*0/.test(s),
    'forceLine 有"已发现你切走但一次都没拉回来"这一档');
  const fl = fnBody(s, 'forceLine');
  assert(fl.length > 0, '抽得到 forceLine');
  assert(/去开「显示在其他应用上层」/.test(fl), '拉不动时状态行指路去开悬浮窗（不是"去开无障碍"）');
  assert(!/但拉不回来 —— 去开「无障碍」/.test(fl), '状态行不许再让用户去开无障碍解决"拉不回来"');

  // ② 全绿也给自检入口
  const fa = fnBody(s, 'forceAct');
  assert(/return '自检'/.test(fa), 'forceAct 在全绿时给出"自检"入口');

  // ③ 引导顺序：悬浮窗必须排在"无障碍保险丝"之前
  const tf = fnBody(s, 'toggleForced');
  assert(tf.length > 0, '抽得到 toggleForced');
  const iOverlay = tf.indexOf('!this.overlayOk');
  const iSafe = tf.indexOf('!this.a11ySafe');
  assert(iOverlay > 0 && iSafe > 0, 'toggleForced 里两条分支都在');
  assert(iOverlay < iSafe, '悬浮窗分支必须排在 a11ySafe 之前（以前排最后，被当成"可选"）');
  assert(!/可选：再开「显示在其他应用上层」做兜底/.test(s), '不许再把悬浮窗说成"可选兜底"');
  assert(/还差「显示在其他应用上层」，不开拉不回来/.test(s), '有"不开拉不回来"的硬话术');

  // ④ guideNextStep 的"已就绪"必须看 effective，不能只看 a11y
  const gn = fnBody(s, 'guideNextStep');
  assert(gn.length > 0, '抽得到 guideNextStep');
  assert(/if \(c\.effective\)/.test(gn), 'guideNextStep 判"已就绪"看 effective（以前只看 c.a11y）');
  assert(!/if \(c\.a11y\) \{[\s\S]{0,120}已就绪/.test(gn), '不许再出现"只凭 c.a11y 就报已就绪"');
}

console.log('');
if (fail === 0) {
  console.log('强制模式校验全部通过 ✓');
} else {
  console.log('失败 ' + fail + ' 项 ✗');
  process.exit(1);
}

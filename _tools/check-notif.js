// check-notif.js —— 「拦截通知」授权链路
//
// 起因（2026-10-24 用户反馈"拦截通知这边开不了"）：
//   点开关 → 弹一个"需要通知使用权"的框 → 点"去开启" → **什么都没发生**。
//   三处断点各对应下面一节：
//     ① 系统「通知使用权」列表里压根没有 PWstudy（服务声明缺胳膊少腿）
//     ② 跳转失败被 try 吞掉，用户看不到任何反馈（= "开不了"）
//     ③ 从系统设置页回来不重检，用户还得再点一次开关，而第二次点又是同一个框
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');
const { ROOT, loadCode } = require('./lib/load');

const FV = path.join(ROOT, 'pkgPlan', 'pages', 'focus', 'focus.vue');
const HV = path.join(ROOT, 'pages', 'home', 'home.vue');
const MANIFEST = path.join(ROOT, 'uni_modules', 'pwstudy-focus', 'utssdk', 'app-android', 'AndroidManifest.xml');
const STRINGS = path.join(ROOT, 'uni_modules', 'pwstudy-focus', 'utssdk', 'app-android', 'res', 'values', 'strings.xml');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const fv = fs.readFileSync(FV, 'utf8');
const hv = fs.readFileSync(HV, 'utf8');
const mf = fs.readFileSync(MANIFEST, 'utf8');

/** 先剥注释再扫 —— 自己的正则会命中注释（第 12 条硬约束） */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const sfv = strip(fv);
const shv = strip(hv);

/**
 * 按签名切方法体（配大括号）。
 * ⚠️ 别只按函数名切（setWatch 那次已经踩过：同名函数两个，fnBody 先命中外面那个）
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

console.log('== 1. 系统「通知使用权」列表里得有 PWstudy ==');

{
  // 服务没按 BIND_* 声明 + 没有 intent-filter，系统那页里就**没有** PWstudy 这一项 ——
  // 用户照着引导去找也找不到，这是"开不了"里最硬的一种
  const svc = /<service[^>]*PWNotifListener[\s\S]*?<\/service>/.exec(mf);
  assert(svc !== null, '清单里声明了 PWNotifListener');
  const s1 = svc ? svc[0] : '';
  assert(/android:permission="android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE"/.test(s1),
    '带 BIND_NOTIFICATION_LISTENER_SERVICE（不带 = 系统列表里不出现）');
  // ⚠️ 必须带上 <action android:name="…" 这层壳：只测裸串的话改成
  //    NotificationListenerServiceX 也照样命中，断言就成了摆设（atHome 那次已踩）
  assert(/<action android:name="android\.service\.notification\.NotificationListenerService"/.test(s1),
    'intent-filter 里有 NotificationListenerService 这个 action');
  assert(/android:exported="true"/.test(s1), 'exported=true（系统要来绑它）');
  assert(/@string\/pw_notif_label/.test(s1), '有 label（用户在系统列表里看到的名字）');
  const str = fs.readFileSync(STRINGS, 'utf8');
  assert(/<string name="pw_notif_label"/.test(str), 'strings.xml 里真的定义了 pw_notif_label');
}

console.log('== 2. 授权链路：两个入口都得有同一套四个动作 ==');

{
  const need = ['grantedNotif', 'askNotifAccess', 'syncNotifOpt', 'recheckNotif'];
  [['专注页', sfv], ['首页', shv]].forEach((p) => {
    need.forEach((n) => {
      assert(new RegExp('[ \\t]{4}' + n + '\\(').test(p[1]), p[0] + ' 有 ' + n + '（两处别各写一套）');
    });
  });
  // 老写法：页面各处直接 fgsvc.notifGranted() —— 加个"重新检测"就会漏一处。
  // ⚠️ grantedNotif 自己是唯一那个调用点，所以按**出现次数**判，不能判"一处都没有"
  const count = (s, re) => (s.match(re) || []).length;
  assert(count(sfv, /fgsvc\.notifGranted\(\)/g) === 1,
    '专注页只有 grantedNotif 一处读 fgsvc.notifGranted（其余一律走 grantedNotif）');
  assert(count(shv, /fgsvc\.notifGranted\(\)/g) === 1,
    '首页只有 grantedNotif 一处读 fgsvc.notifGranted');
}

console.log('== 3. 跳转失败必须说出来（以前 try 一把就完事 = 点了没反应） ==');

{
  const PAGES = [['专注页', sfv], ['首页', shv]];
  PAGES.forEach((p) => {
    const src = p[1];
    assert(/opened = !!fgsvc\.openNotifSettings\(\)/.test(src),
      p[0] + ' 收下 openNotifSettings 的返回值（不收 = 跳没跳出去永远不知道）');
    assert(/if \(!opened\)/.test(src), p[0] + ' 跳失败时走另一个分支');
    assert(/没跳过去/.test(src), p[0] + ' 跳失败要给"没跳过去"这个框（静默失败 = 用户说"开不了"）');
    assert(/__fromNotif = true/.test(src), p[0] + ' 跳之前记 __fromNotif（回来才知道要重检）');
  });
  // 引导文案必须说清**找哪一项**，以及列表里没有时怎么办
  assert(/找到「PWstudy 专注通知拦截」/.test(sfv), '专注页讲清在系统列表里找哪一项');
  assert(/找到「PWstudy 专注通知拦截」/.test(shv), '首页讲清在系统列表里找哪一项');
  assert(/完全退出再重新打开一次/.test(sfv), '讲清"列表里没有 PWstudy"时怎么办（重启一次让服务重新注册）');
}

console.log('== 4. 从系统设置页回来要重检 ==');

{
  [['专注页', sfv, 'this.__fromNotif'], ['首页', shv, 'this.__fromNotif']].forEach((p) => {
    assert(new RegExp('if \\(' + p[2] + '\\)').test(p[1]), p[0] + ' 的 onShow 认得 __fromNotif');
    assert(/syncNotifOpt\(\)/.test(p[1]), p[0] + ' 回来调 syncNotifOpt 对账');
  });
  // 授权成功就顺手把开关打开：不然用户开完权限回来还得再点一次，
  // 而第二次点又会弹同一个"去开启"框 —— 死循环，看着就是"这个开关开不了"
  const sy = sigBody(sfv, /^[ \t]{4}syncNotifOpt\(\)/m);
  assert(sy.length > 0, '抽得到专注页的 syncNotifOpt');
  assert(/blockNotif: true/.test(sy), '授权成功就把 blockNotif 打开（不用用户再点一次）');
  assert(/通知使用权已开启/.test(sy), '打开后给一句 toast（不然用户不知道已经生效）');
}

console.log('== 5. 真跑：syncNotifOpt 的行为 ==');

{
  // 把两个方法体抠出来跑一遍 —— 正则证明不了"授权成功真的会把开关打开"
  const gb = sigBody(sfv, /^[ \t]{4}grantedNotif\(\)/m);
  const sb = sigBody(sfv, /^[ \t]{4}syncNotifOpt\(\)/m);
  assert(gb.length > 0 && sb.length > 0, '抠得出 grantedNotif / syncNotifOpt 的方法体');

  // ⚠️ 沙箱里 this 没了，统一改成 __self：
  //    loadCode 的 deps 是**按值**塞进 sandbox 的，先 load 再补引用补不进去
  const body = (b) => b.replace(/^\s*\{/, '').replace(/\}\s*$/, '').replace(/\bthis\./g, '__self.');
  const code = 'module.exports.grantedNotif = function () {' + body(gb) + '};\n'
    + 'module.exports.syncNotifOpt = function () {' + body(sb) + '};';

  const run = (granted) => {
    const saved = [];
    const self = { opts: { blockNotif: false }, notifOk: false };
    const deps = {
      __self: self,
      fgsvc: { notifGranted: () => granted },
      settings: { get: () => ({ focus: { blockNotif: false } }), save: () => saved.push(1) },
      uni: { showToast: () => {} },
      t: (s) => s
    };
    const mod = loadCode(code, deps, 'notif-inline.js');
    // syncNotifOpt 内部调的是 __self.grantedNotif()，得把抠出来的那个挂回 self 上
    self.grantedNotif = mod.grantedNotif;
    // 方法体里改的是 __self 上的属性，self 是同一个对象 → 直接读 self 就行
    const r = mod.syncNotifOpt();
    return { r: r, self: self, saved: saved };
  };

  const noPerm = run(false);
  assert(noPerm.r === false, '没授权 → syncNotifOpt 返回 false');
  assert(noPerm.self.opts.blockNotif === false, '没授权时绝不把开关打开（开着却拦不住 = 骗人的界面）');
  assert(noPerm.self.notifOk === false, '没授权时 notifOk 为 false（界面据此显示"重新检测"）');

  const yes = run(true);
  assert(yes.r === true, '已授权 → syncNotifOpt 返回 true');
  assert(yes.self.opts.blockNotif === true, '已授权 → 顺手把 blockNotif 打开');
  assert(yes.self.notifOk === true, '已授权 → notifOk 为 true');
  assert(yes.saved.length > 0, '改动要落盘（只改内存 = 下次进来又变回关）');
}

console.log('== 6. 界面要有"重新检测"的出口 ==');

{
  assert(/sr-try-warn/.test(sfv), '专注页有"重新检测"的样式');
  assert(/recheckNotif/.test(sfv.replace(/[ \t]{4}recheckNotif\(\)/g, '')), '专注页模板里点了 recheckNotif');
  assert(/没检测到授权/.test(sfv), '专注页有"没检测到授权"这句');
  assert(/没检测到授权/.test(shv), '首页有"没检测到授权"这句');
  assert(/fc-try/.test(hv), '首页有"重新检测"的样式');
  // 只在"开关开着却没授权"时才出现 —— 关着的开关不该挂这条提示
  assert(/v-if="blockNotifOn && !notifOk"/.test(hv), '首页只在开关开着且没授权时显示它');
  assert(/opts\[o\.key\] && !notifOk/.test(fv), '专注页只在开关开着且没授权时显示它');
}

console.log('');
if (fail === 0) {
  console.log('拦截通知校验全部通过 ✓');
} else {
  console.log('失败 ' + fail + ' 项 ✗');
  process.exit(1);
}

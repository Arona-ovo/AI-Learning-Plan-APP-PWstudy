// _tools/check-setup.js - 权限与后台保活清单 + 首次引导的接线校验
// 运行：node _tools/check-setup.js
//
// 守的四件事：
//  1) **悬浮窗必须在清单里**。它是强制模式唯一的"手"（安卓 10 起后台启动 Activity
//     被禁，拿到 SYSTEM_ALERT_WINDOW 才命中豁免），却在 2026-10-14 之前一直没进清单
//     —— 于是权限页不引导它、首页弹窗也不提它，用户开着强制模式却永远拉不回来，
//     而且界面一直显示"已就绪"（拉不动是不抛异常的）。这种缺口没有任何报错。
//  2) 「无障碍」与「悬浮窗」的 must 必须是**函数**（只有开了强制模式才必办）。
//     写成字面量 true 的话，不开强制模式的人也会被逼着去授一个全屏警示页的权限。
//  3) 权限页不能出现"我们不碰无障碍"这种过期文案 —— 它跟清单里的 a11y 项直接打架。
//  4) 新建完目标要顺势带用户去加学习 App（wizard 传 new=1 → 详情页放一次引导），
//     且**全局只问一次**。
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load.js');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  const s1 = JSON.stringify(a), s2 = JSON.stringify(b);
  if (s1 === s2) ok(label + ' = ' + s2);
  else bad(label + ' 期望 ' + s2 + '，实际 ' + s1);
}

/* ---------------- mock ---------------- */
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; }
};

const st = { notify: false, usage: false, battery: false, overlay: false, a11y: false, a11ySafe: true };
const opened = [];
const apptime = {
  supported: () => true,
  hasNotifyPermission: () => st.notify,
  hasUsagePermission: () => st.usage,
  batteryIgnored: () => st.battery,
  canDrawOverlays: () => st.overlay,
  hasA11yPermission: () => st.a11y,
  a11ySafe: () => st.a11ySafe,
  refreshA11y: () => {},
  resetA11y: () => {},
  openNotifySettings: () => { opened.push('notify'); return true; },
  openUsageSettings: () => { opened.push('usage'); return true; },
  openBatterySettings: () => { opened.push('battery'); return true; },
  openOverlaySettings: () => { opened.push('overlay'); return true; },
  openA11ySettings: () => { opened.push('a11y'); return true; },
  openAutostartSettings: () => { opened.push('autostart'); return true; }
};

const settings = load('utils/settings.js');
const setup = load('utils/setup.js', { settings, apptime });

/* ---------- 1. 清单：悬浮窗必须在里面 ---------- */
console.log('== 1. 权限清单 ==');
const keys = setup.ITEMS.map(x => x.key);
eq(keys, ['notify', 'usage', 'battery', 'overlay', 'a11y', 'autostart'], '清单顺序（悬浮窗排在"眼睛"前面）');
assert(keys.indexOf('overlay') >= 0, '★ 清单里有悬浮窗（缺它 = 强制模式拉不回来且毫无报错）');

setup.ITEMS.forEach((it) => {
  assert(!!it.key && !!it.title && !!it.why && typeof it.check === 'function' && typeof it.fix === 'function',
    '「' + it.key + '」六个字段齐全（key/title/why/must/check/fix）');
});
const ov = setup.ITEMS.filter(x => x.key === 'overlay')[0] || {};
assert(typeof ov.must === 'function', '★ 悬浮窗的 must 是函数（不开强制模式的人不该被它打扰）');
assert(/canDrawOverlays/.test(String(ov.check)), '悬浮窗的 check 走 canDrawOverlays');
assert(/openOverlaySettings/.test(String(ov.fix)), '悬浮窗的 fix 走 openOverlaySettings');
const a11y = setup.ITEMS.filter(x => x.key === 'a11y')[0] || {};
assert(typeof a11y.must === 'function', '无障碍的 must 也是函数');

/* ---------- 2. 真跑：待办项随"有没有开强制模式"变 ---------- */
console.log('== 2. 待办项（真跑） ==');
const setForced = (on) => settings.set({ focus: { forced: !!on } });
const clearAll = () => { st.notify = st.usage = st.battery = st.overlay = st.a11y = false; setForced(false); };

clearAll();
let pend = setup.pending().map(x => x.key);
assert(pend.indexOf('overlay') < 0 && pend.indexOf('a11y') < 0,
  '没开强制模式 → 不拿悬浮窗/无障碍烦人（' + pend.join('、') + '）');
assert(pend.indexOf('notify') >= 0 && pend.indexOf('usage') >= 0 && pend.indexOf('battery') >= 0,
  '通知 / 使用情况 / 电池这三项一直在');

setForced(true);
pend = setup.pending().map(x => x.key);
assert(pend.indexOf('overlay') >= 0, '★ 开了强制模式 → 悬浮窗进入必办（它是唯一的"手"）');
assert(pend.indexOf('a11y') >= 0, '开了强制模式 → 无障碍也进入必办');
eq(pend.length, 5, '必办一共 5 项（自启动是可选）');

st.overlay = true; st.a11y = true; st.notify = true; st.usage = true; st.battery = true;
eq(setup.pending().length, 0, '全开齐 → 没有待办了');
eq(setup.allOk(), true, 'allOk 为真');
eq(setup.shouldPrompt(), false, '全办好 → 首页不再弹');

// 保险丝跳闸：无障碍起不来时这一项直接算过，别再让用户去开（去了又是同样的循环）
st.a11y = false; st.a11ySafe = false;
pend = setup.pending().map(x => x.key);
assert(pend.indexOf('a11y') < 0, '无障碍保险丝跳闸 → 不再引导他去开（开了也还是崩）');
st.a11ySafe = true;

/* ---------- 3. 去设置 / 跳过 ---------- */
console.log('== 3. 去设置与跳过 ==');
opened.length = 0;
eq(setup.fixItem('overlay'), true, '点悬浮窗的「去设置」打开了系统页');
assert(opened.indexOf('overlay') >= 0, '打开的是悬浮窗那一页（不是别的）');
eq(setup.fixItem('nope'), false, '不认识的 key 返回 false，不静默吞掉');

settings.set({ setup: { done: false, promptAt: 0 } });
eq(setup.shouldPrompt(), true, '有待办且没跳过 → 该弹');
setup.skip();
eq(setup.shouldPrompt(), false, '★ 点过「先不弄」→ 以后不再弹（用户要的"可以跳过"）');
settings.set({ setup: { done: false, promptAt: Date.now() } });
eq(setup.shouldPrompt(), false, '今天刚弹过 → 不再弹（一天一次）');

/* ---------- 3b. 首页那张卡可以关（按缺项记，新问题还会回来） ---------- */
console.log('== 3b. 首页卡片的 × ==');
settings.set({ setup: { done: false, promptAt: 0, appsAsked: false, mutedKeys: [] } });
st.notify = true; st.usage = true; st.battery = true; st.overlay = false; st.a11y = false;
setForced(true);
const before = setup.pendingForCard().map(x => x.key);
assert(before.indexOf('overlay') >= 0, '关之前：卡片有待办（' + before.join('、') + '）');
eq(setup.shouldPrompt(), true, '关之前：每日弹窗还会出现');
setup.mutePending();
eq(setup.pendingForCard().length, 0, '★ 点过 × → 首页卡片不再显示（用户要的"能关掉"）');
assert(setup.pending().length > 0, 'pending() 仍返回全部 —— 卡片可以关，真实状态不许藏（权限页还要看）');
eq(setup.shouldPrompt(), false, '★ 点过 × → 每日弹窗也闭嘴（只关卡片、弹窗照弹等于没关）');
// 后来新缺的项（不在 mutedKeys 里）照样要提醒，不能被一句"别再显示"一起埋掉
st.notify = false;
const after = setup.pendingForCard().map(x => x.key);
eq(after, ['notify'], '★ 新缺的项照样提醒（关的是当时那几项，不是"以后全别说了"）');
// 再关一次：上次记的、这次已经办好的项要被清掉，不然会永久沉默
setup.mutePending();
eq(setup.mutedKeys().sort(), ['a11y', 'notify', 'overlay'], '重关时整份覆盖成当前缺项（办好的从名单里清掉）');
st.notify = true;
setup.mutePending();
eq(setup.mutedKeys().sort(), ['a11y', 'overlay'], '全部关掉后名单只剩当前的缺项（notify 已办好，不占位）');
// 复原：后面几节还要看"待办名字"，别让这一节把清单关空了
settings.set({ setup: { done: false, promptAt: 0, appsAsked: false, mutedKeys: [] } });

// 接线：首页必须用「剔除过的清单」，否则关掉了还会被 v-if 拽回来
const homeJs = R('pages/home/home.vue');
assert(/setup\.pendingForCard\(\)/.test(homeJs), '首页卡片读 pendingForCard（不是 pending）');
assert(/setup\.mutePending\(\)/.test(homeJs), '首页的 × 调 setup.mutePending');
assert(/class="sc-x"[^>]*@tap\.stop="muteSetup"/.test(homeJs),
  '★ × 是独立按钮且 stop 冒泡（否则点 × 等于点了「去设置」）');
assert(/setup\.shortTitle\(x\.title\)/.test(homeJs),
  '副标题用 shortTitle（带括号的全称能排四行，正是"挤占下面的卡片"的原因）');

/* ---------- 4. 标题简写（弹窗/toast 共用一份） ---------- */
console.log('== 4. 标题简写 ==');
eq(setup.shortTitle('无障碍（强制模式：把你拉回来）'), '无障碍', '去掉括号里的补充说明');
eq(setup.shortTitle(''), '权限', '空的也有兜底');
const names = setup.pendingNames();
assert(names.length > 0 && names.every(n => n.indexOf('（') < 0), '待办项名字里没有括号（' + names.join('、') + '）');

/* ---------- 5. 学习 App 引导：只问一次 ---------- */
console.log('== 5. 新建目标 → 顺便加学习 App ==');
settings.set({ setup: { done: false, promptAt: 0, appsAsked: false } });
eq(setup.appsAsked(), false, '还没问过');
setup.markAppsAsked();
eq(setup.appsAsked(), true, '★ 问过一次就记下了（不会每建一个目标都问）');
eq(settings.defaults().setup.appsAsked, false, 'settings 默认值里有 appsAsked（老数据升级上来是 false）');

const wiz = R('pkgPlan/pages/wizard/wizard.vue');
assert(/goal-detail\?id=' \+ g\.id \+ '&new=1'/.test(wiz),
  '★ wizard 建完目标跳转时带上 new=1（详情页靠它认出"刚建的"）');

const gd = R('pkgPlan/pages/goal-detail/goal-detail.vue');
assert(/onLoad\(query\)[\s\S]{0,200}justCreated[\s\S]{0,120}query\.new/.test(gd),
  '详情页 onLoad 读了 new 参数');
assert(/onShow\(\)[\s\S]{0,200}maybeAskApps\(\)/.test(gd), 'onShow 会放一次引导');
assert(/if \(!this\.justCreated\) return/.test(gd), '没带 new=1 进来 → 不放（从列表点进来的不该被问）');
assert(/if \(setup\.appsAsked\(\)\) return/.test(gd), '问过了就不再问');
// 先记账再弹：不然用户还没点就被别的路径打断，下次又弹一遍。
// ⚠️ 必须同时判 `iMark > 0`：把那行整个删掉的话 indexOf 是 -1，而 -1 小于任何
//    下标 —— 那条用例会**通过**，于是"根本没记账"反倒成了绿的（假绿）。
const iMark = gd.indexOf('setup.markAppsAsked()');
const iAsk = gd.indexOf("action: 'apps'");
assert(iMark > 0 && iAsk > 0 && iMark < iAsk,
  '★ 先记账再弹窗（不管他点哪个，这一轮都算问过了）');
assert(/act === 'apps'[\s\S]{0,80}apps\/apps/.test(gd), '点「去添加」真的跳学习 App 管理页');
assert(/cancelText: t\('先不用'\)/.test(gd), '有「先不用」（可以跳过）');

/* ---------- 6. 文案一致性 ---------- */
console.log('== 6. 文案与 i18n ==');
const su = R('pkgManage/pages/setup/setup.vue');
assert(!/不碰无障碍/.test(su), '★ 权限页不再写"不碰无障碍"（跟清单里的 a11y 项打架）');
assert(/有的项我这边看不到/.test(su), '改成了"为什么有的项看不到"的解释');
const en = R('utils/i18n-en.js');
['去添加', '先不用', '顺便把学习 App 加上？'].forEach((k) => {
  assert(en.indexOf("'" + k + "'") >= 0, '英文词表里有「' + k + '」');
});
const home = R('pages/home/home.vue');
assert(/setup\.pendingNames\(\)/.test(home), '★ 首页弹窗按实际缺项生成文案（写死名单的话加一项就漏一条）');

/* ---------- 7. 首启「开始前的几件事」 ---------- */
// 权限页是"事后补"，入口藏在「我的」里 —— 用户往往是发现"锁屏后计时断了"才摸过去。
// 首启这一屏把"要系统放行的"和"要不要被管着"一次摆平：可以全开，也可以一个都不开，
// 但至少知道有这些开关存在。
console.log('== 7. 首启：开始前的几件事 ==');
{
  const startSrc = R('pkgManage/pages/start/start.vue');
  assert(startSrc.length > 0, '存在首启页 pkgManage/pages/start/start.vue');
  // ⚠️ 匹配前先剥注释：data 里那行注释就写着 "setup.status()"，不剥的话
  //   把真正的调用删掉照样匹配得上（反向测试第一轮抓到的假绿）。
  const strip = (s) => String(s || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const startCode = strip(startSrc);
  // 清单必须来自 setup.status()，页面里不许另写一份名单（各写一份必然分叉）
  assert(/setup\.status\(\)/.test(startCode) && /setup\.fixItem\(/.test(startCode),
    '首启页的权限清单走 setup.status()（唯一出处）');
  assert(/onSwitch\('forced'/.test(startCode) && /onSwitch\('strict'/.test(startCode) &&
    /onSwitch\('autoRest'/.test(startCode) && /onSwitch\('range'/.test(startCode),
    '四个可选开关都接上了（强制 / 严格 / 自动休息 / 学习范围）');
  assert(/loc\.turnOn\(v\)/.test(startCode), '学习范围那个开关走 location.turnOn（与学习范围页同一出口）');
  // ★ 强制模式一开，悬浮窗 / 无障碍就从"用不到"变成必办项 —— 不重刷清单，
  //   用户会以为强制模式开好了，其实那两项压根没出现在屏幕上。
  const bSw = (startCode.match(/onSwitch\(key, e\)\s*\{[\s\S]*?\n    \}/) || [''])[0];
  assert(/this\.refresh\(\)/.test(bSw), '★ 开关改完重刷权限清单（开强制模式会多出两项必办）');
  // 「开始用」不能把还没办好的缺项一起静音：那几项是真会掉链子的
  const bFin = (startCode.match(/finish\(\)\s*\{[\s\S]*?\n    \}/) || [''])[0];
  assert(/pendingCount/.test(bFin) && /markPrompted/.test(bFin),
    '★ 点「开始用」只在真的全办好时才不再提醒（缺项不许跟着静音）');

  // ---- 真跑：状态机 ----
  const reset = () => { try { settings.set({ setup: { done: false, firstRun: false } }) } catch (e) {} };
  reset();
  assert(setup.shouldFirstRun() === true, '★ 首次（没跑过也没跳过）→ 该放首启页');
  setup.markFirstRun();
  assert(setup.firstRunDone() === true && setup.shouldFirstRun() === false,
    '跑过一次就不再自动跳（不记账的话每次开 App 都被拽走一次）');
  // 在权限页点过「先不弄」的人是明确表态，别再拽一次
  try { settings.set({ setup: { done: true, firstRun: false } }) } catch (e) {}
  assert(setup.shouldFirstRun() === false, '点过「先不弄」的人不再被拽去首启页');
  // 非安卓：没有这套清单，去了就是一屏空白
  const realSupported = apptime.supported;
  apptime.supported = () => false;
  reset();
  const onNonAndroid = setup.shouldFirstRun();
  apptime.supported = realSupported;
  assert(onNonAndroid === false, '非安卓不放首启页（那套清单是安卓专属）');
  reset();

  // ---- 首页接线 ----
  const homeSrc = R('pages/home/home.vue');
  const bFr = (homeSrc.match(/maybeFirstRun\(\)\s*\{[\s\S]*?\n    \}/) || [''])[0];
  assert(bFr !== '', '首页有 maybeFirstRun');
  const iM = bFr.indexOf('setup.markFirstRun()');
  const iN = bFr.indexOf('safeNav(');
  assert(iM > 0 && iN > 0 && iM < iN, '★ 先记账再跳（跳转失败也不会每次都跳）');
  const iF = homeSrc.indexOf('this.maybeFirstRun()');
  const iG = homeSrc.indexOf('this.maybeGuide()');
  assert(iF > 0 && iG > 0 && iF < iG, '首启页排在新手引导之前（引导挖的洞得落在定下来的界面上）');

  const pj = R('pages.json');
  assert(/pages\/start\/start[\s\S]{0,200}custom/.test(pj), 'pages.json 注册了首启页（custom 导航）');
  const setSrc = R('pkgManage/pages/settings/settings.vue');
  assert(/goStart/.test(setSrc) && /pages\/start\/start/.test(setSrc), '设置页有「再看一遍」入口');
  // ⚠️ 入口不许清记账：清了的话从首启页退回首页会被 shouldFirstRun 再拽回去，来回打转
  assert(!/resetFirstRun/.test(setSrc), '设置页入口不清记账（否则退回首页会被再拽一次）');
}

console.log(fail === 0 ? '\n权限与首次引导校验全部通过' : '\n失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);

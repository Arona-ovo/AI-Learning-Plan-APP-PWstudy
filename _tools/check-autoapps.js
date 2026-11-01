// _tools/check-autoapps.js - 「自动补全 / 休闲 AI 推荐 / 搜索框样式」的接线校验
// 运行：node _tools/check-autoapps.js
//
// 2026-11-01 用户反馈三件事，落在这三处：
//   ① 学习 / 休闲 App 的搜索框看不出来是输入框（要圆角长条 + 看得见的描边）
//   ② 从搜索里挑进「休闲 App」的条目只显示首字母，没有图标
//   ③ 没登记的 App 统计不到、也等不来提醒 —— 要能自己发现、AI 归类、一键收进来
//
// 前两条是"照着眼睛能看出来"的回归，靠静态断言钉住；
// 第三条的过滤逻辑（谁能进候选、按什么排序、上限多少）是真跑一遍纯函数 —— 这是最容易
// 悄悄坏掉的地方：一个前缀写错，候选里就会冒出"系统界面""输入法"，用户还以为自己装了它们。
//
// 只读、不改源码。

const fs = require('fs');
const path = require('path');
const { load } = require('./lib/load.js');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APPS = R('pkgPlan/pages/apps/apps.vue');
const AIGUESS = R('services/ai-app-guess.js');
const EN = R('utils/i18n-en.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

/* ---------- 1. 真跑 detect()：候选的过滤与排序 ---------- */
console.log('== 1. 自动补全的候选逻辑（真跑 utils/autoapps.js）==');

/** 造一个 apptime 桩：usage/dock/leisure/skipped 由用例给 */
function stubAppTime(cfg) {
  const c = cfg || {};
  return {
    supported: () => c.supported !== false,
    hasUsagePermission: () => c.permitted !== false,
    usageByPackage: () => c.usage || {},
    isHomePkg: (pkg) => !!(c.home && c.home.indexOf(pkg) >= 0),
    selfPkg: () => c.self || 'com.pwstudy',
    installedAppsCached: () => c.installed || []
  };
}

let autoapps = null;
try {
  autoapps = load('utils/autoapps.js', { apptime: stubAppTime({}) });
  ok('模块能加载（apptime 用桩，不碰真机）');
} catch (e) {
  bad('模块加载失败：' + e.message);
}

if (autoapps) {
  const usage = {
    'com.tencent.mm': 40,        // 用户点过「不用管」
    'tv.danmaku.bili': 30,       // 已在学习 App 清单
    'com.study.app': 10,         // 已在学习 App 清单
    'com.android.systemui': 50,  // 系统界面
    'com.pwstudy': 5,            // 自己
    'com.ss.android.ugc.aweme': 25, // 候选（抖音）
    'com.zhihu.android': 7,      // 候选（知乎）
    'com.tiny.app': 3            // 太短，不进来
  };
  autoapps = load('utils/autoapps.js', { apptime: stubAppTime({
    usage: usage,
    installed: [{ pkg: 'com.ss.android.ugc.aweme', name: '抖音' }]
  }) });

  const list = autoapps.detect({
    dock: [{ pkg: 'com.study.app' }],
    leisure: [{ pkg: 'tv.danmaku.bili' }],
    skipped: ['com.tencent.mm']
  });
  const pkgs = list.map(x => x.pkg);
  assert(pkgs.length === 2, '只留下真正没归类的（' + pkgs.length + ' 个）');
  assert(pkgs[0] === 'com.ss.android.ugc.aweme' && pkgs[1] === 'com.zhihu.android',
    '按今日用时从多到少排（' + pkgs.join(' > ') + '）');
  assert(list[0].min === 25, '带上今日分钟数（' + (list[0] && list[0].min) + '）');
  assert(list[0].name === '抖音', '名字取已装列表里的真名（' + (list[0] && list[0].name) + '）');
  assert(list[1].name === 'com.zhihu.android', '取不到真名就退回包名（' + (list[1] && list[1].name) + '）');
  assert(pkgs.indexOf('com.android.systemui') < 0, '系统界面不会进候选');
  assert(pkgs.indexOf('com.pwstudy') < 0, '不会把自己当休闲 App');
  assert(pkgs.indexOf('com.tencent.mm') < 0, '点过「不用管」的不会反复冒出来');
  assert(pkgs.indexOf('com.tiny.app') < 0, '今天用不到 5 分钟的不打扰');
  assert(pkgs.indexOf('com.study.app') < 0 && pkgs.indexOf('tv.danmaku.bili') < 0,
    '两份清单里的都不重复推荐');

  const top1 = autoapps.detect({ limit: 1 });
  assert(top1.length === 1, 'limit 生效（' + top1.length + ' 个）');
  const high = autoapps.detect({ minMin: 20 });
  assert(high.every(x => x.min >= 20), 'minMin 生效（' + high.map(x => x.min).join('/') + '）');

  const noPerm = load('utils/autoapps.js', { apptime: stubAppTime({ usage: usage, permitted: false }) })
    .detect({});
  assert(Array.isArray(noPerm) && noPerm.length === 0, '没开使用情况访问 → 空数组（不报错）');

  const noSup = load('utils/autoapps.js', { apptime: stubAppTime({ usage: usage, supported: false }) })
    .detect({});
  assert(noSup.length === 0, '非安卓端 → 空数组');

  const sysOk = autoapps.looksSystem('com.android.settings', 'com.pwstudy') === true
    && autoapps.looksSystem('com.sohu.inputmethod.sogou', 'com.pwstudy') === true
    && autoapps.looksSystem('com.tencent.mm', 'com.pwstudy') === false;
  assert(sysOk, '系统 / 输入法判得出来，普通 App 不会误判');
}

/* ---------- 2. AI 归类：只认三档、默认 skip ---------- */
console.log('');
console.log('== 2. AI 归类（services/ai-app-guess.js 的 classifyApps）==');
assert(/export async function classifyApps/.test(AIGUESS), '导出了 classifyApps()');
assert(/kind === 'study' \|\| x\.kind === 'leisure'/.test(AIGUESS), '只认 study / leisure 两档');
assert(/kind:\s*kind/.test(AIGUESS) && /: 'skip'/.test(AIGUESS), '其余一律归到 skip（宁可不动，别乱加）');
assert(/timeout:\s*\d+/.test(AIGUESS), '带超时（AI 卡住不能拖着页面）');
assert(/max\b/.test(AIGUESS) && /slice\(0, max\)/.test(AIGUESS), '名单有上限（几百个应用一口气问会超时）');

/* ---------- 3. 页面接线 ---------- */
console.log('');
console.log('== 3. App 页接线（pkgPlan/pages/apps）==');

// 3.1 搜索框：圆角长条 + 看得见的描边
const searchCss = /\.search\s*\{([\s\S]*?)\}/.exec(APPS);
assert(!!searchCss, '能切到 .search 的样式块');
assert(searchCss && /border-radius:\s*999rpx/.test(searchCss[1]), '搜索框是圆角长条（999rpx）');
assert(searchCss && /border:\s*2rpx solid rgba\(var\(--neutral-rgb/.test(searchCss[1]),
  '搜索框有可见描边（中性色，不是一圈白）');
assert(/\.search-on\s*\{/.test(APPS), '聚焦时描边转品牌色（.search-on）');
assert((APPS.match(/search-on/g) || []).length >= 3, '学习 / 休闲两个搜索框都接了聚焦态');

// 3.2 休闲列表要图标
const leiRow = /v-for="a in leisurePkgs"[\s\S]{0,400}?initialOf\(a\)/.exec(APPS);
assert(!!leiRow, '休闲 App 列表还在按清单渲染');
assert(/v-for="a in leisurePkgs"[\s\S]{0,300}?iconMap\[a\.pkg\]/.test(APPS),
  '休闲列表优先用真图标，取不到才退回首字母');
assert(/leisurePkgs\.forEach\(a => this\.ensureIcon\(a\.pkg\)\)/.test(APPS), '进页面会把休闲 App 的图标排进队列');

// 3.3 休闲 AI 推荐
assert(/@tap="aiRecommendLeisure"/.test(APPS), '休闲面板有「让 AI 推荐」入口');
assert(/aiRecommendLeisure\(\)\s*\{/.test(APPS), 'aiRecommendLeisure() 存在');
assert(/aiGuess\.classifyApps\(pool/.test(APPS), '推荐走 classifyApps（一次问一批）');
assert(/x\.kind === 'leisure'/.test(APPS), '只把判成 leisure 的放进推荐位');

// 3.4 自动补全
assert(/@tap="openAuto"/.test(APPS), '休闲卡片有「自动补全」入口');
['openAuto', 'applyAuto', 'toggleAutoOn', 'autoFill'].forEach(fn => {
  assert(new RegExp(fn + '\\s*\\([^)]*\\)\\s*\\{').test(APPS), fn + '() 存在');
});
assert(/autoapps\.detect\(/.test(APPS), '候选来自 utils/autoapps.js 的 detect()');
assert(/pw\.dockAdd\(c\.pkg/.test(APPS), '判成学习的落进学习 App 白名单');
assert(/this\.leisurePkgs\.push\(\{ pkg: c\.pkg/.test(APPS), '判成休闲的落进休闲清单');
assert(/this\.autoSkipped\.push\(c\.pkg\)/.test(APPS), '「不用管」的记进跳过名单（下次不再推）');
assert(/autoOn:\s*!!this\.autoOn/.test(APPS) && /autoSkipped:/.test(APPS),
  '开关与跳过名单都落盘（不然下次换个页面就忘了）');
assert(/leisure\.armGuard\(\)/.test(APPS), '清单变了要重排原生后台检测（否则新加的 App 要等下次前台）');
// 自动那条路：必须有节流 + AI 开关两道闸，否则每次 onShow 都在烧 AI
assert(/_autoDoneAt/.test(APPS) && /Date\.now\(\) - this\._autoDoneAt/.test(APPS),
  '自动补全有节流（不会每次 onShow 都问一次 AI）');
assert(/if \(!this\.autoOn \|\| !this\.aiEnabled \|\| !this\.permitted\) return/.test(APPS),
  '自动补全要同时满足：开关开 / AI 配好 / 有使用情况权限');
assert(/toggleAutoOn\(\)\s*\{[\s\S]{0,220}?aiEnabled/.test(APPS),
  '没配 AI 时不许打开自动补全（会把学习 App 当休闲）');

/* ---------- 4. 新文案都有英文 ---------- */
console.log('');
console.log('== 4. 新文案都有英文译文 ==');
const KEYS = [
  '自动补全', '自动补全：把没登记的常用 App 找出来', '发现 {n} 个常用的 App 还没归类',
  '看今天的真实用时，AI 判断学习还是休闲，一次加完', '去处理', '看看',
  '不知道选哪个？让 AI 挑几个最容易沉迷的', 'AI 正在挑休闲 App…', '按你的用时推荐',
  '这些 App 今天用过，但没进任何清单。确认归类后一次加进去，之后就能统计和提醒。',
  'AI 正在分类…', '没有发现没归类的 App（可能还没开使用情况访问）', '今天 {n} 分钟',
  '全部按建议添加', '以后自动补全，不再问我', '按 AI 的分类直接加进来',
  '需要先填 API，否则分不清学习还是休闲', '不用管', '已收录 {n} 个 App',
  '自动补全需要 AI 分类，先去填 API', '以后自动补全已开启', '已关闭自动补全'
];
const miss = KEYS.filter(k => EN.indexOf("'" + k + "':") < 0);
assert(miss.length === 0, miss.length === 0
  ? KEYS.length + ' 条新文案都有英文'
  : '缺英文：' + miss.slice(0, 3).join(' / '));

console.log('');
console.log(fail === 0 ? '自动补全 / 休闲推荐校验全部通过' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);

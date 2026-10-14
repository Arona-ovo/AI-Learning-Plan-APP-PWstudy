// _tools/check-home.js - 首页自定义 / 跳转 / 拖拽收纳 校验（只读）
// 运行：node --experimental-strip-types _tools/check-home.js
//
// 覆盖：
//  1) utils/home-layout.ts 模块注册表与持久化（normalize / stash / restore / move / stashed）
//  2) dropIndex 拖拽落点纯函数（上下、边界、零位移、高度不等）
//  3) pages/home/home.vue 模板：布局驱动渲染 + 三个数据项跳转 + 编辑态手柄/收纳 + 收纳区面板
//  4) pages/home/home.vue 脚本：组件注册 + 方法齐全 + 生命周期刷新布局
//  5) 三个详情页存在（history / review-list / streak）且已注册进 pages.json
//  6) 三个详情页有返回入口，数据源与首页一致

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const P = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// PWstudy 的首页模块（背单词那批 book / action / worddrill / chart / usage 已随老首页退役）。
// 期望值不再写死顺序：顺序从注册表算，但"该有哪几个模块"必须写死 ——
// 顺序改了不算错，少一个 / 改了名才是错。
const MUST_IDS = ['focus', 'urgency', 'task', 'goal', 'dock', 'coach'];

/* ---------------- mock：uni 存储 ---------------- */
const kv = {};
global.uni = {
  getStorageSync: (k) => (k in kv ? kv[k] : ''),
  setStorageSync: (k, v) => { kv[k] = v; },
  removeStorageSync: (k) => { delete kv[k]; },
  showToast: () => {}
};

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  const s1 = JSON.stringify(a);
  const s2 = JSON.stringify(b);
  if (s1 === s2) ok(label + ' = ' + s2);
  else bad(label + ' 期望 ' + s2 + '，实际 ' + s1);
}

(async () => {
  /* ---------- 1. 模块注册表与持久化 ---------- */
  console.log('== 1. 首页模块注册表 / 持久化 ==');
  const L = await import(P('utils/home-layout.ts'));
  const needFns = ['MODULES', 'defaultLayout', 'moduleOf', 'normalize', 'layout',
    'saveLayout', 'stashed', 'stash', 'restore', 'move', 'dropIndex'];
  needFns.forEach(f => assert(typeof L[f] === 'function' || Array.isArray(L[f]), '导出 ' + f));

  MUST_IDS.forEach(id => assert(L.MODULES.some(m => m.id === id), '注册表含模块 ' + id));
  const DEF_LAYOUT = L.defaultLayout();
  eq(DEF_LAYOUT, L.MODULES.filter(m => m.def).map(m => m.id), '默认布局 = 注册表里 def:true 的模块');
  assert(DEF_LAYOUT.length >= 3, '默认上首页 ' + DEF_LAYOUT.length + ' 个（≥3）');
  assert(L.MODULES.every(m => m.id && m.name && m.desc), '每个模块都有 id/name/desc');
  eq(L.layout(), DEF_LAYOUT, '首次读取 = 默认');

  // 归一化：去重 / 过滤非法 / 空值兜底（用例里的 id 也从注册表取，换模块不用改脚本）
  const A = MUST_IDS[0], B = MUST_IDS[1], C = MUST_IDS[2];
  eq(L.normalize([B, A, B, 'xxx', C]), [B, A, C], '去重并过滤非法 id');
  eq(L.normalize(null), DEF_LAYOUT, 'null 兜底为默认');
  eq(L.normalize([]), DEF_LAYOUT, '空数组兜底为默认');

  // 收纳：移出首页 → 出现在收纳区
  let lay = L.stash(A);
  eq(lay, DEF_LAYOUT.slice(1), '收纳 ' + A + ' 后布局');
  assert(L.stashed().some(m => m.id === A), A + ' 进入收纳区');
  eq(L.stashed().length, L.MODULES.length - lay.length, '收纳区数量 = 全部 - 首页');

  // 重新加回：追加到末尾
  const back = DEF_LAYOUT.slice(1).concat([A]);
  lay = L.restore(A);
  eq(lay, back, '加回 ' + A + '（追加到末尾）');
  eq(L.restore(A), back, '重复添加幂等');

  // 拖拽换位
  const three = DEF_LAYOUT.slice(0, 3);
  L.saveLayout(three);
  eq(L.move(0, 2), [three[1], three[2], three[0]], 'move(0→2)');
  eq(L.move(2, 0), three, 'move(2→0)');
  eq(L.move(1, 1), three, 'move 同位置不变');
  eq(L.move(0, 99), [three[1], three[2], three[0]], 'move 越界夹取到末尾');
  eq(L.move(-1, 0), [three[1], three[2], three[0]], 'move 非法起点不变');

  // 持久化：重新读一次仍在
  eq(L.layout(), [three[1], three[2], three[0]], '布局已持久化');
  L.saveLayout(three);

  /* ---------- 2. dropIndex 拖拽落点 ---------- */
  console.log('== 2. dropIndex 拖拽落点 ==');
  const H = [100, 100, 100];
  eq(L.dropIndex(0, 0, H), 0, '零位移不换位');
  eq(L.dropIndex(0, 40, H), 0, '向下 40 < 阈值 100 不换位');
  eq(L.dropIndex(0, 120, H), 1, '向下 120 → 落到 1');
  eq(L.dropIndex(0, 320, H), 2, '向下 320 → 落到 2');
  eq(L.dropIndex(2, -120, H), 1, '向上 120 → 落到 1');
  eq(L.dropIndex(2, -320, H), 0, '向上 320 → 落到 0');
  eq(L.dropIndex(0, -50, H), 0, '首项向上越界仍为 0');
  eq(L.dropIndex(2, 500, H), 2, '末项向下越界仍为末位');
  // 高度不等：[120, 60]
  const H2 = [120, 60];
  eq(L.dropIndex(0, 50, H2), 0, '不等高：向下 50 < (120+60)/2=90 不换位');
  eq(L.dropIndex(0, 100, H2), 1, '不等高：向下 100 > 90 → 落到 1');

  /* ---------- 3. home.vue 模板：硬控 + 按模块显隐 ---------- */
  // 2026-10-10 重写：这一段原先断言的是背单词首页（组件 widget-*、goHistory/goReviewList/
  // goStreak、批次名、AI 卡按钮映射…），那些都随老首页一起退役了。现在守的是 PWstudy 首页
  // 的两条硬规则：① 计时一开始整屏只剩倒计时；② 空闲态的每一张卡都由注册表决定显隐。
  console.log('== 3. pages/home/home.vue 模板 ==');
  const home = R('pages/home/home.vue');
  const tpl = home.slice(0, home.indexOf('\n<script'));
  // 少数判据（显隐门槛）住在脚本里，模板段要引用就得先切出来
  const sc0 = home.slice(home.indexOf('\n<script'), home.indexOf('\n<style'));

  // 硬控：只要还有一轮在跑（专注 / 休息 / 暂停），首页就只剩倒计时
  assert(/v-if="locked"/.test(tpl) && /class="lock"/.test(tpl), '计时中走硬控分支 locked');
  assert(/<block v-else>/.test(tpl), '空闲态整块收在 v-else 里（不留分心入口）');
  assert(/fmtMMSS\(cur\.remainSec\)/.test(tpl), '硬控屏显示剩余时间');
  assert(/lock-ring"[^\n]*@tap="goFocus\(\)/.test(tpl), '点计时环进全屏专注页');
  assert(/@tap="togglePause"/.test(tpl), '硬控屏有暂停 / 继续');
  assert(/@tap="confirmGiveUp"/.test(tpl), '硬控屏有放弃');
  assert(/{{ lockFoot }}/.test(tpl), '硬控屏底部说明当前是哪档约束');
  assert(/{{ todayMin }}/.test(tpl) && /{{ todayPomo }}/.test(tpl), '硬控屏仍能看到今日累计');

  // 空闲态：卡片区改成 v-for 遍历注册表（2026-10-12 从 AWword 移植拖拽排序后），
  // 每张卡由 v-if="id === 'xxx'" 分支渲染，显隐走 cardOrder（见脚本段断言）。
  assert(/v-for="\(id,\s*i\)\s*in\s*cardOrder"/.test(tpl), '卡片区按 cardOrder 遍历渲染');
  assert(/class="mod-list"/.test(tpl), '卡片区包在 .mod-list 里（拖拽测量与位移都靠它）');
  MUST_IDS.forEach(id => {
    assert(tpl.indexOf("id === '" + id + "'") >= 0, '卡片分支 v-if="id === \'' + id + '\'"');
  });
  // 紧迫度卡：只有排了任务才出现（u.empty = 今天一个番茄都没排），
  // 否则新用户进来会看到一张"全空"的环，不知道它在说什么。
  // 这条判据现在在 cardVisible() 里，模板只管渲染 —— 少一层判断就会掉进
  // "编辑态必须显形" 的坑，所以这里改成验脚本。
  // 判据搬到脚本里了（cardVisible），这里拆开验两段：门槛是 !u.empty，且挂在 urgency 上
  assert(/cardVisible\(id\)\s*\{[\s\S]*?id === 'urgency'[\s\S]*?!\s*this\.u\.empty/.test(sc0),
    '紧迫度卡：今日无任务时不显示（cardVisible）');
  // 编辑态必须反过来：哪怕 u.empty 也要显形，否则收纳后永远捞不回来
  assert(/cardOrder\(\)\s*\{[\s\S]*?if\s*\(this\.editing\)\s*return ids/.test(sc0),
    '编辑态 cardOrder 返回全部（条件卡也显形）');
  // 番茄卡：点卡片 ≠ 开始计时（2026-10-12 真机反馈"一点今日专注的卡就直接开始了"）。
  // 起表是有成本的动作（首页立刻被硬控、严格模式开始记账），
  // 手指落在卡片空白处就开一轮，等于把"看一眼"变成了"必须做完 25 分钟"。
  // 所以：卡片 = 进专注页，**「开始」按钮才是唯一直接起表的入口**。
  const focusCard = /<view[^>]*class="card focus-card"[^>]*>/.exec(tpl);
  assert(focusCard && /@tap="goFocus\(\)"/.test(focusCard[0]),
    '点番茄卡只进专注页（卡片本身不带 auto=1）');
  assert(/class="fc-go"[^>]*@tap\.stop="quickStart\(\)"/.test(tpl),
    '「开始」按钮是独立入口，且 stop 掉冒泡（不会顺带触发卡片跳转）');
  assert(/点「开始」先确认时长/.test(tpl), '副标题点明"「开始」是去确认时长，不是直接起表"');

  assert(/<urgency-meter/.test(tpl), '紧迫度卡渲染 urgency-meter 组件');
  assert(/@help="explainUrgency"/.test(tpl), '紧迫度卡：? 按钮接出说明弹窗');
  // 条件卡（权限提醒 / AI 规划中）不进注册表：它们是"有事才出现"的横幅，
  // 用户收纳不掉才对（权限没开真的会让计时断掉）。断言不写死属性顺序。
  const setupCard = /<view[^>]*class="card setup-card"[^>]*>/.exec(tpl);
  assert(setupCard && /v-if="setupPending\.length"/.test(setupCard[0]),
    '权限提醒卡：条件触发，不进注册表');
  const resumeCard = /<view[^>]*class="card resume-card"[^>]*>/.exec(tpl);
  assert(resumeCard && /v-if="resumePlan"/.test(resumeCard[0]),
    'AI 规划中卡：条件触发，不进注册表');
  assert(/<float-navbar/.test(tpl), '有自定义顶栏');

  /* ---------- 4. home.vue 脚本 ---------- */
  console.log('== 4. pages/home/home.vue 脚本 ==');
  const sc = home.slice(home.indexOf('\n<script'), home.indexOf('\n<style'));

  // 首页模块显隐的唯一来源
  assert(/from '[^']*home-layout\.ts'/.test(sc), '导入 utils/home-layout.ts');
  assert(/layoutIds: layout\.layout\(\)/.test(sc),
    'layoutIds 首帧直接读一次（留空会让所有卡闪一下）');
  assert(/syncLayout\(\)\s*\{[\s\S]*?layout\.layout\(\)/.test(sc), 'syncLayout 读注册表');
  assert(/cardOrder\(\)\s*\{[\s\S]*?layoutIds/.test(sc), 'cardOrder 由当前布局派生');
  assert(/this\.syncLayout\(\)/.test(sc), 'refresh 里同步一次模块（收纳/加回后立刻生效）');

  // 硬控的判定与文案
  assert(/locked\(\)\s*\{[\s\S]*?c && c\.phase/.test(sc), 'locked = 有 phase 就硬控（休息/暂停也算）');
  assert(/lockFoot\(\)\s*\{[\s\S]*?强制模式[\s\S]*?严格模式/.test(sc), 'lockFoot 说清是哪档约束');

  // 紧迫度卡：算在 utils/urgency.js（纯计算、可单测），页面只负责把结果喂给组件。
  // 每次 refresh 都重算——剩余时间是走动的，隔一分钟不刷新时间条就失真。
  assert(/from '[^']*utils\/urgency\.js'/.test(sc), '导入 utils/urgency.js');
  assert(/components:\s*\{[^}]*UrgencyMeter/.test(sc), '注册 UrgencyMeter 组件');
  assert(/u:\s*\{\}/.test(sc), 'data 里有 u（紧迫度结果）');
  assert(/this\.u\s*=\s*urgency\.compute\(\)/.test(sc), 'refresh 里重算紧迫度');
  assert(/explainUrgency\s*\(/.test(sc), 'explainUrgency 解释四个图形');
  assert(/urgency\.levelName/.test(sc), '说明弹窗用 levelName 给出档位名');

  // 计时驱动与生命周期：onShow 起、onHide 停（切页不空转）
  ['refresh', 'goFocus', 'togglePause', 'confirmGiveUp', 'startTick', 'stopTick', 'syncLayout']
    .forEach(m => assert(new RegExp('\\b' + m + '\\s*\\(').test(sc), 'method ' + m));
  // 起表入口收窄（2026-10-14 再收一级）：**任何入口都不许直接起表**。
  // 以前 goFocus 不带 auto、quickStart 带 auto=1 —— 后者让人"一点开始就进倒计时"，
  // 连"这轮几分钟、绑的哪个任务"都没看清。现在两个入口同一落点：进准备页，
  // 由准备页那颗确认按钮起表。所以这里守的是"链接里不许出现起表标记"。
  // 先切出函数体再匹配（无界的 /key[\s\S]*?x/ 会跨到后面别的方法里命中同名代码 → 假绿）
  const body = (sig) => {
    const i = sc.indexOf(sig);
    return i < 0 ? '' : sc.slice(i, sc.indexOf('\n    }', i));
  };
  const bUrl = body('focusUrl() {');
  const bGo = body('goFocus() {');
  const bQuick = body('quickStart() {');
  assert(bUrl && !/auto/.test(bUrl), 'focusUrl 不带任何 auto 起表参数');
  assert(bGo && /navigateTo\(\{ url: this\.focusUrl\(\) \}\)/.test(bGo),
    'goFocus 只进准备页（不带起表参数）');
  assert(bQuick && /this\.goFocus\(\)/.test(bQuick) && !/auto/.test(bQuick),
    'quickStart 与点卡片同一落点（进准备页，不直接起表）');
  // 全页不许再出现 auto=1：目标详情 / 通知深链（utils/link.js）也都得走准备页。
  // 先剥注释再扫 —— 注释里要写清楚"为什么没有 auto=1"，不剥会被自己的注释命中。
  assert(!/auto=1/.test(sc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')),
    'home.vue 里没有任何 auto=1 跳转');

  assert(/onShow\s*\(\)\s*\{[\s\S]*?this\.refresh\(\)/.test(sc), 'onShow 刷新');
  assert(/onHide\s*\(\)\s*\{[\s\S]*?stopTick\(\)/.test(sc), 'onHide 停掉每秒轮询');

  // 与老 App / 老服务门面划清界限
  assert(!/import\s+\*\s+as\s+ai\s+from[^']*services\/index/.test(sc),
    '未走 services 门面 namespace（避免 H5 丢成员）');

  // 首页卡片间距：注册表卡片现在包在 .mod-wrap 里，间距必须挂在这一层。
  // 继续写 .home-slide > .card 会命中不到（卡片已不是 .home-slide 的直接子节点），
  // 结果是整页卡片贴在一起且不报错 —— 所以两条都验。
  assert(/\.mod-wrap\s*\{[^}]*margin-bottom:\s*20rpx/.test(home),
    '卡片间距 20rpx（.mod-wrap）');
  assert(/\.mod-wrap:last-child\s*\{[^}]*margin-bottom:\s*0/.test(home),
    '最后一张卡不留底边距');

  /* ---------- 5. 页面注册 ---------- */
  console.log('== 5. 首页可达的页面都已注册 ==');
  const pj = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages.json'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '').replace(/([^:])(\/\/).*$/gm, '$1'));
  const allPages = pj.pages.map(p => p.path)
    .concat((pj.subPackages || []).map(sp => sp.pages.map(p => sp.root + '/' + p.path)).reduce((a, b) => a.concat(b), []));
  ['pages/home/home', 'pkgPlan/pages/focus/focus', 'pkgPlan/pages/daily/daily',
    'pkgPlan/pages/goal-detail/goal-detail', 'pkgPlan/pages/apps/apps',
    'pkgManage/pages/setup/setup', 'pkgPlan/pages/wizard/wizard'].forEach(p => {
      assert(allPages.indexOf(p) >= 0, 'pages.json 注册 ' + p);
    });

  console.log('');
  console.log(fail === 0 ? '全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('运行异常：', e);
  process.exit(1);
});

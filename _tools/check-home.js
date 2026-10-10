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
const ROOT = path.join(__dirname, '..', 'uniapp');
const P = (rel) => 'file:///' + path.join(ROOT, rel).replace(/\\/g, '/');
const R = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 默认布局：必须与 home-layout.ts 的 MODULES(def:true) 顺序一致
const DEF_LAYOUT = ['book', 'action', 'worddrill', 'stats', 'goal', 'chart', 'usage'];

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

  eq(L.defaultLayout(), DEF_LAYOUT, '默认布局');
  assert(L.MODULES.length >= 8, '可选组件数量 = ' + L.MODULES.length + '（≥8）');
  assert(L.MODULES.filter(m => m.def).length === DEF_LAYOUT.length, '默认上首页的模块 = ' + DEF_LAYOUT.length);
  assert(L.MODULES.every(m => m.id && m.name && m.desc), '每个模块都有 id/name/desc');
  eq(L.layout(), DEF_LAYOUT, '首次读取 = 默认');

  // 归一化：去重 / 过滤非法 / 空值兜底
  eq(L.normalize(['stats', 'book', 'stats', 'xxx', 'action']), ['stats', 'book', 'action'], '去重并过滤非法 id');
  eq(L.normalize(null), DEF_LAYOUT, 'null 兜底为默认');
  eq(L.normalize([]), DEF_LAYOUT, '空数组兜底为默认');

  // 收纳：移出首页 → 出现在收纳区
  let lay = L.stash('action');
  eq(lay, ['book', 'worddrill', 'stats', 'goal', 'chart', 'usage'], '收纳 action 后布局');
  assert(L.stashed().some(m => m.id === 'action'), 'action 进入收纳区');
  eq(L.stashed().length, L.MODULES.length - lay.length, '收纳区数量 = 全部 - 首页');

  // 重新加回：追加到末尾
  lay = L.restore('action');
  eq(lay, ['book', 'worddrill', 'stats', 'goal', 'chart', 'usage', 'action'], '加回 action（追加到末尾）');
  eq(L.restore('action'), ['book', 'worddrill', 'stats', 'goal', 'chart', 'usage', 'action'], '重复添加幂等');

  // 拖拽换位
  L.saveLayout(['book', 'action', 'stats']);
  eq(L.move(0, 2), ['action', 'stats', 'book'], 'move(0→2)');
  eq(L.move(2, 0), ['book', 'action', 'stats'], 'move(2→0)');
  eq(L.move(1, 1), ['book', 'action', 'stats'], 'move 同位置不变');
  eq(L.move(0, 99), ['action', 'stats', 'book'], 'move 越界夹取到末尾');
  eq(L.move(-1, 0), ['action', 'stats', 'book'], 'move 非法起点不变');

  // 持久化：重新读一次仍在
  eq(L.layout(), ['action', 'stats', 'book'], '布局已持久化');
  L.saveLayout(['book', 'action', 'stats']);

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

  /* ---------- 3. home.vue 模板 ---------- */
  console.log('== 3. pages/home/home.vue 模板 ==');
  const home = R('pages/home/home.vue');
  const tpl = home.slice(0, home.indexOf('\n<script'));
  assert(/class="mod-list"/.test(tpl), '存在模块容器 .mod-list');
  assert(/v-for="\(c, i\) in renderCards"/.test(tpl), '按 pageDoc.cards 顺序循环渲染卡片');
  assert(/@touchmove="dragMove"/.test(tpl) && /@touchend="dragEnd"/.test(tpl), '容器绑定拖拽移动/结束');
  // 整行把手：touch + H5 鼠标双路径；收纳按钮用 .stop 挡住拖拽启动
  assert(/@touchstart="dragStart\(i, \$event\)"/.test(tpl), '把手绑定 touchstart 拖拽');
  assert(/@mousedown="dragStartMouse\(i, \$event\)"/.test(tpl), '把手绑定 mousedown（H5 桌面鼠标）');
  assert(/mod-hide"[^>]*@touchstart\.stop="noop"/.test(tpl.replace(/\n\s*/g, ' ')) ||
         (/@touchstart\.stop="noop"/.test(tpl) && /@tap="stashModule\(c\.id\)"/.test(tpl)), '收纳按钮阻断拖拽冒泡');
  assert(/class="mod-grip"/.test(tpl) && /拖动/.test(tpl), '拖拽把手有视觉标识（≡ + 拖动文案）');
  assert(/touch-action:\s*none/.test(home), '把手区域 touch-action: none（拖动时页面不跟滚）');
  assert(/class="mod-hide"[^>]*@tap="stashModule\(c\.id\)"/.test(tpl) || /@tap="stashModule\(c\.id\)"/.test(tpl), '收纳按钮');
  assert(/@tap="goHistory"/.test(tpl), '「已练」跳转 goHistory');
  assert(/@tap="goReviewList"/.test(tpl), '「待复习」跳转 goReviewList');
  assert(/@tap="goStreak"/.test(tpl), '「连续天数」跳转 goStreak');
  ['book', 'action', 'worddrill', 'stats', 'goal', 'chart', 'usage', 'progress', 'favorites', 'streak'].forEach(id => {
    assert(tpl.indexOf("c.type === '" + id + "'") >= 0, '模板分支 c.type === ' + id);
  });
  assert(/class="foot-btn ghost"[^>]*@tap="openSheet"/.test(home) || /@tap="openSheet"/.test(home), '「＋ 添加组件」入口');
  assert(/@tap="finishEdit"/.test(home), '「完成」退出编辑态');
  assert(/@tap="toggleEdit"/.test(home), '「编辑首页」进入编辑态');
  assert(/class="sheet-mask"/.test(tpl) && /@tap="restoreModule\(m\.id\)"/.test(tpl), '收纳区面板 + 加回首页面板项');
  assert(/v-if="sheetShow"/.test(tpl), '收纳区按 sheetShow 显隐');
  assert(/v-if="editing"/.test(tpl), '编辑态条件渲染手柄行');
  // 拖拽时包裹层位移
  assert(/:style="wrapStyle\(i\)"/.test(tpl), '包裹层绑定 wrapStyle(i)');
  assert(/class="mod-shield"/.test(tpl), '编辑态遮罩 .mod-shield 屏蔽模块内部点击');

  /* ---------- 4. home.vue 脚本 ---------- */
  console.log('== 4. pages/home/home.vue 脚本 ==');
  const sc = home.slice(home.indexOf('\n<script'), home.indexOf('\n<style'));
  ['WidgetProgress', 'WidgetFavorites', 'WidgetStreak', 'WidgetChart', 'WidgetGoal', 'WidgetUsage', 'WidgetWorddrill'].forEach(c => {
    assert(new RegExp('import\\s+' + c + '\\s+from').test(sc), '导入组件 ' + c);
    assert(new RegExp('components:\\s*\\{[\\s\\S]*' + c).test(sc), '注册组件 ' + c);
  });
  // 模块注册表：期望值要写死，不能拿 MODULES.map(m => m.id) 当参照（那样恒真、等于没查）
  const REGISTERED = ['book', 'action', 'worddrill', 'stats', 'goal', 'chart', 'usage',
    'progress', 'favorites', 'streak'];
  REGISTERED.forEach(id => assert(L.MODULES.some(m => m.id === id),
    '模块注册表含 ' + id));
  assert(/from\s+'[^']*home-layout\.ts'/.test(sc), '导入 utils/home-layout.ts');
  assert(!/import\s+\*\s+as\s+ai\s+from[^']*services\/index/.test(sc), '未走 services 门面 namespace（避免 H5 丢成员）');
  ['layout', 'editing', 'sheetShow', 'sheetList', 'dragIndex', 'dragDy', 'dragStartY', 'dragHeights']
    .forEach(k => assert(new RegExp('\\b' + k + '\\s*:').test(sc), 'data 含 ' + k));
  ['refreshDoc', 'has', 'nameOf', 'toggleEdit', 'finishEdit', 'openSheet', 'closeSheet',
    'stashModule', 'restoreModule', 'beginDrag', 'dragStart', 'dragStartMouse', 'dragMove', 'dragEnd',
    'wrapStyle', 'cardStyle', 'noop', 'goHistory', 'goReviewList', 'goStreak']
    .forEach(m => assert(new RegExp('\\b' + m + '\\s*\\(').test(sc), 'method ' + m));
  assert(/typeof document === 'undefined'/.test(sc), '鼠标路径在 App 端自动跳过（无 document）');
  assert(/onLoad\s*\(\)\s*\{[\s\S]*refreshDoc\(\)/.test(sc), 'onLoad 读取页面文档');
  assert(/onShow\s*\(\)\s*\{[\s\S]*refreshDoc\(\)/.test(sc), 'onShow 刷新页面文档');
  assert(/homeLayout\.saveLayout\(pageDoc\.builtinOrder/.test(sc), '内置顺序回写 homeLayout（兼容老入口）');
  assert(/onHide\s*\(\)[\s\S]*editing\s*=\s*false/.test(sc), 'onHide 退出编辑态');
  assert(/createSelectorQuery/.test(sc), '拖拽前测量各模块高度');
  assert(/dropIndex\(/.test(sc), '落点复用 home-layout.dropIndex');
  // 编辑态下所有跳转型方法都要失效，避免拖动时误触
  const guarded = (sc.match(/if \(this\.editing\) return/g) || []).length;
  assert(guarded >= 6, '编辑态跳转守卫 = ' + guarded + ' 处（≥6：练习/复习/专练/换词书/历史/待复习/打卡）');

  /* ---------- 4b. AI 卡片：与内置模块同权编辑，删除收进「添加组件」面板 ---------- */
  console.log('== 4b. AI 卡片同权编辑 / 面板删除 ==');
  // 编辑态渲染全部可见卡（内置 + AI），AI 卡不再被排除在编辑态之外
  assert(/renderCards\(\)\s*\{[^}]*return cs\.filter\(c => c\.visible !== false\)/.test(sc),
    'renderCards 编辑态也是全部可见卡（AI 卡可拖拽 / 收纳）');
  assert(!/renderCards\(\)\s*\{[^}]*builtin/.test(sc), 'renderCards 不再按 builtin 过滤');
  // 拖拽下标换算与渲染口径一致（口径不一致会拖错卡片）
  assert(/const idx = this\.visibleIndexes\(\)/.test(sc), 'dragEnd 用 visibleIndexes 换算真实下标');
  assert(!/builtinIndexes/.test(sc), '旧的 builtinIndexes（只算内置卡）已移除');
  // 名字：内置卡查注册表，AI 卡用标题
  assert(/\$t\(moduleName\(c\)\)/.test(tpl) && /moduleName\(c\)\s*\{/.test(sc),
    'moduleName：内置查注册表、AI 用标题');
  // 收纳区面板：AI 分区 + 添加 / 删除双操作
  assert(/v-for="c in aiSheetList"/.test(tpl) && /aiSheetList\(\)/.test(sc),
    '收纳区有 AI 卡片分区（aiSheetList computed）');
  assert(/@tap="restoreModule\(c\.id\)"/.test(tpl), 'AI 卡片在面板里可加回');
  assert(/@tap="deleteAiCard\(c\.id\)"/.test(tpl) && /sheet-del/.test(home), 'AI 卡片在面板里可删除（红色描边按钮）');
  assert(/AI 生成的卡片/.test(tpl), '面板里有 AI 分区标题（与原生组件区分）');
  // 删除要走统一弹窗（AppDialog）确认，且内置卡永远没有删除入口
  const delFn = sc.match(/deleteAiCard\(id\)\s*\{[\s\S]*?\n    \},/);
  assert(!!delFn, '存在 deleteAiCard');
  assert(!!delFn && /delConfirm/.test(delFn[0]), '删除前先弹 AppDialog 确认（delConfirm，不可恢复）');
  assert(!!delFn && /card\.builtin\) return/.test(delFn[0]), '内置卡没有删除入口（原生组件只能收纳）');
  assert(/onDeleteConfirm\(\)/.test(sc) && /pageDoc\.removeCard\(this\.doc, id\)/.test(sc),
    '确认后走 pageDoc.removeCard');
  assert(/<app-dialog/.test(tpl) && /:danger="true"/.test(tpl), '确认弹窗是统一 AppDialog（危险色）');
  assert(!/uni\.showModal/.test(sc), '不调用系统弹窗（全 App 弹窗统一）');
  assert(!/onCardRemove/.test(home) && !/removable/.test(home),
    '旧的卡片表面移除链路（onCardRemove / removable）已清理');

  /* ---------- 4c. 刷单词：独立入口（与翻译练习互不干扰） ---------- */
  console.log('== 4c. 刷单词入口 ==');
  assert(/@tap="goWordDrill"/.test(tpl) && /goWordDrill\(\)\s*\{/.test(sc),
    '「学习入口」有刷单词按钮且方法存在');
  const gwFn = sc.match(/goWordDrill\(\)\s*\{([\s\S]*?)\n    \},/);
  assert(!!gwFn && /word-drill\/word-drill\?source=daily/.test(gwFn[0]), '主入口进日常刷词');
  assert(!!gwFn && /if \(this\.editing\) return/.test(gwFn[0]), '编辑态屏蔽（拖动时不误触）');
  // AI 卡按钮动作也能进：老规格 action 映射 + 新规格 navigate 白名单
  assert(/worddrill: '\/pkgStudy\/pages\/word-drill\/word-drill\?source=daily'/.test(sc),
    'onCardAction 的 action 映射含 worddrill');
  const routeM = R('utils/card-spec.js').match(/wordDrill:\s*\{\s*url:\s*'([^']+)',\s*tab:\s*false\s*\}/);
  assert(!!routeM && routeM[1] === '/pkgStudy/pages/word-drill/word-drill', 'card-spec PAGE_ROUTES 含 wordDrill');
  assert(/c\.type === 'worddrill'/.test(tpl) && /<widget-worddrill/.test(tpl),
    '独立「刷单词」卡有渲染分支');
  const pjStr = R('pages.json');
  assert(pjStr.indexOf('"pages/word-drill/word-drill"') >= 0, 'pages.json 注册 pages/word-drill/word-drill');
  assert(fs.existsSync(path.join(ROOT, 'pkgStudy', 'pages', 'word-drill', 'word-drill.vue')),
    '页面文件存在 pkgStudy/pages/word-drill/word-drill.vue');

  /* ---------- 5. 页面注册 ---------- */
  console.log('== 5. 详情页与路由注册 ==');
  const pj = R('pages.json');
  // 分包后：pages.json 里仍是相对分包的 'pages/x/x'，磁盘上则多一层 pkgStudy/
  ['pages/history/history', 'pages/review-list/review-list', 'pages/streak/streak']
    .forEach(p => {
      assert(pj.indexOf('"' + p + '"') >= 0, 'pages.json 注册 ' + p);
      assert(fs.existsSync(path.join(ROOT, 'pkgStudy', p + '.vue')), '文件存在 pkgStudy/' + p + '.vue');
    });
  assert(pj.indexOf('"pages/cover/cover"') >= 0, '首屏仍为 cover');

  /* ---------- 6. 详情页内容 ---------- */
  console.log('== 6. 详情页内容 ==');
  const his = R('pkgStudy/pages/history/history.vue');
  assert(/engine\.history/.test(his), 'history 读 engine.history()');
  assert(/studyRecords/.test(his), 'history 登录后额外读 study_records');
  assert(/<float-navbar/.test(his), 'history 有导航条（可返回）');

  const rl = R('pkgStudy/pages/review-list/review-list.vue');
  assert(/engine\.wrongList/.test(rl), 'review-list 读 engine.wrongList()');
  assert(/<float-navbar/.test(rl), 'review-list 有导航条（可返回）');
  assert(/practice\?source=review/.test(rl), 'review-list 可跳练习页复习');

  const st = R('pkgStudy/pages/streak/streak.vue');
  assert(/engine\.streak/.test(st), 'streak 读 engine.streak()');
  assert(/longestStreak/.test(st), 'streak 读最长连续');
  assert(/<float-navbar/.test(st), 'streak 有导航条（可返回）');

  // engine 导出契约
  const eg = R('utils/engine.js');
  ['history', 'longestStreak', 'streak', 'dateStr', 'wrongList'].forEach(f => {
    assert(new RegExp('\\b' + f + '\\b').test(eg.slice(eg.indexOf('export {'))), 'engine 导出 ' + f);
  });

  /* ---------- 7. 顶部输入框：空内容回车不做事 ---------- */
  console.log('== 7. 顶部输入框：空内容回车不做事 ==');
  // 回归点：空串回车以前会走到 runSearch('') → onSearchInput('') → clearSearch()，
  // 而 clearSearch 会调顶栏 blurInput() 强制失焦 → 胶囊收起 → 右侧模式键被一起
  // 收成 width:0 + pointer-events:none，于是"按了下回车，切换键就点不动了"。
  const homeSrc = R('pages/home/home.vue');
  const om = homeSrc.match(/\n    onSubmit\(v\) \{([\s\S]*?)\n    \},/);
  assert(!!om, '能抠出 onSubmit 方法体');
  if (om) {
    const intentMod = await import(P('utils/intent.js'));
    const onSubmit = new Function('intent', 'return function (v) {' + om[1] + '\n};')(intentMod);
    // 只记录"真的按下去了什么"：runSearch / runCommand 各记一笔
    const mk = (mode) => {
      const log = [];
      return {
        log: log,
        inputMode: mode, keyword: '', modeLocked: false, lastCmdText: '',
        pickText: (v) => (typeof v === 'string' ? v : String(v == null ? '' : v)),
        runSearch: (v) => log.push('search:' + v),
        runCommand: (v) => log.push('command:' + v)
      };
    };
    let c = mk('search');
    onSubmit.call(c, '');
    eq(c.log, [], '空串回车：既不查词也不跑指令');
    c = mk('search');
    onSubmit.call(c, '   ');
    eq(c.log, [], '纯空格回车：同样不做事');
    c = mk('command');
    onSubmit.call(c, '');
    eq(c.log, [], '指令模式下空回车：不做事');
    c = mk('search');
    onSubmit.call(c, '/');
    eq(c.log, [], '只打了个前缀（正文为空）：不做事');
    c = mk('search');
    onSubmit.call(c, 'apple');
    eq(c.log, ['search:apple'], '有内容时照常查词');
    c = mk('command');
    onSubmit.call(c, '把背景换成安静的蓝色渐变');
    eq(c.log, ['command:把背景换成安静的蓝色渐变'], '指令模式下照常执行');
    // 所见即所得：回车只走界面上显示的模式，自动改判发生在打字时（onSearchInput）
    c = mk('search');
    onSubmit.call(c, '把背景换成安静的蓝色渐变');
    eq(c.log, ['search:把背景换成安静的蓝色渐变'], '界面显示「搜」时回车就查词（不擅自改判成指令）');
    c = mk('search');
    onSubmit.call(c, '/把背景换成安静的蓝色渐变');
    eq(c.log, ['command:把背景换成安静的蓝色渐变'], '显式前缀能盖过界面上的模式');
    // 空回车不能顺手把模式 / 锁定状态改掉（否则用户锁了 AI 一按回车就没了）
    c = mk('command');
    c.modeLocked = true;
    onSubmit.call(c, '');
    eq([c.inputMode, c.modeLocked], ['command', true], '空回车不动模式与锁定态');
  }
  assert(/clearSearch\(\) \{/.test(homeSrc), '清空入口 clearSearch 仍在（× / 收起照常可用）');

  console.log('');
  console.log(fail === 0 ? '全部通过 ✓' : ('失败 ' + fail + ' 项 ✗'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('运行异常：', e);
  process.exit(1);
});

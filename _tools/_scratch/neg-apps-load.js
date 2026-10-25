/**
 * _tools/_scratch/neg-apps-load.js —— check-apps-load.js 的反向测试
 *
 * 做法：往源码里注入"改回去"的坏代码，跑一遍护栏，断言它**必须变红**。
 * 护栏写绿不算数 —— 得证明它抓得到坏代码，否则就是一条永远绿的自欺断言。
 *
 * ⚠️ 两条踩过的坑，别踩第二次：
 *   ① 沙箱里 child_process.spawnSync 直接 EBUSY（status/signal 都是 null → 假绿），
 *      所以护栏只能**同进程 require**；
 *   ② 护栏自己会 process.exit —— 这里把它换成"只记码不真退"，
 *      否则第一次注入就把测试进程自己干掉了（async IIFE 里的 throw 会变 rejection，
 *      try/catch 根本接不到）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'uniapp-PWstudy');
const CHECK = path.join(__dirname, '..', 'check-apps-load.js');
const FILES = {
  apptime: path.join(ROOT, 'utils', 'apptime.js'),
  appsVue: path.join(ROOT, 'pkgPlan', 'pages', 'apps', 'apps.vue'),
  aiGuess: path.join(ROOT, 'services', 'ai-app-guess.js')
};

const backup = {};
Object.keys(FILES).forEach(k => { backup[k] = fs.readFileSync(FILES[k], 'utf8'); });

/**
 * 注入：把 old 换成 next。old 必须真的在文件里，否则算测试写错了。
 *
 * ⚠️ 这些源码是 CRLF，而注入片段写的是 `\n` —— 不做这层转换的话
 *    所有多行注入点都会静默落空（单行片段碰巧能过，于是只有多行那条报"找不到"，
 *    很容易被误读成"源码改过了"）。
 */
function swap(file, oldStr, next) {
  const src = backup[file];
  let o = oldStr;
  let n = next;
  if (src.indexOf('\r\n') >= 0) {
    o = oldStr.split('\n').join('\r\n');
    n = next.split('\n').join('\r\n');
  }
  if (src.indexOf(o) < 0) throw new Error('注入点找不到：' + oldStr.slice(0, 60));
  fs.writeFileSync(FILES[file], src.split(o).join(n));
}
function restore() {
  Object.keys(FILES).forEach(k => fs.writeFileSync(FILES[k], backup[k]));
}

const realExit = process.exit;
let exited = null;
let realLog = console.log;

// ⚠️ 这一行不能少：护栏自己会调 process.exit，不拦住的话第一次 require 就把
//    测试进程自己干掉了（表现为"卡在某一条断言后再无输出、退出码还是 0"）。
//    拦成"只记码"，最后统一用 realExit 真退。
process.exit = function (code) { exited = code; };

/**
 * 跑一遍护栏，返回它想退出的码。
 * 不 throw —— 只记码 + 轮询等 async IIFE 收尾。
 */
async function runCheck(mutations) {
  restore();
  mutations.forEach(m => swap(m[0], m[1], m[2]));
  exited = null;
  console.log = function () {};
  delete require.cache[require.resolve(CHECK)];
  try {
    require(CHECK);
  } catch (e) {
    // 护栏自己炸了也算"抓到"（但下面会单独统计，别让它悄悄过去）
  }
  for (let i = 0; i < 40 && exited === null; i++) {
    await new Promise(r => setTimeout(r, 20));
  }
  console.log = realLog;
  const code = exited;
  restore();
  return code;
}

let pass = 0;
let fail = 0;
async function shouldCatch(label, mutations) {
  const code = await runCheck(mutations);
  if (code === 1) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '（退出码 ' + code + '，应当为 1）'); }
}

(async () => {
  realLog('\n== 对照：不做任何注入时护栏必须是绿的 ==');
  const green = await runCheck([]);
  if (green === 0) { pass++; console.log('  ✓ 原样源码 → 护栏绿'); }
  else { fail++; console.log('  ✗ 原样源码 → 护栏应当是绿的，实际 ' + green); }

  realLog('\n== 1. 落盘缓存被拆 ==');
  await shouldCatch('不写盘（每次冷启动都得重新枚举）', [
    ['apptime', 'saveAppsCache(out);      // 落盘：下次冷启动点开就是秒出', '']
  ]);
  // 注入方向是"把坏写法加回来"：在 return arr 之前写进程内缓存标志
  await shouldCatch('缓存读取写了进程内标志（后台刷新被短路）', [
    ['apptime', '    // ⚠️ 故意**不写** _appsCache / _appsCacheAt：', '    _appsCache = arr;\n    _appsCacheAt = Date.now();\n    // ⚠️ 故意**不写** _appsCache / _appsCacheAt：']
  ]);
  await shouldCatch('空列表也写进缓存（偶发失败被锁死）', [
    ['apptime', '    if (out.length) {\n      _appsCache = out;\n      _appsCacheAt = now;\n      saveAppsCache(out);      // 落盘：下次冷启动点开就是秒出\n    }', '    _appsCache = out;\n    _appsCacheAt = now;\n    saveAppsCache(out);']
  ]);

  realLog('\n== 2. 枚举轮数被改回四轮 ==');
  await shouldCatch('加回 MATCH_UNINSTALLED_PACKAGES 那两轮', [
    ['apptime', "sweep('apps', 0) || sweep('pkgs', 0)", "sweep('apps', 0) || sweep('apps', 128) || sweep('pkgs', 0) || sweep('pkgs', 128)"]
  ]);

  realLog('\n== 3. 名字重复取（跨进程开销回来） ==');
  await shouldCatch('判据从 named 换成 seen（假名字永远补不上）', [
    ['apptime', 'if (named[pkg]) continue;', 'if (seen[pkg]) continue;']
  ]);
  await shouldCatch('push 不再记录 named', [
    ['apptime', '    if (nm !== pkg) named[pkg] = 1;', '']
  ]);

  realLog('\n== 4. 页面不再"先渲染再刷新" ==');
  await shouldCatch('不用落盘缓存（点开就干等）', [
    ['appsVue', 'const cached = apptime.installedAppsCached()', 'const cached = []']
  ]);
  await shouldCatch('缺了刷新闸门（会变成反复枚举）', [
    ['appsVue', 'if (this._appsRefreshed) return', '']
  ]);
  await shouldCatch('静默刷新读空了也清空列表', [
    ['appsVue', 'else if (!silent) this.all = []', 'else this.all = []']
  ]);

  realLog('\n== 5. 加载态被删 ==');
  await shouldCatch('删掉加载态容器', [
    ['appsVue', '<view v-if="loadingApps" class="apps-loading">', '<view v-if="false" class="apps-loading">']
  ]);
  await shouldCatch('删掉转圈动画', [
    ['appsVue', '<view class="al-spin"></view>', '']
  ]);
  await shouldCatch('删掉 keyframes（动画是静态的）', [
    ['appsVue', '@keyframes al-spin { to { transform: rotate(360deg); } }', '']
  ]);
  await shouldCatch('文案不再说明"第一次慢"', [
    ['appsVue', '第一次会慢一点', '正在读取']
  ]);

  realLog('\n== 6. 键盘间距被改回去 ==');
  await shouldCatch('删掉 cursor-spacing', [
    ['appsVue', '          :cursor-spacing="30"\n', '']
  ]);
  await shouldCatch('去掉聚焦状态（面板补不上底部空白）', [
    ['appsVue', '@focus="searchFocus = true"', '']
  ]);
  await shouldCatch('kb-open 不再补底部空白', [
    ['appsVue', '.add-card.kb-open { padding-bottom: 220rpx; }', '.add-card.kb-open { }']
  ]);

  realLog('\n== 7. 专注期锁定被拆（2026-10-25 真机反馈：不能改 app，否则强制等于摆设）==');
  // 反馈原话："专注的时候不能改 app，不然强制等于摆设" —— 专注中途把娱乐 App
  // 加成"学习 App"，强制模式就被从内部拆穿了。锁要长在**每个入口**上。
  await shouldCatch('refresh 不重算 focusLock（锁永远停在初始 false）', [
    ['appsVue', 'try { this.focusLock = !!focusMod.current() } catch (e) { this.focusLock = false }',
      'try { this.focusLock = false } catch (e) { this.focusLock = false }']
  ]);
  await shouldCatch('锁着时编辑面板不收起（留着半开的添加口）', [
    ['appsVue', 'if (this.focusLock) {\n        this.adding = false', 'if (false) {\n        this.adding = false']
  ]);
  await shouldCatch('删掉锁定横幅（用户不知道为什么点不动）', [
    ['appsVue', '<view v-if="focusLock" class="card pc-lock">', '<view v-if="false" class="card pc-lock">']
  ]);
  await shouldCatch('「＋ 添加」不摇头（专注期间还能开添加面板）', [
    ['appsVue', 'tapAddToggle() {\n      if (this.focusLock) { this.lockToast(); return }',
      'tapAddToggle() {\n      void 0']
  ]);
  await shouldCatch('点候选行不摇头（专注期间还能往里加 App）', [
    // ⚠️ startAdd 的第一句是 isAdded 检查，guard 在第二行 —— 锚点要带上前一行
    ['appsVue', 'startAdd(c) {\n      if (this.isAdded(c)) return\n      if (this.focusLock) { this.lockToast(); return }',
      'startAdd(c) {\n      if (this.isAdded(c)) return']
  ]);
  await shouldCatch('手动输包名不摇头', [
    ['appsVue', 'startAddManual() {\n      if (this.focusLock) { this.lockToast(); return }',
      'startAddManual() {\n      void 0']
  ]);
  await shouldCatch('编辑已添加 App 不摇头（能把娱乐 App 的用途改成"学习"）', [
    ['appsVue', 'startEditDock(a) {\n      if (this.focusLock) { this.lockToast(); return }',
      'startEditDock(a) {\n      void 0']
  ]);
  await shouldCatch('AI 推荐不摇头', [
    ['appsVue', 'async aiRecommend() {\n      if (this.focusLock) { this.lockToast(); return }',
      'async aiRecommend() {\n      void 0']
  ]);
  await shouldCatch('删除已添加 App 不摇头', [
    ['appsVue', 'askRemove(a) {\n      if (this.focusLock) { this.lockToast(); return }',
      'askRemove(a) {\n      void 0']
  ]);
  await shouldCatch('锁定提示不说人话（只看到"操作失败"之类）', [
    ['appsVue', "uni.showToast({ title: this.$t('专注进行中，学完这段再来改'), icon: 'none' })",
      "uni.showToast({ title: 'x', icon: 'none' })"]
  ]);
  await shouldCatch('onShow 不走 refresh（专注结束回到本页还锁着）', [
    ['appsVue', 'onShow() {\n    this.refresh()', 'onShow() {\n    void 0']
  ]);

  realLog('\n== 8. AI 推荐被拆（2026-10-25 真机反馈：规划完顺势把学习 App 配齐）==');
  await shouldCatch('不过滤幻觉包名（AI 编个不存在的 App 也进白名单）', [
    ['appsVue', '.filter(p => byPkg[p.pkg])', '.filter(p => true)']
  ]);
  await shouldCatch('推荐不带目标上下文（AI 不知道挑什么，只能瞎猜）', [
    ['appsVue', 'aiGuess.recommendStudyApps(cands, this.goalsContext())',
      "aiGuess.recommendStudyApps(cands, '')"]
  ]);
  await shouldCatch('失败时不给"再试一次"（AI 挂了用户不知道还能再试）', [
    ['appsVue', "{{ aiRec.err ? $t('AI 没推荐出来') : $t('不知道挑哪个？让 AI 按你的目标从手机里推荐') }}",
      "{{ $t('不知道挑哪个？让 AI 按你的目标从手机里推荐') }}"]
  ]);
  await shouldCatch('AI 关着时也显示推荐入口（点了只会失败）', [
    ['appsVue', 'v-if="aiEnabled && !aiRec.items.length && !aiRec.loading"',
      'v-if="!aiRec.items.length && !aiRec.loading"']
  ]);
  await shouldCatch('名单不封顶（几百个 App 全塞给模型，又贵又走神）', [
    ['aiGuess', '.slice(0, 120)', '']
  ]);
  await shouldCatch('推荐不封顶（一屏列几十个，还是得自己翻）', [
    ['aiGuess', 'picks.slice(0, 8)', 'picks']
  ]);
  await shouldCatch('没配 AI 时不说原因（用户以为功能坏了）', [
    ['appsVue', "if (e && e.notConfigured) this.aiRec.err = this.$t('AI 服务未启用')", 'void 0']
  ]);

  restore();
  realLog('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  realExit(fail ? 1 : 0);
})();

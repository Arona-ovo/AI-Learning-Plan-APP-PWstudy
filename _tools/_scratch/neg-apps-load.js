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
  appsVue: path.join(ROOT, 'pkgPlan', 'pages', 'apps', 'apps.vue')
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

  restore();
  realLog('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
  realExit(fail ? 1 : 0);
})();
